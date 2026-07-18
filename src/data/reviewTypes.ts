export const REVIEW_PREFERENCES_ID = 'e0000000-0000-4000-8000-000000000001';

export const REVIEW_TYPES = ['morning', 'evening', 'weekAhead'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export type ReviewSectionKey =
  | 'calendar'
  | 'plannedTasks'
  | 'deadlines'
  | 'previouslyPlanned'
  | 'routines'
  | 'focus'
  | 'capacity'
  | 'withoutDuration'
  | 'projectNextActions'
  | 'completed';

export type ReviewPreferencesRecord = {
  id: typeof REVIEW_PREFERENCES_ID;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  weekAheadEnabled: boolean;
  morningTime: string;
  eveningTime: string;
  weekAheadWeekday: number;
  weekAheadTime: string;
  showOnHome: boolean;
  showCompletedSummary: boolean;
  visibleSections: Record<ReviewSectionKey, boolean>;
  expandedSections: Record<ReviewSectionKey, boolean>;
  createdAt: string;
  modifiedAt: string;
};

export type AppliedActionSummary = {
  movedTaskCount: number;
  unplannedTaskCount: number;
  unchangedTaskCount: number;
  appliedAt: string;
};

export type ReviewRecord = {
  id: string;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  startedAt: string;
  finishedAt?: string;
  modifiedAt: string;
  appliedActionSummary?: AppliedActionSummary;
  version: 1;
};

export type ReviewTaskActionKind = 'move' | 'remove' | 'leave';

export type ReviewTaskAction = {
  taskId: string;
  kind: ReviewTaskActionKind;
  targetDate?: string;
};

export type ReviewActionPreviewItem = {
  taskId: string;
  title: string;
  currentDate?: string;
  proposedDate?: string;
  kind: ReviewTaskActionKind;
  valid: boolean;
  unchanged: boolean;
  blocked: boolean;
  reason?: string;
  estimatedDurationMinutes?: number;
};

export type ReviewCapacityImpact = {
  localDate: string;
  availableMinutes: number | null;
  beforeMinutes: number;
  afterMinutes: number;
  overMinutes: number;
};

export type ReviewActionPreview = {
  items: ReviewActionPreviewItem[];
  capacity: ReviewCapacityImpact[];
  canApply: boolean;
};

export const REVIEW_LABELS: Record<ReviewType, string> = {
  morning: 'Morning Summary',
  evening: 'Evening Review',
  weekAhead: 'Week Ahead',
};
