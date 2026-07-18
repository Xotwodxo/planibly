import type { PlannerSnapshot, TaskRecord } from './plannerTypes';
import {
  completedTasksForDate,
  defaultReviewPreferences,
  eveningReview,
  isValidReviewPreferences,
  morningSummary,
  previewReviewActions,
  reviewAvailability,
  reviewPeriod,
  weekAheadSummary,
} from './review';

const stamp = '2026-07-18T09:00:00.000Z';

function task(id: string, title: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    title,
    listId: 'list',
    status: 'available',
    order: 0,
    createdAt: stamp,
    modifiedAt: stamp,
    ...overrides,
  };
}

function snapshot(tasks: TaskRecord[] = []): PlannerSnapshot {
  return {
    areas: [],
    lists: [
      {
        id: 'list',
        areaId: null,
        name: 'List',
        color: '#5B67C8',
        order: 0,
        createdAt: stamp,
        modifiedAt: stamp,
      },
    ],
    archivedProjects: [],
    tasks,
    taskSteps: [],
    tags: [],
    taskTags: [],
    taskRelationships: [],
    plannedPlacements: tasks
      .filter((item) => item.plannedDate)
      .map((item) => ({
        id: item.id,
        taskId: item.id,
        localDate: item.plannedDate!,
        group: 'anyTime' as const,
        order: item.order,
        source: 'plannedDate' as const,
        createdAt: stamp,
        modifiedAt: stamp,
      })),
    calendars: [],
    calendarEvents: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    eventTemplates: [],
    routines: [],
    routineItems: [],
    routineVariants: [],
    routineRuns: [],
    routineRunItems: [],
    routineOccurrenceAdjustments: [],
    taskStartingDetails: [],
    taskPrepItems: [],
    activeFocus: undefined,
    blockedByTaskId: {},
    projectProgressByListId: {},
    deletedAreas: [],
    deletedLists: [],
    deletedTasks: [],
    deletedSteps: [],
    deletedCalendars: [],
    deletedCalendarEvents: [],
    deletedEventTemplates: [],
    deletedRoutines: [],
    deletedRoutineItems: [],
    deletedPrepItems: [],
  };
}

describe('Phase 4C review queries', () => {
  it('recovers calm preference defaults and keeps in-app availability optional', () => {
    const preferences = defaultReviewPreferences(stamp);
    expect(isValidReviewPreferences(preferences)).toBe(true);
    expect(preferences.showOnHome).toBe(false);
    expect(preferences.showCompletedSummary).toBe(true);
    expect(
      reviewAvailability(preferences, [], new Set(), new Date('2026-07-18T20:00:00')).every(
        (item) => !item.due,
      ),
    ).toBe(true);
  });

  it('reports lifecycle state for the controlled review date without calling it due today', () => {
    const preferences = { ...defaultReviewPreferences(stamp), showOnHome: true };
    const availability = reviewAvailability(
      preferences,
      [
        {
          id: 'review-id',
          type: 'morning',
          periodStart: '2026-07-12',
          periodEnd: '2026-07-12',
          startedAt: stamp,
          finishedAt: stamp,
          modifiedAt: stamp,
          version: 1,
        },
      ],
      new Set(),
      new Date('2026-07-18T20:00:00'),
      '2026-07-12',
    );

    expect(availability.find(({ type }) => type === 'morning')).toMatchObject({
      started: true,
      finished: true,
      due: false,
    });
  });

  it('separates previously planned tasks from genuine overdue deadlines', () => {
    const data = snapshot([
      task('earlier', 'Earlier plan', { plannedDate: '2026-07-17' }),
      task('deadline', 'True overdue', { deadlineDate: '2026-07-17' }),
      task('today', 'Today task', { plannedDate: '2026-07-18' }),
    ]);
    const summary = morningSummary(data, [], '2026-07-18');
    expect(summary.previouslyPlanned.map(({ id }) => id)).toEqual(['earlier']);
    expect(summary.overdueDeadlines.map(({ id }) => id)).toEqual(['deadline']);
    expect(summary.plannedTasks.map(({ id }) => id)).toEqual(['today']);
  });

  it('classifies evening completion honestly and includes tomorrow without moving anything', () => {
    const data = snapshot([
      task('done', 'Finished today', {
        status: 'completed',
        completedAt: '2026-07-18T12:00:00.000Z',
      }),
      task('historical', 'Historical completion', { status: 'completed' }),
      task('unfinished', 'Still here', { plannedDate: '2026-07-18' }),
      task('tomorrow', 'Tomorrow', { plannedDate: '2026-07-19' }),
    ]);
    const review = eveningReview(data, [], '2026-07-18');
    expect(review.completedTasks.tasks.map(({ id }) => id)).toEqual(['done']);
    expect(review.completedTasks.historicalCompletedWithoutTimestampCount).toBe(1);
    expect(review.incompletePlannedTasks.map(({ id }) => id)).toEqual(['unfinished']);
    expect(review.tomorrow.plannedTasks.map(({ id }) => id)).toEqual(['tomorrow']);
    expect(completedTasksForDate(data, '2026-07-17').tasks).toEqual([]);
  });

  it.each([
    ['month', '2026-01-29', '2026-02-04'],
    ['year', '2026-12-29', '2027-01-04'],
    ['leap', '2028-02-27', '2028-03-04'],
    ['spring DST', '2026-03-27', '2026-04-02'],
    ['autumn DST', '2026-10-23', '2026-10-29'],
  ])('keeps a seven-day local range across %s boundaries', (_label, start, end) => {
    const summary = weekAheadSummary(snapshot(), [], start);
    expect(summary.endDate).toBe(end);
    expect(summary.days).toHaveLength(7);
    expect(summary.days.at(-1)?.localDate).toBe(end);
    expect(reviewPeriod('weekAhead', start)).toEqual({ periodStart: start, periodEnd: end });
  });

  it('reports factual weekly task and routine totals without guessing historical task dates', () => {
    const data = snapshot([
      task('weekly-done', 'Done in week', {
        status: 'completed',
        completedAt: '2026-07-20T12:00:00.000Z',
      }),
      task('weekly-historical', 'Historical', { status: 'completed' }),
    ]);
    data.routineRuns.push({
      id: 'weekly-run',
      routineId: 'routine',
      routineName: 'Morning reset',
      routineColor: '#5B67C8',
      localDate: '2026-07-21',
      presentationStyle: 'checklist',
      status: 'completed',
      startedAt: stamp,
      completedAt: stamp,
      modifiedAt: stamp,
    });

    const summary = weekAheadSummary(data, [], '2026-07-18');
    expect(summary.completed.tasks.map(({ id }) => id)).toEqual(['weekly-done']);
    expect(summary.completed.historicalCompletedWithoutTimestampCount).toBe(1);
    expect(summary.completedRoutineRuns.map(({ id }) => id)).toEqual(['weekly-run']);
  });

  it('validates flexible placement, blocked planning, unchanged items, and capacity guidance', () => {
    const flexible = task('flexible', 'Flexible', {
      flexibleStartDate: '2026-07-20',
      flexibleEndDate: '2026-07-22',
      estimatedDurationMinutes: 60,
    });
    const blocked = task('blocked', 'Blocked but plannable', { estimatedDurationMinutes: 30 });
    const data = snapshot([flexible, blocked]);
    data.blockedByTaskId.blocked = ['predecessor'];
    const preview = previewReviewActions(
      data,
      [
        {
          id: 'capacity',
          kind: 'date',
          localDate: '2026-07-21',
          minutes: 45,
          createdAt: stamp,
          modifiedAt: stamp,
        },
      ],
      [
        { taskId: flexible.id, kind: 'move', targetDate: '2026-07-19' },
        { taskId: blocked.id, kind: 'move', targetDate: '2026-07-21' },
        { taskId: 'missing', kind: 'leave' },
      ],
    );
    expect(preview.items[0]).toMatchObject({ valid: false });
    expect(preview.items[1]).toMatchObject({
      valid: true,
      blocked: true,
      proposedDate: '2026-07-21',
    });
    expect(preview.items[2]).toMatchObject({ valid: false, unchanged: true });
    expect(preview.capacity.find((item) => item.localDate === '2026-07-21')).toMatchObject({
      afterMinutes: 30,
      overMinutes: 0,
    });
    expect(preview.canApply).toBe(false);
  });
});
