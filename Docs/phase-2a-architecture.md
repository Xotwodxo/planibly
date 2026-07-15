# Phase 2A architecture

Phase 2A adds optional planning intent to the existing local task model. It does not add a calendar,
timeline, capacity engine, reminder system, recurrence, or automatic scheduling.

## Schema migration

Dexie schema version 6 preserves every released v5 store and adds four task indexes:
`plannedDate`, `deadlineDate`, `flexibleStartDate`, and `flexibleEndDate`. The deterministic upgrade
only advances the local schema marker. It does not iterate over or rewrite existing tasks, so all
Phase 1C records remain intact and naturally have no planning values.

The optional task fields are:

- `plannedDate`: a local calendar date when the user intends to act;
- `deadlineDate`: a distinct, genuine last date;
- `flexibleStartDate` and `flexibleEndDate`: an inclusive range of suitable dates;
- `timeWindow`: `morning`, `afternoon`, or `evening`;
- `exactStartTime`: a local wall-clock `HH:mm` value;
- `estimatedDurationMinutes`: a positive whole number, independent of dates and times.

Task completion, clearing completion, soft deletion, restoration, and relationship operations do
not remove these fields. Completed tasks are excluded from active planning queries; uncompleting a
task makes its preserved planning intent active again.

## Date and time invariants

Calendar dates are strictly validated `YYYY-MM-DD` strings and are never parsed with the JavaScript
UTC interpretation of a date-only ISO string. The UI derives today from the device's local year,
month, and day. Calendar addition uses UTC component arithmetic only as a timezone-free Gregorian
calculation, then returns another date-only string. This remains stable across locale, daylight
saving changes, month ends, leap days, and year boundaries.

Exact times remain local wall-clock strings and are never converted to UTC. Repository queries take
an explicit `today` argument (with a local-device default), which keeps boundary tests deterministic.

Planning invariants are enforced in the domain layer:

- a named time window or exact time requires a planned day;
- exact time and a named window cannot coexist;
- absence of both on a planned day means Any Time;
- a specific planned day and a flexible range cannot coexist;
- a flexible range requires both inclusive endpoints and start must not follow end;
- duration must be a positive whole number;
- deadline is independent and may exist alone or alongside either kind of planning intent.

The editor clears the conflicting alternative when a user switches between a planned day and a
flexible range. Clearing planning explicitly removes all optional planning fields; removing a
planned day from the Plan screen preserves deadline and duration while clearing its dependent time.

## Query definitions

All active planning queries exclude soft-deleted tasks, completed tasks, and tasks in archived
projects.

- **Today:** `plannedDate` equals the injected local today.
- **Next Three Days:** `plannedDate` falls from today through today plus two calendar days.
- **Upcoming:** `plannedDate` is after the three-day horizon.
- **Deadlines:** tasks with `deadlineDate`, ordered by deadline.
- **Overdue:** incomplete tasks with `deadlineDate` before today. A past planned day is never overdue
  by itself.
- **Unscheduled:** tasks with neither a specific planned day nor a flexible range. A deadline alone
  does not schedule a task.

The Plan screen avoids repeating Today in its following section: its **Next Three Days** section
shows the remaining two days in that named horizon. **Flexible range tasks** are ordered by range
start and are never described as deadlines. **Upcoming deadlines** contains current and future
deadlines; overdue deadlines remain available in the dedicated smart list.

## Presentation structure

The existing task editor owns the optional Planning fieldset, followed by the existing Steps, Tags,
and Before/After sections. Quick Add remains title-first and defaults to Inbox and no date, with
optional Today and Tomorrow choices.

`PlanPage` is a responsive sequence of semantic sections: Today, Next Three Days, Flexible range
tasks, Upcoming deadlines, and Unscheduled. Each task can open the existing editor, be planned or
replanned, lose its specific planned day, and be completed when relationship rules allow. Task rows
show compact planning metadata and blocking reasons without introducing a dashboard or calendar.

## Manual device checks

- On an installed iPhone PWA, create deadline-only, planned, flexible-range, and exact-time tasks.
- Close and reopen online and offline; confirm the same values and Plan sections remain.
- Cross a local midnight if practical and confirm Today and Overdue recalculate from the device day.
- Increase text size and confirm the Planning fieldset and Plan actions remain reachable with safe
  area spacing.
- Confirm a blocked task cannot be completed from Plan and becomes available after its predecessor.
