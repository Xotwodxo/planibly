import { initializeDatabase, PlaniblyDatabase } from './database';
import { PlannerRepository } from './plannerRepository';
import {
  RoutineRepository,
  RoutineValidationError,
  UnfinishedRoutineError,
} from './routineRepository';
import type { RoutineInput } from './routineTypes';

function harness() {
  const database = new PlaniblyDatabase(`routine-${crypto.randomUUID()}`);
  let id = 0;
  let tick = 0;
  const repository = new RoutineRepository(database, {
    createId: () => `c9000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => `2026-07-18T08:00:${String(tick++).padStart(2, '0')}.000Z`,
    notify: () => undefined,
  });
  return { database, repository };
}

function routineInput(overrides: Partial<RoutineInput> = {}): RoutineInput {
  return {
    name: 'Morning routine',
    color: '#5B67C8',
    description: 'Start calmly',
    isActive: true,
    expectedDurationMinutes: 15,
    presentationStyle: 'checklist',
    scheduleKind: 'daily',
    selectedWeekdays: [],
    defaultSection: 'morning',
    items: [
      {
        id: 'ca000000-0000-4000-8000-000000000001',
        title: 'Drink water',
        estimatedDurationMinutes: 2,
        note: 'Any glass is fine',
        order: 0,
        isActive: true,
      },
      {
        id: 'ca000000-0000-4000-8000-000000000002',
        title: 'Open curtains',
        order: 1,
        isActive: true,
      },
    ],
    variants: [],
    ...overrides,
  };
}

async function close(database: PlaniblyDatabase) {
  database.close();
  await database.delete();
}

describe('RoutineRepository', () => {
  it('creates, edits, reorders, activates, duplicates, and soft-deletes routines and items', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const first = await repository.saveRoutine(routineInput());
    const second = await repository.saveRoutine(
      routineInput({
        name: 'Evening reset',
        items: routineInput().items.map((item, index) => ({
          ...item,
          id: `ca000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}`,
        })),
      }),
    );
    await repository.moveRoutine(second.id, -1);
    await repository.setRoutineActive(first.id, false);
    const duplicate = await repository.duplicateRoutine(second.id);
    expect(duplicate.name).toBe('Evening reset copy');
    expect((await database.routines.get(second.id))?.order).toBe(0);
    expect((await database.routines.get(first.id))?.isActive).toBe(false);

    await repository.saveRoutine(
      routineInput({ name: 'Updated routine', items: [routineInput().items[0]!] }),
      first.id,
    );
    const removedItem = await database.routineItems.get('ca000000-0000-4000-8000-000000000002');
    expect(removedItem?.deletedAt).toBeDefined();
    await repository.restoreItem(removedItem!.id);
    expect((await database.routineItems.get(removedItem!.id))?.deletedAt).toBeUndefined();

    const receipt = await repository.deleteRoutine(second.id);
    expect(receipt.kind).toBe('routine');
    expect((await database.routines.get(second.id))?.deletedAt).toBeDefined();
    const deletedChild = await database.routineItems.where('routineId').equals(second.id).first();
    await expect(repository.restoreItem(deletedChild!.id)).rejects.toThrow('parent routine');
    await repository.restoreItem(deletedChild!.id, true);
    expect((await database.routines.get(second.id))?.deletedAt).toBeUndefined();
    expect(
      (await database.routineItems.where('routineId').equals(second.id).toArray()).every(
        (item) => !item.deletedAt,
      ),
    ).toBe(true);
    await close(database);
  });

  it('creates optional starter examples once and never recreates removed examples', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    await expect(repository.starterExamplesAvailable()).resolves.toBe(true);
    await expect(repository.createStarterExamples()).resolves.toHaveLength(3);
    await expect(repository.createStarterExamples()).resolves.toHaveLength(0);
    const morning = await database.routines
      .filter((routine) => routine.name === 'Morning routine')
      .first();
    expect(morning).toBeDefined();
    await repository.deleteRoutine(morning!.id);
    await repository.permanentlyDeleteRoutine(morning!.id);
    await expect(repository.createStarterExamples()).resolves.toHaveLength(0);
    expect(
      await database.routines.filter((routine) => routine.name === 'Morning routine').count(),
    ).toBe(0);
    await close(database);
  });

  it('selects a day variant and snapshots its item order and presentation', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const input = routineInput({
      variants: [
        {
          id: 'cb000000-0000-4000-8000-000000000001',
          name: 'Saturday',
          weekdays: [6],
          itemIds: ['ca000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001'],
          presentationStyle: 'compact',
          order: 0,
        },
      ],
    });
    const routine = await repository.saveRoutine(input);
    const run = await repository.createOrResumeRun(routine.id, '2026-07-18');
    expect(run).toMatchObject({ variantName: 'Saturday', presentationStyle: 'compact' });
    expect(
      (await database.routineRunItems.where('runId').equals(run.id).sortBy('order')).map(
        (item) => item.title,
      ),
    ).toEqual(['Open curtains', 'Drink water']);
    await close(database);
  });

  it('resumes a unique daily run and supports checking, style changes, completion, reopen, and skip', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const routine = await repository.saveRoutine(routineInput());
    const run = await repository.createOrResumeRun(routine.id, '2026-07-18');
    await expect(repository.createOrResumeRun(routine.id, '2026-07-18')).resolves.toEqual(run);
    expect(await database.routineRuns.count()).toBe(1);

    const items = await database.routineRunItems.where('runId').equals(run.id).sortBy('order');
    await repository.setRunStyle(run.id, 'stepByStep');
    await repository.setRunItemCompleted(items[0]!.id, true);
    await expect(repository.completeRun(run.id)).rejects.toBeInstanceOf(UnfinishedRoutineError);
    await repository.completeRun(run.id, true);
    expect(await database.routineRuns.get(run.id)).toMatchObject({
      status: 'completed',
      presentationStyle: 'stepByStep',
    });
    expect((await database.routineRunItems.get(items[1]!.id))?.completedAt).toBeUndefined();
    await repository.reopenRun(run.id);
    expect((await database.routineRuns.get(run.id))?.status).toBe('inProgress');
    await repository.skipRun(routine.id, '2026-07-18', 'Not useful today');
    expect(await database.routineRuns.get(run.id)).toMatchObject({
      status: 'skipped',
      skipReason: 'Not useful today',
    });
    await close(database);
  });

  it('keeps run snapshots and history stable after edits and permanent definition deletion', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const routine = await repository.saveRoutine(routineInput());
    const run = await repository.createOrResumeRun(routine.id, '2026-07-18');
    await repository.saveRoutine(
      routineInput({
        name: 'Renamed definition',
        items: [{ ...routineInput().items[0]!, title: 'Changed definition item' }],
      }),
      routine.id,
    );
    expect(await database.routineRuns.get(run.id)).toMatchObject({
      routineName: 'Morning routine',
    });
    expect(
      (await database.routineRunItems.where('runId').equals(run.id).sortBy('order'))[0]?.title,
    ).toBe('Drink water');

    await repository.deleteRoutine(routine.id);
    await repository.permanentlyDeleteRoutine(routine.id);
    expect(await database.routines.get(routine.id)).toBeUndefined();
    expect(await database.routineRuns.get(run.id)).toBeDefined();
    expect(await database.routineRunItems.where('runId').equals(run.id).count()).toBe(2);
    await close(database);
  });

  it('moves a previously scheduled occurrence only after an explicit repository action', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    const routine = await repository.saveRoutine(routineInput());
    await repository.moveOccurrence(routine.id, '2026-07-17', '2026-07-20');
    await expect(
      database.routineOccurrenceAdjustments
        .where('[routineId+originalDate]')
        .equals([routine.id, '2026-07-17'])
        .first(),
    ).resolves.toMatchObject({ destinationDate: '2026-07-20' });
    await close(database);
  });

  it('filters invalid stored definitions from active snapshots instead of crashing views', async () => {
    const { database } = harness();
    await initializeDatabase(database);
    await database.routines.add({
      ...routineInput(),
      id: 'invalid-routine',
      name: '',
      order: 0,
      createdAt: '2026-07-18T08:00:00.000Z',
      modifiedAt: '2026-07-18T08:00:00.000Z',
    });
    const planner = new PlannerRepository(database, { notify: () => undefined });
    await expect(planner.getSnapshot()).resolves.toMatchObject({ routines: [] });
    await close(database);
  });

  it('rejects invalid definitions and invalid local dates', async () => {
    const { database, repository } = harness();
    await initializeDatabase(database);
    await expect(repository.saveRoutine(routineInput({ items: [] }))).rejects.toBeInstanceOf(
      RoutineValidationError,
    );
    const routine = await repository.saveRoutine(routineInput());
    await expect(repository.createOrResumeRun(routine.id, '2026-02-30')).rejects.toBeInstanceOf(
      RoutineValidationError,
    );
    await close(database);
  });
});
