# @ollie/desktop

Electron shell for the ollie web app.

## Dev

```bash
# terminal 1 — vite dev server
pnpm --filter @ollie/web dev

# terminal 2 — electron (loads localhost:5173)
pnpm --filter @ollie/desktop dev
```

Or from the repo root: `pnpm electron:dev`

## Build (prod)

Build the web app first, then package:

```bash
pnpm --filter @ollie/web build        # outputs apps/web/dist/
pnpm --filter @ollie/desktop build:mac
# or: build:win / build:linux / build:all
```

From root: `pnpm electron:build:mac` etc.

Output lands in `apps/desktop/dist-electron/`.
