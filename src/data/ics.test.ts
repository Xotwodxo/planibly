import {
  exportIcsCalendar,
  exportStandaloneOccurrence,
  foldLine,
  ICS_IMPORT_LIMITS,
  IcsValidationError,
  parseIcs,
} from './ics';
import type { CalendarEventRecord, RecurrenceExceptionRecord } from './plannerTypes';

function calendar(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Fictional diary',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function event(...properties: string[]): string {
  return ['BEGIN:VEVENT', ...properties, 'END:VEVENT'].join('\r\n');
}

const timestamp = '2026-07-01T08:00:00.000Z';
const localEvent: CalendarEventRecord = {
  id: 'fictional-event',
  calendarId: 'calendar',
  title: 'Tea, planning; and notes',
  startDate: '2026-07-16',
  endDate: '2026-07-16',
  allDay: false,
  startTime: '09:30',
  endTime: '10:15',
  location: 'Room \\ One',
  notes: 'First line\nSecond line',
  createdAt: timestamp,
  modifiedAt: timestamp,
};

describe('local ICS parsing', () => {
  it('imports a simple floating timed event and calendar name', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-1@example.test',
          'SUMMARY:Planning call',
          'DTSTART:20260716T093000',
          'DTEND:20260716T101500',
          'LOCATION:Study',
        ),
      ),
    );
    expect(parsed.calendarName).toBe('Fictional diary');
    expect(parsed.events[0]).toMatchObject({
      title: 'Planning call',
      startDate: '2026-07-16',
      startTime: '09:30',
      endTime: '10:15',
      timezoneKind: 'floating',
    });
  });

  it('keeps all-day dates stable and converts exclusive multi-day DTEND to an inclusive end', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-days@example.test',
          'SUMMARY:House visit',
          'DTSTART;VALUE=DATE:20260701',
          'DTEND;VALUE=DATE:20260704',
        ),
      ),
    );
    expect(parsed.events[0]).toMatchObject({
      allDay: true,
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });
  });

  it('converts safe DURATION values and rejects ambiguous duration forms', () => {
    const safe = parseIcs(
      calendar(
        event(
          'UID:fictional-duration@example.test',
          'SUMMARY:Three day visit',
          'DTSTART;VALUE=DATE:20260701',
          'DURATION:P3D',
        ),
      ),
    );
    expect(safe.events[0]?.endDate).toBe('2026-07-03');
    const unsafe = parseIcs(
      calendar(
        event(
          'UID:fictional-unsafe-duration@example.test',
          'SUMMARY:Ambiguous visit',
          'DTSTART;VALUE=DATE:20260701',
          'DURATION:P1DT1H',
        ),
      ),
    );
    expect(unsafe.events).toHaveLength(0);
    expect(unsafe.invalidRecords).toBe(1);
    expect(unsafe.warnings.join(' ')).toContain('could not be converted safely');
  });

  it('converts UTC deliberately into the device local calendar fields', () => {
    const instant = new Date('2026-07-16T08:30:00.000Z');
    const expectedDate = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    const expectedTime = `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-utc@example.test',
          'SUMMARY:UTC event',
          'DTSTART:20260716T083000Z',
          'DTEND:20260716T093000Z',
        ),
      ),
    );
    expect(parsed.events[0]).toMatchObject({
      startDate: expectedDate,
      startTime: expectedTime,
      timezoneKind: 'utc',
    });
  });

  it('interprets supported TZIDs and handles UK autumn DST ambiguity deterministically', () => {
    const expected = new Date('2026-10-25T00:30:00.000Z');
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-dst@example.test',
          'SUMMARY:Autumn event',
          'DTSTART;TZID=Europe/London:20261025T013000',
          'DTEND;TZID=Europe/London:20261025T023000',
        ),
      ),
    );
    expect(parsed.events[0]?.unresolvedTimezone).toBeUndefined();
    expect(parsed.events[0]?.sourceTimezone).toBe('Europe/London');
    expect(parsed.events[0]?.startTime).toBe(
      `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`,
    );
  });

  it('requires an explicit choice for a nonexistent UK spring DST wall-clock time', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-spring@example.test',
          'SUMMARY:Spring event',
          'DTSTART;TZID=Europe/London:20260329T013000',
          'DTEND;TZID=Europe/London:20260329T023000',
        ),
      ),
    );
    expect(parsed.events[0]?.unresolvedTimezone).toBe('Europe/London');
    expect(parsed.events[0]?.warnings.join(' ')).toContain('choose wall-clock import or skip');
  });

  it('maps supported recurrence, exclusions and occurrence overrides', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-series@example.test',
          'SUMMARY:Weekly review',
          'DTSTART:20260706T090000',
          'DTEND:20260706T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
          'EXDATE:20260713T090000',
        ),
        event(
          'UID:fictional-series@example.test',
          'RECURRENCE-ID:20260715T090000',
          'SUMMARY:Moved review',
          'DTSTART:20260716T110000',
          'DTEND:20260716T120000',
        ),
      ),
    );
    expect(parsed.events[0]?.recurrence).toMatchObject({
      frequency: 'weekly',
      weekdays: [1, 3],
      endMode: 'count',
      occurrenceCount: 6,
    });
    expect(parsed.events[0]?.exclusionDates).toEqual(['2026-07-13']);
    expect(parsed.events[1]).toMatchObject({
      recurrenceId: '2026-07-15',
      startDate: '2026-07-16',
    });
  });

  it('reports unsupported recurrence without flattening it', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-complex@example.test',
          'SUMMARY:Complex series',
          'DTSTART:20260701T090000',
          'DTEND:20260701T100000',
          'RRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=MO',
        ),
      ),
    );
    expect(parsed.events).toHaveLength(0);
    expect(parsed.unsupportedRecords).toBe(1);
    expect(parsed.warnings.join(' ')).toContain('unsupported recurrence');
  });

  it('ignores VTODO and alarms rather than creating tasks or reminders', () => {
    const parsed = parseIcs(
      calendar(
        ['BEGIN:VTODO', 'UID:fictional-task', 'SUMMARY:Do not import', 'END:VTODO'].join('\r\n'),
        event(
          'UID:fictional-alarm@example.test',
          'SUMMARY:Appointment',
          'DTSTART:20260701T090000',
          'DTEND:20260701T100000',
          'BEGIN:VALARM',
          'TRIGGER:-PT15M',
          'END:VALARM',
        ),
      ),
    );
    expect(parsed.unsupportedRecords).toBe(1);
    expect(parsed.events).toHaveLength(1);
  });

  it('treats script-like imported content as inert plain text', () => {
    const parsed = parseIcs(
      calendar(
        event(
          'UID:fictional-plain@example.test',
          'SUMMARY:<script>alert(1)</script>',
          'DESCRIPTION:<img src=x onerror=alert(1)>',
          'DTSTART;VALUE=DATE:20260701',
        ),
      ),
    );
    expect(parsed.events[0]?.title).toBe('<script>alert(1)</script>');
    expect(parsed.events[0]?.description).toBe('<img src=x onerror=alert(1)>');
  });

  it('rejects malformed and oversized files safely', () => {
    expect(() => parseIcs('not a calendar')).toThrow(IcsValidationError);
    expect(() => parseIcs(`BEGIN:VCALENDAR\n${'x'.repeat(ICS_IMPORT_LIMITS.bytes + 1)}`)).toThrow(
      '2 MB',
    );
  });
});

describe('ICS export', () => {
  it('exports a single event with stable UID, escaped text and floating wall-clock time', () => {
    const contents = exportIcsCalendar('Personal, notes', [{ event: localEvent }]);
    expect(contents).toContain('UID:fictional-event@planibly.local');
    expect(contents).toContain('SUMMARY:Tea\\, planning\\; and notes');
    expect(contents).toContain('LOCATION:Room \\\\ One');
    expect(contents).toContain('DTSTART:20260716T093000');
    const parsed = parseIcs(contents);
    expect(parsed.events[0]).toMatchObject({ title: localEvent.title });
    expect(parsed.events[0]?.description).toBe(localEvent.notes);
  });

  it('exports inclusive all-day ends as exclusive DATE DTEND values', () => {
    const contents = exportIcsCalendar('Trips', [
      {
        event: {
          ...localEvent,
          id: 'all-day',
          allDay: true,
          startDate: '2026-07-01',
          endDate: '2026-07-03',
          startTime: undefined,
          endTime: undefined,
        },
      },
    ]);
    expect(contents).toContain('DTEND;VALUE=DATE:20260704');
    expect(parseIcs(contents).events[0]?.endDate).toBe('2026-07-03');
  });

  it('exports recurrence, cancelled dates and overrides consistently', () => {
    const exceptions: RecurrenceExceptionRecord[] = [
      {
        id: 'cancelled',
        seriesEventId: localEvent.id,
        originalStartDate: '2026-07-23',
        kind: 'cancelled',
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      {
        id: 'override',
        seriesEventId: localEvent.id,
        originalStartDate: '2026-07-30',
        kind: 'override',
        title: 'Moved review',
        startDate: '2026-07-31',
        endDate: '2026-07-31',
        allDay: false,
        startTime: '11:00',
        endTime: '12:00',
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ];
    const contents = exportIcsCalendar('Reviews', [
      {
        event: localEvent,
        rule: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [4],
          endMode: 'count',
          occurrenceCount: 5,
        },
        exceptions,
      },
    ]);
    expect(contents).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=5');
    expect(contents).toContain('EXDATE:20260723T093000');
    expect(contents).toContain('RECURRENCE-ID:20260730T093000');
    const roundTrip = parseIcs(contents);
    expect(roundTrip.events).toHaveLength(2);
    expect(roundTrip.events[0]?.exclusionDates).toEqual(['2026-07-23']);
  });

  it('exports one occurrence as a standalone event without recurrence metadata', () => {
    const contents = exportStandaloneOccurrence({
      ...localEvent,
      id: 'fictional-event-2026-07-23',
      startDate: '2026-07-23',
      endDate: '2026-07-23',
    });
    expect(contents).toContain('UID:fictional-event-2026-07-23@planibly.local');
    expect(contents).not.toContain('RRULE:');
    expect(contents).not.toContain('RECURRENCE-ID:');
    expect(parseIcs(contents).events).toHaveLength(1);
  });

  it('folds long lines to at most 75 UTF-8 octets and round trips Unicode text', () => {
    const long = `DESCRIPTION:${'Fictional cafe note '.repeat(12)}`;
    const folded = foldLine(long);
    expect(folded.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const contents = exportIcsCalendar('Long notes', [
      { event: { ...localEvent, notes: 'Fictional cafe note '.repeat(12) } },
    ]);
    expect(parseIcs(contents).events[0]?.description).toBe(
      'Fictional cafe note '.repeat(12).trim(),
    );
  });
});
