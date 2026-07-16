# Phase 2C architecture

Phase 2C extends the existing Plan screen into an offline daily agenda with capacity and a
seven-day planning horizon. It remains a deliberate planning tool: it does not create calendar
events, schedule tasks automatically, introduce recurrence, or reinterpret a planned day as a
deadline.

## Schema migration

Dexie schema version 8 appends two stores without changing released versions 1–7:

- `plannedPlacements` stores one durable placement per task, keyed by stable task ID, with local
  date, agenda group, manual order, source, and timestamps.
- `planningCapacities` stores reusable weekday defaults and date-specific overrides. `minutes: null`
  is an explicit no-capacity setting; absence of a date override falls back to its weekday.

The deterministic v7-to-v8 migration creates one `plannedDate` placement for every existing task
that has a Phase 2A planned day. Existing task, dashboard, completion, deletion, and relationship
records are unchanged. Migrated tasks are grouped from their existing exact start/time window and
ordered by date, group, exact time, task order, and stable ID. Unplanned and flexible-range tasks do
not receive invented placements or capacity.

## Planning invariants

Phase 2A fields remain authoritative task intent. A conventional agenda placement is synchronized
with `task.plannedDate`. A flexible-range task instead receives a `flexibleRange` placement whose
date must be within the inclusive range; the range is never collapsed or rewritten. Removing that
placement returns the task to the flexible source unchanged.

Exact-time tasks are always displayed chronologically. Morning, afternoon, evening, and Any Time
use the persisted placement order, which is independent of list/project order. Labelled move-up and
move-down controls provide a keyboard and non-drag alternative. Editing Phase 2A planning keeps a
valid flexible placement, updates a planned-date placement, or removes an incompatible placement.

Single and bulk moves validate every task before writing. Bulk move/unplan operations update tasks
and placements in one Dexie transaction, so an out-of-range flexible task prevents the whole move
without partial results. Soft-deleted tasks retain their dormant placement for recovery but are
excluded from snapshots; permanent deletion removes the placement.

## Capacity and agenda calculations

A date override takes precedence over its weekday record. Clearing the override restores weekday
fallback. Positive whole minutes from 1 through 1,440 are accepted; no duration estimate is ever
invented. Capacity totals include active incomplete agenda tasks with known estimates, separately
count unknown-duration and blocked tasks, and exclude completed tasks. Remaining and over-capacity
figures are descriptive and use calm language rather than scoring or judgement.

The focused agenda includes completed tasks so they can be uncompleted, while capacity excludes
them. Blocked tasks may be planned but retain the Phase 1B explanation and cannot be completed until
their predecessors are complete. Genuine deadline labels continue to derive only from
`deadlineDate`.

## Horizon, sources, and earlier plans

The seven-day horizon uses date-only UTC arithmetic for stable local-day boundaries across DST,
month, leap-year, and year changes. Its start date is user-selectable. It supports opening a day,
editing/completing tasks, and transactional move/unplan selection without changing list order.
Mobile uses a horizontally scrollable, snap-aligned sequence; wider screens present a readable
seven-column summary.

Sources include active unplaced tasks, flexible tasks whose inclusive range overlaps the horizon,
and upcoming genuine deadlines. Placement always requires an explicit date and action. Blocked
sources explain that placement is allowed while completion remains unavailable.

Incomplete tasks with an effective planned date before today appear in the session-dismissible
Previously planned section. Move to today, tomorrow, another date, remove the day, and leave
unchanged all require selection and a confirmation preview. Nothing moves at midnight or page load,
and an earlier planned day alone never makes a task overdue.

## Offline and responsive behavior

All capacity, placement, ordering, and task changes live in IndexedDB. The service worker continues
to cache only the application shell and static assets, so saved agendas survive reload, installed
PWA closure, and offline reopening under `/planibly/`. Controls retain semantic labels, visible
focus, 44×44 targets, mobile safe-area behavior, and non-drag alternatives. Capacity and horizon
layouts collapse or scroll within their own regions rather than causing page-level horizontal
overflow at larger text sizes.

## Manual device checks

- On an installed iPhone PWA, set weekday capacity, add a date override and no-capacity date, clear
  the override, then reopen online and offline and confirm the correct fallback remains.
- Plan standard, flexible, blocked, exact-time, and unknown-duration tasks; confirm grouping,
  chronological exact times, capacity totals, blocker wording, and flexible-range preservation.
- Reorder non-time tasks with labelled controls and confirm list/project order is unchanged.
- Move and unplan several horizon tasks together, cancel a selection, and verify persistence after
  reload and offline reopening.
- Review earlier incomplete plans with each action, confirm no action occurs before approval, and
  verify a past planned day is not labelled overdue without a past genuine deadline.
- At large system text sizes, check the capacity editor, horizon scrolling, confirmation dialog,
  focused agenda, and bottom navigation in light and dark appearance.
