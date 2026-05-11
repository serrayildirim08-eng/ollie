# @ollie/ios — Capacitor iOS shell

Wraps the Vite-built web app from `apps/web/dist/` in a native iOS WKWebView via Capacitor.

## Prerequisites

- macOS with Xcode installed (`xcode-select --install`)
- Node ≥ 20, pnpm ≥ 11
- Capacitor CLI available (`pnpm exec cap`)

## First-time initialization

Run once after cloning (requires Xcode + iOS SDK):

```bash
pnpm --filter @ollie/ios add
```

This runs `cap add ios` and generates the `ios/` native project directory.

## Build + sync

```bash
pnpm --filter @ollie/ios build
```

Builds the web app, copies `apps/web/dist/` into `apps/ios/www/`, then syncs into the native project.

Or from the monorepo root:

```bash
pnpm ios:sync
```

## Open in Xcode

```bash
pnpm ios:open
# or from root:
pnpm ios:open
```

## Run on simulator

```bash
pnpm ios:run
```

Capacitor will prompt for a target simulator. Or pass a specific device:

```bash
pnpm --filter @ollie/ios run -- --target "iPhone 16"
```

## webDir

`capacitor.config.json` points at `./www`. The `build` script populates it from `../web/dist/` before calling `cap sync`.
