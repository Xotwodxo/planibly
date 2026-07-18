import { useState, type CSSProperties, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import {
  plannerRepository,
  RelationshipValidationError,
  TagInUseError,
} from '../../data/plannerRepository';
import { addCalendarDays, localDateFromDate, validatePlanning } from '../../data/planning';
import { focusRepository } from '../../data/focusRepository';
import {
  COUNTDOWN_MINUTES_MAX,
  PREP_ITEM_TITLE_MAX_LENGTH,
  TASK_WHY_MAX_LENGTH,
  type TaskPrepItemRecord,
  type TaskStartStyle,
} from '../../data/focusTypes';
import {
  ENTITY_COLORS,
  type PlannerSnapshot,
  type TagRecord,
  type TaskRecord,
  type TaskTimeWindow,
  type TaskStepRecord,
} from '../../data/plannerTypes';
import { showDeletionUndo } from './plannerEvents';
import { useUnsavedChanges } from './unsavedChanges';

type TaskEditorDialogProps = {
  task: TaskRecord;
  snapshot: PlannerSnapshot;
  onClose: () => void;
};

export function TaskEditorDialog({ task, snapshot, onClose }: TaskEditorDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [listId, setListId] = useState(task.listId);
  const [plannedDate, setPlannedDate] = useState(task.plannedDate ?? '');
  const [deadlineDate, setDeadlineDate] = useState(task.deadlineDate ?? '');
  const [flexibleStartDate, setFlexibleStartDate] = useState(task.flexibleStartDate ?? '');
  const [flexibleEndDate, setFlexibleEndDate] = useState(task.flexibleEndDate ?? '');
  const [timeChoice, setTimeChoice] = useState<'any' | 'exact' | TaskTimeWindow>(
    task.exactStartTime ? 'exact' : (task.timeWindow ?? 'any'),
  );
  const [exactStartTime, setExactStartTime] = useState(task.exactStartTime ?? '');
  const [duration, setDuration] = useState(
    task.estimatedDurationMinutes ? String(task.estimatedDurationMinutes) : '',
  );
  const existingStartingDetails = snapshot.taskStartingDetails.find(
    (details) => details.taskId === task.id,
  );
  const [whyItMatters, setWhyItMatters] = useState(existingStartingDetails?.whyItMatters ?? '');
  const [preferredStartStyle, setPreferredStartStyle] = useState<TaskStartStyle | ''>(
    existingStartingDetails?.preferredStartStyle ?? '',
  );
  const [defaultCountdown, setDefaultCountdown] = useState(
    existingStartingDetails?.defaultCountdownMinutes
      ? String(existingStartingDetails.defaultCountdownMinutes)
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const planningChanged =
    plannedDate !== (task.plannedDate ?? '') ||
    deadlineDate !== (task.deadlineDate ?? '') ||
    flexibleStartDate !== (task.flexibleStartDate ?? '') ||
    flexibleEndDate !== (task.flexibleEndDate ?? '') ||
    timeChoice !== (task.exactStartTime ? 'exact' : (task.timeWindow ?? 'any')) ||
    exactStartTime !== (task.exactStartTime ?? '') ||
    duration !== (task.estimatedDurationMinutes ? String(task.estimatedDurationMinutes) : '');
  const startingChanged =
    whyItMatters !== (existingStartingDetails?.whyItMatters ?? '') ||
    preferredStartStyle !== (existingStartingDetails?.preferredStartStyle ?? '') ||
    defaultCountdown !==
      (existingStartingDetails?.defaultCountdownMinutes
        ? String(existingStartingDetails.defaultCountdownMinutes)
        : '');
  useUnsavedChanges(
    title !== task.title || listId !== task.listId || planningChanged || startingChanged,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError('Enter a task title.');
      return;
    }
    try {
      const planning = validatePlanning({
        plannedDate: plannedDate || undefined,
        deadlineDate: deadlineDate || undefined,
        flexibleStartDate: flexibleStartDate || undefined,
        flexibleEndDate: flexibleEndDate || undefined,
        timeWindow:
          plannedDate && timeChoice !== 'any' && timeChoice !== 'exact' ? timeChoice : undefined,
        exactStartTime:
          plannedDate && timeChoice === 'exact' ? exactStartTime || undefined : undefined,
        estimatedDurationMinutes: duration ? Number(duration) : undefined,
      });
      await plannerRepository.updateTask(task.id, title, listId);
      await plannerRepository.updateTaskPlanning(task.id, planning);
      await focusRepository.saveStartingDetails(task.id, {
        whyItMatters,
        preferredStartStyle: preferredStartStyle || undefined,
        defaultCountdownMinutes: defaultCountdown ? Number(defaultCountdown) : undefined,
      });
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The task could not be saved.');
    }
  }

  async function deleteTask() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      const receipt = await plannerRepository.deleteTask(task.id);
      showDeletionUndo(receipt);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'The task could not be deleted.',
      );
    }
  }

  const blockingTasks = (snapshot.blockedByTaskId[task.id] ?? [])
    .map((id) => snapshot.tasks.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is TaskRecord => candidate !== undefined);

  return (
    <Dialog title="Edit task" onClose={onClose}>
      {blockingTasks.length > 0 ? (
        <p className="blocked-notice" role="status">
          Blocked until {formatTaskNames(blockingTasks)} {blockingTasks.length === 1 ? 'is' : 'are'}
          completed.
        </p>
      ) : null}
      <form className="form-stack task-core-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span>Task title</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        </label>
        <fieldset className="starting-support-fields">
          <legend>Starting support</legend>
          <p>
            Optional details for beginning this task. They do not affect planning or completion.
          </p>
          <label className="field">
            <span>Why this task matters</span>
            <textarea
              aria-label="Why this task matters"
              value={whyItMatters}
              maxLength={TASK_WHY_MAX_LENGTH}
              rows={3}
              onChange={(event) => setWhyItMatters(event.target.value)}
            />
            <span className="field-help">Plain text, up to {TASK_WHY_MAX_LENGTH} characters.</span>
          </label>
          <div className="planning-grid">
            <label className="field">
              <span>Preferred start style</span>
              <select
                value={preferredStartStyle}
                onChange={(event) =>
                  setPreferredStartStyle(event.target.value as TaskStartStyle | '')
                }
              >
                <option value="">No preference</option>
                <option value="gentle">Gentle Start</option>
                <option value="oneThing">One Thing</option>
                <option value="full">Full View</option>
              </select>
            </label>
            <label className="field">
              <span>Default countdown (minutes)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={COUNTDOWN_MINUTES_MAX}
                step="1"
                value={defaultCountdown}
                onChange={(event) => setDefaultCountdown(event.target.value)}
              />
            </label>
          </div>
          <p className="field-help">
            Gentle Start shows preparation first. One Thing narrows the view. Full View keeps all
            task details together. You can choose differently each time.
          </p>
        </fieldset>
        <fieldset className="planning-fields">
          <legend>Planning</legend>
          <p>
            A planned day is when you intend to act. A deadline is the genuine last day it can be
            done.
          </p>
          <div className="planning-shortcuts" aria-label="Quick planned day">
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setPlannedDate(localDateFromDate(new Date()));
                setFlexibleStartDate('');
                setFlexibleEndDate('');
              }}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setPlannedDate(addCalendarDays(localDateFromDate(new Date()), 1));
                setFlexibleStartDate('');
                setFlexibleEndDate('');
              }}
            >
              Tomorrow
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => document.getElementById(`planned-date-${task.id}`)?.focus()}
            >
              Choose Date
            </Button>
          </div>
          <div className="planning-grid">
            <label className="field">
              <span>Planned day</span>
              <input
                id={`planned-date-${task.id}`}
                type="date"
                value={plannedDate}
                onChange={(event) => {
                  setPlannedDate(event.target.value);
                  if (event.target.value) {
                    setFlexibleStartDate('');
                    setFlexibleEndDate('');
                  } else {
                    setTimeChoice('any');
                    setExactStartTime('');
                  }
                }}
              />
            </label>
            <label className="field">
              <span>Genuine deadline</span>
              <input
                type="date"
                value={deadlineDate}
                onChange={(event) => setDeadlineDate(event.target.value)}
              />
            </label>
          </div>
          <fieldset className="planning-range">
            <legend>Flexible date range</legend>
            <p>Use this when either day would suit; it is not a deadline.</p>
            <div className="planning-grid">
              <label className="field">
                <span>From</span>
                <input
                  type="date"
                  value={flexibleStartDate}
                  onChange={(event) => {
                    setFlexibleStartDate(event.target.value);
                    if (event.target.value) {
                      setPlannedDate('');
                      setTimeChoice('any');
                      setExactStartTime('');
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>To</span>
                <input
                  type="date"
                  value={flexibleEndDate}
                  onChange={(event) => {
                    setFlexibleEndDate(event.target.value);
                    if (event.target.value) {
                      setPlannedDate('');
                      setTimeChoice('any');
                      setExactStartTime('');
                    }
                  }}
                />
              </label>
            </div>
          </fieldset>
          <div className="planning-grid">
            <label className="field">
              <span>Time</span>
              <select
                value={timeChoice}
                disabled={!plannedDate}
                onChange={(event) => {
                  const value = event.target.value as 'any' | 'exact' | TaskTimeWindow;
                  setTimeChoice(value);
                  if (value !== 'exact') setExactStartTime('');
                }}
              >
                <option value="any">Any Time</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
                <option value="exact">Exact start time</option>
              </select>
            </label>
            {timeChoice === 'exact' && plannedDate ? (
              <label className="field">
                <span>Exact start time</span>
                <input
                  type="time"
                  required
                  value={exactStartTime}
                  onChange={(event) => setExactStartTime(event.target.value)}
                />
              </label>
            ) : null}
            <label className="field">
              <span>Estimated duration (minutes)</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </label>
          </div>
          <div className="duration-presets" aria-label="Duration presets">
            {[15, 30, 60, 90].map((minutes) => (
              <button key={minutes} type="button" onClick={() => setDuration(String(minutes))}>
                {minutes} min
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setPlannedDate('');
              setDeadlineDate('');
              setFlexibleStartDate('');
              setFlexibleEndDate('');
              setTimeChoice('any');
              setExactStartTime('');
              setDuration('');
            }}
          >
            Clear planning
          </Button>
        </fieldset>
        <label className="field">
          <span>Destination list</span>
          <select value={listId} onChange={(event) => setListId(event.target.value)}>
            {snapshot.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="secondary">
          Save
        </Button>
      </form>

      <PrepChecklistEditor
        task={task}
        items={snapshot.taskPrepItems.filter((item) => item.taskId === task.id)}
      />
      <StepEditor
        task={task}
        steps={snapshot.taskSteps.filter((step) => step.taskId === task.id)}
      />
      <TagEditor task={task} snapshot={snapshot} />
      <RelationshipEditor task={task} snapshot={snapshot} />

      <div className="dialog__actions">
        <Button
          type="button"
          className={confirmDelete ? 'button--destructive' : ''}
          variant={confirmDelete ? 'primary' : 'quiet'}
          onClick={() => void deleteTask()}
        >
          {confirmDelete ? 'Confirm delete task' : 'Delete task'}
        </Button>
        <Button type="button" variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

function PrepChecklistEditor({ task, items }: { task: TaskRecord; items: TaskPrepItemRecord[] }) {
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedTitle = newTitle;
    setNewTitle('');
    try {
      await focusRepository.createPrepItem(task.id, submittedTitle);
      setAnnouncement(`${submittedTitle.trim()} added to preparation.`);
      setError(null);
    } catch (caughtError) {
      setNewTitle((current) => current || submittedTitle);
      setError(
        caughtError instanceof Error ? caughtError.message : 'The prep item could not be added.',
      );
    }
  }

  async function renameItem(item: TaskPrepItemRecord) {
    try {
      await focusRepository.updatePrepItem(item.id, editingTitle);
      setEditingId(null);
      setAnnouncement('Prep item renamed.');
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'The prep item could not be saved.',
      );
    }
  }

  async function resetItems() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    const count = await focusRepository.resetPrepItems(task.id);
    setConfirmReset(false);
    setAnnouncement(`${count} prep ${count === 1 ? 'item' : 'items'} reset.`);
  }

  const completed = items.filter((item) => item.completed).length;
  return (
    <section className="task-detail-section prep-checklist" aria-labelledby="prep-heading">
      <div className="task-detail-heading">
        <div>
          <h3 id="prep-heading">Prep checklist</h3>
          <p>Preparation gets things ready. It does not count as task-step progress.</p>
        </div>
        {items.length > 0 ? (
          <span aria-label={`${completed} of ${items.length} prep items completed`}>
            {completed} of {items.length}
          </span>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ol className="step-list prep-list">
          {items.map((item, index) => (
            <li key={item.id} className={item.completed ? 'is-completed' : undefined}>
              <label className="detail-check">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    void focusRepository
                      .setPrepItemCompleted(item.id, checked)
                      .then(() =>
                        setAnnouncement(
                          `${item.title} ${checked ? 'ready' : 'returned to preparation'}.`,
                        ),
                      );
                  }}
                />
                <span className="visually-hidden">
                  {item.completed ? 'Mark not ready' : 'Mark ready'} {item.title}
                </span>
              </label>
              {editingId === item.id ? (
                <input
                  className="step-title-input"
                  aria-label={`Rename ${item.title}`}
                  value={editingTitle}
                  maxLength={PREP_ITEM_TITLE_MAX_LENGTH}
                  onChange={(event) => setEditingTitle(event.target.value)}
                />
              ) : (
                <span className="step-title">{item.title}</span>
              )}
              <div className="compact-actions">
                {editingId === item.id ? (
                  <button type="button" onClick={() => void renameItem(item)}>
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingTitle(item.title);
                    }}
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move ${item.title} up`}
                  onClick={() => void focusRepository.movePrepItem(item.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.title} down`}
                  onClick={() => void focusRepository.movePrepItem(item.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void focusRepository
                      .duplicatePrepItem(item.id)
                      .then(() => setAnnouncement(`${item.title} duplicated.`))
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="destructive-text"
                  onClick={() =>
                    void focusRepository.deletePrepItem(item.id).then(showDeletionUndo)
                  }
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="task-detail-empty">
          Add only the preparation that would make starting easier.
        </p>
      )}
      <form className="inline-add" onSubmit={(event) => void addItem(event)}>
        <label className="visually-hidden" htmlFor={`new-prep-${task.id}`}>
          New prep item title
        </label>
        <input
          id={`new-prep-${task.id}`}
          value={newTitle}
          maxLength={PREP_ITEM_TITLE_MAX_LENGTH}
          placeholder="Add preparation"
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <Button type="submit" variant="quiet" disabled={!newTitle.trim()}>
          Add prep
        </Button>
      </form>
      {completed > 0 ? (
        <Button type="button" variant="quiet" onClick={() => void resetItems()}>
          {confirmReset ? 'Confirm reset all prep' : 'Reset completed prep'}
        </Button>
      ) : null}
      {confirmReset ? (
        <Button type="button" variant="quiet" onClick={() => setConfirmReset(false)}>
          Keep prep as it is
        </Button>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}

function StepEditor({ task, steps }: { task: TaskRecord; steps: TaskStepRecord[] }) {
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    const submittedTitle = newTitle;
    setNewTitle('');
    try {
      await plannerRepository.createStep(task.id, submittedTitle);
      setError(null);
    } catch (caughtError) {
      setNewTitle((current) => current || submittedTitle);
      setError(caughtError instanceof Error ? caughtError.message : 'The step could not be added.');
    }
  }

  async function renameStep(step: TaskStepRecord) {
    try {
      await plannerRepository.updateStep(step.id, editingTitle);
      setEditingId(null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The step could not be saved.');
    }
  }

  const completed = steps.filter((step) => step.completed).length;
  return (
    <section className="task-detail-section" aria-labelledby="steps-heading">
      <div className="task-detail-heading">
        <h3 id="steps-heading">Steps</h3>
        {steps.length > 0 ? (
          <span aria-label={`${completed} of ${steps.length} steps completed`}>
            {completed} of {steps.length}
          </span>
        ) : null}
      </div>
      {steps.length > 0 ? (
        <ol className="step-list">
          {steps.map((step, index) => (
            <li key={step.id} className={step.completed ? 'is-completed' : undefined}>
              <label className="detail-check">
                <input
                  type="checkbox"
                  checked={step.completed}
                  onChange={(event) =>
                    void plannerRepository.setStepCompleted(step.id, event.target.checked)
                  }
                />
                <span className="visually-hidden">
                  {step.completed ? 'Mark incomplete' : 'Complete'} {step.title}
                </span>
              </label>
              {editingId === step.id ? (
                <input
                  className="step-title-input"
                  aria-label={`Rename ${step.title}`}
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                />
              ) : (
                <span className="step-title">{step.title}</span>
              )}
              <div className="compact-actions">
                {editingId === step.id ? (
                  <button type="button" onClick={() => void renameStep(step)}>
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(step.id);
                      setEditingTitle(step.title);
                    }}
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move ${step.title} up`}
                  onClick={() => void plannerRepository.moveStep(step.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === steps.length - 1}
                  aria-label={`Move ${step.title} down`}
                  onClick={() => void plannerRepository.moveStep(step.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="destructive-text"
                  onClick={() => void plannerRepository.deleteStep(step.id).then(showDeletionUndo)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="task-detail-empty">
          Add steps only when they make this task easier to start.
        </p>
      )}
      <form className="inline-add" onSubmit={(event) => void addStep(event)}>
        <label className="visually-hidden" htmlFor={`new-step-${task.id}`}>
          New step title
        </label>
        <input
          id={`new-step-${task.id}`}
          value={newTitle}
          maxLength={200}
          placeholder="Add a step"
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <Button type="submit" variant="quiet" disabled={!newTitle.trim()}>
          Add
        </Button>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TagEditor({ task, snapshot }: { task: TaskRecord; snapshot: PlannerSnapshot }) {
  const assignedTagIds = new Set(
    snapshot.taskTags.filter((item) => item.taskId === task.id).map((item) => item.tagId),
  );
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(ENTITY_COLORS[0].value);
  const [editingTag, setEditingTag] = useState<TagRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(tag: TagRecord) {
    setEditingTag(tag);
    setName(tag.name);
    setColor(tag.color);
    setConfirmDeleteId(null);
  }

  function resetEditor() {
    setEditingTag(null);
    setName('');
    setColor(ENTITY_COLORS[0].value);
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      if (editingTag) await plannerRepository.updateTag(editingTag.id, name, color);
      else await plannerRepository.createTag(name, color);
      resetEditor();
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The tag could not be saved.');
    }
  }

  async function deleteTag(tag: TagRecord) {
    if (confirmDeleteId !== tag.id) {
      setConfirmDeleteId(tag.id);
      return;
    }
    try {
      await plannerRepository.deleteTag(tag.id, true);
      setConfirmDeleteId(null);
      if (editingTag?.id === tag.id) resetEditor();
    } catch (caughtError) {
      setError(
        caughtError instanceof TagInUseError || caughtError instanceof Error
          ? caughtError.message
          : 'The tag could not be deleted.',
      );
    }
  }

  return (
    <section className="task-detail-section" aria-labelledby="tags-heading">
      <div className="task-detail-heading">
        <h3 id="tags-heading">Tags</h3>
        <span>Optional</span>
      </div>
      {snapshot.tags.length > 0 ? (
        <ul className="tag-editor-list">
          {snapshot.tags.map((tag) => (
            <li key={tag.id}>
              <label>
                <input
                  type="checkbox"
                  checked={assignedTagIds.has(tag.id)}
                  onChange={(event) =>
                    void (event.target.checked
                      ? plannerRepository.assignTag(task.id, tag.id)
                      : plannerRepository.unassignTag(task.id, tag.id))
                  }
                />
                <span className="tag-chip" style={{ '--tag-color': tag.color } as CSSProperties}>
                  {tag.name}
                </span>
              </label>
              <div className="compact-actions">
                <button type="button" onClick={() => beginEdit(tag)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="destructive-text"
                  onClick={() => void deleteTag(tag)}
                >
                  {confirmDeleteId === tag.id ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-detail-empty">
          No tags yet. Create one only if it will be useful again.
        </p>
      )}
      <form className="tag-form" onSubmit={(event) => void saveTag(event)}>
        <label className="field">
          <span>{editingTag ? 'Tag name' : 'New tag'}</span>
          <input
            value={name}
            maxLength={50}
            placeholder={editingTag ? undefined : 'For example, Home'}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Colour</span>
          <select value={color} onChange={(event) => setColor(event.target.value)}>
            {ENTITY_COLORS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-actions">
          {editingTag ? (
            <Button type="button" variant="quiet" onClick={resetEditor}>
              Cancel edit
            </Button>
          ) : null}
          <Button type="submit" variant="quiet" disabled={!name.trim()}>
            {editingTag ? 'Save tag' : 'Create tag'}
          </Button>
        </div>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RelationshipEditor({ task, snapshot }: { task: TaskRecord; snapshot: PlannerSnapshot }) {
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const otherTasks = snapshot.tasks.filter((candidate) => candidate.id !== task.id);
  const before = snapshot.taskRelationships.filter(
    (relationship) => relationship.successorTaskId === task.id,
  );
  const after = snapshot.taskRelationships.filter(
    (relationship) => relationship.predecessorTaskId === task.id,
  );

  async function add(predecessorId: string, successorId: string, reset: () => void) {
    if (!predecessorId || !successorId) return;
    try {
      await plannerRepository.addRelationship(predecessorId, successorId);
      reset();
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof RelationshipValidationError || caughtError instanceof Error
          ? caughtError.message
          : 'The relationship could not be added.',
      );
    }
  }

  return (
    <section className="task-detail-section" aria-labelledby="relationships-heading">
      <div className="task-detail-heading">
        <h3 id="relationships-heading">Before and after</h3>
        <span>Optional</span>
      </div>
      <RelationshipGroup
        label="Before this task"
        relationships={before.map((relationship) => ({
          relationship,
          relatedTask: snapshot.tasks.find(
            (candidate) => candidate.id === relationship.predecessorTaskId,
          ),
        }))}
      />
      <div className="relationship-add">
        <select
          aria-label="Task that happens before this task"
          value={beforeId}
          onChange={(event) => setBeforeId(event.target.value)}
        >
          <option value="">Choose a task…</option>
          {otherTasks.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="quiet"
          disabled={!beforeId}
          onClick={() => void add(beforeId, task.id, () => setBeforeId(''))}
        >
          Add before
        </Button>
      </div>
      <RelationshipGroup
        label="After this task"
        relationships={after.map((relationship) => ({
          relationship,
          relatedTask: snapshot.tasks.find(
            (candidate) => candidate.id === relationship.successorTaskId,
          ),
        }))}
      />
      <div className="relationship-add">
        <select
          aria-label="Task that happens after this task"
          value={afterId}
          onChange={(event) => setAfterId(event.target.value)}
        >
          <option value="">Choose a task…</option>
          {otherTasks.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="quiet"
          disabled={!afterId}
          onClick={() => void add(task.id, afterId, () => setAfterId(''))}
        >
          Add after
        </Button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RelationshipGroup({
  label,
  relationships,
}: {
  label: string;
  relationships: {
    relationship: PlannerSnapshot['taskRelationships'][number];
    relatedTask: TaskRecord | undefined;
  }[];
}) {
  return (
    <div className="relationship-group">
      <h4>{label}</h4>
      {relationships.length > 0 ? (
        <ul>
          {relationships.map(({ relationship, relatedTask }) => (
            <li key={relationship.id}>
              <span>{relatedTask?.title ?? 'Unavailable task'}</span>
              <button
                type="button"
                onClick={() => void plannerRepository.removeRelationship(relationship.id)}
                aria-label={`Remove relationship with ${relatedTask?.title ?? 'unavailable task'}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>None</p>
      )}
    </div>
  );
}

function formatTaskNames(tasks: TaskRecord[]): string {
  return tasks.map((task) => `“${task.title}”`).join(tasks.length > 2 ? ', ' : ' and ');
}
