import {
  INBOX_LIST_ID,
  type PlannerSnapshot,
  type PlanningOverview,
  type SmartListKey,
  type TaskPlanning,
  type TaskRecord,
  type TaskTimeWindow,
} from './plannerTypes';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WINDOW_ORDER: Record<TaskTimeWindow, number> = {
  morning: 600,
  afternoon: 1200,
  evening: 1800,
};

export class PlanningValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PlanningValidationError';
  }
}

export function localDateFromDate(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function isLocalDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function addCalendarDays(value: string, days: number): string {
  if (!isLocalDate(value)) throw new PlanningValidationError('Choose a valid date.');
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(result.getUTCFullYear()).padStart(4, '0'),
    String(result.getUTCMonth() + 1).padStart(2, '0'),
    String(result.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function formatLocalDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  if (!isLocalDate(value)) return value;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, options ?? { day: 'numeric', month: 'short' }).format(
    new Date(year, month - 1, day, 12),
  );
}

export function validatePlanning(input: TaskPlanning): TaskPlanning {
  const dates = [
    ['Planned day', input.plannedDate],
    ['Deadline', input.deadlineDate],
    ['Flexible start', input.flexibleStartDate],
    ['Flexible end', input.flexibleEndDate],
  ] as const;
  for (const [label, value] of dates) {
    if (value !== undefined && !isLocalDate(value)) {
      throw new PlanningValidationError(`${label} must be a valid local date.`);
    }
  }
  if (Boolean(input.flexibleStartDate) !== Boolean(input.flexibleEndDate)) {
    throw new PlanningValidationError('A flexible range needs both a start and end date.');
  }
  if (
    input.flexibleStartDate &&
    input.flexibleEndDate &&
    input.flexibleStartDate > input.flexibleEndDate
  ) {
    throw new PlanningValidationError('The flexible range must end on or after it starts.');
  }
  if (input.plannedDate && input.flexibleStartDate) {
    throw new PlanningValidationError('Choose either a planned day or a flexible date range.');
  }
  if ((input.timeWindow || input.exactStartTime) && !input.plannedDate) {
    throw new PlanningValidationError('Choose a planned day before adding a time.');
  }
  if (input.timeWindow && input.exactStartTime) {
    throw new PlanningValidationError('Choose either a time window or an exact start time.');
  }
  if (input.exactStartTime && !TIME_PATTERN.test(input.exactStartTime)) {
    throw new PlanningValidationError('Choose a valid local start time.');
  }
  if (
    input.estimatedDurationMinutes !== undefined &&
    (!Number.isInteger(input.estimatedDurationMinutes) || input.estimatedDurationMinutes <= 0)
  ) {
    throw new PlanningValidationError('Estimated duration must be a positive whole number.');
  }
  return { ...input };
}

function visibleActiveTasks(snapshot: PlannerSnapshot): TaskRecord[] {
  const listIds = new Set(snapshot.lists.map((list) => list.id));
  return snapshot.tasks.filter((task) => listIds.has(task.listId) && task.status !== 'completed');
}

function byPlan(left: TaskRecord, right: TaskRecord): number {
  const date = (left.plannedDate ?? '').localeCompare(right.plannedDate ?? '');
  if (date !== 0) return date;
  const leftTime = left.exactStartTime
    ? Number(left.exactStartTime.replace(':', ''))
    : left.timeWindow
      ? WINDOW_ORDER[left.timeWindow]
      : 0;
  const rightTime = right.exactStartTime
    ? Number(right.exactStartTime.replace(':', ''))
    : right.timeWindow
      ? WINDOW_ORDER[right.timeWindow]
      : 0;
  return leftTime - rightTime || left.order - right.order;
}

function byDeadline(left: TaskRecord, right: TaskRecord): number {
  return (left.deadlineDate ?? '').localeCompare(right.deadlineDate ?? '') || byPlan(left, right);
}

export function smartTasksFromSnapshot(
  snapshot: PlannerSnapshot,
  key: SmartListKey,
  today: string,
): TaskRecord[] {
  if (!isLocalDate(today)) throw new PlanningValidationError('Today must be a valid local date.');
  const visibleListIds = new Set(snapshot.lists.map((list) => list.id));
  const visibleTasks = snapshot.tasks.filter((task) => visibleListIds.has(task.listId));
  const incomplete = visibleActiveTasks(snapshot);
  const horizonEnd = addCalendarDays(today, 2);
  switch (key) {
    case 'inbox':
      return visibleTasks.filter(
        (task) =>
          task.listId === INBOX_LIST_ID &&
          (task.status !== 'completed' || task.completedClearedAt === undefined),
      );
    case 'active':
      return incomplete;
    case 'blocked':
      return incomplete.filter((task) => (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0);
    case 'completed':
      return visibleTasks.filter((task) => task.status === 'completed');
    case 'today':
      return incomplete.filter((task) => task.plannedDate === today).sort(byPlan);
    case 'nextThreeDays':
      return incomplete
        .filter(
          (task) =>
            task.plannedDate !== undefined &&
            task.plannedDate >= today &&
            task.plannedDate <= horizonEnd,
        )
        .sort(byPlan);
    case 'upcoming':
      return incomplete
        .filter((task) => task.plannedDate !== undefined && task.plannedDate > horizonEnd)
        .sort(byPlan);
    case 'deadlines':
      return incomplete.filter((task) => task.deadlineDate !== undefined).sort(byDeadline);
    case 'overdue':
      return incomplete
        .filter((task) => task.deadlineDate !== undefined && task.deadlineDate < today)
        .sort(byDeadline);
    case 'unscheduled':
      return incomplete.filter(
        (task) => task.plannedDate === undefined && task.flexibleStartDate === undefined,
      );
    case 'recentlyDeleted':
      return [];
  }
}

export function planningOverviewFromSnapshot(
  snapshot: PlannerSnapshot,
  today: string,
): PlanningOverview {
  const incomplete = visibleActiveTasks(snapshot);
  const tomorrow = addCalendarDays(today, 1);
  const horizonEnd = addCalendarDays(today, 2);
  return {
    today: smartTasksFromSnapshot(snapshot, 'today', today),
    nextThreeDays: incomplete
      .filter(
        (task) =>
          task.plannedDate !== undefined &&
          task.plannedDate >= tomorrow &&
          task.plannedDate <= horizonEnd,
      )
      .sort(byPlan),
    flexible: incomplete
      .filter((task) => task.flexibleStartDate !== undefined)
      .sort((left, right) =>
        (left.flexibleStartDate ?? '').localeCompare(right.flexibleStartDate ?? ''),
      ),
    upcomingDeadlines: incomplete
      .filter((task) => task.deadlineDate !== undefined && task.deadlineDate >= today)
      .sort(byDeadline),
    unscheduled: smartTasksFromSnapshot(snapshot, 'unscheduled', today),
  };
}
