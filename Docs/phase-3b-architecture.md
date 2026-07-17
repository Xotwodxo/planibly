# Phase 3B architecture

## Boundary

Phase 3B adds dependable local recurrence and reusable event templates to the Phase 3A internal
calendar. It does not add reminders, notifications, external calendar providers, ICS,
attendees, timelines, automatic scheduling, routines, cloud sync, or any remote service.

## Schema version 10

Dexie v10 appends three stores and leaves migrations 1–9 unchanged:

- `recurrenceRules` contains at most one structured rule per `calendarEvents` series record. The
  unique `eventId` index prevents two definitions for one series.
- `recurrenceExceptions` has a stable UUID and a unique compound
  `[seriesEventId+originalStartDate]` index. A record is either a cancellation or a complete
  occurrence override. The original local date never changes for an occurrence-only edit, even
  when its displayed date moves.
- `eventTemplates` contains ordered, independently editable event defaults plus optional structured
  recurrence. Templates use the same soft-deletion and deletion-group metadata as other recoverable
  records.

The v9-to-v10 migration creates empty stores and advances schema metadata. It does not rewrite any
calendar, event, task, plan, capacity, or dashboard record. A v9 event has no rule and therefore
remains a one-off event.

## Recurrence model and validation

Supported patterns are daily, weekdays, weekly selected weekdays, monthly day, monthly ordinal
weekday, and yearly month/day. Every pattern supports an interval. Weekdays with interval N means
Monday–Friday in every Nth week from the first occurrence. Endings are never, inclusive local end
date, or generated-occurrence count.

Intervals are limited to 1–999 and occurrence counts to 1–10,000. Weekly rules require at least one
weekday. The first event date must match its rule. End dates cannot precede that date. Timed events
remain same-day and retain their `HH:mm` wall-clock values; the engine never converts them to UTC.
Inclusive all-day span length is copied to every generated occurrence.

Monthly and yearly edges are explicit:

- day 29, 30, or 31 is skipped when a month does not contain it;
- 29 February occurs only in leap years;
- an ordinal weekday occurs only when that ordinal exists;
- “last” resolves to the final matching weekday;
- only actual generated dates increment a count;
- a cancellation consumes its original count position.

Invalid persisted rules, exceptions, events, or templates are ignored by snapshots/expansion rather
than crashing Calendar, Plan, or Home.

## Bounded deterministic expansion

No occurrence records are pre-generated. `expandCalendarOccurrences` receives an inclusive local
date range and expands only that range plus the minimum scan needed to resolve moved exceptions.
Calendar month requests its 42 visible cells; selected day, Plan, and Home request one day; Upcoming
requests 14 or 42 days.

The public safety limits are 3,660 query days, 36,600 scan days from a series anchor, and 5,000
returned occurrences. A range beyond the query limit or invalid recurrence returns no expanded
records. These limits keep never-ending or corrupted series bounded.

Occurrence identity is `${seriesEventId}::${originalStartDate}`. An occurrence-only move changes
display dates in its exception but not that identity. Expansion de-duplicates by this key, excludes
hidden calendars and cancellations, and sorts all-day before chronological timed events.

## Editing, splitting, and deletion

An occurrence edit requires one of three explicit scopes:

- **This event only** upserts one durable override containing the complete editable event fields.
- **This and future** transactionally converts the earlier rule to a count ending immediately before
  the boundary and creates a new series at the edited occurrence. Remaining count is preserved for
  count-limited rules. Future exceptions are transferred only when they map to the new rule;
  unmappable exceptions are soft-disabled so no active orphan remains.
- **Entire series** updates the base event and rule. Unchanged patterns are shifted with a changed
  anchor. Valid occurrence overrides are retained and shifted; exceptions that cannot map are
  safely removed. Turning Repeat off deliberately converts the edited series to one one-off event and
  removes its exceptions.

Deleting only one occurrence writes a cancellation exception. Same-session ten-second undo removes
that cancellation. Deleting this and future shortens the rule and soft-disables later exceptions;
its undo receipt restores the previous rule and exceptions. Entire-series deletion uses Phase 3A
soft deletion and groups its active exceptions. Restore revives valid grouped exceptions. Permanent
event or calendar deletion removes the rule and all related exceptions.

Calendar moves update the series event and any explicit exception calendar that named the moved
calendar. Calendar undo restores both. A hidden calendar excludes occurrences whose effective
calendar is hidden. Cancelled occurrences never enter overlap detection.

## Templates

Templates may store a name, title, default calendar, all-day preference, times or suggested
duration, location, notes, and an optional recurrence definition. Applying one fills the existing
event editor and still requires the user to confirm the event date and save. It creates an
independent event; later template edits or deletion cannot change that event.

If a saved calendar is unavailable, template resolution selects the first active calendar (the
protected Personal calendar under normal starter data) and presents an explanation in the editor.
Templates can be created from scratch or from the current event form, renamed, edited, duplicated,
reordered, soft-deleted, restored, and permanently deleted through Recently Deleted.

## Integration and accessibility

Calendar month, selected day, and Upcoming, Plan appointments/overlap warnings, and the existing Home
Today card all consume the same expanded occurrence model. Events remain time commitments and have
no completion control. A text “Repeats” label accompanies recurring occurrences, so colour is not
the only signal.

Repeat is a collapsed optional section in the existing editor. Scope choices use semantic dialogs
and large touch targets with preview text. Weekday choices, ordering, template actions, and every
destructive alternative remain keyboard operable. Existing focus, safe-area, large-text, contrast,
dark-mode, and reduced-motion foundations remain in effect.

## Manual device checks

1. On the installed iPhone PWA, create each recurrence pattern, including a multi-day all-day event,
   then close and reopen offline.
2. Edit and move one occurrence, split this-and-future, and edit/delete an entire series; verify
   Calendar, Plan, and Home update immediately and cancellation undo works within ten seconds.
3. Create, apply, duplicate, reorder, delete, restore, and permanently delete templates. Delete a
   template calendar and verify the explained fallback.
4. Check UK spring/autumn DST dates: recurring timed events must retain the entered wall-clock time.
5. At large text sizes, verify Repeat, template management, and scope dialogs remain contained above
   the bottom safe area in portrait and landscape.
6. Use VoiceOver and a hardware keyboard to verify recurrence summaries, scope choices, date event
   counts, focus order, and non-colour “Repeats” labels.
