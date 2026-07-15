import { database, type PlaniblyDatabase } from './database';
import {
  localDateFromDate,
  planningOverviewFromSnapshot,
  smartTasksFromSnapshot,
  validatePlanning,
} from './planning';
import {
  INBOX_LIST_ID,
  type AreaRecord,
  type DeletionEntityKind,
  type DeletionReceipt,
  type ListMode,
  type PlanListRecord,
  type PlannerSnapshot,
  type PlanningOverview,
  type SearchFilters,
  type SearchResult,
  type SmartListKey,
  type TagRecord,
  type TaskRecord,
  type TaskPlanning,
  type TaskRelationshipRecord,
  type TaskStepRecord,
  type TaskTagRecord,
} from './plannerTypes';

export class NonEmptyEntityError extends Error {
  public constructor(entity: 'area' | 'list') {
    super(`The ${entity} is not empty.`);
    this.name = 'NonEmptyEntityError';
  }
}

export class TagInUseError extends Error {
  public constructor() {
    super('The tag is assigned to one or more tasks.');
    this.name = 'TagInUseError';
  }
}

export class RelationshipValidationError extends Error {
  public constructor(public readonly reason: 'self' | 'cycle') {
    super(
      reason === 'self'
        ? 'A task cannot have a relationship with itself.'
        : 'That relationship would create a cycle.',
    );
    this.name = 'RelationshipValidationError';
  }
}

export class TaskBlockedError extends Error {
  public constructor(public readonly blockerIds: string[]) {
    super('Complete the tasks listed under Before first.');
    this.name = 'TaskBlockedError';
  }
}

export class RestoreParentRequiredError extends Error {
  public constructor(public readonly parentLabels: string[]) {
    super(`Restore ${parentLabels.join(' and ')} first.`);
    this.name = 'RestoreParentRequiredError';
  }
}

type RepositoryOptions = {
  now?: () => string;
  today?: () => string;
  createId?: () => string;
  notify?: () => void;
};

export const PLANNER_DATA_CHANGED_EVENT = 'planibly:planner-data-changed';

function notifyPlannerDataChanged(): void {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}

function active<T extends { deletedAt?: string }>(record: T): boolean {
  return record.deletedAt === undefined;
}

function byOrder<T extends { order: number }>(left: T, right: T): number {
  return left.order - right.order;
}

function byDeletedAtDescending<T extends { deletedAt?: string }>(left: T, right: T): number {
  return (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '');
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeTagName(value: string): string {
  return requiredText(value, 'Tag name').toLocaleLowerCase();
}

export class PlannerRepository {
  private readonly now: () => string;
  private readonly today: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: RepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.today = options.today ?? (() => localDateFromDate(new Date()));
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? notifyPlannerDataChanged;
  }

  public async getSnapshot(): Promise<PlannerSnapshot> {
    const [areas, lists, tasks, taskSteps, tags, taskTags, taskRelationships] = await Promise.all([
      this.db.areas.toArray(),
      this.db.lists.toArray(),
      this.db.tasks.toArray(),
      this.db.taskSteps.toArray(),
      this.db.tags.toArray(),
      this.db.taskTags.toArray(),
      this.db.taskRelationships.toArray(),
    ]);
    const activeTasks = tasks.filter(active).sort(byOrder);
    const activeTaskIds = new Set(activeTasks.map((task) => task.id));
    const activeTags = tags.filter(active);
    const activeTagIds = new Set(activeTags.map((tag) => tag.id));
    const activeRelationships = taskRelationships.filter(
      (relationship) =>
        active(relationship) &&
        activeTaskIds.has(relationship.predecessorTaskId) &&
        activeTaskIds.has(relationship.successorTaskId),
    );
    const completedTaskIds = new Set(
      activeTasks.filter((task) => task.status === 'completed').map((task) => task.id),
    );
    const blockedByTaskId: Record<string, string[]> = {};
    for (const relationship of activeRelationships) {
      if (!completedTaskIds.has(relationship.predecessorTaskId)) {
        (blockedByTaskId[relationship.successorTaskId] ??= []).push(relationship.predecessorTaskId);
      }
    }

    return {
      areas: areas.filter(active).sort(byOrder),
      lists: lists.filter((list) => active(list) && list.archivedAt === undefined).sort(byOrder),
      archivedProjects: lists
        .filter((list) => active(list) && list.mode === 'project' && list.archivedAt !== undefined)
        .sort(byOrder),
      tasks: activeTasks,
      taskSteps: taskSteps
        .filter((step) => active(step) && activeTaskIds.has(step.taskId))
        .sort(byOrder),
      tags: activeTags.sort((left, right) => left.name.localeCompare(right.name)),
      taskTags: taskTags.filter(
        (assignment) =>
          active(assignment) &&
          activeTaskIds.has(assignment.taskId) &&
          activeTagIds.has(assignment.tagId),
      ),
      taskRelationships: activeRelationships,
      blockedByTaskId,
      projectProgressByListId: Object.fromEntries(
        lists
          .filter((list) => active(list) && list.mode === 'project')
          .map((list) => {
            const projectTasks = activeTasks.filter((task) => task.listId === list.id);
            const completedCount = projectTasks.filter(
              (task) => task.status === 'completed',
            ).length;
            const incomplete = projectTasks.filter((task) => task.status !== 'completed');
            const nextAction = incomplete.find(
              (task) => (blockedByTaskId[task.id]?.length ?? 0) === 0,
            );
            return [
              list.id,
              {
                listId: list.id,
                completedCount,
                totalCount: projectTasks.length,
                nextActionId: nextAction?.id,
                allRemainingBlocked: incomplete.length > 0 && nextAction === undefined,
              },
            ];
          }),
      ),
      deletedAreas: areas.filter((area) => !active(area)).sort(byDeletedAtDescending),
      deletedLists: lists.filter((list) => !active(list)).sort(byDeletedAtDescending),
      deletedTasks: tasks.filter((task) => !active(task)).sort(byDeletedAtDescending),
      deletedSteps: taskSteps.filter((step) => !active(step)).sort(byDeletedAtDescending),
    };
  }

  public async createArea(name: string, color: string): Promise<AreaRecord> {
    const now = this.now();
    const record: AreaRecord = {
      id: this.createId(),
      name: requiredText(name, 'Area name'),
      color,
      order: await this.db.areas.filter(active).count(),
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.areas.add(record);
    this.notify();
    return record;
  }

  public async updateArea(id: string, name: string, color: string): Promise<void> {
    await this.db.areas.update(id, {
      name: requiredText(name, 'Area name'),
      color,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async moveArea(id: string, direction: -1 | 1): Promise<void> {
    await this.moveRecord(this.db.areas, id, direction, (record) => active(record));
  }

  public async deleteArea(
    id: string,
    strategy?: { type: 'move'; destinationAreaId: string } | { type: 'deleteContents' },
  ): Promise<DeletionReceipt> {
    const area = await this.db.areas.get(id);
    if (!area || !active(area)) throw new Error('Area not found.');
    const groupId = this.createId();
    const deletedAt = this.now();
    let movedListIds: string[] | undefined;
    await this.db.transaction(
      'rw',
      [
        this.db.areas,
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        const lists = (await this.db.lists.where('areaId').equals(id).toArray()).filter(active);
        if (lists.length > 0 && strategy === undefined) throw new NonEmptyEntityError('area');

        const now = deletedAt;
        if (strategy?.type === 'move') {
          const destination = await this.db.areas.get(strategy.destinationAreaId);
          if (!destination || !active(destination) || destination.id === id) {
            throw new Error('Choose an available destination area.');
          }
          const destinationLists = (
            await this.db.lists.where('areaId').equals(destination.id).toArray()
          )
            .filter(active)
            .sort(byOrder);
          movedListIds = lists.map((list) => list.id);
          await Promise.all(
            lists.map((list, index) =>
              this.db.lists.update(list.id, {
                areaId: destination.id,
                order: destinationLists.length + index,
                modifiedAt: now,
              }),
            ),
          );
        } else if (strategy?.type === 'deleteContents') {
          const listIds = new Set(lists.map((list) => list.id));
          const taskIds = (await this.db.tasks.toArray())
            .filter((task) => active(task) && listIds.has(task.listId))
            .map((task) => task.id);
          await Promise.all(
            lists.map((list) =>
              this.db.lists.update(list.id, {
                deletedAt: now,
                deletionGroupId: groupId,
                modifiedAt: now,
              }),
            ),
          );
          await this.softDeleteTasks(taskIds, now, groupId);
        }

        await this.db.areas.update(id, {
          deletedAt: now,
          deletionGroupId: groupId,
          modifiedAt: now,
        });
      },
    );
    this.notify();
    return {
      groupId,
      kind: 'area',
      entityId: id,
      label: area.name,
      deletedAt,
      movedListIds,
    };
  }

  public async createList(
    areaId: string,
    name: string,
    color: string,
    mode: ListMode = 'standard',
  ): Promise<PlanListRecord> {
    const now = this.now();
    const siblings = (await this.db.lists.where('areaId').equals(areaId).toArray()).filter(active);
    const record: PlanListRecord = {
      id: this.createId(),
      areaId,
      name: requiredText(name, 'List name'),
      color,
      order: siblings.length,
      mode,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.lists.add(record);
    this.notify();
    return record;
  }

  public async updateList(id: string, name: string, color: string): Promise<void> {
    const list = await this.requireEditableList(id);
    await this.db.lists.update(list.id, {
      name: requiredText(name, 'List name'),
      color,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async updateProjectDetails(
    id: string,
    outcome: string,
    targetDate: string,
  ): Promise<void> {
    const list = await this.requireEditableList(id);
    if (list.mode !== 'project') throw new Error('This list is not a project.');
    await this.db.lists.update(id, {
      projectOutcome: outcome.trim() || undefined,
      projectTargetDate: targetDate || undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async convertListMode(
    id: string,
    mode: ListMode,
    confirmMetadataRemoval = false,
  ): Promise<void> {
    const list = await this.requireEditableList(id);
    if (list.mode === mode || (list.mode === undefined && mode === 'standard')) return;
    if (list.archivedAt !== undefined) throw new Error('Restore the archived project first.');
    if (
      mode === 'standard' &&
      !confirmMetadataRemoval &&
      (list.projectOutcome !== undefined || list.projectTargetDate !== undefined)
    ) {
      throw new Error('Confirm removal of the project outcome and target date.');
    }
    await this.db.lists.update(id, {
      mode,
      projectOutcome: mode === 'standard' ? undefined : list.projectOutcome,
      projectTargetDate: mode === 'standard' ? undefined : list.projectTargetDate,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async archiveProject(id: string): Promise<DeletionReceipt> {
    const list = await this.requireEditableList(id);
    if (list.mode !== 'project') throw new Error('Only projects can be archived.');
    const now = this.now();
    const groupId = this.createId();
    await this.db.lists.update(id, {
      archivedAt: now,
      deletionGroupId: groupId,
      modifiedAt: now,
    });
    this.notify();
    return {
      groupId,
      kind: 'list',
      entityId: id,
      label: list.name,
      deletedAt: now,
      operation: 'archive',
    };
  }

  public async restoreArchivedProject(id: string): Promise<void> {
    const list = await this.db.lists.get(id);
    if (!list || !active(list) || list.mode !== 'project') throw new Error('Project not found.');
    await this.db.lists.update(id, {
      archivedAt: undefined,
      deletionGroupId: undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async moveList(id: string, direction: -1 | 1): Promise<void> {
    const list = await this.requireEditableList(id);
    await this.moveRecord(
      this.db.lists,
      id,
      direction,
      (candidate) => active(candidate) && candidate.areaId === list.areaId,
    );
  }

  public async deleteList(id: string, confirmContents = false): Promise<DeletionReceipt> {
    const list = await this.requireEditableList(id);
    const groupId = this.createId();
    const deletedAt = this.now();
    await this.db.transaction(
      'rw',
      [
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        const tasks = (await this.db.tasks.where('listId').equals(id).toArray()).filter(active);
        if (tasks.length > 0 && !confirmContents) throw new NonEmptyEntityError('list');
        const now = deletedAt;
        await this.db.lists.update(id, {
          deletedAt: now,
          deletionGroupId: groupId,
          modifiedAt: now,
        });
        await this.softDeleteTasks(
          tasks.map((task) => task.id),
          now,
          groupId,
        );
      },
    );
    this.notify();
    return { groupId, kind: 'list', entityId: id, label: list.name, deletedAt };
  }

  public async createTask(
    title: string,
    listId = INBOX_LIST_ID,
    planning: TaskPlanning = {},
  ): Promise<TaskRecord> {
    const list = await this.requireActiveList(listId);
    const now = this.now();
    const siblings = (await this.db.tasks.where('listId').equals(listId).toArray()).filter(active);
    const record: TaskRecord = {
      id: this.createId(),
      title: requiredText(title, 'Task title'),
      listId,
      status: list.systemType === 'inbox' ? 'inbox' : 'available',
      order: siblings.length,
      createdAt: now,
      modifiedAt: now,
      ...validatePlanning(planning),
    };
    await this.db.tasks.add(record);
    this.notify();
    return record;
  }

  public async updateTask(id: string, title: string, listId: string): Promise<void> {
    const [task, list] = await Promise.all([this.db.tasks.get(id), this.requireActiveList(listId)]);
    if (!task || !active(task)) throw new Error('Task not found.');
    await this.db.tasks.update(id, {
      title: requiredText(title, 'Task title'),
      listId,
      status:
        task.status === 'completed'
          ? 'completed'
          : list.systemType === 'inbox'
            ? 'inbox'
            : 'available',
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async updateTaskPlanning(id: string, planning: TaskPlanning): Promise<void> {
    await this.requireActiveTask(id);
    const validated = validatePlanning(planning);
    await this.db.tasks.update(id, {
      plannedDate: undefined,
      deadlineDate: undefined,
      flexibleStartDate: undefined,
      flexibleEndDate: undefined,
      timeWindow: undefined,
      exactStartTime: undefined,
      estimatedDurationMinutes: undefined,
      ...validated,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    const task = await this.requireActiveTask(id);
    if (completed) {
      const blockerIds = await this.getBlockingTaskIds(id);
      if (blockerIds.length > 0) throw new TaskBlockedError(blockerIds);
    }
    const list = await this.requireActiveList(task.listId);
    await this.db.tasks.update(id, {
      status: completed ? 'completed' : list.systemType === 'inbox' ? 'inbox' : 'available',
      completedClearedAt: undefined,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async deleteTask(id: string): Promise<DeletionReceipt> {
    const task = await this.requireActiveTask(id);
    const now = this.now();
    const groupId = this.createId();
    await this.db.transaction(
      'rw',
      this.db.tasks,
      this.db.taskSteps,
      this.db.taskTags,
      this.db.taskRelationships,
      () => this.softDeleteTasks([id], now, groupId),
    );
    this.notify();
    return { groupId, kind: 'task', entityId: id, label: task.title, deletedAt: now };
  }

  public async clearCompletedTasks(listId: string): Promise<number> {
    await this.requireActiveList(listId);
    const completedTasks = (await this.db.tasks.where('listId').equals(listId).toArray()).filter(
      (task) =>
        active(task) && task.status === 'completed' && task.completedClearedAt === undefined,
    );
    if (completedTasks.length === 0) return 0;

    const now = this.now();
    await this.db.transaction('rw', this.db.tasks, async () => {
      await Promise.all(
        completedTasks.map((task) =>
          this.db.tasks.update(task.id, { completedClearedAt: now, modifiedAt: now }),
        ),
      );
    });
    this.notify();
    return completedTasks.length;
  }

  public async createStep(taskId: string, title: string): Promise<TaskStepRecord> {
    await this.requireActiveTask(taskId);
    const siblings = (await this.db.taskSteps.where('taskId').equals(taskId).toArray()).filter(
      active,
    );
    const now = this.now();
    const step: TaskStepRecord = {
      id: this.createId(),
      taskId,
      title: requiredText(title, 'Step title'),
      completed: false,
      order: siblings.length,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.taskSteps.add(step);
    this.notify();
    return step;
  }

  public async updateStep(id: string, title: string): Promise<void> {
    await this.requireActiveStep(id);
    await this.db.taskSteps.update(id, {
      title: requiredText(title, 'Step title'),
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async setStepCompleted(id: string, completed: boolean): Promise<void> {
    await this.requireActiveStep(id);
    await this.db.taskSteps.update(id, { completed, modifiedAt: this.now() });
    this.notify();
  }

  public async moveStep(id: string, direction: -1 | 1): Promise<void> {
    const step = await this.requireActiveStep(id);
    await this.moveRecord(
      this.db.taskSteps,
      id,
      direction,
      (candidate) => active(candidate) && candidate.taskId === step.taskId,
    );
  }

  public async deleteStep(id: string): Promise<DeletionReceipt> {
    const step = await this.requireActiveStep(id);
    const now = this.now();
    const groupId = this.createId();
    await this.db.taskSteps.update(id, {
      deletedAt: now,
      deletionGroupId: groupId,
      modifiedAt: now,
    });
    this.notify();
    return { groupId, kind: 'step', entityId: id, label: step.title, deletedAt: now };
  }

  public async createTag(name: string, color: string): Promise<TagRecord> {
    const tagName = requiredText(name, 'Tag name');
    await this.assertUniqueTagName(tagName);
    const now = this.now();
    const tag: TagRecord = {
      id: this.createId(),
      name: tagName,
      normalizedName: normalizeTagName(tagName),
      color,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.tags.add(tag);
    this.notify();
    return tag;
  }

  public async updateTag(id: string, name: string, color: string): Promise<void> {
    await this.requireActiveTag(id);
    const tagName = requiredText(name, 'Tag name');
    await this.assertUniqueTagName(tagName, id);
    await this.db.tags.update(id, {
      name: tagName,
      normalizedName: normalizeTagName(tagName),
      color,
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async deleteTag(id: string, confirmAssignments = false): Promise<void> {
    await this.requireActiveTag(id);
    const assignments = (await this.db.taskTags.where('tagId').equals(id).toArray()).filter(active);
    if (assignments.length > 0 && !confirmAssignments) throw new TagInUseError();
    const now = this.now();
    await this.db.transaction('rw', this.db.tags, this.db.taskTags, async () => {
      await this.db.tags.update(id, { deletedAt: now, modifiedAt: now });
      await this.db.taskTags.where('tagId').equals(id).delete();
    });
    this.notify();
  }

  public async assignTag(taskId: string, tagId: string): Promise<TaskTagRecord> {
    await Promise.all([this.requireActiveTask(taskId), this.requireActiveTag(tagId)]);
    const existing = await this.db.taskTags.where('[taskId+tagId]').equals([taskId, tagId]).first();
    if (existing) {
      if (!active(existing)) {
        const revived = {
          ...existing,
          modifiedAt: this.now(),
          deletedAt: undefined,
          deletionGroupId: undefined,
        };
        await this.db.taskTags.put(revived);
        this.notify();
        return revived;
      }
      return existing;
    }
    const now = this.now();
    const assignment: TaskTagRecord = {
      id: this.createId(),
      taskId,
      tagId,
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.taskTags.add(assignment);
    this.notify();
    return assignment;
  }

  public async unassignTag(taskId: string, tagId: string): Promise<void> {
    await this.db.taskTags.where('[taskId+tagId]').equals([taskId, tagId]).delete();
    this.notify();
  }

  public async addRelationship(
    predecessorTaskId: string,
    successorTaskId: string,
  ): Promise<TaskRelationshipRecord> {
    if (predecessorTaskId === successorTaskId) throw new RelationshipValidationError('self');
    const relationship = await this.db.transaction(
      'rw',
      this.db.tasks,
      this.db.taskRelationships,
      async () => {
        await Promise.all([
          this.requireActiveTask(predecessorTaskId),
          this.requireActiveTask(successorTaskId),
        ]);
        const relationships = (await this.db.taskRelationships.toArray()).filter(active);
        const existing = relationships.find(
          (candidate) =>
            candidate.predecessorTaskId === predecessorTaskId &&
            candidate.successorTaskId === successorTaskId,
        );
        if (existing) return existing;
        if (this.isReachable(successorTaskId, predecessorTaskId, relationships)) {
          throw new RelationshipValidationError('cycle');
        }
        const now = this.now();
        const deletedMatch = (await this.db.taskRelationships.toArray()).find(
          (candidate) =>
            candidate.predecessorTaskId === predecessorTaskId &&
            candidate.successorTaskId === successorTaskId,
        );
        if (deletedMatch) {
          const revived = {
            ...deletedMatch,
            deletedAt: undefined,
            deletionGroupId: undefined,
            modifiedAt: now,
          };
          await this.db.taskRelationships.put(revived);
          return revived;
        }
        const created: TaskRelationshipRecord = {
          id: this.createId(),
          predecessorTaskId,
          successorTaskId,
          createdAt: now,
          modifiedAt: now,
        };
        await this.db.taskRelationships.add(created);
        return created;
      },
    );
    this.notify();
    return relationship;
  }

  public async removeRelationship(id: string): Promise<void> {
    const relationship = await this.db.taskRelationships.get(id);
    if (!relationship || !active(relationship)) return;
    const now = this.now();
    await this.db.taskRelationships.update(id, { deletedAt: now, modifiedAt: now });
    this.notify();
  }

  public async getSmartTasks(key: SmartListKey, today = this.today()): Promise<TaskRecord[]> {
    return smartTasksFromSnapshot(await this.getSnapshot(), key, today);
  }

  public async getPlanningOverview(today = this.today()): Promise<PlanningOverview> {
    return planningOverviewFromSnapshot(await this.getSnapshot(), today);
  }

  public async search(query: string, filters: SearchFilters): Promise<SearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const snapshot = await this.getSnapshot();
    const allLists = [...snapshot.lists, ...snapshot.archivedProjects];
    const areaById = new Map(snapshot.areas.map((area) => [area.id, area]));
    const listById = new Map(allLists.map((list) => [list.id, list]));
    const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const enabled = new Set(filters.types);
    const results: SearchResult[] = [];
    const matches = (value: string) => value.toLocaleLowerCase().includes(normalized);

    if (enabled.has('area')) {
      for (const area of snapshot.areas) {
        if (matches(area.name)) {
          results.push({
            id: area.id,
            type: 'area',
            title: area.name,
            location: 'Area',
            url: `/lists?area=${encodeURIComponent(area.id)}`,
          });
        }
      }
    }

    if (enabled.has('list')) {
      for (const list of allLists) {
        const archived = list.archivedAt !== undefined;
        if (archived && !filters.includeArchived) continue;
        if (matches(list.name)) {
          const areaName = list.areaId ? areaById.get(list.areaId)?.name : undefined;
          results.push({
            id: list.id,
            type: 'list',
            title: list.name,
            location: `${list.mode === 'project' ? 'Project' : 'List'}${areaName ? ` in ${areaName}` : ''}`,
            url: archived
              ? `/lists?archived=${encodeURIComponent(list.id)}`
              : `/lists?area=${encodeURIComponent(list.areaId ?? '')}&list=${encodeURIComponent(list.id)}`,
            archived,
          });
        }
      }
    }

    if (enabled.has('task')) {
      for (const task of snapshot.tasks) {
        const list = listById.get(task.listId);
        if (!list) continue;
        const archived = list.archivedAt !== undefined;
        if (archived && !filters.includeArchived) continue;
        if (task.status === 'completed' && !filters.includeCompleted) continue;
        if (matches(task.title)) {
          results.push({
            id: task.id,
            type: 'task',
            title: task.title,
            location: `${list.name}${list.areaId ? ` in ${areaById.get(list.areaId)?.name ?? 'Area'}` : ''}`,
            url: archived
              ? `/lists?archived=${encodeURIComponent(list.id)}&task=${encodeURIComponent(task.id)}`
              : `/lists?list=${encodeURIComponent(list.id)}&task=${encodeURIComponent(task.id)}`,
            completed: task.status === 'completed',
            archived,
          });
        }
      }
    }

    if (enabled.has('step')) {
      for (const step of snapshot.taskSteps) {
        const task = taskById.get(step.taskId);
        const list = task ? listById.get(task.listId) : undefined;
        if (!task || !list) continue;
        const archived = list.archivedAt !== undefined;
        if (archived && !filters.includeArchived) continue;
        if ((step.completed || task.status === 'completed') && !filters.includeCompleted) continue;
        if (matches(step.title)) {
          results.push({
            id: step.id,
            type: 'step',
            title: step.title,
            location: `Step in ${task.title} · ${list.name}`,
            url: archived
              ? `/lists?archived=${encodeURIComponent(list.id)}&task=${encodeURIComponent(task.id)}`
              : `/lists?list=${encodeURIComponent(list.id)}&task=${encodeURIComponent(task.id)}`,
            completed: step.completed,
            archived,
          });
        }
      }
    }

    if (enabled.has('tag')) {
      for (const tag of snapshot.tags) {
        if (matches(tag.name)) {
          results.push({
            id: tag.id,
            type: 'tag',
            title: tag.name,
            location: 'Reusable tag',
            url: `/lists?tag=${encodeURIComponent(tag.id)}`,
          });
        }
      }
    }
    return results.sort((left, right) => left.title.localeCompare(right.title));
  }

  public async restoreDeletedEntity(
    kind: DeletionEntityKind,
    id: string,
    restoreParents = false,
  ): Promise<void> {
    const now = this.now();
    await this.db.transaction(
      'rw',
      [
        this.db.areas,
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.tags,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        const parentLabels = await this.getDeletedParentLabels(kind, id);
        if (parentLabels.length > 0 && !restoreParents) {
          throw new RestoreParentRequiredError(parentLabels);
        }
        if (restoreParents) await this.restoreRequiredParents(kind, id, now);

        if (kind === 'area') {
          const area = await this.db.areas.get(id);
          if (!area?.deletedAt) throw new Error('Deleted area not found.');
          await this.db.areas.update(id, this.restoredFields(now));
        } else if (kind === 'list') {
          const list = await this.db.lists.get(id);
          if (!list?.deletedAt) throw new Error('Deleted list not found.');
          await this.db.lists.update(id, this.restoredFields(now));
        } else if (kind === 'task') {
          const task = await this.db.tasks.get(id);
          if (!task?.deletedAt) throw new Error('Deleted task not found.');
          await this.db.tasks.update(id, this.restoredFields(now));
          await this.restoreTaskDetails(task, now);
        } else {
          const step = await this.db.taskSteps.get(id);
          if (!step?.deletedAt) throw new Error('Deleted step not found.');
          await this.db.taskSteps.update(id, this.restoredFields(now));
        }
      },
    );
    this.notify();
  }

  public async restoreDeletionGroup(groupId: string, receipt?: DeletionReceipt): Promise<void> {
    const now = this.now();
    await this.db.transaction(
      'rw',
      [
        this.db.areas,
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.tags,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        if (receipt?.operation === 'archive') {
          const project = await this.db.lists.get(receipt.entityId);
          if (project?.archivedAt === undefined || project.deletionGroupId !== groupId) {
            throw new Error('This archive can no longer be undone.');
          }
          await this.db.lists.update(project.id, {
            archivedAt: undefined,
            deletionGroupId: undefined,
            modifiedAt: now,
          });
          return;
        }
        const [areas, lists, tasks, steps, assignments] = await Promise.all([
          this.db.areas.where('deletionGroupId').equals(groupId).toArray(),
          this.db.lists.where('deletionGroupId').equals(groupId).toArray(),
          this.db.tasks.where('deletionGroupId').equals(groupId).toArray(),
          this.db.taskSteps.where('deletionGroupId').equals(groupId).toArray(),
          this.db.taskTags.where('deletionGroupId').equals(groupId).toArray(),
        ]);
        if (areas.length + lists.length + tasks.length + steps.length === 0) {
          throw new Error('This deletion can no longer be undone.');
        }
        await Promise.all([
          ...areas.map((area) => this.db.areas.update(area.id, this.restoredFields(now))),
          ...lists.map((list) => this.db.lists.update(list.id, this.restoredFields(now))),
          ...tasks.map((task) => this.db.tasks.update(task.id, this.restoredFields(now))),
          ...steps.map((step) => this.db.taskSteps.update(step.id, this.restoredFields(now))),
          ...assignments.map((assignment) =>
            this.db.taskTags.update(assignment.id, this.restoredFields(now)),
          ),
        ]);
        if (receipt?.kind === 'area' && receipt.movedListIds?.length) {
          await Promise.all(
            receipt.movedListIds.map((listId) =>
              this.db.lists.update(listId, {
                areaId: receipt.entityId,
                modifiedAt: now,
              }),
            ),
          );
        }
        for (const task of tasks) await this.restoreTaskRelationships(task, now);
      },
    );
    this.notify();
  }

  public async permanentlyDelete(kind: DeletionEntityKind, id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.areas,
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        const areaIds = new Set<string>();
        const listIds = new Set<string>();
        const taskIds = new Set<string>();
        const stepIds = new Set<string>();
        if (kind === 'area') {
          const area = await this.db.areas.get(id);
          if (!area?.deletedAt) throw new Error('Deleted area not found.');
          areaIds.add(id);
          for (const list of await this.db.lists.where('areaId').equals(id).toArray()) {
            listIds.add(list.id);
          }
        } else if (kind === 'list') {
          const list = await this.db.lists.get(id);
          if (!list?.deletedAt) throw new Error('Deleted list not found.');
          listIds.add(id);
        } else if (kind === 'task') {
          const task = await this.db.tasks.get(id);
          if (!task?.deletedAt) throw new Error('Deleted task not found.');
          taskIds.add(id);
        } else {
          const step = await this.db.taskSteps.get(id);
          if (!step?.deletedAt) throw new Error('Deleted step not found.');
          stepIds.add(id);
        }
        if (listIds.size > 0) {
          for (const task of await this.db.tasks.toArray()) {
            if (listIds.has(task.listId)) taskIds.add(task.id);
          }
        }
        if (taskIds.size > 0) {
          for (const step of await this.db.taskSteps.toArray()) {
            if (taskIds.has(step.taskId)) stepIds.add(step.id);
          }
        }
        await this.purgeIds(areaIds, listIds, taskIds, stepIds);
      },
    );
    this.notify();
  }

  public async emptyRecentlyDeleted(): Promise<number> {
    const [areas, lists, tasks, steps] = await Promise.all([
      this.db.areas.filter((area) => !active(area)).toArray(),
      this.db.lists.filter((list) => !active(list)).toArray(),
      this.db.tasks.filter((task) => !active(task)).toArray(),
      this.db.taskSteps.filter((step) => !active(step)).toArray(),
    ]);
    const count = areas.length + lists.length + tasks.length + steps.length;
    if (count === 0) return 0;
    await this.db.transaction(
      'rw',
      [
        this.db.areas,
        this.db.lists,
        this.db.tasks,
        this.db.taskSteps,
        this.db.tags,
        this.db.taskTags,
        this.db.taskRelationships,
      ],
      async () => {
        await this.purgeIds(
          new Set(areas.map((area) => area.id)),
          new Set(lists.map((list) => list.id)),
          new Set(tasks.map((task) => task.id)),
          new Set(steps.map((step) => step.id)),
        );
        await this.db.tags.filter((tag) => !active(tag)).delete();
        await this.db.taskRelationships.filter((relationship) => !active(relationship)).delete();
        await this.db.taskTags.filter((assignment) => !active(assignment)).delete();
      },
    );
    this.notify();
    return count;
  }

  private restoredFields(now: string) {
    return { deletedAt: undefined, deletionGroupId: undefined, modifiedAt: now };
  }

  private async getDeletedParentLabels(kind: DeletionEntityKind, id: string): Promise<string[]> {
    const labels: string[] = [];
    let list: PlanListRecord | undefined;
    let task: TaskRecord | undefined;
    if (kind === 'step') {
      const step = await this.db.taskSteps.get(id);
      if (!step) throw new Error('Deleted step not found.');
      task = await this.db.tasks.get(step.taskId);
      if (task?.deletedAt) labels.push(`task “${task.title}”`);
    } else if (kind === 'task') {
      task = await this.db.tasks.get(id);
      if (!task) throw new Error('Deleted task not found.');
    }
    if (task) list = await this.db.lists.get(task.listId);
    if (kind === 'list') {
      list = await this.db.lists.get(id);
      if (!list) throw new Error('Deleted list not found.');
    }
    if (list?.deletedAt)
      labels.push(`${list.mode === 'project' ? 'project' : 'list'} “${list.name}”`);
    if (list?.areaId) {
      const area = await this.db.areas.get(list.areaId);
      if (area?.deletedAt) labels.push(`area “${area.name}”`);
    }
    return labels;
  }

  private async restoreRequiredParents(
    kind: DeletionEntityKind,
    id: string,
    now: string,
  ): Promise<void> {
    let list: PlanListRecord | undefined;
    let task: TaskRecord | undefined;
    if (kind === 'step') {
      const step = await this.db.taskSteps.get(id);
      task = step ? await this.db.tasks.get(step.taskId) : undefined;
    } else if (kind === 'task') {
      task = await this.db.tasks.get(id);
    }
    if (task) list = await this.db.lists.get(task.listId);
    if (kind === 'list') list = await this.db.lists.get(id);
    if (list?.areaId) {
      const area = await this.db.areas.get(list.areaId);
      if (area?.deletedAt) await this.db.areas.update(area.id, this.restoredFields(now));
    }
    if (list?.deletedAt) await this.db.lists.update(list.id, this.restoredFields(now));
    if (kind === 'step' && task?.deletedAt) {
      await this.db.tasks.update(task.id, this.restoredFields(now));
      await this.restoreTaskDetails(task, now);
    }
  }

  private sameDeletion(
    record: { deletedAt?: string; deletionGroupId?: string },
    task: TaskRecord,
  ): boolean {
    if (!record.deletedAt) return false;
    if (task.deletionGroupId) return record.deletionGroupId === task.deletionGroupId;
    return record.deletionGroupId === undefined && record.deletedAt === task.deletedAt;
  }

  private async restoreTaskDetails(task: TaskRecord, now: string): Promise<void> {
    const [steps, assignments, tags] = await Promise.all([
      this.db.taskSteps.where('taskId').equals(task.id).toArray(),
      this.db.taskTags.where('taskId').equals(task.id).toArray(),
      this.db.tags.toArray(),
    ]);
    const activeTagIds = new Set(tags.filter(active).map((tag) => tag.id));
    await Promise.all([
      ...steps
        .filter((step) => this.sameDeletion(step, task))
        .map((step) => this.db.taskSteps.update(step.id, this.restoredFields(now))),
      ...assignments
        .filter(
          (assignment) => this.sameDeletion(assignment, task) && activeTagIds.has(assignment.tagId),
        )
        .map((assignment) => this.db.taskTags.update(assignment.id, this.restoredFields(now))),
    ]);
    await this.restoreTaskRelationships(task, now);
  }

  private async restoreTaskRelationships(task: TaskRecord, now: string): Promise<void> {
    const [tasks, allRelationships] = await Promise.all([
      this.db.tasks.toArray(),
      this.db.taskRelationships.toArray(),
    ]);
    const activeTaskIds = new Set(tasks.filter(active).map((candidate) => candidate.id));
    const activeRelationships = allRelationships.filter(active);
    const candidates = allRelationships.filter(
      (relationship) =>
        this.sameDeletion(relationship, task) &&
        (relationship.predecessorTaskId === task.id || relationship.successorTaskId === task.id),
    );
    for (const relationship of candidates) {
      if (
        !activeTaskIds.has(relationship.predecessorTaskId) ||
        !activeTaskIds.has(relationship.successorTaskId)
      ) {
        continue;
      }
      if (
        this.isReachable(
          relationship.successorTaskId,
          relationship.predecessorTaskId,
          activeRelationships,
        )
      ) {
        continue;
      }
      const restored = { ...relationship, ...this.restoredFields(now) };
      await this.db.taskRelationships.put(restored);
      activeRelationships.push(restored);
    }
  }

  private async purgeIds(
    areaIds: Set<string>,
    listIds: Set<string>,
    taskIds: Set<string>,
    stepIds: Set<string>,
  ): Promise<void> {
    const [assignments, relationships] = await Promise.all([
      this.db.taskTags.toArray(),
      this.db.taskRelationships.toArray(),
    ]);
    await Promise.all([
      ...assignments
        .filter((assignment) => taskIds.has(assignment.taskId))
        .map((assignment) => this.db.taskTags.delete(assignment.id)),
      ...relationships
        .filter(
          (relationship) =>
            taskIds.has(relationship.predecessorTaskId) ||
            taskIds.has(relationship.successorTaskId),
        )
        .map((relationship) => this.db.taskRelationships.delete(relationship.id)),
      this.db.taskSteps.bulkDelete([...stepIds]),
      this.db.tasks.bulkDelete([...taskIds]),
      this.db.lists.bulkDelete([...listIds]),
      this.db.areas.bulkDelete([...areaIds]),
    ]);
  }

  private async getBlockingTaskIds(successorTaskId: string): Promise<string[]> {
    const [relationships, tasks] = await Promise.all([
      this.db.taskRelationships.where('successorTaskId').equals(successorTaskId).toArray(),
      this.db.tasks.toArray(),
    ]);
    const taskById = new Map(tasks.filter(active).map((task) => [task.id, task]));
    return relationships
      .filter(active)
      .map((relationship) => relationship.predecessorTaskId)
      .filter((id) => taskById.get(id)?.status !== 'completed' && taskById.has(id));
  }

  private isReachable(
    startTaskId: string,
    targetTaskId: string,
    relationships: TaskRelationshipRecord[],
  ): boolean {
    const successorsByTask = new Map<string, string[]>();
    for (const relationship of relationships) {
      const successors = successorsByTask.get(relationship.predecessorTaskId) ?? [];
      successors.push(relationship.successorTaskId);
      successorsByTask.set(relationship.predecessorTaskId, successors);
    }
    const pending = [startTaskId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const taskId = pending.pop()!;
      if (taskId === targetTaskId) return true;
      if (visited.has(taskId)) continue;
      visited.add(taskId);
      pending.push(...(successorsByTask.get(taskId) ?? []));
    }
    return false;
  }

  private async softDeleteTasks(taskIds: string[], now: string, groupId: string): Promise<void> {
    if (taskIds.length === 0) return;
    const taskIdSet = new Set(taskIds);
    const [steps, assignments, relationships] = await Promise.all([
      this.db.taskSteps.toArray(),
      this.db.taskTags.toArray(),
      this.db.taskRelationships.toArray(),
    ]);
    await Promise.all([
      ...taskIds.map((id) =>
        this.db.tasks.update(id, {
          deletedAt: now,
          deletionGroupId: groupId,
          modifiedAt: now,
        }),
      ),
      ...steps
        .filter((step) => active(step) && taskIdSet.has(step.taskId))
        .map((step) =>
          this.db.taskSteps.update(step.id, {
            deletedAt: now,
            deletionGroupId: groupId,
            modifiedAt: now,
          }),
        ),
      ...assignments
        .filter((assignment) => active(assignment) && taskIdSet.has(assignment.taskId))
        .map((assignment) =>
          this.db.taskTags.update(assignment.id, {
            deletedAt: now,
            deletionGroupId: groupId,
            modifiedAt: now,
          }),
        ),
      ...relationships
        .filter(
          (relationship) =>
            active(relationship) &&
            (taskIdSet.has(relationship.predecessorTaskId) ||
              taskIdSet.has(relationship.successorTaskId)),
        )
        .map((relationship) =>
          this.db.taskRelationships.update(relationship.id, {
            deletedAt: now,
            deletionGroupId: groupId,
            modifiedAt: now,
          }),
        ),
    ]);
  }

  private async assertUniqueTagName(name: string, exceptId?: string): Promise<void> {
    const normalizedName = normalizeTagName(name);
    const duplicate = (
      await this.db.tags.where('normalizedName').equals(normalizedName).toArray()
    ).find((tag) => active(tag) && tag.id !== exceptId);
    if (duplicate) throw new Error('A tag with that name already exists.');
  }

  private async requireActiveList(id: string): Promise<PlanListRecord> {
    const list = await this.db.lists.get(id);
    if (!list || !active(list)) throw new Error('List not found.');
    return list;
  }

  private async requireEditableList(id: string): Promise<PlanListRecord> {
    const list = await this.requireActiveList(id);
    if (list.systemType === 'inbox') throw new Error('Inbox cannot be changed.');
    return list;
  }

  private async requireActiveTask(id: string): Promise<TaskRecord> {
    const task = await this.db.tasks.get(id);
    if (!task || !active(task)) throw new Error('Task not found.');
    return task;
  }

  private async requireActiveStep(id: string): Promise<TaskStepRecord> {
    const step = await this.db.taskSteps.get(id);
    if (!step || !active(step)) throw new Error('Step not found.');
    return step;
  }

  private async requireActiveTag(id: string): Promise<TagRecord> {
    const tag = await this.db.tags.get(id);
    if (!tag || !active(tag)) throw new Error('Tag not found.');
    return tag;
  }

  private async moveRecord<T extends { id: string; order: number; modifiedAt: string }>(
    table: import('dexie').EntityTable<T, 'id'>,
    id: string,
    direction: -1 | 1,
    include: (record: T) => boolean,
  ): Promise<void> {
    const records = (await table.toArray()).filter(include).sort(byOrder);
    const index = records.findIndex((record) => record.id === id);
    const other = records[index + direction];
    const current = records[index];
    if (!current || !other) return;
    const now = this.now();
    await this.db.transaction('rw', table, async () => {
      await Promise.all([
        table.update(current, (record) => {
          record.order = other.order;
          record.modifiedAt = now;
        }),
        table.update(other, (record) => {
          record.order = current.order;
          record.modifiedAt = now;
        }),
      ]);
    });
    this.notify();
  }
}

export const plannerRepository = new PlannerRepository();
