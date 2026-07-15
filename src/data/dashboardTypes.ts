export const DASHBOARD_STARTER_DATA_VERSION = 1;

export const DASHBOARD_CARD_TYPES = [
  'quickAdd',
  'today',
  'overdue',
  'nextThreeDays',
  'upcomingDeadlines',
  'unscheduled',
  'blockedTasks',
  'projectNextActions',
  'recentlyCompleted',
] as const;

export type DashboardCardType = (typeof DASHBOARD_CARD_TYPES)[number];

export const DASHBOARD_CARD_SIZES = ['compact', 'standard', 'wide'] as const;

export type DashboardCardSize = (typeof DASHBOARD_CARD_SIZES)[number];

export type DashboardCardConfig = {
  type: DashboardCardType;
  size: DashboardCardSize;
  hidden: boolean;
  order: number;
};

export type BuiltInDashboardLayoutKey = 'overview' | 'focus' | 'planning';

export type DashboardSuggestionType = 'addOverdue' | 'addProjectNextActions';

export type DashboardLayoutRecord = {
  id: string;
  name: string;
  builtInKey?: BuiltInDashboardLayoutKey;
  cards: DashboardCardConfig[];
  isDefault: boolean;
  dismissedSuggestions: DashboardSuggestionType[];
  createdAt: string;
  modifiedAt: string;
};

export type DashboardState = {
  layouts: DashboardLayoutRecord[];
  activeLayoutId: string;
};

export const BUILT_IN_DASHBOARD_LAYOUT_IDS: Record<BuiltInDashboardLayoutKey, string> = {
  overview: '70000000-0000-4000-8000-000000000001',
  focus: '70000000-0000-4000-8000-000000000002',
  planning: '70000000-0000-4000-8000-000000000003',
};

type StarterDashboardLayout = Omit<
  DashboardLayoutRecord,
  'createdAt' | 'modifiedAt' | 'dismissedSuggestions'
>;

function card(
  type: DashboardCardType,
  size: DashboardCardSize,
  order: number,
  hidden = false,
): DashboardCardConfig {
  return { type, size, order, hidden };
}

export const STARTER_DASHBOARD_LAYOUTS: readonly StarterDashboardLayout[] = [
  {
    id: BUILT_IN_DASHBOARD_LAYOUT_IDS.overview,
    name: 'Overview',
    builtInKey: 'overview',
    isDefault: true,
    cards: [
      card('quickAdd', 'compact', 0),
      card('today', 'standard', 1),
      card('overdue', 'compact', 2),
      card('nextThreeDays', 'wide', 3),
      card('projectNextActions', 'standard', 4),
      card('upcomingDeadlines', 'standard', 5),
      card('unscheduled', 'standard', 6, true),
      card('blockedTasks', 'standard', 7, true),
      card('recentlyCompleted', 'compact', 8),
    ],
  },
  {
    id: BUILT_IN_DASHBOARD_LAYOUT_IDS.focus,
    name: 'Focus',
    builtInKey: 'focus',
    isDefault: false,
    cards: [
      card('quickAdd', 'compact', 0),
      card('today', 'wide', 1),
      card('blockedTasks', 'standard', 2),
      card('projectNextActions', 'wide', 3),
      card('overdue', 'standard', 4),
      card('recentlyCompleted', 'compact', 5),
      card('nextThreeDays', 'standard', 6, true),
      card('upcomingDeadlines', 'standard', 7, true),
      card('unscheduled', 'standard', 8, true),
    ],
  },
  {
    id: BUILT_IN_DASHBOARD_LAYOUT_IDS.planning,
    name: 'Planning',
    builtInKey: 'planning',
    isDefault: false,
    cards: [
      card('quickAdd', 'compact', 0),
      card('today', 'standard', 1),
      card('overdue', 'compact', 2),
      card('nextThreeDays', 'wide', 3),
      card('upcomingDeadlines', 'wide', 4),
      card('unscheduled', 'standard', 5),
      card('blockedTasks', 'standard', 6, true),
      card('projectNextActions', 'standard', 7, true),
      card('recentlyCompleted', 'compact', 8, true),
    ],
  },
] as const;

export const DASHBOARD_CARD_LABELS: Record<DashboardCardType, string> = {
  quickAdd: 'Quick Add',
  today: 'Today',
  overdue: 'Overdue',
  nextThreeDays: 'Next Three Days',
  upcomingDeadlines: 'Upcoming Deadlines',
  unscheduled: 'Unscheduled',
  blockedTasks: 'Blocked Tasks',
  projectNextActions: 'Project Next Actions',
  recentlyCompleted: 'Recently Completed',
};
