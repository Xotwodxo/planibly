import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { formatLocalDate } from '../../data/planning';
import { runProgress } from '../../data/routine';
import { routineRepository } from '../../data/routineRepository';
import {
  ROUTINE_PRESENTATION_STYLES,
  ROUTINE_STYLE_LABELS,
  type RoutineRunItemRecord,
} from '../../data/routineTypes';
import type { PlannerSnapshot } from '../../data/plannerTypes';

export function RoutineRunDialog({
  runId,
  snapshot,
  onClose,
  onAnnounce,
}: {
  runId: string;
  snapshot: PlannerSnapshot;
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const run = snapshot.routineRuns.find((candidate) => candidate.id === runId);
  const items = useMemo(
    () =>
      snapshot.routineRunItems
        .filter((item) => item.runId === runId)
        .sort((left, right) => left.order - right.order),
    [runId, snapshot.routineRunItems],
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFull, setShowFull] = useState(false);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const nextIndex = items.findIndex((item) => !item.completedAt);
    if (nextIndex >= 0) setCurrentIndex(nextIndex);
  }, [items]);

  if (!run) {
    return (
      <Dialog title="Opening routine" description="Loading the saved daily run." onClose={onClose}>
        <p role="status">Opening routine...</p>
      </Dialog>
    );
  }
  const progress = runProgress(run, items);
  const currentItem = items[currentIndex];

  async function act(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      onAnnounce(message);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The routine run could not update.');
    }
  }

  function requestComplete() {
    if (progress.completed < progress.total) setConfirmIncomplete(true);
    else void act(() => routineRepository.completeRun(run!.id), `${run!.routineName} completed.`);
  }

  const itemList = (
    <ol className={`routine-run-items routine-run-items--${run.presentationStyle}`}>
      {items.map((item) => (
        <RunItem
          key={item.id}
          item={item}
          disabled={run.status !== 'inProgress'}
          onChange={(completed) =>
            act(
              () => routineRepository.setRunItemCompleted(item.id, completed),
              completed ? `${item.title} checked.` : `${item.title} unchecked.`,
            )
          }
        />
      ))}
    </ol>
  );

  return (
    <Dialog
      title={run.routineName}
      description={`${formatLocalDate(run.localDate, { weekday: 'long', day: 'numeric', month: 'long' })}${run.variantName ? ` - ${run.variantName}` : ''}`}
      onClose={onClose}
    >
      <div className="routine-run" style={{ '--routine-color': run.routineColor } as CSSProperties}>
        <div className="routine-run__progress">
          <span>
            {progress.completed} of {progress.total}
          </span>
          <progress value={progress.completed} max={Math.max(progress.total, 1)}>
            {progress.completed} of {progress.total}
          </progress>
        </div>
        <label className="field">
          <span>Presentation for this run</span>
          <select
            value={run.presentationStyle}
            disabled={run.status !== 'inProgress'}
            onChange={(event) =>
              void act(
                () =>
                  routineRepository.setRunStyle(
                    run.id,
                    event.target.value as typeof run.presentationStyle,
                  ),
                'Run presentation changed.',
              )
            }
          >
            {ROUTINE_PRESENTATION_STYLES.map((style) => (
              <option key={style} value={style}>
                {ROUTINE_STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </label>

        {run.status !== 'inProgress' ? (
          <div className={`routine-run__state is-${run.status}`} role="status">
            <strong>{run.status === 'completed' ? 'Completed' : 'Skipped'}</strong>
            {run.skipReason ? <span>{run.skipReason}</span> : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void act(() => routineRepository.reopenRun(run.id), `${run.routineName} reopened.`)
              }
            >
              Reopen run
            </Button>
          </div>
        ) : null}

        {run.presentationStyle === 'stepByStep' && !showFull ? (
          <div className="routine-step-view">
            {currentItem ? (
              <RunItem
                item={currentItem}
                disabled={run.status !== 'inProgress'}
                onChange={(completed) =>
                  act(
                    () => routineRepository.setRunItemCompleted(currentItem.id, completed),
                    completed ? `${currentItem.title} checked.` : `${currentItem.title} unchecked.`,
                  )
                }
              />
            ) : null}
            <div className="dialog__actions routine-step-controls">
              <Button
                type="button"
                variant="quiet"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
              >
                Previous
              </Button>
              <Button type="button" variant="quiet" onClick={() => setShowFull(true)}>
                Show Full Routine
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={currentIndex >= items.length - 1}
                onClick={() => setCurrentIndex((value) => Math.min(items.length - 1, value + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <>
            {run.presentationStyle === 'stepByStep' ? (
              <Button type="button" variant="quiet" onClick={() => setShowFull(false)}>
                Return to current item
              </Button>
            ) : null}
            {itemList}
          </>
        )}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {run.status === 'inProgress' ? (
          <div className="dialog__actions">
            <Button type="button" variant="quiet" onClick={() => setConfirmSkip(true)}>
              Skip routine
            </Button>
            <Button type="button" onClick={requestComplete}>
              Mark routine complete
            </Button>
          </div>
        ) : null}
      </div>
      {confirmIncomplete ? (
        <Dialog
          title="Complete with unfinished items?"
          description={`${progress.total - progress.completed} item${progress.total - progress.completed === 1 ? '' : 's'} will remain unchecked in this historical run.`}
          onClose={() => setConfirmIncomplete(false)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setConfirmIncomplete(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void act(
                  () => routineRepository.completeRun(run.id, true),
                  `${run.routineName} completed.`,
                ).then(() => setConfirmIncomplete(false))
              }
            >
              Complete routine
            </Button>
          </div>
        </Dialog>
      ) : null}
      {confirmSkip ? (
        <Dialog
          title="Skip this routine?"
          description="Skipping is a neutral record and does not affect a score or streak."
          onClose={() => setConfirmSkip(false)}
        >
          <label className="field">
            <span>
              Reason <small>Optional</small>
            </span>
            <input
              maxLength={240}
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
            />
          </label>
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setConfirmSkip(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void act(
                  () => routineRepository.skipRun(run.routineId, run.localDate, skipReason),
                  `${run.routineName} skipped.`,
                ).then(() => setConfirmSkip(false))
              }
            >
              Skip routine
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

function RunItem({
  item,
  disabled,
  onChange,
}: {
  item: RoutineRunItemRecord;
  disabled: boolean;
  onChange: (completed: boolean) => Promise<void>;
}) {
  return (
    <li className={item.completedAt ? 'is-completed' : undefined}>
      <label>
        <input
          type="checkbox"
          checked={Boolean(item.completedAt)}
          disabled={disabled}
          onChange={(event) => void onChange(event.target.checked)}
        />
        <span>
          <strong>{item.title}</strong>
          {item.estimatedDurationMinutes ? (
            <small>{item.estimatedDurationMinutes} min</small>
          ) : null}
          {item.note ? <small>{item.note}</small> : null}
        </span>
      </label>
    </li>
  );
}
