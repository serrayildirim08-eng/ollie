# ollie

Life operating system for ADHD brains. Monorepo migrated from the single-file `void-app.html` codebase.

## Structure

```
ollie/
├── apps/
│   └── web/          React app (Vite + TS)
└── packages/
    ├── store/        localStorage wrapper + reactive subs
    ├── events/       typed event bus
    ├── logic/        pure functional core
    └── orchestrator/ reactive glue
```

More packages (`router`, `crypto`, `backup`, `sync`) and apps (`api`, `desktop`, `ios`) get added as the migration progresses.

## Dev

```bash
pnpm install
pnpm dev
```

## Migration status

Phase 1 — workspace scaffolded. See task list for remaining phases.
