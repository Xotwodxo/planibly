import {
  capacityForDate,
  capacitySummaryForDate,
  effectivePlannedDate,
  planningSourcesForHorizon,
  previouslyPlannedTasks,
  sevenDayHorizon,
  type CapacitySummary,
  type HorizonDay,
  type PlanningSources,
} from './agenda';
import { eventsForDate } from './calendar';
import { projectNextActionsFromSnapshot, type ProjectNextAction } from './dashboard';
import { addCalendarDays, isLocalDate, localDateFromDate } from './planning';
import { expandCalendarOccurrences } from './recurrence';
import { routinesForDate, type RoutineForDate } from './routine';
import type {
  CalendarOccurrence,
  PlannerSnapshot,
  PlanningCapacityRecord,
  TaskRecord,
} from './plannerTypes';
import type { RoutineRunRecord } from './routineTypes';
import {
  REVIEW_PREFERENCES_ID,
  REVIEW_TYPES,
  type ReviewActionPreview,
  type ReviewCapacityImpact,
  type ReviewPreferencesRecord,
  type ReviewRecord,
  type ReviewSectionKey,
  type ReviewTaskAction,
  type ReviewType,
} from './reviewTypes';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const REVIEW_SECTIONS: readonly ReviewSectionKey[] = [
  'calendar',
  'plannedTasks',
  'deadlines',
  'previouslyPlanned',
  'routines',
  'focus',
  'capacity',
  'withoutDuration',
  'projectNextActions',
  'completed',
];

export function defaultReviewPreferences(now: string): ReviewPreferencesRecord {
  return {
    id: REVIEW_PREFERENCES_ID,
    morningEnabled: true,
    eveningEnabled: true,
    weekAheadEnabled: true,
    morningTime: '08:00',
    eveningTime: '18:00',
    weekAheadWeekday: 0,
    weekAheadTime: '09:00',
    showOnHome: false,
    showCompletedSummary: true,
    visibleSections: Object.fromEntries(REVIEW_SECTIONS.map((key) => [key, true])) as Record<
      ReviewSectionKey,
      boolean
    >,
    expandedSections: Object.fromEntries(
      REVIEW_SECTIONS.map((key) => [key, key === 'plannedTasks' || key === 'calendar']),
    ) as Record<ReviewSectionKey, boolean>,
    createdAt: now,
    modifiedAt: now,
  };
}

function isBooleanMap(value: unknown): value is Record<ReviewSectionKey, boolean> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return REVIEW_SECTIONS.every((key) => typeof record[key] === 'boolean');
}

export function isValidReviewPreferences(value: unknown): value is ReviewPreferencesRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ReviewPreferencesRecord;
  return (
    record.id === REVIEW_PREFERENCES_ID &&
    typeof record.morningEnabled === 'boolean' &&
    typeof record.eveningEnabled === 'boolean' &&
    typeof record.weekAheadEnabled === 'boolean' &&
    TIME_PATTERN.test(record.morningTime) &&
    TIME_PATTERN.test(record.eveningTime) &&
    Number.isInteger(record.weekAheadWeekday) &&
    record.weekAheadWeekday >= 0 &&
    record.weekAheadWeekday <= 6 &&
    TIME_PATTERN.test(record.weekAheadTime) &&
    typeof record.showOnHome === 'boolean' &&
    typeof record.showCompletedSummary === 'boolean' &&
    isBooleanMap(record.visibleSections) &&
    isBooleanMap(record.expandedSections)
  );
}

export function normalizeReviewPreferences(value: unknown, now: string): ReviewPreferencesRecord {
  if (!isValidReviewPreferences(value)) return defaultReviewPreferences(now);
  return {
    ...value,
    visibleSections: { ...value.visibleSections },
    expandedSections: { ...value.expandedSections },
    modifiedAt: now,
  };
}

export function isValidReviewRecord(value: unknown): value is ReviewRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ReviewRecord;
  return (
    Boolean(record.id) &&
    REVIEW_TYPES.includes(record.type) &&
    isLocalDate(record.periodStart) &&
    isLocalDate(record.periodEnd) &&
    record.periodEnd >= record.periodStart &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    Number.isFinite(Date.parse(record.modifiedAt)) &&
    (record.finishedAt === undefined || Number.isFinite(Date.parse(record.finishedAt))) &&
    record.version === 1
  );
}

export function reviewPeriod(
  type: ReviewType,
  localDate: string,
): {
  periodStart: string;
  periodEnd: string;
} {
  if (!isLocalDate(localDate)) throw new Error('Choose a valid review date.');
  return {
    periodStart: localDate,
    periodEnd: type === 'weekAhead' ? addCalendarDays(localDate, 6) : localDate,
  };
}

export function localDateForTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? localDateFromDate(date) : undefined;
}

function visibleTasks(snapshot: PlannerSnapshot): TaskRecord[] {
  const listIds = new Set(snapshot.lists.map((list) => list.id));
  return snapshot.tasks.filter((task) => listIds.has(task.listId));
}

export type MorningSummary = {
  localDate: string;
  events: CalendarOccurrence[];
  plannedTasks: TaskRecord[];
  overdueDeadlines: TaskRecord[];
  previouslyPlanned: TaskRecord[];
  routines: RoutineForDate[];
  activeFocusTask?: TaskRecord;
  capacity: CapacitySummary;
  tasksWithoutDuration: TaskRecord[];
  projectNextActions: ProjectNextAction[];
};

export function morningSummary(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  localDate: string,
): MorningSummary {
  const active = visibleTasks(snapshot).filter((task) => task.status !== 'completed');
  const plannedTasks = active.filter((task) => effectivePlannedDate(snapshot, task) === localDate);
  return {
    localDate,
    events: eventsForDate(expandCalendarOccurrences(snapshot, localDate, localDate), localDate),
    plannedTasks,
    overdueDeadlines: active.filter(
      (task) => task.deadlineDate !== undefined && task.deadlineDate < localDate,
    ),
    previouslyPlanned: previouslyPlannedTasks(snapshot, localDate),
    routines: routinesForDate(snapshot, localDate),
    activeFocusTask: snapshot.activeFocus
      ? active.find((task) => task.id === snapshot.activeFocus?.taskId)
      : undefined,
    capacity: capacitySummaryForDate(snapshot, capacities, localDate),
    tasksWithoutDuration: plannedTasks.filter(
      (task) => task.estimatedDurationMinutes === undefined,
    ),
    projectNextActions: projectNextActionsFromSnapshot(snapshot),
  };
}

export type CompletedTaskSummary = {
  tasks: TaskRecord[];
  historicalCompletedWithoutTimestampCount: number;
};

export function completedTasksForDate(
  snapshot: PlannerSnapshot,
  localDate: string,
): CompletedTaskSummary {
  const completed = visibleTasks(snapshot).filter((task) => task.status === 'completed');
  return {
    tasks: completed.filter((task) =>
      task.completedAt ? localDateForTimestamp(task.completedAt) === localDate : false,
    ),
    historicalCompletedWithoutTimestampCount: completed.filter((task) => !task.completedAt).length,
  };
}

export type EveningReview = {
  localDate: string;
  completedTasks: CompletedTaskSummary;
  completedRoutineRuns: RoutineRunRecord[];
  skippedRoutineRuns: RoutineRunRecord[];
  incompletePlannedTasks: TaskRecord[];
  events: CalendarOccurrence[];
  activeFocusTask?: TaskRecord;
  tomorrow: MorningSummary;
};

export function eveningReview(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  localDate: string,
): EveningReview {
  const active = visibleTasks(snapshot).filter((task) => task.status !== 'completed');
  const tomorrowDate = addCalendarDays(localDate, 1);
  return {
    localDate,
    completedTasks: completedTasksForDate(snapshot, localDate),
    completedRoutineRuns: snapshot.routineRuns.filter(
      (run) => run.localDate === localDate && run.status === 'completed',
    ),
    skippedRoutineRuns: snapshot.routineRuns.filter(
      (run) => run.localDate === localDate && run.status === 'skipped',
    ),
    incompletePlannedTasks: active.filter(
      (task) => effectivePlannedDate(snapshot, task) === localDate,
    ),
    events: eventsForDate(expandCalendarOccurrences(snapshot, localDate, localDate), localDate),
    activeFocusTask: snapshot.activeFocus
      ? active.find((task) => task.id === snapshot.activeFocus?.taskId)
      : undefined,
    tomorrow: morningSummary(snapshot, capacities, tomorrowDate),
  };
}

export type WeekAheadSummary = {
  startDate: string;
  endDate: string;
  days: (HorizonDay & { events: CalendarOccurrence[]; routines: RoutineForDate[] })[];
  sources: PlanningSources;
  genuineDeadlines: TaskRecord[];
  blockedTasks: TaskRecord[];
  projectNextActions: ProjectNextAction[];
  completed: CompletedTaskSummary;
  completedRoutineRuns: RoutineRunRecord[];
};

export function weekAheadSummary(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  startDate: string,
): WeekAheadSummary {
  const endDate = addCalendarDays(startDate, 6);
  const occurrences = expandCalendarOccurrences(snapshot, startDate, endDate);
  const active = visibleTasks(snapshot).filter((task) => task.status !== 'completed');
  const completedTasks = Array.from({ length: 7 }, (_, index) =>
    completedTasksForDate(snapshot, addCalendarDays(startDate, index)),
  );
  return {
    startDate,
    endDate,
    days: sevenDayHorizon(snapshot, capacities, startDate).map((day) => ({
      ...day,
      events: eventsForDate(occurrences, day.localDate),
      routines: routinesForDate(snapshot, day.localDate),
    })),
    sources: planningSourcesForHorizon(snapshot, startDate),
    genuineDeadlines: active.filter(
      (task) =>
        task.deadlineDate !== undefined &&
        task.deadlineDate >= startDate &&
        task.deadlineDate <= endDate,
    ),
    blockedTasks: active.filter((task) => (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0),
    projectNextActions: projectNextActionsFromSnapshot(snapshot),
    completed: {
      tasks: completedTasks.flatMap((summary) => summary.tasks),
      historicalCompletedWithoutTimestampCount: Math.max(
        0,
        ...completedTasks.map((summary) => summary.historicalCompletedWithoutTimestampCount),
      ),
    },
    completedRoutineRuns: snapshot.routineRuns.filter(
      (run) => run.status === 'completed' && run.localDate >= startDate && run.localDate <= endDate,
    ),
  };
}

export function previewReviewActions(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  actions: readonly ReviewTaskAction[],
): ReviewActionPreview {
  const taskById = new Map(visibleTasks(snapshot).map((task) => [task.id, task]));
  const seen = new Set<string>();
  const items = actions.map((action) => {
    const task = taskById.get(action.taskId);
    const currentDate = task ? effectivePlannedDate(snapshot, task) : undefined;
    const blocked = task ? (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0 : false;
    let reason: string | undefined;
    if (seen.has(action.taskId)) reason = 'Choose one change for each task.';
    else if (!task || task.deletedAt) reason = 'This task is no longer available.';
    else if (task.status === 'completed') reason = 'Completed tasks cannot be replanned here.';
    else if (action.kind === 'move' && !action.targetDate) reason = 'Choose a destination date.';
    else if (action.kind === 'move' && !isLocalDate(action.targetDate ?? ''))
      reason = 'Choose a valid destination date.';
    else if (
      action.kind === 'move' &&
      task?.flexibleStartDate &&
      ((action.targetDate ?? '') < task.flexibleStartDate ||
        (action.targetDate ?? '') > (task.flexibleEndDate ?? ''))
    )
      reason = `Choose a date from ${task.flexibleStartDate} to ${task.flexibleEndDate}.`;
    seen.add(action.taskId);
    return {
      taskId: action.taskId,
      title: task?.title ?? 'Unavailable task',
      currentDate,
      proposedDate: action.kind === 'move' ? action.targetDate : undefined,
      kind: action.kind,
      valid: reason === undefined,
      unchanged:
        action.kind === 'leave' || (action.kind === 'move' && currentDate === action.targetDate),
      blocked,
      reason,
      estimatedDurationMinutes: task?.estimatedDurationMinutes,
    };
  });
  const relevantDates = new Set<string>();
  for (const item of items) {
    if (item.currentDate) relevantDates.add(item.currentDate);
    if (item.proposedDate) relevantDates.add(item.proposedDate);
  }
  const before = new Map(
    [...relevantDates].map((date) => [
      date,
      capacitySummaryForDate(snapshot, capacities, date).estimatedMinutes,
    ]),
  );
  const after = new Map(before);
  for (const item of items.filter((candidate) => candidate.valid && !candidate.unchanged)) {
    const minutes = item.estimatedDurationMinutes ?? 0;
    if (item.currentDate) after.set(item.currentDate, (after.get(item.currentDate) ?? 0) - minutes);
    if (item.kind === 'move' && item.proposedDate)
      after.set(item.proposedDate, (after.get(item.proposedDate) ?? 0) + minutes);
  }
  const capacity: ReviewCapacityImpact[] = [...relevantDates].sort().map((localDate) => {
    const availableMinutes = capacityForDate(capacities, localDate);
    const afterMinutes = Math.max(0, after.get(localDate) ?? 0);
    return {
      localDate,
      availableMinutes,
      beforeMinutes: Math.max(0, before.get(localDate) ?? 0),
      afterMinutes,
      overMinutes: availableMinutes === null ? 0 : Math.max(0, afterMinutes - availableMinutes),
    };
  });
  return { items, capacity, canApply: items.length > 0 && items.every((item) => item.valid) };
}

export type ReviewAvailability = {
  type: ReviewType;
  enabled: boolean;
  due: boolean;
  started: boolean;
  finished: boolean;
  dismissed: boolean;
};

export function reviewAvailability(
  preferences: ReviewPreferencesRecord,
  records: readonly ReviewRecord[],
  dismissedKeys: ReadonlySet<string>,
  now: Date,
  periodStart = localDateFromDate(now),
): ReviewAvailability[] {
  const today = localDateFromDate(now);
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return REVIEW_TYPES.map((type) => {
    const enabled =
      type === 'morning'
        ? preferences.morningEnabled
        : type === 'evening'
          ? preferences.eveningEnabled
          : preferences.weekAheadEnabled;
    const due =
      periodStart === today &&
      enabled &&
      preferences.showOnHome &&
      (type === 'morning'
        ? time >= preferences.morningTime
        : type === 'evening'
          ? time >= preferences.eveningTime
          : now.getDay() === preferences.weekAheadWeekday && time >= preferences.weekAheadTime);
    const record = records.find(
      (candidate) => candidate.type === type && candidate.periodStart === periodStart,
    );
    return {
      type,
      enabled,
      due,
      started: Boolean(record),
      finished: Boolean(record?.finishedAt),
      dismissed: dismissedKeys.has(`${type}:${periodStart}`),
    };
  });
}
