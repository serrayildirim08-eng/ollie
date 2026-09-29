# Ollie

A life operating system for ADHD brains. The user writes (or speaks, or photographs) everything
into one brain-dump box. Ollie splits the dump into fragments, classifies each fragment, and
updates the right life module: grocery, finance, cycle, work, medication, sleep and others.

Ollie is a native app for iOS and macOS. **There is no public web app**, and the frontend must not
be deployed to Pages or any other public host.

The design rule: **the model judges, code decides.** The model does routing, content and
interpretation. Deterministic code handles state transitions, retries, scheduling and persistence.

---

## Architecture

```
┌──────────────────── Native app: Tauri 2 (iOS / macOS) ─────────────────────┐
│  React 19 + TypeScript + Vite frontend (apps/native/src)                   │
│                                                                            │
│  brain-dump box ──► dispatch (idempotency_key) ──► module logic            │
│                                                   (@ollie/logic, pure)     │
│                                                                            │
│  Rust shell (src-tauri): SQLCipher whole-DB encryption,                    │
│  key in OS Keychain, never crosses IPC to JS                               │
└──────┬──────────────────────────────┬──────────────────────────┬───────────┘
       │ HTTPS, Clerk JWT             │ encrypted_state          │ APNs register
       ▼                              │ (AES-GCM, client-side)   ▼
┌──── workers/ai-proxy (Layer 1) ─────┐        │      ┌── apps/api ───────────────┐
│ POST /route/dump                    │        │      │ ollie-notifications       │
│  PII scrub → segment → crisis check │        │      │ APNs token register/send  │
│  → Voyage embed → Vectorize cache   │        │      │ scheduled push w/ backoff │
│  → LLM cascade → confidence policy  │        │      │ /account/delete           │
│ POST /route/:module (Layer 2)       │        │      └───────────────────────────┘
│  pgvector routing_cache → LLM       │        ▼
│ Clerk JWT · rate limit · AI budget  │   ┌─────────── Supabase Postgres ───────────┐
└──────┬──────────────────────────────┘   │ encrypted_state · routing_cache (pgvector)│
       │ KV queue                         │ telemetry tables (user_hash)            │
       ▼                                  │ consent_audit (service_role only)       │
┌──── workers/cron ───────────────┐       └─────────────────────────────────────────┘
│ enrich drain · retries · DLQ    │
└─────────────────────────────────┘
```

| Layer          | Technology                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| App            | Tauri 2 (Rust), React ^19.1.0, TypeScript ~5.8, Vite ^7 (`apps/native`)                                                                         |
| Local storage  | SQLite via `tauri-plugin-sql`, forced to SQLCipher by `rusqlite` with `bundled-sqlcipher-vendored-openssl` (`apps/native/src-tauri/Cargo.toml`) |
| Identity       | Clerk; workers verify JWTs with `jose` against the Clerk JWKS                                                                                   |
| Edge           | Cloudflare Workers, KV, Vectorize, Workers AI, native Rate Limiting                                                                             |
| Server data    | Supabase Postgres with pgvector                                                                                                                 |
| Embeddings     | Voyage `voyage-multilingual-2` (1024 dimensions)                                                                                                |
| Classification | Groq `openai/gpt-oss-120b`, with Workers AI, Gemini and OpenRouter as fallbacks (see below)                                                     |
| Monorepo       | pnpm workspaces, 16 `@ollie/*` packages, Vitest, ESLint                                                                                         |

### Components

| Component               | Deployed as           | Role                                                                                |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `apps/native`           | iOS / macOS app       | Tauri shell + React frontend; local module state and logic                          |
| `workers/ai-proxy`      | `ollie-ai-proxy`      | Layer 1 dump router, Layer 2 per-module routing, enrichment, transcription, invites |
| `workers/cron`          | `ollie-cron`          | Scheduled jobs (`0 3 * * *`, `*/5 * * * *`) and the enrich queue drain              |
| `workers/apns-push`     | `ollie-apns-push`     | APNs send path                                                                      |
| `workers/sentry-tunnel` | `ollie-sentry-tunnel` | Sentry ingest tunnel                                                                |
| `apps/api`              | `ollie-notifications` | APNs token register/send, scheduled push jobs, account deletion                     |

---

## Data protection

### On the device

The local database is encrypted as a whole with SQLCipher (`apps/native/src-tauri/src/secure_db.rs`).

- A 32-byte random key is generated once with `getrandom` and stored in the OS Keychain
  (service `app.ollie.ollie`, account `db-key`) through the `keyring` crate. It is never written to a
  file.
- `tauri-plugin-sql` opens a pool of connections with no per-connection key hook, so the key is
  applied at the C layer: a `sqlite3_auto_extension` callback runs `PRAGMA key` on every connection
  SQLite opens. The key lives only in Rust and never crosses IPC to JavaScript.
- **Fail-closed.** If no key is available, the callback returns `SQLITE_ERROR` instead of opening
  the database unencrypted. At startup, `PRAGMA cipher_version` must return a value on an in-memory
  connection. If Cargo feature unification ever links vanilla SQLite, the app refuses to start.
- An existing plaintext database is migrated once. The code exports an encrypted copy, checks that
  the copy is readable with the key, and swaps it in. The plaintext backup is deleted only after a
  second check passes; if any step fails, the backup is kept for rollback. A marker file stops the
  migration from running twice.

The key-handling path is built for Apple platforms (`keyring` with `apple-native`).

### Sync

Module state is encrypted on the client before upload (`@ollie/crypto`, `@ollie/sync`):

- AES-GCM-256 with a fresh random 12-byte IV per payload.
- The key comes from PBKDF2-SHA256 with 600,000 iterations over a 16-byte random salt. Payloads
  created with the old 100,000-iteration count still decrypt, using the count stored with each
  payload.
- `@ollie/sync` sends one ciphertext blob per module to `encrypted_state`, and finance records
  one per record. Module fields are inside the ciphertext; the server never receives them in
  plaintext.

### On the server

The server-apply path (`workers/ai-proxy/src/router/server-apply.ts`) is a pilot and is off unless
`SERVER_APPLY_ENABLED` is set. It stores routed fragments with envelope encryption
(`workers/ai-proxy/src/crypto/envelope.ts`):

- A random AES-GCM-256 data key (DEK) encrypts each record. The DEK is wrapped by a key-encryption
  key held only as the `ENVELOPE_KEK` worker secret. Postgres stores ciphertext, IV, wrapped DEK and
  DEK IV.
- The KEK can be rotated by re-wrapping DEKs, without touching the ciphertext.
- Every decrypt writes a structured log line with the user, the record and a timestamp.

### What third-party models see

Dump text is scrubbed before it is segmented, embedded or classified by an external model
(`@ollie/pii-scrub`, called in `workers/ai-proxy/src/router/dump.ts`). The scrubber runs its layers
in a fixed order:

1. Sensitive content: `MENTAL_HEALTH` first, then `MEDICAL`, `MEDICATION`, `SEXUAL`.
2. Regex: URLs, emails, GPS coordinates, postal addresses, phone numbers (US / TR / NL / ES).
3. Numeric: runs of 4 or more digits that look like account or ID numbers. Money amounts are kept.
4. Per-locale first- and last-name wordlists, replaced with `[NAME]`. Known brand names are
   allowlisted.

The raw text goes back only to the client that sent it. When a photo is attached, Gemini describes
it first and the scrubber then runs on the combined text. Layer-2 `/route/:module` receives one
fragment and skips layer 1, because it has to extract domain terms such as a
symptom or a medication name.

### Telemetry

- The user identifier is `SHA-256(USER_HASH_SALT + ":" + Clerk userId)`, computed by the worker
  from the verified token (`workers/ai-proxy/src/telemetry.ts`). Any `user_hash` sent by the client
  is ignored.
- Telemetry inserts accept only an allowlist of tables and columns.
- Cycle-module dumps from US users are dropped at intake.
- Request bodies are not logged. The dump router logs lengths and structure, never text.
- `consent_audit` has row-level security forced on. `anon` and `authenticated` have no access, and
  only the service role writes to it (`supabase/migrations/20260514000007_*.sql`).

### Account deletion

`POST /account/delete` (`apps/api/src/account-delete.ts`) verifies the JWT and requires
`{ "confirm": "DELETE" }`. It then deletes every row belonging to the user, table by table, using the
right key for each table: Clerk id, derived hash, or both. The identity record is deleted last. If
`USER_HASH_SALT` is missing, the endpoint returns 503. It will not report success while leaving
hash-keyed rows behind. A failure partway through returns 500 and keeps the identity, so the request
can safely be retried.

---

## Deterministic core, probabilistic edge

LLM output is untrusted input to deterministic code.

### The dump pipeline (`/route/dump`)

1. **Idempotent replay.** The client sends a `dumpId`. If a result for `(userId, dumpId)` is in KV,
   the worker returns it unchanged with `x-ollie-idempotent-replay: 1` and makes no model call or
   cache write. Records expire after 1 hour.
2. **PII scrub** of the whole dump (see above).
3. **Segmentation.** Pass 1 is deterministic (`Intl.Segmenter` plus a trilingual conjunction
   overlay). Pass 2 is an LLM split that runs only for weakly punctuated or code-switched fragments,
   and its output is never cached.
4. **Crisis short-circuit.** `detectCrisis` (`@ollie/crisis-lexicon`: EN / TR / ES lexicons) runs on
   the whole dump before any embedding or classification. On a match the response carries only the
   crisis signal with an empty `originalDump`. Nothing is embedded, cached, logged as text, or
   written to the inbox. The signal carries lexicon coordinates (tier, language, pattern id), not the
   matched text.
5. **Semantic classification cache.** Each fragment is embedded, and Cloudflare Vectorize is queried
   in the user's own namespace (`topK: 1`). A match at cosine similarity ≥ 0.85 reuses that user's
   earlier classification and skips the LLM. This is a classification cache, not retrieval: nothing
   is added to a prompt. Two things keep a hit safe. It only matches the same user's earlier inputs,
   and a relative time is recalculated from the current time on every hit (`injectScheduledAt`).
6. **Classification** of the cache misses in one batched call through the JSON cascade.
7. **Output validation.** Hand-written guards, not a schema library:
   - `coerceModule` checks the returned module against the `MODULES` registry
     (`workers/ai-proxy/src/router/dump-schema.ts`). An unknown module becomes `dump_only`, so the
     text is kept and not lost.
   - A non-numeric or missing confidence becomes 0.60, so the fragment is shown for confirmation
     instead of being demoted.
   - `tests/module-registry.test.ts` fails CI if `MODULES` and the `routing_cache.module` SQL CHECK
     constraint drift apart.
8. **Confidence policy** (`applyConfidencePolicy`):

   | Confidence | Result                                                               |
   | ---------- | -------------------------------------------------------------------- |
   | ≥ 0.80     | routed silently                                                      |
   | 0.60–0.79  | routed, `needsConfirm: true` (edit affordance on the card)           |
   | < 0.60     | demoted to `dump_only`; the original guess and any reminder are kept |

### Provider cascade

`workers/ai-proxy/src/router/json-cascade.ts` sends segmentation and classification through the
same ordered list:

```
Groq openai/gpt-oss-120b
  → Workers AI @cf/meta/llama-3.3-70b-instruct-fp8-fast
  → Gemini gemini-2.5-flash
  → OpenRouter meta-llama/llama-3.3-70b-instruct:free
```

A provider is skipped when it throws, or when the caller's parse callback rejects its output. Only
the last provider's error is returned.

Other model calls:

| Model                                                                                         | Used for              |
| --------------------------------------------------------------------------------------------- | --------------------- |
| Groq `llama-3.1-8b-instant`, escalating to `openai/gpt-oss-120b` below a per-module threshold | Layer 2 module routes |
| Anthropic `claude-sonnet-4-6`                                                                 | `/label`              |
| Anthropic `claude-haiku-4-5`                                                                  | cron enrich drain     |
| Groq `whisper-large-v3-turbo`                                                                 | transcription         |
| Gemini `gemini-2.5-flash`                                                                     | image description     |

### Layer 2 (`/route/:module`)

Layer 2 runs per module. It scrubs identity, embeds the fragment, and looks it up in Postgres
`routing_cache`: a `vector(1024)` column with an HNSW `vector_cosine_ops` index
(`supabase/migrations/20260521000001_routing_cache.sql`). The `routing_cache_lookup` RPC filters
by `user_hash` and module before ordering by `<=>` distance
(`supabase/migrations/20260701000003_routing_cache_per_user.sql`). Rows written before the per-user
migration have a NULL hash and never match. `/feed-me` uses the same RPC. Both use a 0.85 similarity
threshold.

### Retries and dead letters

| Path                | Behavior                                                                                                                   | Source                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Enrich queue drain  | Retries up to 12 times (about 1 hour), then copies the payload to `dlq:enrich:<id>`                                        | `workers/cron/src/drain.ts`  |
| Scheduled push jobs | Exponential backoff of `2^attempt` minutes; after 5 attempts the job is marked `failed`; permanent errors fail immediately | `apps/api/src/worker.ts`     |
| Server-apply inbox  | A row that fails to apply is marked `status: 'failed'`, not dropped                                                        | `server-apply.ts`            |
| Client sync         | Exponential backoff with a cap on attempts                                                                                 | `packages/sync/src/retry.ts` |

### Idempotency

- `/route/dump` replays by `dumpId` (above). Inbox writes are keyed on `${dumpId}:idx`.
- The native dispatcher tags every submitted dump event with `idempotency_key`
  (`apps/native/src/modules/dispatch.ts`).
- Local detectors write with `INSERT OR IGNORE` on stable primary keys
  (`apps/native/src/modules/brain/`), so detecting the same event twice counts once.
- The enriched-dump write upserts on its primary key. Account deletion is idempotent, and a 404
  counts as already deleted.

### Observability

Every Groq call writes one structured line:

```json
{
  "metric": "ai_call",
  "label": "…",
  "model": "…",
  "latency_ms": 0,
  "input_tokens": 0,
  "output_tokens": 0,
  "cost_usd": 0
}
```

Watch it with `wrangler tail ollie-ai-proxy`. Envelope decrypts are logged as described above.

---

## Security

- **Authentication.** Clerk JWTs are verified with `jose` (`createRemoteJWKSet` + `jwtVerify`)
  against the issuer's JWKS, with an issuer check (`workers/ai-proxy/src/clerk-verify.ts`). On
  `/route/:module`, auth is enforced whenever `ENVIRONMENT` is `production`, even if the dev flag is
  set wrong.
- **Rate limiting.** Cloudflare native Rate Limiting bindings (`AI_RATE_LIMITER`,
  `TELEM_RATE_LIMITER`: 10 requests / 60 s). A KV fixed-window counter takes over when a binding is
  missing (`workers/ai-proxy/src/rate-limit.ts`).
- **Cost ceiling.** A global daily AI call budget (`GLOBAL_DAILY_AI_MAX`, 20,000 by default)
  returns `429 budget_exhausted` once reached (`workers/ai-proxy/src/budget.ts`).
- **CORS.** The worker echoes the request origin only if it is on the allowlist:
  `http://localhost:9527` (the app), `http://localhost:1420` (Vite dev), `tauri://localhost`. It never
  sends `*`.
- **Request bounds.** Content-length checks return `413` on oversized payloads
  (`@ollie/worker-http`).
- **Secrets** are set with `wrangler secret put` and never committed.
- **Dependencies.** Dependabot security updates.

---

## Testing

Vitest. There are more than 200 test files across the workspace: the native app, the `@ollie/*`
packages, the workers and the API worker. They cover module logic, crypto, sync retry, PII
scrubbing, the crisis lexicon, confidence handling, idempotency, rate limiting, budget caps, Clerk
verification, envelope encryption and every Layer 2 route.

CI (`.github/workflows/ci.yml`, Node 22):

1. Banned-phrase scanner unit tests and a scan of the codebase for disallowed product copy
   (`tools/scan-banned-phrases.cjs`).
2. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.

`.github/workflows/deploy-workers.yml` deploys each worker only after the same typecheck, lint and
test gate passes.

---

## Getting started

Requirements: Node ≥ 20, pnpm, Rust toolchain, Xcode for iOS builds.

```bash
pnpm install

pnpm dev                    # desktop app via Tauri (== pnpm --filter native tauri dev)
pnpm --filter native dev    # frontend only (Vite)

pnpm typecheck
pnpm lint
pnpm test                   # pnpm -r test; pretest runs the banned-phrase scans
```

Build:

```bash
pnpm build                                  # macOS (== pnpm --filter native tauri build)
pnpm --filter native tauri ios build        # iOS installable build
```

Workers:

```bash
pnpm --filter @ollie/worker-ai-proxy dev          # wrangler dev

pnpm --filter @ollie/worker-ai-proxy deploy       # -> ollie-ai-proxy
pnpm --filter @ollie/worker-apns-push deploy      # -> ollie-apns-push
pnpm --filter @ollie/worker-cron deploy           # -> ollie-cron
pnpm --filter @ollie/worker-sentry-tunnel deploy  # -> ollie-sentry-tunnel
pnpm --filter @ollie/api-worker deploy            # -> ollie-notifications
```

See `DEPLOY_TODO.md` for one-time deploy steps.

### Configuration (names only)

| Scope               | Variables                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App (`VITE_*`)      | `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_PROXY_URL`, `VITE_ROUTE_DUMP_URL`, `VITE_ACCOUNT_DELETE_URL`, `VITE_PUSH_REGISTER_URL`, `VITE_APNS_PUSH_URL`, `VITE_SENTRY_TUNNEL_URL` |
| `ai-proxy` secrets  | `CLERK_ISSUER`, `GROQ_API_KEY`, `VOYAGE_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_ANON_KEY`, `USER_HASH_SALT`, `ENVELOPE_KEK`                |
| `ai-proxy` vars     | `ENVIRONMENT`, `GLOBAL_DAILY_AI_MAX`, `SERVER_APPLY_ENABLED`                                                                                                                                                                 |
| `ai-proxy` bindings | `CACHE_KV`, `RATE_KV`, `VECTORIZE_INDEX`, `AI`, `AI_RATE_LIMITER`, `TELEM_RATE_LIMITER`                                                                                                                                      |
| `apps/api` secrets  | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_AUTH_KEY`, `REGISTER_SHARED_SECRET`, `CLERK_SECRET_KEY`, `USER_HASH_SALT`                                                                                             |

---

## Repository layout

```
apps/
  native/            Tauri + React app
    src/             frontend: dump, modules, rooms, router, sync
    src-tauri/       Rust shell: secure_db.rs, notifications, calendar
  api/               ollie-notifications worker: APNs, scheduled push, account delete
workers/
  ai-proxy/          Layer 1 dump router + Layer 2 module routes
  cron/              scheduled jobs + enrich drain
  apns-push/         APNs send
  sentry-tunnel/     Sentry ingest tunnel
packages/            @ollie/* workspace libraries
supabase/            SQL migrations + rollbacks
tools/               ESLint plugin + banned-phrase scanners
```

### `@ollie/*` packages

| Package           | Purpose                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `logic`           | Pure module cores (cycle, grocery, finance, habits, sleep, work, body, goals, medication, …) |
| `orchestrator`    | Wires module logic to the store and event bus                                                |
| `store`           | Local state store with reactive subscriptions                                                |
| `sync`            | Encrypted sync to `encrypted_state`, with debounce and capped backoff                        |
| `crypto`          | AES-GCM-256 + PBKDF2 primitives                                                              |
| `api`             | Client for the API worker and Supabase REST                                                  |
| `auth`            | Clerk helpers                                                                                |
| `events`          | Typed event bus                                                                              |
| `consent`         | Consent state (necessary + marketing)                                                        |
| `pii-scrub`       | Locale-aware PII and sensitive-content scrubbing                                             |
| `crisis-lexicon`  | EN / TR / ES crisis lexicons                                                                 |
| `cadence`         | Reminder cadence logic                                                                       |
| `notifications`   | Notification spec and delivery types                                                         |
| `apns-jwt`        | ES256 APNs JWT signing                                                                       |
| `worker-http`     | Shared worker HTTP helpers (JSON, errors, size limits)                                       |
| `research-stream` | Opt-in anonymized event stream                                                               |

## Status

Pre-release. Not publicly distributed.
