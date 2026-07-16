# Phase 3A architecture

## Boundary

Phase 3A adds Planibly's private internal appointment calendar. It deliberately excludes recurrence, reminders, external providers, ICS, timelines, and automatic task scheduling.

## Schema version 9

Dexie v9 appends `calendars` and `calendarEvents` without changing versions 1–8. Calendars have stable IDs, colour, manual order, visibility, protection, timestamps, and deletion metadata. Events have one calendar ID, title, explicit local start/end dates, all-day flag, optional local times, location/notes, timestamps, and deletion metadata. The migration leaves v8 records untouched. The protected Personal calendar is seeded once through `calendarStarterDataVersion`, so it is not recreated after intentional deletion.

## Invariants

Dates use local `YYYY-MM-DD` values and are never UTC-parsed for display. All-day spans are inclusive; timed events are same-day with valid `HH:mm` start/end values and end after start. Hidden calendars exclude events only from views. Calendar deletion explicitly moves active events or soft-deletes them as one deletion group. Event restoration requires the original active calendar or a selected active replacement.

## Queries and presentation

The month grid always begins on Monday and renders six complete weeks using date-only arithmetic across month, year, leap-year, and DST boundaries. Active events are filtered through active, visible calendars before selected-day, upcoming, Plan, or Home queries. Selected-day ordering places inclusive all-day spans before same-day timed events. Upcoming initially shows fourteen days and expands deliberately to forty-two.

Plan presents appointments separately from task groups. Timed appointment duration is summarized separately and never changes configured task capacity. Pairwise overlap detection compares timed appointments with other timed appointments and exact-time tasks that have estimates; warnings are informational. The existing Today card reads events as additional content without introducing a card type or rewriting any saved layout.

## Recovery

Calendar and event deletions use the existing ten-second application-shell undo surface. Deleting a non-empty calendar requires moving its events to an active calendar or assigning the calendar and events one deletion group. Restoring that calendar restores grouped events. An event whose original calendar is unavailable requires an explicit active replacement. The protected starter can be soft-deleted and restored but never permanently deleted; its initialization marker prevents silent recreation. Empty Recently Deleted removes deleted events and non-protected deleted calendars without changing earlier recovery behavior.

## Accessibility and responsive behavior

Date cells expose complete date labels and event counts. Calendar names accompany colour indicators. Month content scrolls within its surface at narrow or enlarged-text widths so cells retain useful touch dimensions without causing page-level overflow. Native date/time inputs, labelled reorder controls, visible focus, safe-area-aware dialogs, dark tokens, reduced motion, and increased-contrast borders reuse the existing foundations.

## Explicit exclusions

Phase 3A does not include recurrence, reminders, notifications, attendees, conferencing, external providers, CalDAV, ICS, travel time, timelines, drag scheduling, automatic task scheduling, automatic capacity reduction, routines, sessions, time tracking, cloud sync, accounts, or remote services.
