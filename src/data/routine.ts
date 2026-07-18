import { addCalendarDays, isLocalDate } from './planning';
import type {
  RoutineItemRecord,
  RoutineOccurrenceAdjustmentRecord,
  RoutinePresentationStyle,
  RoutineRecord,
  RoutineRunItemRecord,
  RoutineRunRecord,
  RoutineSnapshot,
  RoutineVariantRecord,
} from './routineTypes';

export const ROUTINE_REVIEW_LOOKBACK_DAYS = 366;

export type RoutineForDate = {
  routine: RoutineRecord;
  variant?: RoutineVariantRecord;
  items: RoutineItemRecord[];
  presentationStyle: RoutinePresentationStyle;
  movedFromDate?: string;
};

export type RoutineRunProgress = {
  completed: number;
  total: number;
  currentItem?: RoutineRunItemRecord;
};

export type PreviouslyScheduledRoutine = {
  routine: RoutineRecord;
  localDate: string;
};

export function weekdayForRoutineDate(localDate: string): number {
  if (!isLocalDate(localDate)) throw new Error('Routine date must use YYYY-MM-DD.');
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function routineScheduleMatches(routine: RoutineRecord, localDate: string): boolean {
  if (!routine.isActive || routine.deletedAt || !isLocalDate(localDate)) return false;
  const weekday = weekdayForRoutineDate(localDate);
  if (routine.scheduleKind === 'daily') return true;
  if (routine.scheduleKind === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (routine.scheduleKind === 'weekends') return weekday === 0 || weekday === 6;
  if (routine.scheduleKind === 'selected') return routine.selectedWeekdays.includes(weekday);
  return false;
}

export function routineVariantForDate(
  routineId: string,
  variants: readonly RoutineVariantRecord[],
  localDate: string,
): RoutineVariantRecord | undefined {
  const weekday = weekdayForRoutineDate(localDate);
  return variants
    .filter(
      (variant) =>
        variant.routineId === routineId && !variant.deletedAt && variant.weekdays.includes(weekday),
    )
    .sort((left, right) => left.order - right.order)[0];
}

export function routineItemsForDate(
  routine: RoutineRecord,
  items: readonly RoutineItemRecord[],
  variant?: RoutineVariantRecord,
): RoutineItemRecord[] {
  const active = items.filter(
    (item) => item.routineId === routine.id && item.isActive && !item.deletedAt,
  );
  if (!variant) return active.sort((left, right) => left.order - right.order);
  const byId = new Map(active.map((item) => [item.id, item]));
  return variant.itemIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function routinesForDate(snapshot: RoutineSnapshot, localDate: string): RoutineForDate[] {
  const movedIn = snapshot.routineOccurrenceAdjustments.filter(
    (adjustment) => adjustment.destinationDate === localDate,
  );
  const movedOut = new Set(
    snapshot.routineOccurrenceAdjustments
      .filter((adjustment) => adjustment.originalDate === localDate)
      .map((adjustment) => adjustment.routineId),
  );
  const movedFromByRoutine = new Map(movedIn.map((item) => [item.routineId, item.originalDate]));
  return snapshot.routines
    .filter(
      (routine) =>
        !routine.deletedAt &&
        routine.isActive &&
        ((routineScheduleMatches(routine, localDate) && !movedOut.has(routine.id)) ||
          movedFromByRoutine.has(routine.id)),
    )
    .sort((left, right) => left.order - right.order)
    .map((routine) => {
      const variant = routineVariantForDate(routine.id, snapshot.routineVariants, localDate);
      return {
        routine,
        variant,
        items: routineItemsForDate(routine, snapshot.routineItems, variant),
        presentationStyle: variant?.presentationStyle ?? routine.presentationStyle,
        movedFromDate: movedFromByRoutine.get(routine.id),
      };
    });
}

export function runProgress(
  run: RoutineRunRecord,
  runItems: readonly RoutineRunItemRecord[],
): RoutineRunProgress {
  const items = runItems
    .filter((item) => item.runId === run.id)
    .sort((left, right) => left.order - right.order);
  const completed = items.filter((item) => item.completedAt).length;
  return {
    completed,
    total: items.length,
    currentItem: items.find((item) => !item.completedAt) ?? items.at(-1),
  };
}

export function mostRecentPreviouslyScheduled(
  snapshot: RoutineSnapshot,
  today: string,
): PreviouslyScheduledRoutine[] {
  const runKeys = new Set(snapshot.routineRuns.map((run) => `${run.routineId}:${run.localDate}`));
  const adjustedKeys = new Set(
    snapshot.routineOccurrenceAdjustments.map(
      (adjustment) => `${adjustment.routineId}:${adjustment.originalDate}`,
    ),
  );
  return snapshot.routines
    .filter(
      (routine) => routine.isActive && !routine.deletedAt && routine.scheduleKind !== 'manual',
    )
    .sort((left, right) => left.order - right.order)
    .flatMap((routine) => {
      for (let offset = 1; offset <= ROUTINE_REVIEW_LOOKBACK_DAYS; offset += 1) {
        const date = addCalendarDays(today, -offset);
        if (
          routineScheduleMatches(routine, date) &&
          !runKeys.has(`${routine.id}:${date}`) &&
          !adjustedKeys.has(`${routine.id}:${date}`)
        ) {
          return [{ routine, localDate: date }];
        }
      }
      return [];
    });
}

export function isValidRoutineRecord(value: RoutineRecord): boolean {
  return (
    Boolean(value.id && value.name.trim() && value.color) &&
    Number.isInteger(value.order) &&
    value.order >= 0 &&
    ['checklist', 'stepByStep', 'compact'].includes(value.presentationStyle) &&
    ['manual', 'daily', 'weekdays', 'weekends', 'selected'].includes(value.scheduleKind) &&
    ['morning', 'afternoon', 'evening', 'anyTime'].includes(value.defaultSection) &&
    value.selectedWeekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );
}

export function isValidRoutineItemRecord(value: RoutineItemRecord): boolean {
  return Boolean(value.id && value.routineId && value.title.trim()) && value.order >= 0;
}

export function adjustmentForOriginalDate(
  adjustments: readonly RoutineOccurrenceAdjustmentRecord[],
  routineId: string,
  localDate: string,
): RoutineOccurrenceAdjustmentRecord | undefined {
  return adjustments.find(
    (adjustment) => adjustment.routineId === routineId && adjustment.originalDate === localDate,
  );
}
