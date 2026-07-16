import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import { calendarRepository } from '../data/calendarRepository';
import { plannerRepository, RestoreParentRequiredError } from '../data/plannerRepository';
import { localDateFromDate, smartTasksFromSnapshot } from '../data/planning';
import {
  INBOX_LIST_ID,
  type AreaRecord,
  type DeletionEntityKind,
  type DeletionReceipt,
  type ListMode,
  type PlanListRecord,
  type PlannerSnapshot,
  type SmartListKey,
  type TaskRecord,
} from '../data/plannerTypes';
import { EntityEditorDialog } from '../features/planner/EntityEditorDialog';
import { showDeletionUndo } from '../features/planner/plannerEvents';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { TaskPlanningSummary } from '../features/planner/TaskPlanningSummary';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';

type EditorState =
  { kind: 'area'; record?: AreaRecord } | { kind: 'list'; record?: PlanListRecord };

type ViewSelection =
  | { kind: 'list'; id: string }
  | { kind: 'smart'; key: SmartListKey }
  | { kind: 'tag'; id: string }
  | { kind: 'archived'; id: string };

const SMART_LISTS: { key: SmartListKey; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'active', label: 'All Active Tasks' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'completed', label: 'Completed' },
  { key: 'today', label: 'Today' },
  { key: 'nextThreeDays', label: 'Next Three Days' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'deadlines', label: 'Deadlines' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'unscheduled', label: 'Unscheduled' },
  { key: 'recentlyDeleted', label: 'Recently Deleted' },
];

export function ListsPage() {
  const { snapshot, isLoading, error, refresh } = usePlannerSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ViewSelection>({ kind: 'smart', key: 'inbox' });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteArea, setDeleteArea] = useState<AreaRecord | null>(null);
  const [deleteList, setDeleteList] = useState<PlanListRecord | null>(null);
  const [projectEditor, setProjectEditor] = useState<PlanListRecord | null>(null);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingCompletions, setPendingCompletions] = useState<Record<string, boolean>>({});
  const processedSearchSelection = useRef('');

  useEffect(() => {
    if (snapshot.areas.length === 0) setSelectedAreaId(null);
    else if (!snapshot.areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(snapshot.areas[0]?.id ?? null);
    }
  }, [selectedAreaId, snapshot.areas]);

  useEffect(() => {
    const searchSelection = searchParams.toString();
    if (!searchSelection || processedSearchSelection.current === searchSelection) return;
    const archivedId = searchParams.get('archived');
    const tagId = searchParams.get('tag');
    const listId = searchParams.get('list');
    const areaId = searchParams.get('area');
    const taskId = searchParams.get('task');
    const smartKey = searchParams.get('smart') as SmartListKey | null;
    let handled = false;
    if (smartKey && SMART_LISTS.some((smart) => smart.key === smartKey)) {
      setSelection({ kind: 'smart', key: smartKey });
      handled = true;
    } else if (archivedId && snapshot.archivedProjects.some((list) => list.id === archivedId)) {
      setSelection({ kind: 'archived', id: archivedId });
      handled = true;
    } else if (tagId && snapshot.tags.some((tag) => tag.id === tagId)) {
      setSelection({ kind: 'tag', id: tagId });
      handled = true;
    } else if (listId && snapshot.lists.some((list) => list.id === listId)) {
      const list = snapshot.lists.find((candidate) => candidate.id === listId);
      if (list) setSelectedAreaId(list.areaId);
      setSelection({ kind: 'list', id: listId });
      handled = true;
    } else if (areaId && snapshot.areas.some((area) => area.id === areaId)) {
      setSelectedAreaId(areaId);
      const firstList = snapshot.lists.find((list) => list.areaId === areaId);
      if (firstList) setSelection({ kind: 'list', id: firstList.id });
      handled = true;
    }
    if (!archivedId && taskId && editingTask?.id !== taskId) {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (task) {
        setEditingTask(task);
        handled = true;
      }
    }
    if (handled) processedSearchSelection.current = searchSelection;
  }, [editingTask?.id, searchParams, snapshot]);

  const selectedArea = snapshot.areas.find((area) => area.id === selectedAreaId) ?? null;
  const areaLists = snapshot.lists.filter(
    (list) => list.areaId === selectedAreaId && list.systemType !== 'inbox',
  );
  const selectedList =
    selection.kind === 'list'
      ? (snapshot.lists.find((list) => list.id === selection.id) ?? null)
      : selection.kind === 'archived'
        ? (snapshot.archivedProjects.find((list) => list.id === selection.id) ?? null)
        : selection.kind === 'smart' && selection.key === 'inbox'
          ? (snapshot.lists.find((list) => list.id === INBOX_LIST_ID) ?? null)
          : null;
  const selectedTasks = useMemo(
    () => tasksForSelection(snapshot, selection),
    [selection, snapshot],
  );
  const visibleTasks =
    selection.kind === 'smart' && selection.key === 'completed'
      ? selectedTasks
      : selectedTasks.filter(
          (task) => task.status !== 'completed' || task.completedClearedAt === undefined,
        );
  const completedCount = selectedTasks.filter(
    (task) => task.status === 'completed' && task.completedClearedAt === undefined,
  ).length;
  const clearedCompletedCount = selectedTasks.length - visibleTasks.length;

  async function saveEntity(name: string, color: string, mode: ListMode) {
    if (!editor) return;
    if (editor.kind === 'area') {
      if (editor.record) await plannerRepository.updateArea(editor.record.id, name, color);
      else {
        const area = await plannerRepository.createArea(name, color);
        await refresh();
        setSelectedAreaId(area.id);
      }
    } else if (selectedAreaId) {
      if (editor.record) await plannerRepository.updateList(editor.record.id, name, color);
      else {
        const list = await plannerRepository.createList(selectedAreaId, name, color, mode);
        await refresh();
        setSelection({ kind: 'list', id: list.id });
      }
    }
  }

  async function handleComplete(task: TaskRecord, completed: boolean) {
    setPendingCompletions((current) => ({ ...current, [task.id]: completed }));
    try {
      await plannerRepository.setTaskCompleted(task.id, completed);
      await refresh();
      setAnnouncement(
        completed ? `${task.title} completed.` : `${task.title} returned to the list.`,
      );
    } catch (caughtError) {
      setAnnouncement(
        caughtError instanceof Error ? caughtError.message : 'Task could not update.',
      );
    } finally {
      setPendingCompletions((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  }

  async function handleClearCompleted() {
    if (!selectedList || selectedList.archivedAt) return;
    const count = await plannerRepository.clearCompletedTasks(selectedList.id);
    if (count > 0)
      setAnnouncement(`${count} completed ${count === 1 ? 'task is' : 'tasks are'} hidden.`);
  }

  function closeTaskEditor() {
    setEditingTask(null);
    if (searchParams.has('task')) {
      const next = new URLSearchParams(searchParams);
      next.delete('task');
      setSearchParams(next, { replace: true });
    }
  }

  if (isLoading)
    return (
      <p className="loading-state" role="status">
        Opening your lists…
      </p>
    );

  return (
    <div className="page page--lists">
      <header className="lists-heading">
        <div>
          <span className="eyebrow">Areas · Lists · Projects · Tasks</span>
          <h1>Your lists</h1>
          <p>Keep just enough structure to know what matters and what can happen next.</p>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="planner-layout">
        <Surface className="planner-pane planner-pane--areas" aria-labelledby="areas-title">
          <div className="pane-heading">
            <div>
              <span className="pane-kicker">Organise</span>
              <h2 id="areas-title">Areas</h2>
            </div>
            <Button type="button" variant="quiet" onClick={() => setEditor({ kind: 'area' })}>
              Add
            </Button>
          </div>
          <div className="entity-list" role="list">
            {snapshot.areas.map((area) => (
              <button
                key={area.id}
                type="button"
                className={`entity-row${area.id === selectedAreaId ? ' is-selected' : ''}`}
                aria-current={area.id === selectedAreaId ? 'true' : undefined}
                onClick={() => {
                  setSelectedAreaId(area.id);
                  const first = snapshot.lists.find((list) => list.areaId === area.id);
                  setSelection(
                    first ? { kind: 'list', id: first.id } : { kind: 'smart', key: 'inbox' },
                  );
                }}
              >
                <span
                  className="entity-dot"
                  style={{ '--entity-color': area.color } as CSSProperties}
                />
                <span>{area.name}</span>
              </button>
            ))}
          </div>
          {selectedArea ? (
            <EntityActions
              label={selectedArea.name}
              onEdit={() => setEditor({ kind: 'area', record: selectedArea })}
              onMoveUp={() => void plannerRepository.moveArea(selectedArea.id, -1)}
              onMoveDown={() => void plannerRepository.moveArea(selectedArea.id, 1)}
              onDelete={() => setDeleteArea(selectedArea)}
            />
          ) : null}
        </Surface>

        <Surface className="planner-pane planner-pane--lists" aria-label="Lists">
          <div className="pane-heading">
            <div>
              <span className="pane-kicker">Find</span>
              <h2 id="lists-title">Lists &amp; Projects</h2>
            </div>
            <Button
              type="button"
              variant="quiet"
              disabled={!selectedArea}
              onClick={() => setEditor({ kind: 'list' })}
            >
              Add
            </Button>
          </div>
          <div className="smart-list" aria-label="Smart lists">
            {SMART_LISTS.map((smart) => (
              <button
                key={smart.key}
                type="button"
                className={
                  selection.kind === 'smart' && selection.key === smart.key ? 'is-selected' : ''
                }
                onClick={() => setSelection({ kind: 'smart', key: smart.key })}
              >
                {smart.label}
              </button>
            ))}
          </div>
          <span className="pane-kicker list-group-label">
            {selectedArea?.name ?? 'Choose an area'}
          </span>
          <div className="entity-list" role="list">
            {areaLists.map((list) => (
              <EntityRow
                key={list.id}
                list={list}
                selected={selection.kind === 'list' && list.id === selection.id}
                onSelect={(id) => setSelection({ kind: 'list', id })}
              />
            ))}
          </div>
          {snapshot.archivedProjects.length > 0 ? (
            <details className="archived-projects">
              <summary>Archived projects ({snapshot.archivedProjects.length})</summary>
              <div className="entity-list" role="list">
                {snapshot.archivedProjects.map((list) => (
                  <EntityRow
                    key={list.id}
                    list={list}
                    selected={selection.kind === 'archived' && list.id === selection.id}
                    onSelect={(id) => setSelection({ kind: 'archived', id })}
                  />
                ))}
              </div>
            </details>
          ) : null}
          {selectedList && selectedList.systemType !== 'inbox' && !selectedList.archivedAt ? (
            <EntityActions
              label={selectedList.name}
              onEdit={() => setEditor({ kind: 'list', record: selectedList })}
              onMoveUp={() => void plannerRepository.moveList(selectedList.id, -1)}
              onMoveDown={() => void plannerRepository.moveList(selectedList.id, 1)}
              onDelete={() => setDeleteList(selectedList)}
              extraLabel={
                selectedList.mode === 'project' ? 'Project details' : 'Convert to project'
              }
              onExtra={() => setProjectEditor(selectedList)}
            />
          ) : null}
        </Surface>

        <Surface className="planner-pane planner-pane--tasks" aria-labelledby="tasks-title">
          {selection.kind === 'smart' && selection.key === 'recentlyDeleted' ? (
            <RecentlyDeletedPanel snapshot={snapshot} />
          ) : (
            <>
              <div className="pane-heading pane-heading--tasks">
                <div>
                  <span className="pane-kicker">{viewKicker(selection, selectedList)}</span>
                  <h2 id="tasks-title">{viewTitle(selection, selectedList, snapshot)}</h2>
                </div>
              </div>
              {selectedList?.mode === 'project' ? (
                <ProjectSummary
                  list={selectedList}
                  snapshot={snapshot}
                  archived={selection.kind === 'archived'}
                  onEdit={() => setProjectEditor(selectedList)}
                  onArchived={(receipt) => {
                    showDeletionUndo(receipt);
                    setSelection({ kind: 'smart', key: 'inbox' });
                  }}
                  onRestored={() => setSelection({ kind: 'list', id: selectedList.id })}
                />
              ) : null}
              {visibleTasks.length > 0 ? (
                <ul className="task-list">
                  {visibleTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      snapshot={snapshot}
                      pending={pendingCompletions[task.id]}
                      readOnly={selection.kind === 'archived'}
                      showLocation={selection.kind === 'smart' || selection.kind === 'tag'}
                      onComplete={handleComplete}
                      onEdit={setEditingTask}
                    />
                  ))}
                </ul>
              ) : (
                <div className="empty-state">
                  <h3>
                    {clearedCompletedCount > 0 ? 'Completed tasks cleared' : emptyTitle(selection)}
                  </h3>
                  <p>{emptyMessage(selection, clearedCompletedCount > 0)}</p>
                </div>
              )}
              {completedCount > 0 &&
              (selection.kind === 'list' ||
                (selection.kind === 'smart' && selection.key === 'inbox')) ? (
                <Button
                  type="button"
                  variant="quiet"
                  className="clear-completed"
                  onClick={() => void handleClearCompleted()}
                >
                  Clear Completed
                </Button>
              ) : null}
            </>
          )}
        </Surface>
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {editor ? (
        <EntityEditorDialog
          entityLabel={editor.kind}
          initialName={editor.record?.name}
          initialColor={editor.record?.color}
          initialMode={editor.kind === 'list' ? editor.record?.mode : undefined}
          onClose={() => setEditor(null)}
          onSave={saveEntity}
        />
      ) : null}
      {deleteArea ? (
        <DeleteAreaDialog
          area={deleteArea}
          areas={snapshot.areas}
          lists={[...snapshot.lists, ...snapshot.archivedProjects]}
          onClose={() => setDeleteArea(null)}
          onDeleted={(receipt) => {
            showDeletionUndo(receipt);
            setDeleteArea(null);
            setSelection({ kind: 'smart', key: 'inbox' });
          }}
        />
      ) : null}
      {deleteList ? (
        <DeleteListDialog
          list={deleteList}
          taskCount={snapshot.tasks.filter((task) => task.listId === deleteList.id).length}
          onClose={() => setDeleteList(null)}
          onDeleted={(receipt) => {
            showDeletionUndo(receipt);
            setDeleteList(null);
            setSelection({ kind: 'smart', key: 'inbox' });
          }}
        />
      ) : null}
      {projectEditor ? (
        <ProjectEditorDialog list={projectEditor} onClose={() => setProjectEditor(null)} />
      ) : null}
      {editingTask ? (
        <TaskEditorDialog task={editingTask} snapshot={snapshot} onClose={closeTaskEditor} />
      ) : null}
    </div>
  );
}

function tasksForSelection(snapshot: PlannerSnapshot, selection: ViewSelection): TaskRecord[] {
  const visibleListIds = new Set(snapshot.lists.map((list) => list.id));
  if (selection.kind === 'list' || selection.kind === 'archived') {
    return snapshot.tasks.filter((task) => task.listId === selection.id);
  }
  if (selection.kind === 'tag') {
    const taskIds = new Set(
      snapshot.taskTags
        .filter((assignment) => assignment.tagId === selection.id)
        .map((assignment) => assignment.taskId),
    );
    return snapshot.tasks.filter((task) => taskIds.has(task.id) && visibleListIds.has(task.listId));
  }
  return smartTasksFromSnapshot(snapshot, selection.key, localDateFromDate(new Date()));
}

function EntityRow({
  list,
  onSelect,
  selected,
}: {
  list: PlanListRecord;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className={`entity-row${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(list.id)}
    >
      <span className="entity-dot" style={{ '--entity-color': list.color } as CSSProperties} />
      <span>{list.name}</span>
      {list.mode === 'project' ? <span className="entity-kind">Project</span> : null}
    </button>
  );
}

function EntityActions({
  label,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
  extraLabel,
  onExtra,
}: {
  label: string;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  extraLabel?: string;
  onExtra?: () => void;
}) {
  return (
    <div className="entity-actions" aria-label={`Actions for ${label}`}>
      <button type="button" onClick={onEdit}>
        Edit
      </button>
      {onExtra ? (
        <button type="button" onClick={onExtra}>
          {extraLabel}
        </button>
      ) : null}
      <button type="button" onClick={onMoveUp} aria-label={`Move ${label} up`}>
        ↑
      </button>
      <button type="button" onClick={onMoveDown} aria-label={`Move ${label} down`}>
        ↓
      </button>
      <button type="button" className="destructive-text" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

function TaskRow({
  task,
  snapshot,
  pending,
  readOnly,
  showLocation,
  onComplete,
  onEdit,
}: {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  pending?: boolean;
  readOnly: boolean;
  showLocation: boolean;
  onComplete: (task: TaskRecord, completed: boolean) => Promise<void>;
  onEdit: (task: TaskRecord) => void;
}) {
  const list = [...snapshot.lists, ...snapshot.archivedProjects].find(
    (candidate) => candidate.id === task.listId,
  );
  return (
    <li
      className={`task-row${task.status === 'completed' ? ' is-completed' : ''}${snapshot.blockedByTaskId[task.id]?.length ? ' is-blocked' : ''}`}
    >
      <label className="task-check">
        <input
          type="checkbox"
          disabled={readOnly || Boolean(snapshot.blockedByTaskId[task.id]?.length)}
          checked={pending ?? task.status === 'completed'}
          onChange={(event) => void onComplete(task, event.target.checked)}
        />
        <span className="visually-hidden">
          {task.status === 'completed' ? 'Mark incomplete' : 'Complete'} {task.title}
        </span>
      </label>
      <div className="task-row__content">
        <button
          type="button"
          className="task-title"
          disabled={readOnly}
          onClick={() => onEdit(task)}
        >
          {task.title}
        </button>
        <TaskSummary task={task} snapshot={snapshot} />
        {showLocation && list ? <span className="task-location">{list.name}</span> : null}
      </div>
      {!readOnly ? (
        <button
          type="button"
          className="task-edit"
          onClick={() => onEdit(task)}
          aria-label={`Edit ${task.title}`}
        >
          Edit
        </button>
      ) : null}
    </li>
  );
}

function TaskSummary({ task, snapshot }: { task: TaskRecord; snapshot: PlannerSnapshot }) {
  const steps = snapshot.taskSteps.filter((step) => step.taskId === task.id);
  const assignedTags = snapshot.taskTags
    .filter((assignment) => assignment.taskId === task.id)
    .map((assignment) => snapshot.tags.find((tag) => tag.id === assignment.tagId))
    .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined);
  const blockers = (snapshot.blockedByTaskId[task.id] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id)?.title)
    .filter((title): title is string => title !== undefined);
  return (
    <div className="task-summary">
      <TaskPlanningSummary task={task} today={localDateFromDate(new Date())} />
      {blockers.length > 0 ? (
        <span className="blocked-label">Blocked by {blockers.join(', ')}</span>
      ) : null}
      {steps.length > 0 ? (
        <span>
          {steps.filter((step) => step.completed).length} of {steps.length} steps
        </span>
      ) : null}
      {assignedTags.slice(0, 3).map((tag) => (
        <span
          key={tag.id}
          className="tag-chip"
          style={{ '--tag-color': tag.color } as CSSProperties}
        >
          {tag.name}
        </span>
      ))}
      {assignedTags.length > 3 ? <span>+{assignedTags.length - 3}</span> : null}
    </div>
  );
}

function ProjectSummary({
  list,
  snapshot,
  archived,
  onArchived,
  onEdit,
  onRestored,
}: {
  list: PlanListRecord;
  snapshot: PlannerSnapshot;
  archived: boolean;
  onArchived: (receipt: DeletionReceipt) => void;
  onEdit: () => void;
  onRestored: () => void;
}) {
  const progress = snapshot.projectProgressByListId[list.id];
  const nextTask = progress?.nextActionId
    ? snapshot.tasks.find((task) => task.id === progress.nextActionId)
    : undefined;
  return (
    <div className="project-summary">
      {list.projectOutcome ? <p>{list.projectOutcome}</p> : null}
      {list.projectTargetDate ? (
        <p>
          <strong>Target:</strong> {list.projectTargetDate}
        </p>
      ) : null}
      <label>
        <span>
          {progress?.completedCount ?? 0} completed of {progress?.totalCount ?? 0}
        </span>
        <progress
          value={progress?.completedCount ?? 0}
          max={Math.max(progress?.totalCount ?? 0, 1)}
          aria-label={`${progress?.completedCount ?? 0} of ${progress?.totalCount ?? 0} project tasks completed`}
        />
      </label>
      {nextTask ? (
        <p>
          <strong>Next available action:</strong> {nextTask.title}
        </p>
      ) : progress?.allRemainingBlocked ? (
        <p className="blocked-label">Every remaining task is blocked.</p>
      ) : (
        <p>No incomplete action is waiting.</p>
      )}
      <div className="project-summary__actions">
        {archived ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void plannerRepository.restoreArchivedProject(list.id).then(onRestored)}
          >
            Restore project
          </Button>
        ) : (
          <>
            <Button type="button" variant="quiet" onClick={onEdit}>
              Edit project
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => void plannerRepository.archiveProject(list.id).then(onArchived)}
            >
              Archive project
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectEditorDialog({ list, onClose }: { list: PlanListRecord; onClose: () => void }) {
  const [outcome, setOutcome] = useState(list.projectOutcome ?? '');
  const [targetDate, setTargetDate] = useState(list.projectTargetDate ?? '');
  const [confirmConversion, setConfirmConversion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function convert(mode: ListMode) {
    try {
      await plannerRepository.convertListMode(list.id, mode, confirmConversion);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'The list type could not change.',
      );
    }
  }

  async function save() {
    try {
      await plannerRepository.updateProjectDetails(list.id, outcome, targetDate);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Project details could not save.',
      );
    }
  }

  return (
    <Dialog
      title={list.mode === 'project' ? 'Project details' : 'Convert to project'}
      onClose={onClose}
    >
      {list.mode !== 'project' ? (
        <>
          <p>
            Projects add an outcome, optional target date, progress, and a next available action.
          </p>
          <div className="dialog__actions">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void convert('project')}>
              Convert to project
            </Button>
          </div>
        </>
      ) : (
        <div className="form-stack">
          <label className="field">
            <span>Outcome or description</span>
            <textarea
              rows={3}
              value={outcome}
              maxLength={500}
              onChange={(event) => setOutcome(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Optional target date</span>
            <input
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={confirmConversion}
              onChange={(event) => setConfirmConversion(event.target.checked)}
            />
            I understand converting to a standard list clears project-only details.
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog__actions dialog__actions--wrap">
            <Button type="button" variant="quiet" onClick={() => void convert('standard')}>
              Convert to standard list
            </Button>
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()}>
              Save project
            </Button>
          </div>
        </div>
      )}
      {error && list.mode !== 'project' ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function RecentlyDeletedPanel({ snapshot }: { snapshot: PlannerSnapshot }) {
  const [restoreRequest, setRestoreRequest] = useState<{
    kind: DeletionEntityKind;
    id: string;
    parents: string[];
  } | null>(null);
  const [permanentRequest, setPermanentRequest] = useState<{
    kind: DeletionEntityKind;
    id: string;
    label: string;
  } | null>(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const [recoveryAnnouncement, setRecoveryAnnouncement] = useState('');
  const [eventRestore, setEventRestore] = useState<{ id: string; calendarId: string } | null>(null);
  const items = deletedItems(snapshot);

  async function restore(kind: DeletionEntityKind, id: string, withParents = false) {
    try {
      if (kind === 'calendar') {
        await calendarRepository.restoreCalendar(id);
        setRecoveryAnnouncement('Calendar restored.');
        return;
      }
      if (kind === 'event') {
        try {
          await calendarRepository.restoreEvent(id);
          setRecoveryAnnouncement('Event restored.');
        } catch {
          setEventRestore({ id, calendarId: snapshot.calendars[0]?.id ?? '' });
        }
        return;
      }
      await plannerRepository.restoreDeletedEntity(kind, id, withParents);
      setRecoveryAnnouncement(`${kind} restored.`);
      setRestoreRequest(null);
    } catch (caughtError) {
      if (caughtError instanceof RestoreParentRequiredError) {
        setRestoreRequest({ kind, id, parents: caughtError.parentLabels });
      }
    }
  }

  return (
    <div className="recovery-panel">
      <div className="pane-heading">
        <div>
          <span className="pane-kicker">Recovery</span>
          <h2 id="tasks-title">Recently Deleted</h2>
        </div>
        {items.length > 0 ? (
          <Button
            type="button"
            className="button--destructive"
            onClick={() => setEmptyConfirm(true)}
          >
            Empty
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing to recover</h3>
          <p>
            Deleted calendars, events, areas, lists, projects, tasks, and steps will appear here.
          </p>
        </div>
      ) : (
        <ul className="recovery-list">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <div>
                <span className="search-result__type">{item.kind}</span>
                <strong>{item.label}</strong>
                <span>{item.location}</span>
                <time dateTime={item.deletedAt}>{new Date(item.deletedAt).toLocaleString()}</time>
              </div>
              <div>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => void restore(item.kind, item.id)}
                >
                  Restore
                </Button>
                {item.canDeleteForever !== false ? (
                  <Button
                    type="button"
                    variant="quiet"
                    className="destructive-text"
                    onClick={() => setPermanentRequest(item)}
                  >
                    Delete forever
                  </Button>
                ) : (
                  <span className="field-help">Protected from permanent deletion</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {restoreRequest ? (
        <ConfirmDialog
          title="Restore required parents?"
          description={`This also restores ${restoreRequest.parents.join(' and ')}.`}
          confirmLabel="Restore hierarchy"
          onClose={() => setRestoreRequest(null)}
          onConfirm={() => void restore(restoreRequest.kind, restoreRequest.id, true)}
        />
      ) : null}
      {permanentRequest ? (
        <ConfirmDialog
          title={`Permanently delete ${permanentRequest.label}?`}
          description="This cannot be undone. Related steps, tag assignments, and relationships will be cleaned up."
          confirmLabel="Delete forever"
          onClose={() => setPermanentRequest(null)}
          onConfirm={() =>
            void (
              permanentRequest.kind === 'calendar'
                ? calendarRepository.permanentlyDeleteCalendar(permanentRequest.id)
                : permanentRequest.kind === 'event'
                  ? calendarRepository.permanentlyDeleteEvent(permanentRequest.id)
                  : plannerRepository.permanentlyDelete(permanentRequest.kind, permanentRequest.id)
            ).then(() => setPermanentRequest(null))
          }
        />
      ) : null}
      {emptyConfirm ? (
        <ConfirmDialog
          title="Empty Recently Deleted?"
          description={`Permanently delete all ${items.length} recoverable items? This cannot be undone.`}
          confirmLabel="Empty Recently Deleted"
          onClose={() => setEmptyConfirm(false)}
          onConfirm={() =>
            void Promise.all([
              plannerRepository.emptyRecentlyDeleted(),
              calendarRepository.emptyRecentlyDeleted(),
            ]).then(() => setEmptyConfirm(false))
          }
        />
      ) : null}
      {eventRestore ? (
        <Dialog
          title="Choose a calendar"
          description="The event's original calendar is unavailable. Choose an active calendar to restore it."
          onClose={() => setEventRestore(null)}
        >
          <label className="field">
            <span>Calendar</span>
            <select
              value={eventRestore.calendarId}
              onChange={(event) =>
                setEventRestore({ ...eventRestore, calendarId: event.target.value })
              }
            >
              {snapshot.calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setEventRestore(null)}>
              Cancel
            </Button>
            <Button
              disabled={!eventRestore.calendarId}
              onClick={() =>
                void calendarRepository
                  .restoreEvent(eventRestore.id, eventRestore.calendarId)
                  .then(() => {
                    setEventRestore(null);
                    setRecoveryAnnouncement('Event restored.');
                  })
              }
            >
              Restore event
            </Button>
          </div>
        </Dialog>
      ) : null}
      <div className="visually-hidden" aria-live="polite">
        {recoveryAnnouncement}
      </div>
    </div>
  );
}

function deletedItems(snapshot: PlannerSnapshot) {
  const allAreas = [...snapshot.areas, ...snapshot.deletedAreas];
  const allLists = [...snapshot.lists, ...snapshot.archivedProjects, ...snapshot.deletedLists];
  const allTasks = [...snapshot.tasks, ...snapshot.deletedTasks];
  return [
    ...snapshot.deletedAreas.map((area) => ({
      kind: 'area' as const,
      id: area.id,
      label: area.name,
      location: 'Area',
      deletedAt: area.deletedAt!,
      canDeleteForever: true,
    })),
    ...snapshot.deletedLists.map((list) => ({
      kind: 'list' as const,
      id: list.id,
      label: list.name,
      location: `${list.mode === 'project' ? 'Project' : 'List'} in ${allAreas.find((area) => area.id === list.areaId)?.name ?? 'deleted area'}`,
      deletedAt: list.deletedAt!,
      canDeleteForever: true,
    })),
    ...snapshot.deletedTasks.map((task) => ({
      kind: 'task' as const,
      id: task.id,
      label: task.title,
      location: `Task in ${allLists.find((list) => list.id === task.listId)?.name ?? 'deleted list'}`,
      deletedAt: task.deletedAt!,
      canDeleteForever: true,
    })),
    ...snapshot.deletedSteps.map((step) => ({
      kind: 'step' as const,
      id: step.id,
      label: step.title,
      location: `Step in ${allTasks.find((task) => task.id === step.taskId)?.title ?? 'deleted task'}`,
      deletedAt: step.deletedAt!,
      canDeleteForever: true,
    })),
    ...snapshot.deletedCalendars.map((calendar) => ({
      kind: 'calendar' as const,
      id: calendar.id,
      label: calendar.name,
      location: calendar.isProtected ? 'Protected calendar' : 'Calendar',
      deletedAt: calendar.deletedAt!,
      canDeleteForever: !calendar.isProtected,
    })),
    ...snapshot.deletedCalendarEvents.map((event) => ({
      kind: 'event' as const,
      id: event.id,
      label: event.title,
      location: `Event in ${[...snapshot.calendars, ...snapshot.deletedCalendars].find((calendar) => calendar.id === event.calendarId)?.name ?? 'deleted calendar'}`,
      deletedAt: event.deletedAt!,
      canDeleteForever: true,
    })),
  ].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title={title} description={description} onClose={onClose}>
      <div className="dialog__actions">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="button--destructive" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

function DeleteAreaDialog({
  area,
  areas,
  lists,
  onClose,
  onDeleted,
}: {
  area: AreaRecord;
  areas: AreaRecord[];
  lists: PlanListRecord[];
  onClose: () => void;
  onDeleted: (receipt: DeletionReceipt) => void;
}) {
  const containedLists = lists.filter((list) => list.areaId === area.id);
  const destinations = areas.filter((candidate) => candidate.id !== area.id);
  const [strategy, setStrategy] = useState<'move' | 'deleteContents'>(
    destinations.length ? 'move' : 'deleteContents',
  );
  const [destinationAreaId, setDestinationAreaId] = useState(destinations[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    try {
      const receipt =
        containedLists.length === 0
          ? await plannerRepository.deleteArea(area.id)
          : strategy === 'move'
            ? await plannerRepository.deleteArea(area.id, { type: 'move', destinationAreaId })
            : await plannerRepository.deleteArea(area.id, { type: 'deleteContents' });
      onDeleted(receipt);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'The area could not be deleted.',
      );
    }
  }
  return (
    <Dialog
      title={`Delete ${area.name}?`}
      description={
        containedLists.length
          ? `This area contains ${containedLists.length} ${containedLists.length === 1 ? 'list' : 'lists'}.`
          : 'This area is empty.'
      }
      onClose={onClose}
    >
      {containedLists.length ? (
        <fieldset className="choice-fieldset">
          <legend>What should happen to its lists?</legend>
          {destinations.length ? (
            <label>
              <input
                type="radio"
                name="area-delete"
                checked={strategy === 'move'}
                onChange={() => setStrategy('move')}
              />
              Move lists to
              <select
                aria-label="Destination area"
                value={destinationAreaId}
                onChange={(event) => setDestinationAreaId(event.target.value)}
              >
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <input
              type="radio"
              name="area-delete"
              checked={strategy === 'deleteContents'}
              onChange={() => setStrategy('deleteContents')}
            />
            Delete the area, its lists, and their tasks
          </label>
        </fieldset>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog__actions">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="button--destructive" onClick={() => void confirm()}>
          {strategy === 'move' && containedLists.length ? 'Move lists & delete' : 'Delete area'}
        </Button>
      </div>
    </Dialog>
  );
}

function DeleteListDialog({
  list,
  onClose,
  onDeleted,
  taskCount,
}: {
  list: PlanListRecord;
  onClose: () => void;
  onDeleted: (receipt: DeletionReceipt) => void;
  taskCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    try {
      onDeleted(await plannerRepository.deleteList(list.id, taskCount > 0));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'The list could not be deleted.',
      );
    }
  }
  return (
    <Dialog
      title={`Delete ${list.name}?`}
      description={
        taskCount
          ? `This will move the ${list.mode === 'project' ? 'project' : 'list'} and ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} to Recently Deleted.`
          : 'This list is empty.'
      }
      onClose={onClose}
    >
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog__actions">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="button--destructive" onClick={() => void confirm()}>
          Delete {list.mode === 'project' ? 'project' : 'list'}
        </Button>
      </div>
    </Dialog>
  );
}

function viewTitle(
  selection: ViewSelection,
  list: PlanListRecord | null,
  snapshot: PlannerSnapshot,
) {
  if (list) return list.name;
  if (selection.kind === 'tag')
    return snapshot.tags.find((tag) => tag.id === selection.id)?.name ?? 'Tag';
  if (selection.kind === 'smart')
    return SMART_LISTS.find((smart) => smart.key === selection.key)?.label ?? 'Tasks';
  return 'Tasks';
}
function viewKicker(selection: ViewSelection, list: PlanListRecord | null) {
  if (selection.kind === 'archived') return 'Archived project';
  if (list?.mode === 'project') return 'Project';
  if (selection.kind === 'smart') return 'Smart list';
  if (selection.kind === 'tag') return 'Tagged tasks';
  return 'Standard list';
}
function emptyTitle(selection: ViewSelection) {
  return selection.kind === 'smart' && selection.key === 'blocked'
    ? 'Nothing is blocked'
    : selection.kind === 'smart' && selection.key === 'completed'
      ? 'No completed tasks'
      : 'Nothing here yet';
}
function emptyMessage(selection: ViewSelection, cleared: boolean) {
  if (cleared) return 'They stay stored for completion history without cluttering this list.';
  if (selection.kind === 'smart') return 'This view updates automatically as your tasks change.';
  return 'Use the persistent Quick Add control when something comes to mind.';
}
