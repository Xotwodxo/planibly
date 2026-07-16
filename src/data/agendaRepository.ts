import { agendaGroupForTask, validCapacityMinutes } from './agenda';
import { database, type PlaniblyDatabase } from './database';
import { isLocalDate } from './planning';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import type { PlannedPlacementRecord, PlanningCapacityRecord, TaskRecord } from './plannerTypes';

type AgendaRepositoryOptions = {
  now?: () => string;
  createId?: () => string;
  notify?: () => void;
};

export class AgendaPlanningError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgendaPlanningError';
  }
}

function notifyPlannerDataChanged(): void {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}

function active(task: TaskRecord): boolean {
  return task.deletedAt === undefined;
}

function requireDate(localDate: string): void {
  if (!isLocalDate(localDate)) throw new AgendaPlanningError('Choose a valid planning date.');
}

function requireCapacity(minutes: number | null): void {
  if (!validCapacityMinutes(minutes)) {
    throw new AgendaPlanningError('Capacity must be between 1 and 1,440 minutes.');
  }
}

function weekdayCapacityId(weekday: number): string {
  return `80000000-0000-4000-8000-00000000000${weekday + 1}`;
}

export class AgendaRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: AgendaRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? notifyPlannerDataChanged;
  }

  public async getCapacities(): Promise<PlanningCapacityRecord[]> {
    return (await this.db.planningCapacities.toArray()).filter((record) => {
      if (!validCapacityMinutes(record.minutes)) return false;
      if (record.kind === 'weekday') {
        return (
          Number.isInteger(record.weekday) &&
          record.weekday !== undefined &&
          record.weekday >= 0 &&
          record.weekday <= 6 &&
          record.localDate === undefined
        );
      }
      return (
        record.weekday === undefined &&
        record.localDate !== undefined &&
        isLocalDate(record.localDate)
      );
    });
  }

  public async setWeekdayCapacity(weekday: number, minutes: number | null): Promise<void> {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new AgendaPlanningError('Choose a valid weekday.');
    }
    requireCapacity(minutes);
    const now = this.now();
    const id = weekdayCapacityId(weekday);
    const existing = await this.db.planningCapacities.get(id);
    await this.db.planningCapacities.put({
      id,
      kind: 'weekday',
      weekday,
      minutes,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    });
    this.notify();
  }

  public async setDateCapacity(localDate: string, minutes: number | null): Promise<void> {
    requireDate(localDate);
    requireCapacity(minutes);
    const existing = (
      await this.db.planningCapacities.where('localDate').equals(localDate).toArray()
    )
      .filter((record) => record.kind === 'date')
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))[0];
    const now = this.now();
    await this.db.planningCapacities.put({
      id: existing?.id ?? this.createId(),
      kind: 'date',
      localDate,
      minutes,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    });
    this.notify();
  }

  public async clearDateCapacity(localDate: string): Promise<void> {
    requireDate(localDate);
    const overrides = (
      await this.db.planningCapacities.where('localDate').equals(localDate).toArray()
    ).filter((record) => record.kind === 'date');
    if (overrides.length === 0) return;
    await this.db.planningCapacities.bulkDelete(overrides.map((record) => record.id));
    this.notify();
  }

  public async planTask(taskId: string, localDate: string): Promise<void> {
    await this.moveTasks([taskId], localDate);
  }

  public async moveTasks(taskIds: readonly string[], localDate: string): Promise<void> {
    requireDate(localDate);
    const ids = [...new Set(taskIds)];
    if (ids.length === 0) return;
    const tasks = await this.requireTasks(ids);
    for (const task of tasks) this.assertFlexibleDate(task, localDate);

    const now = this.now();
    const allPlacements = await this.db.plannedPlacements.toArray();
    const movingIds = new Set(ids);
    const orderByGroup = new Map<string, number>();
    for (const placement of allPlacements) {
      if (movingIds.has(placement.taskId)) continue;
      const key = `${placement.localDate}|${placement.group}`;
      orderByGroup.set(key, Math.max(orderByGroup.get(key) ?? 0, placement.order + 1));
    }
    const existingByTask = new Map(allPlacements.map((placement) => [placement.taskId, placement]));
    const updatedTasks: TaskRecord[] = [];
    const placements: PlannedPlacementRecord[] = [];
    for (const task of tasks) {
      const existing = existingByTask.get(task.id);
      const source = task.flexibleStartDate ? 'flexibleRange' : 'plannedDate';
      const updatedTask: TaskRecord =
        source === 'flexibleRange'
          ? { ...task, modifiedAt: now }
          : { ...task, plannedDate: localDate, modifiedAt: now };
      const group = agendaGroupForTask(updatedTask);
      const key = `${localDate}|${group}`;
      const canPreserveOrder = existing?.localDate === localDate && existing.group === group;
      const order = canPreserveOrder ? existing.order : (orderByGroup.get(key) ?? 0);
      if (!canPreserveOrder) orderByGroup.set(key, order + 1);
      updatedTasks.push(updatedTask);
      placements.push({
        id: existing?.id ?? task.id,
        taskId: task.id,
        localDate,
        group,
        order,
        source,
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
      });
    }

    await this.db.transaction('rw', this.db.tasks, this.db.plannedPlacements, async () => {
      await this.db.tasks.bulkPut(updatedTasks);
      await this.db.plannedPlacements.bulkPut(placements);
    });
    this.notify();
  }

  public async unplanTask(taskId: string): Promise<void> {
    await this.unplanTasks([taskId]);
  }

  public async unplanTasks(taskIds: readonly string[]): Promise<void> {
    const ids = [...new Set(taskIds)];
    if (ids.length === 0) return;
    const tasks = await this.requireTasks(ids);
    const now = this.now();
    const updated = tasks.map((task): TaskRecord =>
      task.flexibleStartDate
        ? { ...task, modifiedAt: now }
        : {
            ...task,
            plannedDate: undefined,
            timeWindow: undefined,
            exactStartTime: undefined,
            modifiedAt: now,
          },
    );
    const placements = await this.db.plannedPlacements.where('taskId').anyOf(ids).toArray();
    await this.db.transaction('rw', this.db.tasks, this.db.plannedPlacements, async () => {
      await this.db.tasks.bulkPut(updated);
      await this.db.plannedPlacements.bulkDelete(placements.map((placement) => placement.id));
    });
    this.notify();
  }

  public async moveWithinGroup(taskId: string, direction: -1 | 1): Promise<void> {
    const task = (await this.requireTasks([taskId]))[0]!;
    const placement = await this.db.plannedPlacements.where('taskId').equals(taskId).first();
    if (!placement) throw new AgendaPlanningError('This task is not in the agenda.');
    if (placement.group === 'exact') {
      throw new AgendaPlanningError('Exact-time tasks are ordered by their start time.');
    }
    const peers = (
      await this.db.plannedPlacements.where('localDate').equals(placement.localDate).toArray()
    )
      .filter((candidate) => candidate.group === placement.group)
      .sort((left, right) => left.order - right.order || left.taskId.localeCompare(right.taskId));
    const index = peers.findIndex((candidate) => candidate.taskId === task.id);
    const other = peers[index + direction];
    if (!other) return;
    const now = this.now();
    await this.db.transaction('rw', this.db.plannedPlacements, async () => {
      await Promise.all([
        this.db.plannedPlacements.update(placement.id, { order: other.order, modifiedAt: now }),
        this.db.plannedPlacements.update(other.id, { order: placement.order, modifiedAt: now }),
      ]);
    });
    this.notify();
  }

  private async requireTasks(ids: readonly string[]): Promise<TaskRecord[]> {
    const records = await this.db.tasks.bulkGet([...ids]);
    if (records.some((task) => task === undefined || !active(task))) {
      throw new AgendaPlanningError('One or more selected tasks are no longer available.');
    }
    return records as TaskRecord[];
  }

  private assertFlexibleDate(task: TaskRecord, localDate: string): void {
    if (
      task.flexibleStartDate &&
      task.flexibleEndDate &&
      (localDate < task.flexibleStartDate || localDate > task.flexibleEndDate)
    ) {
      throw new AgendaPlanningError(
        `Choose a date from ${task.flexibleStartDate} to ${task.flexibleEndDate}.`,
      );
    }
  }
}

export const agendaRepository = new AgendaRepository();
