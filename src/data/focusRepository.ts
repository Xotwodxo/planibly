import { database, type PlaniblyDatabase } from './database';
import {
  countdownView,
  hasStartingDetails,
  isValidActiveFocusRecord,
  normalizeStartingDetails,
  validateCountdownMinutes,
  validatePrepItemTitle,
  validateTaskStartStyle,
} from './focus';
import {
  ACTIVE_FOCUS_ID,
  COUNTDOWN_MINUTES_MAX,
  type ActiveFocusRecord,
  type CountdownSource,
  type TaskPrepItemRecord,
  type TaskStartingDetailsInput,
  type TaskStartingDetailsRecord,
  type TaskStartStyle,
} from './focusTypes';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';
import type { DeletionReceipt, PlanListRecord, TaskRecord } from './plannerTypes';

type FocusRepositoryOptions = {
  now?: () => Date;
  createId?: () => string;
  notify?: () => void;
};

function notifyFocusChanged(): void {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}

function active<T extends { deletedAt?: string }>(record: T): boolean {
  return record.deletedAt === undefined;
}

export class FocusSwitchRequiredError extends Error {
  public constructor(public readonly activeTaskId: string) {
    super('End or switch from the current focus before starting another task.');
    this.name = 'FocusSwitchRequiredError';
  }
}

export class FocusBlockedError extends Error {
  public constructor(public readonly blockerIds: string[]) {
    super('Complete the tasks listed as blockers before beginning this task.');
    this.name = 'FocusBlockedError';
  }
}

export class PrepParentRequiredError extends Error {
  public constructor(public readonly parentLabels: string[]) {
    super(`Restore ${parentLabels.join(' and ')} first.`);
    this.name = 'PrepParentRequiredError';
  }
}

export class FocusRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: FocusRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? notifyFocusChanged;
  }

  public async saveStartingDetails(
    taskId: string,
    input: TaskStartingDetailsInput,
  ): Promise<TaskStartingDetailsRecord | undefined> {
    await this.requireTask(taskId, false);
    const normalized = normalizeStartingDetails(input);
    const existing = await this.db.taskStartingDetails.where('taskId').equals(taskId).first();
    if (!hasStartingDetails(normalized)) {
      if (existing) await this.db.taskStartingDetails.delete(existing.id);
      this.notify();
      return undefined;
    }
    const now = this.now().toISOString();
    const record: TaskStartingDetailsRecord = {
      id: existing?.id ?? this.createId(),
      taskId,
      ...normalized,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    };
    await this.db.taskStartingDetails.put(record);
    this.notify();
    return record;
  }

  public async createPrepItem(taskId: string, title: string): Promise<TaskPrepItemRecord> {
    await this.requireTask(taskId, false);
    const siblings = (await this.db.taskPrepItems.where('taskId').equals(taskId).toArray()).filter(
      active,
    );
    const now = this.now().toISOString();
    const item: TaskPrepItemRecord = {
      id: this.createId(),
      taskId,
      title: validatePrepItemTitle(title),
      completed: false,
      order: siblings.length,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.taskPrepItems.add(item);
    this.notify();
    return item;
  }

  public async updatePrepItem(id: string, title: string): Promise<void> {
    await this.requirePrepItem(id);
    await this.db.taskPrepItems.update(id, {
      title: validatePrepItemTitle(title),
      modifiedAt: this.now().toISOString(),
    });
    this.notify();
  }

  public async setPrepItemCompleted(id: string, completed: boolean): Promise<void> {
    await this.requirePrepItem(id);
    await this.db.taskPrepItems.update(id, { completed, modifiedAt: this.now().toISOString() });
    this.notify();
  }

  public async movePrepItem(id: string, direction: -1 | 1): Promise<void> {
    const item = await this.requirePrepItem(id);
    const siblings = (await this.db.taskPrepItems.where('taskId').equals(item.taskId).toArray())
      .filter(active)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const index = siblings.findIndex((candidate) => candidate.id === id);
    const other = siblings[index + direction];
    if (index < 0 || !other) return;
    const now = this.now().toISOString();
    await this.db.transaction('rw', this.db.taskPrepItems, async () => {
      await Promise.all([
        this.db.taskPrepItems.update(item.id, { order: other.order, modifiedAt: now }),
        this.db.taskPrepItems.update(other.id, { order: item.order, modifiedAt: now }),
      ]);
    });
    this.notify();
  }

  public async duplicatePrepItem(id: string): Promise<TaskPrepItemRecord> {
    const item = await this.requirePrepItem(id);
    return this.createPrepItem(item.taskId, `${item.title} copy`);
  }

  public async deletePrepItem(id: string): Promise<DeletionReceipt> {
    const item = await this.requirePrepItem(id);
    const now = this.now().toISOString();
    const groupId = this.createId();
    await this.db.taskPrepItems.update(id, {
      deletedAt: now,
      deletionGroupId: groupId,
      modifiedAt: now,
    });
    this.notify();
    return { groupId, kind: 'prepItem', entityId: id, label: item.title, deletedAt: now };
  }

  public async resetPrepItems(taskId: string): Promise<number> {
    await this.requireTask(taskId, false);
    const completed = (await this.db.taskPrepItems.where('taskId').equals(taskId).toArray()).filter(
      (item) => active(item) && item.completed,
    );
    if (completed.length === 0) return 0;
    const now = this.now().toISOString();
    await this.db.transaction('rw', this.db.taskPrepItems, async () => {
      await Promise.all(
        completed.map((item) =>
          this.db.taskPrepItems.update(item.id, { completed: false, modifiedAt: now }),
        ),
      );
    });
    this.notify();
    return completed.length;
  }

  public async restorePrepItem(id: string): Promise<void> {
    const item = await this.db.taskPrepItems.get(id);
    if (!item?.deletedAt) throw new Error('Deleted prep item not found.');
    const task = await this.db.tasks.get(item.taskId);
    if (!task) throw new Error('The parent task no longer exists.');
    if (task.deletedAt) {
      throw new PrepParentRequiredError([`task “${task.title}”`]);
    }
    const list = await this.db.lists.get(task.listId);
    if (!list || list.deletedAt || list.archivedAt) {
      throw new Error('Restore the task hierarchy before restoring this prep item.');
    }
    const now = this.now().toISOString();
    await this.db.taskPrepItems.update(id, {
      deletedAt: undefined,
      deletionGroupId: undefined,
      modifiedAt: now,
    });
    this.notify();
  }

  public async restoreDeletionGroup(groupId: string): Promise<void> {
    const items = await this.db.taskPrepItems.where('deletionGroupId').equals(groupId).toArray();
    if (items.length === 0) throw new Error('This deletion can no longer be undone.');
    const now = this.now().toISOString();
    await Promise.all(
      items.map((item) =>
        this.db.taskPrepItems.update(item.id, {
          deletedAt: undefined,
          deletionGroupId: undefined,
          modifiedAt: now,
        }),
      ),
    );
    this.notify();
  }

  public async permanentlyDeletePrepItem(id: string): Promise<void> {
    const item = await this.db.taskPrepItems.get(id);
    if (!item?.deletedAt) throw new Error('Deleted prep item not found.');
    await this.db.taskPrepItems.delete(id);
    this.notify();
  }

  public async getActiveFocus(): Promise<ActiveFocusRecord | undefined> {
    const records = await this.db.activeFocus.toArray();
    const focus = records.find((record) => record.id === ACTIVE_FOCUS_ID);
    const extras = records.filter((record) => record.id !== ACTIVE_FOCUS_ID);
    if (extras.length > 0) await this.db.activeFocus.bulkDelete(extras.map((record) => record.id));
    if (!focus) return undefined;
    if (!isValidActiveFocusRecord(focus) || !(await this.isTaskAvailable(focus.taskId))) {
      await this.db.activeFocus.delete(ACTIVE_FOCUS_ID);
      return undefined;
    }
    return focus;
  }

  public async startFocus(
    taskId: string,
    style: TaskStartStyle,
    switchExisting = false,
  ): Promise<ActiveFocusRecord> {
    if (!validateTaskStartStyle(style)) throw new Error('Choose a valid start style.');
    await this.requireTask(taskId, true);
    const blockers = await this.blockerIds(taskId);
    if (blockers.length > 0) throw new FocusBlockedError(blockers);
    const existing = await this.getActiveFocus();
    if (existing?.taskId === taskId) return existing;
    if (existing && !switchExisting) throw new FocusSwitchRequiredError(existing.taskId);
    const now = this.now().toISOString();
    const record: ActiveFocusRecord = {
      id: ACTIVE_FOCUS_ID,
      taskId,
      startStyle: style,
      startedAt: now,
      fullDetailsRevealed: style === 'full',
      countdownSource: 'none',
      countdownState: 'idle',
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.transaction('rw', this.db.activeFocus, async () => {
      await this.db.activeFocus.clear();
      await this.db.activeFocus.add(record);
    });
    this.notify();
    return record;
  }

  public async endFocus(): Promise<void> {
    await this.db.activeFocus.delete(ACTIVE_FOCUS_ID);
    this.notify();
  }

  public async setStartStyle(style: TaskStartStyle): Promise<void> {
    if (!validateTaskStartStyle(style)) throw new Error('Choose a valid start style.');
    const focus = await this.requireFocus();
    await this.db.activeFocus.update(focus.id, {
      startStyle: style,
      fullDetailsRevealed: style === 'full' ? true : focus.fullDetailsRevealed,
      modifiedAt: this.now().toISOString(),
    });
    this.notify();
  }

  public async setFullDetailsRevealed(revealed: boolean): Promise<void> {
    const focus = await this.requireFocus();
    await this.db.activeFocus.update(focus.id, {
      fullDetailsRevealed: revealed,
      modifiedAt: this.now().toISOString(),
    });
    this.notify();
  }

  public async configureCountdown(source: CountdownSource, customMinutes?: number): Promise<void> {
    const focus = await this.requireFocus();
    if (source === 'none') {
      await this.db.activeFocus.update(focus.id, {
        countdownSource: 'none',
        countdownDurationSeconds: undefined,
        countdownState: 'idle',
        countdownEndsAt: undefined,
        countdownRemainingSeconds: undefined,
        modifiedAt: this.now().toISOString(),
      });
      this.notify();
      return;
    }
    const task = await this.requireTask(focus.taskId, true);
    const details = await this.db.taskStartingDetails.where('taskId').equals(task.id).first();
    const minutes =
      source === 'estimated'
        ? task.estimatedDurationMinutes
        : source === 'saved'
          ? details?.defaultCountdownMinutes
          : customMinutes;
    if (minutes === undefined) throw new Error('That countdown duration is not available.');
    const durationSeconds = validateCountdownMinutes(minutes)! * 60;
    await this.db.activeFocus.update(focus.id, {
      countdownSource: source,
      countdownDurationSeconds: durationSeconds,
      countdownState: 'idle',
      countdownEndsAt: undefined,
      countdownRemainingSeconds: durationSeconds,
      modifiedAt: this.now().toISOString(),
    });
    this.notify();
  }

  public async startCountdown(): Promise<void> {
    const focus = await this.requireFocus();
    const view = countdownView(focus, this.now());
    if (view.state === 'none') throw new Error('Choose a countdown duration first.');
    const seconds =
      view.remainingSeconds > 0 ? view.remainingSeconds : (focus.countdownDurationSeconds ?? 0);
    if (seconds <= 0) throw new Error('Add time before resuming the countdown.');
    const now = this.now();
    await this.db.activeFocus.update(focus.id, {
      countdownState: 'running',
      countdownEndsAt: new Date(now.getTime() + seconds * 1_000).toISOString(),
      countdownRemainingSeconds: undefined,
      modifiedAt: now.toISOString(),
    });
    this.notify();
  }

  public async pauseCountdown(): Promise<void> {
    const focus = await this.requireFocus();
    if (focus.countdownState !== 'running') return;
    const now = this.now();
    const remainingSeconds = countdownView(focus, now).remainingSeconds;
    await this.db.activeFocus.update(focus.id, {
      countdownState: 'paused',
      countdownEndsAt: undefined,
      countdownRemainingSeconds: remainingSeconds,
      modifiedAt: now.toISOString(),
    });
    this.notify();
  }

  public async addCountdownTime(minutes: number): Promise<void> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      throw new Error('Add between 1 and 60 minutes.');
    }
    const focus = await this.requireFocus();
    const view = countdownView(focus, this.now());
    if (view.state === 'none') throw new Error('Choose a countdown duration first.');
    const maximumSeconds = COUNTDOWN_MINUTES_MAX * 60;
    const remainingSeconds = Math.min(maximumSeconds, view.remainingSeconds + minutes * 60);
    const now = this.now();
    const running = view.state === 'running' || view.state === 'finished';
    await this.db.activeFocus.update(focus.id, {
      countdownDurationSeconds: Math.min(
        maximumSeconds,
        (focus.countdownDurationSeconds ?? 0) + minutes * 60,
      ),
      countdownState: running ? 'running' : focus.countdownState,
      countdownEndsAt: running
        ? new Date(now.getTime() + remainingSeconds * 1_000).toISOString()
        : undefined,
      countdownRemainingSeconds: running ? undefined : remainingSeconds,
      modifiedAt: now.toISOString(),
    });
    this.notify();
  }

  public async resetCountdown(): Promise<void> {
    const focus = await this.requireFocus();
    if (focus.countdownSource === 'none' || focus.countdownDurationSeconds === undefined) return;
    await this.db.activeFocus.update(focus.id, {
      countdownState: 'idle',
      countdownEndsAt: undefined,
      countdownRemainingSeconds: focus.countdownDurationSeconds,
      modifiedAt: this.now().toISOString(),
    });
    this.notify();
  }

  private async requireFocus(): Promise<ActiveFocusRecord> {
    const focus = await this.getActiveFocus();
    if (!focus) throw new Error('No focused task is active.');
    return focus;
  }

  private async requirePrepItem(id: string): Promise<TaskPrepItemRecord> {
    const item = await this.db.taskPrepItems.get(id);
    if (!item || !active(item)) throw new Error('Prep item not found.');
    await this.requireTask(item.taskId, false);
    return item;
  }

  private async requireTask(taskId: string, focusable: boolean): Promise<TaskRecord> {
    const task = await this.db.tasks.get(taskId);
    if (!task || !active(task)) throw new Error('Task not found.');
    if (focusable && task.status === 'completed') throw new Error('Completed tasks cannot begin.');
    const list = await this.db.lists.get(task.listId);
    if (!this.isListAvailable(list)) throw new Error('This task is not currently available.');
    return task;
  }

  private isListAvailable(list: PlanListRecord | undefined): boolean {
    return Boolean(list && active(list) && list.archivedAt === undefined);
  }

  private async isTaskAvailable(taskId: string): Promise<boolean> {
    try {
      await this.requireTask(taskId, true);
      return true;
    } catch {
      return false;
    }
  }

  private async blockerIds(taskId: string): Promise<string[]> {
    const [relationships, tasks] = await Promise.all([
      this.db.taskRelationships.where('successorTaskId').equals(taskId).toArray(),
      this.db.tasks.toArray(),
    ]);
    const taskById = new Map(tasks.filter(active).map((task) => [task.id, task]));
    return relationships
      .filter(active)
      .map((relationship) => relationship.predecessorTaskId)
      .filter((id) => taskById.has(id) && taskById.get(id)?.status !== 'completed');
  }
}

export const focusRepository = new FocusRepository();
