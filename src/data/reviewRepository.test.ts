import { initializeDatabase, initializeReviewData, PlaniblyDatabase } from './database';
import { REVIEW_PREFERENCES_ID } from './reviewTypes';
import { PlannerRepository } from './plannerRepository';
import { ReviewRepository } from './reviewRepository';

function harness(beforeCommit?: () => void | Promise<void>) {
  const database = new PlaniblyDatabase(`review-${crypto.randomUUID()}`);
  let id = 0;
  let tick = 0;
  const now = () => `2026-07-18T09:00:${String(tick++).padStart(2, '0')}.000Z`;
  const createId = () => `e1000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
  return {
    database,
    planner: new PlannerRepository(database, { now, createId, notify: () => undefined }),
    reviews: new ReviewRepository(database, {
      now,
      createId,
      notify: () => undefined,
      beforeCommit,
    }),
  };
}

async function close(database: PlaniblyDatabase) {
  database.close();
  await database.delete();
}

describe('ReviewRepository', () => {
  it('repairs invalid preferences and removes malformed unfinished records safely', async () => {
    const { database } = harness();
    await initializeDatabase(database);
    await database.reviewPreferences.put({
      ...(await database.reviewPreferences.get(REVIEW_PREFERENCES_ID))!,
      morningTime: 'not-a-time',
    });
    await database.reviewRecords.put({
      id: 'invalid-review',
      type: 'morning',
      periodStart: 'not-a-date',
      periodEnd: 'not-a-date',
      startedAt: 'invalid',
      modifiedAt: 'invalid',
      version: 1,
    });
    await initializeReviewData(database);
    await expect(database.reviewPreferences.get(REVIEW_PREFERENCES_ID)).resolves.toMatchObject({
      morningTime: '08:00',
      showOnHome: false,
    });
    expect(await database.reviewRecords.count()).toBe(0);
    await close(database);
  });

  it('starts, resumes, finishes, deliberately reopens, and enforces one type/date record', async () => {
    const { database, reviews } = harness();
    await initializeDatabase(database);
    const first = await reviews.startOrResume('morning', '2026-07-18');
    const resumed = await reviews.startOrResume('morning', '2026-07-18');
    expect(resumed.id).toBe(first.id);
    expect(await database.reviewRecords.count()).toBe(1);
    await reviews.finish(first.id);
    expect((await database.reviewRecords.get(first.id))?.finishedAt).toBeDefined();
    await reviews.reopen(first.id);
    expect((await database.reviewRecords.get(first.id))?.finishedAt).toBeUndefined();
    await close(database);
  });

  it('keeps dismissal session-only and does not write it to review records', async () => {
    const { database, reviews } = harness();
    await initializeDatabase(database);
    const record = await reviews.startOrResume('evening', '2026-07-18');
    reviews.dismissForSession('evening', '2026-07-18');
    expect((await reviews.getState()).dismissedKeys.has('evening:2026-07-18')).toBe(true);
    expect(await database.reviewRecords.get(record.id)).not.toHaveProperty('dismissedAt');
    const reopenedSession = new ReviewRepository(database, { notify: () => undefined });
    expect((await reopenedSession.getState()).dismissedKeys.size).toBe(0);
    await close(database);
  });

  it('deletes only review lifecycle data', async () => {
    const { database, planner, reviews } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Authoritative task');
    const record = await reviews.startOrResume('weekAhead', '2026-07-18');
    await reviews.deleteReview(record.id);
    expect(await database.reviewRecords.count()).toBe(0);
    await expect(database.tasks.get(task.id)).resolves.toMatchObject({
      title: 'Authoritative task',
    });
    await close(database);
  });

  it('applies approved moves/removals transactionally and stores only minimal counts', async () => {
    const { database, planner, reviews } = harness();
    await initializeDatabase(database);
    const move = await planner.createTask('Move me', undefined, { plannedDate: '2026-07-18' });
    const remove = await planner.createTask('Unplan me', undefined, { plannedDate: '2026-07-18' });
    const record = await reviews.startOrResume('evening', '2026-07-18');
    const preview = await reviews.applyActions(
      [
        { taskId: move.id, kind: 'move', targetDate: '2026-07-19' },
        { taskId: remove.id, kind: 'remove' },
      ],
      record.id,
    );
    expect(preview.canApply).toBe(true);
    expect((await database.tasks.get(move.id))?.plannedDate).toBe('2026-07-19');
    expect((await database.tasks.get(remove.id))?.plannedDate).toBeUndefined();
    expect(await database.plannedPlacements.where('taskId').equals(remove.id).count()).toBe(0);
    expect((await database.reviewRecords.get(record.id))?.appliedActionSummary).toMatchObject({
      movedTaskCount: 1,
      unplannedTaskCount: 1,
    });
    expect(JSON.stringify(await database.reviewRecords.get(record.id))).not.toContain('Move me');
    await close(database);
  });

  it('rolls back every write when the transaction fails after staging changes', async () => {
    const { database, planner, reviews } = harness(() => {
      throw new Error('Simulated failure');
    });
    await initializeDatabase(database);
    const task = await planner.createTask('Remain here', undefined, { plannedDate: '2026-07-18' });
    await expect(
      reviews.applyActions([{ taskId: task.id, kind: 'move', targetDate: '2026-07-19' }]),
    ).rejects.toThrow('Simulated failure');
    expect((await database.tasks.get(task.id))?.plannedDate).toBe('2026-07-18');
    expect(
      (await database.plannedPlacements.where('taskId').equals(task.id).first())?.localDate,
    ).toBe('2026-07-18');
    await close(database);
  });

  it('cancels safely because preview alone performs no writes', async () => {
    const { database, planner, reviews } = harness();
    await initializeDatabase(database);
    const task = await planner.createTask('Preview only', undefined, { plannedDate: '2026-07-18' });
    const preview = await reviews.preview([
      { taskId: task.id, kind: 'move', targetDate: '2026-07-19' },
    ]);
    expect(preview.canApply).toBe(true);
    expect((await database.tasks.get(task.id))?.plannedDate).toBe('2026-07-18');
    await close(database);
  });
});
