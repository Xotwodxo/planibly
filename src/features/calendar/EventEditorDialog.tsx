import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { calendarRepository } from '../../data/calendarRepository';
import type { CalendarEventRecord, CalendarRecord } from '../../data/plannerTypes';
import { showDeletionUndo } from '../planner/plannerEvents';
import { useUnsavedChanges } from '../planner/unsavedChanges';

export function EventEditorDialog({
  event,
  calendars,
  initialDate,
  onClose,
  onAnnounce,
}: {
  event?: CalendarEventRecord;
  calendars: CalendarRecord[];
  initialDate: string;
  onClose: () => void;
  onAnnounce?: (message: string) => void;
}) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? calendars[0]?.id ?? '');
  const [startDate, setStartDate] = useState(event?.startDate ?? initialDate);
  const [endDate, setEndDate] = useState(event?.endDate ?? initialDate);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startTime, setStartTime] = useState(event?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(event?.endTime ?? '10:00');
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    title !== (event?.title ?? '') ||
    calendarId !== (event?.calendarId ?? calendars[0]?.id ?? '') ||
    startDate !== (event?.startDate ?? initialDate) ||
    endDate !== (event?.endDate ?? initialDate) ||
    allDay !== (event?.allDay ?? false) ||
    (!allDay &&
      (startTime !== (event?.startTime ?? '09:00') || endTime !== (event?.endTime ?? '10:00'))) ||
    location !== (event?.location ?? '') ||
    notes !== (event?.notes ?? '');
  useUnsavedChanges(dirty);
  async function save() {
    try {
      await calendarRepository.saveEvent(
        { title, calendarId, startDate, endDate, allDay, startTime, endTime, location, notes },
        event?.id,
      );
      onAnnounce?.(`${title.trim()} ${event ? 'updated' : 'created'}.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Event could not save.');
    }
  }
  async function duplicate() {
    if (!event) return;
    try {
      await calendarRepository.duplicateEvent(event.id);
      onAnnounce?.(`${event.title} duplicated.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Event could not duplicate.');
    }
  }
  async function remove() {
    if (!event) return;
    const receipt = await calendarRepository.deleteEvent(event.id);
    showDeletionUndo(receipt);
    onAnnounce?.(`${event.title} moved to Recently Deleted.`);
    onClose();
  }
  return (
    <Dialog
      title={event ? 'Edit event' : 'Create event'}
      description="Appointments stay private and available offline."
      onClose={onClose}
    >
      <div className="editor-form event-editor">
        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Calendar</span>
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        </label>
        {event && calendarId !== event.calendarId ? (
          <p className="field-help">
            Saving moves this event to{' '}
            {calendars.find((calendar) => calendar.id === calendarId)?.name}.
          </p>
        ) : null}
        <label className="check-field">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>All day</span>
        </label>
        <div className="event-editor__dates">
          <label className="field">
            <span>Start date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>End date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        {!allDay ? (
          <div className="event-editor__dates">
            <label className="field">
              <span>Start time</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="field">
              <span>End time</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
        ) : null}
        <label className="field">
          <span>
            Location <small>optional</small>
          </span>
          <input maxLength={240} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Notes <small>optional</small>
          </span>
          <textarea
            maxLength={4000}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions dialog__actions--wrap">
          {event ? (
            <>
              <Button variant="quiet" onClick={() => void duplicate()}>
                Duplicate
              </Button>
              <Button
                className="button--destructive"
                variant="quiet"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </>
          ) : null}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save event</Button>
        </div>
      </div>
      {confirmDelete ? (
        <Dialog
          title={`Delete ${event?.title}?`}
          description="The event moves to Recently Deleted and can be undone for ten seconds."
          onClose={() => setConfirmDelete(false)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button className="button--destructive" onClick={() => void remove()}>
              Delete event
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
