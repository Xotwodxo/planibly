# Repository conventions

## Scope

Read `Docs/planibly-pwa-product-specification.md` before product work and follow its phased roadmap.
The current boundary is Phase 3C: local ICS import, export, provenance, and device-calendar file
handoff. Do not add live provider sync, OAuth, CalDAV, reminders, timelines, drag scheduling, automatic scheduling,
shopping-specific behavior, productivity scoring, or insights until explicitly begun.

Planibly must remain free, private, local-first, and useful without a backend. Do not add accounts,
analytics, advertising, paid services, external AI, native iOS claims, or silent network reporting.

## Implementation conventions

- Keep TypeScript strict; do not use `any` or suppress errors without a documented reason.
- Use semantic HTML first, labelled interactions, visible focus, and 44×44 CSS-pixel targets.
- Preserve keyboard operation, reduced-motion support, and light/dark contrast.
- Prefer the existing component foundations and CSS tokens over a UI framework.
- Store future primary data in Dexie/IndexedDB. Do not use HTTP caches for personal data.
- Add Dexie schema versions sequentially. Never change the store definition of a released version;
  add a deterministic migration instead and test upgrades from the prior version.
- Keep diagnostics local, bounded, and free of secrets or unnecessary personal content.
- Treat generated `dist/`, Playwright reports, and test results as disposable build artifacts.
- Add or update tests with every behavior change.

## Required verification

From the repository root on this Windows environment:

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:pwa
npm.cmd run test:e2e
```

Run `npx.cmd playwright install chromium` once if the Playwright browser is unavailable. Report each
command and its result. Never claim success while a required check is failing.

## Documentation

Update `README.md` when setup, scripts, browser requirements, or architecture boundaries change.
Record material architectural decisions in `docs/`. Keep the product specification unchanged unless
the user explicitly requests a specification edit.
