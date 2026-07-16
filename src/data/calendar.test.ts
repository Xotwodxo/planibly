import { describe, expect, it } from 'vitest';
import {
  eventsForDate,
  monthGrid,
  timeOverlaps,
  upcomingEvents,
  validateCalendarEvent,
  visibleCalendarEvents,
} from './calendar';

describe('calendar date semantics', () => {
  const event = {
    id: 'event',
    calendarId: 'calendar',
    title: 'Trip',
    startDate: '2026-03-28',
    endDate: '2026-03-30',
    allDay: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  };
  it('keeps inclusive all-day spans stable over local DST dates', () =>
    expect(eventsForDate([event], '2026-03-29')).toEqual([event]));
  it('rejects invalid timed event ranges', () =>
    expect(() =>
      validateCalendarEvent({
        ...event,
        allDay: false,
        startDate: '2026-03-29',
        endDate: '2026-03-29',
        startTime: '10:00',
        endTime: '09:00',
      }),
    ).toThrow('Timed events'));
  it('builds Monday-first grids across leap-year and year boundaries', () => {
    const february = monthGrid(2024, 1);
    expect(february[0]?.localDate).toBe('2024-01-29');
    expect(february.some((day) => day.localDate === '2024-02-29')).toBe(true);
    expect(monthGrid(2027, 0)[0]?.localDate).toBe('2026-12-28');
  });
  it('filters hidden calendars and retains ongoing upcoming spans', () => {
    const hidden = { ...event, id: 'hidden', calendarId: 'hidden' };
    const snapshot = {
      calendars: [
        {
          id: 'calendar',
          name: 'Shown',
          color: '#000',
          order: 0,
          isVisible: true,
          createdAt: 'x',
          modifiedAt: 'x',
        },
        {
          id: 'hidden',
          name: 'Hidden',
          color: '#000',
          order: 1,
          isVisible: false,
          createdAt: 'x',
          modifiedAt: 'x',
        },
      ],
      calendarEvents: [event, hidden],
    };
    expect(visibleCalendarEvents(snapshot)).toEqual([event]);
    expect(upcomingEvents([event], '2026-03-29', 2)).toEqual([event]);
  });
  it('detects event and exact-task overlaps without moving records', () => {
    const timedEvent = {
      ...event,
      id: 'timed',
      allDay: false,
      startDate: '2026-03-29',
      endDate: '2026-03-29',
      startTime: '09:00',
      endTime: '10:00',
    };
    const other = {
      ...timedEvent,
      id: 'other',
      title: 'Call',
      startTime: '09:30',
      endTime: '11:00',
    };
    const task = {
      id: 'task',
      title: 'Focus',
      listId: 'list',
      status: 'available' as const,
      order: 0,
      exactStartTime: '09:45',
      estimatedDurationMinutes: 30,
      createdAt: 'x',
      modifiedAt: 'x',
    };
    expect(timeOverlaps([timedEvent, other], [task], '2026-03-29')).toHaveLength(3);
  });
});
