import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import { countdownView, currentIncompleteStep, formatCountdown } from '../data/focus';
import {
  FocusBlockedError,
  focusRepository,
  FocusSwitchRequiredError,
} from '../data/focusRepository';
import {
  COUNTDOWN_MINUTES_MAX,
  type CountdownSource,
  type TaskPrepItemRecord,
  type TaskStartStyle,
} from '../data/focusTypes';
import { plannerRepository } from '../data/plannerRepository';
import type { PlannerSnapshot, TaskRecord, TaskStepRecord } from '../data/plannerTypes';
import { localDateFromDate } from '../data/planning';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { TaskPlanningSummary } from '../features/planner/TaskPlanningSummary';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';

const STYLE_LABELS: Record<TaskStartStyle, string> = {
  gentle: 'Gentle Start',
  oneThing: 'One Thing',
  full: 'Full View',
};

const STYLE_EXPLANATIONS: Record<TaskStartStyle, string> = {
  gentle: 'Review why and preparation first, then move to the next task step.',
  oneThing: 'Keep only the current action in view until you choose to reveal more.',
  full: 'Keep planning, preparation, steps, and task details together.',
};

export function FocusPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const { snapshot, isLoading, error } = usePlannerSnapshot();
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  const details = snapshot.taskStartingDetails.find((candidate) => candidate.taskId === taskId);
  const activeFocus = snapshot.activeFocus;
  const [selectedStyle, setSelectedStyle] = useState<TaskStartStyle>('gentle');
  const [editingTask, setEditingTask] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [viewedStepId, setViewedStepId] = useState<string>();
  const [customMinutes, setCustomMinutes] = useState('15');
  const [message, setMessage] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    setSelectedStyle(details?.preferredStartStyle ?? 'gentle');
  }, [details?.preferredStartStyle, taskId]);

  useEffect(() => {
    if (activeFocus?.countdownState !== 'running') return;
    const interval = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, [activeFocus?.countdownState, activeFocus?.countdownEndsAt]);

  useEffect(() => {
    if (!activeFocus) return;
    setClock(new Date());
  }, [activeFocus]);

  const prepItems = useMemo(
    () =>
      snapshot.taskPrepItems
        .filter((item) => item.taskId === taskId)
        .sort((left, right) => left.order - right.order),
    [snapshot.taskPrepItems, taskId],
  );
  const steps = useMemo(
    () =>
      snapshot.taskSteps
        .filter((step) => step.taskId === taskId)
        .sort((left, right) => left.order - right.order),
    [snapshot.taskSteps, taskId],
  );
  const blockers = (snapshot.blockedByTaskId[taskId] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is TaskRecord => candidate !== undefined);
  const activeForTask = activeFocus?.taskId === taskId ? activeFocus : undefined;
  const currentStep = currentIncompleteStep(snapshot, taskId);
  const displayedStep =
    steps.find((step) => step.id === viewedStepId) ?? currentStep ?? steps.at(-1);

  async function begin(switchExisting = false) {
    if (!task) return;
    try {
      await focusRepository.startFocus(task.id, selectedStyle, switchExisting);
      setMessage(`${task.title} focus started.`);
      setPageError(null);
      setViewedStepId(undefined);
    } catch (caughtError) {
      if (caughtError instanceof FocusSwitchRequiredError) return;
      setPageError(
        caughtError instanceof FocusBlockedError
          ? 'Complete the blocking task before beginning.'
          : caughtError instanceof Error
            ? caughtError.message
            : 'Focus could not start.',
      );
    }
  }

  async function endFocus() {
    await focusRepository.endFocus();
    void navigate('/');
  }

  async function setStepCompleted(step: TaskStepRecord, completed: boolean) {
    const remainingBefore = steps.filter((candidate) => !candidate.completed).length;
    await plannerRepository.setStepCompleted(step.id, completed);
    setMessage(`${step.title} ${completed ? 'completed' : 'returned to the task'}.`);
    setViewedStepId(undefined);
    if (completed && remainingBefore === 1) setConfirmComplete(true);
  }

  async function completeTask() {
    if (!task) return;
    await plannerRepository.setTaskCompleted(task.id, true);
    setConfirmComplete(false);
    void navigate('/');
  }

  function moveViewedStep(direction: -1 | 1) {
    if (!displayedStep) return;
    const index = steps.findIndex((step) => step.id === displayedStep.id);
    const next = steps[index + direction];
    if (next) setViewedStepId(next.id);
  }

  async function configureCountdown(source: CountdownSource) {
    try {
      await focusRepository.configureCountdown(
        source,
        source === 'custom' ? Number(customMinutes) : undefined,
      );
      setMessage(source === 'none' ? 'Countdown removed.' : 'Countdown ready.');
      setPageError(null);
    } catch (caughtError) {
      setPageError(
        caughtError instanceof Error ? caughtError.message : 'Countdown could not be configured.',
      );
    }
  }

  if (isLoading) {
    return (
      <main className="focus-shell" id="main-content">
        <p role="status">Opening focused start…</p>
      </main>
    );
  }

  if (error || !task) {
    return (
      <main className="focus-shell" id="main-content">
        <Surface className="focus-unavailable">
          <p className="eyebrow">Focused start</p>
          <h1>This task is not available</h1>
          <p>{error ?? 'It may have been completed, deleted, or archived.'}</p>
          <Link className="button button--secondary" to="/lists">
            Return to Lists
          </Link>
        </Surface>
      </main>
    );
  }

  if (activeFocus && activeFocus.taskId !== task.id) {
    const activeTask = snapshot.tasks.find((candidate) => candidate.id === activeFocus.taskId);
    return (
      <main className="focus-shell" id="main-content">
        <Surface className="focus-switch-card">
          <p className="eyebrow">Switch focus</p>
          <h1>{activeTask?.title ?? 'Another task'} is currently focused</h1>
          <p>
            Switching ends that focus without completing or rescheduling either task. Prep and step
            states stay as they are.
          </p>
          <StartStyleChooser value={selectedStyle} onChange={setSelectedStyle} />
          <div className="focus-actions">
            <Link className="button button--quiet" to={`/focus/${activeFocus.taskId}`}>
              Continue current focus
            </Link>
            <Button onClick={() => void begin(true)}>Switch to {task.title}</Button>
          </div>
        </Surface>
      </main>
    );
  }

  if (!activeForTask) {
    return (
      <main className="focus-shell" id="main-content">
        <header className="focus-topbar">
          <Link to="/lists">Exit focused start</Link>
          <span>Planibly</span>
        </header>
        <Surface className={`focus-start-card focus-start-card--${selectedStyle}`}>
          <p className="eyebrow">Focused start · {STYLE_LABELS[selectedStyle]}</p>
          <h1>{task.title}</h1>
          <TaskContext task={task} snapshot={snapshot} />
          {blockers.length > 0 ? <BlockerNotice blockers={blockers} /> : null}
          {selectedStyle !== 'oneThing' ? (
            <>
              {details?.whyItMatters ? (
                <section className="focus-why" aria-labelledby="focus-why-heading">
                  <h2 id="focus-why-heading">Why this matters</h2>
                  <p>{details.whyItMatters}</p>
                </section>
              ) : null}
              <PrepChecklist items={prepItems} onMessage={setMessage} />
              {selectedStyle === 'full' ? (
                <FullTaskDetails task={task} steps={steps} snapshot={snapshot} />
              ) : null}
            </>
          ) : null}
          <StartStyleChooser value={selectedStyle} onChange={setSelectedStyle} />
          <div className="focus-actions">
            <Button disabled={blockers.length > 0} onClick={() => void begin()}>
              Begin Task
            </Button>
            <Button variant="quiet" onClick={() => setEditingTask(true)}>
              Edit full task
            </Button>
          </div>
          {pageError ? (
            <p className="form-error" role="alert">
              {pageError}
            </p>
          ) : null}
        </Surface>
        {editingTask ? (
          <TaskEditorDialog task={task} snapshot={snapshot} onClose={() => setEditingTask(false)} />
        ) : null}
        <div className="visually-hidden" aria-live="polite">
          {message}
        </div>
      </main>
    );
  }

  const showFull = activeForTask.startStyle === 'full' || activeForTask.fullDetailsRevealed;
  const showPrep = activeForTask.startStyle === 'gentle' || showFull;
  const timer = countdownView(activeForTask, clock);

  return (
    <main className="focus-shell focus-shell--active" id="main-content">
      <header className="focus-topbar">
        <button type="button" onClick={() => setConfirmEnd(true)}>
          Leave focus
        </button>
        <span>Focused task</span>
        <button type="button" onClick={() => setEditingTask(true)}>
          Edit task
        </button>
      </header>
      <div className="focus-workspace">
        <section className="focus-primary" aria-labelledby="focus-task-title">
          <p className="eyebrow">{STYLE_LABELS[activeForTask.startStyle]}</p>
          <h1 id="focus-task-title">{task.title}</h1>
          <TaskContext task={task} snapshot={snapshot} />
          {blockers.length > 0 ? <BlockerNotice blockers={blockers} /> : null}
          {showFull && details?.whyItMatters ? (
            <section className="focus-why" aria-labelledby="active-focus-why-heading">
              <h2 id="active-focus-why-heading">Why this matters</h2>
              <p>{details.whyItMatters}</p>
            </section>
          ) : null}
          {showPrep ? <PrepChecklist items={prepItems} onMessage={setMessage} /> : null}
          {activeForTask.startStyle === 'oneThing' && !showFull ? (
            <Button
              variant="quiet"
              onClick={() => void focusRepository.setFullDetailsRevealed(true)}
            >
              Show Full Task
            </Button>
          ) : null}
          {showFull ? (
            <FullTaskDetails
              task={task}
              steps={steps}
              snapshot={snapshot}
              onStepComplete={setStepCompleted}
            />
          ) : (
            <CurrentStep
              task={task}
              step={displayedStep}
              steps={steps}
              onComplete={setStepCompleted}
              onPrevious={() => moveViewedStep(-1)}
              onNext={() => moveViewedStep(1)}
            />
          )}
          {steps.length === 0 ? (
            <Button disabled={blockers.length > 0} onClick={() => setConfirmComplete(true)}>
              Complete Task
            </Button>
          ) : null}
        </section>

        <aside className="focus-controls" aria-labelledby="focus-controls-heading">
          <h2 id="focus-controls-heading">Focus controls</h2>
          <StartStyleChooser
            value={activeForTask.startStyle}
            onChange={(style) => void focusRepository.setStartStyle(style)}
          />
          <CountdownControls
            timer={timer}
            task={task}
            savedMinutes={details?.defaultCountdownMinutes}
            customMinutes={customMinutes}
            onCustomMinutes={setCustomMinutes}
            onConfigure={configureCountdown}
            onMessage={setMessage}
          />
          <Button variant="quiet" onClick={() => setConfirmEnd(true)}>
            End Focus
          </Button>
        </aside>
      </div>
      {editingTask ? (
        <TaskEditorDialog task={task} snapshot={snapshot} onClose={() => setEditingTask(false)} />
      ) : null}
      {confirmEnd ? (
        <Dialog
          title="End focus?"
          description="This leaves the task, prep, and steps unchanged. Nothing will be rescheduled."
          onClose={() => setConfirmEnd(false)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setConfirmEnd(false)}>
              Continue focus
            </Button>
            <Button onClick={() => void endFocus()}>End Focus</Button>
          </div>
        </Dialog>
      ) : null}
      {confirmComplete ? (
        <Dialog
          title="Complete this task?"
          description="Step and preparation states remain independent. Completing the task also ends focus."
          onClose={() => setConfirmComplete(false)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setConfirmComplete(false)}>
              Keep working
            </Button>
            <Button disabled={blockers.length > 0} onClick={() => void completeTask()}>
              Complete Task
            </Button>
          </div>
        </Dialog>
      ) : null}
      {pageError ? (
        <p className="focus-error form-error" role="alert">
          {pageError}
        </p>
      ) : null}
      <div className="visually-hidden" aria-live="polite">
        {message}
      </div>
    </main>
  );
}

function StartStyleChooser({
  value,
  onChange,
}: {
  value: TaskStartStyle;
  onChange: (value: TaskStartStyle) => void;
}) {
  return (
    <fieldset className="focus-style-chooser">
      <legend>Start style</legend>
      {(['gentle', 'oneThing', 'full'] as const).map((style) => (
        <label key={style}>
          <input
            type="radio"
            name="focus-style"
            value={style}
            checked={value === style}
            onChange={() => onChange(style)}
          />
          <span>
            <strong>{STYLE_LABELS[style]}</strong>
            <small>{STYLE_EXPLANATIONS[style]}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function TaskContext({ task, snapshot }: { task: TaskRecord; snapshot: PlannerSnapshot }) {
  const list = snapshot.lists.find((candidate) => candidate.id === task.listId);
  return (
    <p className="focus-context">
      {list?.mode === 'project' ? 'Project' : 'List'} · {list?.name ?? 'Unknown list'}
    </p>
  );
}

function BlockerNotice({ blockers }: { blockers: TaskRecord[] }) {
  return (
    <div className="blocked-notice" role="status">
      <strong>This task is blocked.</strong>
      <span>
        Complete {blockers.map((task) => task.title).join(', ')} before beginning this task.
      </span>
    </div>
  );
}

function PrepChecklist({
  items,
  onMessage,
}: {
  items: TaskPrepItemRecord[];
  onMessage: (message: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="focus-prep" aria-labelledby="focus-prep-heading">
      <div>
        <h2 id="focus-prep-heading">Get ready</h2>
        <span>{items.filter((item) => item.completed).length} ready</span>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.completed ? 'is-completed' : undefined}>
            <label>
              <input
                type="checkbox"
                aria-label={`${item.completed ? 'Mark not ready' : 'Mark ready'} ${item.title}`}
                checked={item.completed}
                onChange={(event) => {
                  const completed = event.target.checked;
                  void focusRepository
                    .setPrepItemCompleted(item.id, completed)
                    .then(() =>
                      onMessage(
                        `${item.title} ${completed ? 'ready' : 'returned to preparation'}.`,
                      ),
                    );
                }}
              />
              <span>{item.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CurrentStep({
  task,
  step,
  steps,
  onComplete,
  onPrevious,
  onNext,
}: {
  task: TaskRecord;
  step?: TaskStepRecord;
  steps: TaskStepRecord[];
  onComplete: (step: TaskStepRecord, completed: boolean) => Promise<void>;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!step) {
    return (
      <section className="focus-current-step" aria-labelledby="current-action-heading">
        <p className="eyebrow">Current action</p>
        <h2 id="current-action-heading">{task.title}</h2>
        <p>No task steps were added. Work directly from the task title.</p>
      </section>
    );
  }
  const index = steps.findIndex((candidate) => candidate.id === step.id);
  return (
    <section className="focus-current-step" aria-labelledby="current-action-heading">
      <p className="eyebrow">
        Step {index + 1} of {steps.length}
      </p>
      <h2 id="current-action-heading">{step.title}</h2>
      <label className="focus-step-check">
        <input
          type="checkbox"
          checked={step.completed}
          onChange={(event) => void onComplete(step, event.target.checked)}
        />
        <span>{step.completed ? 'Completed' : 'Mark this step complete'}</span>
      </label>
      <div className="focus-step-navigation">
        <Button variant="quiet" disabled={index === 0} onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="quiet" disabled={index === steps.length - 1} onClick={onNext}>
          Next
        </Button>
      </div>
    </section>
  );
}

function FullTaskDetails({
  task,
  steps,
  snapshot,
  onStepComplete,
}: {
  task: TaskRecord;
  steps: TaskStepRecord[];
  snapshot: PlannerSnapshot;
  onStepComplete?: (step: TaskStepRecord, completed: boolean) => Promise<void>;
}) {
  return (
    <section className="focus-full-task" aria-labelledby="full-task-heading">
      <h2 id="full-task-heading">Task details</h2>
      <TaskPlanningSummary task={task} today={localDateFromDate(new Date())} />
      {steps.length > 0 ? (
        <ol>
          {steps.map((step) => (
            <li key={step.id} className={step.completed ? 'is-completed' : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={step.completed}
                  onChange={(event) => {
                    const completed = event.target.checked;
                    void (onStepComplete
                      ? onStepComplete(step, completed)
                      : plannerRepository.setStepCompleted(step.id, completed));
                  }}
                />
                <span>{step.title}</span>
              </label>
            </li>
          ))}
        </ol>
      ) : (
        <p>No steps added.</p>
      )}
      <p className="field-help">
        Prep items are shown separately and never count toward these task steps.
        {snapshot.blockedByTaskId[task.id]?.length ? ' The parent task remains blocked.' : ''}
      </p>
    </section>
  );
}

function CountdownControls({
  timer,
  task,
  savedMinutes,
  customMinutes,
  onCustomMinutes,
  onConfigure,
  onMessage,
}: {
  timer: ReturnType<typeof countdownView>;
  task: TaskRecord;
  savedMinutes?: number;
  customMinutes: string;
  onCustomMinutes: (value: string) => void;
  onConfigure: (source: CountdownSource) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  return (
    <section className="focus-countdown" aria-labelledby="countdown-heading">
      <div>
        <h3 id="countdown-heading">Optional countdown</h3>
        <p>This is one continuous timer, with no work/break cycles.</p>
      </div>
      <output
        className={`countdown-display countdown-display--${timer.state}`}
        aria-live="polite"
        aria-label={`Countdown ${timer.state}, ${formatCountdown(timer.remainingSeconds)} remaining`}
      >
        {timer.state === 'none' ? 'No countdown' : formatCountdown(timer.remainingSeconds)}
      </output>
      {timer.state === 'finished' ? (
        <p className="countdown-finished" role="status">
          The time you set has finished. Continue, add time, or end focus.
        </p>
      ) : null}
      <div className="countdown-choices">
        <Button variant="quiet" onClick={() => void onConfigure('none')}>
          No countdown
        </Button>
        <Button
          variant="quiet"
          disabled={!task.estimatedDurationMinutes}
          onClick={() => void onConfigure('estimated')}
        >
          Use estimate
          {task.estimatedDurationMinutes ? ` (${task.estimatedDurationMinutes} min)` : ''}
        </Button>
        <Button variant="quiet" disabled={!savedMinutes} onClick={() => void onConfigure('saved')}>
          Use saved{savedMinutes ? ` (${savedMinutes} min)` : ''}
        </Button>
        <label className="countdown-custom">
          <span>Custom minutes</span>
          <input
            type="number"
            min="1"
            max={COUNTDOWN_MINUTES_MAX}
            value={customMinutes}
            onChange={(event) => onCustomMinutes(event.target.value)}
          />
        </label>
        <Button variant="quiet" onClick={() => void onConfigure('custom')}>
          Set custom
        </Button>
      </div>
      {timer.state !== 'none' ? (
        <div className="countdown-actions">
          {timer.state === 'running' ? (
            <Button
              onClick={() =>
                void focusRepository.pauseCountdown().then(() => onMessage('Countdown paused.'))
              }
            >
              Pause
            </Button>
          ) : timer.state === 'idle' || timer.state === 'paused' ? (
            <Button
              onClick={() =>
                void focusRepository.startCountdown().then(() => onMessage('Countdown running.'))
              }
            >
              {timer.state === 'paused' ? 'Resume' : 'Start'}
            </Button>
          ) : null}
          {[5, 10, 15].map((minutes) => (
            <Button
              key={minutes}
              variant="quiet"
              onClick={() =>
                void focusRepository
                  .addCountdownTime(minutes)
                  .then(() => onMessage(`${minutes} minutes added.`))
              }
            >
              +{minutes} min
            </Button>
          ))}
          <Button
            variant="quiet"
            onClick={() =>
              void focusRepository.resetCountdown().then(() => onMessage('Countdown reset.'))
            }
          >
            Stop / reset
          </Button>
        </div>
      ) : null}
    </section>
  );
}
