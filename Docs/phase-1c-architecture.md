# Phase 1C architecture

Phase 1C completes the requested Phase 1 task-management boundary with lightweight projects, local
search, useful smart lists, recovery, and reversible destructive organisation actions. IndexedDB
remains the source of truth. Search and derived views do not transmit or duplicate personal data.

## Schema version 5

Database version 5 appends metadata to the existing stores and leaves released versions 1 through 4
unchanged:

- lists gain `mode`, optional project outcome and target-date metadata, and `archivedAt`;
- areas, lists, tasks, steps, tag assignments, and relationships gain a deletion-group identifier;
- task-tag assignments gain modified and soft-deletion timestamps so task restoration can safely
  reattach an assignment when its reusable tag still exists.

The deterministic version 4 to version 5 upgrade marks each existing non-Inbox list as `standard`
and initializes an existing tag assignment's `modifiedAt` from its `createdAt`. Inbox keeps its
system identity. No area, list, task, step, tag, assignment, relationship, completion, or cleared
completion is reset or removed.

## Projects

A project is a list with `mode: project`; it does not introduce another task container or formal
dependency graph. The optional target date is descriptive metadata only and does not schedule tasks,
create reminders, or affect availability.

Progress is derived from active project tasks as completed count over total count. The next available
action is the first incomplete task in manual order that has no incomplete predecessor. If every
remaining task has a blocker, the interface explains that instead of presenting a false next action.
Archived projects and their tasks are excluded from normal areas, lists, and smart lists. They remain
locally stored, readable through the archived-project section, and searchable only when the explicit
archived-content filter is enabled.

Conversion from a standard list preserves its tasks. Conversion back is allowed only while the
project is active and requires explicit confirmation before clearing an outcome or target date.

## Search and smart lists

Search is a case-insensitive trimmed substring match performed in the repository over the local
snapshot. Result-type, completed-content, and archived-project filters are explicit. Results include
enough hierarchy context to distinguish similar names, and selection routes back to the relevant
area, list/project, tag, task, or step.

Smart lists are repository-derived views rather than stored containers:

- Inbox shows active Inbox tasks and preserves the existing persistent Clear Completed behavior.
- All Active Tasks excludes completed tasks and tasks inside archived projects.
- Blocked includes active tasks with at least one active incomplete predecessor.
- Completed includes active completed tasks, including completions previously cleared from a list.
- Recently Deleted lists recoverable areas, lists/projects, tasks, and steps in deletion order.

## Deletion, restoration, and undo invariants

Every destructive area/list/task/step cascade receives one UUID deletion group. Deleting a task now
soft-deletes its steps, active tag assignments, and incoming/outgoing relationships in the same
transaction. This keeps active successors unblocked while retaining enough local structure for safe
restoration. Reusable tags are never deleted with tasks.

Restoring a task also restores steps and assignments from the same deletion group when their tag is
still active. Relationships from the same deletion are restored only when both endpoints are active
and restoring the edge cannot introduce a cycle. Legacy Phase 1B relationships and steps that share
the task deletion timestamp remain restorable; assignments that Phase 1B had already physically
removed cannot be reconstructed.

Restoring a child whose area, list/project, or task parent is still deleted requires a visible choice
to restore the required hierarchy. Permanent deletion cascades through descendants and removes tag
joins and relationship edges that reference permanently removed tasks. Empty Recently Deleted is a
separate strong confirmation and purges every currently deleted recoverable record.

The application retains only the latest deletion receipt in memory for ten seconds. Undo restores
the exact deletion group. For an area whose lists were moved, the receipt also moves those lists back
during same-session undo. Project archive uses the same receipt mechanism and is reversible during
that window. Durable recovery remains available through Recently Deleted after reload; the transient
toast is not represented as durable application state.

## Interface boundary

The mobile-first three-pane Lists screen retains the persistent global Quick Add control and adds
compact smart-list and project affordances. Search is global in the application header. Archived
projects are visually separated, recovery actions use explicit dialogs, and all reordering continues
to offer labelled non-drag controls. No saved filters, advanced query language, complex graph,
dashboard, appointments, routines, reminders, shopping mode, or Phase 2 planning behavior is added.

## Manual device checks

On an installed iPhone PWA, verify:

1. Create a project, add an outcome and target date, and confirm progress and next action update as
   tasks and blockers change.
2. Archive and restore a project, and confirm it is separated from active lists and excluded from
   smart lists until restored.
3. Search every result type with completed and archived filters both off and on, then open results.
4. Delete and undo an area, list/project, task, and step within the toast window.
5. Restore a deleted child with and without its deleted parents, then verify permanent deletion and
   Empty Recently Deleted confirmations.
6. Close and reopen the installed app offline and confirm projects, archived content, smart lists,
   search, and recoverable records remain available.
7. Check dialogs, recovery rows, and project controls at large text sizes, in portrait and landscape,
   and against iPhone safe areas.
