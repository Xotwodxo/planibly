import { database, type PlaniblyDatabase } from './database';
import {
  INBOX_LIST_ID,
  type AreaRecord,
  type PlanListRecord,
  type PlannerSnapshot,
  type TaskRecord,
} from './plannerTypes';

export class NonEmptyEntityError extends Error {
  public constructor(entity: 'area' | 'list') {
    super(`The ${entity} is not empty.`);
    this.name = 'NonEmptyEntityError';
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
    const [areas, lists, tasks] = await Promise.all([
      this.db.areas.toArray(),
      this.db.lists.toArray(),
      this.db.tasks.toArray(),
    ]);
    return {
      areas: areas.filter(active).sort(byOrder),
      lists: lists.filter(active).sort(byOrder),
      tasks: tasks.filter(active).sort(byOrder),
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
    await this.db.transaction('rw', this.db.areas, this.db.lists, this.db.tasks, async () => {
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
        const listIds = lists.map((list) => list.id);
        const tasks = (await this.db.tasks.toArray()).filter(
          (task) => active(task) && listIds.includes(task.listId),
        );
        await Promise.all([
          ...lists.map((list) =>
            this.db.lists.update(list.id, { deletedAt: now, modifiedAt: now }),
          ),
          ...tasks.map((task) =>
            this.db.tasks.update(task.id, { deletedAt: now, modifiedAt: now }),
          ),
        ]);
      }

      await this.db.areas.update(id, { deletedAt: now, modifiedAt: now });
    });
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
    await this.db.transaction('rw', this.db.lists, this.db.tasks, async () => {
      const tasks = (await this.db.tasks.where('listId').equals(id).toArray()).filter(active);
      if (tasks.length > 0 && !confirmContents) throw new NonEmptyEntityError('list');
      const now = this.now();
      await Promise.all([
        this.db.lists.update(id, { deletedAt: now, modifiedAt: now }),
        ...tasks.map((task) => this.db.tasks.update(task.id, { deletedAt: now, modifiedAt: now })),
      ]);
    });
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
    const task = await this.db.tasks.get(id);
    if (!task || !active(task)) throw new Error('Task not found.');
    const list = await this.requireActiveList(task.listId);
    await this.db.tasks.update(id, {
      status: completed ? 'completed' : list.systemType === 'inbox' ? 'inbox' : 'available',
      completedClearedAt: undefined,
      modifiedAt: this.now(),
    });
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
