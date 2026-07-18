import { agendaGroupForTask } from './agenda';
import { database, type PlaniblyDatabase } from './database';
import { isLocalDate } from './planning';
import { PLANNER_DATA_CHANGED_EVENT, PlannerRepository } from './plannerRepository';
import type { PlannedPlacementRecord, TaskRecord } from './plannerTypes';
import {
  isValidReviewRecord,
  normalizeReviewPreferences,
  previewReviewActions,
  reviewPeriod,
} from './review';
import {
  REVIEW_PREFERENCES_ID,
  type ReviewActionPreview,
  type ReviewPreferencesRecord,
  type ReviewRecord,
  type ReviewTaskAction,
  type ReviewType,
} from './reviewTypes';

export const REVIEW_DATA_CHANGED_EVENT = 'planibly:review-data-changed';

export type ReviewState = {
  preferences: ReviewPreferencesRecord;
  records: ReviewRecord[];
  dismissedKeys: Set<string>;
};

type ReviewRepositoryOptions = {
  now?: () => string;
  createId?: () => string;
  notify?: () => void;
  beforeCommit?: () => void | Promise<void>;
};

function notifyReviewDataChanged(): void {
  window.dispatchEvent(new Event(REVIEW_DATA_CHANGED_EVENT));
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}

function reviewKey(type: ReviewType, periodStart: string): string {
  return `${type}:${periodStart}`;
}

export class ReviewRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;
  private readonly beforeCommit?: () => void | Promise<void>;
  private readonly dismissedKeys = new Set<string>();

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: ReviewRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? notifyReviewDataChanged;
    this.beforeCommit = options.beforeCommit;
  }

  public async getState(): Promise<ReviewState> {
    const now = this.now();
    const stored = await this.db.reviewPreferences.get(REVIEW_PREFERENCES_ID);
    const preferences = normalizeReviewPreferences(stored, stored?.modifiedAt ?? now);
    const records = (await this.db.reviewRecords.toArray())
      .filter(isValidReviewRecord)
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    return { preferences, records, dismissedKeys: new Set(this.dismissedKeys) };
  }

  public async savePreferences(
    changes: Partial<Omit<ReviewPreferencesRecord, 'id' | 'createdAt' | 'modifiedAt'>>,
  ): Promise<ReviewPreferencesRecord> {
    const now = this.now();
    const existing = await this.db.reviewPreferences.get(REVIEW_PREFERENCES_ID);
    const base = normalizeReviewPreferences(existing, existing?.modifiedAt ?? now);
    const record = normalizeReviewPreferences(
      {
        ...base,
        ...changes,
        visibleSections: changes.visibleSections
          ? { ...base.visibleSections, ...changes.visibleSections }
          : base.visibleSections,
        expandedSections: changes.expandedSections
          ? { ...base.expandedSections, ...changes.expandedSections }
          : base.expandedSections,
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
      },
      now,
    );
    await this.db.reviewPreferences.put(record);
    this.notify();
    return record;
  }

  public async startOrResume(type: ReviewType, localDate: string): Promise<ReviewRecord> {
    const period = reviewPeriod(type, localDate);
    const existing = await this.db.reviewRecords
      .where('[type+periodStart]')
      .equals([type, period.periodStart])
      .first();
    if (existing && isValidReviewRecord(existing)) return existing;
    const now = this.now();
    const record: ReviewRecord = {
      id: this.createId(),
      type,
      ...period,
      startedAt: now,
      modifiedAt: now,
      version: 1,
    };
    await this.db.reviewRecords.add(record);
    this.dismissedKeys.delete(reviewKey(type, period.periodStart));
    this.notify();
    return record;
  }

  public async reopen(id: string): Promise<ReviewRecord> {
    const record = await this.db.reviewRecords.get(id);
    if (!record || !isValidReviewRecord(record)) throw new Error('Review not found.');
    const updated = { ...record, finishedAt: undefined, modifiedAt: this.now() };
    await this.db.reviewRecords.put(updated);
    this.dismissedKeys.delete(reviewKey(updated.type, updated.periodStart));
    this.notify();
    return updated;
  }

  public async finish(id: string): Promise<ReviewRecord> {
    const record = await this.db.reviewRecords.get(id);
    if (!record || !isValidReviewRecord(record)) throw new Error('Review not found.');
    const now = this.now();
    const updated = { ...record, finishedAt: now, modifiedAt: now };
    await this.db.reviewRecords.put(updated);
    this.notify();
    return updated;
  }

  public dismissForSession(type: ReviewType, periodStart: string): void {
    if (!isLocalDate(periodStart)) throw new Error('Choose a valid review date.');
    this.dismissedKeys.add(reviewKey(type, periodStart));
    this.notify();
  }

  public clearSessionDismissals(): void {
    if (this.dismissedKeys.size === 0) return;
    this.dismissedKeys.clear();
    this.notify();
  }

  public async deleteReview(id: string): Promise<void> {
    await this.db.reviewRecords.delete(id);
    this.notify();
  }

  public async preview(actions: readonly ReviewTaskAction[]): Promise<ReviewActionPreview> {
    const [snapshot, capacities] = await Promise.all([
      new PlannerRepository(this.db, { notify: () => undefined }).getSnapshot(),
      this.db.planningCapacities.toArray(),
    ]);
    return previewReviewActions(snapshot, capacities, actions);
  }

  public async applyActions(
    actions: readonly ReviewTaskAction[],
    reviewId?: string,
  ): Promise<ReviewActionPreview> {
    const [snapshot, capacities] = await Promise.all([
      new PlannerRepository(this.db, { notify: () => undefined }).getSnapshot(),
      this.db.planningCapacities.toArray(),
    ]);
    const preview = previewReviewActions(snapshot, capacities, actions);
    if (!preview.canApply) throw new Error('Resolve invalid review changes before applying them.');
    const changed = preview.items.filter((item) => !item.unchanged);
    const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const allPlacements = await this.db.plannedPlacements.toArray();
    const placementByTask = new Map(
      allPlacements.map((placement) => [placement.taskId, placement]),
    );
    const movingIds = new Set(changed.map((item) => item.taskId));
    const nextOrder = new Map<string, number>();
    for (const placement of allPlacements) {
      if (movingIds.has(placement.taskId)) continue;
      const key = `${placement.localDate}|${placement.group}`;
      nextOrder.set(key, Math.max(nextOrder.get(key) ?? 0, placement.order + 1));
    }
    const now = this.now();
    const updatedTasks: TaskRecord[] = [];
    const updatedPlacements: PlannedPlacementRecord[] = [];
    const removedPlacementIds: string[] = [];
    for (const item of changed) {
      const task = taskById.get(item.taskId)!;
      const existing = placementByTask.get(task.id);
      if (item.kind === 'remove') {
        updatedTasks.push(
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
        if (existing) removedPlacementIds.push(existing.id);
        continue;
      }
      if (item.kind !== 'move' || !item.proposedDate) continue;
      const source = task.flexibleStartDate ? 'flexibleRange' : 'plannedDate';
      const updatedTask =
        source === 'flexibleRange'
          ? { ...task, modifiedAt: now }
          : { ...task, plannedDate: item.proposedDate, modifiedAt: now };
      const group = agendaGroupForTask(updatedTask);
      const key = `${item.proposedDate}|${group}`;
      const preserveOrder = existing?.localDate === item.proposedDate && existing.group === group;
      const order = preserveOrder ? existing.order : (nextOrder.get(key) ?? 0);
      if (!preserveOrder) nextOrder.set(key, order + 1);
      updatedTasks.push(updatedTask);
      updatedPlacements.push({
        id: existing?.id ?? task.id,
        taskId: task.id,
        localDate: item.proposedDate,
        group,
        order,
        source,
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
      });
    }

    await this.db.transaction(
      'rw',
      [this.db.tasks, this.db.plannedPlacements, this.db.reviewRecords],
      async () => {
        if (updatedTasks.length) await this.db.tasks.bulkPut(updatedTasks);
        if (updatedPlacements.length) await this.db.plannedPlacements.bulkPut(updatedPlacements);
        if (removedPlacementIds.length)
          await this.db.plannedPlacements.bulkDelete(removedPlacementIds);
        if (reviewId) {
          const review = await this.db.reviewRecords.get(reviewId);
          if (!review || !isValidReviewRecord(review)) throw new Error('Review not found.');
          await this.db.reviewRecords.update(reviewId, {
            appliedActionSummary: {
              movedTaskCount: preview.items.filter(
                (item) => item.kind === 'move' && !item.unchanged,
              ).length,
              unplannedTaskCount: preview.items.filter(
                (item) => item.kind === 'remove' && !item.unchanged,
              ).length,
              unchangedTaskCount: preview.items.filter((item) => item.unchanged).length,
              appliedAt: now,
            },
            modifiedAt: now,
          });
        }
        await this.beforeCommit?.();
      },
    );
    this.notify();
    return preview;
  }
}

export const reviewRepository = new ReviewRepository();
