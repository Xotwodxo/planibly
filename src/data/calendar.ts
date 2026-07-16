import { addCalendarDays, isLocalDate } from './planning';
import type {
  CalendarEventRecord,
  CalendarRecord,
  PlannerSnapshot,
  TaskRecord,
} from './plannerTypes';

export type MonthDay = { localDate: string; inMonth: boolean; eventCount: number };
export type TimedBlock = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  kind: 'event' | 'task';
};
export type TimeOverlap = { left: TimedBlock; right: TimedBlock };

export function isLocalTime(value: string | undefined): value is string {
  return value !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function eventOccursOn(event: CalendarEventRecord, date: string): boolean {
  return event.startDate <= date && event.endDate >= date;
}

export function eventsForDate(
  events: readonly CalendarEventRecord[],
  date: string,
): CalendarEventRecord[] {
  return events
    .filter((event) => eventOccursOn(event, date))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title);
    });
}

export function visibleCalendarEvents(
  snapshot: Pick<PlannerSnapshot, 'calendars' | 'calendarEvents'>,
): CalendarEventRecord[] {
  const visibleIds = new Set(
    snapshot.calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id),
  );
  return snapshot.calendarEvents.filter((event) => visibleIds.has(event.calendarId));
}

export function monthGrid(
  year: number,
  monthIndex: number,
  events: readonly CalendarEventRecord[] = [],
): MonthDay[] {
  const first = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  if (!isLocalDate(first)) throw new CalendarValidationError('Choose a valid month.');
  const weekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const start = addCalendarDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const localDate = addCalendarDays(start, index);
    return {
      localDate,
      inMonth: localDate.slice(0, 7) === first.slice(0, 7),
      eventCount: events.filter((event) => eventOccursOn(event, localDate)).length,
    };
  });
}

export function upcomingEvents(
  events: readonly CalendarEventRecord[],
  fromDate: string,
  horizonDays: number,
): CalendarEventRecord[] {
  const endDate = addCalendarDays(fromDate, horizonDays - 1);
  return events
    .filter((event) => event.endDate >= fromDate && event.startDate <= endDate)
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        Number(right.allDay) - Number(left.allDay) ||
        (left.startTime ?? '').localeCompare(right.startTime ?? '') ||
        left.title.localeCompare(right.title),
    );
}

export function scheduledEventMinutes(
  events: readonly CalendarEventRecord[],
  date: string,
): number {
  return eventsForDate(events, date).reduce((total, event) => {
    if (event.allDay || !event.startTime || !event.endTime) return total;
    return total + timeMinutes(event.endTime) - timeMinutes(event.startTime);
  }, 0);
}

export function timeOverlaps(
  events: readonly CalendarEventRecord[],
  tasks: readonly TaskRecord[],
  date: string,
): TimeOverlap[] {
  const blocks: TimedBlock[] = [
    ...eventsForDate(events, date)
      .filter((event) => !event.allDay && event.startTime && event.endTime)
      .map((event) => ({
        id: event.id,
        label: event.title,
        startTime: event.startTime!,
        endTime: event.endTime!,
        kind: 'event' as const,
      })),
    ...tasks
      .filter((task) => task.exactStartTime && task.estimatedDurationMinutes)
      .map((task) => ({
        id: task.id,
        label: task.title,
        startTime: task.exactStartTime!,
        endTime: minutesTime(timeMinutes(task.exactStartTime!) + task.estimatedDurationMinutes!),
        kind: 'task' as const,
      })),
  ].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const overlaps: TimeOverlap[] = [];
  for (let left = 0; left < blocks.length; left += 1) {
    for (let right = left + 1; right < blocks.length; right += 1) {
      if (blocks[right]!.startTime >= blocks[left]!.endTime) break;
      overlaps.push({ left: blocks[left]!, right: blocks[right]! });
    }
  }
  return overlaps;
}

export function calendarName(calendars: readonly CalendarRecord[], id: string): string {
  return calendars.find((calendar) => calendar.id === id)?.name ?? 'Unavailable calendar';
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  return hour * 60 + minute;
}

function minutesTime(value: number): string {
  const bounded = Math.min(value, 24 * 60);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function validateCalendarEvent(
  input: Pick<
    CalendarEventRecord,
    | 'title'
    | 'calendarId'
    | 'startDate'
    | 'endDate'
    | 'allDay'
    | 'startTime'
    | 'endTime'
    | 'location'
    | 'notes'
  >,
): void {
  if (!input.title.trim() || input.title.trim().length > 160)
    throw new CalendarValidationError('Enter an event title of up to 160 characters.');
  if (!input.calendarId) throw new CalendarValidationError('Choose a calendar.');
  if (
    !isLocalDate(input.startDate) ||
    !isLocalDate(input.endDate) ||
    input.endDate < input.startDate
  )
    throw new CalendarValidationError('Choose a valid date range.');
  if ((input.location?.length ?? 0) > 240 || (input.notes?.length ?? 4000) > 4000)
    throw new CalendarValidationError('Location or notes are too long.');
  if (
    !input.allDay &&
    (!isLocalTime(input.startTime) ||
      !isLocalTime(input.endTime) ||
      input.startDate !== input.endDate ||
      input.endTime <= input.startTime)
  )
    throw new CalendarValidationError(
      'Timed events need a same-day start and end time, with the end after the start.',
    );
}

export function isValidCalendarEventRecord(event: CalendarEventRecord): boolean {
  try {
    validateCalendarEvent(event);
    return Boolean(event.id && event.createdAt && event.modifiedAt);
  } catch {
    return false;
  }
}

export class CalendarValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CalendarValidationError';
  }
}
