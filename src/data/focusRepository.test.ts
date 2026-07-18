import { countdownView } from './focus';
import {
  FocusBlockedError,
  FocusRepository,
  FocusSwitchRequiredError,
  PrepParentRequiredError,
} from './focusRepository';
import { initializeDatabase, PlaniblyDatabase } from './database';
import { PlannerRepository } from './plannerRepository';
import { INBOX_LIST_ID } from './plannerTypes';
import { ACTIVE_FOCUS_ID } from './focusTypes';

function harness() {
  const database = new PlaniblyDatabase(`focus-${crypto.randomUUID()}`);
  let focusId = 0;
  let plannerId = 0;
  let nowMs = Date.parse('2026-07-18T08:00:00.000Z');
  const focus = new FocusRepository(database, {
    createId: () => `d1000000-0000-4000-8000-${String(++focusId).padStart(12, '0')}`,
    now: () => new Date(nowMs),
    notify: () => undefined,
  });
  const planner = new PlannerRepository(database, {
    createId: () => `d2000000-0000-4000-8000-${String(++plannerId).padStart(12, '0')}`,
    now: () => new Date(nowMs).toISOString(),
    notify: () => undefined,
  });
  return {
    database,
    focus,
    planner,
    advance: (seconds: number) => {
      nowMs += seconds * 1_000;
    },
  };
}

async function close(database: PlaniblyDatabase) {
  database.close();
  await database.delete();
}

describe('FocusRepository', () => {
  it('persists optional details and supports prep CRUD, ordering, duplication, reset, and recovery', async () => {
    const { database, focus, planner } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Prepare the report');
    await focus.saveStartingDetails(task.id, {
      whyItMatters: 'It gives everyone a clear decision.',
      preferredStartStyle: 'gentle',
      defaultCountdownMinutes: 20,
    });
    await expect(
      database.taskStartingDetails.where('taskId').equals(task.id).first(),
    ).resolves.toMatchObject({
      preferredStartStyle: 'gentle',
      defaultCountdownMinutes: 20,
    });

    const first = await focus.createPrepItem(task.id, 'Open the document');
    const second = await focus.createPrepItem(task.id, 'Put phone on silent');
    await focus.updatePrepItem(first.id, 'Open the latest document');
    await focus.movePrepItem(second.id, -1);
    expect(
      (await database.taskPrepItems.where('taskId').equals(task.id).sortBy('order')).map(
        (item) => item.title,
      ),
    ).toEqual(['Put phone on silent', 'Open the latest document']);
    const duplicate = await focus.duplicatePrepItem(first.id);
    expect(duplicate).toMatchObject({ title: 'Open the latest document copy', completed: false });
    await focus.setPrepItemCompleted(first.id, true);
    expect(await focus.resetPrepItems(task.id)).toBe(1);
    expect((await database.taskPrepItems.get(first.id))?.completed).toBe(false);

    const receipt = await focus.deletePrepItem(second.id);
    expect(receipt.kind).toBe('prepItem');
    await focus.restoreDeletionGroup(receipt.groupId);
    expect((await database.taskPrepItems.get(second.id))?.deletedAt).toBeUndefined();
    await focus.saveStartingDetails(task.id, {});
    expect(await database.taskStartingDetails.where('taskId').equals(task.id).count()).toBe(0);
    await close(database);
  });

  it('keeps prep independent from task steps and parent completion', async () => {
    const { database, focus, planner } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Draft proposal');
    const step = await planner.createStep(task.id, 'Write the opening');
    const prep = await focus.createPrepItem(task.id, 'Open notes');
    await focus.setPrepItemCompleted(prep.id, true);
    expect((await database.taskSteps.get(step.id))?.completed).toBe(false);
    expect((await database.tasks.get(task.id))?.status).toBe('inbox');
    await planner.setStepCompleted(step.id, true);
    expect((await database.taskPrepItems.get(prep.id))?.completed).toBe(true);
    expect((await database.tasks.get(task.id))?.status).toBe('inbox');
    await planner.setTaskCompleted(task.id, true);
    expect((await database.taskPrepItems.get(prep.id))?.completed).toBe(true);
    expect((await database.taskSteps.get(step.id))?.completed).toBe(true);
    await close(database);
  });

  it('rejects blocked starts and requires deliberate transactional task switching', async () => {
    const { database, focus, planner } = harness();
    await initializeDatabase(database);
    const predecessor = await planner.createTask('Get approval');
    const successor = await planner.createTask('Publish update');
    const other = await planner.createTask('File notes');
    await planner.addRelationship(predecessor.id, successor.id);
    await expect(focus.startFocus(successor.id, 'oneThing')).rejects.toBeInstanceOf(
      FocusBlockedError,
    );
    await planner.setTaskCompleted(predecessor.id, true);
    await focus.startFocus(successor.id, 'oneThing');
    await expect(focus.startFocus(other.id, 'gentle')).rejects.toBeInstanceOf(
      FocusSwitchRequiredError,
    );
    await focus.startFocus(other.id, 'full', true);
    await expect(focus.getActiveFocus()).resolves.toMatchObject({
      taskId: other.id,
      startStyle: 'full',
      fullDetailsRevealed: true,
    });
    expect(await database.activeFocus.count()).toBe(1);
    await focus.endFocus();
    expect(await database.activeFocus.count()).toBe(0);
    await close(database);
  });

  it('recovers running and paused countdowns from an injected clock and handles zero and add time', async () => {
    const { database, focus, planner, advance } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Read the brief', INBOX_LIST_ID, {
      estimatedDurationMinutes: 30,
    });
    await focus.saveStartingDetails(task.id, { defaultCountdownMinutes: 20 });
    await focus.startFocus(task.id, 'gentle');
    await focus.configureCountdown('custom', 1);
    await focus.startCountdown();
    advance(30);
    expect(
      countdownView((await focus.getActiveFocus())!, new Date('2026-07-18T08:00:30Z')),
    ).toMatchObject({
      state: 'running',
      remainingSeconds: 30,
    });
    await focus.pauseCountdown();
    advance(300);
    expect(
      countdownView((await focus.getActiveFocus())!, new Date('2026-07-18T08:05:30Z')),
    ).toMatchObject({
      state: 'paused',
      remainingSeconds: 30,
    });
    await focus.addCountdownTime(5);
    expect((await focus.getActiveFocus())?.countdownRemainingSeconds).toBe(330);
    await focus.startCountdown();
    advance(331);
    expect(
      countdownView((await focus.getActiveFocus())!, new Date('2026-07-18T08:11:01Z')).state,
    ).toBe('finished');
    await focus.addCountdownTime(5);
    expect(
      countdownView((await focus.getActiveFocus())!, new Date('2026-07-18T08:11:01Z')),
    ).toMatchObject({
      state: 'running',
      remainingSeconds: 300,
    });
    await focus.resetCountdown();
    expect((await focus.getActiveFocus())?.countdownState).toBe('idle');
    await focus.configureCountdown('estimated');
    expect((await focus.getActiveFocus())?.countdownDurationSeconds).toBe(1_800);
    await focus.configureCountdown('saved');
    expect((await focus.getActiveFocus())?.countdownDurationSeconds).toBe(1_200);
    await close(database);
  });

  it('closes unavailable focus and preserves or purges prep through task recovery rules', async () => {
    const { database, focus, planner } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Prepare files');
    const prep = await focus.createPrepItem(task.id, 'Find the folder');
    await focus.saveStartingDetails(task.id, { whyItMatters: 'The handoff needs it.' });
    await focus.startFocus(task.id, 'gentle');
    await planner.setTaskCompleted(task.id, true);
    expect(await database.activeFocus.count()).toBe(0);

    await planner.setTaskCompleted(task.id, false);
    await focus.startFocus(task.id, 'gentle');
    const receipt = await planner.deleteTask(task.id);
    expect(await database.activeFocus.count()).toBe(0);
    expect((await database.taskPrepItems.get(prep.id))?.deletionGroupId).toBe(receipt.groupId);
    await planner.restoreDeletedEntity('task', task.id);
    expect((await database.taskPrepItems.get(prep.id))?.deletedAt).toBeUndefined();

    const prepReceipt = await focus.deletePrepItem(prep.id);
    await planner.deleteTask(task.id);
    await expect(focus.restorePrepItem(prep.id)).rejects.toBeInstanceOf(PrepParentRequiredError);
    await planner.restoreDeletedEntity('task', task.id);
    await focus.restoreDeletionGroup(prepReceipt.groupId);
    await planner.deleteTask(task.id);
    await planner.permanentlyDelete('task', task.id);
    expect(await database.taskPrepItems.where('taskId').equals(task.id).count()).toBe(0);
    expect(await database.taskStartingDetails.where('taskId').equals(task.id).count()).toBe(0);
    await close(database);
  });

  it('removes invalid persisted focus safely', async () => {
    const { database, focus } = harness();
    await initializeDatabase(database);
    await database.table('activeFocus').put({
      id: ACTIVE_FOCUS_ID,
      taskId: 'missing-task',
      startStyle: 'unknown',
      startedAt: 'not-a-date',
      fullDetailsRevealed: false,
      countdownSource: 'none',
      countdownState: 'idle',
      createdAt: 'not-a-date',
      modifiedAt: 'not-a-date',
    });
    await expect(focus.getActiveFocus()).resolves.toBeUndefined();
    expect(await database.activeFocus.count()).toBe(0);
    await close(database);
  });
});
