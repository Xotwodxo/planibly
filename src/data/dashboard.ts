import {
  BUILT_IN_DASHBOARD_LAYOUT_IDS,
  DASHBOARD_CARD_LABELS,
  DASHBOARD_CARD_SIZES,
  DASHBOARD_CARD_TYPES,
  STARTER_DASHBOARD_LAYOUTS,
  type BuiltInDashboardLayoutKey,
  type DashboardCardConfig,
  type DashboardCardSize,
  type DashboardCardType,
  type DashboardLayoutRecord,
  type DashboardSuggestionType,
} from './dashboardTypes';
import { smartTasksFromSnapshot } from './planning';
import { eventsForDate } from './calendar';
import { expandCalendarOccurrences } from './recurrence';
import { routinesForDate, runProgress } from './routine';
import { countdownView, currentIncompleteStep } from './focus';
import type { CountdownViewState } from './focusTypes';
import type {
  CalendarOccurrence,
  PlanListRecord,
  PlannerSnapshot,
  TaskRecord,
} from './plannerTypes';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILT_IN_KEYS = ['overview', 'focus', 'planning'] as const;
const SUGGESTION_TYPES = [
  'addOverdue',
  'addProjectNextActions',
  'addCurrentRoutine',
  'addCurrentFocus',
] as const;

export const RECENTLY_COMPLETED_LIMIT = 5;

export type ProjectNextAction = {
  project: PlanListRecord;
  task: TaskRecord;
};

export type DashboardCardData = {
  tasks: TaskRecord[];
  projectNextActions: ProjectNextAction[];
  events: CalendarOccurrence[];
  totalCount: number;
  currentRoutine?: CurrentRoutineData;
  currentFocus?: CurrentFocusData;
};

export type CurrentRoutineData = {
  routineId: string;
  runId?: string;
  name: string;
  color: string;
  currentItem?: string;
  completed: number;
  total: number;
  action: 'Start' | 'Continue';
};

export type CurrentFocusData = {
  taskId: string;
  title: string;
  currentStep?: string;
  countdownState: CountdownViewState;
  remainingSeconds: number;
};

export type DashboardSuggestion = {
  type: DashboardSuggestionType;
  cardType: DashboardCardType;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCardType(value: unknown): value is DashboardCardType {
  return typeof value === 'string' && DASHBOARD_CARD_TYPES.includes(value as DashboardCardType);
}

function isCardSize(value: unknown): value is DashboardCardSize {
  return typeof value === 'string' && DASHBOARD_CARD_SIZES.includes(value as DashboardCardSize);
}

function isBuiltInKey(value: unknown): value is BuiltInDashboardLayoutKey {
  return typeof value === 'string' && BUILT_IN_KEYS.includes(value as BuiltInDashboardLayoutKey);
}

function isSuggestionType(value: unknown): value is DashboardSuggestionType {
  return typeof value === 'string' && SUGGESTION_TYPES.includes(value as DashboardSuggestionType);
}

export function normalizeDashboardCards(value: unknown): DashboardCardConfig[] {
  const known = new Map<DashboardCardType, DashboardCardConfig>();
  if (Array.isArray(value)) {
    for (const [fallbackOrder, candidate] of value.entries()) {
      if (!isRecord(candidate) || !isCardType(candidate.type) || known.has(candidate.type))
        continue;
      known.set(candidate.type, {
        type: candidate.type,
        size: isCardSize(candidate.size) ? candidate.size : 'standard',
        hidden: typeof candidate.hidden === 'boolean' ? candidate.hidden : false,
        order:
          typeof candidate.order === 'number' && Number.isFinite(candidate.order)
            ? candidate.order
            : fallbackOrder,
      });
    }
  }

  const ordered = [...known.values()].sort(
    (left, right) => left.order - right.order || left.type.localeCompare(right.type),
  );
  for (const type of DASHBOARD_CARD_TYPES) {
    if (!known.has(type)) {
      ordered.push({ type, size: 'standard', hidden: true, order: ordered.length });
    }
  }
  if (ordered.every((cardConfig) => cardConfig.hidden)) {
    const quickAdd = ordered.find((cardConfig) => cardConfig.type === 'quickAdd');
    if (quickAdd) quickAdd.hidden = false;
  }
  return ordered.map((cardConfig, order) => ({ ...cardConfig, order }));
}

export function normalizeDashboardLayout(
  value: unknown,
  fallbackTimestamp: string,
): DashboardLayoutRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    return undefined;
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const dismissedSuggestions = Array.isArray(value.dismissedSuggestions)
    ? [...new Set(value.dismissedSuggestions.filter(isSuggestionType))]
    : [];
  return {
    id: value.id,
    name: name || 'Recovered dashboard',
    builtInKey: isBuiltInKey(value.builtInKey) ? value.builtInKey : undefined,
    cards: normalizeDashboardCards(value.cards),
    isDefault: value.isDefault === true,
    dismissedSuggestions,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : fallbackTimestamp,
    modifiedAt: typeof value.modifiedAt === 'string' ? value.modifiedAt : fallbackTimestamp,
  };
}

export function copyDashboardCards(cards: readonly DashboardCardConfig[]): DashboardCardConfig[] {
  return cards.map((cardConfig) => ({ ...cardConfig }));
}

export function defaultDashboardCards(): DashboardCardConfig[] {
  return copyDashboardCards(STARTER_DASHBOARD_LAYOUTS[0]!.cards);
}

export function moveDashboardCard(
  cards: DashboardCardConfig[],
  type: DashboardCardType,
  direction: -1 | 1,
): DashboardCardConfig[] {
  const ordered = copyDashboardCards(cards).sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((cardConfig) => cardConfig.type === type);
  const other = ordered[index + direction];
  if (index < 0 || !other) return ordered;
  [ordered[index], ordered[index + direction]] = [other, ordered[index]!];
  return ordered.map((cardConfig, order) => ({ ...cardConfig, order }));
}

export function setDashboardCardVisibility(
  cards: DashboardCardConfig[],
  type: DashboardCardType,
  visible: boolean,
): DashboardCardConfig[] {
  return cards.map((cardConfig) =>
    cardConfig.type === type ? { ...cardConfig, hidden: !visible } : { ...cardConfig },
  );
}

export function setDashboardCardSize(
  cards: DashboardCardConfig[],
  type: DashboardCardType,
  size: DashboardCardSize,
): DashboardCardConfig[] {
  return cards.map((cardConfig) =>
    cardConfig.type === type ? { ...cardConfig, size } : { ...cardConfig },
  );
}

function visibleTaskIds(snapshot: PlannerSnapshot): Set<string> {
  const activeListIds = new Set(snapshot.lists.map((list) => list.id));
  return new Set(
    snapshot.tasks.filter((task) => activeListIds.has(task.listId)).map((task) => task.id),
  );
}

export function projectNextActionsFromSnapshot(snapshot: PlannerSnapshot): ProjectNextAction[] {
  return snapshot.lists
    .filter((list) => list.mode === 'project')
    .map((project) => {
      const nextActionId = snapshot.projectProgressByListId[project.id]?.nextActionId;
      const task = nextActionId
        ? snapshot.tasks.find((candidate) => candidate.id === nextActionId)
        : undefined;
      return task ? { project, task } : undefined;
    })
    .filter((item): item is ProjectNextAction => item !== undefined);
}

export function recentlyCompletedFromSnapshot(snapshot: PlannerSnapshot): TaskRecord[] {
  const visibleIds = visibleTaskIds(snapshot);
  return snapshot.tasks
    .filter((task) => task.status === 'completed' && visibleIds.has(task.id) && task.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))
    .slice(0, RECENTLY_COMPLETED_LIMIT);
}

export function dashboardCardDataFromSnapshot(
  snapshot: PlannerSnapshot,
  type: DashboardCardType,
  today: string,
  now: Date | string = new Date(),
): DashboardCardData {
  let tasks: TaskRecord[] = [];
  let projectNextActions: ProjectNextAction[] = [];
  let events: CalendarOccurrence[] = [];
  let currentRoutine: CurrentRoutineData | undefined;
  let currentFocus: CurrentFocusData | undefined;
  switch (type) {
    case 'today':
      tasks = smartTasksFromSnapshot(snapshot, 'today', today);
      events = eventsForDate(expandCalendarOccurrences(snapshot, today, today), today);
      break;
    case 'overdue':
      tasks = smartTasksFromSnapshot(snapshot, 'overdue', today);
      break;
    case 'nextThreeDays':
      tasks = smartTasksFromSnapshot(snapshot, 'nextThreeDays', today);
      break;
    case 'upcomingDeadlines':
      tasks = smartTasksFromSnapshot(snapshot, 'deadlines', today).filter(
        (task) => task.deadlineDate && task.deadlineDate >= today,
      );
      break;
    case 'unscheduled':
      tasks = smartTasksFromSnapshot(snapshot, 'unscheduled', today);
      break;
    case 'blockedTasks':
      tasks = smartTasksFromSnapshot(snapshot, 'blocked', today);
      break;
    case 'projectNextActions':
      projectNextActions = projectNextActionsFromSnapshot(snapshot);
      break;
    case 'recentlyCompleted':
      tasks = recentlyCompletedFromSnapshot(snapshot);
      break;
    case 'currentRoutine':
      currentRoutine = currentRoutineFromSnapshot(snapshot, today);
      break;
    case 'currentFocus':
      currentFocus = currentFocusFromSnapshot(snapshot, now);
      break;
    case 'reviews':
      break;
    case 'quickAdd':
      break;
  }
  return {
    tasks,
    projectNextActions,
    events,
    totalCount:
      currentRoutine || currentFocus
        ? 1
        : tasks.length + events.length || projectNextActions.length,
    currentRoutine,
    currentFocus,
  };
}

export function currentFocusFromSnapshot(
  snapshot: PlannerSnapshot,
  now: Date | string = new Date(),
): CurrentFocusData | undefined {
  const focus = snapshot.activeFocus;
  if (!focus) return undefined;
  const task = snapshot.tasks.find((candidate) => candidate.id === focus.taskId);
  if (!task || task.status === 'completed') return undefined;
  const timer = countdownView(focus, now);
  return {
    taskId: task.id,
    title: task.title,
    currentStep: currentIncompleteStep(snapshot, task.id)?.title,
    countdownState: timer.state,
    remainingSeconds: timer.remainingSeconds,
  };
}

export function currentRoutineFromSnapshot(
  snapshot: PlannerSnapshot,
  today: string,
): CurrentRoutineData | undefined {
  const inProgress = snapshot.routineRuns
    .filter((run) => run.localDate === today && run.status === 'inProgress')
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
  if (inProgress) {
    const progress = runProgress(inProgress, snapshot.routineRunItems);
    return {
      routineId: inProgress.routineId,
      runId: inProgress.id,
      name: inProgress.routineName,
      color: inProgress.routineColor,
      currentItem: progress.currentItem?.title,
      completed: progress.completed,
      total: progress.total,
      action: 'Continue',
    };
  }
  const runRoutineIds = new Set(
    snapshot.routineRuns.filter((run) => run.localDate === today).map((run) => run.routineId),
  );
  const next = routinesForDate(snapshot, today).find(
    ({ routine }) => !runRoutineIds.has(routine.id),
  );
  if (!next) return undefined;
  return {
    routineId: next.routine.id,
    name: next.routine.name,
    color: next.routine.color,
    currentItem: next.items[0]?.title,
    completed: 0,
    total: next.items.length,
    action: 'Start',
  };
}

export function dashboardTaskLimit(size: DashboardCardSize): number {
  return size === 'compact' ? 2 : size === 'standard' ? 3 : 5;
}

export function dashboardCardLink(type: DashboardCardType): string | undefined {
  const links: Partial<Record<DashboardCardType, string>> = {
    today: '/lists?smart=today',
    overdue: '/lists?smart=overdue',
    nextThreeDays: '/lists?smart=nextThreeDays',
    upcomingDeadlines: '/lists?smart=deadlines',
    unscheduled: '/lists?smart=unscheduled',
    blockedTasks: '/lists?smart=blocked',
    projectNextActions: '/lists',
    recentlyCompleted: '/lists?smart=completed',
    currentRoutine: '/routines',
    reviews: '/reviews',
  };
  return links[type];
}

export function dashboardEmptyMessage(type: DashboardCardType): string {
  const messages: Record<DashboardCardType, string> = {
    quickAdd: 'Capture a thought without leaving Home.',
    today: 'Nothing is planned for today.',
    overdue: 'No genuine deadlines are overdue.',
    nextThreeDays: 'The next three days are open.',
    upcomingDeadlines: 'No upcoming deadlines.',
    unscheduled: 'Every active task has planning intent.',
    blockedTasks: 'Nothing is blocked.',
    projectNextActions: 'No project has an available next action.',
    recentlyCompleted: 'Completed tasks will appear here.',
    currentRoutine: 'No routine is waiting for today.',
    currentFocus: 'No task is currently focused.',
    reviews: 'Reviews remain available whenever you want them.',
  };
  return messages[type];
}

export function dashboardSuggestions(
  snapshot: PlannerSnapshot,
  layout: DashboardLayoutRecord,
  today: string,
): DashboardSuggestion[] {
  const hidden = new Set(
    layout.cards.filter((cardConfig) => cardConfig.hidden).map((item) => item.type),
  );
  const dismissed = new Set(layout.dismissedSuggestions);
  const suggestions: DashboardSuggestion[] = [];
  if (
    hidden.has('overdue') &&
    !dismissed.has('addOverdue') &&
    smartTasksFromSnapshot(snapshot, 'overdue', today).length > 0
  ) {
    suggestions.push({
      type: 'addOverdue',
      cardType: 'overdue',
      message: 'You have overdue deadlines. Add the Overdue card if seeing them here would help.',
    });
  }
  if (
    hidden.has('projectNextActions') &&
    !dismissed.has('addProjectNextActions') &&
    projectNextActionsFromSnapshot(snapshot).length > 0
  ) {
    suggestions.push({
      type: 'addProjectNextActions',
      cardType: 'projectNextActions',
      message: 'An active project has a next action. You can add that card to Home.',
    });
  }
  if (
    hidden.has('currentRoutine') &&
    !dismissed.has('addCurrentRoutine') &&
    snapshot.routines.some((routine) => routine.isActive)
  ) {
    suggestions.push({
      type: 'addCurrentRoutine',
      cardType: 'currentRoutine',
      message: 'Active routines are available. You can add the Current Routine card to Home.',
    });
  }
  if (
    hidden.has('currentFocus') &&
    !dismissed.has('addCurrentFocus') &&
    snapshot.activeFocus !== undefined
  ) {
    suggestions.push({
      type: 'addCurrentFocus',
      cardType: 'currentFocus',
      message: 'A task is in focus. You can add the Current Focus card to Home.',
    });
  }
  return suggestions;
}

export function dashboardLayoutSort(
  left: DashboardLayoutRecord,
  right: DashboardLayoutRecord,
): number {
  const builtInOrder = Object.values(BUILT_IN_DASHBOARD_LAYOUT_IDS);
  const leftBuiltIn = builtInOrder.indexOf(left.id);
  const rightBuiltIn = builtInOrder.indexOf(right.id);
  if (leftBuiltIn >= 0 || rightBuiltIn >= 0) {
    if (leftBuiltIn < 0) return 1;
    if (rightBuiltIn < 0) return -1;
    return leftBuiltIn - rightBuiltIn;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name);
}

export { DASHBOARD_CARD_LABELS };
