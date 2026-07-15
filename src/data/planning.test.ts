import {
  addCalendarDays,
  isLocalDate,
  PlanningValidationError,
  validatePlanning,
} from './planning';

describe('local calendar planning', () => {
  it('uses stable date-only arithmetic across DST, month, leap-year, and year boundaries', () => {
    expect(addCalendarDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addCalendarDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-11-31')).toBe(false);
  });

  it('accepts valid optional combinations without inventing defaults', () => {
    expect(validatePlanning({})).toEqual({});
    expect(validatePlanning({ deadlineDate: '2026-05-01' })).toEqual({
      deadlineDate: '2026-05-01',
    });
    expect(
      validatePlanning({
        plannedDate: '2026-04-10',
        timeWindow: 'morning',
        estimatedDurationMinutes: 45,
      }),
    ).toMatchObject({ plannedDate: '2026-04-10', timeWindow: 'morning' });
    expect(
      validatePlanning({ flexibleStartDate: '2026-04-11', flexibleEndDate: '2026-04-12' }),
    ).toMatchObject({ flexibleStartDate: '2026-04-11', flexibleEndDate: '2026-04-12' });
  });

  it.each([
    [{ timeWindow: 'evening' as const }, 'planned day'],
    [{ exactStartTime: '09:30' }, 'planned day'],
    [
      { plannedDate: '2026-04-10', timeWindow: 'morning' as const, exactStartTime: '09:30' },
      'either a time window',
    ],
    [
      {
        plannedDate: '2026-04-10',
        flexibleStartDate: '2026-04-11',
        flexibleEndDate: '2026-04-12',
      },
      'either a planned day',
    ],
    [{ flexibleStartDate: '2026-04-11' }, 'both a start and end'],
    [{ flexibleStartDate: '2026-04-12', flexibleEndDate: '2026-04-11' }, 'end on or after'],
    [{ plannedDate: '2026-02-29' }, 'valid local date'],
    [{ plannedDate: '2026-04-10', exactStartTime: '24:00' }, 'valid local start time'],
    [{ estimatedDurationMinutes: 0 }, 'positive whole number'],
    [{ estimatedDurationMinutes: 2.5 }, 'positive whole number'],
  ])('rejects invalid planning %#', (input, message) => {
    expect(() => validatePlanning(input)).toThrow(PlanningValidationError);
    expect(() => validatePlanning(input)).toThrow(message);
  });
});
