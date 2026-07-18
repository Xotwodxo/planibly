import { initializeDatabase, PlaniblyDatabase } from './database';
import { DashboardRepository, BuiltInLayoutError } from './dashboardRepository';
import { BUILT_IN_DASHBOARD_LAYOUT_IDS } from './dashboardTypes';

describe('DashboardRepository', () => {
  async function harness() {
    const database = new PlaniblyDatabase(`planibly-dashboard-${crypto.randomUUID()}`);
    await initializeDatabase(database);
    let sequence = 10;
    const repository = new DashboardRepository(database, {
      now: () => '2026-07-15T12:00:00.000Z',
      createId: () => `80000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
      notify: () => undefined,
    });
    return { database, repository };
  }

  it('creates starters idempotently with exactly one default', async () => {
    const { database, repository } = await harness();
    const state = await repository.getState();

    expect(state.layouts.map((layout) => layout.name)).toEqual(['Overview', 'Focus', 'Planning']);
    expect(state.activeLayoutId).toBe(BUILT_IN_DASHBOARD_LAYOUT_IDS.overview);
    expect(state.layouts.filter((layout) => layout.isDefault)).toHaveLength(1);

    database.close();
    await database.delete();
  });

  it('supports custom layout CRUD, switching, duplication, and default recovery', async () => {
    const { database, repository } = await harness();
    const custom = await repository.createLayout('My layout');
    await repository.renameLayout(custom.id, 'Renamed');
    await repository.setDefaultLayout(custom.id);
    const duplicate = await repository.duplicateLayout(custom.id);
    await repository.setActiveLayout(duplicate.id);
    await repository.deleteLayout(custom.id);
    const state = await repository.getState();

    expect(state.layouts.find((layout) => layout.id === duplicate.id)?.name).toBe('Renamed copy');
    expect(state.activeLayoutId).toBe(duplicate.id);
    expect(state.layouts.filter((layout) => layout.isDefault)).toHaveLength(1);
    expect(state.layouts.find((layout) => layout.isDefault)?.id).toBe(
      BUILT_IN_DASHBOARD_LAYOUT_IDS.overview,
    );

    database.close();
    await database.delete();
  });

  it('protects built-ins and saves their customization as a separate layout', async () => {
    const { database, repository } = await harness();
    const state = await repository.getState();
    const overview = state.layouts.find((layout) => layout.builtInKey === 'overview')!;
    const cards = overview.cards.map((card) =>
      card.type === 'today' ? { ...card, hidden: true } : card,
    );

    await expect(repository.renameLayout(overview.id, 'Changed')).rejects.toBeInstanceOf(
      BuiltInLayoutError,
    );
    await expect(repository.deleteLayout(overview.id)).rejects.toBeInstanceOf(BuiltInLayoutError);
    const saved = await repository.saveCustomization(overview.id, 'My overview', cards);

    expect(saved.builtInKey).toBeUndefined();
    expect(saved.cards.find((card) => card.type === 'today')?.hidden).toBe(true);
    expect(
      (await database.dashboardLayouts.get(overview.id))?.cards.find(
        (card) => card.type === 'today',
      )?.hidden,
    ).toBe(false);

    database.close();
    await database.delete();
  });

  it('repairs corrupt configuration, active selection, and default state', async () => {
    const { database, repository } = await harness();
    await database.dashboardLayouts.toCollection().modify((layout) => {
      layout.isDefault = true;
    });
    const focus = await database.dashboardLayouts.get(BUILT_IN_DASHBOARD_LAYOUT_IDS.focus);
    await database.dashboardLayouts.put({
      ...focus!,
      name: '',
      cards: [
        { type: 'today', size: 'invalid', hidden: true, order: 9 },
        { type: 'future-card', size: 'wide', hidden: false, order: 0 },
      ],
    } as never);
    await database.metadata.put({
      key: 'dashboardActiveLayoutId',
      value: 'missing',
      updatedAt: 'broken',
    });

    const state = await repository.getState();
    const repaired = state.layouts.find((layout) => layout.id === focus!.id)!;
    expect(state.layouts.filter((layout) => layout.isDefault)).toHaveLength(1);
    expect(state.layouts.some((layout) => layout.id === state.activeLayoutId)).toBe(true);
    expect(repaired.name).toBe('Recovered dashboard');
    expect(repaired.cards).toHaveLength(11);
    expect(repaired.cards.find((card) => card.type === 'currentFocus')?.hidden).toBe(true);
    expect(repaired.cards.find((card) => card.type === 'today')?.size).toBe('standard');
    expect(repaired.cards.find((card) => card.type === 'quickAdd')?.hidden).toBe(false);

    database.close();
    await database.delete();
  });

  it('restores protected defaults only when explicitly requested', async () => {
    const { database, repository } = await harness();
    await database.dashboardLayouts.delete(BUILT_IN_DASHBOARD_LAYOUT_IDS.focus);
    expect((await repository.getState()).layouts).toHaveLength(2);

    await repository.restoreBuiltInDefaults();
    const restored = await repository.getState();
    expect(restored.layouts.filter((layout) => layout.builtInKey)).toHaveLength(3);
    expect(restored.activeLayoutId).toBe(BUILT_IN_DASHBOARD_LAYOUT_IDS.overview);
    expect(
      restored.layouts.find((layout) => layout.id === restored.activeLayoutId)?.isDefault,
    ).toBe(true);

    database.close();
    await database.delete();
  });

  it('persists a dismissed suggestion per layout without changing its cards', async () => {
    const { database, repository } = await harness();
    const overview = (await repository.getState()).layouts.find(
      (layout) => layout.id === BUILT_IN_DASHBOARD_LAYOUT_IDS.overview,
    )!;
    const cardsBefore = overview.cards;

    await repository.dismissSuggestion(overview.id, 'addOverdue');
    await repository.dismissSuggestion(overview.id, 'addOverdue');
    const updated = (await repository.getState()).layouts.find(
      (layout) => layout.id === overview.id,
    )!;

    expect(updated.dismissedSuggestions).toEqual(['addOverdue']);
    expect(updated.cards).toEqual(cardsBefore);

    database.close();
    await database.delete();
  });
});
