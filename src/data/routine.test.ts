import {
  mostRecentPreviouslyScheduled,
  routineItemsForDate,
  routineScheduleMatches,
  routinesForDate,
  routineVariantForDate,
  runProgress,
  weekdayForRoutineDate,
} from './routine';
import type {
  RoutineItemRecord,
  RoutineRecord,
  RoutineRunItemRecord,
  RoutineSnapshot,
  RoutineVariantRecord,
} from './routineTypes';

const timestamp = '2026-07-18T08:00:00.000Z';

function routine(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return {
    id: 'routine-1',
    name: 'Morning routine',
    color: '#5B67C8',
    isActive: true,
    presentationStyle: 'checklist',
    scheduleKind: 'daily',
    selectedWeekdays: [],
    defaultSection: 'morning',
    order: 0,
    createdAt: timestamp,
    modifiedAt: timestamp,
    ...overrides,
  };
}

function item(id: string, order: number): RoutineItemRecord {
  return {
    id,
    routineId: 'routine-1',
    title: id,
    order,
    isActive: true,
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

function snapshot(overrides: Partial<RoutineSnapshot> = {}): RoutineSnapshot {
  return {
    routines: [routine()],
    routineItems: [item('item-1', 0), item('item-2', 1)],
    routineVariants: [],
    routineRuns: [],
    routineRunItems: [],
    routineOccurrenceAdjustments: [],
    deletedRoutines: [],
    deletedRoutineItems: [],
    ...overrides,
  };
}

describe('routine local-calendar rules', () => {
  it('matches weekdays without timezone shifts across leap-year, DST, month, and year boundaries', () => {
    expect(weekdayForRoutineDate('2024-02-29')).toBe(4);
    expect(weekdayForRoutineDate('2026-03-29')).toBe(0);
    expect(weekdayForRoutineDate('2026-10-25')).toBe(0);
    expect(weekdayForRoutineDate('2026-12-31')).toBe(4);
    expect(weekdayForRoutineDate('2027-01-01')).toBe(5);

    expect(routineScheduleMatches(routine({ scheduleKind: 'weekdays' }), '2027-01-01')).toBe(true);
    expect(routineScheduleMatches(routine({ scheduleKind: 'weekends' }), '2026-03-29')).toBe(true);
    expect(
      routineScheduleMatches(
        routine({ scheduleKind: 'selected', selectedWeekdays: [4] }),
        '2024-02-29',
      ),
    ).toBe(true);
    expect(routineScheduleMatches(routine({ scheduleKind: 'manual' }), '2026-07-18')).toBe(false);
    expect(routineScheduleMatches(routine({ isActive: false }), '2026-07-18')).toBe(false);
  });

  it('uses an explicit day variant for item inclusion, ordering, and style', () => {
    const items = [item('item-1', 0), item('item-2', 1), item('item-3', 2)];
    const variants: RoutineVariantRecord[] = [
      {
        id: 'variant-1',
        routineId: 'routine-1',
        name: 'Weekend',
        weekdays: [6],
        itemIds: ['item-3', 'item-1'],
        presentationStyle: 'compact',
        order: 0,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ];
    const variant = routineVariantForDate('routine-1', variants, '2026-07-18');

    expect(variant?.name).toBe('Weekend');
    expect(routineItemsForDate(routine(), items, variant).map((entry) => entry.id)).toEqual([
      'item-3',
      'item-1',
    ]);
  });

  it('moves only the selected occurrence and reports progress from immutable run items', () => {
    const data = snapshot({
      routineOccurrenceAdjustments: [
        {
          id: 'adjustment-1',
          routineId: 'routine-1',
          originalDate: '2026-07-17',
          destinationDate: '2026-07-19',
          createdAt: timestamp,
          modifiedAt: timestamp,
        },
      ],
    });
    expect(routinesForDate(data, '2026-07-17')).toHaveLength(0);
    expect(routinesForDate(data, '2026-07-19')[0]?.movedFromDate).toBe('2026-07-17');

    const runItems: RoutineRunItemRecord[] = [
      {
        id: 'run-item-1',
        runId: 'run-1',
        title: 'First',
        order: 0,
        completedAt: timestamp,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      {
        id: 'run-item-2',
        runId: 'run-1',
        title: 'Second',
        order: 1,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ];
    expect(
      runProgress(
        {
          id: 'run-1',
          routineId: 'routine-1',
          routineName: 'Snapshot name',
          routineColor: '#5B67C8',
          localDate: '2026-07-19',
          presentationStyle: 'checklist',
          status: 'inProgress',
          startedAt: timestamp,
          modifiedAt: timestamp,
        },
        runItems,
      ),
    ).toMatchObject({ completed: 1, total: 2, currentItem: { title: 'Second' } });
  });

  it('returns one neutral, most-recent unmatched occurrence per routine', () => {
    const data = snapshot({
      routineRuns: [
        {
          id: 'run-1',
          routineId: 'routine-1',
          routineName: 'Morning routine',
          routineColor: '#5B67C8',
          localDate: '2026-07-17',
          presentationStyle: 'checklist',
          status: 'completed',
          startedAt: timestamp,
          completedAt: timestamp,
          modifiedAt: timestamp,
        },
      ],
    });
    expect(mostRecentPreviouslyScheduled(data, '2026-07-18')).toEqual([
      { routine: data.routines[0], localDate: '2026-07-16' },
    ]);
  });
});
