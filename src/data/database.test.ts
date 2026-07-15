import Dexie from 'dexie';

import {
  DATABASE_SCHEMA_VERSION,
  initializeDatabase,
  initializeStarterData,
  PlaniblyDatabase,
} from './database';
import { INBOX_LIST_ID, STARTER_AREAS } from './plannerTypes';

describe('PlaniblyDatabase', () => {
  it('opens at the declared version and writes schema metadata', async () => {
    const database = new PlaniblyDatabase(`planibly-test-${crypto.randomUUID()}`);

    await initializeDatabase(database);

    expect(database.verno).toBe(DATABASE_SCHEMA_VERSION);
    await expect(database.metadata.get('schemaVersion')).resolves.toMatchObject({
      value: String(DATABASE_SCHEMA_VERSION),
    });
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      'areas',
      'diagnostics',
      'lists',
      'metadata',
      'tags',
      'taskRelationships',
      'taskSteps',
      'taskTags',
      'tasks',
    ]);

    expect(await database.areas.count()).toBe(STARTER_AREAS.length);
    await expect(database.lists.get(INBOX_LIST_ID)).resolves.toMatchObject({
      name: 'Inbox',
      systemType: 'inbox',
    });

    database.close();
    await database.delete();
  });

  it('upgrades a version 1 database without losing foundation records', async () => {
    const name = `planibly-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
    });
    await legacy.open();
    await legacy
      .table('metadata')
      .put({ key: 'legacy', value: 'preserved', updatedAt: '2025-01-01T00:00:00.000Z' });
    await legacy.table('diagnostics').put({
      id: 'diagnostic-1',
      level: 'info',
      event: 'phase0',
      message: 'Keep me',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.metadata.get('legacy')).resolves.toMatchObject({ value: 'preserved' });
    await expect(upgraded.diagnostics.get('diagnostic-1')).resolves.toMatchObject({
      message: 'Keep me',
    });
    expect(upgraded.verno).toBe(DATABASE_SCHEMA_VERSION);
    expect(await upgraded.areas.count()).toBe(5);
    expect(await upgraded.lists.count()).toBe(1);

    upgraded.close();
    await upgraded.delete();
  });

  it('keeps version 2 completed tasks visible when upgrading to cleared-completion support', async () => {
    const name = `planibly-completion-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
    });
    legacy.version(2).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks: '&id, listId, [listId+order], status, createdAt, modifiedAt, deletedAt',
    });
    await legacy.open();
    await legacy.table('tasks').put({
      id: 'completed-v2-task',
      title: 'Already completed',
      listId: 'legacy-list',
      status: 'completed',
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    const task = await upgraded.tasks.get('completed-v2-task');
    expect(task).toMatchObject({ title: 'Already completed', status: 'completed' });
    expect(task?.completedClearedAt).toBeUndefined();

    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 1A data to Phase 1B without changing existing tasks', async () => {
    const name = `planibly-phase-1b-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt',
    });
    await legacy.open();
    await legacy.table('tasks').put({
      id: 'phase-1a-task',
      title: 'Preserve this task',
      listId: INBOX_LIST_ID,
      status: 'completed',
      completedClearedAt: '2026-02-01T00:00:00.000Z',
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-02-01T00:00:00.000Z',
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.tasks.get('phase-1a-task')).resolves.toMatchObject({
      title: 'Preserve this task',
      status: 'completed',
      completedClearedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(await upgraded.taskSteps.count()).toBe(0);
    expect(await upgraded.tags.count()).toBe(0);
    expect(await upgraded.taskTags.count()).toBe(0);
    expect(await upgraded.taskRelationships.count()).toBe(0);
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '4' });

    upgraded.close();
    await upgraded.delete();
  });

  it('creates starter data once without restoring later user changes', async () => {
    const database = new PlaniblyDatabase(`planibly-starters-${crypto.randomUUID()}`);
    await initializeDatabase(database);
    await initializeStarterData(database);
    await database.areas.update(STARTER_AREAS[0].id, { name: 'Renamed' });
    await database.areas.delete(STARTER_AREAS[1].id);

    await initializeStarterData(database);

    expect(await database.areas.count()).toBe(4);
    await expect(database.areas.get(STARTER_AREAS[0].id)).resolves.toMatchObject({
      name: 'Renamed',
    });
    expect(await database.lists.where('systemType').equals('inbox').count()).toBe(1);

    database.close();
    await database.delete();
  });
});
