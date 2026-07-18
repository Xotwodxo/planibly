import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import { addCalendarDays, formatLocalDate, isLocalDate, localDateFromDate } from '../data/planning';
import { mostRecentPreviouslyScheduled, routinesForDate, runProgress } from '../data/routine';
import { routineRepository } from '../data/routineRepository';
import {
  ROUTINE_SCHEDULE_LABELS,
  ROUTINE_SECTION_LABELS,
  ROUTINE_STYLE_LABELS,
  type RoutineRecord,
  type RoutineRunRecord,
} from '../data/routineTypes';
import { showDeletionUndo } from '../features/planner/plannerEvents';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';
import { RoutineEditorDialog } from '../features/routines/RoutineEditorDialog';
import { RoutineRunDialog } from '../features/routines/RoutineRunDialog';

type ReviewRequest = {
  routine: RoutineRecord;
  originalDate: string;
  action: 'today' | 'move' | 'skip';
};

export function RoutinesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { snapshot, isLoading, error } = usePlannerSnapshot();
  const today = localDateFromDate(new Date());
  const [editing, setEditing] = useState<RoutineRecord | 'new' | null>(null);
  const [runId, setRunId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState<RoutineRecord>();
  const [starterAvailable, setStarterAvailable] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [leftUnchanged, setLeftUnchanged] = useState<Set<string>>(new Set());
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest>();
  const [moveDate, setMoveDate] = useState(addCalendarDays(today, 1));

  useEffect(() => {
    void routineRepository.starterExamplesAvailable().then(setStarterAvailable);
  }, [snapshot.routines.length]);

  useEffect(() => {
    const requestedRun = searchParams.get('run');
    const requestedRoutine = searchParams.get('start');
    const requestedDate = searchParams.get('date');
    if (requestedRun && snapshot.routineRuns.some((run) => run.id === requestedRun)) {
      setRunId(requestedRun);
      setSearchParams({}, { replace: true });
    } else if (requestedRoutine && requestedDate && isLocalDate(requestedDate)) {
      void routineRepository
        .createOrResumeRun(requestedRoutine, requestedDate)
        .then((run) => setRunId(run.id))
        .catch((caught) =>
          setActionError(caught instanceof Error ? caught.message : 'The routine could not start.'),
        )
        .finally(() => setSearchParams({}, { replace: true }));
    }
  }, [searchParams, setSearchParams, snapshot.routineRuns]);

  const scheduled = useMemo(() => routinesForDate(snapshot, today), [snapshot, today]);
  const runsToday = snapshot.routineRuns.filter((run) => run.localDate === today);
  const runRoutineIds = new Set(runsToday.map((run) => run.routineId));
  const scheduledWithoutRun = scheduled.filter(({ routine }) => !runRoutineIds.has(routine.id));
  const scheduledIds = new Set(scheduled.map(({ routine }) => routine.id));
  const manual = snapshot.routines.filter(
    (routine) =>
      routine.isActive && !scheduledIds.has(routine.id) && !runRoutineIds.has(routine.id),
  );
  const previous = useMemo(
    () =>
      mostRecentPreviouslyScheduled(snapshot, today).filter(
        ({ routine, localDate }) => !leftUnchanged.has(`${routine.id}:${localDate}`),
      ),
    [leftUnchanged, snapshot, today],
  );
  const recentCompleted = snapshot.routineRuns
    .filter((run) => run.status === 'completed')
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))
    .slice(0, 5);

  if (isLoading) return <p role="status">Opening routines...</p>;

  async function start(routineId: string, date = today) {
    try {
      const run = await routineRepository.createOrResumeRun(routineId, date);
      if (run.status !== 'inProgress') {
        await routineRepository.reopenRun(run.id);
      }
      setRunId(run.id);
      setActionError('');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The routine could not start.');
    }
  }

  async function confirmReview() {
    if (!reviewRequest) return;
    const { routine, originalDate, action } = reviewRequest;
    try {
      if (action === 'skip') {
        await routineRepository.skipRun(routine.id, originalDate);
        setAnnouncement(`${routine.name} skipped for ${formatLocalDate(originalDate)}.`);
      } else {
        const destination = action === 'today' ? today : moveDate;
        await routineRepository.moveOccurrence(routine.id, originalDate, destination);
        setAnnouncement(`${routine.name} moved to ${formatLocalDate(destination)}.`);
        if (action === 'today') await start(routine.id, today);
      }
      setReviewRequest(undefined);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'The scheduled routine could not update.',
      );
    }
  }

  return (
    <div className="page page--routines">
      <header className="routine-heading">
        <div>
          <span className="eyebrow">Routines</span>
          <h1>Support the day without making it rigid</h1>
          <p>Routine runs are local check-ins, separate from tasks and appointments.</p>
        </div>
        <div className="inline-actions">
          <Button type="button" onClick={() => setEditing('new')}>
            Create routine
          </Button>
          <Link className="button button--secondary" to="/plan">
            Open Plan
          </Link>
        </div>
      </header>
      {error || actionError ? (
        <p className="form-error" role="alert">
          {error ?? actionError}
        </p>
      ) : null}

      {!reviewDismissed && previous.length ? (
        <Surface className="routine-review" aria-labelledby="routine-review-heading">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Previously scheduled</span>
              <h2 id="routine-review-heading">Choose only if it helps</h2>
              <p>Nothing here moves or skips automatically.</p>
            </div>
            <Button type="button" variant="quiet" onClick={() => setReviewDismissed(true)}>
              Dismiss for now
            </Button>
          </div>
          <ul className="routine-review-list">
            {previous.map(({ routine, localDate }) => (
              <li key={`${routine.id}:${localDate}`}>
                <div>
                  <strong>{routine.name}</strong>
                  <span>
                    {formatLocalDate(localDate, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setReviewRequest({ routine, originalDate: localDate, action: 'today' })
                    }
                  >
                    Start today
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setMoveDate(addCalendarDays(today, 1));
                      setReviewRequest({ routine, originalDate: localDate, action: 'move' });
                    }}
                  >
                    Move
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setReviewRequest({ routine, originalDate: localDate, action: 'skip' })
                    }
                  >
                    Skip
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setLeftUnchanged((current) =>
                        new Set(current).add(`${routine.id}:${localDate}`),
                      )
                    }
                  >
                    Leave unchanged
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      <Surface className="routine-today" aria-labelledby="routine-today-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Today</span>
            <h2 id="routine-today-heading">Daily routine runs</h2>
          </div>
          <span>{formatLocalDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <RoutineStatusSection
          title="In progress"
          runs={runsToday.filter((run) => run.status === 'inProgress')}
          snapshot={snapshot}
          onOpen={setRunId}
        />
        <RoutineStartSection
          title="Scheduled today"
          entries={scheduledWithoutRun.map((entry) => entry.routine)}
          empty="No unstarted scheduled routines."
          onStart={start}
        />
        <RoutineStatusSection
          title="Completed today"
          runs={runsToday.filter((run) => run.status === 'completed')}
          snapshot={snapshot}
          onOpen={setRunId}
        />
        <RoutineStatusSection
          title="Skipped today"
          runs={runsToday.filter((run) => run.status === 'skipped')}
          snapshot={snapshot}
          onOpen={setRunId}
        />
        <RoutineStartSection
          title="Available manually"
          entries={manual}
          empty="No other active routines."
          onStart={start}
        />
      </Surface>

      <Surface className="routine-library" aria-labelledby="all-routines-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Library</span>
            <h2 id="all-routines-heading">All Routines</h2>
          </div>
        </div>
        {!snapshot.routines.length ? (
          <div className="empty-state">
            <h3>Start with one useful sequence</h3>
            <p>Create your own routine, or add three editable examples.</p>
            <div className="inline-actions">
              <Button type="button" onClick={() => setEditing('new')}>
                Create routine
              </Button>
              {starterAvailable ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void routineRepository.createStarterExamples().then((created) => {
                      setStarterAvailable(false);
                      setAnnouncement(`${created.length} starter routines added.`);
                    })
                  }
                >
                  Add starter examples
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <ol className="routine-library-list">
            {snapshot.routines.map((routine, index) => (
              <li key={routine.id}>
                <span
                  className="routine-color"
                  style={{ backgroundColor: routine.color }}
                  aria-hidden="true"
                />
                <div className="routine-library-list__summary">
                  <strong>{routine.name}</strong>
                  <span>
                    {ROUTINE_SCHEDULE_LABELS[routine.scheduleKind]} -{' '}
                    {ROUTINE_SECTION_LABELS[routine.defaultSection]} -{' '}
                    {ROUTINE_STYLE_LABELS[routine.presentationStyle]}
                  </span>
                  {routine.expectedDurationMinutes ? (
                    <small>{routine.expectedDurationMinutes} min expected</small>
                  ) : null}
                  {!routine.isActive ? <small>Inactive</small> : null}
                </div>
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!routine.isActive}
                    onClick={() => void start(routine.id)}
                  >
                    Start
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setEditing(routine)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      void routineRepository
                        .duplicateRoutine(routine.id)
                        .then((copy) => setAnnouncement(`${copy.name} created.`))
                    }
                  >
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      void routineRepository.setRoutineActive(routine.id, !routine.isActive)
                    }
                  >
                    {routine.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === 0}
                    onClick={() => void routineRepository.moveRoutine(routine.id, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={index === snapshot.routines.length - 1}
                    onClick={() => void routineRepository.moveRoutine(routine.id, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    className="destructive-text"
                    onClick={() => setDeleting(routine)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Surface>

      <Surface className="routine-history" aria-labelledby="routine-history-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Recent</span>
            <h2 id="routine-history-heading">Recently completed runs</h2>
          </div>
        </div>
        {recentCompleted.length ? (
          <ul>
            {recentCompleted.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => setRunId(run.id)}>
                  <strong>{run.routineName}</strong>
                  <span>{formatLocalDate(run.localDate)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plan-empty">Completed routine runs will remain available here.</p>
        )}
      </Surface>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {editing ? (
        <RoutineEditorDialog
          routine={editing === 'new' ? undefined : editing}
          snapshot={snapshot}
          onClose={() => setEditing(null)}
          onSaved={setAnnouncement}
        />
      ) : null}
      {runId ? (
        <RoutineRunDialog
          runId={runId}
          snapshot={snapshot}
          onClose={() => setRunId(undefined)}
          onAnnounce={setAnnouncement}
        />
      ) : null}
      {deleting ? (
        <Dialog
          title={`Delete ${deleting.name}?`}
          description="The routine and its current definition items move to Recently Deleted. Historical runs remain intact."
          onClose={() => setDeleting(undefined)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              className="button--destructive"
              onClick={() =>
                void routineRepository.deleteRoutine(deleting.id).then((receipt) => {
                  showDeletionUndo(receipt);
                  setDeleting(undefined);
                  setAnnouncement(`${deleting.name} moved to Recently Deleted.`);
                })
              }
            >
              Delete routine
            </Button>
          </div>
        </Dialog>
      ) : null}
      {reviewRequest ? (
        <Dialog
          title={reviewTitle(reviewRequest.action)}
          description={`${reviewRequest.routine.name} was scheduled for ${formatLocalDate(reviewRequest.originalDate)}. Nothing changes until you confirm.`}
          onClose={() => setReviewRequest(undefined)}
        >
          {reviewRequest.action === 'move' ? (
            <label className="field">
              <span>Move to</span>
              <input
                type="date"
                min={today}
                value={moveDate}
                onChange={(event) => {
                  if (isLocalDate(event.target.value)) setMoveDate(event.target.value);
                }}
              />
            </label>
          ) : null}
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setReviewRequest(undefined)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmReview()}>Confirm</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function RoutineStatusSection({
  title,
  runs,
  snapshot,
  onOpen,
}: {
  title: string;
  runs: RoutineRunRecord[];
  snapshot: ReturnType<typeof usePlannerSnapshot>['snapshot'];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="routine-status-section">
      <h3>{title}</h3>
      {runs.length ? (
        <ul>
          {runs.map((run) => {
            const progress = runProgress(run, snapshot.routineRunItems);
            return (
              <li key={run.id}>
                <button type="button" onClick={() => onOpen(run.id)}>
                  <span
                    className="routine-color"
                    style={{ backgroundColor: run.routineColor }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{run.routineName}</strong>
                    <small>
                      {progress.completed} of {progress.total}
                      {run.status === 'skipped' ? ' - skipped' : ''}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="plan-empty">None.</p>
      )}
    </section>
  );
}

function RoutineStartSection({
  title,
  entries,
  empty,
  onStart,
}: {
  title: string;
  entries: RoutineRecord[];
  empty: string;
  onStart: (id: string) => Promise<void>;
}) {
  return (
    <section className="routine-status-section">
      <h3>{title}</h3>
      {entries.length ? (
        <ul>
          {entries.map((routine) => (
            <li key={routine.id}>
              <span
                className="routine-color"
                style={{ backgroundColor: routine.color }}
                aria-hidden="true"
              />
              <strong>{routine.name}</strong>
              <Button type="button" variant="secondary" onClick={() => void onStart(routine.id)}>
                Start
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="plan-empty">{empty}</p>
      )}
    </section>
  );
}

function reviewTitle(action: ReviewRequest['action']): string {
  if (action === 'today') return 'Start this routine today?';
  if (action === 'move') return 'Move this routine?';
  return 'Skip this scheduled routine?';
}
