import Dexie from 'dexie';

import {
  DATABASE_SCHEMA_VERSION,
  initializeDatabase,
  initializeDashboardStarterData,
  initializeCalendarStarterData,
  initializeStarterData,
  PlaniblyDatabase,
  schemaVersions,
} from './database';
import { DEFAULT_CALENDAR_ID, INBOX_LIST_ID, STARTER_AREAS } from './plannerTypes';

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
      'calendarEvents',
      'calendars',
      'dashboardLayouts',
      'diagnostics',
      'eventTemplates',
      'lists',
      'metadata',
      'plannedPlacements',
      'planningCapacities',
      'recurrenceExceptions',
      'recurrenceRules',
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
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '10' });

    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 1B data to Phase 1C deterministically without losing records', async () => {
    const name = `planibly-phase-1c-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(4).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags: '&id, taskId, tagId, &[taskId+tagId], createdAt',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt',
    });
    await legacy.open();
    const timestamp = '2026-03-01T00:00:00.000Z';
    await legacy.table('lists').put({
      id: 'phase-1b-list',
      areaId: 'phase-1b-area',
      name: 'Existing list',
      color: '#5B67C8',
      order: 0,
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
    await legacy.table('taskTags').put({
      id: 'phase-1b-assignment',
      taskId: 'phase-1b-task',
      tagId: 'phase-1b-tag',
      createdAt: timestamp,
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.lists.get('phase-1b-list')).resolves.toMatchObject({
      name: 'Existing list',
      mode: 'standard',
    });
    await expect(upgraded.taskTags.get('phase-1b-assignment')).resolves.toMatchObject({
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '10' });

    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 1C data to Phase 2A without inventing planning values', async () => {
    const name = `planibly-phase-2a-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(5).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
    });
    await legacy.open();
    const timestamp = '2026-04-01T10:00:00.000Z';
    await legacy.table('tasks').put({
      id: 'phase-1c-task',
      title: 'Preserve all earlier data',
      listId: INBOX_LIST_ID,
      status: 'inbox',
      order: 0,
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    const task = await upgraded.tasks.get('phase-1c-task');
    expect(task).toMatchObject({ title: 'Preserve all earlier data', createdAt: timestamp });
    expect(task?.plannedDate).toBeUndefined();
    expect(task?.deadlineDate).toBeUndefined();
    expect(task?.flexibleStartDate).toBeUndefined();
    expect(task?.exactStartTime).toBeUndefined();
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '10' });

    expect(task?.completedAt).toBeUndefined();

    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 2A data with completion history and dashboard starters', async () => {
    const name = `planibly-phase-2b-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(6).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
    });
    await legacy.open();
    const completedAt = '2026-06-01T12:00:00.000Z';
    await legacy.table('tasks').bulkAdd([
      {
        id: 'completed-phase-2a',
        title: 'Completed before upgrade',
        listId: INBOX_LIST_ID,
        status: 'completed',
        plannedDate: '2026-06-01',
        order: 0,
        createdAt: '2026-05-01T12:00:00.000Z',
        modifiedAt: completedAt,
      },
      {
        id: 'active-phase-2a',
        title: 'Active before upgrade',
        listId: INBOX_LIST_ID,
        status: 'inbox',
        order: 1,
        createdAt: completedAt,
        modifiedAt: completedAt,
      },
    ]);
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.tasks.get('completed-phase-2a')).resolves.toMatchObject({
      plannedDate: '2026-06-01',
      completedAt,
    });
    expect((await upgraded.tasks.get('active-phase-2a'))?.completedAt).toBeUndefined();
    expect(await upgraded.dashboardLayouts.count()).toBe(3);
    expect(
      (await upgraded.dashboardLayouts.toArray()).filter((layout) => layout.isDefault),
    ).toHaveLength(1);

    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 2B planned tasks to deterministic Phase 2C agenda placements', async () => {
    const name = `planibly-phase-2c-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(7).stores({
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
    });
    await legacy.open();
    const timestamp = '2026-07-01T09:00:00.000Z';
    await legacy.table('tasks').bulkAdd([
      {
        id: 'later-v7',
        title: 'Later',
        listId: INBOX_LIST_ID,
        status: 'inbox',
        plannedDate: '2026-07-02',
        timeWindow: 'morning',
        order: 1,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      {
        id: 'earlier-v7',
        title: 'Earlier',
        listId: INBOX_LIST_ID,
        status: 'inbox',
        plannedDate: '2026-07-02',
        exactStartTime: '08:30',
        order: 0,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
      {
        id: 'unplanned-v7',
        title: 'Unplanned',
        listId: INBOX_LIST_ID,
        status: 'inbox',
        order: 2,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ]);
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.plannedPlacements.get('earlier-v7')).resolves.toMatchObject({
      taskId: 'earlier-v7',
      localDate: '2026-07-02',
      group: 'exact',
      source: 'plannedDate',
      order: 0,
    });
    await expect(upgraded.plannedPlacements.get('later-v7')).resolves.toMatchObject({
      group: 'morning',
      order: 0,
    });
    expect(await upgraded.plannedPlacements.get('unplanned-v7')).toBeUndefined();
    expect(await upgraded.planningCapacities.count()).toBe(0);
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '10' });

    upgraded.close();
    await upgraded.delete();
  });

  it('does not recreate a customized or deleted dashboard starter implicitly', async () => {
    const database = new PlaniblyDatabase(`planibly-dashboard-starters-${crypto.randomUUID()}`);
    await initializeDatabase(database);
    const overview = await database.dashboardLayouts.where('builtInKey').equals('overview').first();
    expect(overview).toBeDefined();
    await database.dashboardLayouts.update(overview!.id, { name: 'Changed directly' });
    const focus = await database.dashboardLayouts.where('builtInKey').equals('focus').first();
    await database.dashboardLayouts.delete(focus!.id);

    await initializeDashboardStarterData(database);

    expect(await database.dashboardLayouts.count()).toBe(2);
    await expect(database.dashboardLayouts.get(overview!.id)).resolves.toMatchObject({
      name: 'Changed directly',
    });

    database.close();
    await database.delete();
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

  it('creates the protected default calendar idempotently without recreating deleted starter data', async () => {
    const database = new PlaniblyDatabase(`planibly-calendar-starter-${crypto.randomUUID()}`);
    await initializeDatabase(database);
    await expect(database.calendars.get(DEFAULT_CALENDAR_ID)).resolves.toMatchObject({
      name: 'Personal',
      isProtected: true,
    });
    await database.calendars.delete(DEFAULT_CALENDAR_ID);
    await initializeCalendarStarterData(database);
    expect(await database.calendars.count()).toBe(0);
    database.close();
    await database.delete();
  });

  it('upgrades a Phase 2C v8 database without changing capacity or placement records', async () => {
    const name = `planibly-v8-calendar-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(8).stores(schemaVersions.find((schema) => schema.version === 8)!.stores);
    await legacy.open();
    await legacy
      .table('metadata')
      .put({ key: 'schemaVersion', value: '8', updatedAt: '2026-01-01T00:00:00.000Z' });
    await legacy.table('planningCapacities').put({
      id: 'capacity',
      kind: 'date',
      localDate: '2026-07-16',
      minutes: 300,
      createdAt: 'x',
      modifiedAt: 'x',
    });
    await legacy.table('plannedPlacements').put({
      id: 'placement',
      taskId: 'task',
      localDate: '2026-07-16',
      group: 'anyTime',
      order: 0,
      source: 'plannedDate',
      createdAt: 'x',
      modifiedAt: 'x',
    });
    legacy.close();
    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);
    await expect(upgraded.planningCapacities.get('capacity')).resolves.toMatchObject({
      minutes: 300,
    });
    await expect(upgraded.plannedPlacements.get('placement')).resolves.toMatchObject({
      taskId: 'task',
    });
    expect(await upgraded.calendars.count()).toBe(1);
    expect(await upgraded.calendarEvents.count()).toBe(0);
    upgraded.close();
    await upgraded.delete();
  });

  it('upgrades Phase 3A v9 data append-only and leaves existing events one-off', async () => {
    const name = `planibly-v9-recurrence-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(9).stores(schemaVersions.find((schema) => schema.version === 9)!.stores);
    await legacy.open();
    const timestamp = '2026-07-16T10:00:00.000Z';
    await legacy.table('metadata').put({ key: 'schemaVersion', value: '9', updatedAt: timestamp });
    await legacy.table('calendars').put({
      id: 'legacy-calendar',
      name: 'Legacy calendar',
      color: '#5B67C8',
      order: 0,
      isVisible: true,
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
    await legacy.table('calendarEvents').put({
      id: 'legacy-event',
      calendarId: 'legacy-calendar',
      title: 'Existing appointment',
      startDate: '2026-07-20',
      endDate: '2026-07-20',
      allDay: false,
      startTime: '09:00',
      endTime: '10:00',
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
    legacy.close();

    const upgraded = new PlaniblyDatabase(name);
    await initializeDatabase(upgraded);

    await expect(upgraded.calendarEvents.get('legacy-event')).resolves.toMatchObject({
      title: 'Existing appointment',
      startTime: '09:00',
    });
    expect(await upgraded.recurrenceRules.count()).toBe(0);
    expect(await upgraded.recurrenceExceptions.count()).toBe(0);
    expect(await upgraded.eventTemplates.count()).toBe(0);
    await expect(upgraded.metadata.get('schemaVersion')).resolves.toMatchObject({ value: '10' });
    upgraded.close();
    await upgraded.delete();
  });
});
