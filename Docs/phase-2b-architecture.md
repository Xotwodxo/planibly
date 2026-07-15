# Phase 2B architecture

Phase 2B replaces the Home placeholder with a configurable, offline-first dashboard. It composes
existing Phase 1 and Phase 2A task, project, blocking, and planning rules; it does not create a
second task model or introduce agenda, capacity, scoring, calendar, or automated scheduling logic.

## Schema migration

Dexie schema version 7 appends the `dashboardLayouts` store and a `completedAt` task index. All v6
stores and indexes remain unchanged except for that appended task index. During the deterministic
v6-to-v7 upgrade, an existing completed task without `completedAt` receives its existing
`modifiedAt` value as the best available historical completion time. Active tasks are not changed,
and every Phase 2A planning field is preserved.

New completions set `completedAt` to the same repository timestamp as `modifiedAt`; uncompleting a
task removes it. `completedClearedAt` remains independent, so Clear Completed keeps its established
meaning while the bounded Recently Completed card can order completion history consistently.

Each dashboard layout stores a stable UUID, name, optional protected built-in key, ordered card
configuration, default flag, dismissed suggestion keys, and created/modified timestamps. Card
configuration contains only a known type, `compact`/`standard`/`wide` size, visibility, and order.
The active layout identifier and starter-data marker live in the existing metadata store.

## Starter and recovery invariants

Overview, Focus, and Planning use fixed project-owned UUIDs and are inserted once behind a versioned
starter marker. Initialization is idempotent: after the marker exists, a changed or deleted starter
is not silently recreated. The explicit Restore built-in defaults action is the only operation that
recreates the protected arrangements.

Built-in layouts cannot be renamed or deleted. Saving changes to one creates a custom copy, which
keeps recovery predictable. Custom layouts can be created, renamed, duplicated, switched, made the
default, and deleted with confirmation. Deleting the active layout selects a valid fallback;
deleting the default selects a new default. Repository reads repair missing active metadata and
zero/multiple defaults so exactly one usable layout is always default.

Runtime normalization ignores unknown future card types, drops duplicates, coerces invalid sizes to
`standard`, repairs order, and adds any missing known cards as hidden. If corruption hides every
card, Quick Add is restored as the smallest safe usable dashboard. Invalid layout records are
discarded; if no valid record remains, a local recovered layout is created.

## Card queries and task rules

The Today, Overdue, Next Three Days, Upcoming Deadlines, Unscheduled, and Blocked Tasks cards reuse
the Phase 2A smart-list definitions with an injected local date. Project Next Actions uses existing
derived project progress and never builds a separate project queue. Recently Completed is ordered
by `completedAt`, limited to five active-list tasks, and does not calculate streaks, scores, or
performance claims.

Cards show at most two, three, or five records for compact, standard, and wide sizes. Their links
open the corresponding full smart list. Task titles open the established editor. Completion uses
the planner repository, so blocked tasks remain disabled and automatically become available only
when their predecessor rules permit it. All data updates broadcast the existing local planner
change event, keeping cards reactive without network traffic.

## Customization and suggestions

Customization uses an in-memory draft. Show/hide, size, name, and move-up/move-down controls are
labelled and keyboard-operable; no drag interaction is required. Save persists the draft. Cancel
restores the prior saved configuration after confirmation when dirty. Browser unload and in-app
link navigation also warn while the draft has unsaved changes.

Suggestions are deliberately narrow and local: a hidden Overdue card may be suggested when overdue
deadlines exist, and a hidden Project Next Actions card may be suggested when a project has an
available next action. The explanation identifies why it appeared. Review opens customization;
Dismiss persists per layout. Suggestions never alter configuration automatically and record no
analytics.

## Responsive and offline behavior

Mobile renders one card per row, keeps controls above the bottom navigation and safe area, and lets
content wrap under large text. Wider screens use a bounded twelve-column grid where the three card
sizes span four, six, or twelve columns. Existing focus, contrast, dark-mode, and reduced-motion
foundations remain in force.

Dashboard configuration and all personal records live only in IndexedDB. The PWA service worker
continues to cache application assets, not user data, so saved layouts and task summaries remain
available after reload and an offline reopening under `/planibly/`.

## Manual device checks

- On an installed iPhone PWA, switch among all three starters and create, rename, duplicate, save,
  cancel, make default, and delete a custom layout.
- Reorder, hide/restore, and resize cards using only labelled controls; close and reopen online and
  offline and confirm the saved arrangement and current layout remain.
- Complete an unblocked task from Home and confirm it appears in Recently Completed; confirm a
  blocked task explains its blocker and cannot be completed.
- Increase system text size and verify customization, confirmations, card actions, and bottom
  navigation remain reachable without horizontal scrolling.
- Check light and dark appearance, visible keyboard focus on desktop, high-contrast mode where
  available, and reduced-motion behavior.
