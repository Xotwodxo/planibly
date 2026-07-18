import { validateCalendarEvent } from './calendar';
import { database, type PlaniblyDatabase } from './database';
import type { IcsParseResult, ParsedIcsEvent } from './ics';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import type {
  CalendarEventRecord,
  CalendarImportBatchRecord,
  CalendarImportSourceRecord,
  CalendarRecord,
  ExternalEventMappingRecord,
  RecurrenceExceptionRecord,
  RecurrenceRuleRecord,
} from './plannerTypes';

export type ImportClassification =
  'new' | 'unchanged' | 'updated' | 'locallyChanged' | 'cancelled' | 'conflicting' | 'duplicate';

export type ImportResolution = 'keepLocal' | 'useImported' | 'duplicate' | 'skip';
export type UnknownTimezoneResolution = 'wallClock' | 'skip';

export type IcsImportPreviewRecord = {
  key: string;
  parsed: ParsedIcsEvent;
  classification: ImportClassification;
  defaultResolution: ImportResolution;
  mapping?: ExternalEventMappingRecord;
};

export type IcsImportPreview = {
  filename?: string;
  calendarName?: string;
  sourceId?: string;
  proposedSourceLabel: string;
  proposedCalendarName: string;
  destinationCalendarId?: string;
  records: IcsImportPreviewRecord[];
  validEventCount: number;
  recurringSeriesCount: number;
  dateRange?: { start: string; end: string };
  duplicates: number;
  updates: number;
  unsupportedRecords: number;
  invalidRecords: number;
  warnings: string[];
  unresolvedTimezones: string[];
};

export type ApplyImportOptions = {
  preview: IcsImportPreview;
  destination:
    { kind: 'existing'; calendarId: string } | { kind: 'new'; name: string; color: string };
  resolutions: Record<string, ImportResolution>;
  timezoneResolutions: Record<string, UnknownTimezoneResolution>;
};

export type ImportHistory = {
  sources: CalendarImportSourceRecord[];
  batches: CalendarImportBatchRecord[];
};

type Options = { now?: () => string; createId?: () => string; notify?: () => void };

export class IcsImportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'IcsImportError';
  }
}

export class IcsRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: Options = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify =
      options.notify ?? (() => window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT)));
  }

  public async getHistory(): Promise<ImportHistory> {
    const [storedSources, batches, mappings] = await Promise.all([
      this.db.calendarImportSources.orderBy('lastImportedAt').reverse().toArray(),
      this.db.calendarImportBatches.orderBy('importedAt').reverse().toArray(),
      this.db.externalEventMappings.toArray(),
    ]);
    const [events, exceptions] = await Promise.all([
      this.db.calendarEvents.bulkGet([...new Set(mappings.map((mapping) => mapping.eventId))]),
      this.db.recurrenceExceptions.bulkGet([
        ...new Set(
          mappings.flatMap((mapping) => (mapping.exceptionId ? [mapping.exceptionId] : [])),
        ),
      ]),
    ]);
    const eventModifiedAt = new Map(
      events.flatMap((event) => (event ? [[event.id, event.modifiedAt] as const] : [])),
    );
    const exceptionModifiedAt = new Map(
      exceptions.flatMap((exception) =>
        exception ? [[exception.id, exception.modifiedAt] as const] : [],
      ),
    );
    const locallyChangedSources = new Set(
      mappings.flatMap((mapping) => {
        const modifiedAt = mapping.exceptionId
          ? exceptionModifiedAt.get(mapping.exceptionId)
          : eventModifiedAt.get(mapping.eventId);
        return modifiedAt && modifiedAt !== mapping.planiblyModifiedAtAtImport
          ? [mapping.sourceId]
          : [];
      }),
    );
    const sources = storedSources.map((source) => ({
      ...source,
      hasLocalChanges: locallyChangedSources.has(source.id),
    }));
    return { sources, batches };
  }

  public async findLikelySource(
    filename: string | undefined,
    calendarName: string | undefined,
  ): Promise<CalendarImportSourceRecord | undefined> {
    const sources = await this.db.calendarImportSources.toArray();
    return sources
      .filter(
        (source) =>
          (filename !== undefined && source.lastFilename === filename) ||
          (calendarName !== undefined && source.calendarName === calendarName),
      )
      .sort((left, right) => right.lastImportedAt.localeCompare(left.lastImportedAt))[0];
  }

  public async previewImport(
    parsed: IcsParseResult,
    options: { filename?: string; sourceId?: string; destinationCalendarId?: string } = {},
  ): Promise<IcsImportPreview> {
    const likelySource = options.sourceId
      ? await this.db.calendarImportSources.get(options.sourceId)
      : await this.findLikelySource(options.filename, parsed.calendarName);
    const sourceId = likelySource?.id;
    const mappings = sourceId
      ? await this.db.externalEventMappings.where('sourceId').equals(sourceId).toArray()
      : [];
    const mappingByKey = new Map(
      mappings.map((mapping) => [externalKey(mapping.externalUid, mapping.recurrenceKey), mapping]),
    );
    const eventIds = [...new Set(mappings.map((mapping) => mapping.eventId))];
    const events = await this.db.calendarEvents.bulkGet(eventIds);
    const eventById = new Map(
      events.flatMap((event) => (event ? [[event.id, event] as const] : [])),
    );
    const exceptionIds = mappings.flatMap((mapping) => mapping.exceptionId ?? []);
    const exceptions = await this.db.recurrenceExceptions.bulkGet(exceptionIds);
    const exceptionById = new Map(
      exceptions.flatMap((exception) => (exception ? [[exception.id, exception] as const] : [])),
    );
    const seen = new Set<string>();
    const records: IcsImportPreviewRecord[] = [];

    for (const event of parsed.events) {
      const recurrenceKey = event.recurrenceId ?? 'master';
      const key = externalKey(event.externalUid, recurrenceKey);
      const duplicate = seen.has(key);
      seen.add(key);
      const mapping = mappingByKey.get(key);
      const current = mapping ? eventById.get(mapping.eventId) : undefined;
      const currentException = mapping?.exceptionId
        ? exceptionById.get(mapping.exceptionId)
        : undefined;
      const sourceFingerprint = fingerprintParsedEvent(event);
      const localChanged = Boolean(
        mapping &&
        (mapping.targetKind === 'exception'
          ? currentException?.modifiedAt !== mapping.planiblyModifiedAtAtImport
          : current?.modifiedAt !== mapping.planiblyModifiedAtAtImport),
      );
      let classification: ImportClassification;
      if (duplicate) classification = 'duplicate';
      else if (event.status === 'CANCELLED') classification = 'cancelled';
      else if (!mapping) classification = 'new';
      else if (mapping.sourceFingerprint === sourceFingerprint) {
        classification = localChanged ? 'locallyChanged' : 'unchanged';
      } else classification = localChanged ? 'conflicting' : 'updated';
      records.push({
        key,
        parsed: event,
        classification,
        defaultResolution: defaultResolution(
          classification,
          Boolean(mapping),
          Boolean(
            event.recurrenceId &&
            parsed.events.some(
              (candidate) => candidate.externalUid === event.externalUid && !candidate.recurrenceId,
            ),
          ),
        ),
        mapping,
      });
    }

    const dates = records
      .flatMap((record) => [record.parsed.startDate, record.parsed.endDate])
      .sort();
    const unresolvedTimezones = [
      ...new Set(records.flatMap((record) => record.parsed.unresolvedTimezone ?? [])),
    ];
    const proposedSourceLabel = firstNonEmpty(
      parsed.calendarName,
      options.filename,
      likelySource?.sourceLabel,
      'Pasted ICS',
    )!;
    return {
      filename: options.filename,
      calendarName: parsed.calendarName,
      sourceId,
      proposedSourceLabel,
      proposedCalendarName: firstNonEmpty(
        parsed.calendarName,
        filenameStem(options.filename),
        'Imported',
      )!,
      destinationCalendarId: options.destinationCalendarId ?? likelySource?.destinationCalendarId,
      records,
      validEventCount: records.length,
      recurringSeriesCount: records.filter(
        (record) => record.parsed.recurrence && !record.parsed.recurrenceId,
      ).length,
      dateRange: dates.length > 0 ? { start: dates[0]!, end: dates.at(-1)! } : undefined,
      duplicates: records.filter((record) => record.classification === 'duplicate').length,
      updates: records.filter((record) => record.classification === 'updated').length,
      unsupportedRecords: parsed.unsupportedRecords,
      invalidRecords: parsed.invalidRecords,
      warnings: [...parsed.warnings, ...records.flatMap((record) => record.parsed.warnings)],
      unresolvedTimezones,
    };
  }

  public async applyImport(options: ApplyImportOptions): Promise<CalendarImportBatchRecord> {
    const { preview } = options;
    if (preview.records.length === 0)
      throw new IcsImportError('There are no valid events to import.');
    for (const timezone of preview.unresolvedTimezones) {
      if (!options.timezoneResolutions[timezone]) {
        throw new IcsImportError(`Choose how to handle timezone ${timezone}.`);
      }
    }
    const now = this.now();
    const sourceId = preview.sourceId ?? this.createId();
    const batchId = this.createId();
    const destinationCalendarId =
      options.destination.kind === 'existing' ? options.destination.calendarId : this.createId();
    let appliedCount = 0;
    let skippedCount = 0;
    const resolvedEventByUid = new Map<string, string>();

    await this.db.transaction(
      'rw',
      [
        this.db.calendars,
        this.db.calendarEvents,
        this.db.recurrenceRules,
        this.db.recurrenceExceptions,
        this.db.calendarImportSources,
        this.db.calendarImportBatches,
        this.db.externalEventMappings,
      ],
      async () => {
        if (options.destination.kind === 'new') {
          const calendars = (await this.db.calendars.toArray()).filter(
            (calendar) => calendar.deletedAt === undefined,
          );
          const calendar: CalendarRecord = {
            id: destinationCalendarId,
            name: requiredText(options.destination.name, 'Calendar name'),
            color: options.destination.color,
            order: calendars.length,
            isVisible: true,
            createdAt: now,
            modifiedAt: now,
          };
          await this.db.calendars.add(calendar);
        } else {
          const calendar = await this.db.calendars.get(destinationCalendarId);
          if (!calendar || calendar.deletedAt)
            throw new IcsImportError('Choose an active calendar.');
        }

        for (const record of preview.records.filter(
          (candidate) => !candidate.parsed.recurrenceId,
        )) {
          const resolution = options.resolutions[record.key] ?? record.defaultResolution;
          const timezoneChoice = record.parsed.unresolvedTimezone
            ? options.timezoneResolutions[record.parsed.unresolvedTimezone]
            : undefined;
          if (
            resolution === 'skip' ||
            resolution === 'keepLocal' ||
            timezoneChoice === 'skip' ||
            (record.classification === 'cancelled' && !record.mapping)
          ) {
            skippedCount += 1;
            if (record.mapping)
              resolvedEventByUid.set(record.parsed.externalUid, record.mapping.eventId);
            continue;
          }
          const eventId =
            resolution === 'duplicate' || !record.mapping
              ? this.createId()
              : record.mapping.eventId;
          if (record.classification === 'cancelled') {
            await this.softDeleteImportedEvent(eventId, now);
            appliedCount += 1;
            continue;
          }
          const existing = await this.db.calendarEvents.get(eventId);
          const event = importedEvent(record.parsed, destinationCalendarId, eventId, now, existing);
          await this.db.calendarEvents.put(event);
          await this.replaceRule(event, record.parsed.recurrence, now);
          await this.upsertExclusions(event, record.parsed, sourceId, now);
          await this.putMapping(
            record,
            sourceId,
            event.id,
            undefined,
            now,
            resolution === 'duplicate' ? `duplicate:${event.id}` : 'master',
          );
          resolvedEventByUid.set(record.parsed.externalUid, event.id);
          appliedCount += 1;
        }

        for (const record of preview.records.filter((candidate) => candidate.parsed.recurrenceId)) {
          const resolution = options.resolutions[record.key] ?? record.defaultResolution;
          const timezoneChoice = record.parsed.unresolvedTimezone
            ? options.timezoneResolutions[record.parsed.unresolvedTimezone]
            : undefined;
          if (resolution === 'skip' || resolution === 'keepLocal' || timezoneChoice === 'skip') {
            skippedCount += 1;
            continue;
          }
          const seriesEventId =
            resolvedEventByUid.get(record.parsed.externalUid) ?? record.mapping?.eventId;
          const series = seriesEventId
            ? await this.db.calendarEvents.get(seriesEventId)
            : undefined;
          if (!series || series.deletedAt) {
            skippedCount += 1;
            continue;
          }
          const exceptionId =
            resolution === 'duplicate' || !record.mapping?.exceptionId
              ? this.createId()
              : record.mapping.exceptionId;
          const exception = importedException(record.parsed, series, exceptionId, now);
          await this.db.recurrenceExceptions.put(exception);
          await this.putMapping(
            record,
            sourceId,
            series.id,
            exception.id,
            now,
            resolution === 'duplicate' ? `duplicate:${exception.id}` : record.parsed.recurrenceId!,
          );
          appliedCount += 1;
        }

        const previousSource = await this.db.calendarImportSources.get(sourceId);
        const source: CalendarImportSourceRecord = {
          id: sourceId,
          sourceLabel: preview.proposedSourceLabel,
          lastFilename: preview.filename,
          calendarName: preview.calendarName,
          destinationCalendarId,
          importedRecordCount: (previousSource?.importedRecordCount ?? 0) + appliedCount,
          hasLocalChanges: preview.records.some(
            (record) =>
              record.classification === 'locallyChanged' || record.classification === 'conflicting',
          ),
          createdAt: previousSource?.createdAt ?? now,
          lastImportedAt: now,
        };
        const batch = createBatch(
          batchId,
          sourceId,
          destinationCalendarId,
          preview,
          appliedCount,
          skippedCount,
          now,
        );
        await this.db.calendarImportSources.put(source);
        await this.db.calendarImportBatches.add(batch);
      },
    );
    this.notify();
    return (await this.db.calendarImportBatches.get(batchId))!;
  }

  public async removeHistoryBatch(id: string): Promise<void> {
    const batch = await this.db.calendarImportBatches.get(id);
    if (!batch) throw new IcsImportError('Import history record not found.');
    await this.db.calendarImportBatches.delete(id);
    this.notify();
  }

  public async deleteImportedEvents(sourceId: string, confirmed: boolean): Promise<number> {
    if (!confirmed) throw new IcsImportError('Confirm deletion of imported events.');
    const mappings = await this.db.externalEventMappings
      .where('sourceId')
      .equals(sourceId)
      .toArray();
    const eventIds = [...new Set(mappings.map((mapping) => mapping.eventId))];
    const now = this.now();
    const groupId = this.createId();
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        for (const id of eventIds) {
          const event = await this.db.calendarEvents.get(id);
          if (!event || event.deletedAt) continue;
          await this.db.calendarEvents.update(id, {
            deletedAt: now,
            deletionGroupId: groupId,
            modifiedAt: now,
          });
          await this.db.recurrenceExceptions
            .where('seriesEventId')
            .equals(id)
            .filter((exception) => exception.deletedAt === undefined)
            .modify({ deletedAt: now, deletionGroupId: groupId, modifiedAt: now });
        }
      },
    );
    this.notify();
    return eventIds.length;
  }

  private async replaceRule(
    event: CalendarEventRecord,
    definition: ParsedIcsEvent['recurrence'],
    now: string,
  ): Promise<void> {
    const existing = await this.db.recurrenceRules.where('eventId').equals(event.id).first();
    if (!definition) {
      if (existing) await this.db.recurrenceRules.delete(existing.id);
      return;
    }
    const rule: RecurrenceRuleRecord = {
      ...definition,
      id: existing?.id ?? this.createId(),
      eventId: event.id,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    await this.db.recurrenceRules.put(rule);
  }

  private async upsertExclusions(
    event: CalendarEventRecord,
    parsed: ParsedIcsEvent,
    sourceId: string,
    now: string,
  ): Promise<void> {
    for (const date of parsed.exclusionDates) {
      const existing = await this.db.recurrenceExceptions
        .where('[seriesEventId+originalStartDate]')
        .equals([event.id, date])
        .first();
      const exception: RecurrenceExceptionRecord = {
        id: existing?.id ?? this.createId(),
        seriesEventId: event.id,
        originalStartDate: date,
        kind: 'cancelled',
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
      };
      await this.db.recurrenceExceptions.put(exception);
      const key = externalKey(parsed.externalUid, date);
      const mapping = await this.db.externalEventMappings
        .where('[sourceId+externalUid+recurrenceKey]')
        .equals([sourceId, parsed.externalUid, date])
        .first();
      await this.db.externalEventMappings.put({
        id: mapping?.id ?? this.createId(),
        sourceId,
        externalUid: parsed.externalUid,
        recurrenceKey: date,
        targetKind: 'exception',
        eventId: event.id,
        exceptionId: exception.id,
        sourceFingerprint: fingerprintText(`${key}|cancelled`),
        planiblyModifiedAtAtImport: now,
        sequence: parsed.sequence,
        externalLastModified: parsed.lastModified,
        sourceTimezone: parsed.sourceTimezone,
        importedAt: mapping?.importedAt ?? now,
        lastImportedAt: now,
      });
    }
  }

  private async putMapping(
    record: IcsImportPreviewRecord,
    sourceId: string,
    eventId: string,
    exceptionId: string | undefined,
    now: string,
    recurrenceKey: string,
  ): Promise<void> {
    const existing = recurrenceKey.startsWith('duplicate:')
      ? undefined
      : await this.db.externalEventMappings
          .where('[sourceId+externalUid+recurrenceKey]')
          .equals([sourceId, record.parsed.externalUid, recurrenceKey])
          .first();
    const currentEvent = await this.db.calendarEvents.get(eventId);
    const currentException = exceptionId
      ? await this.db.recurrenceExceptions.get(exceptionId)
      : undefined;
    const mapping: ExternalEventMappingRecord = {
      id: existing?.id ?? this.createId(),
      sourceId,
      externalUid: record.parsed.externalUid,
      recurrenceKey,
      targetKind: exceptionId ? 'exception' : 'event',
      eventId,
      exceptionId,
      sourceFingerprint: fingerprintParsedEvent(record.parsed),
      planiblyModifiedAtAtImport: currentException?.modifiedAt ?? currentEvent?.modifiedAt ?? now,
      sequence: record.parsed.sequence,
      externalLastModified: record.parsed.lastModified,
      sourceTimezone: record.parsed.sourceTimezone,
      importedAt: existing?.importedAt ?? now,
      lastImportedAt: now,
    };
    await this.db.externalEventMappings.put(mapping);
  }

  private async softDeleteImportedEvent(eventId: string, now: string): Promise<void> {
    const event = await this.db.calendarEvents.get(eventId);
    if (!event || event.deletedAt) return;
    const groupId = this.createId();
    await this.db.calendarEvents.update(eventId, {
      deletedAt: now,
      deletionGroupId: groupId,
      modifiedAt: now,
    });
    await this.db.recurrenceExceptions
      .where('seriesEventId')
      .equals(eventId)
      .filter((exception) => exception.deletedAt === undefined)
      .modify({ deletedAt: now, deletionGroupId: groupId, modifiedAt: now });
  }
}

function externalKey(uid: string, recurrenceKey: string): string {
  return `${uid}\u0000${recurrenceKey}`;
}

function defaultResolution(
  classification: ImportClassification,
  hasMapping: boolean,
  hasImportedSeries = false,
): ImportResolution {
  if (classification === 'new') return 'useImported';
  if (classification === 'updated') return 'useImported';
  if (classification === 'cancelled') {
    if (hasMapping) return 'keepLocal';
    return hasImportedSeries ? 'useImported' : 'skip';
  }
  if (classification === 'conflicting' || classification === 'locallyChanged') return 'keepLocal';
  return 'skip';
}

function filenameStem(filename: string | undefined): string | undefined {
  const stem = filename?.replace(/\.ics$/i, '').trim();
  return stem === '' ? undefined : stem;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value !== undefined && value !== '');
}

function requiredText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new IcsImportError(`${label} is required.`);
  return result;
}

function importedEvent(
  parsed: ParsedIcsEvent,
  calendarId: string,
  id: string,
  now: string,
  existing?: CalendarEventRecord,
): CalendarEventRecord {
  const record: CalendarEventRecord = {
    id,
    calendarId,
    title: parsed.title,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    allDay: parsed.allDay,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    location: parsed.location,
    notes: parsed.description,
    createdAt: existing?.createdAt ?? parsed.createdAt ?? now,
    modifiedAt: now,
  };
  validateCalendarEvent(record);
  return record;
}

function importedException(
  parsed: ParsedIcsEvent,
  series: CalendarEventRecord,
  id: string,
  now: string,
): RecurrenceExceptionRecord {
  if (!parsed.recurrenceId) throw new IcsImportError('A recurring override needs RECURRENCE-ID.');
  return {
    id,
    seriesEventId: series.id,
    originalStartDate: parsed.recurrenceId,
    kind: parsed.status === 'CANCELLED' ? 'cancelled' : 'override',
    calendarId: parsed.status === 'CANCELLED' ? undefined : parsedCalendarId(series),
    title: parsed.status === 'CANCELLED' ? undefined : parsed.title,
    startDate: parsed.status === 'CANCELLED' ? undefined : parsed.startDate,
    endDate: parsed.status === 'CANCELLED' ? undefined : parsed.endDate,
    allDay: parsed.status === 'CANCELLED' ? undefined : parsed.allDay,
    startTime: parsed.status === 'CANCELLED' ? undefined : (parsed.startTime ?? null),
    endTime: parsed.status === 'CANCELLED' ? undefined : (parsed.endTime ?? null),
    location: parsed.status === 'CANCELLED' ? undefined : (parsed.location ?? null),
    notes: parsed.status === 'CANCELLED' ? undefined : (parsed.description ?? null),
    createdAt: now,
    modifiedAt: now,
  };
}

function parsedCalendarId(series: CalendarEventRecord): string {
  return series.calendarId;
}

export function fingerprintParsedEvent(event: ParsedIcsEvent): string {
  return fingerprintText(
    JSON.stringify({
      uid: event.externalUid,
      recurrenceId: event.recurrenceId,
      title: event.title,
      description: event.description,
      location: event.location,
      categories: event.categories,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      startTime: event.startTime,
      endTime: event.endTime,
      status: event.status,
      sequence: event.sequence,
      recurrence: event.recurrence,
      exclusionDates: event.exclusionDates,
      sourceTimezone: event.sourceTimezone,
    }),
  );
}

function fingerprintText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createBatch(
  id: string,
  sourceId: string,
  destinationCalendarId: string,
  preview: IcsImportPreview,
  appliedCount: number,
  skippedCount: number,
  now: string,
): CalendarImportBatchRecord {
  return {
    id,
    sourceId,
    filename: preview.filename,
    calendarName: preview.calendarName,
    destinationCalendarId,
    importedAt: now,
    validEventCount: preview.validEventCount,
    recurringSeriesCount: preview.recurringSeriesCount,
    newCount: preview.records.filter((record) => record.classification === 'new').length,
    unchangedCount: preview.records.filter((record) => record.classification === 'unchanged')
      .length,
    updatedCount: preview.records.filter((record) => record.classification === 'updated').length,
    conflictCount: preview.records.filter(
      (record) =>
        record.classification === 'conflicting' || record.classification === 'locallyChanged',
    ).length,
    cancelledCount: preview.records.filter((record) => record.classification === 'cancelled')
      .length,
    skippedCount: Math.max(skippedCount, preview.validEventCount - appliedCount),
    warningCount: preview.warnings.length,
  };
}
