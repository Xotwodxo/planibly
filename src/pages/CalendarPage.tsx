import { useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Surface } from '../components/ui/Surface';
import {
  calendarName,
  eventsForDate,
  monthGrid,
  upcomingEvents,
  visibleCalendarEvents,
} from '../data/calendar';
import { calendarRepository } from '../data/calendarRepository';
import { ENTITY_COLORS, type CalendarEventRecord, type CalendarRecord } from '../data/plannerTypes';
import { formatLocalDate, localDateFromDate } from '../data/planning';
import { EventEditorDialog } from '../features/calendar/EventEditorDialog';
import { showDeletionUndo } from '../features/planner/plannerEvents';
import { usePlannerSnapshot } from '../features/planner/usePlannerSnapshot';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function monthFromDate(date: string) {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return { year, monthIndex: month - 1 };
}
function shiftMonth(year: number, monthIndex: number, offset: number) {
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth() };
}
function monthTitle(year: number, monthIndex: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export function CalendarPage() {
  const { snapshot, isLoading, error } = usePlannerSnapshot();
  const today = localDateFromDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [shownMonth, setShownMonth] = useState(monthFromDate(today));
  const [editing, setEditing] = useState<CalendarEventRecord | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [upcomingDays, setUpcomingDays] = useState(14);
  const [announcement, setAnnouncement] = useState('');
  const events = useMemo(() => visibleCalendarEvents(snapshot), [snapshot]);
  const days = useMemo(
    () => monthGrid(shownMonth.year, shownMonth.monthIndex, events),
    [events, shownMonth],
  );
  const selectedEvents = eventsForDate(events, selectedDate);
  const upcoming = upcomingEvents(events, today, upcomingDays);
  if (isLoading) return <p role="status">Opening calendar…</p>;
  function chooseMonth(offset: number) {
    setShownMonth((current) => shiftMonth(current.year, current.monthIndex, offset));
  }
  function goToday() {
    setSelectedDate(today);
    setShownMonth(monthFromDate(today));
  }
  return (
    <div className="page calendar-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Calendar</span>
          <h1>Appointments, kept local</h1>
          <p>See time commitments without turning them into tasks.</p>
        </div>
        <div className="inline-actions">
          <Button variant="secondary" onClick={() => setManaging(true)}>
            Manage calendars
          </Button>
          <Button disabled={!snapshot.calendars.length} onClick={() => setEditing('new')}>
            Create event
          </Button>
        </div>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <Surface className="month-view" aria-labelledby="month-heading">
        <div className="month-view__heading">
          <Button variant="quiet" aria-label="Previous month" onClick={() => chooseMonth(-1)}>
            ←
          </Button>
          <h2 id="month-heading">{monthTitle(shownMonth.year, shownMonth.monthIndex)}</h2>
          <Button variant="quiet" aria-label="Next month" onClick={() => chooseMonth(1)}>
            →
          </Button>
          <Button variant="secondary" onClick={goToday}>
            Today
          </Button>
        </div>
        <div className="month-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          className="month-grid"
          role="grid"
          aria-label={monthTitle(shownMonth.year, shownMonth.monthIndex)}
        >
          {days.map((day) => {
            const dateEvents = eventsForDate(events, day.localDate);
            return (
              <button
                key={day.localDate}
                type="button"
                role="gridcell"
                className={`month-day${day.inMonth ? '' : ' is-outside'}${day.localDate === today ? ' is-today' : ''}${day.localDate === selectedDate ? ' is-selected' : ''}`}
                aria-selected={day.localDate === selectedDate}
                aria-label={`${formatLocalDate(day.localDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${day.eventCount} event${day.eventCount === 1 ? '' : 's'}`}
                onClick={() => {
                  setSelectedDate(day.localDate);
                  if (!day.inMonth) setShownMonth(monthFromDate(day.localDate));
                }}
              >
                <span>{Number(day.localDate.slice(-2))}</span>
                <span className="month-day__indicators" aria-hidden="true">
                  {dateEvents.slice(0, 3).map((event) => (
                    <i
                      key={event.id}
                      style={{
                        backgroundColor: snapshot.calendars.find(
                          (calendar) => calendar.id === event.calendarId,
                        )?.color,
                      }}
                    />
                  ))}
                </span>
                {day.eventCount > 3 ? (
                  <small aria-hidden="true">+{day.eventCount - 3}</small>
                ) : null}
              </button>
            );
          })}
        </div>
      </Surface>
      <div className="calendar-agendas">
        <Surface aria-labelledby="selected-agenda">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Selected day</span>
              <h2 id="selected-agenda">
                {formatLocalDate(selectedDate, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </h2>
            </div>
            <Button variant="secondary" onClick={() => setEditing('new')}>
              Add here
            </Button>
          </div>
          <EventList
            events={selectedEvents}
            calendars={snapshot.calendars}
            onOpen={setEditing}
            empty="No appointments on this day."
          />
        </Surface>
        <Surface aria-labelledby="upcoming-heading">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Upcoming</span>
              <h2 id="upcoming-heading">Next {upcomingDays} days</h2>
            </div>
          </div>
          <UpcomingAgenda
            events={upcoming}
            calendars={snapshot.calendars}
            today={today}
            onOpen={setEditing}
          />
          {upcomingDays < 42 ? (
            <Button variant="quiet" onClick={() => setUpcomingDays(42)}>
              View more
            </Button>
          ) : null}
        </Surface>
      </div>
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
      {editing ? (
        <EventEditorDialog
          event={editing === 'new' ? undefined : editing}
          calendars={snapshot.calendars}
          initialDate={selectedDate}
          onAnnounce={setAnnouncement}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {managing ? (
        <CalendarManager
          calendars={snapshot.calendars}
          events={snapshot.calendarEvents}
          onClose={() => setManaging(false)}
          onAnnounce={setAnnouncement}
        />
      ) : null}
    </div>
  );
}

export function EventList({
  events,
  calendars,
  onOpen,
  empty,
}: {
  events: CalendarEventRecord[];
  calendars: CalendarRecord[];
  onOpen: (event: CalendarEventRecord) => void;
  empty: string;
}) {
  if (!events.length) return <p className="empty-state">{empty}</p>;
  return (
    <ul className="calendar-event-list">
      {events.map((event) => (
        <li key={event.id}>
          <button onClick={() => onOpen(event)}>
            <span className="event-kind">
              {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}
            </span>
            <strong>{event.title}</strong>
            <span>
              <i
                className="calendar-color"
                style={{
                  backgroundColor: calendars.find((calendar) => calendar.id === event.calendarId)
                    ?.color,
                }}
                aria-hidden="true"
              />
              {calendarName(calendars, event.calendarId)}
            </span>
            {event.startDate !== event.endDate ? (
              <small>
                {formatLocalDate(event.startDate)}–{formatLocalDate(event.endDate)} · multi-day
              </small>
            ) : null}
            {event.location ? <small>{event.location}</small> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function UpcomingAgenda({
  events,
  calendars,
  today,
  onOpen,
}: {
  events: CalendarEventRecord[];
  calendars: CalendarRecord[];
  today: string;
  onOpen: (event: CalendarEventRecord) => void;
}) {
  if (!events.length) return <p className="empty-state">No appointments coming up.</p>;
  const groupDate = (event: CalendarEventRecord) =>
    event.startDate < today ? today : event.startDate;
  const dates = [...new Set(events.map(groupDate))];
  return (
    <div className="upcoming-groups">
      {dates.map((date) => (
        <section key={date} aria-labelledby={`upcoming-${date}`}>
          <h3 id={`upcoming-${date}`}>
            {formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <EventList
            events={events.filter((event) => groupDate(event) === date)}
            calendars={calendars}
            onOpen={onOpen}
            empty=""
          />
        </section>
      ))}
    </div>
  );
}

function CalendarManager({
  calendars,
  events,
  onClose,
  onAnnounce,
}: {
  calendars: CalendarRecord[];
  events: CalendarEventRecord[];
  onClose: () => void;
  onAnnounce: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(ENTITY_COLORS[0].value);
  const [editing, setEditing] = useState<CalendarRecord | null>(null);
  const [deleting, setDeleting] = useState<CalendarRecord | null>(null);
  const [mode, setMode] = useState<'moveEvents' | 'deleteEvents'>('moveEvents');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  async function create() {
    try {
      const calendar = await calendarRepository.createCalendar(name, color);
      setName('');
      onAnnounce(`${calendar.name} created.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calendar could not be created.');
    }
  }
  async function saveEdit() {
    if (!editing) return;
    try {
      await calendarRepository.renameCalendar(editing.id, name);
      await calendarRepository.recolorCalendar(editing.id, color);
      setEditing(null);
      setName('');
      onAnnounce('Calendar updated.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calendar could not update.');
    }
  }
  async function remove() {
    if (!deleting) return;
    try {
      const receipt = await calendarRepository.deleteCalendar(
        deleting.id,
        mode,
        destination || undefined,
      );
      showDeletionUndo(receipt);
      setDeleting(null);
      onAnnounce(`${deleting.name} moved to Recently Deleted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calendar could not be deleted.');
    }
  }
  return (
    <Dialog
      title="Manage calendars"
      description="Calendar names accompany colour everywhere."
      onClose={onClose}
    >
      <div className="calendar-manager">
        <div className="inline-add">
          <label className="field">
            <span>{editing ? 'Calendar name' : 'New calendar'}</span>
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Colour</span>
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {ENTITY_COLORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => void (editing ? saveEdit() : create())}>
            {editing ? 'Save' : 'Create'}
          </Button>
          {editing ? (
            <Button
              variant="quiet"
              onClick={() => {
                setEditing(null);
                setName('');
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        <ol className="calendar-manager__list">
          {calendars.map((calendar, index) => (
            <li key={calendar.id}>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={calendar.isVisible}
                  onChange={(e) => {
                    void calendarRepository.setCalendarVisible(calendar.id, e.target.checked);
                    onAnnounce(`${calendar.name} ${e.target.checked ? 'shown' : 'hidden'}.`);
                  }}
                />
                <span
                  className="calendar-color"
                  style={{ backgroundColor: calendar.color }}
                  aria-hidden="true"
                />
                <span>
                  {calendar.name}
                  {calendar.isProtected ? ' · Default' : ''}
                </span>
              </label>
              <div className="inline-actions">
                <Button
                  variant="quiet"
                  aria-label={`Move ${calendar.name} up`}
                  disabled={index === 0}
                  onClick={() => void calendarRepository.reorderCalendar(calendar.id, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="quiet"
                  aria-label={`Move ${calendar.name} down`}
                  disabled={index === calendars.length - 1}
                  onClick={() => void calendarRepository.reorderCalendar(calendar.id, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setEditing(calendar);
                    setName(calendar.name);
                    setColor(calendar.color);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="quiet"
                  className="destructive-text"
                  onClick={() => {
                    setDeleting(calendar);
                    setDestination(
                      calendars.find((candidate) => candidate.id !== calendar.id)?.id ?? '',
                    );
                  }}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
      </div>
      {deleting ? (
        <Dialog
          title={`Delete ${deleting.name}?`}
          description={`${events.filter((event) => event.calendarId === deleting.id).length} active event(s) belong to this calendar.`}
          onClose={() => setDeleting(null)}
        >
          <div className="editor-form">
            <label className="check-field">
              <input
                type="radio"
                name="calendar-delete"
                checked={mode === 'moveEvents'}
                onChange={() => setMode('moveEvents')}
              />
              Move events to another calendar
            </label>
            {mode === 'moveEvents' ? (
              <label className="field">
                <span>Destination</span>
                <select value={destination} onChange={(e) => setDestination(e.target.value)}>
                  {calendars
                    .filter((calendar) => calendar.id !== deleting.id)
                    .map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <label className="check-field">
              <input
                type="radio"
                name="calendar-delete"
                checked={mode === 'deleteEvents'}
                onChange={() => setMode('deleteEvents')}
              />
              Move calendar and its events to Recently Deleted
            </label>
            <div className="dialog__actions">
              <Button variant="quiet" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button className="button--destructive" onClick={() => void remove()}>
                Delete calendar
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
