export const TASK_WHY_MAX_LENGTH = 1_000;
export const PREP_ITEM_TITLE_MAX_LENGTH = 200;
export const COUNTDOWN_MINUTES_MIN = 1;
export const COUNTDOWN_MINUTES_MAX = 1_440;
export const ACTIVE_FOCUS_ID = 'd0000000-0000-4000-8000-000000000001';

export const TASK_START_STYLES = ['gentle', 'oneThing', 'full'] as const;

export type TaskStartStyle = (typeof TASK_START_STYLES)[number];

export type TaskStartingDetailsRecord = {
  id: string;
  taskId: string;
  whyItMatters?: string;
  preferredStartStyle?: TaskStartStyle;
  defaultCountdownMinutes?: number;
  createdAt: string;
  modifiedAt: string;
};

export type TaskStartingDetailsInput = {
  whyItMatters?: string;
  preferredStartStyle?: TaskStartStyle;
  defaultCountdownMinutes?: number;
};

export type TaskPrepItemRecord = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type CountdownSource = 'none' | 'estimated' | 'saved' | 'custom';
export type StoredCountdownState = 'idle' | 'running' | 'paused';

export type ActiveFocusRecord = {
  id: typeof ACTIVE_FOCUS_ID;
  taskId: string;
  startStyle: TaskStartStyle;
  startedAt: string;
  fullDetailsRevealed: boolean;
  countdownSource: CountdownSource;
  countdownDurationSeconds?: number;
  countdownState: StoredCountdownState;
  countdownEndsAt?: string;
  countdownRemainingSeconds?: number;
  createdAt: string;
  modifiedAt: string;
};

export type CountdownViewState = 'none' | 'idle' | 'running' | 'paused' | 'finished';

export type CountdownView = {
  state: CountdownViewState;
  remainingSeconds: number;
  durationSeconds?: number;
};
