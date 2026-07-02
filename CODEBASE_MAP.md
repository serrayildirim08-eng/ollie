# CODEBASE_MAP.md

Fact sheet of `~/ollie/` as it stands today. Structural facts verifiable
against the repo. Precise LOC/test counts are intentionally omitted (they
drift daily) — run `pnpm -r test` / `cloc` for exact numbers.

**Snapshot:** 2026-07-02 · branch `redesign/olive-neumorphic` (active).

> Prior snapshots of this file (dated 2026-05-11) described a now-DELETED
> `apps/web` + Electron + Capacitor architecture and wrongly claimed no
> encryption/sync existed. That was all superseded by the Tauri rewrite.
> The map below is the current reality.

---

## 1. STRUCTURE

```
ollie/
├── apps/
│   ├── native/      Tauri + React 18 + TS (Vite) — iOS + macOS app
│   │   ├── src/         React frontend
│   │   └── src-tauri/   Rust shell (tauri.conf.json + iOS/macOS config)
│   └── api/         Cloudflare Worker (@ollie/api-worker → ollie-notifications)
├── workers/
│   ├── ai-proxy/      dump router / brain    → ollie-ai-proxy
│   ├── apns-push/     APNs send              → ollie-apns-push
│   ├── cron/          scheduled jobs         → ollie-cron
│   └── sentry-tunnel/ Sentry ingest tunnel   → ollie-sentry-tunnel
├── packages/        @ollie/* workspace libraries (16 dirs)
├── supabase/        SQL migrations + rollbacks + seed
└── tools/           eslint-plugin-ollie + banned-phrase scanners
```

### Root files

| File | Purpose |
|---|---|
| `package.json` | pnpm workspace root. Scripts: `dev`/`tauri:dev` (→ `pnpm --filter native tauri dev`), `build`/`tauri:build`, `typecheck`, `lint`, `test`, banned-phrase scanners. `packageManager: pnpm@11.0.9`. |
| `pnpm-workspace.yaml` | globs `apps/*`, `packages/*`, `workers/*`. |
| `tsconfig.base.json` | shared TS config. |
| `eslint.config.mjs` | flat config; uses the local `tools/eslint-plugin-ollie`. |
| `README.md` | architecture + dev/build/deploy commands. |

---

## 2. NATIVE APP (`apps/native`)

- Tauri shell in `src-tauri/` (Rust). `tauri.conf.json`: `productName "Ollie"`,
  macOS identifier `com.ollie.app`, `frontendDist ../dist`, `devUrl
  http://localhost:1420`. iOS override (`tauri.ios.conf.json`): bundle id
  `app.ollie.ollie`.
- Frontend (`src/`) top-level dirs: `dump`, `modules`, `rooms`, `navigation`,
  `router`, `sync`, `storage`, `store.ts`, `bridge`, `patterns`, `notify`,
  `todo`, `snapshot`, `settings`, `theme`, `layout`, `ui`, `auth`, `api`,
  `lib`.
- Frontend deps of note: `@clerk/clerk-react`, `@supabase/supabase-js`,
  `react-router`, `@tauri-apps/plugin-{sql,store,notification,deep-link}`,
  `tauri-plugin-mobile-push-api`, and workspace `@ollie/{api,cadence,crypto,
  logic,notifications,orchestrator,store}`.

### Module UI (`src/modules/`)

Logic-backed module folders: `admin`, `body`, `brain`, `chores`, `cycle`,
`dump`, `finance`, `goals`, `grocery`, `habits`, `medication`, `mood`,
`partner`, `pets`, `sleep`, `work`. Routing entry is `modules/dispatch.ts`.

### Rooms (`src/rooms/`)

Modules are grouped into rooms: `HealthRoom`, `HouseholdRoom`, `MoneyRoom`,
`ResponsibilitiesRoom` (pets and partner surfaced alongside). Route label
"Rooms" at `navigation/routes.ts`.

### Brain-dump flow

`src/dump/` (BrainDumpInput, DumpScreen, MicButton, PhotoIntake,
NeedsConfirmCard, DumpReceipt, crisisCopy, mood-lexicon, …). A dump is sent
to the `ai-proxy` worker (`/route/dump`); the classified result is applied
locally by module logic (deterministic — Layer 2).

---

## 3. WORKERS

| Dir | pkg name | wrangler `name` | Role |
|---|---|---|---|
| `workers/ai-proxy` | `@ollie/worker-ai-proxy` | `ollie-ai-proxy` (+ `-staging`) | Dump router / brain + AI enrichment. Routes below. Uses Groq, Gemini, OpenRouter, Cloudflare Workers AI, Voyage embeddings; Clerk JWT verify; rate-limit + budget guards; PII scrub. |
| `workers/apns-push` | `@ollie/worker-apns-push` | `ollie-apns-push` | APNs push send. |
| `workers/cron` | `@ollie/worker-cron` | `ollie-cron` | Scheduled/background jobs. |
| `workers/sentry-tunnel` | `@ollie/worker-sentry-tunnel` | `ollie-sentry-tunnel` | Sentry ingest tunnel (DPI bypass). |
| `apps/api` | `@ollie/api-worker` | `ollie-notifications` | `src/worker.ts` (APNs token register/send) + `src/account-delete.ts`. |

### ai-proxy routes (`workers/ai-proxy/src/index.ts`)

`/route/dump`, `/enrich-dump`, `/ingest-event`, `/label`, `/brain-copy`,
`/grocery/purchase`, `/cook-history`, `/shelf-life/all`, `/shelf-life/lookup`,
`/sync/grocery-pantry`, `/apply-inbox`, `/transcribe`, `/generate-invite`,
`/validate-invite`, `/claim-invite` (plus `/brain-dump`, `/v1/messages`
compatibility paths).

---

## 4. PACKAGES (`packages/`, all `@ollie/*`)

| Dir | Role |
|---|---|
| `logic` | Pure functional module cores. Subpath exports: `util, cycle, pets, grocery, finance, habits, sleep, work, body, goals, admin, journal, patterns, crisis, dissection, burhan, medication, brain`. |
| `orchestrator` | Reactive glue wiring logic ↔ store ↔ events. |
| `store` | Local state store facade + reactive subscriptions. |
| `sync` | Encrypted state sync to Supabase `encrypted_state` (`src/index.ts` pull-on-boot + batched upsert via `@ollie/api`; plus `finance.ts`, `retry.ts`). |
| `crypto` | `src/index.ts` — AES-GCM-256 + PBKDF2 (600k iters, legacy 100k still decrypts) primitives: `deriveKey`, `encryptData`, `decryptData`, salt/iv, base64/pg-hex codecs, `passphraseStrength`. |
| `api` | Client for the API worker + Supabase REST. |
| `auth` | Auth helpers (Clerk). |
| `events` | Typed event bus. |
| `consent` | Consent state (necessary + marketing toggles). |
| `pii-scrub` | PII scrub before data reaches AI / research stream. |
| `crisis-lexicon` | Multilingual crisis lexicon (EN/ES/TR). |
| `cadence` | Reminder/notification cadence logic. |
| `notifications` | Notification spec + delivery types. |
| `apns-jwt` | ES256-signed APNs JWT generation. |
| `worker-http` | Shared HTTP helpers for the workers. |
| `research-stream` | Opt-in anonymized event stream. |

---

## 5. STORAGE / SYNC / ENCRYPTION

- **Local:** native app uses `@ollie/store` + Tauri SQL/store plugins.
- **Remote:** Supabase Postgres. Per-user module state is stored **encrypted**
  in `encrypted_state` — the client encrypts with `@ollie/crypto`
  (AES-GCM-256) and `@ollie/sync` upserts ciphertext through `@ollie/api`.
  The server never sees plaintext module data.
- **Migrations:** `supabase/migrations/` (~44 forward `.sql`, each with a
  sibling rollback in `supabase/rollbacks/` / `.down.sql`). See
  `DATA_SCHEMA.md`.

---

## 6. AUTH

Clerk. The native app uses `@clerk/clerk-react`; workers verify Clerk-issued
JWTs (`workers/ai-proxy/src/clerk-verify.ts`).

---

## Appendix · git state

Branch `redesign/olive-neumorphic`, 300+ commits on the history. Head SHA
moves (active branch) — check `git rev-parse HEAD` for the exact commit.
