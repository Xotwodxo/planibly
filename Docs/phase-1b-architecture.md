# Phase 1B architecture

Phase 1B adds optional task detail without changing Quick Add or introducing project-management
features. The source of truth remains the local Dexie database; presentation state is never used to
represent persisted steps, tag assignments, relationships, or blocking.

## Schema version 4

Database version 4 appends four stores and leaves released versions 1 through 3 unchanged:

- `taskSteps`: UUID primary key, parent task, order, title, completion state, timestamps, and an
  optional soft-deletion timestamp.
- `tags`: UUID primary key, display name, normalized name, colour, timestamps, and an optional
  soft-deletion timestamp.
- `taskTags`: UUID primary key plus a unique compound task/tag assignment. Assignments contain no
  task content and are removed when unassigned.
- `taskRelationships`: UUID primary key, predecessor task, successor task, timestamps, and an
  optional soft-deletion timestamp.

The upgrade creates empty Phase 1B stores and advances the schema metadata marker. It does not
rewrite any Phase 1A area, list, task, completion, or cleared-completion record. Tests open a real
version 3 database containing Phase 1A data and verify that data after the version 4 upgrade.

## Data invariants

- Steps belong to exactly one active task and have one level only. Their completion is independent
  of the parent: completing all steps does not complete the task, and changing the parent does not
  alter step states.
- Active tag names are case-insensitively unique. Removing an assignment leaves both the task and
  reusable tag intact. Deleting an assigned tag requires confirmation, soft-deletes the tag, and
  removes its assignment joins without deleting tasks.
- A relationship is a directed edge from predecessor to successor, displayed as Before and After.
  Self-edges are rejected. Before inserting an edge, the repository traverses active successor
  edges; if the proposed predecessor is reachable, the new edge would form a direct or indirect
  cycle and is rejected.
- Blocked state is derived, not stored as another task status. An active task is blocked while at
  least one active predecessor is not completed. Completing a blocked task is rejected in the
  repository. Completing all predecessors unblocks it immediately; uncompleting any predecessor
  blocks it again. Cleared completed predecessors still count as completed.
- Steps may be completed while their parent task is blocked. This keeps lightweight preparation
  possible without weakening the rule that the parent cannot be completed early.

## Deletion behaviour

Tasks remain soft-deleted for future recovery architecture. When a task is soft-deleted directly or
through an area/list cascade, the same transaction soft-deletes its steps and every incoming or
outgoing relationship and removes its tag-assignment joins. Reusable tags are retained. Therefore an
active successor cannot remain permanently blocked by a deleted predecessor. Snapshot derivation
also ignores missing or deleted relationship endpoints defensively.

A future restore flow must make an explicit decision about restoring related records; Phase 1B does
not silently revive removed relationships.

## Interface boundary

Quick Add remains title-only and defaults to Inbox. The existing task editor contains optional
Steps, Tags, and Before and After sections. Task rows show only compact progress, assigned tag chips,
and a blocking explanation. Arrow controls provide keyboard and non-drag ordering. No dependency
graph, search, saved filter, project mode, notes, schedule, priority, reminder, or recovery UI is
included.

## Manual device checks

On an installed iPhone PWA, verify:

1. Add several steps rapidly, rename and reorder them, and confirm large text does not hide controls.
2. Complete steps and the parent in both directions, confirming their states remain independent.
3. Create and assign multiple tags, then confirm task rows stay readable at narrow width.
4. Add a Before relationship, confirm the successor cannot be completed, then complete and
   uncomplete the predecessor to see automatic unblocking and re-blocking.
5. Close and reopen the PWA offline and confirm steps, tags, relationships, and blocked state remain.
6. Check the editor against the top and bottom safe areas in portrait and landscape.
