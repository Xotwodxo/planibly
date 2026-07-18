# Phase 4B architecture: focused task starts

Phase 4B adds optional starting support without changing task validity, task planning semantics, or
routine-run history. All state remains in IndexedDB and the feature works without network access.

## Model and migration

Schema version 13 is append-only after the released versions 1–12. It adds three stores:

- `taskStartingDetails`: one optional record per task (`&id, &taskId, modifiedAt`) containing bounded
  plain-text `whyItMatters`, an optional preferred start style, and an optional default countdown.
- `taskPrepItems`: ordered, stable-UUID checklist records
  (`&id, taskId, [taskId+order], completed, modifiedAt, deletedAt, deletionGroupId`).
- `activeFocus`: a fixed-key singleton (`&id, &taskId, modifiedAt`) containing the active task,
  selected style, reveal state, started time, and countdown configuration.

The v12-to-v13 migration creates empty stores and advances schema metadata. It does not modify tasks,
routines, routine items, variants, runs, run snapshots, occurrence adjustments, calendar data, or ICS
provenance. Existing tasks receive no inferred preferences or prep.

## Starting details and prep

A title-only task remains valid. Empty starting details are removed instead of leaving meaningless
records. Motivation is user-authored plain text capped at 1,000 characters. Default countdowns are
whole minutes from 1 through 1,440.

Prep means getting ready; task steps mean doing the task. Prep therefore has its own repository and
never contributes to task, step, project, or routine progress. Prep items can be added, renamed,
reordered, completed, duplicated, reset deliberately, soft-deleted, restored, and permanently
deleted. They are one level only and titles are capped at 200 characters.

## Start styles

- **Gentle Start** presents the task, optional motivation, and prep before Begin Task. It then reveals
  the current incomplete task step and normal controls.
- **One Thing** presents only the task and blockers before starting, then the current action. Show
  Full Task explicitly reveals the rest for that focus.
- **Full View** keeps planning, motivation, prep, steps, and details visible together.

The stored task preference initializes the chooser. Changing the chooser affects that start only and
does not rewrite the task preference. Every style retains edit and exit controls.

## Focus lifecycle and invariants

The active-focus store uses one fixed ID, so valid application state contains zero or one focus.
Starting a second task requires an explicit switch. Replacement of the singleton is transactional.
A blocked task cannot start; blocking is derived from existing Before/After relationships and
incomplete predecessors.

Initialization validates the singleton against an active, incomplete task in an available list or
project. Invalid, extraneous, completed, soft-deleted, or unavailable focus state is removed. Task
completion, task deletion, parent list/area deletion, and project archiving clear matching focus in
the same repository transaction. Permanent task deletion also removes its starting details and prep.
Leaving or ending focus removes only the active focus: it does not complete, reschedule, or score the
task and it records no session history.

The current step is the first non-deleted incomplete step in manual order. Completing it advances the
derived current step. Users may navigate backward or forward, reveal all steps, and complete a
different step. Completing the last step offers parent completion in a confirmation dialog; neither
step completion nor focus ending completes the task automatically.

## Countdown correctness

The countdown is one optional continuous timer, not a Pomodoro cycle. Its selected source is none,
task estimate, saved task default, or custom minutes. A running timer persists an absolute end
timestamp; rendering derives remaining seconds from that timestamp and an injected clock. Browser
throttling, reload, and offline reopening therefore do not depend on accumulated JavaScript ticks.

Pausing stores remaining seconds and removes the end timestamp. Resuming computes a new end from the
current clock. Adding time deliberately adjusts the persisted remainder or end. Reset returns the
configured timer to idle; choosing no countdown clears duration state. Reaching zero leaves the focus
active and presents neutral continue/add/end choices. No alarms, cycles, breaks, history, scores, or
automatic completion are produced.

Malformed countdown data is rejected by validation and the owning invalid focus is cleared during
database initialization. Repository tests use injected clocks rather than real waiting.

## Dashboard and routine boundaries

`Current Focus` is a dashboard card backed by the same focus singleton. It shows task, current step,
countdown state, Continue, and confirmed End Focus. Versioned dashboard normalization makes the card
available and keeps it hidden when migrating existing layouts, preserving every saved arrangement.
It may be suggested while focus is active, but suggestions never alter a layout.

Routine definitions and runs remain unchanged. Phase 4B does not turn routine items into tasks or add
routine countdowns. A routine-to-existing-task link is deliberately deferred because it would
materially expand the released Phase 4A schema for optional integration.

## Deletion and recovery

Task soft deletion assigns its active prep items the task deletion group, and task restoration
restores matching prep. Deleting a prep item directly uses the normal ten-second undo notification and
Recently Deleted entry. A prep item can be restored only while its parent task is available; the UI
restores the parent task first when needed. Empty Recently Deleted and permanent task/list/area
deletion purge eligible prep. Starting-detail and active-focus records are not recovery history and
are removed permanently with their task.

These operations do not modify steps, relationships, calendars, recurrence, imports, routines, or
routine-run snapshots.

## Accessibility and scope

The focused screen is a semantic main view with a visible exit, labelled controls, keyboard access,
44-pixel targets, safe-area padding, reduced-motion support, dark/high-contrast styling, and wrapping
layouts for large text. Live regions announce prep, step, countdown, and switching changes; countdown
state is conveyed in text rather than colour alone.

Phase 4B explicitly excludes Pomodoro cycles, forced breaks, reminders, vibration settings, reviews,
weekly summaries, actual-duration analytics, productivity scores, streaks, generated steps,
automatic completion or scheduling, Session Builder, Help Me Choose, pattern analysis, cloud sync,
accounts, external services, widgets, and Phase 4C work.
