import type { PlannerSnapshot, TaskStepRecord } from './plannerTypes';
import {
  ACTIVE_FOCUS_ID,
  COUNTDOWN_MINUTES_MAX,
  COUNTDOWN_MINUTES_MIN,
  PREP_ITEM_TITLE_MAX_LENGTH,
  TASK_START_STYLES,
  TASK_WHY_MAX_LENGTH,
  type ActiveFocusRecord,
  type CountdownView,
  type TaskStartingDetailsInput,
  type TaskStartingDetailsRecord,
  type TaskStartStyle,
} from './focusTypes';

export function validateTaskStartStyle(value: unknown): value is TaskStartStyle {
  return typeof value === 'string' && TASK_START_STYLES.includes(value as TaskStartStyle);
}

export function validateCountdownMinutes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < COUNTDOWN_MINUTES_MIN || value > COUNTDOWN_MINUTES_MAX) {
    throw new Error(
      `Countdown duration must be a whole number from ${COUNTDOWN_MINUTES_MIN} to ${COUNTDOWN_MINUTES_MAX} minutes.`,
    );
  }
  return value;
}

export function normalizeStartingDetails(
  input: TaskStartingDetailsInput,
): TaskStartingDetailsInput {
  const whyItMatters = input.whyItMatters?.trim();
  if (whyItMatters && whyItMatters.length > TASK_WHY_MAX_LENGTH) {
    throw new Error(`Why this matters must be ${TASK_WHY_MAX_LENGTH} characters or fewer.`);
  }
  if (input.preferredStartStyle && !validateTaskStartStyle(input.preferredStartStyle)) {
    throw new Error('Choose a valid start style.');
  }
  return {
    whyItMatters: whyItMatters?.length ? whyItMatters : undefined,
    preferredStartStyle: input.preferredStartStyle,
    defaultCountdownMinutes: validateCountdownMinutes(input.defaultCountdownMinutes),
  };
}

export function hasStartingDetails(input: TaskStartingDetailsInput): boolean {
  return Boolean(input.whyItMatters ?? input.preferredStartStyle ?? input.defaultCountdownMinutes);
}

export function validatePrepItemTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error('Prep item title is required.');
  if (title.length > PREP_ITEM_TITLE_MAX_LENGTH) {
    throw new Error(`Prep item title must be ${PREP_ITEM_TITLE_MAX_LENGTH} characters or fewer.`);
  }
  return title;
}

export function isValidStartingDetailsRecord(record: TaskStartingDetailsRecord): boolean {
  try {
    const normalized = normalizeStartingDetails(record);
    return hasStartingDetails(normalized);
  } catch {
    return false;
  }
}

export function isValidActiveFocusRecord(record: ActiveFocusRecord): boolean {
  if (
    record.id !== ACTIVE_FOCUS_ID ||
    !record.taskId ||
    !validateTaskStartStyle(record.startStyle) ||
    typeof record.fullDetailsRevealed !== 'boolean' ||
    !['none', 'estimated', 'saved', 'custom'].includes(record.countdownSource) ||
    !['idle', 'running', 'paused'].includes(record.countdownState) ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.modifiedAt))
  ) {
    return false;
  }
  if (record.countdownSource === 'none') {
    return (
      record.countdownDurationSeconds === undefined &&
      record.countdownEndsAt === undefined &&
      record.countdownRemainingSeconds === undefined &&
      record.countdownState === 'idle'
    );
  }
  const maximumSeconds = COUNTDOWN_MINUTES_MAX * 60;
  const durationSeconds = record.countdownDurationSeconds;
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < COUNTDOWN_MINUTES_MIN * 60 ||
    durationSeconds > maximumSeconds
  ) {
    return false;
  }
  if (record.countdownState === 'running') {
    return (
      record.countdownEndsAt !== undefined && Number.isFinite(Date.parse(record.countdownEndsAt))
    );
  }
  const remainingSeconds = record.countdownRemainingSeconds;
  return (
    record.countdownEndsAt === undefined &&
    typeof remainingSeconds === 'number' &&
    Number.isInteger(remainingSeconds) &&
    remainingSeconds >= 0 &&
    remainingSeconds <= maximumSeconds
  );
}

export function countdownView(record: ActiveFocusRecord, now: Date | string): CountdownView {
  if (record.countdownSource === 'none' || record.countdownDurationSeconds === undefined) {
    return { state: 'none', remainingSeconds: 0 };
  }
  if (record.countdownState === 'running') {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((Date.parse(record.countdownEndsAt ?? '') - new Date(now).getTime()) / 1_000),
    );
    return {
      state: remainingSeconds === 0 ? 'finished' : 'running',
      remainingSeconds,
      durationSeconds: record.countdownDurationSeconds,
    };
  }
  return {
    state: record.countdownState,
    remainingSeconds: record.countdownRemainingSeconds ?? record.countdownDurationSeconds,
    durationSeconds: record.countdownDurationSeconds,
  };
}

export function currentIncompleteStep(
  snapshot: Pick<PlannerSnapshot, 'taskSteps'>,
  taskId: string,
): TaskStepRecord | undefined {
  return snapshot.taskSteps
    .filter((step) => step.taskId === taskId && !step.completed)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainingSeconds = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}
