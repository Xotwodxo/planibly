import Dexie, { type EntityTable, type Transaction } from 'dexie';

import {
  BUILT_IN_DASHBOARD_LAYOUT_IDS,
  DASHBOARD_STARTER_DATA_VERSION,
  STARTER_DASHBOARD_LAYOUTS,
  type DashboardLayoutRecord,
} from './dashboardTypes';
import {
  INBOX_LIST_ID,
  DEFAULT_CALENDAR_ID,
  STARTER_AREAS,
  STARTER_DATA_VERSION,
  type AreaRecord,
  type AgendaGroup,
  type PlanListRecord,
  type PlannedPlacementRecord,
  type PlanningCapacityRecord,
  type CalendarRecord,
  type CalendarEventRecord,
  type CalendarImportBatchRecord,
  type CalendarImportSourceRecord,
  type EventTemplateRecord,
  type ExternalEventMappingRecord,
  type RecurrenceExceptionRecord,
  type RecurrenceRuleRecord,
  type TagRecord,
  type TaskRecord,
  type TaskRelationshipRecord,
  type TaskStepRecord,
  type TaskTagRecord,
} from './plannerTypes';
import type {
  RoutineItemRecord,
  RoutineOccurrenceAdjustmentRecord,
  RoutineRecord,
  RoutineRunItemRecord,
  RoutineRunRecord,
  RoutineVariantRecord,
} from './routineTypes';
import type {
  ActiveFocusRecord,
  TaskPrepItemRecord,
  TaskStartingDetailsRecord,
} from './focusTypes';
import { isValidActiveFocusRecord } from './focus';
import { ACTIVE_FOCUS_ID } from './focusTypes';

export const DATABASE_NAME = 'planibly';
export const DATABASE_SCHEMA_VERSION = 13;

export type MetadataRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

export type DiagnosticRecord = {
  id: string;
  level: 'info' | 'warning' | 'error';
  event: string;
  message: string;
  context?: string;
  createdAt: string;
};

type SchemaVersion = {
  version: number;
  stores: Record<string, string>;
  migrate?: (transaction: Transaction) => Promise<void>;
};

// Add each future schema exactly once. Upgrade functions must be deterministic and local-only.
export const schemaVersions: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
    },
  },
  {
    version: 2,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks: '&id, listId, [listId+order], status, createdAt, modifiedAt, deletedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '2',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 3,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '3',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 4,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt',
      lists: '&id, areaId, [areaId+order], systemType, createdAt, modifiedAt, deletedAt',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags: '&id, taskId, tagId, &[taskId+tagId], createdAt',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '4',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 5,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const lists = transaction.table<PlanListRecord>('lists');
      const taskTags = transaction.table<TaskTagRecord>('taskTags');
      const current = await metadata.get('schemaVersion');
      await lists.toCollection().modify((list) => {
        if (list.systemType !== 'inbox' && list.mode === undefined) list.mode = 'standard';
      });
      await taskTags.toCollection().modify((assignment) => {
        assignment.modifiedAt = assignment.modifiedAt ?? assignment.createdAt;
      });
      await metadata.put({
        key: 'schemaVersion',
        value: '5',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 6,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '6',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 7,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const tasks = transaction.table<TaskRecord>('tasks');
      const current = await metadata.get('schemaVersion');
      await tasks
        .filter((task) => task.status === 'completed' && task.completedAt === undefined)
        .modify((task) => {
          task.completedAt = task.modifiedAt;
        });
      await metadata.put({
        key: 'schemaVersion',
        value: '7',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 8,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const tasks = transaction.table<TaskRecord>('tasks');
      const placements = transaction.table<PlannedPlacementRecord>('plannedPlacements');
      const current = await metadata.get('schemaVersion');
      const plannedTasks = (await tasks.toArray())
        .filter((task) => task.plannedDate !== undefined)
        .sort((left, right) => {
          const date = left.plannedDate!.localeCompare(right.plannedDate!);
          if (date !== 0) return date;
          const group = migrationAgendaGroup(left).localeCompare(migrationAgendaGroup(right));
          if (group !== 0) return group;
          const time = (left.exactStartTime ?? '').localeCompare(right.exactStartTime ?? '');
          return time || left.order - right.order || left.id.localeCompare(right.id);
        });
      const nextOrder = new Map<string, number>();
      const records = plannedTasks.map((task) => {
        const group = migrationAgendaGroup(task);
        const key = `${task.plannedDate!}|${group}`;
        const order = nextOrder.get(key) ?? 0;
        nextOrder.set(key, order + 1);
        return {
          id: task.id,
          taskId: task.id,
          localDate: task.plannedDate!,
          group,
          order,
          source: 'plannedDate' as const,
          createdAt: task.createdAt,
          modifiedAt: task.modifiedAt,
        };
      });
      if (records.length > 0) await placements.bulkAdd(records);
      await metadata.put({
        key: 'schemaVersion',
        value: '8',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 9,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
      calendars: '&id, order, isVisible, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarEvents:
        '&id, calendarId, startDate, endDate, [calendarId+startDate], deletedAt, deletionGroupId, modifiedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '9',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 10,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
      calendars: '&id, order, isVisible, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarEvents:
        '&id, calendarId, startDate, endDate, [calendarId+startDate], deletedAt, deletionGroupId, modifiedAt',
      recurrenceRules: '&id, &eventId, frequency, modifiedAt',
      recurrenceExceptions:
        '&id, seriesEventId, originalStartDate, &[seriesEventId+originalStartDate], kind, deletedAt, deletionGroupId, modifiedAt',
      eventTemplates: '&id, order, calendarId, createdAt, modifiedAt, deletedAt, deletionGroupId',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '10',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 11,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
      calendars: '&id, order, isVisible, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarEvents:
        '&id, calendarId, startDate, endDate, [calendarId+startDate], deletedAt, deletionGroupId, modifiedAt',
      recurrenceRules: '&id, &eventId, frequency, modifiedAt',
      recurrenceExceptions:
        '&id, seriesEventId, originalStartDate, &[seriesEventId+originalStartDate], kind, deletedAt, deletionGroupId, modifiedAt',
      eventTemplates: '&id, order, calendarId, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarImportSources: '&id, lastImportedAt, destinationCalendarId',
      calendarImportBatches: '&id, sourceId, importedAt, destinationCalendarId',
      externalEventMappings:
        '&id, sourceId, externalUid, recurrenceKey, &[sourceId+externalUid+recurrenceKey], eventId, exceptionId, lastImportedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '11',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 12,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
      calendars: '&id, order, isVisible, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarEvents:
        '&id, calendarId, startDate, endDate, [calendarId+startDate], deletedAt, deletionGroupId, modifiedAt',
      recurrenceRules: '&id, &eventId, frequency, modifiedAt',
      recurrenceExceptions:
        '&id, seriesEventId, originalStartDate, &[seriesEventId+originalStartDate], kind, deletedAt, deletionGroupId, modifiedAt',
      eventTemplates: '&id, order, calendarId, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarImportSources: '&id, lastImportedAt, destinationCalendarId',
      calendarImportBatches: '&id, sourceId, importedAt, destinationCalendarId',
      externalEventMappings:
        '&id, sourceId, externalUid, recurrenceKey, &[sourceId+externalUid+recurrenceKey], eventId, exceptionId, lastImportedAt',
      routines:
        '&id, order, isActive, scheduleKind, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineItems:
        '&id, routineId, [routineId+order], isActive, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineVariants:
        '&id, routineId, [routineId+order], *weekdays, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineRuns:
        '&id, routineId, localDate, &[routineId+localDate], status, startedAt, completedAt, skippedAt, modifiedAt',
      routineRunItems: '&id, runId, [runId+order], completedAt, modifiedAt',
      routineOccurrenceAdjustments:
        '&id, routineId, originalDate, destinationDate, &[routineId+originalDate], modifiedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '12',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
  {
    version: 13,
    stores: {
      metadata: '&key, updatedAt',
      diagnostics: '&id, level, event, createdAt',
      areas: '&id, order, createdAt, modifiedAt, deletedAt, deletionGroupId',
      lists:
        '&id, areaId, [areaId+order], systemType, mode, archivedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      tasks:
        '&id, listId, [listId+order], status, plannedDate, deadlineDate, flexibleStartDate, flexibleEndDate, completedAt, completedClearedAt, createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskSteps: '&id, taskId, [taskId+order], createdAt, modifiedAt, deletedAt, deletionGroupId',
      tags: '&id, normalizedName, createdAt, modifiedAt, deletedAt',
      taskTags:
        '&id, taskId, tagId, &[taskId+tagId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      taskRelationships:
        '&id, predecessorTaskId, successorTaskId, [predecessorTaskId+successorTaskId], createdAt, modifiedAt, deletedAt, deletionGroupId',
      dashboardLayouts: '&id, builtInKey, isDefault, createdAt, modifiedAt',
      plannedPlacements: '&id, &taskId, [localDate+group+order], localDate, group, modifiedAt',
      planningCapacities: '&id, kind, weekday, localDate, modifiedAt',
      calendars: '&id, order, isVisible, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarEvents:
        '&id, calendarId, startDate, endDate, [calendarId+startDate], deletedAt, deletionGroupId, modifiedAt',
      recurrenceRules: '&id, &eventId, frequency, modifiedAt',
      recurrenceExceptions:
        '&id, seriesEventId, originalStartDate, &[seriesEventId+originalStartDate], kind, deletedAt, deletionGroupId, modifiedAt',
      eventTemplates: '&id, order, calendarId, createdAt, modifiedAt, deletedAt, deletionGroupId',
      calendarImportSources: '&id, lastImportedAt, destinationCalendarId',
      calendarImportBatches: '&id, sourceId, importedAt, destinationCalendarId',
      externalEventMappings:
        '&id, sourceId, externalUid, recurrenceKey, &[sourceId+externalUid+recurrenceKey], eventId, exceptionId, lastImportedAt',
      routines:
        '&id, order, isActive, scheduleKind, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineItems:
        '&id, routineId, [routineId+order], isActive, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineVariants:
        '&id, routineId, [routineId+order], *weekdays, createdAt, modifiedAt, deletedAt, deletionGroupId',
      routineRuns:
        '&id, routineId, localDate, &[routineId+localDate], status, startedAt, completedAt, skippedAt, modifiedAt',
      routineRunItems: '&id, runId, [runId+order], completedAt, modifiedAt',
      routineOccurrenceAdjustments:
        '&id, routineId, originalDate, destinationDate, &[routineId+originalDate], modifiedAt',
      taskStartingDetails: '&id, &taskId, modifiedAt',
      taskPrepItems:
        '&id, taskId, [taskId+order], completed, modifiedAt, deletedAt, deletionGroupId',
      activeFocus: '&id, &taskId, modifiedAt',
    },
    migrate: async (transaction) => {
      const metadata = transaction.table<MetadataRecord>('metadata');
      const current = await metadata.get('schemaVersion');
      await metadata.put({
        key: 'schemaVersion',
        value: '13',
        updatedAt: current?.updatedAt ?? new Date(0).toISOString(),
      });
    },
  },
];

function migrationAgendaGroup(task: TaskRecord): AgendaGroup {
  if (task.exactStartTime) return 'exact';
  return task.timeWindow ?? 'anyTime';
}

export class PlaniblyDatabase extends Dexie {
  metadata!: EntityTable<MetadataRecord, 'key'>;
  diagnostics!: EntityTable<DiagnosticRecord, 'id'>;
  areas!: EntityTable<AreaRecord, 'id'>;
  lists!: EntityTable<PlanListRecord, 'id'>;
  tasks!: EntityTable<TaskRecord, 'id'>;
  taskSteps!: EntityTable<TaskStepRecord, 'id'>;
  tags!: EntityTable<TagRecord, 'id'>;
  taskTags!: EntityTable<TaskTagRecord, 'id'>;
  taskRelationships!: EntityTable<TaskRelationshipRecord, 'id'>;
  dashboardLayouts!: EntityTable<DashboardLayoutRecord, 'id'>;
  plannedPlacements!: EntityTable<PlannedPlacementRecord, 'id'>;
  planningCapacities!: EntityTable<PlanningCapacityRecord, 'id'>;
  calendars!: EntityTable<CalendarRecord, 'id'>;
  calendarEvents!: EntityTable<CalendarEventRecord, 'id'>;
  recurrenceRules!: EntityTable<RecurrenceRuleRecord, 'id'>;
  recurrenceExceptions!: EntityTable<RecurrenceExceptionRecord, 'id'>;
  eventTemplates!: EntityTable<EventTemplateRecord, 'id'>;
  calendarImportSources!: EntityTable<CalendarImportSourceRecord, 'id'>;
  calendarImportBatches!: EntityTable<CalendarImportBatchRecord, 'id'>;
  externalEventMappings!: EntityTable<ExternalEventMappingRecord, 'id'>;
  routines!: EntityTable<RoutineRecord, 'id'>;
  routineItems!: EntityTable<RoutineItemRecord, 'id'>;
  routineVariants!: EntityTable<RoutineVariantRecord, 'id'>;
  routineRuns!: EntityTable<RoutineRunRecord, 'id'>;
  routineRunItems!: EntityTable<RoutineRunItemRecord, 'id'>;
  routineOccurrenceAdjustments!: EntityTable<RoutineOccurrenceAdjustmentRecord, 'id'>;
  taskStartingDetails!: EntityTable<TaskStartingDetailsRecord, 'id'>;
  taskPrepItems!: EntityTable<TaskPrepItemRecord, 'id'>;
  activeFocus!: EntityTable<ActiveFocusRecord, 'id'>;

  public constructor(name = DATABASE_NAME) {
    super(name);

    for (const schema of schemaVersions) {
      const version = this.version(schema.version).stores(schema.stores);
      if (schema.migrate) {
        version.upgrade(schema.migrate);
      }
    }
  }
}

export const database = new PlaniblyDatabase();

export async function initializeStarterData(db: PlaniblyDatabase = database): Promise<void> {
  await db.transaction('rw', db.metadata, db.areas, db.lists, async () => {
    const marker = await db.metadata.get('starterDataVersion');
    if (Number(marker?.value ?? 0) >= STARTER_DATA_VERSION) return;

    const now = new Date().toISOString();
    await db.areas.bulkAdd(
      STARTER_AREAS.map((area, order) => ({
        ...area,
        order,
        createdAt: now,
        modifiedAt: now,
      })),
    );
    await db.lists.add({
      id: INBOX_LIST_ID,
      areaId: null,
      name: 'Inbox',
      color: '#5B67C8',
      order: 0,
      systemType: 'inbox',
      createdAt: now,
      modifiedAt: now,
    });
    await db.metadata.put({
      key: 'starterDataVersion',
      value: String(STARTER_DATA_VERSION),
      updatedAt: now,
    });
  });
}

export async function initializeDashboardStarterData(
  db: PlaniblyDatabase = database,
): Promise<void> {
  await db.transaction('rw', db.metadata, db.dashboardLayouts, async () => {
    const marker = await db.metadata.get('dashboardStarterDataVersion');
    if (Number(marker?.value ?? 0) >= DASHBOARD_STARTER_DATA_VERSION) return;

    const now = new Date().toISOString();
    const existing = await db.dashboardLayouts.toArray();
    const existingIds = new Set(existing.map((layout) => layout.id));
    const hasDefault = existing.some((layout) => layout.isDefault);
    const starterRecords = STARTER_DASHBOARD_LAYOUTS.filter(
      (layout) => !existingIds.has(layout.id),
    ).map((layout) => ({
      ...layout,
      cards: layout.cards.map((cardConfig) => ({ ...cardConfig })),
      isDefault: hasDefault ? false : layout.isDefault,
      dismissedSuggestions: [],
      createdAt: now,
      modifiedAt: now,
    }));
    if (starterRecords.length > 0) await db.dashboardLayouts.bulkAdd(starterRecords);

    const activeLayout = await db.metadata.get('dashboardActiveLayoutId');
    if (!activeLayout) {
      const overviewExists =
        existingIds.has(BUILT_IN_DASHBOARD_LAYOUT_IDS.overview) ||
        starterRecords.some((layout) => layout.id === BUILT_IN_DASHBOARD_LAYOUT_IDS.overview);
      const fallbackId = overviewExists
        ? BUILT_IN_DASHBOARD_LAYOUT_IDS.overview
        : (existing[0]?.id ?? starterRecords[0]?.id);
      if (fallbackId) {
        await db.metadata.put({
          key: 'dashboardActiveLayoutId',
          value: fallbackId,
          updatedAt: now,
        });
      }
    }
    await db.metadata.put({
      key: 'dashboardStarterDataVersion',
      value: String(DASHBOARD_STARTER_DATA_VERSION),
      updatedAt: now,
    });
  });
}

export async function initializeDatabase(db: PlaniblyDatabase = database): Promise<void> {
  await db.open();
  const now = new Date().toISOString();
  await db.metadata.bulkPut([
    { key: 'schemaVersion', value: String(DATABASE_SCHEMA_VERSION), updatedAt: now },
    { key: 'applicationName', value: 'Planibly', updatedAt: now },
  ]);
  await initializeStarterData(db);
  await initializeDashboardStarterData(db);
  await initializeCalendarStarterData(db);
  await repairActiveFocusState(db);
}

export async function repairActiveFocusState(db: PlaniblyDatabase = database): Promise<void> {
  await db.transaction('rw', db.activeFocus, db.tasks, db.lists, async () => {
    const records = await db.activeFocus.toArray();
    const candidate = records.find((record) => record.id === ACTIVE_FOCUS_ID);
    const task = candidate ? await db.tasks.get(candidate.taskId) : undefined;
    const list = task ? await db.lists.get(task.listId) : undefined;
    const valid = Boolean(
      candidate &&
      isValidActiveFocusRecord(candidate) &&
      task &&
      task.deletedAt === undefined &&
      task.status !== 'completed' &&
      list &&
      list.deletedAt === undefined &&
      list.archivedAt === undefined,
    );
    if (records.length !== (valid ? 1 : 0) || (valid && records[0]?.id !== ACTIVE_FOCUS_ID)) {
      await db.activeFocus.clear();
      if (valid && candidate) await db.activeFocus.add(candidate);
    }
  });
}

export async function initializeCalendarStarterData(
  db: PlaniblyDatabase = database,
): Promise<void> {
  await db.transaction('rw', db.metadata, db.calendars, async () => {
    const marker = await db.metadata.get('calendarStarterDataVersion');
    if (marker) return;
    const now = new Date().toISOString();
    if (!(await db.calendars.get(DEFAULT_CALENDAR_ID))) {
      await db.calendars.add({
        id: DEFAULT_CALENDAR_ID,
        name: 'Personal',
        color: '#5B67C8',
        order: 0,
        isVisible: true,
        isProtected: true,
        createdAt: now,
        modifiedAt: now,
      });
    }
    await db.metadata.put({ key: 'calendarStarterDataVersion', value: '1', updatedAt: now });
  });
}
