import {
  countdownView,
  currentIncompleteStep,
  formatCountdown,
  normalizeStartingDetails,
  validateCountdownMinutes,
  validatePrepItemTitle,
} from './focus';
import { ACTIVE_FOCUS_ID, type ActiveFocusRecord } from './focusTypes';

describe('task starting support domain', () => {
  it('keeps all task starting fields optional and validates bounded values', () => {
    expect(normalizeStartingDetails({})).toEqual({
      whyItMatters: undefined,
      preferredStartStyle: undefined,
      defaultCountdownMinutes: undefined,
    });
    expect(
      normalizeStartingDetails({
        whyItMatters: '  Keep the promise  ',
        preferredStartStyle: 'gentle',
        defaultCountdownMinutes: 15,
      }),
    ).toEqual({
      whyItMatters: 'Keep the promise',
      preferredStartStyle: 'gentle',
      defaultCountdownMinutes: 15,
    });
    expect(() => normalizeStartingDetails({ whyItMatters: 'x'.repeat(1_001) })).toThrow(
      '1000 characters',
    );
    expect(() => validateCountdownMinutes(0)).toThrow('1 to 1440');
    expect(() => validateCountdownMinutes(1_441)).toThrow('1 to 1440');
    expect(validatePrepItemTitle('  Open the document  ')).toBe('Open the document');
  });

  it('derives the first incomplete task step in manual order', () => {
    const taskSteps = [
      {
        id: 'step-2',
        taskId: 'task-1',
        title: 'Second',
        completed: false,
        order: 1,
        createdAt: '2026-07-18T08:00:00.000Z',
        modifiedAt: '2026-07-18T08:00:00.000Z',
      },
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'First',
        completed: true,
        order: 0,
        createdAt: '2026-07-18T08:00:00.000Z',
        modifiedAt: '2026-07-18T08:00:00.000Z',
      },
    ];
    expect(currentIncompleteStep({ taskSteps }, 'task-1')?.title).toBe('Second');
    expect(currentIncompleteStep({ taskSteps }, 'task-2')).toBeUndefined();
  });

  it('calculates countdown state from timestamps across reload and throttling', () => {
    const record: ActiveFocusRecord = {
      id: ACTIVE_FOCUS_ID,
      taskId: 'task-1',
      startStyle: 'oneThing',
      startedAt: '2026-07-18T08:00:00.000Z',
      fullDetailsRevealed: false,
      countdownSource: 'custom',
      countdownDurationSeconds: 60,
      countdownState: 'running',
      countdownEndsAt: '2026-07-18T08:01:00.000Z',
      createdAt: '2026-07-18T08:00:00.000Z',
      modifiedAt: '2026-07-18T08:00:00.000Z',
    };
    expect(countdownView(record, '2026-07-18T08:00:30.000Z')).toMatchObject({
      state: 'running',
      remainingSeconds: 30,
    });
    expect(countdownView(record, '2026-07-18T08:01:30.000Z')).toMatchObject({
      state: 'finished',
      remainingSeconds: 0,
    });
    expect(
      countdownView(
        {
          ...record,
          countdownState: 'paused',
          countdownEndsAt: undefined,
          countdownRemainingSeconds: 27,
        },
        '2026-07-19T08:00:00.000Z',
      ),
    ).toMatchObject({ state: 'paused', remainingSeconds: 27 });
    expect(formatCountdown(3_661)).toBe('01:01:01');
  });
});
