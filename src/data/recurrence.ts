import { isValidCalendarEventRecord } from './calendar';
import { addCalendarDays, formatLocalDate, isLocalDate } from './planning';
import type {
  CalendarEventRecord,
  CalendarOccurrence,
  EventTemplateRecord,
  PlannerSnapshot,
  RecurrenceDefinition,
  RecurrenceExceptionRecord,
  RecurrenceRuleRecord,
} from './plannerTypes';

export const MAX_RECURRENCE_QUERY_DAYS = 3_660;
export const MAX_RECURRENCE_SCAN_DAYS = 36_600;
export const MAX_EXPANDED_OCCURRENCES = 5_000;
export const MAX_RECURRENCE_INTERVAL = 999;
export const MAX_RECURRENCE_COUNT = 10_000;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const SHORT_WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class RecurrenceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RecurrenceValidationError';
  }
}

export function occurrenceIdentity(seriesEventId: string, originalStartDate: string): string {
  return `${seriesEventId}::${originalStartDate}`;
}

export function validateRecurrence(
  definition: RecurrenceDefinition,
  firstOccurrenceDate: string,
): RecurrenceDefinition {
  if (!isLocalDate(firstOccurrenceDate)) {
    throw new RecurrenceValidationError('Choose a valid first occurrence date.');
  }
  if (
    !Number.isInteger(definition.interval) ||
    definition.interval < 1 ||
    definition.interval > MAX_RECURRENCE_INTERVAL
  ) {
    throw new RecurrenceValidationError(
      `Repeat interval must be between 1 and ${MAX_RECURRENCE_INTERVAL}.`,
    );
  }
  const weekdays = [...new Set(definition.weekdays ?? [])].sort((left, right) => left - right);
  if (
    definition.frequency === 'weekly' &&
    (weekdays.length === 0 || weekdays.some((weekday) => !isWeekdayNumber(weekday)))
  ) {
    throw new RecurrenceValidationError('Weekly repeats need at least one weekday.');
  }
  if (definition.frequency === 'monthlyDay') {
    if (
      !Number.isInteger(definition.monthDay) ||
      definition.monthDay! < 1 ||
      definition.monthDay! > 31
    ) {
      throw new RecurrenceValidationError('Choose a monthly day from 1 to 31.');
    }
  }
  if (definition.frequency === 'monthlyOrdinal') {
    if (
      ![1, 2, 3, 4, -1].includes(definition.ordinal ?? 0) ||
      !isWeekdayNumber(definition.ordinalWeekday)
    ) {
      throw new RecurrenceValidationError('Choose a valid ordinal weekday.');
    }
  }
  if (definition.frequency === 'yearly') {
    if (
      !Number.isInteger(definition.yearlyMonth) ||
      definition.yearlyMonth! < 1 ||
      definition.yearlyMonth! > 12 ||
      !Number.isInteger(definition.yearlyDay) ||
      definition.yearlyDay! < 1 ||
      definition.yearlyDay! > 31 ||
      !isPossibleMonthDay(definition.yearlyMonth!, definition.yearlyDay!)
    ) {
      throw new RecurrenceValidationError('Choose a valid yearly month and day.');
    }
  }
  if (definition.endMode === 'until') {
    if (
      !definition.endDate ||
      !isLocalDate(definition.endDate) ||
      definition.endDate < firstOccurrenceDate
    ) {
      throw new RecurrenceValidationError('Repeat end date cannot be before the first occurrence.');
    }
  }
  if (
    definition.endMode === 'count' &&
    (!Number.isInteger(definition.occurrenceCount) ||
      definition.occurrenceCount! < 1 ||
      definition.occurrenceCount! > MAX_RECURRENCE_COUNT)
  ) {
    throw new RecurrenceValidationError(
      `Occurrence count must be between 1 and ${MAX_RECURRENCE_COUNT}.`,
    );
  }
  const normalized: RecurrenceDefinition = {
    ...definition,
    weekdays: definition.frequency === 'weekly' ? weekdays : undefined,
    endDate: definition.endMode === 'until' ? definition.endDate : undefined,
    occurrenceCount: definition.endMode === 'count' ? definition.occurrenceCount : undefined,
  };
  if (!matchesPattern(normalized, firstOccurrenceDate, firstOccurrenceDate)) {
    throw new RecurrenceValidationError('The repeat pattern must include the first occurrence.');
  }
  return normalized;
}

export function isValidRecurrenceRule(
  rule: RecurrenceRuleRecord,
  event: CalendarEventRecord,
): boolean {
  try {
    validateRecurrence(rule, event.startDate);
    return Boolean(rule.id && rule.eventId === event.id && rule.createdAt && rule.modifiedAt);
  } catch {
    return false;
  }
}

export function isValidEventTemplateRecord(template: EventTemplateRecord): boolean {
  if (
    !template.id ||
    !template.name.trim() ||
    !template.title.trim() ||
    !Number.isFinite(template.order) ||
    !template.createdAt ||
    !template.modifiedAt
  ) {
    return false;
  }
  if (
    !template.allDay &&
    !(template.startTime && template.endTime && template.endTime > template.startTime) &&
    !(
      template.startTime &&
      template.suggestedDurationMinutes &&
      template.suggestedDurationMinutes > 0
    )
  ) {
    return false;
  }
  if (template.recurrence) {
    try {
      validateRecurrence(template.recurrence, templateAnchor(template.recurrence));
    } catch {
      return false;
    }
  }
  return true;
}

export function recurrenceSummary(definition: RecurrenceDefinition): string {
  const interval = definition.interval;
  let pattern: string;
  switch (definition.frequency) {
    case 'daily':
      pattern = interval === 1 ? 'Daily' : `Every ${interval} days`;
      break;
    case 'weekdays':
      pattern = interval === 1 ? 'Weekdays' : `Weekdays every ${interval} weeks`;
      break;
    case 'weekly': {
      const names = (definition.weekdays ?? []).map((day) => SHORT_WEEKDAY_NAMES[day]).join(', ');
      pattern = `${interval === 1 ? 'Weekly' : `Every ${interval} weeks`} on ${names}`;
      break;
    }
    case 'monthlyDay':
      pattern = `${interval === 1 ? 'Monthly' : `Every ${interval} months`} on day ${definition.monthDay}`;
      break;
    case 'monthlyOrdinal': {
      const ordinal = definition.ordinal === -1 ? 'last' : ordinalName(definition.ordinal!);
      pattern = `${interval === 1 ? 'Monthly' : `Every ${interval} months`} on the ${ordinal} ${WEEKDAY_NAMES[definition.ordinalWeekday!]}`;
      break;
    }
    case 'yearly':
      pattern = `${interval === 1 ? 'Yearly' : `Every ${interval} years`} on ${formatLocalDate(`2000-${String(definition.yearlyMonth).padStart(2, '0')}-${String(definition.yearlyDay).padStart(2, '0')}`, { month: 'long', day: 'numeric' })}`;
      break;
  }
  if (definition.endMode === 'until')
    return `${pattern}, until ${formatLocalDate(definition.endDate!)}`;
  if (definition.endMode === 'count')
    return `${pattern}, ${definition.occurrenceCount} occurrences`;
  return pattern;
}

export function expandCalendarOccurrences(
  snapshot: Pick<
    PlannerSnapshot,
    'calendars' | 'calendarEvents' | 'recurrenceRules' | 'recurrenceExceptions'
  >,
  rangeStart: string,
  rangeEnd: string,
): CalendarOccurrence[] {
  if (!isLocalDate(rangeStart) || !isLocalDate(rangeEnd) || rangeEnd < rangeStart) return [];
  if (differenceInDays(rangeStart, rangeEnd) + 1 > MAX_RECURRENCE_QUERY_DAYS) return [];
  const visibleCalendarIds = new Set(
    snapshot.calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id),
  );
  const activeEvents = snapshot.calendarEvents.filter(isValidCalendarEventRecord);
  const rules = new Map(snapshot.recurrenceRules.map((rule) => [rule.eventId, rule]));
  const exceptionsBySeries = new Map<string, RecurrenceExceptionRecord[]>();
  for (const exception of snapshot.recurrenceExceptions.filter((record) => !record.deletedAt)) {
    const records = exceptionsBySeries.get(exception.seriesEventId) ?? [];
    records.push(exception);
    exceptionsBySeries.set(exception.seriesEventId, records);
  }
  const occurrences = new Map<string, CalendarOccurrence>();
  for (const event of activeEvents) {
    const rule = rules.get(event.id);
    if (!rule) {
      if (
        visibleCalendarIds.has(event.calendarId) &&
        event.endDate >= rangeStart &&
        event.startDate <= rangeEnd
      ) {
        occurrences.set(event.id, oneOffOccurrence(event));
      }
      continue;
    }
    if (!isValidRecurrenceRule(rule, event)) continue;
    const exceptions = exceptionsBySeries.get(event.id) ?? [];
    const exceptionByDate = new Map(
      exceptions.map((exception) => [exception.originalStartDate, exception]),
    );
    const spanDays = differenceInDays(event.startDate, event.endDate);
    const scanEnd = maxDate(
      rangeEnd,
      ...exceptions.map((exception) => exception.originalStartDate),
    );
    let generated = 0;
    let scanned = 0;
    for (let date = event.startDate; date <= scanEnd; date = addCalendarDays(date, 1)) {
      scanned += 1;
      if (scanned > MAX_RECURRENCE_SCAN_DAYS || occurrences.size >= MAX_EXPANDED_OCCURRENCES) break;
      if (rule.endMode === 'until' && date > rule.endDate!) break;
      if (!matchesPattern(rule, event.startDate, date)) continue;
      generated += 1;
      if (rule.endMode === 'count' && generated > rule.occurrenceCount!) break;
      const exception = exceptionByDate.get(date);
      const occurrence = occurrenceFrom(event, rule, date, spanDays, exception);
      if (
        occurrence &&
        visibleCalendarIds.has(occurrence.calendarId) &&
        occurrence.endDate >= rangeStart &&
        occurrence.startDate <= rangeEnd
      ) {
        occurrences.set(occurrence.id, occurrence);
      }
    }
  }
  return [...occurrences.values()].sort(compareOccurrences);
}

export function occurrencePosition(
  event: CalendarEventRecord,
  rule: RecurrenceRuleRecord,
  originalStartDate: string,
): number | undefined {
  if (originalStartDate < event.startDate || !isValidRecurrenceRule(rule, event)) return undefined;
  let position = 0;
  let scanned = 0;
  for (let date = event.startDate; date <= originalStartDate; date = addCalendarDays(date, 1)) {
    scanned += 1;
    if (scanned > MAX_RECURRENCE_SCAN_DAYS) return undefined;
    if (rule.endMode === 'until' && date > rule.endDate!) return undefined;
    if (!matchesPattern(rule, event.startDate, date)) continue;
    position += 1;
    if (rule.endMode === 'count' && position > rule.occurrenceCount!) return undefined;
    if (date === originalStartDate) return position;
  }
  return undefined;
}

function occurrenceFrom(
  event: CalendarEventRecord,
  rule: RecurrenceRuleRecord,
  originalStartDate: string,
  spanDays: number,
  exception?: RecurrenceExceptionRecord,
): CalendarOccurrence | undefined {
  if (exception?.kind === 'cancelled') return undefined;
  const override = exception?.kind === 'override' ? exception : undefined;
  const allDay = override?.allDay ?? event.allDay;
  const record: CalendarEventRecord = {
    ...event,
    id: occurrenceIdentity(event.id, originalStartDate),
    calendarId: override?.calendarId ?? event.calendarId,
    title: override?.title ?? event.title,
    startDate: override?.startDate ?? originalStartDate,
    endDate: override?.endDate ?? addCalendarDays(originalStartDate, spanDays),
    allDay,
    startTime: allDay ? undefined : nullableOverride(override?.startTime, event.startTime),
    endTime: allDay ? undefined : nullableOverride(override?.endTime, event.endTime),
    location: nullableOverride(override?.location, event.location),
    notes: nullableOverride(override?.notes, event.notes),
    modifiedAt: override?.modifiedAt ?? event.modifiedAt,
  };
  if (!isValidCalendarEventRecord(record)) return undefined;
  return {
    ...record,
    sourceEventId: event.id,
    originalStartDate,
    isRecurring: true,
    recurrenceRuleId: rule.id,
    exceptionId: exception?.id,
  };
}

function oneOffOccurrence(event: CalendarEventRecord): CalendarOccurrence {
  return {
    ...event,
    sourceEventId: event.id,
    originalStartDate: event.startDate,
    isRecurring: false,
  };
}

function matchesPattern(
  definition: RecurrenceDefinition,
  anchorDate: string,
  candidateDate: string,
): boolean {
  if (candidateDate < anchorDate) return false;
  const dayDifference = differenceInDays(anchorDate, candidateDate);
  const weekday = weekdayForDate(candidateDate);
  switch (definition.frequency) {
    case 'daily':
      return dayDifference % definition.interval === 0;
    case 'weekdays':
      return (
        weekday >= 1 && weekday <= 5 && Math.floor(dayDifference / 7) % definition.interval === 0
      );
    case 'weekly':
      return (
        Math.floor(dayDifference / 7) % definition.interval === 0 &&
        (definition.weekdays ?? []).includes(weekday)
      );
    case 'monthlyDay':
      return (
        monthDifference(anchorDate, candidateDate) % definition.interval === 0 &&
        dateParts(candidateDate).day === definition.monthDay
      );
    case 'monthlyOrdinal':
      return (
        monthDifference(anchorDate, candidateDate) % definition.interval === 0 &&
        ordinalWeekday(
          dateParts(candidateDate).year,
          dateParts(candidateDate).month,
          definition.ordinalWeekday!,
          definition.ordinal!,
        ) === candidateDate
      );
    case 'yearly':
      return (
        (dateParts(candidateDate).year - dateParts(anchorDate).year) % definition.interval === 0 &&
        dateParts(candidateDate).month === definition.yearlyMonth &&
        dateParts(candidateDate).day === definition.yearlyDay
      );
  }
}

function ordinalWeekday(
  year: number,
  month: number,
  weekday: number,
  ordinal: 1 | 2 | 3 | 4 | -1,
): string | undefined {
  if (ordinal === -1) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = lastDay; day >= lastDay - 6; day -= 1) {
      const date = localDate(year, month, day);
      if (weekdayForDate(date) === weekday) return date;
    }
    return undefined;
  }
  const firstWeekday = weekdayForDate(localDate(year, month, 1));
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
  const result = localDate(year, month, day);
  return isLocalDate(result) ? result : undefined;
}

function compareOccurrences(left: CalendarOccurrence, right: CalendarOccurrence): number {
  return (
    left.startDate.localeCompare(right.startDate) ||
    Number(right.allDay) - Number(left.allDay) ||
    (left.startTime ?? '').localeCompare(right.startTime ?? '') ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function nullableOverride<T>(
  override: T | null | undefined,
  fallback: T | undefined,
): T | undefined {
  return override === null ? undefined : (override ?? fallback);
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function localDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekdayForDate(value: string): number {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function differenceInDays(left: string, right: string): number {
  const leftParts = dateParts(left);
  const rightParts = dateParts(right);
  const leftTime = Date.UTC(leftParts.year, leftParts.month - 1, leftParts.day);
  const rightTime = Date.UTC(rightParts.year, rightParts.month - 1, rightParts.day);
  return Math.round((rightTime - leftTime) / 86_400_000);
}

function monthDifference(left: string, right: string): number {
  const leftParts = dateParts(left);
  const rightParts = dateParts(right);
  return (rightParts.year - leftParts.year) * 12 + rightParts.month - leftParts.month;
}

function maxDate(first: string, ...rest: string[]): string {
  return rest.reduce((latest, value) => (value > latest ? value : latest), first);
}

function isWeekdayNumber(value: number | undefined): value is number {
  return Number.isInteger(value) && value! >= 0 && value! <= 6;
}

function isPossibleMonthDay(month: number, day: number): boolean {
  if (month === 2) return day <= 29;
  if ([4, 6, 9, 11].includes(month)) return day <= 30;
  return day <= 31;
}

function ordinalName(value: number): string {
  return value === 1 ? 'first' : value === 2 ? 'second' : value === 3 ? 'third' : 'fourth';
}

function templateAnchor(definition: RecurrenceDefinition): string {
  if (definition.frequency === 'weekly') {
    const first = definition.weekdays?.[0] ?? 1;
    return addCalendarDays('2024-01-01', (first + 6) % 7);
  }
  if (definition.frequency === 'monthlyDay') {
    return `2024-01-${String(definition.monthDay ?? 1).padStart(2, '0')}`;
  }
  if (definition.frequency === 'monthlyOrdinal') {
    return (
      ordinalWeekday(2024, 1, definition.ordinalWeekday ?? 1, definition.ordinal ?? 1) ??
      '2024-01-01'
    );
  }
  if (definition.frequency === 'yearly') {
    return `2024-${String(definition.yearlyMonth ?? 1).padStart(2, '0')}-${String(definition.yearlyDay ?? 1).padStart(2, '0')}`;
  }
  return '2024-01-01';
}
