# Phase 4C architecture: optional daily and weekly reviews

Phase 4C adds Morning Summary, Evening Review, and Week Ahead as calm, manually accessible review
flows. Reviews compose current local task, calendar, routine, focus, project, and capacity data. They
do not copy that content, score it, analyse patterns, schedule anything automatically, or block the
rest of Planibly. Everything remains local in IndexedDB and available offline.

## Schema version 14

Dexie v14 is append-only after released versions 1–13. It adds two stores:

- `reviewPreferences` is a fixed-key singleton (`&id, modifiedAt`) containing enablement, in-app
  availability times, Week Ahead weekday/time, Home visibility, optional-section visibility,
  completed-summary visibility, and default disclosure state.
- `reviewRecords` stores stable UUID, review type, inclusive local period, started/finished and
  modified timestamps, record version, and optional action counts. Its unique
  `[type+periodStart]` index enforces one record for one type and period start.

The v13-to-v14 migration creates empty stores and advances schema metadata. Initialization creates
one calm default preference record with all review types enabled, sensible times, factual completed
summaries visible, and Home availability off. This produces no prompt or forced onboarding. Invalid
preferences recover to defaults. Invalid review records are removed because they contain no source
content and cannot safely identify a period. Existing Phase 4B tasks, prep, focus, routines,
calendars, planning, dashboard layouts, and recovery data remain unchanged.

## Review lifecycle and session dismissal

A date or week start is always an explicit local `YYYY-MM-DD` value. Morning and Evening use one
date; Week Ahead uses that date and the following six consecutive local-calendar days. Date-only UTC
arithmetic prevents DST, month, leap-day, and year boundaries from changing the number of days.

Starting a review creates its record; starting it again resumes the same record. Exit leaves an
unfinished record available to continue after reload or offline reopening. Finish records only a
timestamp. A finished review can be reopened deliberately by clearing that timestamp on the same
record. Deleting a review record never touches tasks, events, routines, focus, or planning data.

“Dismiss for now” is intentionally held only in the running JavaScript session. It suppresses a
repeat Home offer for the same type/date without writing a dismissal timestamp. Closing the app
starts a new session. This keeps temporary intent out of durable history while unfinished review
records still resume normally.

## Section definitions

Morning Summary shows selected-day events and planned tasks, genuine overdue deadlines, incomplete
earlier plans, scheduled routines, active focus, task capacity, missing estimates, and active
project next actions. An earlier planned date is never called overdue unless `deadlineDate` is
genuinely before the controlled date.

Evening Review shows tasks completed on the selected local date, completed and neutrally skipped
routine runs, incomplete planned tasks, that day’s calendar, current focus, and tomorrow’s task,
event, routine, and capacity summary. Tasks completed without a precise `completedAt` are described
as historical and are not assigned to a day.

Week Ahead uses the Phase 2C seven-day horizon and sources. Each readable day shows event, task, and
routine counts plus capacity guidance. Unscheduled tasks, flexible-range candidates, genuine
deadlines, blocked tasks, movable planned tasks, project next actions, and optional factual weekly
completion totals remain distinct. Flexible tasks may only be placed inside their inclusive range.
Mobile uses horizontally scrollable day cards rather than seven narrow columns.

## Preview and action safety

Review task choices use one shared preview model. Each preview lists the live task title, current
planning date, proposed date or removal, unchanged state, validation failure, known duration, and
per-date capacity before/after impact. Unknown durations remain unknown. Capacity is guidance and
never blocks approval. Blocked tasks may be planned but retain the existing completion restriction.

Preview performs no writes. Cancel therefore applies nothing. Approval re-reads authoritative data,
validates every action, and writes task fields, Phase 2C placements, and minimal review action counts
in one Dexie transaction. Any invalid item or transaction failure leaves the complete plan
unchanged. Standard planned tasks keep `plannedDate` synchronized; flexible tasks retain their range
and receive only a valid `flexibleRange` placement. Removing a standard plan clears its time intent;
removing a flexible placement preserves the range. Calendar events are never moved by task actions.
No action runs at launch, midnight, review start, exit, dismissal, or finish.

## Preferences, Home, and navigation

Availability times are evaluated only while Planibly is open and are explicitly described as
in-app offers, not alarms or notifications. Disabling Home availability never removes manual access.
Optional section visibility, completed summaries, and key disclosure defaults are stored locally.

One `Reviews` dashboard card represents all three review types to avoid crowding. It shows each
manual/due/continued/finished/session-dismissed state and links to the dedicated `/reviews`
workspace. The card is part of versioned built-in defaults. Dashboard normalization appends it
hidden to every older/custom layout, preserving saved layout content and order; new or explicitly
restored built-ins may show it. Reviews are linked from Home and Plan and do not add a sixth mobile
bottom-navigation destination.

## Accessibility, privacy, and exclusions

The workspace uses headings, sections, native disclosures, labelled date/time inputs, lists,
dialogs, polite announcements, keyboard controls, visible focus, and 44-pixel targets. Review
layouts wrap or internally scroll for mobile safe areas and 200% text. Existing dark mode,
high-contrast, and reduced-motion foundations remain authoritative. State is always expressed in
text, never colour alone.

Review records contain no task, event, routine, project, focus, or note text. Minimal action summaries
are aggregate counts only. Phase 4C excludes notifications, alarms, email, widgets, scores, streaks,
mood or energy questions, automatic scheduling/rescheduling/skipping, pattern analysis, insights,
actual-duration tracking, Session Builder, Help Me Choose, cloud sync, accounts, APIs, external
services, and all Phase 5 work.

## Manual device checks

1. On an installed iPhone PWA, open each review manually for controlled dates, exit an unfinished
   review, close/reopen offline, and confirm Continue returns to the same record and current data.
2. Dismiss each review and confirm it stays suppressed only for the current app session; relaunch and
   confirm manual access remains.
3. Preview, cancel, and approve task moves/removals from Morning, Evening, and Week Ahead. Include a
   blocked task, unknown estimate, over-capacity day, and flexible-range boundary.
4. Complete and clear a task, complete/skip routines, and verify factual daily/weekly summaries. Check
   that historical completions without timestamps are explained rather than guessed.
5. Customize Home before and after upgrade. Confirm the saved layout is unchanged and the Reviews
   card can be enabled, reordered, resized, and removed from view deliberately.
6. At 200% text in portrait and landscape, inspect every disclosure, date control, preview dialog,
   sticky action bar, dashboard card, safe area, keyboard focus order, VoiceOver label, dark mode, and
   page-level horizontal containment.
