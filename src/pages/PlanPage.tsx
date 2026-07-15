import { useMemo, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Surface } from '../components/ui/Surface';
import { plannerRepository } from '../data/plannerRepository';
import { localDateFromDate, planningOverviewFromSnapshot } from '../data/planning';
import type { PlannerSnapshot, TaskPlanning, TaskRecord } from '../data/plannerTypes';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { TaskPlanningSummary } from '../features/planner/TaskPlanningSummary';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';

export function PlanPage() {
  const { snapshot, isLoading, error } = usePlannerSnapshot();
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const today = localDateFromDate(new Date());
  const overview = useMemo(() => planningOverviewFromSnapshot(snapshot, today), [snapshot, today]);

  if (isLoading) return <p role="status">Opening your plan…</p>;

  const sections = [
    { id: 'today', title: 'Today', tasks: overview.today, empty: 'Nothing is planned for today.' },
    {
      id: 'next-three-days',
      title: 'Next Three Days',
      tasks: overview.nextThreeDays,
      empty: 'The rest of this three-day window is open.',
    },
    {
      id: 'flexible',
      title: 'Flexible range tasks',
      tasks: overview.flexible,
      empty: 'No tasks have a flexible date range.',
    },
    {
      id: 'deadlines',
      title: 'Upcoming deadlines',
      tasks: overview.upcomingDeadlines,
      empty: 'No upcoming deadlines.',
    },
    {
      id: 'unscheduled',
      title: 'Unscheduled',
      tasks: overview.unscheduled,
      empty: 'Everything has a place in time.',
    },
  ];

  async function complete(task: TaskRecord, completed: boolean) {
    try {
      await plannerRepository.setTaskCompleted(task.id, completed);
      setAnnouncement(completed ? `${task.title} completed.` : `${task.title} returned to plan.`);
    } catch (caughtError) {
      setAnnouncement(
        caughtError instanceof Error ? caughtError.message : 'Task could not update.',
      );
    }
  }

  async function removePlannedDay(task: TaskRecord) {
    await plannerRepository.updateTaskPlanning(task.id, planningFromTask(task, false));
    setAnnouncement(`Removed the planned day from ${task.title}.`);
  }

  return (
    <div className="page page--plan">
      <header className="plan-heading">
        <span className="eyebrow">Plan</span>
        <h1>Shape time with intention</h1>
        <p>Plan what belongs on a day while keeping genuine deadlines distinct.</p>
      </header>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <div className="plan-sections">
        {sections.map((section) => (
          <Surface key={section.id} className="plan-section" aria-labelledby={`plan-${section.id}`}>
            <div className="section-heading">
              <h2 id={`plan-${section.id}`}>{section.title}</h2>
              <span>{section.tasks.length}</span>
            </div>
            {section.tasks.length ? (
              <ul className="plan-task-list">
                {section.tasks.map((task) => (
                  <PlanTaskRow
                    key={task.id}
                    task={task}
                    snapshot={snapshot}
                    today={today}
                    onComplete={complete}
                    onEdit={setEditingTask}
                    onRemovePlannedDay={removePlannedDay}
                  />
                ))}
              </ul>
            ) : (
              <p className="plan-empty">{section.empty}</p>
            )}
          </Surface>
        ))}
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
    </div>
  );
}

function PlanTaskRow({
  task,
  snapshot,
  today,
  onComplete,
  onEdit,
  onRemovePlannedDay,
}: {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  today: string;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
  onRemovePlannedDay: (task: TaskRecord) => Promise<void>;
}) {
  const blockers = (snapshot.blockedByTaskId[task.id] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id)?.title)
    .filter((title): title is string => Boolean(title));
  return (
    <li className={`plan-task${blockers.length ? ' is-blocked' : ''}`}>
      <label className="task-check">
        <input
          type="checkbox"
          disabled={blockers.length > 0}
          checked={task.status === 'completed'}
          onChange={(event) => void onComplete(task, event.target.checked)}
        />
        <span className="visually-hidden">Complete {task.title}</span>
      </label>
      <div>
        <button type="button" className="task-title" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <TaskPlanningSummary task={task} today={today} />
        {blockers.length ? (
          <span className="blocked-label">Blocked by {blockers.join(', ')}</span>
        ) : null}
      </div>
      <div className="plan-task__actions">
        <Button type="button" variant="quiet" onClick={() => onEdit(task)}>
          {task.plannedDate || task.flexibleStartDate ? 'Replan' : 'Plan'}
        </Button>
        {task.plannedDate ? (
          <Button type="button" variant="quiet" onClick={() => void onRemovePlannedDay(task)}>
            Remove day
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function planningFromTask(task: TaskRecord, includePlannedDay: boolean): TaskPlanning {
  return {
    plannedDate: includePlannedDay ? task.plannedDate : undefined,
    deadlineDate: task.deadlineDate,
    flexibleStartDate: task.flexibleStartDate,
    flexibleEndDate: task.flexibleEndDate,
    timeWindow: includePlannedDay ? task.timeWindow : undefined,
    exactStartTime: includePlannedDay ? task.exactStartTime : undefined,
    estimatedDurationMinutes: task.estimatedDurationMinutes,
  };
}
