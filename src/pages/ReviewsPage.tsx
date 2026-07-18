import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import { effectivePlannedDate, formatDuration } from '../data/agenda';
import { formatLocalDate, addCalendarDays, localDateFromDate } from '../data/planning';
import {
  eveningReview,
  morningSummary,
  reviewAvailability,
  weekAheadSummary,
} from '../data/review';
import { reviewRepository } from '../data/reviewRepository';
import {
  REVIEW_LABELS,
  REVIEW_TYPES,
  type ReviewActionPreview,
  type ReviewPreferencesRecord,
  type ReviewRecord,
  type ReviewTaskAction,
  type ReviewType,
} from '../data/reviewTypes';
import type { CalendarOccurrence, PlannerSnapshot, TaskRecord } from '../data/plannerTypes';
import { EventEditorDialog } from '../features/calendar/EventEditorDialog';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';
import { usePlanningCapacities } from '../features/planner/usePlanningCapacities';
import { useReviewState } from '../features/reviews/useReviewState';

export function ReviewsPage() {
  const { snapshot, isLoading: plannerLoading, error: plannerError } = usePlannerSnapshot();
  const { capacities, error: capacityError } = usePlanningCapacities();
  const { state, isLoading: reviewLoading, error: reviewError } = useReviewState();
  const [searchParams] = useSearchParams();
  const today = localDateFromDate(new Date());
  const requestedType = searchParams.get('type');
  const initialType = REVIEW_TYPES.includes(requestedType as ReviewType)
    ? (requestedType as ReviewType)
    : 'morning';
  const [selectedType, setSelectedType] = useState<ReviewType>(initialType);
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeReview, setActiveReview] = useState<ReviewRecord>();
  const [actions, setActions] = useState<ReviewTaskAction[]>([]);
  const [preview, setPreview] = useState<ReviewActionPreview>();
  const [editingTask, setEditingTask] = useState<TaskRecord>();
  const [editingEvent, setEditingEvent] = useState<CalendarOccurrence>();
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string>();

  useEffect(() => setSelectedType(initialType), [initialType]);

  const morning = useMemo(
    () => morningSummary(snapshot, capacities, selectedDate),
    [capacities, selectedDate, snapshot],
  );
  const evening = useMemo(
    () => eveningReview(snapshot, capacities, selectedDate),
    [capacities, selectedDate, snapshot],
  );
  const week = useMemo(
    () => weekAheadSummary(snapshot, capacities, selectedDate),
    [capacities, selectedDate, snapshot],
  );

  if (plannerLoading || reviewLoading) return <p role="status">Opening reviews&hellip;</p>;

  async function begin(type: ReviewType, localDate = selectedDate) {
    try {
      const record = await reviewRepository.startOrResume(type, localDate);
      setActiveReview(record.finishedAt ? await reviewRepository.reopen(record.id) : record);
      setSelectedType(type);
      setSelectedDate(localDate);
      setActions([]);
      setActionError(undefined);
      setAnnouncement(`${REVIEW_LABELS[type]} opened.`);
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'Review could not open.');
    }
  }

  function dismiss() {
    if (!activeReview) return;
    reviewRepository.dismissForSession(activeReview.type, activeReview.periodStart);
    setAnnouncement(`${REVIEW_LABELS[activeReview.type]} dismissed for this session.`);
    setActiveReview(undefined);
    setActions([]);
  }

  async function finish() {
    if (!activeReview) return;
    try {
      await reviewRepository.finish(activeReview.id);
      setAnnouncement(`${REVIEW_LABELS[activeReview.type]} finished.`);
      setActiveReview(undefined);
      setActions([]);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : 'Review could not finish.',
      );
    }
  }

  async function openPreview() {
    try {
      const nextPreview = await reviewRepository.preview(actions);
      setPreview(nextPreview);
      setAnnouncement(
        `Preview ready for ${nextPreview.items.length} planning choice${nextPreview.items.length === 1 ? '' : 's'}.`,
      );
      setActionError(undefined);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : 'Change preview could not load.',
      );
    }
  }

  function updateActions(nextActions: ReviewTaskAction[]) {
    setActions(nextActions);
    setAnnouncement(
      nextActions.length
        ? `${nextActions.length} planning choice${nextActions.length === 1 ? '' : 's'} selected.`
        : 'Planning choices cleared.',
    );
  }

  async function approvePreview() {
    if (!activeReview) return;
    try {
      const applied = await reviewRepository.applyActions(actions, activeReview.id);
      const changed = applied.items.filter((item) => !item.unchanged).length;
      setAnnouncement(`Applied ${changed} planning change${changed === 1 ? '' : 's'}.`);
      setActions([]);
      setPreview(undefined);
      setActionError(undefined);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : 'Changes were not applied.',
      );
    }
  }

  const error = plannerError ?? capacityError ?? reviewError ?? actionError;

  return (
    <div className="page reviews-page">
      <header className="reviews-heading">
        <div>
          <span className="eyebrow">Reviews</span>
          <h1>{activeReview ? REVIEW_LABELS[activeReview.type] : 'Pause, review, and choose'}</h1>
          <p>
            {activeReview
              ? activeReview.type === 'weekAhead'
                ? `${formatLocalDate(activeReview.periodStart, { day: 'numeric', month: 'long', year: 'numeric' })} to ${formatLocalDate(activeReview.periodEnd, { day: 'numeric', month: 'long', year: 'numeric' })}`
                : formatLocalDate(activeReview.periodStart, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
              : 'Optional, factual summaries. Nothing changes without your approval.'}
          </p>
        </div>
        {activeReview ? (
          <div className="review-header-actions">
            <Button variant="quiet" onClick={() => setActiveReview(undefined)}>
              Exit
            </Button>
            <Button variant="secondary" onClick={dismiss}>
              Dismiss for now
            </Button>
            <Button disabled={actions.length > 0} onClick={() => void finish()}>
              Save and finish
            </Button>
          </div>
        ) : (
          <Link className="button button--secondary" to="/plan">
            Open planner
          </Link>
        )}
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {activeReview ? (
        <>
          <ReviewWorkspace
            type={activeReview.type}
            localDate={selectedDate}
            snapshot={snapshot}
            morning={morning}
            evening={evening}
            week={week}
            preferences={state.preferences}
            actions={actions}
            onActionsChange={updateActions}
            onEditTask={setEditingTask}
            onEditEvent={setEditingEvent}
          />
          {actions.length > 0 ? (
            <Surface className="review-change-bar" aria-label="Pending review changes">
              <span>
                {actions.length} deliberate choice{actions.length === 1 ? '' : 's'} ready to
                preview.
              </span>
              <Button onClick={() => void openPreview()}>Preview changes</Button>
              <Button variant="quiet" onClick={() => updateActions([])}>
                Clear choices
              </Button>
            </Surface>
          ) : null}
        </>
      ) : (
        <ReviewLanding
          selectedType={selectedType}
          selectedDate={selectedDate}
          preferences={state.preferences}
          records={state.records}
          dismissedKeys={state.dismissedKeys}
          onTypeChange={setSelectedType}
          onDateChange={setSelectedDate}
          onBegin={(type, date) => void begin(type, date ?? selectedDate)}
          onPreferencesChange={(changes) => void reviewRepository.savePreferences(changes)}
        />
      )}

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {preview ? (
        <ReviewPreviewDialog
          preview={preview}
          onClose={() => setPreview(undefined)}
          onApprove={() => void approvePreview()}
        />
      ) : null}
      {editingTask ? (
        <TaskEditorDialog
          task={editingTask}
          snapshot={snapshot}
          onClose={() => setEditingTask(undefined)}
        />
      ) : null}
      {editingEvent ? (
        <EventEditorDialog
          event={editingEvent}
          calendars={snapshot.calendars}
          templates={snapshot.eventTemplates}
          recurrenceRules={snapshot.recurrenceRules}
          initialDate={selectedDate}
          onAnnounce={setAnnouncement}
          onClose={() => setEditingEvent(undefined)}
        />
      ) : null}
    </div>
  );
}

function ReviewLanding({
  selectedType,
  selectedDate,
  preferences,
  records,
  dismissedKeys,
  onTypeChange,
  onDateChange,
  onBegin,
  onPreferencesChange,
}: {
  selectedType: ReviewType;
  selectedDate: string;
  preferences: ReviewPreferencesRecord;
  records: ReviewRecord[];
  dismissedKeys: ReadonlySet<string>;
  onTypeChange: (type: ReviewType) => void;
  onDateChange: (date: string) => void;
  onBegin: (type: ReviewType, localDate?: string) => void;
  onPreferencesChange: (
    changes: Partial<Omit<ReviewPreferencesRecord, 'id' | 'createdAt' | 'modifiedAt'>>,
  ) => void;
}) {
  const availability = reviewAvailability(
    preferences,
    records,
    dismissedKeys,
    new Date(),
    selectedDate,
  );
  return (
    <>
      <section className="review-start-grid" aria-labelledby="review-start-title">
        <h2 id="review-start-title" className="visually-hidden">
          Start a review
        </h2>
        {REVIEW_TYPES.map((type) => {
          const status = availability.find((item) => item.type === type)!;
          return (
            <Surface key={type} className="review-start-card">
              <span className="review-status">
                {status.finished
                  ? 'Finished for today'
                  : status.dismissed
                    ? 'Dismissed this session'
                    : status.due
                      ? 'Available now'
                      : 'Available manually'}
              </span>
              <h2>{REVIEW_LABELS[type]}</h2>
              <p>
                {type === 'morning'
                  ? 'See the selected day clearly.'
                  : type === 'evening'
                    ? 'Close the day without automatic changes.'
                    : 'Plan seven readable days deliberately.'}
              </p>
              <Button
                aria-label={`${status.finished ? 'Reopen' : status.started ? 'Continue' : 'Start'} ${REVIEW_LABELS[type]} review`}
                variant={type === selectedType ? 'primary' : 'secondary'}
                onClick={() => {
                  onTypeChange(type);
                  onBegin(type, selectedDate);
                }}
              >
                {status.finished
                  ? 'Reopen review'
                  : status.started
                    ? 'Continue review'
                    : 'Start review'}
              </Button>
            </Surface>
          );
        })}
      </section>
      <Surface className="review-date-choice">
        <label className="field">
          <span>{selectedType === 'weekAhead' ? 'Week starts' : 'Date to review'}</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </label>
        <p>Reviews use local calendar dates and remain available at any time.</p>
      </Surface>
      <ReviewPreferences preferences={preferences} onChange={onPreferencesChange} />
      {records.filter((record) => record.finishedAt).length > 0 ? (
        <section className="recent-reviews" aria-labelledby="recent-reviews-title">
          <h2 id="recent-reviews-title">Recent finished reviews</h2>
          <ul>
            {records
              .filter((record) => record.finishedAt)
              .slice(0, 6)
              .map((record) => (
                <li key={record.id}>
                  <span>
                    {REVIEW_LABELS[record.type]} · {formatLocalDate(record.periodStart)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onTypeChange(record.type);
                      onDateChange(record.periodStart);
                      onBegin(record.type, record.periodStart);
                    }}
                  >
                    Reopen
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ReviewPreferences({
  preferences,
  onChange,
}: {
  preferences: ReviewPreferencesRecord;
  onChange: (
    changes: Partial<Omit<ReviewPreferencesRecord, 'id' | 'createdAt' | 'modifiedAt'>>,
  ) => void;
}) {
  return (
    <details className="review-preferences">
      <summary>Review preferences</summary>
      <div className="review-preferences__grid">
        <label>
          <input
            type="checkbox"
            checked={preferences.morningEnabled}
            onChange={(event) => onChange({ morningEnabled: event.target.checked })}
          />{' '}
          Morning Summary enabled
        </label>
        <label className="field">
          <span>Morning availability time</span>
          <input
            type="time"
            value={preferences.morningTime}
            onChange={(event) => onChange({ morningTime: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.eveningEnabled}
            onChange={(event) => onChange({ eveningEnabled: event.target.checked })}
          />{' '}
          Evening Review enabled
        </label>
        <label className="field">
          <span>Evening availability time</span>
          <input
            type="time"
            value={preferences.eveningTime}
            onChange={(event) => onChange({ eveningTime: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.weekAheadEnabled}
            onChange={(event) => onChange({ weekAheadEnabled: event.target.checked })}
          />{' '}
          Week Ahead enabled
        </label>
        <label className="field">
          <span>Week Ahead weekday</span>
          <select
            value={preferences.weekAheadWeekday}
            onChange={(event) => onChange({ weekAheadWeekday: Number(event.target.value) })}
          >
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
              (day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>Week Ahead availability time</span>
          <input
            type="time"
            value={preferences.weekAheadTime}
            onChange={(event) => onChange({ weekAheadTime: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.showOnHome}
            onChange={(event) => onChange({ showOnHome: event.target.checked })}
          />{' '}
          Offer enabled reviews on Home
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.showCompletedSummary}
            onChange={(event) => onChange({ showCompletedSummary: event.target.checked })}
          />{' '}
          Show factual completed summaries
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.expandedSections.plannedTasks}
            onChange={(event) =>
              onChange({
                expandedSections: {
                  ...preferences.expandedSections,
                  plannedTasks: event.target.checked,
                },
              })
            }
          />{' '}
          Expand key task sections by default
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences.expandedSections.calendar}
            onChange={(event) =>
              onChange({
                expandedSections: {
                  ...preferences.expandedSections,
                  calendar: event.target.checked,
                },
              })
            }
          />{' '}
          Expand calendar sections by default
        </label>
        {(
          [
            ['deadlines', 'Show deadline sections'],
            ['previouslyPlanned', 'Show previously planned sections'],
            ['routines', 'Show routine sections'],
            ['focus', 'Show current focus sections'],
            ['capacity', 'Show capacity sections'],
            ['withoutDuration', 'Show tasks without duration'],
            ['projectNextActions', 'Show project next actions'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={preferences.visibleSections[key]}
              onChange={(event) =>
                onChange({
                  visibleSections: { ...preferences.visibleSections, [key]: event.target.checked },
                })
              }
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <p className="supporting-copy">
        Availability times only control offers inside Planibly. They are not alarms or
        notifications.
      </p>
    </details>
  );
}

type WorkspaceProps = {
  type: ReviewType;
  localDate: string;
  snapshot: PlannerSnapshot;
  morning: ReturnType<typeof morningSummary>;
  evening: ReturnType<typeof eveningReview>;
  week: ReturnType<typeof weekAheadSummary>;
  preferences: ReviewPreferencesRecord;
  actions: ReviewTaskAction[];
  onActionsChange: (actions: ReviewTaskAction[]) => void;
  onEditTask: (task: TaskRecord) => void;
  onEditEvent: (event: CalendarOccurrence) => void;
};

function ReviewWorkspace(props: WorkspaceProps) {
  if (props.type === 'morning') return <MorningWorkspace {...props} />;
  if (props.type === 'evening') return <EveningWorkspace {...props} />;
  return <WeekWorkspace {...props} />;
}

function MorningWorkspace({
  morning,
  snapshot,
  preferences,
  actions,
  onActionsChange,
  onEditTask,
  onEditEvent,
  localDate,
}: WorkspaceProps) {
  return (
    <div className="review-sections">
      <ReviewDetails
        title="Today’s calendar events"
        count={morning.events.length}
        open={preferences.expandedSections.calendar}
      >
        <EventList events={morning.events} onEdit={onEditEvent} />
      </ReviewDetails>
      <ReviewDetails
        title="Today’s planned tasks"
        count={morning.plannedTasks.length}
        open={preferences.expandedSections.plannedTasks}
      >
        <TaskList tasks={morning.plannedTasks} snapshot={snapshot} onEdit={onEditTask} />
      </ReviewDetails>
      {preferences.visibleSections.deadlines ? (
        <ReviewDetails title="Genuine overdue deadlines" count={morning.overdueDeadlines.length}>
          <TaskList tasks={morning.overdueDeadlines} snapshot={snapshot} onEdit={onEditTask} />
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.previouslyPlanned ? (
        <ReviewDetails
          title="Previously planned, still incomplete"
          count={morning.previouslyPlanned.length}
        >
          <PlanningChoices
            tasks={morning.previouslyPlanned}
            snapshot={snapshot}
            defaultDate={localDate}
            actions={actions}
            onChange={onActionsChange}
            onEdit={onEditTask}
          />
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.routines ? (
        <ReviewDetails title="Today’s routines" count={morning.routines.length}>
          <RoutineList routines={morning.routines} localDate={localDate} />
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.focus ? (
        <ReviewDetails title="Current active focus" count={morning.activeFocusTask ? 1 : 0}>
          {morning.activeFocusTask ? (
            <TaskList tasks={[morning.activeFocusTask]} snapshot={snapshot} onEdit={onEditTask} />
          ) : (
            <Empty>Nothing is currently in focus.</Empty>
          )}
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.capacity ? <CapacityDetails summary={morning.capacity} /> : null}
      {preferences.visibleSections.withoutDuration ? (
        <ReviewDetails
          title="Tasks without duration estimates"
          count={morning.tasksWithoutDuration.length}
        >
          <TaskList tasks={morning.tasksWithoutDuration} snapshot={snapshot} onEdit={onEditTask} />
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.projectNextActions ? (
        <ReviewDetails title="Project next actions" count={morning.projectNextActions.length}>
          {morning.projectNextActions.length ? (
            <ul className="review-item-list">
              {morning.projectNextActions.map(({ project, task }) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onEditTask(task)}>
                    {task.title}
                  </button>
                  <span>{project.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No active project next action needs attention.</Empty>
          )}
        </ReviewDetails>
      ) : null}
    </div>
  );
}

function EveningWorkspace({
  evening,
  snapshot,
  preferences,
  actions,
  onActionsChange,
  onEditTask,
  onEditEvent,
  localDate,
}: WorkspaceProps) {
  return (
    <div className="review-sections">
      {preferences.showCompletedSummary ? (
        <ReviewDetails title="Tasks completed today" count={evening.completedTasks.tasks.length}>
          <TaskList tasks={evening.completedTasks.tasks} snapshot={snapshot} onEdit={onEditTask} />
          {evening.completedTasks.historicalCompletedWithoutTimestampCount ? (
            <p className="supporting-copy">
              Some historical completed tasks have no precise completion timestamp and are not
              assigned to this date.
            </p>
          ) : null}
        </ReviewDetails>
      ) : null}
      {preferences.visibleSections.routines ? (
        <>
          <ReviewDetails
            title="Routine runs completed today"
            count={evening.completedRoutineRuns.length}
          >
            <RunList runs={evening.completedRoutineRuns} />
          </ReviewDetails>
          <ReviewDetails title="Routines skipped today" count={evening.skippedRoutineRuns.length}>
            <RunList runs={evening.skippedRoutineRuns} />
          </ReviewDetails>
        </>
      ) : null}
      <ReviewDetails
        title="Planned tasks still incomplete"
        count={evening.incompletePlannedTasks.length}
        open
      >
        <PlanningChoices
          tasks={evening.incompletePlannedTasks}
          snapshot={snapshot}
          defaultDate={addCalendarDays(localDate, 1)}
          quickDateLabels={['Tomorrow', 'Day after tomorrow']}
          actions={actions}
          onChange={onActionsChange}
          onEdit={onEditTask}
        />
      </ReviewDetails>
      <ReviewDetails title="Calendar events from today" count={evening.events.length}>
        <EventList events={evening.events} onEdit={onEditEvent} />
      </ReviewDetails>
      {preferences.visibleSections.focus ? (
        <ReviewDetails title="Current active focus" count={evening.activeFocusTask ? 1 : 0}>
          {evening.activeFocusTask ? (
            <TaskList tasks={[evening.activeFocusTask]} snapshot={snapshot} onEdit={onEditTask} />
          ) : (
            <Empty>Nothing is currently in focus.</Empty>
          )}
        </ReviewDetails>
      ) : null}
      <ReviewDetails
        title="Tomorrow"
        count={
          evening.tomorrow.plannedTasks.length +
          evening.tomorrow.events.length +
          evening.tomorrow.routines.length
        }
      >
        <p>
          {evening.tomorrow.plannedTasks.length} planned tasks · {evening.tomorrow.events.length}{' '}
          events · {evening.tomorrow.routines.length} routines
        </p>
        <CapacitySummaryText summary={evening.tomorrow.capacity} />
      </ReviewDetails>
    </div>
  );
}

function WeekWorkspace({
  week,
  snapshot,
  preferences,
  actions,
  onActionsChange,
  onEditTask,
  onEditEvent,
}: WorkspaceProps) {
  const sourceTasks = uniqueTasks([
    ...week.sources.unscheduled,
    ...week.sources.flexible,
    ...week.sources.upcomingDeadlines,
  ]);
  const plannedTasks = uniqueTasks(
    week.days.flatMap((day) => day.tasks.filter((task) => task.status !== 'completed')),
  );
  return (
    <div className="review-sections">
      <section className="week-review-days" aria-labelledby="week-days-title">
        <h2 id="week-days-title">Seven-day view</h2>
        <div>
          {week.days.map((day) => (
            <Surface key={day.localDate} className="week-review-day">
              <h3>
                {formatLocalDate(day.localDate, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </h3>
              <p>
                {day.events.length} events · {day.tasks.length} tasks · {day.routines.length}{' '}
                routines
              </p>
              <CapacitySummaryText summary={day} />
              <EventList events={day.events} onEdit={onEditEvent} compact />
              {day.tasks.length ? (
                <TaskList tasks={day.tasks} snapshot={snapshot} onEdit={onEditTask} />
              ) : null}
              {day.routines.length ? (
                <RoutineList routines={day.routines} localDate={day.localDate} />
              ) : null}
            </Surface>
          ))}
        </div>
      </section>
      <ReviewDetails title="Tasks to place deliberately" count={sourceTasks.length} open>
        <PlanningChoices
          tasks={sourceTasks}
          snapshot={snapshot}
          defaultDate={week.startDate}
          quickDateLabels={['Week start', 'Following day']}
          actions={actions}
          onChange={onActionsChange}
          onEdit={onEditTask}
        />
      </ReviewDetails>
      <ReviewDetails title="Planned tasks you can move or remove" count={plannedTasks.length}>
        <PlanningChoices
          tasks={plannedTasks}
          snapshot={snapshot}
          defaultDate={week.startDate}
          quickDateLabels={['Week start', 'Following day']}
          actions={actions}
          onChange={onActionsChange}
          onEdit={onEditTask}
        />
      </ReviewDetails>
      {preferences.visibleSections.deadlines ? (
        <ReviewDetails title="Genuine deadlines this week" count={week.genuineDeadlines.length}>
          <TaskList tasks={week.genuineDeadlines} snapshot={snapshot} onEdit={onEditTask} />
        </ReviewDetails>
      ) : null}
      <ReviewDetails title="Blocked tasks" count={week.blockedTasks.length}>
        <TaskList tasks={week.blockedTasks} snapshot={snapshot} onEdit={onEditTask} />
      </ReviewDetails>
      {preferences.visibleSections.projectNextActions ? (
        <ReviewDetails title="Active project next actions" count={week.projectNextActions.length}>
          <ul className="review-item-list">
            {week.projectNextActions.map(({ project, task }) => (
              <li key={task.id}>
                <button type="button" onClick={() => onEditTask(task)}>
                  {task.title}
                </button>
                <span>{project.name}</span>
              </li>
            ))}
          </ul>
        </ReviewDetails>
      ) : null}
      {preferences.showCompletedSummary ? (
        <ReviewDetails
          title="Completed during this week"
          count={week.completed.tasks.length + week.completedRoutineRuns.length}
        >
          <h3>Tasks</h3>
          <TaskList tasks={week.completed.tasks} snapshot={snapshot} onEdit={onEditTask} />
          <h3>Routine runs</h3>
          <RunList runs={week.completedRoutineRuns} />
          {week.completed.historicalCompletedWithoutTimestampCount ? (
            <p className="supporting-copy">
              Some historical completed tasks have no precise completion timestamp and are not
              assigned to this week.
            </p>
          ) : null}
        </ReviewDetails>
      ) : null}
      <Link
        className="button button--secondary"
        to={`/plan?start=${encodeURIComponent(week.startDate)}`}
      >
        Open full seven-day planner
      </Link>
    </div>
  );
}

function ReviewDetails({
  title,
  count,
  open = false,
  children,
}: {
  title: string;
  count: number;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="review-section" open={open}>
      <summary>
        <span>{title}</span>
        <span>{count}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

function CapacityDetails({ summary }: { summary: ReturnType<typeof morningSummary>['capacity'] }) {
  return (
    <ReviewDetails title="Task capacity" count={summary.unknownDurationCount}>
      <CapacitySummaryText summary={summary} />
    </ReviewDetails>
  );
}

function CapacitySummaryText({
  summary,
}: {
  summary: {
    availableMinutes: number | null;
    estimatedMinutes: number;
    remainingMinutes: number | null;
    overMinutes: number;
    unknownDurationCount: number;
  };
}) {
  return (
    <p className="capacity-copy">
      {summary.availableMinutes === null
        ? 'No task capacity is configured.'
        : `${formatDuration(summary.estimatedMinutes)} planned of ${formatDuration(summary.availableMinutes)} capacity.`}
      {summary.overMinutes > 0
        ? ` Guidance: ${formatDuration(summary.overMinutes)} over configured capacity.`
        : summary.remainingMinutes !== null
          ? ` ${formatDuration(summary.remainingMinutes)} remains.`
          : ''}
      {summary.unknownDurationCount ? ` ${summary.unknownDurationCount} without estimates.` : ''}
    </p>
  );
}

function TaskList({
  tasks,
  snapshot,
  onEdit,
}: {
  tasks: TaskRecord[];
  snapshot: PlannerSnapshot;
  onEdit: (task: TaskRecord) => void;
}) {
  if (!tasks.length) return <Empty>Nothing to show here.</Empty>;
  return (
    <ul className="review-item-list">
      {tasks.map((task) => (
        <li key={task.id}>
          <span>
            <button type="button" onClick={() => onEdit(task)}>
              {task.title}
            </button>
            {task.deadlineDate ? (
              <small>Deadline {formatLocalDate(task.deadlineDate)}</small>
            ) : null}
            {(snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0 ? (
              <small>
                Blocked by{' '}
                {snapshot.blockedByTaskId[task.id]!.map(
                  (id) => snapshot.tasks.find((candidate) => candidate.id === id)?.title,
                )
                  .filter(Boolean)
                  .join(', ')}
              </small>
            ) : null}
          </span>
          {task.status !== 'completed' ? (
            <Link to={`/focus/${encodeURIComponent(task.id)}`}>Start focused task</Link>
          ) : (
            <span>Completed</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PlanningChoices({
  tasks,
  snapshot,
  defaultDate,
  quickDateLabels = ['Today / selected day', 'Tomorrow / next day'],
  actions,
  onChange,
  onEdit,
}: {
  tasks: TaskRecord[];
  snapshot: PlannerSnapshot;
  defaultDate: string;
  quickDateLabels?: readonly [string, string];
  actions: ReviewTaskAction[];
  onChange: (actions: ReviewTaskAction[]) => void;
  onEdit: (task: TaskRecord) => void;
}) {
  if (!tasks.length) return <Empty>Nothing needs a planning choice.</Empty>;
  return (
    <ul className="review-planning-list">
      {tasks.map((task) => {
        const action = actions.find((candidate) => candidate.taskId === task.id);
        const value = action?.kind ?? '';
        return (
          <li key={task.id}>
            <div>
              <button type="button" onClick={() => onEdit(task)}>
                {task.title}
              </button>
              <small>
                {effectivePlannedDate(snapshot, task)
                  ? `Currently ${formatLocalDate(effectivePlannedDate(snapshot, task)!)}`
                  : task.flexibleStartDate
                    ? `Flexible ${formatLocalDate(task.flexibleStartDate)} to ${formatLocalDate(task.flexibleEndDate!)}`
                    : 'Not currently planned'}
                {task.deadlineDate && task.deadlineDate < defaultDate
                  ? ` · Genuine deadline ${formatLocalDate(task.deadlineDate)}`
                  : ''}
              </small>
            </div>
            <label className="field">
              <span>Choice for {task.title}</span>
              <select
                value={value}
                onChange={(event) => {
                  const remaining = actions.filter((candidate) => candidate.taskId !== task.id);
                  const kind = event.target.value as ReviewTaskAction['kind'] | '';
                  onChange(
                    kind
                      ? [
                          ...remaining,
                          {
                            taskId: task.id,
                            kind,
                            targetDate: kind === 'move' ? defaultDate : undefined,
                          },
                        ]
                      : remaining,
                  );
                }}
              >
                <option value="">Leave unchanged</option>
                <option value="move">Move or place</option>
                <option value="remove">Remove from plan</option>
                <option value="leave">Record as unchanged</option>
              </select>
            </label>
            {action?.kind === 'move' ? (
              <div className="review-date-actions">
                <label className="field">
                  <span>Destination date</span>
                  <input
                    type="date"
                    min={task.flexibleStartDate}
                    max={task.flexibleEndDate}
                    value={action.targetDate ?? defaultDate}
                    onChange={(event) =>
                      onChange(
                        actions.map((candidate) =>
                          candidate.taskId === task.id
                            ? { ...candidate, targetDate: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        actions.map((candidate) =>
                          candidate.taskId === task.id
                            ? { ...candidate, targetDate: defaultDate }
                            : candidate,
                        ),
                      )
                    }
                  >
                    {quickDateLabels[0]}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        actions.map((candidate) =>
                          candidate.taskId === task.id
                            ? { ...candidate, targetDate: addCalendarDays(defaultDate, 1) }
                            : candidate,
                        ),
                      )
                    }
                  >
                    {quickDateLabels[1]}
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EventList({
  events,
  onEdit,
  compact = false,
}: {
  events: CalendarOccurrence[];
  onEdit: (event: CalendarOccurrence) => void;
  compact?: boolean;
}) {
  if (!events.length) return compact ? null : <Empty>No calendar events.</Empty>;
  return (
    <ul className="review-item-list">
      {events.map((event) => (
        <li key={event.id}>
          <span>
            <button type="button" onClick={() => onEdit(event)}>
              {event.title}
            </button>
            <small>{event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RoutineList({
  routines,
  localDate,
}: {
  routines: ReturnType<typeof morningSummary>['routines'];
  localDate: string;
}) {
  if (!routines.length) return <Empty>No routines are scheduled.</Empty>;
  return (
    <ul className="review-item-list">
      {routines.map(({ routine }) => (
        <li key={routine.id}>
          <span>{routine.name}</span>
          <Link
            to={`/routines?start=${encodeURIComponent(routine.id)}&date=${encodeURIComponent(localDate)}`}
          >
            Start or continue
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RunList({ runs }: { runs: ReturnType<typeof eveningReview>['completedRoutineRuns'] }) {
  if (!runs.length) return <Empty>None recorded for this date.</Empty>;
  return (
    <ul className="review-item-list">
      {runs.map((run) => (
        <li key={run.id}>
          <span>{run.routineName}</span>
          <span>{run.status === 'skipped' ? 'Skipped' : 'Completed'}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewPreviewDialog({
  preview,
  onClose,
  onApprove,
}: {
  preview: ReviewActionPreview;
  onClose: () => void;
  onApprove: () => void;
}) {
  return (
    <Dialog
      title="Preview planning changes"
      description="Nothing changes until you approve."
      onClose={onClose}
    >
      <div className="dialog__body review-preview">
        <ul>
          {preview.items.map((item) => (
            <li
              key={`${item.taskId}-${item.kind}`}
              className={item.valid ? undefined : 'is-invalid'}
            >
              <strong>{item.title}</strong>
              <span>
                {item.unchanged
                  ? 'Will remain unchanged'
                  : item.kind === 'remove'
                    ? `Remove from ${item.currentDate ? formatLocalDate(item.currentDate) : 'the plan'}`
                    : `Move from ${item.currentDate ? formatLocalDate(item.currentDate) : 'unscheduled'} to ${item.proposedDate ? formatLocalDate(item.proposedDate) : 'no date'}`}
              </span>
              {item.blocked ? (
                <span className="supporting-copy">
                  Blocked task: planning is allowed; completion remains unavailable.
                </span>
              ) : null}
              {item.reason ? <span className="form-error">{item.reason}</span> : null}
            </li>
          ))}
        </ul>
        {preview.capacity.length ? (
          <section>
            <h3>Capacity guidance</h3>
            <ul>
              {preview.capacity.map((impact) => (
                <li key={impact.localDate}>
                  {formatLocalDate(impact.localDate)}: {formatDuration(impact.beforeMinutes)} →{' '}
                  {formatDuration(impact.afterMinutes)}
                  {impact.overMinutes ? ` · ${formatDuration(impact.overMinutes)} over` : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!preview.canApply} onClick={onApprove}>
            Approve changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="review-empty">{children}</p>;
}

function uniqueTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()];
}
