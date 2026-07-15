import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { plannerRepository } from '../../data/plannerRepository';
import { addCalendarDays, localDateFromDate } from '../../data/planning';
import { INBOX_LIST_ID } from '../../data/plannerTypes';
import { usePlannerSnapshot } from './usePlannerSnapshot';
import { useUnsavedChanges } from './unsavedChanges';

type QuickAddDialogProps = {
  onClose: () => void;
};

export function QuickAddDialog({ onClose }: QuickAddDialogProps) {
  const { snapshot, isLoading } = usePlannerSnapshot();
  const [title, setTitle] = useState('');
  const [listId, setListId] = useState(INBOX_LIST_ID);
  const [plannedDay, setPlannedDay] = useState<'none' | 'today' | 'tomorrow'>('none');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  useUnsavedChanges(title.length > 0 || listId !== INBOX_LIST_ID || plannedDay !== 'none');

  useEffect(() => {
    if (!snapshot.lists.some((list) => list.id === listId)) setListId(INBOX_LIST_ID);
  }, [listId, snapshot.lists]);

  async function save(keepOpen: boolean) {
    if (!title.trim()) {
      setError('Enter a task title.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const today = localDateFromDate(new Date());
      await plannerRepository.createTask(title, listId, {
        plannedDate:
          plannedDay === 'today'
            ? today
            : plannedDay === 'tomorrow'
              ? addCalendarDays(today, 1)
              : undefined,
      });
      if (keepOpen) {
        setTitle('');
        setMessage('Task saved. Add another when you are ready.');
        setIsSaving(false);
      } else {
        onClose();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The task could not be saved.');
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  return (
    <Dialog
      title="Quick Add"
      description="A title is all you need. New tasks start in Inbox unless you choose another list."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Task title</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setMessage('');
            }}
            maxLength={200}
          />
        </label>
        <fieldset className="quick-plan-choice">
          <legend>Optional planned day</legend>
          {(['none', 'today', 'tomorrow'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="quick-planned-day"
                checked={plannedDay === value}
                onChange={() => setPlannedDay(value)}
              />
              {value === 'none' ? 'Not planned' : value === 'today' ? 'Today' : 'Tomorrow'}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Destination list</span>
          <select
            value={listId}
            onChange={(event) => setListId(event.target.value)}
            disabled={isLoading}
          >
            {snapshot.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.systemType === 'inbox'
                  ? list.name
                  : `${snapshot.areas.find((area) => area.id === list.areaId)?.name ?? 'Area'} — ${list.name}`}
              </option>
            ))}
          </select>
        </label>
        <div className="form-message" aria-live="polite">
          {message}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions dialog__actions--stack-mobile">
          <Button
            type="button"
            variant="secondary"
            disabled={isSaving || isLoading}
            onClick={() => void save(true)}
          >
            Save &amp; Add Another
          </Button>
          <Button type="submit" disabled={isSaving || isLoading}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
