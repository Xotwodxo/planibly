import { useEffect, useMemo, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import {
  AGENDA_GROUP_LABELS,
  agendaGroupsFromSnapshot,
  capacitySummaryForDate,
  effectivePlannedDate,
  formatDuration,
  planningSourcesForHorizon,
  previouslyPlannedTasks,
  sevenDayHorizon,
  weekdayForLocalDate,
} from '../data/agenda';
import { agendaRepository } from '../data/agendaRepository';
import {
  eventsForDate,
  scheduledEventMinutes,
  timeOverlaps,
  visibleCalendarEvents,
} from '../data/calendar';
import { addCalendarDays, formatLocalDate, isLocalDate, localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';
import type { CalendarEventRecord, PlannerSnapshot, TaskRecord } from '../data/plannerTypes';
import { EventEditorDialog } from '../features/calendar/EventEditorDialog';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';
import { usePlanningCapacities } from '../features/planner/usePlanningCapacities';

type ReviewAction = 'today' | 'tomorrow' | 'date' | 'remove' | 'leave';

export function PlanPage() {
  const { snapshot, isLoading, error } = usePlannerSnapshot();
  const { capacities, error: capacityError } = usePlanningCapacities();
  const today = localDateFromDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [horizonStart, setHorizonStart] = useState(today);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState(today);
  const [reviewSelectedIds, setReviewSelectedIds] = useState<Set<string>>(new Set());
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction>();
  const [reviewDate, setReviewDate] = useState(today);

  const groups = useMemo(
    () => agendaGroupsFromSnapshot(snapshot, selectedDate),
    [selectedDate, snapshot],
  );
  const dayEvents = useMemo(
    () => eventsForDate(visibleCalendarEvents(snapshot), selectedDate),
    [selectedDate, snapshot],
  );
  const overlaps = useMemo(
    () =>
      timeOverlaps(
        dayEvents,
        groups.flatMap((group) => group.tasks),
        selectedDate,
      ),
    [dayEvents, groups, selectedDate],
  );
  const horizon = useMemo(
    () => sevenDayHorizon(snapshot, capacities, horizonStart),
    [capacities, horizonStart, snapshot],
  );
  const sources = useMemo(
    () => planningSourcesForHorizon(snapshot, horizonStart),
    [horizonStart, snapshot],
  );
  const earlier = useMemo(() => previouslyPlannedTasks(snapshot, today), [snapshot, today]);

  if (isLoading) return <p role="status">Opening your plan…</p>;

  async function act(action: () => Promise<void>, success: string) {
    try {
      await action();
      setAnnouncement(success);
    } catch (caughtError) {
      setAnnouncement(
        caughtError instanceof Error ? caughtError.message : 'The plan could not update.',
      );
    }
  }

  async function complete(task: TaskRecord, completed: boolean) {
    await act(
      () => plannerRepository.setTaskCompleted(task.id, completed),
      completed ? `${task.title} completed.` : `${task.title} returned to the plan.`,
    );
  }

  async function applyBulk(move: boolean) {
    const ids = [...selectedTaskIds];
    await act(
      () => (move ? agendaRepository.moveTasks(ids, bulkDate) : agendaRepository.unplanTasks(ids)),
      move
        ? `Moved ${ids.length} task${ids.length === 1 ? '' : 's'}.`
        : `Removed ${ids.length} task${ids.length === 1 ? '' : 's'} from their days.`,
    );
    setSelectedTaskIds(new Set());
  }

  async function confirmReview() {
    if (!reviewAction) return;
    const ids = [...reviewSelectedIds];
    if (reviewAction === 'leave') {
      setAnnouncement('Earlier plans left unchanged.');
    } else if (reviewAction === 'remove') {
      await act(
        () => agendaRepository.unplanTasks(ids),
        `Removed ${ids.length} earlier plan${ids.length === 1 ? '' : 's'}.`,
      );
    } else {
      const destination =
        reviewAction === 'today'
          ? today
          : reviewAction === 'tomorrow'
            ? addCalendarDays(today, 1)
            : reviewDate;
      await act(
        () => agendaRepository.moveTasks(ids, destination),
        `Moved ${ids.length} earlier plan${ids.length === 1 ? '' : 's'}.`,
      );
    }
    setReviewAction(undefined);
    setReviewSelectedIds(new Set());
  }

  const heading =
    selectedDate === today
      ? 'Today'
      : formatLocalDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page page--plan">
      <header className="plan-heading">
        <span className="eyebrow">Plan</span>
        <h1>Shape time with intention</h1>
        <p>Build a realistic day without turning an intention into a deadline.</p>
      </header>
      {error || capacityError ? (
        <p role="alert" className="form-error">
          {error ?? capacityError}
        </p>
      ) : null}

      {!reviewDismissed && earlier.length > 0 ? (
        <PreviouslyPlanned
          tasks={earlier}
          snapshot={snapshot}
          selected={reviewSelectedIds}
          onSelect={setReviewSelectedIds}
          onReview={setReviewAction}
          onDismiss={() => setReviewDismissed(true)}
        />
      ) : null}

      <div className="agenda-date-controls" aria-label="Day navigation">
        <Button
          variant="quiet"
          type="button"
          onClick={() => setSelectedDate(addCalendarDays(selectedDate, -1))}
        >
          Previous day
        </Button>
        <label>
          Agenda date
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              if (isLocalDate(event.target.value)) setSelectedDate(event.target.value);
            }}
          />
        </label>
        <Button variant="secondary" type="button" onClick={() => setSelectedDate(today)}>
          Today
        </Button>
        <Button
          variant="quiet"
          type="button"
          onClick={() => setSelectedDate(addCalendarDays(selectedDate, 1))}
        >
          Next day
        </Button>
      </div>

      <CapacityPanel
        localDate={selectedDate}
        summary={capacitySummaryForDate(snapshot, capacities, selectedDate)}
        capacities={capacities}
        onMessage={setAnnouncement}
      />

      <Surface className="plan-section agenda-focus" aria-labelledby="focused-agenda-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Daily agenda</span>
            <h2 id="focused-agenda-heading">{heading}</h2>
          </div>
          <span>
            {dayEvents.length} events ·{' '}
            {groups.reduce((total, group) => total + group.tasks.length, 0)} tasks
          </span>
        </div>
        <section className="agenda-group agenda-events" aria-labelledby="agenda-events-heading">
          <h3 id="agenda-events-heading">Appointments</h3>
          {dayEvents.length ? (
            <>
              {dayEvents.some((event) => event.allDay) ? (
                <>
                  <h4>All-day events</h4>
                  <ul className="calendar-event-list">
                    {dayEvents
                      .filter((event) => event.allDay)
                      .map((event) => (
                        <li key={event.id}>
                          <button type="button" onClick={() => setEditingEvent(event)}>
                            <span className="event-kind">
                              {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}
                            </span>
                            <strong>{event.title}</strong>
                            <span>
                              {
                                snapshot.calendars.find(
                                  (calendar) => calendar.id === event.calendarId,
                                )?.name
                              }
                            </span>
                            {event.location ? <small>{event.location}</small> : null}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
              {dayEvents.some((event) => !event.allDay) ? (
                <>
                  <h4>Timed events</h4>
                  <ul className="calendar-event-list">
                    {dayEvents
                      .filter((event) => !event.allDay)
                      .map((event) => (
                        <li key={event.id}>
                          <button type="button" onClick={() => setEditingEvent(event)}>
                            <span className="event-kind">
                              {event.startTime}–{event.endTime}
                            </span>
                            <strong>{event.title}</strong>
                            <span>
                              {
                                snapshot.calendars.find(
                                  (calendar) => calendar.id === event.calendarId,
                                )?.name
                              }
                            </span>
                            {event.location ? <small>{event.location}</small> : null}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="plan-empty">No appointments on this day.</p>
          )}
          {scheduledEventMinutes(dayEvents, selectedDate) > 0 ? (
            <p className="event-duration-summary">
              Scheduled events: {formatDuration(scheduledEventMinutes(dayEvents, selectedDate))}.
              This is separate from your task-capacity setting.
            </p>
          ) : null}
          {overlaps.length ? (
            <div className="overlap-notice" role="status">
              <strong>Time overlaps</strong>
              <ul>
                {overlaps.map(({ left, right }) => (
                  <li key={`${left.kind}-${left.id}-${right.kind}-${right.id}`}>
                    {left.label} overlaps {right.label}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        {groups.map((group) => (
          <section
            className="agenda-group"
            key={group.group}
            aria-labelledby={`agenda-${group.group}`}
          >
            <h3 id={`agenda-${group.group}`}>{AGENDA_GROUP_LABELS[group.group]}</h3>
            {group.tasks.length ? (
              <ul className="plan-task-list">
                {group.tasks.map((task, index) => (
                  <AgendaTaskRow
                    key={task.id}
                    task={task}
                    snapshot={snapshot}
                    today={today}
                    canMove={group.group !== 'exact'}
                    isFirst={index === 0}
                    isLast={index === group.tasks.length - 1}
                    onComplete={complete}
                    onEdit={setEditingTask}
                    onUnplan={(candidate) =>
                      act(
                        () => agendaRepository.unplanTask(candidate.id),
                        `Removed ${candidate.title} from the day.`,
                      )
                    }
                    onMove={(candidate, direction) =>
                      act(
                        () => agendaRepository.moveWithinGroup(candidate.id, direction),
                        `Moved ${candidate.title}.`,
                      )
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="plan-empty">No tasks in this part of the day.</p>
            )}
          </section>
        ))}
      </Surface>

      <Surface className="plan-section horizon-panel" aria-labelledby="horizon-heading">
        <div className="section-heading horizon-heading">
          <div>
            <span className="eyebrow">Seven-day horizon</span>
            <h2 id="horizon-heading">Plan the week ahead</h2>
          </div>
          <label>
            Starting date
            <input
              type="date"
              value={horizonStart}
              onChange={(event) => {
                if (isLocalDate(event.target.value)) setHorizonStart(event.target.value);
              }}
            />
          </label>
        </div>
        {selectedTaskIds.size > 0 ? (
          <div className="selection-toolbar" role="group" aria-label="Selected task actions">
            <strong>{selectedTaskIds.size} selected</strong>
            <label>
              Move to
              <input
                type="date"
                value={bulkDate}
                onChange={(event) => setBulkDate(event.target.value)}
              />
            </label>
            <Button type="button" onClick={() => void applyBulk(true)}>
              Move selected
            </Button>
            <Button variant="secondary" type="button" onClick={() => void applyBulk(false)}>
              Remove from days
            </Button>
            <Button variant="quiet" type="button" onClick={() => setSelectedTaskIds(new Set())}>
              Cancel selection
            </Button>
          </div>
        ) : null}
        <div className="horizon-grid">
          {horizon.map((day) => (
            <article className="horizon-day" key={day.localDate}>
              <button
                type="button"
                className="horizon-day__heading"
                onClick={() => setSelectedDate(day.localDate)}
              >
                <strong>
                  {day.localDate === today
                    ? 'Today'
                    : formatLocalDate(day.localDate, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                </strong>
                <span>
                  {day.tasks.length} tasks · {capacityLine(day)}
                </span>
              </button>
              {day.tasks.length ? (
                <ul>
                  {day.tasks.map((task) => (
                    <li key={task.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.has(task.id)}
                          onChange={() => setSelectedTaskIds(toggleId(selectedTaskIds, task.id))}
                        />
                        <span className="visually-hidden">Select {task.title}</span>
                      </label>
                      <button type="button" onClick={() => setEditingTask(task)}>
                        {task.title}
                      </button>
                      <button
                        type="button"
                        className="horizon-complete"
                        disabled={
                          task.status !== 'completed' &&
                          (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0
                        }
                        onClick={() => void complete(task, task.status !== 'completed')}
                      >
                        {task.status === 'completed' ? 'Uncomplete' : 'Complete'}
                        <span className="visually-hidden"> {task.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Open for planning.</p>
              )}
            </article>
          ))}
        </div>
      </Surface>

      <div className="planning-sources">
        <PlanningSource
          title="Unscheduled"
          empty="No unscheduled tasks."
          tasks={sources.unscheduled}
          snapshot={snapshot}
          defaultDate={selectedDate}
          onEdit={setEditingTask}
          onMessage={setAnnouncement}
        />
        <PlanningSource
          title="Flexible range tasks"
          empty="No flexible tasks overlap this week."
          tasks={sources.flexible}
          snapshot={snapshot}
          defaultDate={selectedDate}
          onEdit={setEditingTask}
          onMessage={setAnnouncement}
        />
        <PlanningSource
          title="Upcoming deadlines"
          empty="No upcoming deadlines need placing."
          tasks={sources.upcomingDeadlines}
          snapshot={snapshot}
          defaultDate={selectedDate}
          onEdit={setEditingTask}
          onMessage={setAnnouncement}
        />
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {editingTask ? (
        <TaskEditorDialog
          task={editingTask}
          snapshot={snapshot}
          onClose={() => setEditingTask(null)}
        />
      ) : null}
      {editingEvent ? (
        <EventEditorDialog
          event={editingEvent}
          calendars={snapshot.calendars}
          initialDate={selectedDate}
          onAnnounce={setAnnouncement}
          onClose={() => setEditingEvent(null)}
        />
      ) : null}
      {reviewAction ? (
        <ReviewDialog
          action={reviewAction}
          count={reviewSelectedIds.size}
          reviewDate={reviewDate}
          onDate={setReviewDate}
          onClose={() => setReviewAction(undefined)}
          onConfirm={() => void confirmReview()}
        />
      ) : null}
    </div>
  );
}

function CapacityPanel({
  localDate,
  summary,
  capacities,
  onMessage,
}: {
  localDate: string;
  summary: ReturnType<typeof capacitySummaryForDate>;
  capacities: Awaited<ReturnType<typeof agendaRepository.getCapacities>>;
  onMessage: (message: string) => void;
}) {
  const weekday = weekdayForLocalDate(localDate);
  const [weekdayMinutes, setWeekdayMinutes] = useState('240');
  const [dateMinutes, setDateMinutes] = useState('240');
  const weekdayRecord = capacities
    .filter((record) => record.kind === 'weekday' && record.weekday === weekday)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))[0];
  const dateRecord = capacities
    .filter((record) => record.kind === 'date' && record.localDate === localDate)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))[0];
  const override = dateRecord !== undefined;
  useEffect(() => {
    setWeekdayMinutes(
      typeof weekdayRecord?.minutes === 'number' ? String(weekdayRecord.minutes) : '',
    );
    setDateMinutes(typeof dateRecord?.minutes === 'number' ? String(dateRecord.minutes) : '');
  }, [
    dateRecord?.minutes,
    dateRecord?.modifiedAt,
    localDate,
    weekdayRecord?.minutes,
    weekdayRecord?.modifiedAt,
  ]);
  const percentage =
    summary.availableMinutes && summary.availableMinutes > 0
      ? Math.min(100, Math.round((summary.estimatedMinutes / summary.availableMinutes) * 100))
      : 0;
  async function save(action: () => Promise<void>, message: string) {
    try {
      await action();
      onMessage(message);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Capacity could not update.');
    }
  }
  return (
    <Surface className="capacity-panel" aria-labelledby="capacity-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Capacity</span>
          <h2 id="capacity-heading">A realistic shape for the day</h2>
        </div>
        <strong>
          {summary.availableMinutes === null
            ? 'No capacity set'
            : `${formatDuration(summary.availableMinutes)} available`}
        </strong>
      </div>
      <div className="capacity-summary">
        <div>
          <strong>{formatDuration(summary.estimatedMinutes)}</strong>
          <span>estimated</span>
        </div>
        <div>
          <strong>
            {summary.remainingMinutes === null
              ? '—'
              : summary.overMinutes > 0
                ? `${formatDuration(summary.overMinutes)} over`
                : formatDuration(summary.remainingMinutes)}
          </strong>
          <span>{summary.overMinutes > 0 ? 'above capacity' : 'remaining'}</span>
        </div>
        <div>
          <strong>{summary.unknownDurationCount}</strong>
          <span>without estimates</span>
        </div>
        <div>
          <strong>{summary.blockedCount}</strong>
          <span>blocked</span>
        </div>
      </div>
      {summary.availableMinutes !== null ? (
        <progress max="100" value={percentage} aria-label={`${percentage}% of capacity planned`} />
      ) : null}
      <details className="capacity-editor">
        <summary>Adjust capacity</summary>
        <div className="capacity-editor__forms">
          <fieldset>
            <legend>Weekday default</legend>
            <p>
              Used for every{' '}
              {new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
                new Date(Date.UTC(2023, 0, weekday + 1)),
              )}{' '}
              unless a date override exists.
            </p>
            <label>
              Minutes
              <input
                type="number"
                min="1"
                max="1440"
                value={weekdayMinutes}
                onChange={(event) => setWeekdayMinutes(event.target.value)}
              />
            </label>
            <CapacityPresets onChoose={setWeekdayMinutes} label="Weekday capacity presets" />
            <div className="inline-actions">
              <Button
                type="button"
                onClick={() =>
                  void save(
                    () => agendaRepository.setWeekdayCapacity(weekday, Number(weekdayMinutes)),
                    'Weekday capacity saved.',
                  )
                }
              >
                Save default
              </Button>
              <Button
                variant="quiet"
                type="button"
                onClick={() =>
                  void save(
                    () => agendaRepository.setWeekdayCapacity(weekday, null),
                    'Weekday set to no capacity.',
                  )
                }
              >
                No capacity
              </Button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Date override</legend>
            <p>
              {override
                ? 'This date has its own setting.'
                : 'This date currently uses the weekday default.'}
            </p>
            <label>
              Minutes
              <input
                type="number"
                min="1"
                max="1440"
                value={dateMinutes}
                onChange={(event) => setDateMinutes(event.target.value)}
              />
            </label>
            <CapacityPresets onChoose={setDateMinutes} label="Date capacity presets" />
            <div className="inline-actions">
              <Button
                type="button"
                onClick={() =>
                  void save(
                    () => agendaRepository.setDateCapacity(localDate, Number(dateMinutes)),
                    'Date capacity saved.',
                  )
                }
              >
                Save override
              </Button>
              <Button
                variant="quiet"
                type="button"
                onClick={() =>
                  void save(
                    () => agendaRepository.setDateCapacity(localDate, null),
                    'Date set to no capacity.',
                  )
                }
              >
                No capacity
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() =>
                  void save(
                    () => agendaRepository.clearDateCapacity(localDate),
                    'Using the weekday default.',
                  )
                }
              >
                Use weekday default
              </Button>
            </div>
          </fieldset>
        </div>
      </details>
    </Surface>
  );
}

function CapacityPresets({
  onChoose,
  label,
}: {
  onChoose: (value: string) => void;
  label: string;
}) {
  return (
    <div className="capacity-presets" aria-label={label}>
      {[120, 240, 360].map((minutes) => (
        <Button
          key={minutes}
          variant="quiet"
          type="button"
          onClick={() => onChoose(String(minutes))}
        >
          {minutes / 60} hours
        </Button>
      ))}
    </div>
  );
}

function AgendaTaskRow({
  task,
  snapshot,
  today,
  canMove,
  isFirst,
  isLast,
  onComplete,
  onEdit,
  onUnplan,
  onMove,
}: {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  today: string;
  canMove: boolean;
  isFirst: boolean;
  isLast: boolean;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
  onUnplan: (task: TaskRecord) => Promise<void>;
  onMove: (task: TaskRecord, direction: -1 | 1) => Promise<void>;
}) {
  const blockers = (snapshot.blockedByTaskId[task.id] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id)?.title)
    .filter((title): title is string => Boolean(title));
  const list = snapshot.lists.find((candidate) => candidate.id === task.listId);
  return (
    <li
      className={`plan-task${blockers.length ? ' is-blocked' : ''}${task.status === 'completed' ? ' is-completed' : ''}`}
    >
      <label className="task-check">
        <input
          type="checkbox"
          disabled={blockers.length > 0 && task.status !== 'completed'}
          checked={task.status === 'completed'}
          onChange={(event) => void onComplete(task, event.target.checked)}
        />
        <span className="visually-hidden">Complete {task.title}</span>
      </label>
      <div>
        <button type="button" className="task-title" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <span className="planning-summary">
          {task.exactStartTime ? `${task.exactStartTime} · ` : ''}
          {list?.name}
          {list?.mode === 'project' ? ' · Project' : ''}
          {task.estimatedDurationMinutes
            ? ` · ${formatDuration(task.estimatedDurationMinutes)}`
            : ''}
          {task.deadlineDate
            ? ` · ${task.deadlineDate < today ? 'Overdue deadline' : 'Deadline'} ${formatLocalDate(task.deadlineDate)}`
            : ''}
        </span>
        {blockers.length ? (
          <span className="blocked-label">Blocked by {blockers.join(', ')}</span>
        ) : null}
      </div>
      <div className="plan-task__actions">
        <Button variant="quiet" type="button" onClick={() => onEdit(task)}>
          Edit
        </Button>
        {canMove ? (
          <>
            <Button
              variant="quiet"
              type="button"
              disabled={isFirst}
              aria-label={`Move ${task.title} up`}
              onClick={() => void onMove(task, -1)}
            >
              ↑
            </Button>
            <Button
              variant="quiet"
              type="button"
              disabled={isLast}
              aria-label={`Move ${task.title} down`}
              onClick={() => void onMove(task, 1)}
            >
              ↓
            </Button>
          </>
        ) : null}
        <Button variant="quiet" type="button" onClick={() => void onUnplan(task)}>
          Unplan
        </Button>
      </div>
    </li>
  );
}

function PlanningSource({
  title,
  empty,
  tasks,
  snapshot,
  defaultDate,
  onEdit,
  onMessage,
}: {
  title: string;
  empty: string;
  tasks: TaskRecord[];
  snapshot: PlannerSnapshot;
  defaultDate: string;
  onEdit: (task: TaskRecord) => void;
  onMessage: (message: string) => void;
}) {
  const id = `source-${title.toLowerCase().replaceAll(' ', '-')}`;
  return (
    <Surface className="plan-section" aria-labelledby={id}>
      <div className="section-heading">
        <h2 id={id}>{title}</h2>
        <span>{tasks.length}</span>
      </div>
      {tasks.length ? (
        <ul className="source-list">
          {tasks.map((task) => (
            <PlanningSourceTask
              key={task.id}
              task={task}
              snapshot={snapshot}
              defaultDate={defaultDate}
              onEdit={onEdit}
              onMessage={onMessage}
            />
          ))}
        </ul>
      ) : (
        <p className="plan-empty">{empty}</p>
      )}
    </Surface>
  );
}

function PlanningSourceTask({
  task,
  snapshot,
  defaultDate,
  onEdit,
  onMessage,
}: {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  defaultDate: string;
  onEdit: (task: TaskRecord) => void;
  onMessage: (message: string) => void;
}) {
  const initialDate =
    task.flexibleStartDate &&
    (defaultDate < task.flexibleStartDate ||
      defaultDate > (task.flexibleEndDate ?? task.flexibleStartDate))
      ? task.flexibleStartDate
      : defaultDate;
  const [date, setDate] = useState(initialDate);
  const blocked = (snapshot.blockedByTaskId[task.id]?.length ?? 0) > 0;
  return (
    <li>
      <div>
        <button className="task-title" type="button" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        {task.flexibleStartDate ? (
          <span>
            Flexible {formatLocalDate(task.flexibleStartDate)}–
            {formatLocalDate(task.flexibleEndDate!)}
          </span>
        ) : task.deadlineDate ? (
          <span>Deadline {formatLocalDate(task.deadlineDate)}</span>
        ) : null}
        {blocked ? (
          <span className="blocked-label">
            Blocked tasks can be placed, but cannot be completed yet.
          </span>
        ) : null}
      </div>
      <label>
        Plan on<span className="visually-hidden"> date for {task.title}</span>
        <input
          type="date"
          value={date}
          min={task.flexibleStartDate}
          max={task.flexibleEndDate}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <Button
        type="button"
        onClick={() =>
          void agendaRepository
            .planTask(task.id, date)
            .then(() => onMessage(`${task.title} planned.`))
            .catch((error: unknown) =>
              onMessage(error instanceof Error ? error.message : 'Task could not be planned.'),
            )
        }
      >
        Plan
      </Button>
    </li>
  );
}

function PreviouslyPlanned({
  tasks,
  snapshot,
  selected,
  onSelect,
  onReview,
  onDismiss,
}: {
  tasks: TaskRecord[];
  snapshot: PlannerSnapshot;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onReview: (action: ReviewAction) => void;
  onDismiss: () => void;
}) {
  return (
    <Surface className="previously-planned" aria-labelledby="previously-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Review</span>
          <h2 id="previously-heading">Previously planned</h2>
        </div>
        <Button variant="quiet" type="button" onClick={onDismiss}>
          Dismiss for now
        </Button>
      </div>
      <p>
        These incomplete tasks were planned before today. They are not overdue unless they also have
        an earlier deadline.
      </p>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(task.id)}
                onChange={() => onSelect(toggleId(selected, task.id))}
              />
              {task.title}
            </label>
            <span>Planned {formatLocalDate(effectivePlannedDate(snapshot, task)!)}</span>
          </li>
        ))}
      </ul>
      {selected.size ? (
        <div className="inline-actions" aria-label="Previously planned actions">
          <Button type="button" onClick={() => onReview('today')}>
            Move to today
          </Button>
          <Button variant="secondary" type="button" onClick={() => onReview('tomorrow')}>
            Move to tomorrow
          </Button>
          <Button variant="secondary" type="button" onClick={() => onReview('date')}>
            Choose date
          </Button>
          <Button variant="quiet" type="button" onClick={() => onReview('remove')}>
            Remove day
          </Button>
          <Button variant="quiet" type="button" onClick={() => onReview('leave')}>
            Leave unchanged
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

function ReviewDialog({
  action,
  count,
  reviewDate,
  onDate,
  onClose,
  onConfirm,
}: {
  action: ReviewAction;
  count: number;
  reviewDate: string;
  onDate: (date: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const labels: Record<ReviewAction, string> = {
    today: 'move to today',
    tomorrow: 'move to tomorrow',
    date: 'move to another date',
    remove: 'remove from the plan',
    leave: 'leave unchanged',
  };
  return (
    <Dialog
      title="Review earlier plans"
      description={`You are about to ${labels[action]} for ${count} task${count === 1 ? '' : 's'}. Nothing happens until you confirm.`}
      onClose={onClose}
    >
      {action === 'date' ? (
        <label className="field">
          New date
          <input type="date" value={reviewDate} onChange={(event) => onDate(event.target.value)} />
        </label>
      ) : null}
      <div className="dialog__actions">
        <Button variant="quiet" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </Dialog>
  );
}

function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function capacityLine(day: ReturnType<typeof sevenDayHorizon>[number]): string {
  if (day.availableMinutes === null) return `${formatDuration(day.estimatedMinutes)} estimated`;
  if (day.overMinutes > 0) return `${formatDuration(day.overMinutes)} over`;
  return `${formatDuration(day.remainingMinutes ?? 0)} free`;
}
