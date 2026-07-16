import { addCalendarDays, isLocalDate, PlanningValidationError } from './planning';
import type {
  AgendaGroup,
  PlannedPlacementRecord,
  PlannerSnapshot,
  PlanningCapacityRecord,
  TaskRecord,
} from './plannerTypes';

export const AGENDA_GROUPS: readonly AgendaGroup[] = [
  'exact',
  'morning',
  'afternoon',
  'evening',
  'anyTime',
];

export const AGENDA_GROUP_LABELS: Record<AgendaGroup, string> = {
  exact: 'Exact start times',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anyTime: 'Any Time',
};

export type AgendaTaskGroup = {
  group: AgendaGroup;
  tasks: TaskRecord[];
};

export type CapacitySummary = {
  availableMinutes: number | null;
  estimatedMinutes: number;
  remainingMinutes: number | null;
  overMinutes: number;
  unknownDurationCount: number;
  blockedCount: number;
};

export type HorizonDay = CapacitySummary & {
  localDate: string;
  tasks: TaskRecord[];
};

export type PlanningSources = {
  unscheduled: TaskRecord[];
  flexible: TaskRecord[];
  upcomingDeadlines: TaskRecord[];
};

export function agendaGroupForTask(task: TaskRecord): AgendaGroup {
  if (task.exactStartTime) return 'exact';
  return task.timeWindow ?? 'anyTime';
}

export function placementByTaskId(
  placements: readonly PlannedPlacementRecord[],
): Map<string, PlannedPlacementRecord> {
  return new Map(placements.map((placement) => [placement.taskId, placement]));
}

export function effectivePlannedDate(
  snapshot: Pick<PlannerSnapshot, 'plannedPlacements'>,
  task: TaskRecord,
): string | undefined {
  return (
    snapshot.plannedPlacements.find((placement) => placement.taskId === task.id)?.localDate ??
    task.plannedDate
  );
}

function visibleTasks(snapshot: PlannerSnapshot): TaskRecord[] {
  const visibleListIds = new Set(snapshot.lists.map((list) => list.id));
  return snapshot.tasks.filter((task) => visibleListIds.has(task.listId));
}

function placementOrder(placements: Map<string, PlannedPlacementRecord>, task: TaskRecord): number {
  return placements.get(task.id)?.order ?? Number.MAX_SAFE_INTEGER;
}

export function agendaGroupsFromSnapshot(
  snapshot: PlannerSnapshot,
  localDate: string,
): AgendaTaskGroup[] {
  if (!isLocalDate(localDate)) throw new PlanningValidationError('Choose a valid agenda date.');
  const placements = placementByTaskId(snapshot.plannedPlacements);
  const tasks = visibleTasks(snapshot).filter(
    (task) => effectivePlannedDate(snapshot, task) === localDate,
  );
  return AGENDA_GROUPS.map((group) => ({
    group,
    tasks: tasks
      .filter((task) => agendaGroupForTask(task) === group)
      .sort((left, right) => {
        if (group === 'exact') {
          const time = (left.exactStartTime ?? '').localeCompare(right.exactStartTime ?? '');
          if (time !== 0) return time;
        }
        return (
          placementOrder(placements, left) - placementOrder(placements, right) ||
          left.order - right.order ||
          left.id.localeCompare(right.id)
        );
      }),
  }));
}

export function weekdayForLocalDate(localDate: string): number {
  if (!isLocalDate(localDate)) throw new PlanningValidationError('Choose a valid date.');
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function validCapacityMinutes(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) > 0 && Number(value) <= 1440);
}

export function capacityForDate(
  capacities: readonly PlanningCapacityRecord[],
  localDate: string,
): number | null {
  const dateOverride = capacities
    .filter(
      (record) =>
        record.kind === 'date' &&
        record.localDate === localDate &&
        validCapacityMinutes(record.minutes),
    )
    .sort(
      (left, right) =>
        right.modifiedAt.localeCompare(left.modifiedAt) || right.id.localeCompare(left.id),
    )[0];
  if (dateOverride) return dateOverride.minutes;
  const weekday = weekdayForLocalDate(localDate);
  const weekdayDefault = capacities
    .filter(
      (record) =>
        record.kind === 'weekday' &&
        record.weekday === weekday &&
        validCapacityMinutes(record.minutes),
    )
    .sort(
      (left, right) =>
        right.modifiedAt.localeCompare(left.modifiedAt) || right.id.localeCompare(left.id),
    )[0];
  return weekdayDefault?.minutes ?? null;
}

export function capacitySummaryForDate(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  localDate: string,
): CapacitySummary {
  const tasks = agendaGroupsFromSnapshot(snapshot, localDate)
    .flatMap((group) => group.tasks)
    .filter((task) => task.status !== 'completed');
  const estimatedMinutes = tasks.reduce(
    (total, task) => total + (task.estimatedDurationMinutes ?? 0),
    0,
  );
  const availableMinutes = capacityForDate(capacities, localDate);
  return {
    availableMinutes,
    estimatedMinutes,
    remainingMinutes:
      availableMinutes === null ? null : Math.max(0, availableMinutes - estimatedMinutes),
    overMinutes: availableMinutes === null ? 0 : Math.max(0, estimatedMinutes - availableMinutes),
    unknownDurationCount: tasks.filter((task) => task.estimatedDurationMinutes === undefined)
      .length,
    blockedCount: tasks.filter((task) => (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0)
      .length,
  };
}

export function sevenDayHorizon(
  snapshot: PlannerSnapshot,
  capacities: readonly PlanningCapacityRecord[],
  startDate: string,
): HorizonDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const localDate = addCalendarDays(startDate, index);
    return {
      localDate,
      tasks: agendaGroupsFromSnapshot(snapshot, localDate).flatMap((group) => group.tasks),
      ...capacitySummaryForDate(snapshot, capacities, localDate),
    };
  });
}

export function planningSourcesForHorizon(
  snapshot: PlannerSnapshot,
  startDate: string,
): PlanningSources {
  const endDate = addCalendarDays(startDate, 6);
  const placements = placementByTaskId(snapshot.plannedPlacements);
  const activeTasks = visibleTasks(snapshot).filter((task) => task.status !== 'completed');
  return {
    unscheduled: activeTasks.filter(
      (task) =>
        !placements.has(task.id) &&
        task.plannedDate === undefined &&
        task.flexibleStartDate === undefined,
    ),
    flexible: activeTasks.filter(
      (task) =>
        !placements.has(task.id) &&
        task.flexibleStartDate !== undefined &&
        task.flexibleEndDate !== undefined &&
        task.flexibleStartDate <= endDate &&
        task.flexibleEndDate >= startDate,
    ),
    upcomingDeadlines: activeTasks
      .filter(
        (task) =>
          !placements.has(task.id) &&
          task.deadlineDate !== undefined &&
          task.deadlineDate >= startDate,
      )
      .sort((left, right) => left.deadlineDate!.localeCompare(right.deadlineDate!)),
  };
}

export function previouslyPlannedTasks(snapshot: PlannerSnapshot, today: string): TaskRecord[] {
  return visibleTasks(snapshot)
    .filter(
      (task) =>
        task.status !== 'completed' && (effectivePlannedDate(snapshot, task) ?? today) < today,
    )
    .sort((left, right) =>
      (effectivePlannedDate(snapshot, left) ?? '').localeCompare(
        effectivePlannedDate(snapshot, right) ?? '',
      ),
    );
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${remainder} min`;
}
