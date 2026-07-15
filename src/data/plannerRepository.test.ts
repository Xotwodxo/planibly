import { initializeDatabase, PlaniblyDatabase } from './database';
import {
  NonEmptyEntityError,
  PlannerRepository,
  RelationshipValidationError,
  RestoreParentRequiredError,
  TagInUseError,
  TaskBlockedError,
} from './plannerRepository';
import { INBOX_LIST_ID } from './plannerTypes';

function createHarness() {
  const name = `planibly-repository-${crypto.randomUUID()}`;
  const database = new PlaniblyDatabase(name);
  let id = 0;
  let tick = 0;
  const repository = new PlannerRepository(database, {
    createId: () => `30000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    notify: () => undefined,
  });
  return { database, repository };
}

describe('PlannerRepository', () => {
  it('persists area and list creation, editing, colour, and ordering across reopen', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const first = await repository.createArea('Work', '#5B67C8');
    const second = await repository.createArea('Study', '#3D9F98');
    await repository.updateArea(first.id, 'Client work', '#CF5E62');
    await repository.moveArea(second.id, -1);
    const list = await repository.createList(first.id, 'Capture', '#CE9138');
    await repository.updateList(list.id, 'Client capture', '#8C65B5');

    const name = database.name;
    database.close();
    const reopened = new PlaniblyDatabase(name);
    await reopened.open();
    const persisted = await new PlannerRepository(reopened, {
      notify: () => undefined,
    }).getSnapshot();

    expect(persisted.areas.find((area) => area.id === first.id)).toMatchObject({
      name: 'Client work',
      color: '#CF5E62',
    });
    expect(persisted.areas.findIndex((area) => area.id === second.id)).toBeLessThan(
      persisted.areas.findIndex((area) => area.id === first.id),
    );
    expect(persisted.lists.find((candidate) => candidate.id === list.id)).toMatchObject({
      name: 'Client capture',
      color: '#8C65B5',
    });

    reopened.close();
    await reopened.delete();
  });

  it('persists cleared completions without deleting task history and reactivates a newly completed task', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const area = (await repository.getSnapshot()).areas[0]!;
    const list = await repository.createList(area.id, 'Next', '#5B67C8');
    const task = await repository.createTask('First thought');

    expect(task.listId).toBe(INBOX_LIST_ID);
    expect(task.status).toBe('inbox');
    await repository.updateTask(task.id, 'Ready task', list.id);
    await repository.setTaskCompleted(task.id, true);
    await expect(repository.clearCompletedTasks(list.id)).resolves.toBe(1);

    const name = database.name;
    database.close();
    const reopened = new PlaniblyDatabase(name);
    await reopened.open();
    const persisted = await reopened.tasks.get(task.id);
    expect(persisted).toMatchObject({ title: 'Ready task', listId: list.id, status: 'completed' });
    expect(persisted?.completedClearedAt).toBe('2026-01-01T00:00:04.000Z');
    expect(persisted?.deletedAt).toBeUndefined();
    expect(persisted?.createdAt).not.toBe(persisted?.modifiedAt);

    const reopenedRepository = new PlannerRepository(reopened, { notify: () => undefined });
    expect(
      (await reopenedRepository.getSnapshot()).tasks.find((candidate) => candidate.id === task.id),
    ).toMatchObject({
      id: task.id,
      completedClearedAt: '2026-01-01T00:00:04.000Z',
    });
    await reopenedRepository.setTaskCompleted(task.id, false);
    await reopenedRepository.setTaskCompleted(task.id, true);
    const newlyCompleted = await reopened.tasks.get(task.id);
    expect(newlyCompleted).toMatchObject({ status: 'completed' });
    expect(newlyCompleted?.completedClearedAt).toBeUndefined();
    reopened.close();
    await reopened.delete();
  });

  it('requires an explicit strategy for non-empty destructive operations', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const [source, destination] = (await repository.getSnapshot()).areas;
    const list = await repository.createList(source!.id, 'Important', '#5B67C8');
    const task = await repository.createTask('Keep this', list.id);

    await expect(repository.deleteArea(source!.id)).rejects.toBeInstanceOf(NonEmptyEntityError);
    await expect(repository.deleteList(list.id)).rejects.toBeInstanceOf(NonEmptyEntityError);
    await repository.deleteArea(source!.id, { type: 'move', destinationAreaId: destination!.id });

    await expect(database.lists.get(list.id)).resolves.toMatchObject({ areaId: destination!.id });
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();

    await repository.deleteList(list.id, true);
    await expect(database.lists.get(list.id)).resolves.toHaveProperty('deletedAt');
    await expect(database.tasks.get(task.id)).resolves.toHaveProperty('deletedAt');

    database.close();
    await database.delete();
  });

  it('persists independent step CRUD, completion, and keyboard ordering', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const task = await repository.createTask('Prepare report');
    const first = await repository.createStep(task.id, 'Collect notes');
    const second = await repository.createStep(task.id, 'Write outline');

    await repository.updateStep(first.id, 'Collect source notes');
    await repository.setStepCompleted(first.id, true);
    await repository.moveStep(second.id, -1);
    await repository.setTaskCompleted(task.id, true);

    let snapshot = await repository.getSnapshot();
    expect(snapshot.taskSteps.map((step) => step.id)).toEqual([second.id, first.id]);
    expect(snapshot.taskSteps.find((step) => step.id === first.id)).toMatchObject({
      title: 'Collect source notes',
      completed: true,
    });
    expect(snapshot.taskSteps.find((step) => step.id === second.id)?.completed).toBe(false);
    await repository.setStepCompleted(first.id, false);
    expect((await database.tasks.get(task.id))?.status).toBe('completed');

    await repository.deleteStep(second.id);
    snapshot = await repository.getSnapshot();
    expect(snapshot.taskSteps.map((step) => step.id)).toEqual([first.id]);
    await expect(database.taskSteps.get(second.id)).resolves.toHaveProperty('deletedAt');

    database.close();
    await database.delete();
  });

  it('manages reusable tags and removes assignments only after confirmation', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const task = await repository.createTask('Make a call');
    const tag = await repository.createTag('Phone', '#5B67C8');
    await repository.updateTag(tag.id, 'Calls', '#3D9F98');
    await repository.assignTag(task.id, tag.id);
    await repository.assignTag(task.id, tag.id);

    expect((await repository.getSnapshot()).taskTags).toHaveLength(1);
    await expect(repository.deleteTag(tag.id)).rejects.toBeInstanceOf(TagInUseError);
    await repository.unassignTag(task.id, tag.id);
    expect((await repository.getSnapshot()).tags[0]).toMatchObject({
      name: 'Calls',
      color: '#3D9F98',
    });
    await repository.assignTag(task.id, tag.id);
    await repository.deleteTag(tag.id, true);

    expect((await repository.getSnapshot()).tags).toHaveLength(0);
    expect(await database.taskTags.count()).toBe(0);
    await expect(database.tasks.get(task.id)).resolves.toMatchObject({ title: 'Make a call' });

    database.close();
    await database.delete();
  });

  it('rejects self references and cycles while deriving multi-predecessor blocking', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const first = await repository.createTask('First');
    const second = await repository.createTask('Second');
    const third = await repository.createTask('Third');

    await expect(repository.addRelationship(first.id, first.id)).rejects.toMatchObject({
      reason: 'self',
    });
    const firstToSecond = await repository.addRelationship(first.id, second.id);
    await repository.addRelationship(second.id, third.id);
    await repository.addRelationship(first.id, third.id);
    await expect(repository.addRelationship(third.id, first.id)).rejects.toBeInstanceOf(
      RelationshipValidationError,
    );

    let snapshot = await repository.getSnapshot();
    expect(snapshot.blockedByTaskId[second.id]).toEqual([first.id]);
    expect(snapshot.blockedByTaskId[third.id]).toEqual([second.id, first.id]);
    await expect(repository.setTaskCompleted(third.id, true)).rejects.toBeInstanceOf(
      TaskBlockedError,
    );

    await repository.setTaskCompleted(first.id, true);
    snapshot = await repository.getSnapshot();
    expect(snapshot.blockedByTaskId[second.id]).toBeUndefined();
    expect(snapshot.blockedByTaskId[third.id]).toEqual([second.id]);
    await repository.setTaskCompleted(second.id, true);
    expect((await repository.getSnapshot()).blockedByTaskId[third.id]).toBeUndefined();
    await repository.setTaskCompleted(first.id, false);
    snapshot = await repository.getSnapshot();
    expect(snapshot.blockedByTaskId[second.id]).toEqual([first.id]);
    expect(snapshot.blockedByTaskId[third.id]).toEqual([first.id]);

    await repository.removeRelationship(firstToSecond.id);
    expect((await repository.getSnapshot()).blockedByTaskId[second.id]).toBeUndefined();

    database.close();
    await database.delete();
  });

  it('cleans related detail records and unblocks successors when a task is soft-deleted', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const predecessor = await repository.createTask('Temporary predecessor');
    const successor = await repository.createTask('Keep successor');
    const step = await repository.createStep(predecessor.id, 'Temporary step');
    const tag = await repository.createTag('Temporary tag', '#5B67C8');
    await repository.assignTag(predecessor.id, tag.id);
    const relationship = await repository.addRelationship(predecessor.id, successor.id);
    expect((await repository.getSnapshot()).blockedByTaskId[successor.id]).toEqual([
      predecessor.id,
    ]);

    await repository.deleteTask(predecessor.id);
    const snapshot = await repository.getSnapshot();
    expect(snapshot.blockedByTaskId[successor.id]).toBeUndefined();
    expect(snapshot.tasks.map((task) => task.id)).toContain(successor.id);
    await expect(database.tasks.get(predecessor.id)).resolves.toHaveProperty('deletedAt');
    await expect(database.taskSteps.get(step.id)).resolves.toHaveProperty('deletedAt');
    await expect(database.taskRelationships.get(relationship.id)).resolves.toHaveProperty(
      'deletedAt',
    );
    const deletedAssignment = await database.taskTags
      .where('taskId')
      .equals(predecessor.id)
      .first();
    expect(deletedAssignment?.deletedAt).toBeDefined();
    expect((await database.tags.get(tag.id))?.deletedAt).toBeUndefined();

    database.close();
    await database.delete();
  });

  it('manages project mode, derives progress and next action, and archives reversibly', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const area = (await repository.getSnapshot()).areas[0]!;
    const project = await repository.createList(area.id, 'Kitchen refresh', '#8C65B5', 'project');
    await repository.updateProjectDetails(project.id, 'Make the room easier to use', '2026-08-01');
    const measure = await repository.createTask('Measure the room', project.id);
    const order = await repository.createTask('Order materials', project.id);
    await repository.addRelationship(measure.id, order.id);

    let snapshot = await repository.getSnapshot();
    expect(snapshot.projectProgressByListId[project.id]).toMatchObject({
      completedCount: 0,
      totalCount: 2,
      nextActionId: measure.id,
      allRemainingBlocked: false,
    });
    await repository.setTaskCompleted(measure.id, true);
    snapshot = await repository.getSnapshot();
    expect(snapshot.projectProgressByListId[project.id]).toMatchObject({
      completedCount: 1,
      totalCount: 2,
      nextActionId: order.id,
    });
    const externalBlocker = await repository.createTask('Wait for room access');
    await repository.addRelationship(externalBlocker.id, order.id);
    expect((await repository.getSnapshot()).projectProgressByListId[project.id]).toMatchObject({
      completedCount: 1,
      totalCount: 2,
      nextActionId: undefined,
      allRemainingBlocked: true,
    });
    await repository.setTaskCompleted(externalBlocker.id, true);
    expect((await repository.getSnapshot()).projectProgressByListId[project.id]).toMatchObject({
      nextActionId: order.id,
      allRemainingBlocked: false,
    });

    const archiveReceipt = await repository.archiveProject(project.id);
    snapshot = await repository.getSnapshot();
    expect(snapshot.lists.map((list) => list.id)).not.toContain(project.id);
    expect(snapshot.archivedProjects.map((list) => list.id)).toContain(project.id);
    expect((await repository.getSmartTasks('active')).map((task) => task.id)).not.toContain(
      order.id,
    );
    await expect(
      repository.search('kitchen', {
        types: ['list'],
        includeArchived: false,
        includeCompleted: true,
      }),
    ).resolves.toHaveLength(0);
    await expect(
      repository.search('kitchen', {
        types: ['list'],
        includeArchived: true,
        includeCompleted: true,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: project.id, archived: true })]);
    await repository.restoreDeletionGroup(archiveReceipt.groupId, archiveReceipt);
    expect((await repository.getSnapshot()).lists.map((list) => list.id)).toContain(project.id);

    await expect(repository.convertListMode(project.id, 'standard')).rejects.toThrow(
      'Confirm removal',
    );
    await repository.convertListMode(project.id, 'standard', true);
    await expect(database.lists.get(project.id)).resolves.toMatchObject({ mode: 'standard' });
    expect((await database.lists.get(project.id))?.projectOutcome).toBeUndefined();
    await repository.convertListMode(project.id, 'project');
    expect(
      (await repository.getSnapshot()).tasks.filter((task) => task.listId === project.id),
    ).toHaveLength(2);
    await repository.archiveProject(project.id);
    await repository.restoreArchivedProject(project.id);
    expect((await repository.getSnapshot()).lists.map((list) => list.id)).toContain(project.id);

    database.close();
    await database.delete();
  });

  it('returns meaningful smart lists and local search results with explicit filters', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const area = (await repository.getSnapshot()).areas[0]!;
    await repository.updateArea(area.id, 'Launch area', area.color);
    const list = await repository.createList(area.id, 'Launch notes', '#5B67C8');
    const activeTask = await repository.createTask('Draft launch note', list.id);
    const completedTask = await repository.createTask('Approve launch note', list.id);
    const blockedTask = await repository.createTask('Publish launch note', list.id);
    const inboxTask = await repository.createTask('Capture launch thought');
    const step = await repository.createStep(activeTask.id, 'Check launch spelling');
    const tag = await repository.createTag('Launch context', '#3D9F98');
    await repository.assignTag(activeTask.id, tag.id);
    await repository.setTaskCompleted(completedTask.id, true);
    await repository.addRelationship(activeTask.id, blockedTask.id);

    await expect(repository.getSmartTasks('inbox')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inboxTask.id })]),
    );
    expect((await repository.getSmartTasks('active')).map((task) => task.id)).toEqual(
      expect.arrayContaining([activeTask.id, blockedTask.id, inboxTask.id]),
    );
    expect((await repository.getSmartTasks('blocked')).map((task) => task.id)).toEqual([
      blockedTask.id,
    ]);
    expect((await repository.getSmartTasks('completed')).map((task) => task.id)).toEqual([
      completedTask.id,
    ]);

    const defaultResults = await repository.search('  LaUnCh  ', {
      types: ['area', 'list', 'task', 'step', 'tag'],
      includeArchived: false,
      includeCompleted: false,
    });
    expect(defaultResults.map((result) => result.id)).toEqual(
      expect.arrayContaining([area.id, list.id, activeTask.id, blockedTask.id, step.id, tag.id]),
    );
    expect(defaultResults.map((result) => result.id)).not.toContain(completedTask.id);
    const completedResults = await repository.search('approve', {
      types: ['task'],
      includeArchived: false,
      includeCompleted: true,
    });
    expect(completedResults).toEqual([
      expect.objectContaining({ id: completedTask.id, completed: true }),
    ]);

    database.close();
    await database.delete();
  });

  it('restores deletion groups, dependent details, and moved lists through session undo', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const [source, destination] = (await repository.getSnapshot()).areas;
    const movedList = await repository.createList(source!.id, 'Move me', '#5B67C8');
    const moveReceipt = await repository.deleteArea(source!.id, {
      type: 'move',
      destinationAreaId: destination!.id,
    });
    expect((await database.lists.get(movedList.id))?.areaId).toBe(destination!.id);
    await repository.restoreDeletionGroup(moveReceipt.groupId, moveReceipt);
    expect((await database.lists.get(movedList.id))?.areaId).toBe(source!.id);
    expect((await database.areas.get(source!.id))?.deletedAt).toBeUndefined();

    const task = await repository.createTask('Recover whole task', movedList.id);
    const successor = await repository.createTask('Still linked', movedList.id);
    const step = await repository.createStep(task.id, 'Recover this step');
    const tag = await repository.createTag('Recovery', '#3D9F98');
    await repository.assignTag(task.id, tag.id);
    const relationship = await repository.addRelationship(task.id, successor.id);
    const taskReceipt = await repository.deleteTask(task.id);
    await repository.restoreDeletionGroup(taskReceipt.groupId, taskReceipt);

    const snapshot = await repository.getSnapshot();
    expect(snapshot.tasks.map((candidate) => candidate.id)).toContain(task.id);
    expect(snapshot.taskSteps.map((candidate) => candidate.id)).toContain(step.id);
    expect(snapshot.taskTags.some((assignment) => assignment.taskId === task.id)).toBe(true);
    expect(snapshot.taskRelationships.map((candidate) => candidate.id)).toContain(relationship.id);
    expect(snapshot.blockedByTaskId[successor.id]).toEqual([task.id]);

    const stepReceipt = await repository.deleteStep(step.id);
    await repository.restoreDeletionGroup(stepReceipt.groupId, stepReceipt);
    expect((await repository.getSnapshot()).taskSteps.map((candidate) => candidate.id)).toContain(
      step.id,
    );
    const listReceipt = await repository.deleteList(movedList.id, true);
    await repository.restoreDeletionGroup(listReceipt.groupId, listReceipt);
    const restoredListSnapshot = await repository.getSnapshot();
    expect(restoredListSnapshot.lists.map((candidate) => candidate.id)).toContain(movedList.id);
    expect(restoredListSnapshot.tasks.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining([task.id, successor.id]),
    );

    database.close();
    await database.delete();
  });

  it('requires parent restoration and permanently cleans cascaded records', async () => {
    const { database, repository } = createHarness();
    await initializeDatabase(database);
    const area = (await repository.getSnapshot()).areas[0]!;
    const list = await repository.createList(area.id, 'Recoverable', '#5B67C8');
    const task = await repository.createTask('Restore with parents', list.id);
    const step = await repository.createStep(task.id, 'Nested detail');
    const successor = await repository.createTask('Keep active successor');
    const tag = await repository.createTag('Cleanup assignment', '#3D9F98');
    const assignment = await repository.assignTag(task.id, tag.id);
    const relationship = await repository.addRelationship(task.id, successor.id);
    await repository.deleteList(list.id, true);

    await expect(repository.restoreDeletedEntity('task', task.id)).rejects.toBeInstanceOf(
      RestoreParentRequiredError,
    );
    await repository.restoreDeletedEntity('task', task.id, true);
    expect((await database.lists.get(list.id))?.deletedAt).toBeUndefined();
    expect((await database.tasks.get(task.id))?.deletedAt).toBeUndefined();
    expect((await database.taskSteps.get(step.id))?.deletedAt).toBeUndefined();

    await repository.deleteList(list.id, true);
    await repository.permanentlyDelete('list', list.id);
    await expect(database.lists.get(list.id)).resolves.toBeUndefined();
    await expect(database.tasks.get(task.id)).resolves.toBeUndefined();
    await expect(database.taskSteps.get(step.id)).resolves.toBeUndefined();
    await expect(database.taskTags.get(assignment.id)).resolves.toBeUndefined();
    await expect(database.taskRelationships.get(relationship.id)).resolves.toBeUndefined();
    await expect(database.tasks.get(successor.id)).resolves.toMatchObject({
      title: 'Keep active successor',
    });
    expect((await repository.getSnapshot()).blockedByTaskId[successor.id]).toBeUndefined();

    const first = await repository.createTask('Delete one');
    const second = await repository.createTask('Delete two');
    await repository.deleteTask(first.id);
    await repository.deleteTask(second.id);
    await expect(repository.emptyRecentlyDeleted()).resolves.toBeGreaterThanOrEqual(2);
    expect((await repository.getSnapshot()).deletedTasks).toHaveLength(0);

    database.close();
    await database.delete();
  });
});
