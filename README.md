# Planibly

Planibly is a zero-cost, private, offline-first personal planning PWA. This repository currently
implements the installable Phase 0 foundation and the Phase 1 task-management system through
**Phase 1C**. This includes organisation, optional task details, projects, local search, useful smart
lists, recovery, and session undo. Planning and later product phases remain intentionally out of
scope.

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

There is no backend, account, analytics, external AI, paid service, or native iOS integration.

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
[Docs/phase-1c-architecture.md](Docs/phase-1c-architecture.md) for the current architecture, data
invariants, and manual device checks.
