import { describe, expect, it } from 'vitest';

import type {
  CalendarEventRecord,
  CalendarRecord,
  RecurrenceDefinition,
  RecurrenceExceptionRecord,
  RecurrenceRuleRecord,
} from './plannerTypes';
import {
  expandCalendarOccurrences,
  MAX_RECURRENCE_QUERY_DAYS,
  occurrenceIdentity,
  recurrenceSummary,
  validateRecurrence,
} from './recurrence';

const timestamp = '2026-01-01T00:00:00.000Z';
const calendar: CalendarRecord = {
  id: 'calendar',
  name: 'Personal',
  color: '#5B67C8',
  order: 0,
  isVisible: true,
  createdAt: timestamp,
  modifiedAt: timestamp,
};

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'series',
    calendarId: calendar.id,
    title: 'Recurring event',
    startDate: '2026-01-05',
    endDate: '2026-01-05',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    createdAt: timestamp,
    modifiedAt: timestamp,
    ...overrides,
  };
}

function rule(
  definition: Partial<RecurrenceDefinition> = {},
  eventId = 'series',
): RecurrenceRuleRecord {
  return {
    id: `rule-${eventId}`,
    eventId,
    frequency: 'daily',
    interval: 1,
    endMode: 'never',
    createdAt: timestamp,
    modifiedAt: timestamp,
    ...definition,
  };
}

function expand(
  currentEvent: CalendarEventRecord,
  currentRule: RecurrenceRuleRecord,
  start: string,
  end: string,
  exceptions: RecurrenceExceptionRecord[] = [],
) {
  return expandCalendarOccurrences(
    {
      calendars: [calendar],
      calendarEvents: [currentEvent],
      recurrenceRules: [currentRule],
      recurrenceExceptions: exceptions,
    },
    start,
    end,
  );
}

describe('bounded local recurrence expansion', () => {
  it('expands daily intervals with stable identities and count endings', () => {
    const current = event();
    const currentRule = rule({ interval: 2, endMode: 'count', occurrenceCount: 3 });
    const first = expand(current, currentRule, '2026-01-01', '2026-01-31');
    const second = expand(current, currentRule, '2026-01-01', '2026-01-31');
    expect(first.map((item) => item.startDate)).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first[0]?.id).toBe(occurrenceIdentity('series', '2026-01-05'));
  });

  it('supports weekdays and selected weekdays across week and year boundaries', () => {
    const weekdayEvent = event({ startDate: '2026-12-28', endDate: '2026-12-28' });
    expect(
      expand(weekdayEvent, rule({ frequency: 'weekdays' }), '2026-12-28', '2027-01-03').map(
        (item) => item.startDate,
      ),
    ).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);

    expect(
      expand(
        event(),
        rule({ frequency: 'weekly', interval: 2, weekdays: [1, 3] }),
        '2026-01-01',
        '2026-02-01',
      ).map((item) => item.startDate),
    ).toEqual(['2026-01-05', '2026-01-07', '2026-01-19', '2026-01-21']);
  });

  it('skips missing monthly days and counts only generated occurrences', () => {
    const current = event({ startDate: '2026-01-31', endDate: '2026-01-31' });
    const currentRule = rule({
      frequency: 'monthlyDay',
      monthDay: 31,
      endMode: 'count',
      occurrenceCount: 3,
    });
    expect(
      expand(current, currentRule, '2026-01-01', '2026-06-30').map((item) => item.startDate),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('supports ordinal and last weekdays only when they exist', () => {
    const firstMonday = event({ startDate: '2026-01-05', endDate: '2026-01-05' });
    expect(
      expand(
        firstMonday,
        rule({ frequency: 'monthlyOrdinal', ordinal: 1, ordinalWeekday: 1 }),
        '2026-01-01',
        '2026-03-31',
      ).map((item) => item.startDate),
    ).toEqual(['2026-01-05', '2026-02-02', '2026-03-02']);

    const lastFriday = event({ startDate: '2026-01-30', endDate: '2026-01-30' });
    expect(
      expand(
        lastFriday,
        rule({ frequency: 'monthlyOrdinal', ordinal: -1, ordinalWeekday: 5 }),
        '2026-01-01',
        '2026-03-31',
      ).map((item) => item.startDate),
    ).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('emits 29 February yearly only in leap years', () => {
    const leapEvent = event({ startDate: '2024-02-29', endDate: '2024-02-29' });
    const leapRule = rule({ frequency: 'yearly', yearlyMonth: 2, yearlyDay: 29 });
    expect(
      expand(leapEvent, leapRule, '2024-01-01', '2032-12-31').map((item) => item.startDate),
    ).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });

  it('retains timed wall-clock values over UK spring and autumn DST dates', () => {
    const current = event({ startDate: '2026-03-27', endDate: '2026-03-27' });
    const occurrences = expand(current, rule(), '2026-03-27', '2026-10-26');
    expect(occurrences.find((item) => item.startDate === '2026-03-29')).toMatchObject({
      startTime: '09:00',
      endTime: '10:00',
    });
    expect(occurrences.find((item) => item.startDate === '2026-10-25')).toMatchObject({
      startTime: '09:00',
      endTime: '10:00',
    });
  });

  it('retains inclusive all-day duration across repeated spans', () => {
    const current = event({
      startDate: '2026-03-27',
      endDate: '2026-03-29',
      allDay: true,
      startTime: undefined,
      endTime: undefined,
    });
    expect(expand(current, rule({ interval: 7 }), '2026-04-01', '2026-04-10')[0]).toMatchObject({
      startDate: '2026-04-03',
      endDate: '2026-04-05',
    });
  });

  it('applies moved overrides and cancellations without duplicating the original date', () => {
    const exceptions: RecurrenceExceptionRecord[] = [
      {
        id: 'override',
        seriesEventId: 'series',
        originalStartDate: '2026-01-06',
        kind: 'override',
        title: 'Moved event',
        startDate: '2026-01-10',
        endDate: '2026-01-10',
        allDay: false,
        startTime: '14:00',
        endTime: '15:00',
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      {
        id: 'cancelled',
        seriesEventId: 'series',
        originalStartDate: '2026-01-07',
        kind: 'cancelled',
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ];
    const occurrences = expand(event(), rule(), '2026-01-05', '2026-01-10', exceptions);
    expect(occurrences.map((item) => item.startDate)).toEqual([
      '2026-01-05',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
      '2026-01-10',
    ]);
    expect(occurrences.find((item) => item.originalStartDate === '2026-01-06')).toMatchObject({
      id: occurrenceIdentity('series', '2026-01-06'),
      title: 'Moved event',
      startDate: '2026-01-10',
    });
    expect(occurrences.some((item) => item.originalStartDate === '2026-01-07')).toBe(false);
  });

  it('lets cancelled occurrences consume count-limited positions', () => {
    const cancelled: RecurrenceExceptionRecord = {
      id: 'cancelled',
      seriesEventId: 'series',
      originalStartDate: '2026-01-06',
      kind: 'cancelled',
      createdAt: timestamp,
      modifiedAt: timestamp,
    };
    expect(
      expand(event(), rule({ endMode: 'count', occurrenceCount: 3 }), '2026-01-01', '2026-01-31', [
        cancelled,
      ]).map((item) => item.startDate),
    ).toEqual(['2026-01-05', '2026-01-07']);
  });

  it('excludes hidden calendars, ignores invalid rules, and rejects oversized query horizons safely', () => {
    expect(
      expandCalendarOccurrences(
        {
          calendars: [{ ...calendar, isVisible: false }],
          calendarEvents: [event()],
          recurrenceRules: [rule()],
          recurrenceExceptions: [],
        },
        '2026-01-01',
        '2026-01-31',
      ),
    ).toEqual([]);
    expect(expand(event(), rule({ interval: 0 }), '2026-01-01', '2026-01-31')).toEqual([]);
    expect(
      expand(
        event(),
        rule(),
        '2020-01-01',
        `20${20 + Math.ceil(MAX_RECURRENCE_QUERY_DAYS / 365)}-12-31`,
      ),
    ).toEqual([]);
  });

  it('validates endings and produces plain-language summaries', () => {
    expect(() =>
      validateRecurrence(
        { frequency: 'weekly', interval: 1, weekdays: [], endMode: 'never' },
        '2026-01-05',
      ),
    ).toThrow('weekday');
    expect(() =>
      validateRecurrence(
        { frequency: 'daily', interval: 1, endMode: 'until', endDate: '2026-01-04' },
        '2026-01-05',
      ),
    ).toThrow('before');
    expect(
      recurrenceSummary({
        frequency: 'monthlyOrdinal',
        interval: 1,
        ordinal: -1,
        ordinalWeekday: 5,
        endMode: 'never',
      }),
    ).toContain('last Friday');
  });
});
