# Planibly

Planibly is a zero-cost, private, offline-first personal planning PWA. This repository currently
implements **Phase 0 only**: the installable application foundation. Task management and all other
product features remain intentionally out of scope until Phase 1 or later.

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

`verify:pwa` inspects `dist/`, so run the production build first. Playwright starts a production
preview and verifies the manifest, responsive navigation, and offline reload behavior.

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

The static output is written to `dist/`. It can be hosted on a free static host. The current router
uses clean history URLs, so a host must rewrite unknown routes to `index.html`. If GitHub Pages is
selected later, its SPA fallback/base-path behavior must be configured at deployment time.

## Architecture boundaries

- IndexedDB is the future source of truth. In-memory state is never intended to replace it.
- HTTP caches contain only the versioned application shell and static assets, never personal data.
- Diagnostics are capped, stored locally, and never transmitted.
- Add future Dexie schemas sequentially in `src/data/database.ts`; never rewrite a released schema.
- The service-worker update prompt requires explicit user action. Future forms must integrate an
  unsaved-change guard before accepting an update.

See [docs/phase-0-architecture.md](docs/phase-0-architecture.md) for further decisions and the
manual device checks required before Phase 1.
