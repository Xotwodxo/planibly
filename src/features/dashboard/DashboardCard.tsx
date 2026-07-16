import { useId } from 'react';
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
import type { CalendarEventRecord, PlannerSnapshot, TaskRecord } from '../../data/plannerTypes';
import { openQuickAdd } from '../planner/plannerEvents';
import { TaskPlanningSummary } from '../planner/TaskPlanningSummary';

type DashboardCardProps = {
  config: DashboardCardConfig;
  snapshot: PlannerSnapshot;
  today: string;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
  onEditEvent: (event: CalendarEventRecord) => void;
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
  const data = dashboardCardDataFromSnapshot(snapshot, config.type, today);
  const limit = dashboardTaskLimit(config.size);
  const tasks = data.tasks.slice(0, limit);
  const projectActions = data.projectNextActions.slice(0, limit);
  const events = data.events.slice(0, limit);
  const link = dashboardCardLink(config.type);
  const label = DASHBOARD_CARD_LABELS[config.type];

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
    </li>
  );
}
