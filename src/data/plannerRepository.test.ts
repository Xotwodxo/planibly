import { initializeDatabase, PlaniblyDatabase } from './database';
import { NonEmptyEntityError, PlannerRepository } from './plannerRepository';
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
});
