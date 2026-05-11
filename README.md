# ollie

Life operating system for ADHD brains. Monorepo migrated from the single-file `void-app.html` codebase.

## Structure

```
ollie/
├── apps/
│   ├── web/          React 18 + Vite + TypeScript — the app
│   ├── desktop/      Electron wrapper (loads apps/web/dist)
│   └── ios/          Capacitor iOS shell (loads apps/web/dist)
└── packages/
    ├── store/        localStorage wrapper + reactive subs + migrations
    ├── events/       typed event bus (102 registered events)
    ├── logic/        pure functional core — 19 sub-namespaces:
    │                 cycle, products, corrections, ritual, patterns,
    │                 prompts, consumption, finance, pets, admin, work,
    │                 grocery, sleep, predict, body, habits, goals,
    │                 journal, astrology, dissection
    └── orchestrator/ reactive glue (cycle, pets, body, grocery, sleep,
                      finance, patterns wired)
```

## Dev

```bash
pnpm install
pnpm dev                 # web (Vite at localhost:5173)
pnpm electron:dev        # desktop (Electron, after a `pnpm build`)
pnpm ios:open            # iOS (Capacitor, after `xcode-select --install`)
```

## Test

```bash
pnpm -r test             # all packages, vitest
pnpm -r typecheck        # all packages, tsc --noEmit
pnpm build               # production web build
```

## Migration status

Phase 1–7 complete. The single-file `void-app.html` (47k lines) has been
ported to this monorepo with 815+ passing tests. The legacy repo lives at
`~/void` as a historical fallback.

Native shells in `apps/desktop` and `apps/ios` are scaffolded; both load
`apps/web/dist/`. Run `pnpm --filter @ollie/ios add` once Xcode is set up
to initialize the iOS project.

## Outstanding follow-ups

- Bundle code-splitting (Vite chunk-size warning above 500KB)
- Real backend (NestJS + Postgres + accounts) — separate track
- E2E tests across the full screen state machine
- Live deploy of the Cloudflare Worker telemetry pipe (see ~/void/D1_TELEMETRY_TODO.md)
