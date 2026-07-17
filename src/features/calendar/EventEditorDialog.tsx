import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import {
  calendarRepository,
  type CalendarEventInput,
  type RecurringDeleteScope,
  type RecurringEditScope,
} from '../../data/calendarRepository';
import type {
  CalendarOccurrence,
  CalendarRecord,
  EventTemplateRecord,
  RecurrenceDefinition,
  RecurrenceRuleRecord,
} from '../../data/plannerTypes';
import { recurrenceSummary } from '../../data/recurrence';
import { showDeletionUndo } from '../planner/plannerEvents';
import { useUnsavedChanges } from '../planner/unsavedChanges';
import { RecurrenceFields } from './RecurrenceFields';

type ScopeRequest = 'edit' | 'delete' | null;

export function EventEditorDialog({
  event,
  calendars,
  templates,
  recurrenceRules,
  initialDate,
  onClose,
  onAnnounce,
}: {
  event?: CalendarOccurrence;
  calendars: CalendarRecord[];
  templates: EventTemplateRecord[];
  recurrenceRules: RecurrenceRuleRecord[];
  initialDate: string;
  onClose: () => void;
  onAnnounce?: (message: string) => void;
}) {
  const existingRule = event?.isRecurring
    ? recurrenceRules.find((rule) => rule.eventId === event.sourceEventId)
    : undefined;
  const [title, setTitle] = useState(event?.title ?? '');
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? calendars[0]?.id ?? '');
  const [startDate, setStartDate] = useState(event?.startDate ?? initialDate);
  const [endDate, setEndDate] = useState(event?.endDate ?? initialDate);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startTime, setStartTime] = useState(event?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(event?.endTime ?? '10:00');
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceDefinition | undefined>(
    existingRule ? definitionFromRule(existingRule) : undefined,
  );
  const [templateId, setTemplateId] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest>(null);
  const initialState = useMemo(
    () =>
      JSON.stringify({
        title: event?.title ?? '',
        calendarId: event?.calendarId ?? calendars[0]?.id ?? '',
        startDate: event?.startDate ?? initialDate,
        endDate: event?.endDate ?? initialDate,
        allDay: event?.allDay ?? false,
        startTime: event?.startTime ?? '09:00',
        endTime: event?.endTime ?? '10:00',
        location: event?.location ?? '',
        notes: event?.notes ?? '',
        recurrence: existingRule ? definitionFromRule(existingRule) : undefined,
      }),
    [calendars, event, existingRule, initialDate],
  );
  const dirty =
    initialState !==
    JSON.stringify({
      title,
      calendarId,
      startDate,
      endDate,
      allDay,
      startTime,
      endTime,
      location,
      notes,
      recurrence,
    });
  useUnsavedChanges(dirty || savingTemplate);

  function input(): CalendarEventInput {
    return { title, calendarId, startDate, endDate, allDay, startTime, endTime, location, notes };
  }

  async function save(scope?: RecurringEditScope) {
    try {
      if (event?.isRecurring) {
        if (!scope) {
          setScopeRequest('edit');
          return;
        }
        await calendarRepository.editRecurringOccurrence(event, input(), recurrence, scope);
      } else {
        await calendarRepository.saveEventWithRecurrence(input(), recurrence, event?.sourceEventId);
      }
      onAnnounce?.(`${title.trim()} ${event ? 'updated' : 'created'}.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Event could not save.');
      setScopeRequest(null);
    }
  }

  async function duplicate() {
    if (!event) return;
    try {
      await calendarRepository.saveEvent({ ...input(), title: `${event.title} copy` });
      onAnnounce?.(`${event.title} duplicated as a one-off event.`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Event could not duplicate.');
    }
  }

  async function remove(scope?: RecurringDeleteScope) {
    if (!event) return;
    try {
      if (event.isRecurring && !scope) {
        setScopeRequest('delete');
        return;
      }
      const receipt = event.isRecurring
        ? await calendarRepository.deleteRecurringOccurrence(event, scope!)
        : await calendarRepository.deleteEvent(event.sourceEventId);
      showDeletionUndo(receipt);
      onAnnounce?.(
        event.isRecurring && scope === 'occurrence'
          ? `${event.title} occurrence removed.`
          : `${event.title} moved to Recently Deleted or shortened.`,
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Event could not be deleted.');
      setScopeRequest(null);
    }
  }

  async function applyTemplate() {
    if (!templateId) return;
    try {
      const resolved = await calendarRepository.resolveTemplate(templateId, startDate);
      const next = resolved.input;
      setTitle(next.title);
      setCalendarId(next.calendarId);
      setAllDay(next.allDay);
      setStartTime(next.startTime ?? '09:00');
      setEndTime(next.endTime ?? '10:00');
      setLocation(next.location ?? '');
      setNotes(next.notes ?? '');
      setRecurrence(resolved.recurrence);
      setTemplateNotice(
        resolved.fellBack
          ? 'The saved calendar is unavailable, so the default active calendar was selected. Confirm the date and calendar before saving.'
          : 'Template applied. Confirm the date before saving.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Template could not be applied.');
    }
  }

  async function saveAsTemplate() {
    try {
      await calendarRepository.saveTemplate({
        name: templateName,
        title,
        calendarId,
        allDay,
        startTime: allDay ? undefined : startTime,
        endTime: allDay ? undefined : endTime,
        location,
        notes,
        recurrence,
      });
      setSavingTemplate(false);
      setTemplateName('');
      onAnnounce?.('Event template saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Template could not save.');
    }
  }

  return (
    <Dialog
      title={event ? 'Edit event' : 'Create event'}
      description="Appointments stay private and available offline."
      onClose={onClose}
    >
      <div className="editor-form event-editor">
        {!event && templates.length ? (
          <fieldset className="template-picker">
            <legend>
              Start from a template <small>optional</small>
            </legend>
            <div className="inline-add">
              <label className="field">
                <span>Template</span>
                <select
                  value={templateId}
                  onChange={(choice) => setTemplateId(choice.target.value)}
                >
                  <option value="">Choose a template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="secondary"
                disabled={!templateId}
                onClick={() => void applyTemplate()}
              >
                Apply
              </Button>
            </div>
            {templateNotice ? (
              <p className="field-help" role="status">
                {templateNotice}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            maxLength={160}
            value={title}
            onChange={(change) => setTitle(change.target.value)}
          />
        </label>
        <label className="field">
          <span>Calendar</span>
          <select value={calendarId} onChange={(change) => setCalendarId(change.target.value)}>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        </label>
        {event && calendarId !== event.calendarId ? (
          <p className="field-help">
            Saving moves the selected scope to{' '}
            {calendars.find((calendar) => calendar.id === calendarId)?.name}.
          </p>
        ) : null}
        <label className="check-field">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(change) => setAllDay(change.target.checked)}
          />
          <span>All day</span>
        </label>
        <div className="event-editor__dates">
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(change) => setStartDate(change.target.value)}
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(change) => setEndDate(change.target.value)}
            />
          </label>
        </div>
        {!allDay ? (
          <div className="event-editor__dates">
            <label className="field">
              <span>Start time</span>
              <input
                type="time"
                value={startTime}
                onChange={(change) => setStartTime(change.target.value)}
              />
            </label>
            <label className="field">
              <span>End time</span>
              <input
                type="time"
                value={endTime}
                onChange={(change) => setEndTime(change.target.value)}
              />
            </label>
          </div>
        ) : null}
        <label className="field">
          <span>
            Location <small>optional</small>
          </span>
          <input
            maxLength={240}
            value={location}
            onChange={(change) => setLocation(change.target.value)}
          />
        </label>
        <label className="field">
          <span>
            Notes <small>optional</small>
          </span>
          <textarea
            maxLength={4000}
            rows={4}
            value={notes}
            onChange={(change) => setNotes(change.target.value)}
          />
        </label>
        <RecurrenceFields value={recurrence} startDate={startDate} onChange={setRecurrence} />
        {event?.isRecurring ? (
          <p className="recurrence-badge">
            Repeating event · {existingRule ? recurrenceSummary(existingRule) : 'series'}
          </p>
        ) : null}
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
              <Button className="button--destructive" variant="quiet" onClick={() => void remove()}>
                Delete
              </Button>
            </>
          ) : null}
          <Button variant="quiet" onClick={() => setSavingTemplate(true)}>
            Save as template
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save event</Button>
        </div>
      </div>
      {scopeRequest ? (
        <ScopeDialog
          mode={scopeRequest}
          title={event?.title ?? title}
          onClose={() => setScopeRequest(null)}
          onChoose={(scope) => void (scopeRequest === 'edit' ? save(scope) : remove(scope))}
        />
      ) : null}
      {savingTemplate ? (
        <Dialog
          title="Save event as template"
          description="The template will create independent events and will not change this event."
          onClose={() => setSavingTemplate(false)}
        >
          <label className="field">
            <span>Template name</span>
            <input
              autoFocus
              maxLength={80}
              value={templateName}
              onChange={(change) => setTemplateName(change.target.value)}
            />
          </label>
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setSavingTemplate(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAsTemplate()}>Save template</Button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

function ScopeDialog({
  mode,
  title,
  onClose,
  onChoose,
}: {
  mode: Exclude<ScopeRequest, null>;
  title: string;
  onClose: () => void;
  onChoose: (scope: RecurringEditScope) => void;
}) {
  const verb = mode === 'edit' ? 'Change' : 'Delete';
  return (
    <Dialog
      title={`${verb} recurring event?`}
      description={`Choose how ${verb.toLowerCase()} affects “${title}”. Structural series changes are applied only after this choice.`}
      onClose={onClose}
    >
      <div className="scope-choices">
        <Button variant="secondary" onClick={() => onChoose('occurrence')}>
          <strong>This event only</strong>
          <span>
            {mode === 'edit'
              ? 'Keep a durable override with the same occurrence identity.'
              : 'Cancel only this occurrence. It still counts in a count-limited series.'}
          </span>
        </Button>
        <Button variant="secondary" onClick={() => onChoose('future')}>
          <strong>This and future events</strong>
          <span>
            {mode === 'edit'
              ? 'Split the series here. Earlier events stay unchanged.'
              : 'Keep earlier events and remove this occurrence onward.'}
          </span>
        </Button>
        <Button
          className={mode === 'delete' ? 'button--destructive' : ''}
          onClick={() => onChoose('series')}
        >
          <strong>Entire series</strong>
          <span>
            {mode === 'edit'
              ? 'Change every non-overridden occurrence in the series.'
              : 'Move the full series and its exceptions to Recently Deleted.'}
          </span>
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

function definitionFromRule(rule: RecurrenceRuleRecord): RecurrenceDefinition {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays ? [...rule.weekdays] : undefined,
    monthDay: rule.monthDay,
    ordinal: rule.ordinal,
    ordinalWeekday: rule.ordinalWeekday,
    yearlyMonth: rule.yearlyMonth,
    yearlyDay: rule.yearlyDay,
    endMode: rule.endMode,
    endDate: rule.endDate,
    occurrenceCount: rule.occurrenceCount,
  };
}
