# Phase 4A architecture

## Boundary and privacy model

Phase 4A adds routine definitions and daily routine runs. Routines are independent local records;
they are not tasks, task steps, calendar events, or recurrence rules. They never enter task smart
lists, project progress, task completion totals, appointment overlaps, or capacity arithmetic.
Definitions, run progress, and history remain in IndexedDB and work without a network connection.

This phase does not add preparation checklists, explanations of why an item matters, countdowns,
focus or Pomodoro modes, reminders, notifications, reviews, summaries, analysis, scores, streaks,
automatic movement or skipping, calendar conversion, accounts, sync, APIs, or later-phase routine
features.

## Schema version 12

Dexie v12 leaves versions 1-11 byte-for-byte unchanged and appends six stores:

- `routines`: ordered definitions with name, colour, active state, schedule kind, selected weekdays,
  default section, expected duration, preferred presentation, timestamps, and recovery metadata.
- `routineItems`: ordered one-level definition items with optional duration/note, active state,
  timestamps, and recovery metadata.
- `routineVariants`: optional day variants with weekday membership, ordered included item IDs, and
  an optional presentation override.
- `routineRuns`: daily run headers and immutable definition identity snapshots. The unique compound
  index `[routineId+localDate]` enforces one run for one routine on one local date.
- `routineRunItems`: immutable title, note, duration, and order snapshots plus independent
  completion timestamps.
- `routineOccurrenceAdjustments`: explicit moves from one scheduled local date to another, with a
  unique `[routineId+originalDate]` index.

The migration only creates these empty stores and advances schema metadata. A v11 migration test
preserves representative task, calendar, event, import-source, import-batch, and external mapping
records. Optional starter examples use a separate `routineStarterDataVersion` marker and are never
inserted by database initialization.

## Definition, item, and variant invariants

A definition requires a non-empty name, colour, and at least one active item. IDs are stable UUIDs,
orders are explicit integers, and item or variant IDs cannot be reused by another routine. Items
have one level only. Inactive items remain editable but are omitted from new runs.

The default item set is every active, non-deleted item in definition order. A day variant may
select a subset, change its order, and override presentation. Each weekday can belong to at most
one variant in a routine, so selection is deterministic. Variants are optional; separate linked
routines are not required.

Schedules are `manual`, `daily`, `weekdays`, `weekends`, or `selected`. Matching accepts only valid
`YYYY-MM-DD` values and calculates the weekday from the date components with UTC arithmetic. It
does not parse the date as an instant, so device timezone and daylight-saving changes cannot shift
the chosen local day. Month, year, leap-day, and UK DST boundaries are covered by tests. Date-based
views refresh only on a normal React query/reload or deliberate user action; no midnight timer
changes records.

## Daily-run lifecycle and historical stability

Opening a scheduled or manual routine calls `createOrResumeRun`. An existing routine/date run is
returned unchanged. Otherwise, one transaction writes the run header and ordered run-item
snapshots selected by that date's variant. Later definition edits, item removal, or routine
renaming cannot rewrite historical run names, styles, items, notes, durations, order, or progress.

A run starts `inProgress`. Item checks update only run-item completion timestamps and may request a
short haptic when the browser supports vibration. Checklist exposes every item; Step by Step keeps
Previous, Next, and Show Full Routine available without enforcing order; Compact uses the same
semantic checklist with denser presentation. A run-level style change never modifies the routine
default.

Completion never changes item states. Completing with unfinished items requires a second explicit
confirmation. Reopen returns a completed or skipped run to `inProgress` without changing item
checks. Skip records an optional neutral reason and has no score or streak consequence. There is no
implicit restart, completion, skip, or move in Phase 4A.

## Today and previously scheduled behavior

The dedicated `/routines` workspace is linked from Home and Plan rather than adding a sixth item to
the mobile bottom navigation. Today separates in-progress, unstarted scheduled, completed,
skipped, and available-manual routines. Recent completed runs remain openable.

For each scheduled routine, the review shows at most the most recent unmatched occurrence within a
bounded 366-day lookback. Wording is “Previously scheduled,” never overdue. Start today, move,
and skip open an explicit confirmation; Leave unchanged and Dismiss for now affect only the
current browser session. Nothing is changed automatically. A move creates an occurrence adjustment
that suppresses the original date and includes the destination date.

## Home and Plan integration

`Current Routine` prefers the earliest in-progress run for today, including snapshot progress and
current item. Otherwise it shows the next unstarted scheduled routine. Existing custom dashboard
layouts are normalized with the new card hidden, so they do not change visually. Versioned built-in
defaults can include it when newly initialized or explicitly restored. A local suggestion may offer
the hidden card when active routines exist but never modifies a layout.

Plan shows active scheduled routines in a distinct section for the selected local date and opens
the same run interface. Expected duration is informational only: it is not subtracted from task
capacity and does not create overlap warnings.

## Recovery and deletion invariants

Deleting a routine creates one recovery group for the definition, active items, and variants and
emits the existing ten-second same-session undo receipt. Recently Deleted can restore the group,
restore an individually removed item (with explicit parent restoration where needed), permanently
delete eligible definitions/items, or include them in Empty Recently Deleted.

Permanent routine deletion removes the definition, its definition items, variants, and occurrence
adjustments. It deliberately preserves `routineRuns` and `routineRunItems`, whose snapshot fields
keep history understandable without the definition. Permanent item deletion also removes its ID
from variants but never changes run snapshots. Invalid definition or item records are filtered from
active snapshots so malformed local data cannot crash Home, Plan, or Routines.

## Accessibility and responsive behavior

Routine controls use labelled inputs, semantic lists, checkboxes, progress elements, dialogs, and
non-drag Move up/down alternatives. State changes use polite announcements, focus uses the shared
visible treatment, and touch controls retain the shared 44 CSS-pixel minimum. Routine colour is
decorative and always accompanied by text. Dialogs and the workspace use existing safe-area,
large-text, reduced-motion, increased-contrast, light, and dark-mode foundations. Playwright covers
mobile persistence/reload/offline reopening and horizontal containment at 200% text on mobile and
wider layouts.
