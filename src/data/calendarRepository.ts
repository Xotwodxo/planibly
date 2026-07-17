import { CalendarValidationError, validateCalendarEvent } from './calendar';
import { database, type PlaniblyDatabase } from './database';
import { addCalendarDays } from './planning';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import { isValidEventTemplateRecord, occurrencePosition, validateRecurrence } from './recurrence';
import {
  DEFAULT_CALENDAR_ID,
  type CalendarEventRecord,
  type CalendarOccurrence,
  type CalendarRecord,
  type DeletionReceipt,
  type EventTemplateRecord,
  type RecurrenceDefinition,
  type RecurrenceExceptionRecord,
  type RecurrenceRuleRecord,
} from './plannerTypes';

export type CalendarEventInput = Omit<
  CalendarEventRecord,
  'id' | 'createdAt' | 'modifiedAt' | 'deletedAt' | 'deletionGroupId'
>;

export type RecurringEditScope = 'occurrence' | 'future' | 'series';
export type RecurringDeleteScope = RecurringEditScope;
export type EventTemplateInput = Pick<
  EventTemplateRecord,
  | 'name'
  | 'title'
  | 'calendarId'
  | 'allDay'
  | 'startTime'
  | 'endTime'
  | 'suggestedDurationMinutes'
  | 'location'
  | 'notes'
  | 'recurrence'
>;

type Options = { now?: () => string; createId?: () => string; notify?: () => void };
const active = <T extends { deletedAt?: string }>(record: T) => record.deletedAt === undefined;
const byOrder = <T extends { order: number }>(left: T, right: T) => left.order - right.order;
function changed() {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

function daysBetween(left: string, right: string): number {
  const parts = (value: string) => value.split('-').map(Number) as [number, number, number];
  const [leftYear, leftMonth, leftDay] = parts(left);
  const [rightYear, rightMonth, rightDay] = parts(right);
  return Math.round(
    (Date.UTC(rightYear, rightMonth - 1, rightDay) - Date.UTC(leftYear, leftMonth - 1, leftDay)) /
      86_400_000,
  );
}

function weekday(value: string): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function alignDefinitionToStart(
  definition: RecurrenceDefinition,
  previousStart: string,
  nextStart: string,
): RecurrenceDefinition {
  const shift = daysBetween(previousStart, nextStart);
  const [year, month, day] = nextStart.split('-').map(Number) as [number, number, number];
  const next: RecurrenceDefinition = {
    ...definition,
    weekdays: definition.weekdays ? [...definition.weekdays] : undefined,
    endDate:
      definition.endMode === 'until' && definition.endDate
        ? addCalendarDays(definition.endDate, shift)
        : definition.endDate,
  };
  if (definition.frequency === 'weekly') {
    const weekdayShift = (((weekday(nextStart) - weekday(previousStart)) % 7) + 7) % 7;
    next.weekdays = (definition.weekdays ?? []).map((value) => (value + weekdayShift) % 7);
  } else if (definition.frequency === 'monthlyDay') {
    next.monthDay = day;
  } else if (definition.frequency === 'monthlyOrdinal') {
    next.ordinalWeekday = weekday(nextStart);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    next.ordinal = day + 7 > lastDay ? -1 : (Math.ceil(day / 7) as 1 | 2 | 3 | 4);
  } else if (definition.frequency === 'yearly') {
    next.yearlyMonth = month;
    next.yearlyDay = day;
  }
  return next;
}

function remainingDefinition(
  rule: RecurrenceRuleRecord,
  splitPosition: number,
): RecurrenceDefinition {
  if (rule.endMode !== 'count') return { ...rule };
  return {
    ...rule,
    occurrenceCount: Math.max(1, rule.occurrenceCount! - splitPosition + 1),
  };
}

function sameDefinition(left: RecurrenceDefinition, right: RecurrenceDefinition): boolean {
  return (
    JSON.stringify({
      frequency: left.frequency,
      interval: left.interval,
      weekdays: left.weekdays,
      monthDay: left.monthDay,
      ordinal: left.ordinal,
      ordinalWeekday: left.ordinalWeekday,
      yearlyMonth: left.yearlyMonth,
      yearlyDay: left.yearlyDay,
      endMode: left.endMode,
      endDate: left.endDate,
      occurrenceCount: left.occurrenceCount,
    }) ===
    JSON.stringify({
      frequency: right.frequency,
      interval: right.interval,
      weekdays: right.weekdays,
      monthDay: right.monthDay,
      ordinal: right.ordinal,
      ordinalWeekday: right.ordinalWeekday,
      yearlyMonth: right.yearlyMonth,
      yearlyDay: right.yearlyDay,
      endMode: right.endMode,
      endDate: right.endDate,
      occurrenceCount: right.occurrenceCount,
    })
  );
}

function addMinutesToTime(value: string, minutes: number): string | undefined {
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  const total = hour * 60 + minute + minutes;
  if (total > 24 * 60 - 1) return undefined;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export class CalendarRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;
  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: Options = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? changed;
  }

  async createCalendar(name: string, color: string): Promise<CalendarRecord> {
    if (!name.trim()) throw new CalendarValidationError('Enter a calendar name.');
    const now = this.now();
    const activeCalendars = (await this.db.calendars.toArray()).filter(active);
    const record: CalendarRecord = {
      id: this.createId(),
      name: name.trim(),
      color,
      order: activeCalendars.length,
      isVisible: true,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.calendars.add(record);
    this.notify();
    return record;
  }
  async renameCalendar(id: string, name: string) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { name });
  }
  async recolorCalendar(id: string, color: string) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { color });
  }
  async setCalendarVisible(id: string, isVisible: boolean) {
    const calendar = await this.requireCalendar(id);
    await this.updateCalendar(calendar, { isVisible });
  }
  private async updateCalendar(
    calendar: CalendarRecord,
    patch: Partial<Pick<CalendarRecord, 'name' | 'color' | 'isVisible'>>,
  ) {
    if (patch.name !== undefined && !patch.name.trim())
      throw new CalendarValidationError('Enter a calendar name.');
    const update = { ...patch, modifiedAt: this.now() };
    if (patch.name !== undefined) update.name = patch.name.trim();
    await this.db.calendars.update(calendar.id, update);
    this.notify();
  }
  async reorderCalendar(id: string, direction: -1 | 1) {
    const records = (await this.db.calendars.toArray())
      .filter(active)
      .sort((a, b) => a.order - b.order);
    const index = records.findIndex((c) => c.id === id);
    const other = records[index + direction];
    if (!other) return;
    const now = this.now();
    await this.db.transaction('rw', this.db.calendars, () =>
      Promise.all([
        this.db.calendars.update(id, { order: other.order, modifiedAt: now }),
        this.db.calendars.update(other.id, { order: records[index]!.order, modifiedAt: now }),
      ]),
    );
    this.notify();
  }
  async saveEvent(input: CalendarEventInput, id?: string): Promise<CalendarEventRecord> {
    validateCalendarEvent(input);
    await this.requireCalendar(input.calendarId);
    const now = this.now();
    const existing = id ? await this.db.calendarEvents.get(id) : undefined;
    const record: CalendarEventRecord = {
      ...input,
      id: id ?? this.createId(),
      title: input.title.trim(),
      location: optionalText(input.location),
      notes: optionalText(input.notes),
      startTime: input.allDay ? undefined : input.startTime,
      endTime: input.allDay ? undefined : input.endTime,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    await this.db.calendarEvents.put(record);
    this.notify();
    return record;
  }
  async saveEventWithRecurrence(
    input: CalendarEventInput,
    recurrence?: RecurrenceDefinition,
    id?: string,
  ): Promise<CalendarEventRecord> {
    validateCalendarEvent(input);
    await this.requireCalendar(input.calendarId);
    const normalizedRecurrence = recurrence
      ? validateRecurrence(recurrence, input.startDate)
      : undefined;
    const now = this.now();
    const existing = id ? await this.db.calendarEvents.get(id) : undefined;
    const eventId = id ?? this.createId();
    const record = this.eventRecord(input, eventId, existing?.createdAt ?? now, now);
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendarEvents.put(record);
        const currentRule = await this.db.recurrenceRules.where('eventId').equals(eventId).first();
        if (normalizedRecurrence) {
          await this.db.recurrenceRules.put({
            ...normalizedRecurrence,
            id: currentRule?.id ?? this.createId(),
            eventId,
            createdAt: currentRule?.createdAt ?? now,
            modifiedAt: now,
          });
        } else if (currentRule) {
          await this.db.recurrenceRules.delete(currentRule.id);
          await this.db.recurrenceExceptions.where('seriesEventId').equals(eventId).delete();
        }
      },
    );
    this.notify();
    return record;
  }

  async editRecurringOccurrence(
    occurrence: CalendarOccurrence,
    input: CalendarEventInput,
    recurrence: RecurrenceDefinition | undefined,
    scope: RecurringEditScope,
  ): Promise<CalendarEventRecord> {
    const event = await this.requireEvent(occurrence.sourceEventId);
    const rule = await this.requireRule(event.id);
    validateCalendarEvent(input);
    await this.requireCalendar(input.calendarId);
    if (scope === 'occurrence') {
      await this.putOverride(event, occurrence.originalStartDate, input);
      this.notify();
      return this.eventRecord(input, event.id, event.createdAt, this.now());
    }
    if (scope === 'series') {
      return this.editEntireSeries(event, rule, occurrence, input, recurrence);
    }
    return this.splitSeries(event, rule, occurrence, input, recurrence);
  }

  async deleteRecurringOccurrence(
    occurrence: CalendarOccurrence,
    scope: RecurringDeleteScope,
  ): Promise<DeletionReceipt> {
    const event = await this.requireEvent(occurrence.sourceEventId);
    const rule = await this.requireRule(event.id);
    if (scope === 'series') return this.deleteEvent(event.id);
    if (scope === 'occurrence') {
      const now = this.now();
      const groupId = this.createId();
      const existing = await this.db.recurrenceExceptions
        .where('[seriesEventId+originalStartDate]')
        .equals([event.id, occurrence.originalStartDate])
        .first();
      const exception: RecurrenceExceptionRecord = {
        id: existing?.id ?? this.createId(),
        seriesEventId: event.id,
        originalStartDate: occurrence.originalStartDate,
        kind: 'cancelled',
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
        deletionGroupId: groupId,
      };
      await this.db.recurrenceExceptions.put(exception);
      this.notify();
      return {
        groupId,
        kind: 'occurrence',
        entityId: occurrence.id,
        label: occurrence.title,
        deletedAt: now,
        undoMessage: `${occurrence.title} occurrence removed.`,
        calendarUndo: {
          createdExceptionId: exception.id,
          removedExceptions: existing ? [existing] : undefined,
        },
      };
    }
    const position = occurrencePosition(event, rule, occurrence.originalStartDate);
    if (!position) throw new CalendarValidationError('Occurrence is unavailable.');
    if (position === 1) return this.deleteEvent(event.id);
    const now = this.now();
    const groupId = this.createId();
    const futureExceptions = (
      await this.db.recurrenceExceptions.where('seriesEventId').equals(event.id).toArray()
    ).filter(
      (exception) =>
        !exception.deletedAt && exception.originalStartDate >= occurrence.originalStartDate,
    );
    const shortened: RecurrenceRuleRecord = {
      ...rule,
      endMode: 'count',
      occurrenceCount: position - 1,
      endDate: undefined,
      modifiedAt: now,
    };
    await this.db.transaction(
      'rw',
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.recurrenceRules.put(shortened);
        await Promise.all(
          futureExceptions.map((exception) =>
            this.db.recurrenceExceptions.update(exception.id, {
              deletedAt: now,
              deletionGroupId: groupId,
              modifiedAt: now,
            }),
          ),
        );
      },
    );
    this.notify();
    return {
      groupId,
      kind: 'occurrence',
      entityId: occurrence.id,
      label: occurrence.title,
      deletedAt: now,
      undoMessage: `${occurrence.title} and future occurrences removed.`,
      calendarUndo: { previousRule: rule, removedExceptions: futureExceptions },
    };
  }
  async duplicateEvent(id: string) {
    const event = await this.requireEvent(id);
    return this.saveEvent({
      calendarId: event.calendarId,
      title: `${event.title} copy`,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      notes: event.notes,
    });
  }
  async deleteEvent(id: string): Promise<DeletionReceipt> {
    const event = await this.requireEvent(id);
    const deletedAt = this.now(),
      groupId = this.createId();
    const exceptions = await this.db.recurrenceExceptions
      .where('seriesEventId')
      .equals(id)
      .toArray();
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendarEvents.update(id, {
          deletedAt,
          deletionGroupId: groupId,
          modifiedAt: deletedAt,
        });
        await Promise.all(
          exceptions.filter(active).map((exception) =>
            this.db.recurrenceExceptions.update(exception.id, {
              deletedAt,
              deletionGroupId: groupId,
              modifiedAt: deletedAt,
            }),
          ),
        );
      },
    );
    this.notify();
    return { groupId, kind: 'event', entityId: id, label: event.title, deletedAt };
  }
  async restoreEvent(id: string, calendarId?: string) {
    const event = await this.db.calendarEvents.get(id);
    if (!event?.deletedAt) throw new CalendarValidationError('Event is unavailable.');
    try {
      await this.requireCalendar(calendarId ?? event.calendarId);
    } catch {
      throw new CalendarValidationError('Choose an active calendar before restoring this event.');
    }
    const now = this.now();
    const groupId = event.deletionGroupId;
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendarEvents.update(id, {
          calendarId: calendarId ?? event.calendarId,
          deletedAt: undefined,
          deletionGroupId: undefined,
          modifiedAt: now,
        });
        if (groupId) {
          const exceptions = await this.db.recurrenceExceptions
            .where('deletionGroupId')
            .equals(groupId)
            .toArray();
          await Promise.all(
            exceptions
              .filter((exception) => exception.seriesEventId === id)
              .map((exception) =>
                this.db.recurrenceExceptions.update(exception.id, {
                  deletedAt: undefined,
                  deletionGroupId: undefined,
                  modifiedAt: now,
                }),
              ),
          );
        }
      },
    );
    this.notify();
  }
  async permanentlyDeleteEvent(id: string) {
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.recurrenceExceptions.where('seriesEventId').equals(id).delete();
        await this.db.recurrenceRules.where('eventId').equals(id).delete();
        await this.db.calendarEvents.delete(id);
      },
    );
    this.notify();
  }
  async deleteCalendar(
    id: string,
    mode: 'deleteEvents' | 'moveEvents',
    destinationId?: string,
  ): Promise<DeletionReceipt> {
    const calendar = await this.requireCalendar(id);
    if (mode === 'moveEvents') {
      if (!destinationId || destinationId === id)
        throw new CalendarValidationError('Choose another active calendar.');
      await this.requireCalendar(destinationId);
    }
    const deletedAt = this.now(),
      groupId = this.createId();
    const events = (await this.db.calendarEvents.where('calendarId').equals(id).toArray()).filter(
      active,
    );
    const eventIds = new Set(events.map((event) => event.id));
    const allExceptions = (await this.db.recurrenceExceptions.toArray()).filter(active);
    const seriesExceptions = allExceptions.filter((exception) =>
      eventIds.has(exception.seriesEventId),
    );
    const exceptions = allExceptions.filter(
      (exception) => eventIds.has(exception.seriesEventId) || exception.calendarId === id,
    );
    await this.db.transaction(
      'rw',
      this.db.calendars,
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendars.update(id, {
          deletedAt,
          deletionGroupId: groupId,
          modifiedAt: deletedAt,
        });
        if (mode === 'moveEvents')
          await Promise.all([
            this.db.calendarEvents.bulkPut(
              events.map((event) => ({
                ...event,
                calendarId: destinationId!,
                modifiedAt: deletedAt,
              })),
            ),
            ...exceptions
              .filter((exception) => exception.calendarId === id)
              .map((exception) =>
                this.db.recurrenceExceptions.update(exception.id, {
                  calendarId: destinationId!,
                  modifiedAt: deletedAt,
                }),
              ),
          ]);
        else {
          await this.db.calendarEvents.bulkPut(
            events.map((event) => ({
              ...event,
              deletedAt,
              deletionGroupId: groupId,
              modifiedAt: deletedAt,
            })),
          );
          await Promise.all(
            seriesExceptions.map((exception) =>
              this.db.recurrenceExceptions.update(exception.id, {
                deletedAt,
                deletionGroupId: groupId,
                modifiedAt: deletedAt,
              }),
            ),
          );
        }
      },
    );
    this.notify();
    return {
      groupId,
      kind: 'calendar',
      entityId: id,
      label: calendar.name,
      deletedAt,
      movedEventIds: mode === 'moveEvents' ? events.map((event) => event.id) : undefined,
      movedExceptionIds:
        mode === 'moveEvents'
          ? exceptions
              .filter((exception) => exception.calendarId === id)
              .map((exception) => exception.id)
          : undefined,
    };
  }
  async restoreCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar?.deletedAt) throw new CalendarValidationError('Calendar is unavailable.');
    const groupId = calendar.deletionGroupId,
      now = this.now();
    await this.db.transaction(
      'rw',
      this.db.calendars,
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendars.update(id, {
          deletedAt: undefined,
          deletionGroupId: undefined,
          modifiedAt: now,
        });
        if (groupId) {
          const events = await this.db.calendarEvents
            .where('deletionGroupId')
            .equals(groupId)
            .toArray();
          await Promise.all(
            events
              .filter((event) => event.calendarId === id)
              .map((event) =>
                this.db.calendarEvents.update(event.id, {
                  deletedAt: undefined,
                  deletionGroupId: undefined,
                  modifiedAt: now,
                }),
              ),
          );
          const exceptions = await this.db.recurrenceExceptions
            .where('deletionGroupId')
            .equals(groupId)
            .toArray();
          await Promise.all(
            exceptions.map((exception) =>
              this.db.recurrenceExceptions.update(exception.id, {
                deletedAt: undefined,
                deletionGroupId: undefined,
                modifiedAt: now,
              }),
            ),
          );
        }
      },
    );
    this.notify();
  }
  async restoreDeletionGroup(groupId: string, receipt?: DeletionReceipt) {
    if (receipt?.kind === 'template') {
      await this.restoreTemplate(receipt.entityId);
      return;
    }
    if (receipt?.kind === 'occurrence' && receipt.calendarUndo) {
      const now = this.now();
      await this.db.transaction(
        'rw',
        this.db.recurrenceRules,
        this.db.recurrenceExceptions,
        async () => {
          if (receipt.calendarUndo?.createdExceptionId) {
            await this.db.recurrenceExceptions.delete(receipt.calendarUndo.createdExceptionId);
          }
          if (receipt.calendarUndo?.previousRule) {
            await this.db.recurrenceRules.put({
              ...receipt.calendarUndo.previousRule,
              modifiedAt: now,
            });
          }
          if (receipt.calendarUndo?.removedExceptions?.length) {
            await this.db.recurrenceExceptions.bulkPut(
              receipt.calendarUndo.removedExceptions.map((exception) => ({
                ...exception,
                deletedAt: undefined,
                deletionGroupId: undefined,
                modifiedAt: now,
              })),
            );
          }
        },
      );
      this.notify();
      return;
    }
    const calendars = await this.db.calendars.where('deletionGroupId').equals(groupId).toArray();
    const events = await this.db.calendarEvents.where('deletionGroupId').equals(groupId).toArray();
    const exceptions = await this.db.recurrenceExceptions
      .where('deletionGroupId')
      .equals(groupId)
      .toArray();
    if (!calendars.length && !events.length && !exceptions.length)
      throw new CalendarValidationError('This deletion can no longer be undone.');
    const now = this.now();
    await this.db.transaction(
      'rw',
      this.db.calendars,
      this.db.calendarEvents,
      this.db.recurrenceExceptions,
      async () => {
        await Promise.all(
          calendars.map((calendar) =>
            this.db.calendars.update(calendar.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
        );
        await Promise.all(
          exceptions.map((exception) =>
            this.db.recurrenceExceptions.update(exception.id, {
              deletedAt: undefined,
              deletionGroupId: undefined,
              modifiedAt: now,
            }),
          ),
        );
        const activeIds = new Set(
          (await this.db.calendars.toArray()).filter(active).map((calendar) => calendar.id),
        );
        await Promise.all(
          events
            .filter((event) => activeIds.has(event.calendarId))
            .map((event) =>
              this.db.calendarEvents.update(event.id, {
                deletedAt: undefined,
                deletionGroupId: undefined,
                modifiedAt: now,
              }),
            ),
        );
        if (receipt?.kind === 'calendar' && receipt.movedEventIds?.length) {
          const moved = await this.db.calendarEvents.bulkGet(receipt.movedEventIds);
          await this.db.calendarEvents.bulkPut(
            moved
              .filter((event): event is CalendarEventRecord => Boolean(event && active(event)))
              .map((event) => ({ ...event, calendarId: receipt.entityId, modifiedAt: now })),
          );
        }
        if (receipt?.kind === 'calendar' && receipt.movedExceptionIds?.length) {
          await Promise.all(
            receipt.movedExceptionIds.map((id) =>
              this.db.recurrenceExceptions.update(id, {
                calendarId: receipt.entityId,
                modifiedAt: now,
              }),
            ),
          );
        }
      },
    );
    this.notify();
  }
  async permanentlyDeleteCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar?.deletedAt) throw new CalendarValidationError('Calendar is unavailable.');
    if (calendar.isProtected)
      throw new CalendarValidationError(
        'The protected default calendar cannot be permanently deleted.',
      );
    const events = await this.db.calendarEvents.where('calendarId').equals(id).toArray();
    const eventIds = events.map((event) => event.id);
    const eventIdSet = new Set(eventIds);
    const externalOverrides = (await this.db.recurrenceExceptions.toArray()).filter(
      (exception) =>
        active(exception) &&
        exception.calendarId === id &&
        !eventIdSet.has(exception.seriesEventId),
    );
    await this.db.transaction(
      'rw',
      this.db.calendars,
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        for (const eventId of eventIds) {
          await this.db.recurrenceExceptions.where('seriesEventId').equals(eventId).delete();
          await this.db.recurrenceRules.where('eventId').equals(eventId).delete();
        }
        await Promise.all(
          externalOverrides.map((exception) =>
            this.db.recurrenceExceptions.update(exception.id, {
              kind: 'cancelled',
              calendarId: undefined,
              title: undefined,
              startDate: undefined,
              endDate: undefined,
              allDay: undefined,
              startTime: undefined,
              endTime: undefined,
              location: undefined,
              notes: undefined,
              modifiedAt: this.now(),
            }),
          ),
        );
        await this.db.calendarEvents.bulkDelete(events.map((event) => event.id));
        await this.db.calendars.delete(id);
      },
    );
    this.notify();
  }
  async emptyRecentlyDeleted() {
    const calendars = (await this.db.calendars.toArray()).filter(
      (calendar) => calendar.deletedAt && !calendar.isProtected,
    );
    const deletedCalendarIds = new Set(calendars.map((calendar) => calendar.id));
    const allEvents = await this.db.calendarEvents.toArray();
    const eventIds = new Set(
      allEvents
        .filter(
          (event) => event.deletedAt !== undefined || deletedCalendarIds.has(event.calendarId),
        )
        .map((event) => event.id),
    );
    const templates = (await this.db.eventTemplates.toArray()).filter(
      (template) => template.deletedAt,
    );
    await this.db.transaction(
      'rw',
      this.db.calendars,
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      this.db.eventTemplates,
      async () => {
        for (const eventId of eventIds) {
          await this.db.recurrenceExceptions.where('seriesEventId').equals(eventId).delete();
          await this.db.recurrenceRules.where('eventId').equals(eventId).delete();
        }
        const externalOverrides = (await this.db.recurrenceExceptions.toArray()).filter(
          (exception) =>
            active(exception) &&
            exception.calendarId !== undefined &&
            deletedCalendarIds.has(exception.calendarId) &&
            !eventIds.has(exception.seriesEventId),
        );
        await Promise.all(
          externalOverrides.map((exception) =>
            this.db.recurrenceExceptions.update(exception.id, {
              kind: 'cancelled',
              calendarId: undefined,
              title: undefined,
              startDate: undefined,
              endDate: undefined,
              allDay: undefined,
              startTime: undefined,
              endTime: undefined,
              location: undefined,
              notes: undefined,
              modifiedAt: this.now(),
            }),
          ),
        );
        await this.db.calendarEvents.bulkDelete([...eventIds]);
        await this.db.calendars.bulkDelete(calendars.map((calendar) => calendar.id));
        await this.db.eventTemplates.bulkDelete(templates.map((template) => template.id));
      },
    );
    this.notify();
  }

  async saveTemplate(input: EventTemplateInput, id?: string): Promise<EventTemplateRecord> {
    const name = input.name.trim();
    const title = input.title.trim();
    if (!name || name.length > 80) throw new CalendarValidationError('Enter a template name.');
    if (!title || title.length > 160) throw new CalendarValidationError('Enter an event title.');
    if (input.calendarId) await this.requireCalendar(input.calendarId);
    if (
      input.suggestedDurationMinutes !== undefined &&
      (!Number.isInteger(input.suggestedDurationMinutes) ||
        input.suggestedDurationMinutes < 1 ||
        input.suggestedDurationMinutes > 1_440)
    ) {
      throw new CalendarValidationError('Suggested duration must be between 1 and 1,440 minutes.');
    }
    const now = this.now();
    const existing = id ? await this.db.eventTemplates.get(id) : undefined;
    if (id && (!existing || !active(existing)))
      throw new CalendarValidationError('Template is unavailable.');
    const records = (await this.db.eventTemplates.toArray()).filter(active);
    const record: EventTemplateRecord = {
      ...input,
      id: id ?? this.createId(),
      name,
      title,
      location: optionalText(input.location),
      notes: optionalText(input.notes),
      order: existing?.order ?? records.length,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    if (!isValidEventTemplateRecord(record)) {
      throw new CalendarValidationError('Choose valid template times and repeat details.');
    }
    await this.db.eventTemplates.put(record);
    this.notify();
    return record;
  }

  async duplicateTemplate(id: string): Promise<EventTemplateRecord> {
    const template = await this.requireTemplate(id);
    return this.saveTemplate({ ...template, name: `${template.name} copy` });
  }

  async reorderTemplate(id: string, direction: -1 | 1): Promise<void> {
    const records = (await this.db.eventTemplates.toArray()).filter(active).sort(byOrder);
    const index = records.findIndex((template) => template.id === id);
    const other = records[index + direction];
    if (!other) return;
    const now = this.now();
    await this.db.transaction('rw', this.db.eventTemplates, () =>
      Promise.all([
        this.db.eventTemplates.update(id, { order: other.order, modifiedAt: now }),
        this.db.eventTemplates.update(other.id, { order: records[index]!.order, modifiedAt: now }),
      ]),
    );
    this.notify();
  }

  async deleteTemplate(id: string): Promise<DeletionReceipt> {
    const template = await this.requireTemplate(id);
    const deletedAt = this.now();
    const groupId = this.createId();
    await this.db.eventTemplates.update(id, {
      deletedAt,
      deletionGroupId: groupId,
      modifiedAt: deletedAt,
    });
    this.notify();
    return { groupId, kind: 'template', entityId: id, label: template.name, deletedAt };
  }

  async restoreTemplate(id: string): Promise<void> {
    const template = await this.db.eventTemplates.get(id);
    if (!template?.deletedAt) throw new CalendarValidationError('Template is unavailable.');
    await this.db.eventTemplates.update(id, {
      deletedAt: undefined,
      deletionGroupId: undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  async permanentlyDeleteTemplate(id: string): Promise<void> {
    const template = await this.db.eventTemplates.get(id);
    if (!template?.deletedAt) throw new CalendarValidationError('Template is unavailable.');
    await this.db.eventTemplates.delete(id);
    this.notify();
  }

  async resolveTemplate(
    id: string,
    localDate: string,
  ): Promise<{ input: CalendarEventInput; recurrence?: RecurrenceDefinition; fellBack: boolean }> {
    const template = await this.requireTemplate(id);
    const requestedCalendar = template.calendarId
      ? await this.db.calendars.get(template.calendarId)
      : undefined;
    const activeCalendars = (await this.db.calendars.toArray()).filter(active).sort(byOrder);
    const calendar =
      requestedCalendar && active(requestedCalendar)
        ? requestedCalendar
        : (activeCalendars.find((candidate) => candidate.id === DEFAULT_CALENDAR_ID) ??
          activeCalendars[0]);
    if (!calendar) throw new CalendarValidationError('Create or restore a calendar first.');
    const endTime = template.allDay
      ? undefined
      : (template.endTime ??
        (template.startTime && template.suggestedDurationMinutes
          ? addMinutesToTime(template.startTime, template.suggestedDurationMinutes)
          : undefined));
    return {
      input: {
        calendarId: calendar.id,
        title: template.title,
        startDate: localDate,
        endDate: localDate,
        allDay: template.allDay,
        startTime: template.allDay ? undefined : template.startTime,
        endTime,
        location: template.location,
        notes: template.notes,
      },
      recurrence: template.recurrence
        ? {
            ...template.recurrence,
            weekdays: template.recurrence.weekdays ? [...template.recurrence.weekdays] : undefined,
            endDate:
              template.recurrence.endMode === 'until' &&
              (template.recurrence.endDate ?? '') < localDate
                ? localDate
                : template.recurrence.endDate,
          }
        : undefined,
      fellBack: Boolean(template.calendarId && template.calendarId !== calendar.id),
    };
  }

  private async putOverride(
    event: CalendarEventRecord,
    originalStartDate: string,
    input: CalendarEventInput,
  ): Promise<void> {
    const now = this.now();
    const existing = await this.db.recurrenceExceptions
      .where('[seriesEventId+originalStartDate]')
      .equals([event.id, originalStartDate])
      .first();
    await this.db.recurrenceExceptions.put({
      id: existing?.id ?? this.createId(),
      seriesEventId: event.id,
      originalStartDate,
      kind: 'override',
      calendarId: input.calendarId,
      title: input.title.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      allDay: input.allDay,
      startTime: input.allDay ? null : (input.startTime ?? null),
      endTime: input.allDay ? null : (input.endTime ?? null),
      location: optionalText(input.location) ?? null,
      notes: optionalText(input.notes) ?? null,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    });
  }

  private async editEntireSeries(
    event: CalendarEventRecord,
    rule: RecurrenceRuleRecord,
    occurrence: CalendarOccurrence,
    input: CalendarEventInput,
    recurrence: RecurrenceDefinition | undefined,
  ): Promise<CalendarEventRecord> {
    if (!recurrence) {
      const now = this.now();
      const record = this.eventRecord(input, event.id, event.createdAt, now);
      await this.db.transaction(
        'rw',
        this.db.calendarEvents,
        this.db.recurrenceRules,
        this.db.recurrenceExceptions,
        async () => {
          await this.db.calendarEvents.put(record);
          await this.db.recurrenceRules.delete(rule.id);
          await this.db.recurrenceExceptions.where('seriesEventId').equals(event.id).delete();
        },
      );
      this.notify();
      return record;
    }
    const shift = daysBetween(occurrence.originalStartDate, input.startDate);
    const baseStart = addCalendarDays(event.startDate, shift);
    const span = daysBetween(input.startDate, input.endDate);
    const baseInput: CalendarEventInput = {
      ...input,
      startDate: baseStart,
      endDate: addCalendarDays(baseStart, span),
    };
    const definition = validateRecurrence(
      sameDefinition(recurrence, rule)
        ? alignDefinitionToStart(rule, event.startDate, baseStart)
        : recurrence,
      baseStart,
    );
    const now = this.now();
    const record = this.eventRecord(baseInput, event.id, event.createdAt, now);
    const exceptions = await this.db.recurrenceExceptions
      .where('seriesEventId')
      .equals(event.id)
      .toArray();
    const nextRule: RecurrenceRuleRecord = {
      ...definition,
      id: rule.id,
      eventId: event.id,
      createdAt: rule.createdAt,
      modifiedAt: now,
    };
    const updatedExceptions = exceptions.flatMap((exception) => {
      const shiftedDate = addCalendarDays(exception.originalStartDate, shift);
      if (!occurrencePosition(record, nextRule, shiftedDate)) {
        return [];
      }
      const followsOriginalDate = exception.startDate === exception.originalStartDate;
      return [
        {
          ...exception,
          originalStartDate: shiftedDate,
          startDate:
            followsOriginalDate && exception.startDate
              ? addCalendarDays(exception.startDate, shift)
              : exception.startDate,
          endDate:
            followsOriginalDate && exception.endDate
              ? addCalendarDays(exception.endDate, shift)
              : exception.endDate,
          modifiedAt: now,
        },
      ];
    });
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendarEvents.put(record);
        await this.db.recurrenceRules.put(nextRule);
        await this.db.recurrenceExceptions.bulkDelete(exceptions.map((exception) => exception.id));
        if (updatedExceptions.length) await this.db.recurrenceExceptions.bulkPut(updatedExceptions);
      },
    );
    this.notify();
    return record;
  }

  private async splitSeries(
    event: CalendarEventRecord,
    rule: RecurrenceRuleRecord,
    occurrence: CalendarOccurrence,
    input: CalendarEventInput,
    recurrence: RecurrenceDefinition | undefined,
  ): Promise<CalendarEventRecord> {
    const position = occurrencePosition(event, rule, occurrence.originalStartDate);
    if (!position) throw new CalendarValidationError('Occurrence is unavailable.');
    if (position === 1) return this.editEntireSeries(event, rule, occurrence, input, recurrence);
    const now = this.now();
    const newEventId = this.createId();
    const newEvent = this.eventRecord(input, newEventId, now, now);
    const inherited = remainingDefinition(rule, position);
    const definition = recurrence
      ? validateRecurrence(
          sameDefinition(recurrence, rule)
            ? alignDefinitionToStart(inherited, occurrence.originalStartDate, input.startDate)
            : recurrence,
          input.startDate,
        )
      : undefined;
    const newRule: RecurrenceRuleRecord | undefined = definition
      ? {
          ...definition,
          id: this.createId(),
          eventId: newEventId,
          createdAt: now,
          modifiedAt: now,
        }
      : undefined;
    const shortened: RecurrenceRuleRecord = {
      ...rule,
      endMode: 'count',
      occurrenceCount: position - 1,
      endDate: undefined,
      modifiedAt: now,
    };
    const shift = daysBetween(occurrence.originalStartDate, input.startDate);
    const futureExceptions = (
      await this.db.recurrenceExceptions.where('seriesEventId').equals(event.id).toArray()
    ).filter(
      (exception) =>
        !exception.deletedAt && exception.originalStartDate >= occurrence.originalStartDate,
    );
    await this.db.transaction(
      'rw',
      this.db.calendarEvents,
      this.db.recurrenceRules,
      this.db.recurrenceExceptions,
      async () => {
        await this.db.calendarEvents.add(newEvent);
        await this.db.recurrenceRules.put(shortened);
        if (newRule) await this.db.recurrenceRules.put(newRule);
        await Promise.all(
          futureExceptions.map(async (exception) => {
            const shiftedDate = addCalendarDays(exception.originalStartDate, shift);
            if (newRule && occurrencePosition(newEvent, newRule, shiftedDate)) {
              const followsOriginalDate = exception.startDate === exception.originalStartDate;
              await this.db.recurrenceExceptions.update(exception.id, {
                seriesEventId: newEventId,
                originalStartDate: shiftedDate,
                startDate:
                  followsOriginalDate && exception.startDate
                    ? addCalendarDays(exception.startDate, shift)
                    : exception.startDate,
                endDate:
                  followsOriginalDate && exception.endDate
                    ? addCalendarDays(exception.endDate, shift)
                    : exception.endDate,
                modifiedAt: now,
              });
            } else {
              await this.db.recurrenceExceptions.update(exception.id, {
                deletedAt: now,
                deletionGroupId: this.createId(),
                modifiedAt: now,
              });
            }
          }),
        );
      },
    );
    this.notify();
    return newEvent;
  }

  private eventRecord(
    input: CalendarEventInput,
    id: string,
    createdAt: string,
    modifiedAt: string,
  ): CalendarEventRecord {
    return {
      ...input,
      id,
      title: input.title.trim(),
      location: optionalText(input.location),
      notes: optionalText(input.notes),
      startTime: input.allDay ? undefined : input.startTime,
      endTime: input.allDay ? undefined : input.endTime,
      createdAt,
      modifiedAt,
    };
  }

  private async requireRule(eventId: string): Promise<RecurrenceRuleRecord> {
    const rule = await this.db.recurrenceRules.where('eventId').equals(eventId).first();
    if (!rule) throw new CalendarValidationError('Recurring series is unavailable.');
    return rule;
  }

  private async requireTemplate(id: string): Promise<EventTemplateRecord> {
    const template = await this.db.eventTemplates.get(id);
    if (!template || !active(template))
      throw new CalendarValidationError('Template is unavailable.');
    return template;
  }
  private async requireCalendar(id: string) {
    const calendar = await this.db.calendars.get(id);
    if (!calendar || !active(calendar))
      throw new CalendarValidationError('Calendar is unavailable.');
    return calendar;
  }
  private async requireEvent(id: string) {
    const event = await this.db.calendarEvents.get(id);
    if (!event || !active(event)) throw new CalendarValidationError('Event is unavailable.');
    return event;
  }
}
export const calendarRepository = new CalendarRepository();
