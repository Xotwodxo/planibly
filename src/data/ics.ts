import { addCalendarDays, isLocalDate } from './planning';
import { isLocalTime, validateCalendarEvent } from './calendar';
import type {
  CalendarEventRecord,
  RecurrenceDefinition,
  RecurrenceExceptionRecord,
  RecurrenceRuleRecord,
} from './plannerTypes';

export const ICS_IMPORT_LIMITS = {
  bytes: 2 * 1024 * 1024,
  events: 2_000,
  unfoldedLineCharacters: 10_000,
  titleCharacters: 160,
  locationCharacters: 240,
  descriptionCharacters: 4_000,
} as const;

export type IcsTimezoneKind = 'date' | 'floating' | 'utc' | 'tzid';

export type ParsedIcsEvent = {
  externalUid: string;
  recurrenceId?: string;
  title: string;
  description?: string;
  location?: string;
  categories: string[];
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  status?: string;
  createdAt?: string;
  lastModified?: string;
  sequence?: number;
  recurrence?: RecurrenceDefinition;
  exclusionDates: string[];
  sourceTimezone?: string;
  timezoneKind: IcsTimezoneKind;
  unresolvedTimezone?: string;
  warnings: string[];
};

export type IcsParseResult = {
  calendarName?: string;
  events: ParsedIcsEvent[];
  unsupportedRecords: number;
  invalidRecords: number;
  warnings: string[];
};

export type IcsExportSeries = {
  event: CalendarEventRecord;
  rule?: RecurrenceRuleRecord | RecurrenceDefinition;
  exceptions?: RecurrenceExceptionRecord[];
};

type IcsProperty = {
  name: string;
  params: Record<string, string[]>;
  value: string;
};

type TemporalValue = {
  localDate: string;
  localTime?: string;
  allDay: boolean;
  timezoneKind: IcsTimezoneKind;
  sourceTimezone?: string;
  unresolvedTimezone?: string;
};

const WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export class IcsValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'IcsValidationError';
  }
}

export function parseIcs(text: string): IcsParseResult {
  if (new TextEncoder().encode(text).length > ICS_IMPORT_LIMITS.bytes) {
    throw new IcsValidationError('The calendar file is larger than the 2 MB import limit.');
  }
  const lines = unfoldLines(text);
  if (!lines.some((line) => line.toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new IcsValidationError('This is not a VCALENDAR file.');
  }

  const eventProperties: IcsProperty[][] = [];
  const stack: string[] = [];
  let current: IcsProperty[] | null = null;
  let calendarName: string | undefined;
  let unsupportedRecords = 0;
  const warnings: string[] = [];

  for (const line of lines) {
    const property = parseContentLine(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      stack.push(component);
      if (component === 'VEVENT') current = [];
      if (component === 'VTODO') unsupportedRecords += 1;
      continue;
    }
    if (property.name === 'END') {
      const component = property.value.toUpperCase();
      if (component === 'VEVENT' && current) {
        if (eventProperties.length >= ICS_IMPORT_LIMITS.events) {
          throw new IcsValidationError('The calendar file contains more than 2,000 events.');
        }
        eventProperties.push(current);
        current = null;
      }
      const open = stack.pop();
      if (open !== component) warnings.push(`Ignored a mismatched ${component} component ending.`);
      continue;
    }
    if (stack.at(-1) === 'VEVENT' && current) current.push(property);
    if (stack.at(-1) === 'VCALENDAR' && property.name === 'X-WR-CALNAME') {
      calendarName = boundedText(unescapeText(property.value), 160);
    }
  }

  const events: ParsedIcsEvent[] = [];
  let invalidRecords = 0;
  for (const properties of eventProperties) {
    try {
      const parsed = parseEvent(properties);
      if (parsed) events.push(parsed);
      else {
        unsupportedRecords += 1;
        warnings.push('Ignored an event with an unsupported recurrence rule.');
      }
    } catch (error) {
      invalidRecords += 1;
      warnings.push(error instanceof Error ? error.message : 'Ignored an invalid event record.');
    }
  }

  return { calendarName, events, unsupportedRecords, invalidRecords, warnings };
}

function unfoldLines(text: string): string[] {
  const physical = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
    if ((unfolded.at(-1)?.length ?? 0) > ICS_IMPORT_LIMITS.unfoldedLineCharacters) {
      throw new IcsValidationError('The calendar file contains an excessively long line.');
    }
  }
  return unfolded.filter(Boolean);
}

function parseContentLine(line: string): IcsProperty | null {
  const colon = delimiterIndex(line, ':');
  if (colon <= 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitDelimited(left, ';');
  const name = (parts.shift() ?? '').toUpperCase();
  if (!name) return null;
  const params: Record<string, string[]> = {};
  for (const part of parts) {
    const equals = delimiterIndex(part, '=');
    if (equals <= 0) continue;
    const key = part.slice(0, equals).toUpperCase();
    params[key] = splitDelimited(part.slice(equals + 1), ',').map(unquote);
  }
  return { name, params, value };
}

function delimiterIndex(value: string, delimiter: string): number {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (!quoted && value[index] === delimiter) return index;
  }
  return -1;
}

function splitDelimited(value: string, delimiter: string): string[] {
  const result: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (!quoted && value[index] === delimiter) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function parseEvent(properties: IcsProperty[]): ParsedIcsEvent | null {
  const uid = first(properties, 'UID')?.value.trim();
  const startProperty = first(properties, 'DTSTART');
  if (!uid || uid.length > 512)
    throw new IcsValidationError('Ignored an event without a valid UID.');
  if (!startProperty) throw new IcsValidationError(`Ignored ${uid}: DTSTART is required.`);

  const start = parseTemporal(startProperty);
  const endProperty = first(properties, 'DTEND');
  const durationProperty = first(properties, 'DURATION');
  const end = endProperty ? parseTemporal(endProperty) : undefined;
  const duration = durationProperty ? parseDuration(durationProperty.value) : undefined;
  if (durationProperty && !duration) {
    throw new IcsValidationError(`Ignored ${uid}: DURATION could not be converted safely.`);
  }
  const warnings: string[] = [];
  let endDate: string;
  let endTime: string | undefined;

  if (start.allDay) {
    if (end && !end.allDay)
      throw new IcsValidationError(`Ignored ${uid}: DATE start and end types differ.`);
    if (end) endDate = addCalendarDays(end.localDate, -1);
    else if (duration?.days) endDate = addCalendarDays(start.localDate, duration.days - 1);
    else endDate = start.localDate;
    if (endDate < start.localDate)
      throw new IcsValidationError(`Ignored ${uid}: all-day end is invalid.`);
  } else {
    if (!start.localTime) throw new IcsValidationError(`Ignored ${uid}: timed start is invalid.`);
    if (end) {
      if (end.allDay || !end.localTime)
        throw new IcsValidationError(`Ignored ${uid}: timed end is invalid.`);
      endDate = end.localDate;
      endTime = end.localTime;
    } else if (duration?.minutes) {
      const total = timeMinutes(start.localTime) + duration.minutes;
      if (total >= 24 * 60)
        throw new IcsValidationError(`Ignored ${uid}: overnight timed events are not supported.`);
      endDate = start.localDate;
      endTime = minutesTime(total);
    } else {
      throw new IcsValidationError(`Ignored ${uid}: timed events require DTEND or DURATION.`);
    }
    if (endDate !== start.localDate || !endTime || endTime <= start.localTime) {
      throw new IcsValidationError(`Ignored ${uid}: overnight timed events are not supported.`);
    }
  }

  const ruleProperty = first(properties, 'RRULE');
  const recurrence = ruleProperty
    ? parseRecurrence(ruleProperty.value, start.localDate)
    : undefined;
  if (ruleProperty && !recurrence) return null;
  const recurrenceProperty = first(properties, 'RECURRENCE-ID');
  const recurrenceTemporal = recurrenceProperty ? parseTemporal(recurrenceProperty) : undefined;
  const exclusions = all(properties, 'EXDATE').flatMap((property) =>
    property.value.split(',').flatMap((value) => {
      try {
        return [parseTemporal({ ...property, value }).localDate];
      } catch {
        warnings.push(`Ignored an invalid EXDATE on ${uid}.`);
        return [];
      }
    }),
  );
  const title = boundedEventText(
    unescapeText(first(properties, 'SUMMARY')?.value ?? 'Untitled event'),
    ICS_IMPORT_LIMITS.titleCharacters,
    'title',
  );
  const description = optionalBoundedEventText(
    first(properties, 'DESCRIPTION')?.value,
    ICS_IMPORT_LIMITS.descriptionCharacters,
    'description',
  );
  const location = optionalBoundedEventText(
    first(properties, 'LOCATION')?.value,
    ICS_IMPORT_LIMITS.locationCharacters,
    'location',
  );
  const status = first(properties, 'STATUS')?.value.trim().toUpperCase();
  const sequenceValue = first(properties, 'SEQUENCE')?.value;
  const sequence = sequenceValue !== undefined ? Number(sequenceValue) : undefined;
  const sourceTimezone = start.sourceTimezone ?? end?.sourceTimezone;
  const unresolvedTimezone = start.unresolvedTimezone ?? end?.unresolvedTimezone;
  if (unresolvedTimezone) {
    warnings.push(
      `Timezone ${unresolvedTimezone} could not be interpreted; choose wall-clock import or skip.`,
    );
  }
  if (recurrence && sourceTimezone && !unresolvedTimezone) {
    warnings.push(
      `Recurring timezone ${sourceTimezone} becomes device-local wall-clock recurrence after import.`,
    );
  }

  const record: ParsedIcsEvent = {
    externalUid: uid,
    recurrenceId: recurrenceTemporal?.localDate,
    title,
    description,
    location,
    categories: all(properties, 'CATEGORIES').flatMap((property) =>
      property.value.split(',').map((category) => boundedText(unescapeText(category), 80)),
    ),
    startDate: start.localDate,
    endDate,
    allDay: start.allDay,
    startTime: start.localTime,
    endTime,
    status,
    createdAt: parseTimestamp(first(properties, 'CREATED')?.value),
    lastModified: parseTimestamp(first(properties, 'LAST-MODIFIED')?.value),
    sequence: Number.isSafeInteger(sequence) && sequence! >= 0 ? sequence : undefined,
    recurrence: recurrence ?? undefined,
    exclusionDates: [...new Set(exclusions)].sort(),
    sourceTimezone,
    timezoneKind: start.timezoneKind,
    unresolvedTimezone,
    warnings,
  };
  validateCalendarEvent({
    title: record.title,
    calendarId: 'preview',
    startDate: record.startDate,
    endDate: record.endDate,
    allDay: record.allDay,
    startTime: record.startTime,
    endTime: record.endTime,
    location: record.location,
    notes: record.description,
  });
  return record;
}

function first(properties: IcsProperty[], name: string): IcsProperty | undefined {
  return properties.find((property) => property.name === name);
}

function all(properties: IcsProperty[], name: string): IcsProperty[] {
  return properties.filter((property) => property.name === name);
}

function boundedText(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

function boundedEventText(value: string, maximum: number, label: string): string {
  const result = value.trim();
  if (result.length > maximum) {
    throw new IcsValidationError(`Ignored an event whose ${label} exceeds ${maximum} characters.`);
  }
  return result;
}

function optionalBoundedEventText(
  value: string | undefined,
  maximum: number,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const result = boundedEventText(unescapeText(value), maximum, label);
  return result || undefined;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseTemporal(property: IcsProperty): TemporalValue {
  const raw = property.value.trim();
  const valueType = property.params.VALUE?.[0]?.toUpperCase();
  if (valueType === 'DATE' || /^\d{8}$/.test(raw)) {
    const localDate = compactDate(raw);
    if (!isLocalDate(localDate)) throw new IcsValidationError('An event contains an invalid DATE.');
    return { localDate, allDay: true, timezoneKind: 'date' };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!match) throw new IcsValidationError('An event contains an invalid date-time.');
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const sourceDate = `${match[1]}-${match[2]}-${match[3]}`;
  const sourceTime = `${match[4]}:${match[5]}`;
  if (!isLocalDate(sourceDate) || !isLocalTime(sourceTime) || parts.second > 59) {
    throw new IcsValidationError('An event contains an invalid date-time.');
  }
  if (match[7]) return localPartsFromDate(new Date(Date.UTC(...dateArguments(parts))), 'utc');

  const tzid = property.params.TZID?.[0];
  if (tzid) {
    const instant = dateInTimeZone(parts, tzid);
    if (instant) return { ...localPartsFromDate(instant, 'tzid'), sourceTimezone: tzid };
    return {
      localDate: sourceDate,
      localTime: sourceTime,
      allDay: false,
      timezoneKind: 'tzid',
      sourceTimezone: tzid,
      unresolvedTimezone: tzid,
    };
  }
  return {
    localDate: sourceDate,
    localTime: sourceTime,
    allDay: false,
    timezoneKind: 'floating',
  };
}

function compactDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function dateArguments(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): [number, number, number, number, number, number] {
  return [parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second];
}

function localPartsFromDate(date: Date, kind: 'utc' | 'tzid'): TemporalValue {
  return {
    localDate: `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    localTime: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    allDay: false,
    timezoneKind: kind,
  };
}

function dateInTimeZone(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const target = Date.UTC(...dateArguments(parts));
    const candidates: Date[] = [];
    for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
      const candidate = new Date(target + offsetMinutes * 60_000);
      const formatted = Object.fromEntries(
        formatter
          .formatToParts(candidate)
          .filter((part) => part.type !== 'literal')
          .map((part) => [part.type, Number(part.value)]),
      );
      if (
        formatted.year === parts.year &&
        formatted.month === parts.month &&
        formatted.day === parts.day &&
        formatted.hour === parts.hour &&
        formatted.minute === parts.minute &&
        formatted.second === parts.second
      ) {
        candidates.push(candidate);
      }
    }
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function parseDuration(value: string): { days?: number; minutes?: number } | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (seconds || (days && minutes) || (!days && !minutes)) return undefined;
  return days ? { days } : { minutes };
}

function parseTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!match) return undefined;
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

export function parseRecurrence(value: string, startDate: string): RecurrenceDefinition | null {
  const fields: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name) fields[name.toUpperCase()] = rest.join('=').toUpperCase();
  }
  const supported = new Set([
    'FREQ',
    'INTERVAL',
    'COUNT',
    'UNTIL',
    'BYDAY',
    'BYMONTHDAY',
    'BYMONTH',
    'WKST',
  ]);
  if (Object.keys(fields).some((field) => !supported.has(field))) return null;
  if (fields.WKST && fields.WKST !== 'MO') return null;
  const interval = Number(fields.INTERVAL ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  const ending = recurrenceEnding(fields, startDate);
  if (!ending) return null;
  const base = { interval, ...ending };

  if (fields.FREQ === 'DAILY') {
    if (!fields.BYDAY) return { frequency: 'daily', ...base };
    if (fields.BYDAY === 'MO,TU,WE,TH,FR') return { frequency: 'weekdays', ...base };
    return null;
  }
  if (fields.FREQ === 'WEEKLY') {
    const weekdays = parseWeekdays(fields.BYDAY);
    return weekdays ? { frequency: 'weekly', weekdays, ...base } : null;
  }
  if (fields.FREQ === 'MONTHLY') {
    if (fields.BYMONTHDAY && /^\d{1,2}$/.test(fields.BYMONTHDAY)) {
      const monthDay = Number(fields.BYMONTHDAY);
      return monthDay >= 1 && monthDay <= 31
        ? { frequency: 'monthlyDay', monthDay, ...base }
        : null;
    }
    const ordinalMatch = /^([1-4]|-1)(SU|MO|TU|WE|TH|FR|SA)$/.exec(fields.BYDAY ?? '');
    if (ordinalMatch) {
      return {
        frequency: 'monthlyOrdinal',
        ordinal: Number(ordinalMatch[1]) as 1 | 2 | 3 | 4 | -1,
        ordinalWeekday: WEEKDAYS[ordinalMatch[2]!],
        ...base,
      };
    }
    return null;
  }
  if (fields.FREQ === 'YEARLY') {
    const yearlyMonth = Number(fields.BYMONTH);
    const yearlyDay = Number(fields.BYMONTHDAY);
    return yearlyMonth >= 1 && yearlyMonth <= 12 && yearlyDay >= 1 && yearlyDay <= 31
      ? { frequency: 'yearly', yearlyMonth, yearlyDay, ...base }
      : null;
  }
  return null;
}

function recurrenceEnding(
  fields: Record<string, string>,
  startDate: string,
): Pick<RecurrenceDefinition, 'endMode' | 'endDate' | 'occurrenceCount'> | null {
  if (fields.COUNT && fields.UNTIL) return null;
  if (fields.COUNT) {
    const occurrenceCount = Number(fields.COUNT);
    return Number.isInteger(occurrenceCount) && occurrenceCount >= 1 && occurrenceCount <= 10_000
      ? { endMode: 'count', occurrenceCount }
      : null;
  }
  if (fields.UNTIL) {
    const endDate = recurrenceUntilDate(fields.UNTIL);
    return isLocalDate(endDate) && endDate >= startDate ? { endMode: 'until', endDate } : null;
  }
  return { endMode: 'never' };
}

function recurrenceUntilDate(value: string): string {
  if (/^\d{8}$/.test(value)) return compactDate(value);
  try {
    return parseTemporal({ name: 'UNTIL', params: {}, value }).localDate;
  } catch {
    return '';
  }
}

function parseWeekdays(value: string | undefined): number[] | null {
  if (!value) return null;
  const codes = value.split(',');
  if (codes.some((code) => WEEKDAYS[code] === undefined)) return null;
  return [...new Set(codes.map((code) => WEEKDAYS[code]!))].sort((a, b) => a - b);
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

function minutesTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function exportIcsCalendar(calendarName: string, series: IcsExportSeries[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planibly//Private Offline Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const now = formatUtcTimestamp(new Date());
  for (const item of series) {
    if (item.event.deletedAt) continue;
    lines.push(...eventLines(item.event, stableExportUid(item.event.id), now, item.rule));
    const activeExceptions = (item.exceptions ?? []).filter((exception) => !exception.deletedAt);
    const cancelled = activeExceptions.filter((exception) => exception.kind === 'cancelled');
    if (cancelled.length > 0) {
      const index = lines.lastIndexOf('END:VEVENT');
      const exclusionValues = cancelled.map((exception) =>
        item.event.allDay
          ? compactLocalDate(exception.originalStartDate)
          : `${compactLocalDate(exception.originalStartDate)}T${compactTime(item.event.startTime!)}00`,
      );
      lines.splice(
        index,
        0,
        item.event.allDay
          ? `EXDATE;VALUE=DATE:${exclusionValues.join(',')}`
          : `EXDATE:${exclusionValues.join(',')}`,
      );
    }
    for (const exception of activeExceptions.filter((candidate) => candidate.kind === 'override')) {
      const override = exceptionAsEvent(item.event, exception);
      lines.push(
        ...eventLines(override, stableExportUid(item.event.id), now, undefined, {
          localDate: exception.originalStartDate,
          allDay: item.event.allDay,
          localTime: item.event.startTime,
        }),
      );
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.flatMap(foldLine).join('\r\n')}\r\n`;
}

export function exportStandaloneOccurrence(event: CalendarEventRecord): string {
  return exportIcsCalendar('Planibly export', [{ event }]);
}

function eventLines(
  event: CalendarEventRecord,
  uid: string,
  timestamp: string,
  rule?: RecurrenceRuleRecord | RecurrenceDefinition,
  recurrenceId?: { localDate: string; allDay: boolean; localTime?: string },
): string[] {
  validateCalendarEvent(event);
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${timestamp}`];
  if (recurrenceId) {
    lines.push(
      recurrenceId.allDay
        ? `RECURRENCE-ID;VALUE=DATE:${compactLocalDate(recurrenceId.localDate)}`
        : `RECURRENCE-ID:${compactLocalDate(recurrenceId.localDate)}T${compactTime(recurrenceId.localTime!)}00`,
    );
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${compactLocalDate(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactLocalDate(addCalendarDays(event.endDate, 1))}`);
  } else {
    lines.push(`DTSTART:${compactLocalDate(event.startDate)}T${compactTime(event.startTime!)}00`);
    lines.push(`DTEND:${compactLocalDate(event.endDate)}T${compactTime(event.endTime!)}00`);
  }
  if (rule) lines.push(`RRULE:${formatRecurrence(rule)}`);
  lines.push(`CREATED:${formatUtcTimestamp(new Date(event.createdAt))}`);
  lines.push(`LAST-MODIFIED:${formatUtcTimestamp(new Date(event.modifiedAt))}`);
  lines.push('END:VEVENT');
  return lines;
}

function exceptionAsEvent(
  base: CalendarEventRecord,
  exception: RecurrenceExceptionRecord,
): CalendarEventRecord {
  return {
    ...base,
    id: exception.id,
    calendarId: exception.calendarId ?? base.calendarId,
    title: exception.title ?? base.title,
    startDate: exception.startDate ?? exception.originalStartDate,
    endDate: exception.endDate ?? exception.originalStartDate,
    allDay: exception.allDay ?? base.allDay,
    startTime: exception.startTime === null ? undefined : (exception.startTime ?? base.startTime),
    endTime: exception.endTime === null ? undefined : (exception.endTime ?? base.endTime),
    location: exception.location === null ? undefined : (exception.location ?? base.location),
    notes: exception.notes === null ? undefined : (exception.notes ?? base.notes),
    createdAt: exception.createdAt,
    modifiedAt: exception.modifiedAt,
  };
}

export function formatRecurrence(rule: RecurrenceRuleRecord | RecurrenceDefinition): string {
  const parts: string[] = [];
  if (rule.frequency === 'daily') parts.push('FREQ=DAILY');
  if (rule.frequency === 'weekdays') parts.push('FREQ=DAILY', 'BYDAY=MO,TU,WE,TH,FR');
  if (rule.frequency === 'weekly') {
    parts.push('FREQ=WEEKLY');
    parts.push(`BYDAY=${(rule.weekdays ?? []).map((day) => WEEKDAY_CODES[day]).join(',')}`);
  }
  if (rule.frequency === 'monthlyDay') {
    parts.push('FREQ=MONTHLY', `BYMONTHDAY=${rule.monthDay}`);
  }
  if (rule.frequency === 'monthlyOrdinal') {
    parts.push('FREQ=MONTHLY', `BYDAY=${rule.ordinal}${WEEKDAY_CODES[rule.ordinalWeekday ?? 0]}`);
  }
  if (rule.frequency === 'yearly') {
    parts.push('FREQ=YEARLY', `BYMONTH=${rule.yearlyMonth}`, `BYMONTHDAY=${rule.yearlyDay}`);
  }
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.endMode === 'count') parts.push(`COUNT=${rule.occurrenceCount}`);
  if (rule.endMode === 'until') parts.push(`UNTIL=${compactLocalDate(rule.endDate!)}`);
  return parts.join(';');
}

function stableExportUid(id: string): string {
  return `${id}@planibly.local`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function compactLocalDate(value: string): string {
  return value.replace(/-/g, '');
}

function compactTime(value: string): string {
  return value.replace(':', '');
}

function formatUtcTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = '';
  let maximum = 75;
  for (const character of line) {
    if (encoder.encode(current + character).length > maximum && current) {
      folded.push(folded.length === 0 ? current : ` ${current}`);
      current = character;
      maximum = 74;
    } else current += character;
  }
  folded.push(folded.length === 0 ? current : ` ${current}`);
  return folded;
}
