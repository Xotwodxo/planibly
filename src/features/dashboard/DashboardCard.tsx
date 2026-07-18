import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Surface } from '../../components/ui/Surface';
import {
  DASHBOARD_CARD_LABELS,
  dashboardCardDataFromSnapshot,
  dashboardCardLink,
  dashboardEmptyMessage,
  dashboardTaskLimit,
} from '../../data/dashboard';
import type { DashboardCardConfig } from '../../data/dashboardTypes';
import type { CalendarOccurrence, PlannerSnapshot, TaskRecord } from '../../data/plannerTypes';
import { openQuickAdd } from '../planner/plannerEvents';
import { TaskPlanningSummary } from '../planner/TaskPlanningSummary';
import { formatCountdown } from '../../data/focus';
import { focusRepository } from '../../data/focusRepository';

type DashboardCardProps = {
  config: DashboardCardConfig;
  snapshot: PlannerSnapshot;
  today: string;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
  onEditEvent: (event: CalendarOccurrence) => void;
};

export function DashboardCard({
  config,
  snapshot,
  today,
  onComplete,
  onEdit,
  onEditEvent,
}: DashboardCardProps) {
  const headingId = useId();
  const [clock, setClock] = useState(() => new Date());
  const data = dashboardCardDataFromSnapshot(snapshot, config.type, today, clock);
  const limit = dashboardTaskLimit(config.size);
  const tasks = data.tasks.slice(0, limit);
  const projectActions = data.projectNextActions.slice(0, limit);
  const events = data.events.slice(0, limit);
  const link = dashboardCardLink(config.type);
  const label = DASHBOARD_CARD_LABELS[config.type];
  const [confirmEndFocus, setConfirmEndFocus] = useState(false);

  useEffect(() => {
    if (config.type !== 'currentFocus' || snapshot.activeFocus?.countdownState !== 'running')
      return;
    const interval = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, [config.type, snapshot.activeFocus?.countdownEndsAt, snapshot.activeFocus?.countdownState]);

  return (
    <Surface
      className={`dashboard-card dashboard-card--${config.size}`}
      aria-labelledby={headingId}
      data-card-type={config.type}
      data-card-size={config.size}
    >
      <header className="dashboard-card__heading">
        <div>
          <h2 id={headingId}>{label}</h2>
          {config.type !== 'quickAdd' ? <span>{data.totalCount}</span> : null}
        </div>
        {link ? <Link to={link}>View all</Link> : null}
      </header>

      {config.type === 'quickAdd' ? (
        <div className="dashboard-quick-add">
          <p>{dashboardEmptyMessage('quickAdd')}</p>
          <Button type="button" onClick={openQuickAdd}>
            Add a task
          </Button>
        </div>
      ) : config.type === 'currentFocus' && data.currentFocus ? (
        <div className="dashboard-current-focus">
          <div>
            <strong>{data.currentFocus.title}</strong>
            {data.currentFocus.currentStep ? (
              <span>Current step: {data.currentFocus.currentStep}</span>
            ) : (
              <span>Work from the task title</span>
            )}
            {data.currentFocus.countdownState !== 'none' ? (
              <span>
                Countdown {data.currentFocus.countdownState} ·{' '}
                {formatCountdown(data.currentFocus.remainingSeconds)}
              </span>
            ) : null}
          </div>
          <div className="dashboard-current-focus__actions">
            <Link
              className="button button--secondary"
              to={`/focus/${encodeURIComponent(data.currentFocus.taskId)}`}
            >
              Continue
            </Link>
            {confirmEndFocus ? (
              <>
                <Button
                  variant="quiet"
                  onClick={() =>
                    void focusRepository.endFocus().then(() => setConfirmEndFocus(false))
                  }
                >
                  Confirm End Focus
                </Button>
                <Button variant="quiet" onClick={() => setConfirmEndFocus(false)}>
                  Keep focus
                </Button>
              </>
            ) : (
              <Button variant="quiet" onClick={() => setConfirmEndFocus(true)}>
                End Focus
              </Button>
            )}
          </div>
        </div>
      ) : config.type === 'currentFocus' ? (
        <div className="dashboard-card__empty dashboard-focus-empty">
          <p>{dashboardEmptyMessage('currentFocus')}</p>
          <Link to="/lists">Start a Task</Link>
        </div>
      ) : config.type === 'currentRoutine' && data.currentRoutine ? (
        <div className="dashboard-current-routine">
          <span
            className="routine-color"
            style={{ backgroundColor: data.currentRoutine.color }}
            aria-hidden="true"
          />
          <div>
            <strong>{data.currentRoutine.name}</strong>
            {data.currentRoutine.currentItem ? (
              <span>{data.currentRoutine.currentItem}</span>
            ) : null}
            <span>
              {data.currentRoutine.completed} of {data.currentRoutine.total}
            </span>
          </div>
          <Link
            className="button button--secondary"
            to={
              data.currentRoutine.runId
                ? `/routines?run=${encodeURIComponent(data.currentRoutine.runId)}`
                : `/routines?start=${encodeURIComponent(data.currentRoutine.routineId)}&date=${encodeURIComponent(today)}`
            }
          >
            {data.currentRoutine.action}
          </Link>
        </div>
      ) : tasks.length > 0 || events.length > 0 ? (
        <>
          {events.length ? (
            <ul className="dashboard-task-list dashboard-event-list">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="dashboard-event-mark" aria-hidden="true">
                    ●
                  </span>
                  <div>
                    <button type="button" className="task-title" onClick={() => onEditEvent(event)}>
                      {event.title}
                    </button>
                    <span className="task-location">
                      {event.isRecurring ? 'Repeats · ' : ''}
                      Appointment ·{' '}
                      {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`} ·{' '}
                      {
                        snapshot.calendars.find((calendar) => calendar.id === event.calendarId)
                          ?.name
                      }
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="dashboard-task-list">
            {tasks.map((task) => (
              <DashboardTask
                key={task.id}
                task={task}
                snapshot={snapshot}
                today={today}
                completedCard={config.type === 'recentlyCompleted'}
                onComplete={onComplete}
                onEdit={onEdit}
              />
            ))}
          </ul>
        </>
      ) : projectActions.length > 0 ? (
        <ul className="dashboard-task-list">
          {projectActions.map(({ project, task }) => (
            <DashboardTask
              key={task.id}
              task={task}
              snapshot={snapshot}
              today={today}
              location={project.name}
              locationUrl={`/lists?list=${encodeURIComponent(project.id)}`}
              onComplete={onComplete}
              onEdit={onEdit}
            />
          ))}
        </ul>
      ) : (
        <p className="dashboard-card__empty">{dashboardEmptyMessage(config.type)}</p>
      )}
    </Surface>
  );
}

function DashboardTask({
  task,
  snapshot,
  today,
  location,
  locationUrl,
  completedCard = false,
  onComplete,
  onEdit,
}: {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  today: string;
  location?: string;
  locationUrl?: string;
  completedCard?: boolean;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
}) {
  const blockerNames = (snapshot.blockedByTaskId[task.id] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id)?.title)
    .filter((title): title is string => Boolean(title));
  return (
    <li className={blockerNames.length ? 'is-blocked' : undefined}>
      {!completedCard ? (
        <label className="task-check">
          <input
            type="checkbox"
            checked={task.status === 'completed'}
            disabled={blockerNames.length > 0}
            onChange={(event) => void onComplete(task, event.target.checked)}
          />
          <span className="visually-hidden">Complete {task.title}</span>
        </label>
      ) : (
        <span className="dashboard-completed-mark" aria-hidden="true">
          <span aria-hidden="true">&#10003;</span>
        </span>
      )}
      <div>
        <button type="button" className="task-title" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        {location ? (
          locationUrl ? (
            <Link className="task-location" to={locationUrl}>
              Open {location}
            </Link>
          ) : (
            <span className="task-location">{location}</span>
          )
        ) : null}
        <TaskPlanningSummary task={task} today={today} />
        {blockerNames.length > 0 ? (
          <span className="blocked-label">Blocked by {blockerNames.join(', ')}</span>
        ) : null}
      </div>
      {!completedCard && task.status !== 'completed' ? (
        <Link
          className="task-start-link"
          to={`/focus/${encodeURIComponent(task.id)}`}
          aria-label={`Start ${task.title}`}
        >
          Start
        </Link>
      ) : null}
    </li>
  );
}
