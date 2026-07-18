export const STARTER_DATA_VERSION = 1;

export const INBOX_LIST_ID = '10000000-0000-4000-8000-000000000001';

export const STARTER_AREAS = [
  { id: '20000000-0000-4000-8000-000000000001', name: 'Personal', color: '#5B67C8' },
  { id: '20000000-0000-4000-8000-000000000002', name: 'Household', color: '#3D9F98' },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Coreframe', color: '#CE9138' },
  { id: '20000000-0000-4000-8000-000000000004', name: 'Projects', color: '#8C65B5' },
  { id: '20000000-0000-4000-8000-000000000005', name: 'Shopping', color: '#4C956C' },
] as const;

export const ENTITY_COLORS = [
  { value: '#5B67C8', label: 'Indigo' },
  { value: '#3D9F98', label: 'Teal' },
  { value: '#CE9138', label: 'Amber' },
  { value: '#8C65B5', label: 'Violet' },
  { value: '#4C956C', label: 'Green' },
  { value: '#CF5E62', label: 'Rose' },
] as const;

export type AreaRecord = {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type ListMode = 'standard' | 'project';

export type PlanListRecord = {
  id: string;
  areaId: string | null;
  name: string;
  color: string;
  order: number;
  systemType?: 'inbox';
  mode?: ListMode;
  projectOutcome?: string;
  projectTargetDate?: string;
  archivedAt?: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type TaskStatus = 'inbox' | 'available' | 'completed';

export type TaskTimeWindow = 'morning' | 'afternoon' | 'evening';

export type AgendaGroup = 'exact' | TaskTimeWindow | 'anyTime';

export type PlannedPlacementRecord = {
  id: string;
  taskId: string;
  localDate: string;
  group: AgendaGroup;
  order: number;
  source: 'plannedDate' | 'flexibleRange';
  createdAt: string;
  modifiedAt: string;
};

export type PlanningCapacityRecord = {
  id: string;
  kind: 'weekday' | 'date';
  weekday?: number;
  localDate?: string;
  minutes: number | null;
  createdAt: string;
  modifiedAt: string;
};

export const DEFAULT_CALENDAR_ID = '90000000-0000-4000-8000-000000000001';

export type CalendarRecord = {
  id: string;
  name: string;
  color: string;
  order: number;
  isVisible: boolean;
  isProtected?: boolean;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type CalendarEventRecord = {
  id: string;
  calendarId: string;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type RecurrenceFrequency =
  'daily' | 'weekdays' | 'weekly' | 'monthlyDay' | 'monthlyOrdinal' | 'yearly';

export type RecurrenceEndMode = 'never' | 'until' | 'count';

export type RecurrenceDefinition = {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: number[];
  monthDay?: number;
  ordinal?: 1 | 2 | 3 | 4 | -1;
  ordinalWeekday?: number;
  yearlyMonth?: number;
  yearlyDay?: number;
  endMode: RecurrenceEndMode;
  endDate?: string;
  occurrenceCount?: number;
};

export type RecurrenceRuleRecord = RecurrenceDefinition & {
  id: string;
  eventId: string;
  createdAt: string;
  modifiedAt: string;
};

export type RecurrenceExceptionRecord = {
  id: string;
  seriesEventId: string;
  originalStartDate: string;
  kind: 'cancelled' | 'override';
  calendarId?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  notes?: string | null;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type EventTemplateRecord = {
  id: string;
  name: string;
  title: string;
  calendarId?: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  suggestedDurationMinutes?: number;
  location?: string;
  notes?: string;
  recurrence?: RecurrenceDefinition;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type CalendarImportSourceRecord = {
  id: string;
  sourceLabel: string;
  lastFilename?: string;
  calendarName?: string;
  destinationCalendarId?: string;
  importedRecordCount: number;
  hasLocalChanges: boolean;
  createdAt: string;
  lastImportedAt: string;
};

export type CalendarImportBatchRecord = {
  id: string;
  sourceId: string;
  filename?: string;
  calendarName?: string;
  destinationCalendarId: string;
  importedAt: string;
  validEventCount: number;
  recurringSeriesCount: number;
  newCount: number;
  unchangedCount: number;
  updatedCount: number;
  conflictCount: number;
  cancelledCount: number;
  skippedCount: number;
  warningCount: number;
};

export type ExternalEventMappingRecord = {
  id: string;
  sourceId: string;
  externalUid: string;
  recurrenceKey: string;
  targetKind: 'event' | 'exception';
  eventId: string;
  exceptionId?: string;
  sourceFingerprint: string;
  planiblyModifiedAtAtImport: string;
  sequence?: number;
  externalLastModified?: string;
  sourceTimezone?: string;
  importedAt: string;
  lastImportedAt: string;
};

export type CalendarOccurrence = CalendarEventRecord & {
  sourceEventId: string;
  originalStartDate: string;
  isRecurring: boolean;
  recurrenceRuleId?: string;
  exceptionId?: string;
};

export type TaskPlanning = {
  plannedDate?: string;
  deadlineDate?: string;
  flexibleStartDate?: string;
  flexibleEndDate?: string;
  timeWindow?: TaskTimeWindow;
  exactStartTime?: string;
  estimatedDurationMinutes?: number;
};

export type TaskRecord = TaskPlanning & {
  id: string;
  title: string;
  listId: string;
  status: TaskStatus;
  order: number;
  createdAt: string;
  modifiedAt: string;
  completedAt?: string;
  completedClearedAt?: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type TaskStepRecord = {
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

export type TagRecord = {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type TaskTagRecord = {
  id: string;
  taskId: string;
  tagId: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type TaskRelationshipRecord = {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
  deletionGroupId?: string;
};

export type DeletionEntityKind =
  'area' | 'list' | 'task' | 'step' | 'calendar' | 'event' | 'occurrence' | 'template';

export type DeletionReceipt = {
  groupId: string;
  kind: DeletionEntityKind;
  entityId: string;
  label: string;
  deletedAt: string;
  operation?: 'delete' | 'archive';
  undoMessage?: string;
  movedListIds?: string[];
  movedEventIds?: string[];
  movedExceptionIds?: string[];
  calendarUndo?: {
    createdExceptionId?: string;
    previousRule?: RecurrenceRuleRecord;
    removedExceptions?: RecurrenceExceptionRecord[];
  };
};

export type ProjectProgress = {
  listId: string;
  completedCount: number;
  totalCount: number;
  nextActionId?: string;
  allRemainingBlocked: boolean;
};

export type SearchResultType = 'area' | 'list' | 'task' | 'step' | 'tag';

export type SearchFilters = {
  types: SearchResultType[];
  includeCompleted: boolean;
  includeArchived: boolean;
};

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  location: string;
  url: string;
  completed?: boolean;
  archived?: boolean;
};

export type SmartListKey =
  | 'inbox'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'today'
  | 'nextThreeDays'
  | 'upcoming'
  | 'deadlines'
  | 'overdue'
  | 'unscheduled'
  | 'recentlyDeleted';

export type PlanningOverview = {
  today: TaskRecord[];
  nextThreeDays: TaskRecord[];
  flexible: TaskRecord[];
  upcomingDeadlines: TaskRecord[];
  unscheduled: TaskRecord[];
};

export type PlannerSnapshot = {
  areas: AreaRecord[];
  lists: PlanListRecord[];
  archivedProjects: PlanListRecord[];
  tasks: TaskRecord[];
  taskSteps: TaskStepRecord[];
  tags: TagRecord[];
  taskTags: TaskTagRecord[];
  taskRelationships: TaskRelationshipRecord[];
  plannedPlacements: PlannedPlacementRecord[];
  calendars: CalendarRecord[];
  calendarEvents: CalendarEventRecord[];
  recurrenceRules: RecurrenceRuleRecord[];
  recurrenceExceptions: RecurrenceExceptionRecord[];
  eventTemplates: EventTemplateRecord[];
  blockedByTaskId: Record<string, string[]>;
  projectProgressByListId: Record<string, ProjectProgress>;
  deletedAreas: AreaRecord[];
  deletedLists: PlanListRecord[];
  deletedTasks: TaskRecord[];
  deletedSteps: TaskStepRecord[];
  deletedCalendars: CalendarRecord[];
  deletedCalendarEvents: CalendarEventRecord[];
  deletedEventTemplates: EventTemplateRecord[];
};
