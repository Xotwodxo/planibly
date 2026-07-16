import {
  dashboardCardDataFromSnapshot,
  dashboardSuggestions,
  moveDashboardCard,
  normalizeDashboardCards,
  projectNextActionsFromSnapshot,
  recentlyCompletedFromSnapshot,
  setDashboardCardSize,
  setDashboardCardVisibility,
} from './dashboard';
import { STARTER_DASHBOARD_LAYOUTS, type DashboardLayoutRecord } from './dashboardTypes';
import type { PlanListRecord, PlannerSnapshot, TaskRecord } from './plannerTypes';

const timestamp = '2026-07-15T09:00:00.000Z';

function list(id: string, mode: 'standard' | 'project' = 'standard'): PlanListRecord {
  return {
    id,
    areaId: null,
    name: mode === 'project' ? 'Launch project' : 'Inbox',
    color: '#5B67C8',
    mode,
    order: 0,
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

function task(id: string, title: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    title,
    listId: 'list',
    status: 'available',
    order: 0,
    createdAt: timestamp,
    modifiedAt: timestamp,
    ...overrides,
  };
}

function snapshot(tasks: TaskRecord[] = []): PlannerSnapshot {
  return {
    areas: [],
    lists: [list('list'), list('project', 'project')],
    archivedProjects: [],
    tasks,
    taskSteps: [],
    tags: [],
    taskTags: [],
    taskRelationships: [],
    plannedPlacements: [],
    calendars: [],
    calendarEvents: [],
    deletedCalendars: [],
    deletedCalendarEvents: [],
    blockedByTaskId: {},
    projectProgressByListId: {},
    deletedAreas: [],
    deletedLists: [],
    deletedTasks: [],
    deletedSteps: [],
  };
}

function layout(cards = STARTER_DASHBOARD_LAYOUTS[0]!.cards): DashboardLayoutRecord {
  return {
    ...STARTER_DASHBOARD_LAYOUTS[0]!,
    cards: cards.map((cardConfig) => ({ ...cardConfig })),
    dismissedSuggestions: [],
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

describe('dashboard configuration', () => {
  it('normalizes unknown, missing, duplicate, and invalid card configuration safely', () => {
    const normalized = normalizeDashboardCards([
      { type: 'today', size: 'enormous', order: 4, hidden: true },
      { type: 'today', size: 'wide', order: 1, hidden: false },
      { type: 'futureCard', size: 'wide', order: 0, hidden: false },
    ]);

    expect(normalized).toHaveLength(9);
    expect(normalized.find((card) => card.type === 'today')).toMatchObject({
      size: 'standard',
      hidden: true,
    });
    expect(normalized.find((card) => card.type === 'quickAdd')?.hidden).toBe(false);
    expect(normalized.map((card) => card.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reorders, hides, restores, and resizes cards without mutating the source', () => {
    const source = layout().cards;
    const moved = moveDashboardCard(source, 'today', -1);
    const hidden = setDashboardCardVisibility(moved, 'today', false);
    const restored = setDashboardCardVisibility(hidden, 'today', true);
    const resized = setDashboardCardSize(restored, 'today', 'wide');

    expect(source.find((card) => card.type === 'today')).toMatchObject({
      order: 1,
      size: 'standard',
    });
    expect(moved.find((card) => card.type === 'today')?.order).toBe(0);
    expect(hidden.find((card) => card.type === 'today')?.hidden).toBe(true);
    expect(restored.find((card) => card.type === 'today')?.hidden).toBe(false);
    expect(resized.find((card) => card.type === 'today')?.size).toBe('wide');
  });
});

describe('dashboard card queries', () => {
  it('uses Phase 2A planning semantics and derived blocking for concise cards', () => {
    const data = snapshot([
      task('today', 'Today', { plannedDate: '2026-07-15' }),
      task('overdue', 'Overdue deadline', { deadlineDate: '2026-07-14' }),
      task('future', 'Soon', { plannedDate: '2026-07-17' }),
      task('unscheduled', 'Unscheduled'),
      task('blocked', 'Blocked'),
    ]);
    data.blockedByTaskId.blocked = ['today'];

    expect(
      dashboardCardDataFromSnapshot(data, 'today', '2026-07-15').tasks.map((item) => item.id),
    ).toEqual(['today']);
    expect(
      dashboardCardDataFromSnapshot(data, 'overdue', '2026-07-15').tasks.map((item) => item.id),
    ).toEqual(['overdue']);
    expect(
      dashboardCardDataFromSnapshot(data, 'nextThreeDays', '2026-07-15').tasks.map(
        (item) => item.id,
      ),
    ).toEqual(['today', 'future']);
    expect(
      dashboardCardDataFromSnapshot(data, 'unscheduled', '2026-07-15').tasks.map((item) => item.id),
    ).toEqual(['overdue', 'unscheduled', 'blocked']);
    expect(
      dashboardCardDataFromSnapshot(data, 'blockedTasks', '2026-07-15').tasks.map(
        (item) => item.id,
      ),
    ).toEqual(['blocked']);
  });

  it('derives only available project next actions', () => {
    const next = task('project-next', 'Next action', { listId: 'project' });
    const data = snapshot([next]);
    data.projectProgressByListId.project = {
      listId: 'project',
      completedCount: 1,
      totalCount: 2,
      nextActionId: next.id,
      allRemainingBlocked: false,
    };

    const actions = projectNextActionsFromSnapshot(data);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.project.id).toBe('project');
    expect(actions[0]?.task).toEqual(next);
  });

  it('bounds recently completed tasks by durable completion time', () => {
    const completed = Array.from({ length: 7 }, (_, index) =>
      task(`done-${index}`, `Done ${index}`, {
        status: 'completed',
        completedAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      }),
    );
    completed.push(task('legacy-active', 'Not completed'));

    expect(recentlyCompletedFromSnapshot(snapshot(completed)).map((item) => item.id)).toEqual([
      'done-6',
      'done-5',
      'done-4',
      'done-3',
      'done-2',
    ]);
  });

  it('offers explainable, dismissable suggestions without changing configuration', () => {
    const cards = layout().cards.map((card) =>
      card.type === 'overdue' || card.type === 'projectNextActions'
        ? { ...card, hidden: true }
        : card,
    );
    const data = snapshot([task('late', 'Late', { deadlineDate: '2026-07-14' })]);
    const projectTask = task('next', 'Next', { listId: 'project' });
    data.tasks.push(projectTask);
    data.projectProgressByListId.project = {
      listId: 'project',
      completedCount: 0,
      totalCount: 1,
      nextActionId: projectTask.id,
      allRemainingBlocked: false,
    };
    const configured = layout(cards);

    expect(dashboardSuggestions(data, configured, '2026-07-15').map((item) => item.type)).toEqual([
      'addOverdue',
      'addProjectNextActions',
    ]);
    configured.dismissedSuggestions = ['addOverdue'];
    expect(dashboardSuggestions(data, configured, '2026-07-15').map((item) => item.type)).toEqual([
      'addProjectNextActions',
    ]);
    expect(configured.cards.find((card) => card.type === 'overdue')?.hidden).toBe(true);
  });
});
