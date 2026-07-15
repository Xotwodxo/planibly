import { formatLocalDate } from '../../data/planning';
import type { TaskRecord } from '../../data/plannerTypes';

export function TaskPlanningSummary({ task, today }: { task: TaskRecord; today: string }) {
  const details: string[] = [];
  if (task.plannedDate) {
    details.push(
      task.plannedDate === today ? 'Today' : `Planned ${formatLocalDate(task.plannedDate)}`,
    );
  }
  if (task.exactStartTime) details.push(task.exactStartTime);
  else if (task.timeWindow) {
    details.push(task.timeWindow[0]!.toUpperCase() + task.timeWindow.slice(1));
  } else if (task.plannedDate) details.push('Any Time');
  if (task.flexibleStartDate && task.flexibleEndDate) {
    details.push(
      `Flexible ${formatLocalDate(task.flexibleStartDate)}–${formatLocalDate(task.flexibleEndDate)}`,
    );
  }
  if (task.deadlineDate) {
    details.push(
      `${task.deadlineDate < today ? 'Overdue' : 'Deadline'} ${formatLocalDate(task.deadlineDate)}`,
    );
  }
  if (task.estimatedDurationMinutes) details.push(`${task.estimatedDurationMinutes} min`);
  if (details.length === 0) return null;
  return (
    <span className="planning-summary" aria-label={`Planning: ${details.join(', ')}`}>
      {details.join(' · ')}
    </span>
  );
}
