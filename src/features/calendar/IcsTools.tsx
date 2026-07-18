import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import {
  exportIcsCalendar,
  ICS_IMPORT_LIMITS,
  parseIcs,
  type IcsExportSeries,
} from '../../data/ics';
import {
  IcsRepository,
  type IcsImportPreview,
  type ImportHistory,
  type ImportResolution,
  type UnknownTimezoneResolution,
} from '../../data/icsRepository';
import type {
  CalendarEventRecord,
  CalendarOccurrence,
  CalendarRecord,
  PlannerSnapshot,
  RecurrenceExceptionRecord,
} from '../../data/plannerTypes';
import { addCalendarDays, formatLocalDate, localDateFromDate } from '../../data/planning';
import { expandCalendarOccurrences } from '../../data/recurrence';
import { useUnsavedChanges } from '../planner/unsavedChanges';
import {
  CALENDAR_COPY_NOTICE,
  canShareIcsFile,
  downloadIcsFile,
  shareIcsFile,
} from './calendarHandoff';

const icsRepository = new IcsRepository();

export function IcsImportDialog({
  calendars,
  sourceId,
  onClose,
  onImported,
}: {
  calendars: CalendarRecord[];
  sourceId?: string;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [route, setRoute] = useState<'file' | 'paste'>('file');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<IcsImportPreview>();
  const [destinationKind, setDestinationKind] = useState<'existing' | 'new'>('new');
  const [destinationId, setDestinationId] = useState(calendars[0]?.id ?? '');
  const [newCalendarName, setNewCalendarName] = useState('Imported');
  const [newCalendarColor, setNewCalendarColor] = useState('#5B67C8');
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>({});
  const [bulkResolution, setBulkResolution] = useState<ImportResolution>('keepLocal');
  const [timezoneResolutions, setTimezoneResolutions] = useState<
    Record<string, UnknownTimezoneResolution>
  >({});
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const dirty = Boolean(text || preview);
  useUnsavedChanges(dirty);

  function requestClose() {
    if (dirty && !window.confirm('Discard this import preview and selected file?')) return;
    onClose();
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setProgress('Reading calendar file locally...');
    try {
      if (!file.name.toLowerCase().endsWith('.ics'))
        throw new Error('Choose a file with an .ics extension.');
      if (file.size > ICS_IMPORT_LIMITS.bytes)
        throw new Error('The calendar file is larger than the 2 MB import limit.');
      setFilename(file.name);
      setText(await file.text());
      setPreview(undefined);
      setProgress('File ready to preview.');
    } catch (caught) {
      setProgress('');
      setError(caught instanceof Error ? caught.message : 'The file could not be read.');
    }
  }

  async function buildPreview() {
    setError('');
    setProgress('Checking events, recurrence and duplicates...');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const parsed = parseIcs(text);
      const next = await icsRepository.previewImport(parsed, { filename, sourceId });
      setPreview(next);
      setNewCalendarName(next.proposedCalendarName);
      const proposedExisting =
        next.destinationCalendarId &&
        calendars.some((calendar) => calendar.id === next.destinationCalendarId)
          ? next.destinationCalendarId
          : undefined;
      if (proposedExisting) {
        setDestinationKind('existing');
        setDestinationId(proposedExisting);
      } else setDestinationKind('new');
      setResolutions(
        Object.fromEntries(next.records.map((record) => [record.key, record.defaultResolution])),
      );
      setTimezoneResolutions({});
      setProgress('Preview ready. Nothing has been imported yet.');
    } catch (caught) {
      setProgress('');
      setError(caught instanceof Error ? caught.message : 'The calendar could not be previewed.');
    }
  }

  async function apply() {
    if (!preview) return;
    setError('');
    setProgress('Saving approved calendar records...');
    try {
      const batch = await icsRepository.applyImport({
        preview,
        destination:
          destinationKind === 'existing'
            ? { kind: 'existing', calendarId: destinationId }
            : { kind: 'new', name: newCalendarName, color: newCalendarColor },
        resolutions,
        timezoneResolutions,
      });
      onImported(
        `Import complete: ${batch.validEventCount - batch.skippedCount} record${batch.validEventCount - batch.skippedCount === 1 ? '' : 's'} applied.`,
      );
      onClose();
    } catch (caught) {
      setProgress('');
      setError(caught instanceof Error ? caught.message : 'The import could not be completed.');
    }
  }

  const conflicts = preview?.records.filter((record) =>
    ['updated', 'locallyChanged', 'conflicting', 'cancelled'].includes(record.classification),
  );
  return (
    <Dialog
      title={sourceId ? 'Re-import calendar file' : 'Import ICS calendar'}
      description="Calendar contents are parsed locally on this device and are never uploaded."
      onClose={requestClose}
    >
      <div className="ics-dialog editor-form">
        {!preview ? (
          <>
            <div className="segmented-control" aria-label="Import method">
              <Button
                variant={route === 'file' ? 'primary' : 'secondary'}
                onClick={() => setRoute('file')}
              >
                Choose ICS file
              </Button>
              <Button
                variant={route === 'paste' ? 'primary' : 'secondary'}
                onClick={() => setRoute('paste')}
              >
                Paste ICS text
              </Button>
            </div>
            {route === 'file' ? (
              <label className="field">
                <span>Calendar file</span>
                <input
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
                <small>Maximum file size: 2 MB and 2,000 VEVENT records.</small>
              </label>
            ) : (
              <label className="field">
                <span>ICS text</span>
                <textarea
                  rows={10}
                  maxLength={ICS_IMPORT_LIMITS.bytes}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setFilename(undefined);
                  }}
                />
              </label>
            )}
            <p className="privacy-note">
              Calendar files can contain private information. Planibly keeps parsed data in this
              browser only and does not retain the original file.
            </p>
            <div className="dialog__actions">
              <Button variant="quiet" onClick={requestClose}>
                Cancel
              </Button>
              <Button disabled={!text.trim()} onClick={() => void buildPreview()}>
                Preview import
              </Button>
            </div>
          </>
        ) : (
          <>
            <ImportSummary preview={preview} />
            <fieldset>
              <legend>Destination calendar</legend>
              <label className="check-field">
                <input
                  type="radio"
                  name="destination-kind"
                  checked={destinationKind === 'new'}
                  onChange={() => setDestinationKind('new')}
                />
                Create a new local calendar
              </label>
              {destinationKind === 'new' ? (
                <div className="event-editor__dates">
                  <label className="field">
                    <span>Calendar name</span>
                    <input
                      maxLength={80}
                      value={newCalendarName}
                      onChange={(event) => setNewCalendarName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Colour</span>
                    <input
                      type="color"
                      value={newCalendarColor}
                      onChange={(event) => setNewCalendarColor(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              <label className="check-field">
                <input
                  type="radio"
                  name="destination-kind"
                  checked={destinationKind === 'existing'}
                  disabled={calendars.length === 0}
                  onChange={() => setDestinationKind('existing')}
                />
                Import into an existing calendar
              </label>
              {destinationKind === 'existing' ? (
                <label className="field">
                  <span>Existing calendar</span>
                  <select
                    value={destinationId}
                    onChange={(event) => setDestinationId(event.target.value)}
                  >
                    {calendars.map((calendar) => (
                      <option value={calendar.id} key={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </fieldset>
            {preview.unresolvedTimezones.map((timezone) => (
              <fieldset key={timezone}>
                <legend>Unresolved timezone: {timezone}</legend>
                <p>
                  Planibly cannot reliably convert this timezone. Choose explicitly for affected
                  events.
                </p>
                <label className="check-field">
                  <input
                    type="radio"
                    name={`timezone-${timezone}`}
                    checked={timezoneResolutions[timezone] === 'wallClock'}
                    onChange={() =>
                      setTimezoneResolutions((current) => ({ ...current, [timezone]: 'wallClock' }))
                    }
                  />
                  Keep the source date and wall-clock time
                </label>
                <label className="check-field">
                  <input
                    type="radio"
                    name={`timezone-${timezone}`}
                    checked={timezoneResolutions[timezone] === 'skip'}
                    onChange={() =>
                      setTimezoneResolutions((current) => ({ ...current, [timezone]: 'skip' }))
                    }
                  />
                  Skip affected events
                </label>
              </fieldset>
            ))}
            {conflicts?.length ? (
              <section aria-labelledby="conflicts-heading">
                <div className="section-heading">
                  <div>
                    <h3 id="conflicts-heading">Review existing records</h3>
                    <p>External cancellation never deletes permanently.</p>
                  </div>
                  <div className="inline-actions">
                    <label className="field">
                      <span>Apply choice to all</span>
                      <select
                        value={bulkResolution}
                        onChange={(event) =>
                          setBulkResolution(event.target.value as ImportResolution)
                        }
                      >
                        <option value="keepLocal">Keep Planibly version</option>
                        <option value="useImported">Use imported version</option>
                        <option value="duplicate">Import as duplicates</option>
                        <option value="skip">Skip</option>
                      </select>
                    </label>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        setResolutions((current) => ({
                          ...current,
                          ...Object.fromEntries(
                            conflicts.map((record) => [record.key, bulkResolution]),
                          ),
                        }))
                      }
                    >
                      Apply to all
                    </Button>
                  </div>
                </div>
                <ul className="ics-record-list">
                  {conflicts.map((record) => (
                    <li key={record.key}>
                      <strong>{record.parsed.title}</strong>
                      <span>{classificationLabel(record.classification)}</span>
                      <label className="field">
                        <span>Action</span>
                        <select
                          value={resolutions[record.key] ?? record.defaultResolution}
                          onChange={(event) =>
                            setResolutions((current) => ({
                              ...current,
                              [record.key]: event.target.value as ImportResolution,
                            }))
                          }
                        >
                          <option value="keepLocal">Keep Planibly version</option>
                          <option value="useImported">Use imported version</option>
                          <option value="duplicate">Import as a duplicate</option>
                          <option value="skip">Skip</option>
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="dialog__actions">
              <Button variant="quiet" onClick={() => setPreview(undefined)}>
                Back
              </Button>
              <Button onClick={() => void apply()}>Approve import</Button>
            </div>
          </>
        )}
        {progress ? <p role="status">{progress}</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function ImportSummary({ preview }: { preview: IcsImportPreview }) {
  return (
    <section className="ics-summary" aria-labelledby="import-preview-heading">
      <h3 id="import-preview-heading">Import preview</h3>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{preview.filename ?? 'Pasted ICS text'}</dd>
        </div>
        <div>
          <dt>Calendar name</dt>
          <dd>{preview.calendarName ?? 'Not supplied'}</dd>
        </div>
        <div>
          <dt>Valid events</dt>
          <dd>{preview.validEventCount}</dd>
        </div>
        <div>
          <dt>Recurring series</dt>
          <dd>{preview.recurringSeriesCount}</dd>
        </div>
        <div>
          <dt>Date range</dt>
          <dd>
            {preview.dateRange
              ? `${formatLocalDate(preview.dateRange.start)} - ${formatLocalDate(preview.dateRange.end)}`
              : 'None'}
          </dd>
        </div>
        <div>
          <dt>Duplicates</dt>
          <dd>{preview.duplicates}</dd>
        </div>
        <div>
          <dt>External updates</dt>
          <dd>{preview.updates}</dd>
        </div>
        <div>
          <dt>Unsupported / invalid</dt>
          <dd>
            {preview.unsupportedRecords} / {preview.invalidRecords}
          </dd>
        </div>
      </dl>
      {preview.warnings.length ? (
        <details>
          <summary>Warnings ({preview.warnings.length})</summary>
          <ul>
            {[...new Set(preview.warnings)].slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function ImportHistoryDialog({
  calendars,
  onClose,
  onReimport,
  onAnnounce,
}: {
  calendars: CalendarRecord[];
  onClose: () => void;
  onReimport: (sourceId: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const [history, setHistory] = useState<ImportHistory>();
  const [error, setError] = useState('');
  const [deletingSource, setDeletingSource] = useState<string>();
  async function refresh() {
    try {
      setHistory(await icsRepository.getHistory());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import history could not load.');
    }
  }
  useEffect(() => void refresh(), []);
  return (
    <Dialog
      title="Import history"
      description="History stores summaries and UID links, not the original calendar files."
      onClose={onClose}
    >
      <div className="ics-dialog">
        {!history ? <p role="status">Opening import history...</p> : null}
        {history?.sources.length === 0 ? (
          <p className="empty-state">No calendar files have been imported.</p>
        ) : null}
        {history?.sources.map((source) => {
          const batches = history.batches.filter((batch) => batch.sourceId === source.id);
          return (
            <section
              key={source.id}
              className="import-source"
              aria-labelledby={`source-${source.id}`}
            >
              <div className="section-heading">
                <div>
                  <h3 id={`source-${source.id}`}>{source.sourceLabel}</h3>
                  <p>
                    Last imported {new Date(source.lastImportedAt).toLocaleString()} into{' '}
                    {calendars.find((calendar) => calendar.id === source.destinationCalendarId)
                      ?.name ?? 'an unavailable calendar'}
                    .
                  </p>
                  {source.hasLocalChanges ? <small>Local changes were detected.</small> : null}
                </div>
                <div className="inline-actions">
                  <Button variant="secondary" onClick={() => onReimport(source.id)}>
                    Re-import file
                  </Button>
                  <Button
                    variant="quiet"
                    className="destructive-text"
                    onClick={() => setDeletingSource(source.id)}
                  >
                    Delete imported events
                  </Button>
                </div>
              </div>
              <ol className="import-batches">
                {batches.map((batch) => (
                  <li key={batch.id}>
                    <span>
                      {new Date(batch.importedAt).toLocaleString()} -{' '}
                      {batch.filename ?? 'Pasted text'}
                    </span>
                    <small>
                      {batch.validEventCount - batch.skippedCount} applied, {batch.skippedCount}{' '}
                      skipped, {batch.warningCount} warnings
                    </small>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        void icsRepository.removeHistoryBatch(batch.id).then(() => {
                          onAnnounce('Import history entry removed. Events were not changed.');
                          return refresh();
                        })
                      }
                    >
                      Remove history entry
                    </Button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {deletingSource ? (
        <Dialog
          title="Delete imported events?"
          description="Mapped events move to Recently Deleted. Import history and UID mappings remain so this action is recoverable and future re-imports stay explicit."
          onClose={() => setDeletingSource(undefined)}
        >
          <div className="dialog__actions">
            <Button variant="quiet" onClick={() => setDeletingSource(undefined)}>
              Cancel
            </Button>
            <Button
              className="button--destructive"
              onClick={() =>
                void icsRepository.deleteImportedEvents(deletingSource, true).then((count) => {
                  setDeletingSource(undefined);
                  onAnnounce(
                    `${count} imported event${count === 1 ? '' : 's'} moved to Recently Deleted.`,
                  );
                })
              }
            >
              Delete imported events
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

type ExportScope = 'event' | 'series' | 'occurrence' | 'calendar' | 'range' | 'visible';

export function IcsExportDialog({
  snapshot,
  onClose,
}: {
  snapshot: PlannerSnapshot;
  onClose: () => void;
}) {
  const today = localDateFromDate(new Date());
  const [scope, setScope] = useState<ExportScope>('event');
  const [eventId, setEventId] = useState(snapshot.calendarEvents[0]?.id ?? '');
  const [calendarId, setCalendarId] = useState(snapshot.calendars[0]?.id ?? '');
  const [occurrenceDate, setOccurrenceDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(addCalendarDays(today, 30));
  const [generated, setGenerated] = useState<{ contents: string; filename: string }>();
  const [error, setError] = useState('');
  const recurringIds = useMemo(
    () => new Set(snapshot.recurrenceRules.map((rule) => rule.eventId)),
    [snapshot.recurrenceRules],
  );
  const singleEvents = useMemo(
    () => snapshot.calendarEvents.filter((event) => !recurringIds.has(event.id)),
    [recurringIds, snapshot.calendarEvents],
  );
  const recurringEvents = useMemo(
    () => snapshot.calendarEvents.filter((event) => recurringIds.has(event.id)),
    [recurringIds, snapshot.calendarEvents],
  );
  const selectedEvents =
    scope === 'series' || scope === 'occurrence' ? recurringEvents : singleEvents;

  useEffect(() => {
    const choices = scope === 'series' || scope === 'occurrence' ? recurringEvents : singleEvents;
    if (!choices.some((event) => event.id === eventId)) setEventId(choices[0]?.id ?? '');
    setGenerated(undefined);
  }, [eventId, recurringEvents, scope, singleEvents]);

  const exportItems = useMemo(() => {
    if (scope === 'event' || scope === 'series') {
      const event = snapshot.calendarEvents.find((candidate) => candidate.id === eventId);
      if (!event) return [];
      return [
        {
          event,
          rule:
            scope === 'series'
              ? snapshot.recurrenceRules.find((rule) => rule.eventId === event.id)
              : undefined,
          exceptions:
            scope === 'series'
              ? snapshot.recurrenceExceptions.filter(
                  (exception) => exception.seriesEventId === event.id,
                )
              : undefined,
        },
      ];
    }
    if (scope === 'occurrence') {
      const occurrence = expandCalendarOccurrences(snapshot, occurrenceDate, occurrenceDate).find(
        (candidate) => candidate.sourceEventId === eventId,
      );
      return occurrence ? [{ event: standaloneOccurrence(occurrence) }] : [];
    }
    if (scope === 'calendar') {
      return exportSeriesForCalendarIds(snapshot, new Set([calendarId]));
    }
    if (scope === 'range') {
      if (rangeEnd < rangeStart) return [];
      return expandCalendarOccurrences(snapshot, rangeStart, rangeEnd).map((occurrence) => ({
        event: standaloneOccurrence(occurrence),
      }));
    }
    const visibleIds = new Set(
      snapshot.calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id),
    );
    return exportSeriesForCalendarIds(snapshot, visibleIds);
  }, [calendarId, eventId, occurrenceDate, rangeEnd, rangeStart, scope, snapshot]);

  function generate() {
    setError('');
    try {
      if (!exportItems.length) throw new Error('No events match these export options.');
      const name =
        scope === 'calendar'
          ? (snapshot.calendars.find((calendar) => calendar.id === calendarId)?.name ?? 'Planibly')
          : 'Planibly export';
      const contents = exportIcsCalendar(name, exportItems);
      const checked = parseIcs(contents);
      if (checked.invalidRecords || checked.events.length === 0)
        throw new Error('The generated calendar did not pass validation.');
      setGenerated({ contents, filename: `${name}.ics` });
    } catch (caught) {
      setGenerated(undefined);
      setError(caught instanceof Error ? caught.message : 'The calendar could not be exported.');
    }
  }

  return (
    <Dialog
      title="Export calendar data"
      description="Choose exactly what to copy into a standards-compatible calendar file."
      onClose={onClose}
    >
      <div className="ics-dialog editor-form">
        <label className="field">
          <span>Export</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as ExportScope)}>
            <option value="event">One non-recurring event</option>
            <option value="series">An entire recurring series</option>
            <option value="occurrence">One recurring occurrence as a standalone event</option>
            <option value="calendar">One local calendar</option>
            <option value="range">A chosen date range</option>
            <option value="visible">All visible calendars</option>
          </select>
        </label>
        {scope === 'event' || scope === 'series' || scope === 'occurrence' ? (
          <label className="field">
            <span>{scope === 'series' ? 'Series' : 'Event'}</span>
            <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
              {selectedEvents.map((event) => (
                <option value={event.id} key={event.id}>
                  {event.title} - {formatLocalDate(event.startDate)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scope === 'occurrence' ? (
          <label className="field">
            <span>Occurrence date</span>
            <input
              type="date"
              value={occurrenceDate}
              onChange={(event) => setOccurrenceDate(event.target.value)}
            />
          </label>
        ) : null}
        {scope === 'calendar' ? (
          <label className="field">
            <span>Calendar, including hidden calendars selected here</span>
            <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
              {snapshot.calendars.map((calendar) => (
                <option value={calendar.id} key={calendar.id}>
                  {calendar.name} {calendar.isVisible ? '' : '(hidden)'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scope === 'range' ? (
          <div className="event-editor__dates">
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Through</span>
              <input
                type="date"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <p className="privacy-note">{CALENDAR_COPY_NOTICE}</p>
        <p>
          The file stays on this device until you choose where to save or share it. Hidden calendars
          are excluded from "All visible calendars".
        </p>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={generate}>
            Prepare ICS
          </Button>
          {generated ? (
            <>
              <Button onClick={() => downloadIcsFile(generated.contents, generated.filename)}>
                Download ICS
              </Button>
              {canShareIcsFile() ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void shareIcsFile(generated.contents, generated.filename).catch((caught) =>
                      setError(
                        caught instanceof Error ? caught.message : 'The file could not be shared.',
                      ),
                    )
                  }
                >
                  Share calendar file
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        {generated ? <p role="status">Calendar file validated and ready.</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function standaloneOccurrence(occurrence: CalendarOccurrence): CalendarEventRecord {
  return {
    id: `${occurrence.sourceEventId}-${occurrence.originalStartDate}`,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    startDate: occurrence.startDate,
    endDate: occurrence.endDate,
    allDay: occurrence.allDay,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    location: occurrence.location,
    notes: occurrence.notes,
    createdAt: occurrence.createdAt,
    modifiedAt: occurrence.modifiedAt,
  };
}

function exportSeriesForCalendarIds(
  snapshot: PlannerSnapshot,
  includedCalendarIds: Set<string>,
): IcsExportSeries[] {
  const items: IcsExportSeries[] = [];
  for (const event of snapshot.calendarEvents) {
    const exceptions = snapshot.recurrenceExceptions.filter(
      (exception) => exception.seriesEventId === event.id,
    );
    if (includedCalendarIds.has(event.calendarId)) {
      items.push({
        event,
        rule: snapshot.recurrenceRules.find((rule) => rule.eventId === event.id),
        exceptions: exceptions.map((exception) => {
          if (
            exception.kind === 'override' &&
            exception.calendarId &&
            !includedCalendarIds.has(exception.calendarId)
          ) {
            return cancellationForExport(exception);
          }
          return exception;
        }),
      });
      continue;
    }
    for (const exception of exceptions) {
      if (
        exception.kind === 'override' &&
        exception.calendarId &&
        includedCalendarIds.has(exception.calendarId)
      ) {
        items.push({ event: standaloneException(event, exception) });
      }
    }
  }
  return items;
}

function cancellationForExport(exception: RecurrenceExceptionRecord): RecurrenceExceptionRecord {
  return {
    id: exception.id,
    seriesEventId: exception.seriesEventId,
    originalStartDate: exception.originalStartDate,
    kind: 'cancelled',
    createdAt: exception.createdAt,
    modifiedAt: exception.modifiedAt,
  };
}

function standaloneException(
  base: CalendarEventRecord,
  exception: RecurrenceExceptionRecord,
): CalendarEventRecord {
  return {
    id: `${base.id}-${exception.originalStartDate}`,
    calendarId: exception.calendarId ?? base.calendarId,
    title: exception.title ?? base.title,
    startDate: exception.startDate ?? exception.originalStartDate,
    endDate: exception.endDate ?? exception.startDate ?? exception.originalStartDate,
    allDay: exception.allDay ?? base.allDay,
    startTime: exception.startTime === null ? undefined : (exception.startTime ?? base.startTime),
    endTime: exception.endTime === null ? undefined : (exception.endTime ?? base.endTime),
    location: exception.location === null ? undefined : (exception.location ?? base.location),
    notes: exception.notes === null ? undefined : (exception.notes ?? base.notes),
    createdAt: exception.createdAt,
    modifiedAt: exception.modifiedAt,
  };
}

function classificationLabel(classification: string): string {
  const labels: Record<string, string> = {
    updated: 'Updated externally',
    locallyChanged: 'Changed locally since import',
    conflicting: 'Both versions changed',
    cancelled: 'Cancelled externally',
  };
  return labels[classification] ?? classification;
}
