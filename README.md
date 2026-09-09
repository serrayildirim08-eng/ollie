# ollie

Life operating system for ADHD brains. You brain-dump in one box; Ollie
classifies the dump and updates the right life module (grocery, finance,
cycle, work, meds, …), then quietly surfaces what matters.

Mobile + desktop only — **there is no public web app.** (Do not deploy the
frontend to Pages or anywhere public.)

## Architecture

Two layers, by design (the "Brain vs. Body" split):

- **Layer 1 — the Brain (`workers/ai-proxy`).** A Cloudflare Worker that
  routes a raw brain-dump (`POST /route/dump`) and enriches events. It
  classifies with a tiered LLM stack (Groq, Google Gemini, OpenRouter,
  Cloudflare Workers AI) plus Voyage embeddings for caching. Deployed as
  `ollie-ai-proxy`. It also serves grocery/recipe/shelf-life, transcription,
  and invite endpoints.
- **Layer 2 — the Body (the native app).** Deterministic module logic that
  applies routed results locally and watches for patterns. No LLM decides
  state transitions, retries, or scheduling.

### Components

| Component | What it is | Where |
|---|---|---|
| Native app | Tauri (Rust `src-tauri`) shell hosting a React 18 + TypeScript + Vite frontend in a WKWebView. Ships to **iOS** and **macOS**. | `apps/native` |
| `ai-proxy` worker | Dump router / "brain" + AI enrichment. Deployed `ollie-ai-proxy`. | `workers/ai-proxy` |
| `apns-push` worker | Apple Push Notification send path. Deployed `ollie-apns-push`. | `workers/apns-push` |
| `cron` worker | Scheduled/background jobs. Deployed `ollie-cron`. | `workers/cron` |
| `sentry-tunnel` worker | Sentry ingest tunnel (bypasses DPI that blocks Sentry). Deployed `ollie-sentry-tunnel`. | `workers/sentry-tunnel` |
| API worker | APNs token register/send + account deletion. Deployed `ollie-notifications`. | `apps/api` |
| Supabase | Postgres backing store. Per-user state is stored **encrypted** in `encrypted_state` (AES-GCM-256, PBKDF2 passphrase-derived). | `supabase/` |
| Clerk | Auth. Workers verify Clerk-issued JWTs. | — |

State sync: the native app encrypts each module's state client-side
(`@ollie/crypto`) and syncs it to Supabase `encrypted_state` via the API
worker (`@ollie/sync`). The server never sees plaintext module data.

### Repo layout

```
ollie/
├── apps/
│   ├── native/        Tauri + React + TS app (iOS + macOS)
│   │   ├── src/       React frontend (dump, modules, rooms, sync, …)
│   │   └── src-tauri/ Rust shell (tauri.conf.json, iOS/macOS config)
│   └── api/           Cloudflare Worker: APNs + account-delete (ollie-notifications)
├── workers/
│   ├── ai-proxy/      dump router / brain (ollie-ai-proxy)
│   ├── apns-push/     APNs send (ollie-apns-push)
│   ├── cron/          scheduled jobs (ollie-cron)
│   └── sentry-tunnel/ Sentry tunnel (ollie-sentry-tunnel)
├── packages/          @ollie/* workspace libraries (see below)
├── supabase/          SQL migrations + rollbacks
└── tools/             lint plugins + banned-phrase scanners
```

### `@ollie/*` packages

| Package | Purpose |
|---|---|
| `logic` | Pure functional module cores (cycle, pets, grocery, finance, habits, sleep, work, body, goals, admin, journal, patterns, crisis, medication, brain, …). Subpath exports per module. |
| `orchestrator` | Reactive glue that wires module logic to the store/events. |
| `store` | Local state store facade + reactive subscriptions. |
| `sync` | Encrypted state sync to Supabase `encrypted_state` (pull-on-boot, batched upsert). |
| `crypto` | AES-GCM-256 + PBKDF2 (600k iters) passphrase-derived encryption primitives. |
| `api` | Client for the API worker / Supabase REST. |
| `auth` | Auth helpers (Clerk). |
| `events` | Typed event bus. |
| `consent` | Consent state (necessary + marketing). |
| `pii-scrub` | PII scrubbing before data reaches the AI / research stream. |
| `crisis-lexicon` | Multilingual crisis-detection lexicon (EN/ES/TR). |
| `cadence` | Reminder/notification cadence logic. |
| `notifications` | Notification spec + delivery types. |
| `apns-jwt` | ES256-signed APNs JWT generation. |
| `worker-http` | Shared HTTP helpers for the Cloudflare Workers. |
| `research-stream` | Opt-in anonymized event stream. |

## Dev

```bash
pnpm install

# Native app (desktop dev via Tauri — the default `pnpm dev`)
pnpm dev                                   # == pnpm --filter native tauri dev
pnpm --filter native dev                   # frontend only (Vite, no shell)

# Workers (each is its own package)
pnpm --filter @ollie/worker-ai-proxy dev   # wrangler dev
```

## Build

```bash
# Desktop (macOS)
pnpm --filter native tauri build

# iOS — build the installable app (serves bundled dist over localhost)
pnpm --filter native tauri ios build       # NOT `ios dev` (dev = white screen)
```

## Test / check

```bash
pnpm -r test         # vitest across all packages (pretest runs banned-phrase scans)
pnpm -r typecheck    # tsc --noEmit across all packages
pnpm lint            # eslint (custom @ollie eslint plugin in tools/)
```

## Deploy

```bash
# Each worker deploys independently with Wrangler
pnpm --filter @ollie/worker-ai-proxy deploy      # -> ollie-ai-proxy
pnpm --filter @ollie/worker-apns-push deploy     # -> ollie-apns-push
pnpm --filter @ollie/worker-cron deploy          # -> ollie-cron
pnpm --filter @ollie/worker-sentry-tunnel deploy # -> ollie-sentry-tunnel
pnpm --filter @ollie/api-worker deploy           # -> ollie-notifications
```

See `DEPLOY_TODO.md` for secrets and one-time deploy steps.
