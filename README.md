# Planibly

Planibly is a zero-cost, private, offline-first personal planning PWA. This repository currently
implements the installable foundation and the local planning system through **Phase 3C**. Alongside
organisation, projects, search, recovery, planning, capacity, and the configurable Home dashboard,
it now includes private internal calendars, appointments, recurring occurrences, reusable event
templates, and local ICS import/export with explicit preview and conflict handling. Live calendar
synchronisation, reminders, provider accounts, and timelines remain out of scope.

## What Phase 0 contains

- React, strict TypeScript, Vite, and React Router
- Responsive application shell with mobile bottom navigation and wider-screen side navigation
- Calm light/dark design tokens and a small accessible component foundation
- A web app manifest with standard, maskable, Apple touch, and favicon assets
- A generated Workbox service worker that precaches the shell and supports offline reloads
- Dexie-backed IndexedDB with explicit schema versions and deterministic migration hooks
- Local-only diagnostic logging and a recoverable React error boundary
- Vitest, React Testing Library, fake IndexedDB, and Playwright test coverage
- ESLint and Prettier configuration

## What Phase 1A contains

- Editable, colour-coded, reorderable areas with five idempotent starters
- Standard lists inside areas and a protected Inbox available immediately
- Basic local tasks with Quick Add, editing, completion, and persistent Clear Completed handling
- Explicit handling for non-empty area and list deletion
- Dexie schema version 3 with repository-based persistence, soft deletion, and completion clearing
- Accessible move controls and responsive mobile/desktop organisation views

## What Phase 1B contains

- One-level task steps with independent completion, rapid entry, and accessible reordering
- Reusable colour-coded tags with multiple assignments per task
- Plain-language Before and After task relationships with self-reference and cycle prevention
- Derived blocked-task state that responds immediately to predecessor completion changes
- Dexie schema version 4 with deterministic Phase 1A migration and relationship cleanup on task deletion

## What Phase 1C contains

- Standard lists that can be created or safely converted into lightweight projects
- Project outcome, optional target-date metadata, derived progress, and a next available action
- Local substring search across areas, lists/projects, tasks, steps, and tags with explicit filters
- Inbox, All Active Tasks, Blocked, Completed, and Recently Deleted smart lists
- Hierarchy-aware recovery, explicit permanent deletion, and a strongly confirmed Empty action
- Ten-second same-session undo for task, step, list/project, and area deletion and project archiving
- Dexie schema version 5 with deterministic Phase 1B migration and recoverable deletion groups

## What Phase 2A contains

- Optional planned day, genuine deadline, inclusive flexible range, local time/window, and duration
- A compact Planning section in task editing plus optional Today/Tomorrow Quick Add shortcuts
- Today, Next Three Days, Upcoming, Deadlines, Overdue, and Unscheduled smart lists
- A mobile-first Plan screen for reviewing, completing, planning, replanning, and removing a day
- Dexie schema version 6 with a deterministic, non-destructive Phase 1C migration
- Date-only local-calendar arithmetic with injectable-today repository queries and no date library

## What Phase 2B contains

- A responsive Home dashboard with Quick Add and eight concise task/project summary cards
- Overview, Focus, and Planning starter layouts plus local custom layout CRUD and switching
- Card reordering, visibility, and compact/standard/wide sizing with explicit Save and Cancel
- Protected built-in layouts, exactly-one-default recovery, and safe unknown-config normalization
- Local, explainable, dismissable Overdue and Project Next Actions suggestions
- Dexie schema version 7 with durable completion timestamps and offline dashboard layout persistence

## What Phase 2C contains

- A date-focused agenda grouped by exact time, morning, afternoon, evening, and Any Time
- Reusable weekday capacity, per-date overrides, explicit no-capacity days, and honest unknown estimates
- A selectable seven-day horizon with deliberate single and transactional multi-task placement
- Unscheduled, flexible-range, and upcoming-deadline planning sources with no automatic scheduling
- Explicit review of incomplete earlier plans without treating planned dates as deadlines
- Dexie schema version 8 with durable agenda placements, manual group order, and capacity records

## What Phase 3A contains

- Multiple local calendars with ordering, visibility, colour, protected starter data, and recovery
- Validated all-day and timed appointments using explicit local dates and wall-clock times
- A responsive Monday-first month view, selected-day agenda, and bounded upcoming agenda
- Informational appointment and overlap presentation in Plan without changing task capacity
- Today-card appointment summaries without changing saved dashboard layout definitions
- Dexie schema version 9 with grouped soft deletion, undo, restoration, and permanent deletion

## What Phase 3B contains

- Daily, weekdays, selected-weekday weekly, monthly day/ordinal, and yearly recurrence with intervals
- Never, local end-date, and occurrence-count endings with explicit short-month and leap-day rules
- Bounded deterministic occurrence expansion with stable series/date identities and local wall-clock time
- Durable occurrence overrides/cancellations plus explicit this-event, this-and-future, and series scopes
- Calendar, Plan, Home, overlap, calendar deletion, undo, and Recently Deleted integration
- Optional reusable event templates with CRUD, ordering, fallback calendar, recovery, and permanent deletion
- Dexie schema version 10 with recurrence rules, exceptions, and event template stores

## What Phase 3C contains

- Local `.ics` file-picker and pasted-text import with a mandatory no-write preview
- Bounded VEVENT parsing for all-day/timed events, supported recurrence, exclusions, and overrides
- Explicit floating, UTC, TZID, and unresolved-timezone handling with UK DST coverage
- External UID provenance, duplicate/re-import classification, local-change detection, and conflict choices
- Transactional import into a new or active calendar plus removable summary-only import history
- Validated ICS export for events, series, occurrences, calendars, date ranges, and visible calendars
- Web Share file handoff where supported and an always-available download fallback
- Dexie schema version 11 with import-source, import-batch, and external-record mapping stores

There is no backend, account, analytics, external AI, paid service, provider OAuth, or native iOS
integration. ICS transfer creates a copy; later changes do not synchronise automatically.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

On Windows PowerShell systems that restrict script execution, use `npm.cmd` instead of `npm`.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL printed by Vite. The development server does not enable the service worker, which
avoids stale caches while editing.

## Verification

Run the checks independently:

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:pwa
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

`verify:pwa` inspects `dist/`, so run the production build first. Playwright starts both a
GitHub-Pages-style production preview at `/planibly/` and a root-based development server. It
verifies the manifest, service-worker scope, direct route refreshes, responsive navigation, and
offline reload behavior.

To preview the built PWA manually:

```powershell
npm.cmd run build
npm.cmd run preview -- --host 0.0.0.0
```

Service workers and installation require a secure context. `localhost` is accepted during local
development; a deployed build must use HTTPS.

## Production build

```powershell
npm.cmd run build
```

The static output is written to `dist/` for the GitHub Pages project path `/planibly/`. The build
uses a root base path only in local development; do not use the production output as though it were
hosted at `/`.

## GitHub Pages deployment

The expected public URL is [https://xotwodxo.github.io/planibly/](https://xotwodxo.github.io/planibly/).

The checked-in workflow at `.github/workflows/deploy-pages.yml` runs on every push to `main` and:

- installs dependencies with `npm ci`;
- runs formatting, linting, type checking, unit/component tests, PWA verification, and end-to-end tests;
- builds `dist/` and deploys it through GitHub Pages.

Before the first deployment, open the GitHub repository’s **Settings → Pages**. Under **Build and
deployment**, select **Source: GitHub Actions**. No branch/folder Pages source should be selected.

To deploy manually, open **Actions → Deploy Planibly to GitHub Pages → Run workflow**, select
`main`, then choose **Run workflow**.

GitHub Pages does not provide SPA rewrites for project sites. `public/404.html` redirects a direct
route such as `/planibly/plan` back to the application shell, where the router restores the route.

To roll back a deployment, revert the problematic commit on `main` (using GitHub’s **Revert** action
or a normal local revert), then push the revert. The workflow deploys the restored build. Do not
force-push to roll back.

## Architecture boundaries

- IndexedDB is the future source of truth. In-memory state is never intended to replace it.
- HTTP caches contain only the versioned application shell and static assets, never personal data.
- Diagnostics are capped, stored locally, and never transmitted.
- Add future Dexie schemas sequentially in `src/data/database.ts`; never rewrite a released schema.
- The service-worker update prompt requires explicit user action and will not reload while a
  task form has unsaved changes.

See [Docs/phase-0-architecture.md](Docs/phase-0-architecture.md),
[Docs/phase-1a-architecture.md](Docs/phase-1a-architecture.md),
[Docs/phase-1b-architecture.md](Docs/phase-1b-architecture.md), and
[Docs/phase-1c-architecture.md](Docs/phase-1c-architecture.md), and
[Docs/phase-2a-architecture.md](Docs/phase-2a-architecture.md), and
[Docs/phase-2b-architecture.md](Docs/phase-2b-architecture.md), and
[Docs/phase-2c-architecture.md](Docs/phase-2c-architecture.md), and
[Docs/phase-3a-architecture.md](Docs/phase-3a-architecture.md), and
[Docs/phase-3b-architecture.md](Docs/phase-3b-architecture.md), and
[Docs/phase-3c-architecture.md](Docs/phase-3c-architecture.md) for the current architecture, data
invariants, safety bounds, and manual device checks.
