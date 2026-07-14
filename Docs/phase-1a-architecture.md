# Phase 1A architecture

## Boundary

Phase 1A adds editable areas, standard lists, Inbox, and basic tasks. It intentionally excludes
steps, tags, project and shopping modes, search, smart lists other than Inbox, Recently Deleted,
undo, dates, reminders, scheduling, and all later planning behavior.

## Database migration

Dexie schema version 2 appends `areas`, `lists`, and `tasks` without changing version 1. Schema
version 3 then appends the `completedClearedAt` index to `tasks`, again leaving prior definitions
unchanged. Both upgrades preserve earlier records and update schema metadata. Starter data is
inserted after opening through a transaction guarded by `starterDataVersion`. This makes
initialization repeatable without recreating starter areas a user later edits or deletes.

Area, list, and task IDs are stable UUIDs. Records contain creation and modification timestamps,
numeric ordering, and an optional `deletedAt` timestamp. Phase 1A deletion is soft deletion; no
recovery interface is exposed because Recently Deleted and undo remain outside this phase.

Inbox is a protected system list with no parent area. Every other list belongs to one area. A basic
task belongs to one list and has one of three scoped statuses: `inbox`, `available`, or `completed`.
Moving an incomplete task between Inbox and another list updates that status; completed state is
preserved while editing.

`completedClearedAt` represents an explicit Clear Completed action. A completed task without that
timestamp remains visible, greyed, and struck through. Clear Completed writes one timestamp to the
currently visible completed tasks in the active list; it never soft-deletes or removes them from
repository snapshots. This preserves future completion history, insights, and recovery options.
Existing version-2 completed tasks have no timestamp, so the version-3 migration keeps them visible.
Marking a cleared task incomplete or completing it again removes the timestamp, making that new
completion visible until Clear Completed is used again.

## Persistence boundary

`PlannerRepository` owns application reads and writes. Presentation components do not access Dexie
tables directly. Multi-record deletion and area-list moves are transactional. Non-empty deletion
requires an explicit repository strategy as well as the interface confirmation.

Cache Storage continues to contain only the application shell. Personal data remains in IndexedDB
and is available to the same installed PWA while offline.

## Interface structure

The Lists route renders area, list, and task panes. The panes stack into compact horizontal choices
on iPhone widths and form three columns on wider screens. Reordering uses labelled Move up and Move
down buttons, providing keyboard and screen-reader operation without drag-only interaction.

Quick Add is available throughout the application and defaults to Inbox. Its form requires only a
title and supports Save and Save & Add Another. Entity and task editors share accessible modal and
form foundations. A shared dirty-form registry prevents a ready service worker from reloading over
unsaved input.

Completed tasks remain in their list with a checked control, muted treatment, and strikethrough.
Clear Completed persistently hides only the completed tasks selected by that action; it writes
`completedClearedAt` and does not delete the stored records.

## Manual acceptance

1. On an installed iPhone PWA, create and edit an area, list, and task using touch and VoiceOver.
2. Confirm horizontal area/list choices remain usable with larger text and do not obscure tasks.
3. Clear completed tasks, close and reopen the installed PWA, and confirm they remain hidden.
4. Repeat while offline after one successful load, including creating, completing, clearing, and
   reopening a task.
5. Confirm destructive dialogs clearly distinguish moving lists from deleting contained data.
6. Confirm light/dark contrast, visible keyboard focus, and all Move up/Move down alternatives on a
   desktop browser.
