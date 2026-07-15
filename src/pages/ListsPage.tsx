import { useEffect, useState, type CSSProperties } from 'react';

import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import { plannerRepository } from '../data/plannerRepository';
import {
  INBOX_LIST_ID,
  type AreaRecord,
  type PlanListRecord,
  type TaskRecord,
} from '../data/plannerTypes';
import { EntityEditorDialog } from '../features/planner/EntityEditorDialog';
import { openQuickAdd } from '../features/planner/plannerEvents';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';

type EditorState =
  { kind: 'area'; record?: AreaRecord } | { kind: 'list'; record?: PlanListRecord };

export function ListsPage() {
  const { snapshot, isLoading, error, refresh } = usePlannerSnapshot();
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState(INBOX_LIST_ID);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteArea, setDeleteArea] = useState<AreaRecord | null>(null);
  const [deleteList, setDeleteList] = useState<PlanListRecord | null>(null);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingCompletions, setPendingCompletions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (snapshot.areas.length === 0) {
      setSelectedAreaId(null);
    } else if (!snapshot.areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(snapshot.areas[0]?.id ?? null);
    }
    if (!snapshot.lists.some((list) => list.id === selectedListId)) {
      setSelectedListId(INBOX_LIST_ID);
    }
  }, [selectedAreaId, selectedListId, snapshot.areas, snapshot.lists]);

  const selectedArea = snapshot.areas.find((area) => area.id === selectedAreaId) ?? null;
  const selectedList = snapshot.lists.find((list) => list.id === selectedListId) ?? null;
  const areaLists = snapshot.lists.filter((list) => list.areaId === selectedAreaId);
  const selectedTasks = snapshot.tasks.filter((task) => task.listId === selectedListId);
  const visibleTasks = selectedTasks.filter(
    (task) => task.status !== 'completed' || task.completedClearedAt === undefined,
  );
  const completedCount = selectedTasks.filter(
    (task) => task.status === 'completed' && task.completedClearedAt === undefined,
  ).length;
  const clearedCompletedCount = selectedTasks.length - visibleTasks.length;

  async function saveEntity(name: string, color: string) {
    if (!editor) return;
    if (editor.kind === 'area') {
      if (editor.record) {
        await plannerRepository.updateArea(editor.record.id, name, color);
      } else {
        const area = await plannerRepository.createArea(name, color);
        await refresh();
        setSelectedAreaId(area.id);
      }
    } else if (selectedAreaId) {
      if (editor.record) {
        await plannerRepository.updateList(editor.record.id, name, color);
      } else {
        const list = await plannerRepository.createList(selectedAreaId, name, color);
        await refresh();
        setSelectedListId(list.id);
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
    } catch {
      setAnnouncement(`${task.title} could not be updated.`);
    } finally {
      setPendingCompletions((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  }

  async function handleClearCompleted() {
    if (!selectedList) return;
    const clearedCount = await plannerRepository.clearCompletedTasks(selectedList.id);
    await refresh();
    if (clearedCount > 0) {
      setAnnouncement(
        `${clearedCount} ${clearedCount === 1 ? 'completed task is' : 'completed tasks are'} hidden from this list.`,
      );
    }
  }

  if (isLoading) {
    return (
      <p className="loading-state" role="status">
        Opening your lists…
      </p>
    );
  }

  return (
    <div className="page page--lists">
      <header className="lists-heading">
        <div>
          <span className="eyebrow">Areas · Lists · Tasks</span>
          <h1>Your lists</h1>
          <p>Keep just enough structure to know where something belongs.</p>
        </div>
        <Button type="button" onClick={openQuickAdd}>
          Quick Add
        </Button>
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
                  setSelectedListId(
                    snapshot.lists.find((list) => list.areaId === area.id)?.id ?? INBOX_LIST_ID,
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

        <Surface className="planner-pane planner-pane--lists" aria-labelledby="lists-title">
          <div className="pane-heading">
            <div>
              <span className="pane-kicker">{selectedArea?.name ?? 'Organise'}</span>
              <h2 id="lists-title">Lists</h2>
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
          <div className="entity-list" role="list">
            {snapshot.lists
              .filter((list) => list.systemType === 'inbox')
              .map((list) => (
                <EntityRow
                  key={list.id}
                  list={list}
                  selected={list.id === selectedListId}
                  onSelect={setSelectedListId}
                />
              ))}
            {areaLists.map((list) => (
              <EntityRow
                key={list.id}
                list={list}
                selected={list.id === selectedListId}
                onSelect={setSelectedListId}
              />
            ))}
          </div>
          {selectedList && selectedList.systemType !== 'inbox' ? (
            <EntityActions
              label={selectedList.name}
              onEdit={() => setEditor({ kind: 'list', record: selectedList })}
              onMoveUp={() => void plannerRepository.moveList(selectedList.id, -1)}
              onMoveDown={() => void plannerRepository.moveList(selectedList.id, 1)}
              onDelete={() => setDeleteList(selectedList)}
            />
          ) : (
            <p className="pane-note">Inbox is always ready for quick capture.</p>
          )}
        </Surface>

        <Surface className="planner-pane planner-pane--tasks" aria-labelledby="tasks-title">
          <div className="pane-heading pane-heading--tasks">
            <div>
              <span className="pane-kicker">
                {selectedList?.systemType === 'inbox' ? 'Quick capture' : 'Standard list'}
              </span>
              <h2 id="tasks-title">{selectedList?.name ?? 'Tasks'}</h2>
            </div>
            <Button type="button" variant="secondary" onClick={openQuickAdd}>
              Add task
            </Button>
          </div>

          {selectedList ? (
            <>
              {visibleTasks.length > 0 ? (
                <ul className="task-list">
                  {visibleTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`task-row${task.status === 'completed' ? ' is-completed' : ''}${snapshot.blockedByTaskId[task.id]?.length ? ' is-blocked' : ''}`}
                    >
                      <label className="task-check">
                        <input
                          type="checkbox"
                          disabled={Boolean(snapshot.blockedByTaskId[task.id]?.length)}
                          checked={pendingCompletions[task.id] ?? task.status === 'completed'}
                          onChange={(event) => void handleComplete(task, event.target.checked)}
                        />
                        <span className="visually-hidden">
                          {task.status === 'completed' ? 'Mark incomplete' : 'Complete'}{' '}
                          {task.title}
                        </span>
                      </label>
                      <div className="task-row__content">
                        <button
                          type="button"
                          className="task-title"
                          onClick={() => setEditingTask(task)}
                        >
                          {task.title}
                        </button>
                        <TaskSummary task={task} snapshot={snapshot} />
                      </div>
                      <button
                        type="button"
                        className="task-edit"
                        onClick={() => setEditingTask(task)}
                        aria-label={`Edit ${task.title}`}
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state">
                  <h3>
                    {clearedCompletedCount > 0 ? 'Completed tasks cleared' : 'Nothing here yet'}
                  </h3>
                  <p>
                    {clearedCompletedCount > 0
                      ? 'They stay stored for future history without cluttering this list.'
                      : 'Use Quick Add when something comes to mind.'}
                  </p>
                </div>
              )}
              {completedCount > 0 ? (
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
          ) : (
            <div className="empty-state">
              <h3>Create a list first</h3>
              <p>Choose an area, then add a standard list.</p>
            </div>
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
          onClose={() => setEditor(null)}
          onSave={saveEntity}
        />
      ) : null}
      {deleteArea ? (
        <DeleteAreaDialog
          area={deleteArea}
          areas={snapshot.areas}
          lists={snapshot.lists}
          onClose={() => setDeleteArea(null)}
          onDeleted={() => {
            setDeleteArea(null);
            setSelectedListId(INBOX_LIST_ID);
          }}
        />
      ) : null}
      {deleteList ? (
        <DeleteListDialog
          list={deleteList}
          taskCount={snapshot.tasks.filter((task) => task.listId === deleteList.id).length}
          onClose={() => setDeleteList(null)}
          onDeleted={() => {
            setDeleteList(null);
            setSelectedListId(INBOX_LIST_ID);
          }}
        />
      ) : null}
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
    </button>
  );
}

function EntityActions({
  label,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
}: {
  label: string;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  return (
    <div className="entity-actions" aria-label={`Actions for ${label}`}>
      <button type="button" onClick={onEdit}>
        Edit
      </button>
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
  onDeleted: () => void;
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
      if (containedLists.length === 0) {
        await plannerRepository.deleteArea(area.id);
      } else if (strategy === 'move') {
        await plannerRepository.deleteArea(area.id, { type: 'move', destinationAreaId });
      } else {
        await plannerRepository.deleteArea(area.id, { type: 'deleteContents' });
      }
      onDeleted();
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
  onDeleted: () => void;
  taskCount: number;
}) {
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    try {
      await plannerRepository.deleteList(list.id, taskCount > 0);
      onDeleted();
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
          ? `This will also remove ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} from the active view.`
          : 'This list is empty.'
      }
      onClose={onClose}
    >
      {taskCount ? (
        <p className="destructive-warning">
          The tasks will be retained locally as deleted records, but there is no recovery screen in
          Phase 1A.
        </p>
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
          Delete list
        </Button>
      </div>
    </Dialog>
  );
}

function TaskSummary({ task, snapshot }: { task: TaskRecord; snapshot: ReturnTypeSnapshot }) {
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

type ReturnTypeSnapshot = ReturnType<typeof usePlannerSnapshot>['snapshot'];
