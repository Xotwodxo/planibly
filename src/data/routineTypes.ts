export const ROUTINE_PRESENTATION_STYLES = ['checklist', 'stepByStep', 'compact'] as const;
export type RoutinePresentationStyle = (typeof ROUTINE_PRESENTATION_STYLES)[number];

export const ROUTINE_SECTIONS = ['morning', 'afternoon', 'evening', 'anyTime'] as const;
export type RoutineSection = (typeof ROUTINE_SECTIONS)[number];

export const ROUTINE_SCHEDULE_KINDS = [
  'manual',
  'daily',
  'weekdays',
  'weekends',
  'selected',
] as const;
export type RoutineScheduleKind = (typeof ROUTINE_SCHEDULE_KINDS)[number];

export type RoutineRecord = {
  id: string;
  name: string;
  color: string;
  description?: string;
  isActive: boolean;
  expectedDurationMinutes?: number;
  presentationStyle: RoutinePresentationStyle;
  scheduleKind: RoutineScheduleKind;
  selectedWeekdays: number[];
  defaultSection: RoutineSection;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type RoutineItemRecord = {
  id: string;
  routineId: string;
  title: string;
  estimatedDurationMinutes?: number;
  note?: string;
  order: number;
  isActive: boolean;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type RoutineVariantRecord = {
  id: string;
  routineId: string;
  name: string;
  weekdays: number[];
  itemIds: string[];
  presentationStyle?: RoutinePresentationStyle;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type RoutineRunStatus = 'inProgress' | 'completed' | 'skipped';

export type RoutineRunRecord = {
  id: string;
  routineId: string;
  routineName: string;
  routineColor: string;
  localDate: string;
  variantId?: string;
  variantName?: string;
  presentationStyle: RoutinePresentationStyle;
  status: RoutineRunStatus;
  startedAt: string;
  completedAt?: string;
  skippedAt?: string;
  skipReason?: string;
  modifiedAt: string;
};

export type RoutineRunItemRecord = {
  id: string;
  runId: string;
  sourceRoutineItemId?: string;
  title: string;
  estimatedDurationMinutes?: number;
  note?: string;
  order: number;
  completedAt?: string;
  createdAt: string;
  modifiedAt: string;
};

export type RoutineOccurrenceAdjustmentRecord = {
  id: string;
  routineId: string;
  originalDate: string;
  destinationDate: string;
  createdAt: string;
  modifiedAt: string;
};

export type RoutineSnapshot = {
  routines: RoutineRecord[];
  routineItems: RoutineItemRecord[];
  routineVariants: RoutineVariantRecord[];
  routineRuns: RoutineRunRecord[];
  routineRunItems: RoutineRunItemRecord[];
  routineOccurrenceAdjustments: RoutineOccurrenceAdjustmentRecord[];
  deletedRoutines: RoutineRecord[];
  deletedRoutineItems: RoutineItemRecord[];
};

export type RoutineItemInput = Pick<
  RoutineItemRecord,
  'id' | 'title' | 'estimatedDurationMinutes' | 'note' | 'order' | 'isActive'
>;

export type RoutineVariantInput = Pick<
  RoutineVariantRecord,
  'id' | 'name' | 'weekdays' | 'itemIds' | 'presentationStyle' | 'order'
>;

export type RoutineInput = Pick<
  RoutineRecord,
  | 'name'
  | 'color'
  | 'description'
  | 'isActive'
  | 'expectedDurationMinutes'
  | 'presentationStyle'
  | 'scheduleKind'
  | 'selectedWeekdays'
  | 'defaultSection'
> & {
  items: RoutineItemInput[];
  variants: RoutineVariantInput[];
};

export const ROUTINE_STYLE_LABELS: Record<RoutinePresentationStyle, string> = {
  checklist: 'Checklist',
  stepByStep: 'Step by Step',
  compact: 'Compact',
};

export const ROUTINE_SECTION_LABELS: Record<RoutineSection, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anyTime: 'Any Time',
};

export const ROUTINE_SCHEDULE_LABELS: Record<RoutineScheduleKind, string> = {
  manual: 'Manual only',
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
  selected: 'Selected weekdays',
};
