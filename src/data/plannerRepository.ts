import { database, type PlaniblyDatabase } from './database';
import {
  INBOX_LIST_ID,
  type AreaRecord,
  type PlanListRecord,
  type PlannerSnapshot,
  type TagRecord,
  type TaskRecord,
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

type RepositoryOptions = {
  now?: () => string;
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
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: RepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
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
      lists: lists.filter(active).sort(byOrder),
      tasks: activeTasks,
      taskSteps: taskSteps
        .filter((step) => active(step) && activeTaskIds.has(step.taskId))
        .sort(byOrder),
      tags: activeTags.sort((left, right) => left.name.localeCompare(right.name)),
      taskTags: taskTags.filter(
        (assignment) => activeTaskIds.has(assignment.taskId) && activeTagIds.has(assignment.tagId),
      ),
      taskRelationships: activeRelationships,
      blockedByTaskId,
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
  ): Promise<void> {
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

        const now = this.now();
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
            lists.map((list) => this.db.lists.update(list.id, { deletedAt: now, modifiedAt: now })),
          );
          await this.softDeleteTasks(taskIds, now);
        }

        await this.db.areas.update(id, { deletedAt: now, modifiedAt: now });
      },
    );
    this.notify();
  }

  public async createList(areaId: string, name: string, color: string): Promise<PlanListRecord> {
    const now = this.now();
    const siblings = (await this.db.lists.where('areaId').equals(areaId).toArray()).filter(active);
    const record: PlanListRecord = {
      id: this.createId(),
      areaId,
      name: requiredText(name, 'List name'),
      color,
      order: siblings.length,
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

  public async moveList(id: string, direction: -1 | 1): Promise<void> {
    const list = await this.requireEditableList(id);
    await this.moveRecord(
      this.db.lists,
      id,
      direction,
      (candidate) => active(candidate) && candidate.areaId === list.areaId,
    );
  }

  public async deleteList(id: string, confirmContents = false): Promise<void> {
    await this.requireEditableList(id);
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
        const now = this.now();
        await this.db.lists.update(id, { deletedAt: now, modifiedAt: now });
        await this.softDeleteTasks(
          tasks.map((task) => task.id),
          now,
        );
      },
    );
    this.notify();
  }

  public async createTask(title: string, listId = INBOX_LIST_ID): Promise<TaskRecord> {
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

  public async deleteTask(id: string): Promise<void> {
    await this.requireActiveTask(id);
    const now = this.now();
    await this.db.transaction(
      'rw',
      this.db.tasks,
      this.db.taskSteps,
      this.db.taskTags,
      this.db.taskRelationships,
      () => this.softDeleteTasks([id], now),
    );
    this.notify();
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

  public async deleteStep(id: string): Promise<void> {
    await this.requireActiveStep(id);
    const now = this.now();
    await this.db.taskSteps.update(id, { deletedAt: now, modifiedAt: now });
    this.notify();
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
    const assignments = await this.db.taskTags.where('tagId').equals(id).toArray();
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
    if (existing) return existing;
    const assignment: TaskTagRecord = {
      id: this.createId(),
      taskId,
      tagId,
      createdAt: this.now(),
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
          const revived = { ...deletedMatch, deletedAt: undefined, modifiedAt: now };
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

  private async softDeleteTasks(taskIds: string[], now: string): Promise<void> {
    if (taskIds.length === 0) return;
    const taskIdSet = new Set(taskIds);
    const [steps, assignments, relationships] = await Promise.all([
      this.db.taskSteps.toArray(),
      this.db.taskTags.toArray(),
      this.db.taskRelationships.toArray(),
    ]);
    await Promise.all([
      ...taskIds.map((id) => this.db.tasks.update(id, { deletedAt: now, modifiedAt: now })),
      ...steps
        .filter((step) => active(step) && taskIdSet.has(step.taskId))
        .map((step) => this.db.taskSteps.update(step.id, { deletedAt: now, modifiedAt: now })),
      ...assignments
        .filter((assignment) => taskIdSet.has(assignment.taskId))
        .map((assignment) => this.db.taskTags.delete(assignment.id)),
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
