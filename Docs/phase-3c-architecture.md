# Phase 3C architecture

## Boundary and privacy model

Phase 3C adds local calendar transfer through standards-compatible ICS files. Import parsing,
preview, conflict classification, IndexedDB writes, export generation, and validation all happen in
the browser. No calendar text, UID, filename, or event content is uploaded or sent to an API.

ICS transfer creates a copy; it is not synchronisation. Planibly does not connect to Apple
Calendar, Google Calendar, Outlook, CalDAV, Microsoft Graph, or a remote ICS subscription. It adds
no accounts, credentials, attendees, invitations, reminders, email, backend, or paid service.

## Schema version 11

Dexie v11 leaves migrations 1-10 unchanged and appends three stores:

- `calendarImportSources` stores a source label, last filename and calendar name when supplied,
  destination calendar, cumulative imported count, local-change indicator, and first/last import
  timestamps.
- `calendarImportBatches` stores one immutable summary for each approved import. It records counts,
  warnings, destination, filename, and timestamp, but never the original ICS file or full event
  content.
- `externalEventMappings` stores the source ID, external UID, recurrence identity, target event or
  exception ID, deterministic source fingerprint, Planibly modified timestamp at import, sequence,
  external last-modified value, optional source timezone, and import timestamps. The compound
  `[sourceId+externalUid+recurrenceKey]` index prevents silent duplicate mappings.

The migration creates empty provenance stores and updates schema metadata only. Existing calendars,
events, rules, exceptions, templates, tasks, planning records, and dashboard layouts remain
unchanged. Invalid provenance cannot break normal Calendar, Plan, or Home snapshots because those
views do not depend on provenance records.

Permanent event deletion removes its mappings. Permanent calendar deletion and Empty Recently
Deleted remove mappings for every event they purge. Soft deletion retains mappings so restoration
and deliberate re-import remain possible. Calendar history may name an unavailable destination
after calendar deletion; it does not revive or silently move records. Removing an import-history
batch never changes events or UID mappings.

## Bounded parser and supported fields

The parser is a small project-owned TypeScript module with no runtime service or added dependency.
It unfolds RFC-style continuation lines, parses content-line parameters without evaluating imported
text, and handles these VEVENT fields:

- `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`
- `DTSTART`, `DTEND`, and safely convertible whole-day or minute `DURATION`
- `STATUS`, `CREATED`, `LAST-MODIFIED`, and `SEQUENCE`
- `RRULE`, `EXDATE`, and `RECURRENCE-ID`
- `CATEGORIES` as bounded parsed metadata
- `X-WR-CALNAME` on VCALENDAR

The limits are 2 MB, 2,000 VEVENT records, 10,000 characters in one unfolded content line, 160 title
characters, 240 location characters, and 4,000 description characters. Excessive files or lines
are rejected before preview; an over-limit event text record is invalid rather than silently
truncated. Unsupported fields are ignored. VTODO is counted as unsupported and never becomes a
task. VALARM, attendees, organiser data, HTML, script-like text, and URLs are never executed or
converted into accounts or reminders. React displays imported strings as plain text.

Malformed records do not invalidate otherwise usable records. Unsupported recurrence is reported
and skipped; it is never expanded or flattened. A preview is required before any database write and
shows the source, detected calendar name, valid/recurring counts, range, duplicates, updates,
unsupported/invalid counts, warnings, and destination.

## Date, timezone, and recurrence mapping

- `VALUE=DATE` is a local calendar date and never shifts. ICS exclusive all-day `DTEND` becomes
  Planibly's inclusive end date; export adds one day to restore the exclusive form.
- Floating timestamps retain their entered wall-clock date and time.
- UTC timestamps are deliberately converted to the device's local date and wall-clock time because
  the Planibly event model is local.
- A supported `TZID` is interpreted with the browser's `Intl.DateTimeFormat` timezone database and
  converted to device-local fields. UK spring and autumn transitions are tested. For an unknown or
  nonexistent timezone wall time, preview requires an explicit choice to keep the source wall-clock
  fields or skip affected events.
- Ambiguous autumn wall times choose the earlier matching instant deterministically. Planibly
  retains the source timezone on its provenance mapping but remains a local wall-clock model.
- A recurring TZID series is warned in preview because its imported occurrences follow Planibly's
  device-local wall clock; future source-zone offset changes are not recalculated as live sync.

RRULE maps only to Phase 3B's structured recurrence model: daily, weekdays, weekly BYDAY, monthly
day, monthly ordinal weekday, and yearly month/day, with interval and COUNT or inclusive UNTIL.
Monday week starts are accepted. BYSETPOS, arbitrary DAILY BYDAY, unsupported WKST, time-part BY
rules, and other richer patterns are reported and skipped. EXDATE becomes cancellation exceptions.
RECURRENCE-ID records become complete occurrence overrides or cancellations using Phase 3B's stable
series/original-date identity.

Timed events must fit the existing same-local-day event model. Overnight or multi-day timed events
are reported as invalid; inclusive multi-day all-day records are supported. This is an intentional
Phase 3C limitation rather than a silent time change.

## Duplicate, conflict, and transaction invariants

Matching uses source ID, external UID, and recurrence identity. Locally created records are never
matched by title. Preview classifies each identity as new, unchanged, updated externally, changed
locally, cancelled externally, conflicting, or duplicated inside the file.

The external fingerprint is compared with the last imported fingerprint. The current event or
exception modified timestamp is compared with the timestamp captured at import. External updates
default to the imported version; local changes and two-sided conflicts default to the Planibly
version. External cancellation also defaults to the Planibly version and only soft-deletes after an
explicit "Use imported version" choice. New cancelled masters are skipped. The user can keep
Planibly, use imported, create an independent duplicate, or skip, and can apply one choice to all
displayed conflicts.

Updates preserve the stable Planibly event or exception ID. Import-as-duplicate deliberately gets a
new local ID and a non-matching duplicate mapping so later re-import cannot silently overwrite it.
An approved import, including optional destination-calendar creation, events, rules, exceptions,
mappings, source summary, and history batch, uses one Dexie transaction. An error aborts the whole
transaction, preventing a partial calendar.

## Export and device handoff

Export supports one non-recurring event, one entire recurring series, one selected occurrence as a
standalone event, one explicitly selected calendar (including a hidden one), a bounded selected
date range, and all visible calendars. Soft-deleted events are excluded.

Generated VCALENDAR data contains a Planibly product identifier, calendar name, stable local UID,
DTSTAMP, summary, optional description/location, correct DATE or floating date-time boundaries,
RRULE, EXDATE, and RECURRENCE-ID overrides where representable. Text escapes backslashes, commas,
semicolons, and line breaks. Physical content lines are folded to at most 75 UTF-8 octets. Planibly
parses the generated result locally before enabling handoff.

The export dialog always offers a normal ICS download. When the browser both implements Web Share
with files and accepts the generated file, it additionally offers Share calendar file. No
provider-specific URL scheme is required. iOS may offer Files, Share, or Calendar destinations;
Windows users can save the file for Outlook or another application; Google Calendar users can
manually import it. The interface always states that later changes will not sync automatically.

## Recovery and explicit exclusions

Import history is local summary metadata. A history entry can be removed without touching events.
Deleting all events associated with a source requires a separate confirmation and moves active
events to Recently Deleted; it does not permanently delete them. Existing calendar/event restore,
ten-second undo, and permanent-deletion rules remain authoritative.

Phase 3C excludes live two-way sync, provider APIs/OAuth, CalDAV, remote URL subscriptions,
background refresh, alarms, reminders, attendees, invitations, email, VTODO task creation,
credentials, timelines, automatic scheduling, and all Phase 4 work.

## Manual device checks

1. On an installed iPhone PWA, import a fictional ICS file from Files, review before approval,
   close/reopen offline, and confirm imported records and history remain.
2. Import UTC, floating, Europe/London, all-day multi-day, recurring, excluded, and overridden
   examples around both UK DST transitions. Confirm every preview date/time before approval.
3. Re-import the same source unchanged, then with an external edit, a local edit, both edits, and a
   cancellation. Exercise all four conflict choices and the apply-to-all control.
4. Export one event, a series, an occurrence, a calendar, a range, and visible calendars. On iPhone,
   test both Share calendar file when offered and Download ICS through Files/Calendar.
5. On Windows Chrome or Edge, download the file, inspect/import it in Outlook or another calendar,
   and manually test import into Google Calendar. Confirm the copy/no-sync explanation is visible.
6. Remove a history batch, delete imported events, restore one through Recently Deleted, and
   permanently delete another. Confirm history removal alone never changes events.
7. At large text sizes and in portrait/landscape, verify import preview, conflicts, export options,
   history, nested confirmations, safe areas, keyboard focus, VoiceOver labels, dark mode, and no
   page-level horizontal overflow.
