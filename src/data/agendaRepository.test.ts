import {
  agendaGroupsFromSnapshot,
  capacityForDate,
  capacitySummaryForDate,
  planningSourcesForHorizon,
  previouslyPlannedTasks,
  sevenDayHorizon,
} from './agenda';
import { AgendaPlanningError, AgendaRepository } from './agendaRepository';
import { initializeDatabase, PlaniblyDatabase } from './database';
import { PlannerRepository } from './plannerRepository';

function createHarness() {
  const database = new PlaniblyDatabase(`planibly-agenda-${crypto.randomUUID()}`);
  let id = 0;
  let tick = 0;
  const options = {
    createId: () => `70000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => `2026-03-01T10:00:${String(tick++).padStart(2, '0')}.000Z`,
    notify: () => undefined,
  };
  return {
    database,
    agenda: new AgendaRepository(database, options),
    planner: new PlannerRepository(database, options),
  };
}

describe('Phase 2C agenda repository', () => {
  it('persists weekday defaults, date overrides, no-capacity days, and fallback', async () => {
    const { agenda, database } = createHarness();
    await initializeDatabase(database);

    await agenda.setWeekdayCapacity(1, 360);
    expect(capacityForDate(await agenda.getCapacities(), '2026-03-02')).toBe(360);
    await agenda.setDateCapacity('2026-03-02', 120);
    expect(capacityForDate(await agenda.getCapacities(), '2026-03-02')).toBe(120);
    await agenda.setDateCapacity('2026-03-02', null);
    expect(capacityForDate(await agenda.getCapacities(), '2026-03-02')).toBeNull();
    await agenda.clearDateCapacity('2026-03-02');
    expect(capacityForDate(await agenda.getCapacities(), '2026-03-02')).toBe(360);

    database.close();
    await database.delete();
  });

  it('places standard and flexible tasks without changing a flexible range', async () => {
    const { agenda, database, planner } = createHarness();
    await initializeDatabase(database);
    const standard = await planner.createTask('Standard');
    const flexible = await planner.createTask('Flexible', undefined, {
      flexibleStartDate: '2026-03-02',
      flexibleEndDate: '2026-03-05',
      estimatedDurationMinutes: 30,
    });

    await agenda.planTask(standard.id, '2026-03-03');
    await agenda.planTask(flexible.id, '2026-03-04');
    expect(await database.tasks.get(standard.id)).toMatchObject({ plannedDate: '2026-03-03' });
    const persistedFlexible = await database.tasks.get(flexible.id);
    expect(persistedFlexible).toMatchObject({
      flexibleStartDate: '2026-03-02',
      flexibleEndDate: '2026-03-05',
    });
    expect(persistedFlexible?.plannedDate).toBeUndefined();
    expect(await database.plannedPlacements.get(flexible.id)).toMatchObject({
      localDate: '2026-03-04',
      source: 'flexibleRange',
    });

    await agenda.unplanTask(flexible.id);
    expect(await database.plannedPlacements.get(flexible.id)).toBeUndefined();
    expect(await database.tasks.get(flexible.id)).toMatchObject({
      flexibleStartDate: '2026-03-02',
      flexibleEndDate: '2026-03-05',
    });
    database.close();
    await database.delete();
  });

  it('validates every selected task before a transactional bulk move', async () => {
    const { agenda, database, planner } = createHarness();
    await initializeDatabase(database);
    const standard = await planner.createTask('Standard');
    const flexible = await planner.createTask('Narrow range', undefined, {
      flexibleStartDate: '2026-03-02',
      flexibleEndDate: '2026-03-03',
    });

    await expect(agenda.moveTasks([standard.id, flexible.id], '2026-03-05')).rejects.toBeInstanceOf(
      AgendaPlanningError,
    );
    expect(await database.plannedPlacements.count()).toBe(0);
    expect((await database.tasks.get(standard.id))?.plannedDate).toBeUndefined();

    await agenda.moveTasks([standard.id, flexible.id], '2026-03-03');
    expect(await database.plannedPlacements.count()).toBe(2);
    await agenda.unplanTasks([standard.id, flexible.id]);
    expect(await database.plannedPlacements.count()).toBe(0);
    database.close();
    await database.delete();
  });

  it('orders exact times chronologically and persists manual order for other groups', async () => {
    const { agenda, database, planner } = createHarness();
    await initializeDatabase(database);
    const later = await planner.createTask('Later exact', undefined, {
      plannedDate: '2026-03-02',
      exactStartTime: '11:00',
    });
    const earlier = await planner.createTask('Earlier exact', undefined, {
      plannedDate: '2026-03-02',
      exactStartTime: '09:00',
    });
    const first = await planner.createTask('First morning', undefined, {
      plannedDate: '2026-03-02',
      timeWindow: 'morning',
    });
    const second = await planner.createTask('Second morning', undefined, {
      plannedDate: '2026-03-02',
      timeWindow: 'morning',
    });

    await agenda.moveWithinGroup(second.id, -1);
    const groups = agendaGroupsFromSnapshot(await planner.getSnapshot(), '2026-03-02');
    expect(groups.find((group) => group.group === 'exact')?.tasks.map((task) => task.id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(groups.find((group) => group.group === 'morning')?.tasks.map((task) => task.id)).toEqual(
      [second.id, first.id],
    );
    await expect(agenda.moveWithinGroup(later.id, 1)).rejects.toBeInstanceOf(AgendaPlanningError);
    database.close();
    await database.delete();
  });

  it('calculates capacity and sources without inventing duration or overdue meaning', async () => {
    const { agenda, database, planner } = createHarness();
    await initializeDatabase(database);
    const estimated = await planner.createTask('Estimated', undefined, {
      plannedDate: '2026-03-02',
      estimatedDurationMinutes: 90,
    });
    const unknown = await planner.createTask('Unknown', undefined, { plannedDate: '2026-03-02' });
    const earlier = await planner.createTask('Earlier intention', undefined, {
      plannedDate: '2026-03-01',
    });
    await planner.createTask('Flexible source', undefined, {
      flexibleStartDate: '2026-03-03',
      flexibleEndDate: '2026-03-05',
    });
    await agenda.setWeekdayCapacity(1, 120);
    const snapshot = await planner.getSnapshot();

    expect(
      capacitySummaryForDate(snapshot, await agenda.getCapacities(), '2026-03-02'),
    ).toMatchObject({
      availableMinutes: 120,
      estimatedMinutes: 90,
      remainingMinutes: 30,
      unknownDurationCount: 1,
    });
    expect(previouslyPlannedTasks(snapshot, '2026-03-02').map((task) => task.id)).toEqual([
      earlier.id,
    ]);
    expect(planningSourcesForHorizon(snapshot, '2026-03-02').flexible).toHaveLength(1);
    expect(sevenDayHorizon(snapshot, await agenda.getCapacities(), '2026-03-02')).toHaveLength(7);
    expect([estimated.id, unknown.id]).toEqual(expect.arrayContaining([estimated.id, unknown.id]));
    database.close();
    await database.delete();
  });

  it('keeps soft-deleted placements recoverable and removes them on permanent deletion', async () => {
    const { database, planner } = createHarness();
    await initializeDatabase(database);
    const task = await planner.createTask('Recover placement', undefined, {
      plannedDate: '2026-03-02',
    });

    await planner.deleteTask(task.id);
    expect((await planner.getSnapshot()).plannedPlacements).toHaveLength(0);
    expect(await database.plannedPlacements.get(task.id)).toBeDefined();
    await planner.restoreDeletedEntity('task', task.id);
    expect((await planner.getSnapshot()).plannedPlacements).toHaveLength(1);

    await planner.deleteTask(task.id);
    await planner.permanentlyDelete('task', task.id);
    expect(await database.plannedPlacements.get(task.id)).toBeUndefined();
    database.close();
    await database.delete();
  });
});
