import { database, type PlaniblyDatabase } from './database';
import {
  copyDashboardCards,
  dashboardLayoutSort,
  defaultDashboardCards,
  normalizeDashboardCards,
  normalizeDashboardLayout,
} from './dashboard';
import {
  BUILT_IN_DASHBOARD_LAYOUT_IDS,
  STARTER_DASHBOARD_LAYOUTS,
  type DashboardCardConfig,
  type DashboardLayoutRecord,
  type DashboardState,
  type DashboardSuggestionType,
} from './dashboardTypes';
import { PLANNER_DATA_CHANGED_EVENT } from './plannerRepository';

type DashboardRepositoryOptions = {
  now?: () => string;
  createId?: () => string;
  notify?: () => void;
};

function requiredName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('Layout name is required.');
  return name;
}

function notifyDashboardChanged(): void {
  window.dispatchEvent(new Event(PLANNER_DATA_CHANGED_EVENT));
}

export class BuiltInLayoutError extends Error {
  public constructor(action: 'rename' | 'delete') {
    super(`Built-in layouts cannot be ${action === 'rename' ? 'renamed' : 'deleted'}.`);
    this.name = 'BuiltInLayoutError';
  }
}

export class DashboardRepository {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly notify: () => void;

  public constructor(
    private readonly db: PlaniblyDatabase = database,
    options: DashboardRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? notifyDashboardChanged;
  }

  public async getState(): Promise<DashboardState> {
    return this.db.transaction('rw', this.db.dashboardLayouts, this.db.metadata, async () => {
      const now = this.now();
      const rawLayouts = await this.db.dashboardLayouts.toArray();
      const layouts: DashboardLayoutRecord[] = [];
      for (const rawLayout of rawLayouts) {
        const normalized = normalizeDashboardLayout(rawLayout, now);
        if (!normalized) {
          await this.db.dashboardLayouts.delete(rawLayout.id);
          continue;
        }
        layouts.push(normalized);
        if (JSON.stringify(normalized) !== JSON.stringify(rawLayout)) {
          await this.db.dashboardLayouts.put(normalized);
        }
      }

      if (layouts.length === 0) {
        const recovered: DashboardLayoutRecord = {
          id: this.createId(),
          name: 'Recovered dashboard',
          cards: defaultDashboardCards(),
          isDefault: true,
          dismissedSuggestions: [],
          createdAt: now,
          modifiedAt: now,
        };
        await this.db.dashboardLayouts.add(recovered);
        layouts.push(recovered);
      }

      const activeMetadata = await this.db.metadata.get('dashboardActiveLayoutId');
      const activeCandidate = layouts.find((layout) => layout.id === activeMetadata?.value);
      const defaultCandidates = layouts.filter((layout) => layout.isDefault);
      const selectedDefault =
        defaultCandidates.length === 1
          ? defaultCandidates[0]!
          : (activeCandidate ??
            layouts.find((layout) => layout.id === BUILT_IN_DASHBOARD_LAYOUT_IDS.overview) ??
            layouts[0]!);
      for (const layout of layouts) {
        const shouldBeDefault = layout.id === selectedDefault.id;
        if (layout.isDefault !== shouldBeDefault) {
          layout.isDefault = shouldBeDefault;
          layout.modifiedAt = now;
          await this.db.dashboardLayouts.put(layout);
        }
      }
      const activeLayout = activeCandidate ?? selectedDefault;
      if (activeMetadata?.value !== activeLayout.id) {
        await this.db.metadata.put({
          key: 'dashboardActiveLayoutId',
          value: activeLayout.id,
          updatedAt: now,
        });
      }
      return {
        layouts: layouts.sort(dashboardLayoutSort),
        activeLayoutId: activeLayout.id,
      };
    });
  }

  public async createLayout(
    name: string,
    cards: DashboardCardConfig[] = defaultDashboardCards(),
  ): Promise<DashboardLayoutRecord> {
    await this.getState();
    const now = this.now();
    const layout: DashboardLayoutRecord = {
      id: this.createId(),
      name: requiredName(name),
      cards: normalizeDashboardCards(cards),
      isDefault: false,
      dismissedSuggestions: [],
      createdAt: now,
      modifiedAt: now,
    };
    await this.db.transaction('rw', this.db.dashboardLayouts, this.db.metadata, async () => {
      await this.db.dashboardLayouts.add(layout);
      await this.db.metadata.put({
        key: 'dashboardActiveLayoutId',
        value: layout.id,
        updatedAt: now,
      });
    });
    this.notify();
    return layout;
  }

  public async setActiveLayout(id: string): Promise<void> {
    const state = await this.getState();
    if (!state.layouts.some((layout) => layout.id === id)) throw new Error('Layout not found.');
    await this.db.metadata.put({
      key: 'dashboardActiveLayoutId',
      value: id,
      updatedAt: this.now(),
    });
    this.notify();
  }

  public async setDefaultLayout(id: string): Promise<void> {
    const state = await this.getState();
    if (!state.layouts.some((layout) => layout.id === id)) throw new Error('Layout not found.');
    const now = this.now();
    await this.db.transaction('rw', this.db.dashboardLayouts, async () => {
      await Promise.all(
        state.layouts.map((layout) =>
          this.db.dashboardLayouts.update(layout.id, {
            isDefault: layout.id === id,
            modifiedAt: now,
          }),
        ),
      );
    });
    this.notify();
  }

  public async renameLayout(id: string, name: string): Promise<void> {
    const layout = (await this.getState()).layouts.find((candidate) => candidate.id === id);
    if (!layout) throw new Error('Layout not found.');
    if (layout.builtInKey) throw new BuiltInLayoutError('rename');
    await this.db.dashboardLayouts.update(id, { name: requiredName(name), modifiedAt: this.now() });
    this.notify();
  }

  public async saveCustomization(
    id: string,
    name: string,
    cards: DashboardCardConfig[],
  ): Promise<DashboardLayoutRecord> {
    const layout = (await this.getState()).layouts.find((candidate) => candidate.id === id);
    if (!layout) throw new Error('Layout not found.');
    const normalizedCards = normalizeDashboardCards(cards);
    if (layout.builtInKey) {
      return this.createLayout(requiredName(name), normalizedCards);
    }
    const now = this.now();
    const updated = {
      ...layout,
      name: requiredName(name),
      cards: normalizedCards,
      modifiedAt: now,
    };
    await this.db.dashboardLayouts.put(updated);
    this.notify();
    return updated;
  }

  public async duplicateLayout(id: string): Promise<DashboardLayoutRecord> {
    const layout = (await this.getState()).layouts.find((candidate) => candidate.id === id);
    if (!layout) throw new Error('Layout not found.');
    return this.createLayout(`${layout.name} copy`, copyDashboardCards(layout.cards));
  }

  public async deleteLayout(id: string): Promise<void> {
    const state = await this.getState();
    const layout = state.layouts.find((candidate) => candidate.id === id);
    if (!layout) throw new Error('Layout not found.');
    if (layout.builtInKey) throw new BuiltInLayoutError('delete');
    const remaining = state.layouts.filter((candidate) => candidate.id !== id);
    const existingDefault = remaining.find((candidate) => candidate.isDefault);
    const fallback =
      existingDefault ??
      remaining.find((candidate) => candidate.id === BUILT_IN_DASHBOARD_LAYOUT_IDS.overview) ??
      remaining[0];
    const now = this.now();
    await this.db.transaction('rw', this.db.dashboardLayouts, this.db.metadata, async () => {
      await this.db.dashboardLayouts.delete(id);
      if (fallback && layout.isDefault) {
        await Promise.all(
          remaining.map((candidate) =>
            this.db.dashboardLayouts.update(candidate.id, {
              isDefault: candidate.id === fallback.id,
              modifiedAt: now,
            }),
          ),
        );
      }
      if (fallback && state.activeLayoutId === id) {
        await this.db.metadata.put({
          key: 'dashboardActiveLayoutId',
          value: fallback.id,
          updatedAt: now,
        });
      }
    });
    await this.getState();
    this.notify();
  }

  public async dismissSuggestion(
    layoutId: string,
    suggestion: DashboardSuggestionType,
  ): Promise<void> {
    const layout = (await this.getState()).layouts.find((candidate) => candidate.id === layoutId);
    if (!layout) throw new Error('Layout not found.');
    if (layout.dismissedSuggestions.includes(suggestion)) return;
    await this.db.dashboardLayouts.update(layoutId, {
      dismissedSuggestions: [...layout.dismissedSuggestions, suggestion],
      modifiedAt: this.now(),
    });
    this.notify();
  }

  public async restoreBuiltInDefaults(): Promise<void> {
    const now = this.now();
    await this.db.transaction('rw', this.db.dashboardLayouts, this.db.metadata, async () => {
      const allLayouts = await this.db.dashboardLayouts.toArray();
      await Promise.all(
        allLayouts
          .filter((layout) => !layout.builtInKey)
          .map((layout) =>
            this.db.dashboardLayouts.update(layout.id, { isDefault: false, modifiedAt: now }),
          ),
      );
      await this.db.dashboardLayouts.bulkPut(
        STARTER_DASHBOARD_LAYOUTS.map((layout) => ({
          ...layout,
          cards: copyDashboardCards(layout.cards),
          dismissedSuggestions: [],
          createdAt: allLayouts.find((candidate) => candidate.id === layout.id)?.createdAt ?? now,
          modifiedAt: now,
        })),
      );
      await this.db.metadata.put({
        key: 'dashboardActiveLayoutId',
        value: BUILT_IN_DASHBOARD_LAYOUT_IDS.overview,
        updatedAt: now,
      });
    });
    this.notify();
  }
}

export const dashboardRepository = new DashboardRepository();
