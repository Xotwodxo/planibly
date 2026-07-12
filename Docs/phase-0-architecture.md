# Phase 0 architecture

## Boundary

Phase 0 provides an installable, responsive, offline application shell and engineering foundation.
The five product destinations are routes with honest orientation copy only. They do not contain
mock data, disabled facsimiles of native behavior, or Phase 1 task functionality.

The repository, PWA manifest, local database, and visible shell use Planibly while preserving the
supplied visual direction and capability constraints.

## Application shell

`AppShell` owns the semantic header, main landmark, skip link, and primary navigation. CSS switches
from a safe-area-aware five-item bottom bar to a persistent side rail at 48rem. Each layout uses the
same route definitions, and inactive navigation remains keyboard and screen-reader accessible.

## Local storage and migrations

`PlaniblyDatabase` is the only IndexedDB entry point. Schema definitions are registered from the
ordered `schemaVersions` collection. Version 1 contains only foundation data:

- `metadata` records the application and schema version.
- `diagnostics` stores a bounded set of local technical errors.

Future phases must append a new version and deterministic upgrade function rather than alter a
released version. Migration tests should create the previous schema, seed representative data, open
with the new class, and assert both preservation and transformation.

## Offline strategy

Vite PWA generates a Workbox service worker during production builds. The versioned shell is
precached. Same-origin static assets use cache-first behavior. Navigations use network-first behavior
with a short timeout and cached application-shell fallback. Obsolete caches are cleaned on
activation. No user data enters Cache Storage.

Updates are prompt-based, never automatic. Phase 0 has no data-entry forms; future form work must
add a shared dirty-state guard before permitting a service-worker-triggered reload.

## Diagnostics and privacy

The React boundary catches rendering failures, shows a plain recovery screen, and records diagnostic
details in IndexedDB. Global errors and rejected promises use the same logger. Records are capped at
200 and never leave the browser. There are no external scripts, tracking endpoints, credentials, or
backend calls. A restrictive content security policy permits same-origin resources and development
WebSockets only.

## Manual acceptance before Phase 1

Automated browser checks cannot replace these device checks:

1. Serve the production build over HTTPS at a reachable URL.
2. Open it in iPhone Safari, confirm the icon and name in Add to Home Screen, and install it.
3. Launch from the Home Screen and confirm standalone display and safe-area spacing.
4. Load each navigation destination once, enable airplane mode, close and reopen the installed PWA,
   and confirm the shell still loads and routes remain navigable.
5. Repeat the installed-layout check on iPad in portrait and landscape.
6. Check light/dark appearance, larger text, keyboard focus on desktop, and VoiceOver navigation on
   iPhone.

Portrait-primary is retained from the supplied manifest requirement. iPad landscape behavior must be
confirmed manually; if the installed PWA is constrained by a target browser, change orientation to
`any` before progressing.
