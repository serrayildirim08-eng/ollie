# Telemetry pipeline · deploy TODO · 2026-05-14

Serra runs these. I (backend) do NOT run `wrangler deploy` for you.

---

## 1. Supabase migrations (if not already applied)

```
supabase db push
```

…or apply these migrations in order via the Supabase dashboard:

- 20260514_000001_raw_dumps.sql
- 20260514_000002_enriched_signals.sql
- 20260514_000003_retention_events.sql
- 20260514_000004_session_events.sql
- 20260514_000005_module_events.sql
- 20260514_000006_crisis_events.sql
- 20260514_000007_consent_audit.sql

(These live under `supabase/migrations/` already; you don't need to write them.)

---

## 2. Set worker secrets

### ai-proxy

```
cd workers/ai-proxy
wrangler secret put SUPABASE_URL
# paste:  https://<your-supabase-ref>.supabase.co

wrangler secret put SUPABASE_SERVICE_ROLE
# paste the SERVICE_ROLE key (NOT the anon key). Settings → API → service_role key.
```

`ANTHROPIC_API_KEY` is already set from earlier — don't touch.

### cron

```
cd workers/cron
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE
wrangler secret put SUPABASE_SERVICE_ROLE_KEY      # alias kept for legacy stub handlers
wrangler secret put ANTHROPIC_API_KEY              # sk-ant-… (same key as ai-proxy)
```

---

## 3. Deploy workers

```
cd workers/ai-proxy && wrangler deploy
cd workers/cron     && wrangler deploy
```

The cron worker now has TWO schedules in `wrangler.toml`:
- `0 3 * * *`  — daily intelligence (stubs, no behavior yet)
- `*/5 * * * *` — drains the brain-dump enrichment queue

You'll see both schedules listed in the deploy output.

---

## 4. Set web env vars

Add to `.env.local` (or wherever VITE_* lives for your deploy):

```
VITE_AI_WORKER_URL=https://ollie-ai-proxy.<your-cf-subdomain>.workers.dev
VITE_USER_HASH_SALT=<32+ chars, generate with: openssl rand -hex 32>
```

Important: `VITE_USER_HASH_SALT` must NEVER change once it ships, or
every user's `user_hash` will silently fork and you'll lose retention
linkage. Store it in 1Password and the CI secret store.

The salt is technically client-visible (it ends up in the JS bundle),
so it's not a secret-secret — it's a stable opaque string that just
needs to be unguessable to outsiders.

---

## 5. Smoke test (5 min, Serra-runnable)

After deploy:

1. Open Atelier (Electron app or web) on your laptop.
2. Sign in.
3. Type into brain-dump: `cancel spotify already`.
4. In the Supabase dashboard, run:
   ```sql
   SELECT id, user_hash, country, scrubbed_text, created_at
   FROM raw_dumps ORDER BY created_at DESC LIMIT 1;

   SELECT dump_id, sectors, brands, sentiment, intent
   FROM enriched_signals ORDER BY created_at DESC LIMIT 1;
   ```
5. Wait up to 5 min for the cron tick. You should see one row in each
   table, joined by `dump_id`.

If `raw_dumps` is empty after 6 min: check `wrangler tail` on the
cron worker — the `[cron:enrich-drain]` log line emits each run with
`{scanned, succeeded, failed, dlq}`.

If `enriched_signals` is empty but `raw_dumps` has rows: the
Anthropic call failed; check the same tail for `anthropic_5xx`.

---

## 6. Hard-stop checks

- The `Authorization: Bearer <service-role>` header value MUST be the
  service-role key, not the anon key. Easy mistake.
- The two workers MUST share the same `CACHE_KV` namespace ID. Both
  wrangler.toml files reference `id = "6031aea7f9c14f96884e55ec1be527f3"`
  already — confirm they still match.
- `VITE_USER_HASH_SALT` MUST be set BEFORE the first signed-in user
  starts producing telemetry. If you ship a build with an empty salt
  and someone signs up, their hash is irrecoverable.

---

## 7. D1 retention + invite smoke test (Serra-runnable, post-Sprint D1)

After backend pod's session/module/consent + invite endpoints ship and
Serra deploys the new migration:

### A. D1 retention verify

1. Open Atelier on laptop, sign in as NEW user (incognito).
2. Use app for 5 min. Confirm `retention_events.installed` + `session_started`
   rows appear:
   ```sql
   SELECT event_type, event_at, hours_since_install
   FROM retention_events
   WHERE user_hash = '<your hash>'
   ORDER BY event_at DESC LIMIT 10;
   ```
3. Close app, wait 24+ hours (or fake by setting system clock +25h on
   second device; do NOT do this on your primary because session_events
   will skew).
4. Reopen app. Within 30s a `d1_returned` row should land:
   ```sql
   SELECT event_type, hours_since_install
   FROM retention_events
   WHERE event_type = 'd1_returned'
   AND user_hash = '<your hash>';
   ```
5. UI: `RetentionWelcomeBar` should render "day 1. you came back." once,
   dismissable, won't re-show.

### B. session_events + module_events

```sql
SELECT module_id, count(*), avg(duration_ms)
FROM module_events
WHERE user_hash = '<your hash>'
GROUP BY module_id;

SELECT session_duration_ms, started_at, ended_at
FROM session_events
WHERE user_hash = '<your hash>'
ORDER BY started_at DESC LIMIT 3;
```

Expect: a row per module you opened, a row per session. `session_ended`
fires on tab close / visibilitychange.

### C. consent_audit at onboarding

```sql
SELECT event_source, consent_marketing, research_optin, consented_at
FROM consent_audit
WHERE user_hash = '<your hash>'
ORDER BY consented_at;
```

Expect: one `event_source='onboarding'` row at sign-up + one
`event_source='settings_toggle'` row each time you flip marketing in
Settings.

### D. Invite flow

1. Open Settings → INVITE A FRIEND → "generate invite".
2. Code appears (e.g. `olli-xy3k-zfp9`) + share button.
3. Click copy or share → confirm clipboard / native share sheet works.
4. ```sql
   SELECT code, expires_at, used_at FROM invites
   WHERE inviter_user_hash = '<your hash>';
   ```
5. Open share URL in a 2nd incognito window. ConsentStep should
   pre-fill the invite code field.
6. Complete sign-up. Check:
   ```sql
   SELECT code, used_at, invitee_user_hash FROM invites WHERE code = '<the code>';
   ```
   Expect `used_at` is now non-null + `invitee_user_hash` is the 2nd
   user's hash.
7. Try the same URL a 3rd time. Sign-up should block with "code expired
   or already used."

### E. Rate limit verify

Generate 5 invites in a row from one account. 6th request should
return `{success: false, reason: 'rate_limit', retry_after}`. UI shows
"max 5 invites this week. resets sunday."

### Pre-test deploy checklist

- New migration applied: `20260514_000008_invites.sql`
- Worker redeployed: `cd workers/ai-proxy && wrangler deploy`
- Worker secrets confirmed: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
  (existing) — no new secrets needed for invite endpoints
- `.env.local` unchanged (worker URL same)

---

## 8. Worker auth security fixes (2026-05-17) — REQUIRED before this ships

Two authentication holes in the Cloudflare Workers were fixed. The code
is done, but the workers will NOT function correctly until you set the
new secrets below and redeploy. Run each `wrangler secret put` from inside
the named worker directory; it will prompt you to paste the value.

### S2 · ai-proxy — authenticate the telemetry endpoints

`/ingest-event`, `/label` and `/enrich-dump` now require a valid Supabase
user JWT. `SUPABASE_ANON_KEY` is already set on ai-proxy from the invite
work (Step 7) — confirm it is present:

```
cd workers/ai-proxy
wrangler secret list      # SUPABASE_ANON_KEY must be in the list
```

If it is NOT listed:

```
wrangler secret put SUPABASE_ANON_KEY
```

Frontend note: the web app callers now send `Authorization: Bearer <jwt>`
on these three endpoints. No env change is needed for that — it ships in
the same web build. Just make sure the web app is redeployed alongside
the worker so old clients (no header) don't get 401s. Old clients will
simply fail telemetry silently (best-effort) until they update.

### S3 · apns-push — lock down the internal /push endpoint

The apns-push `/push` endpoint is now gated by a shared secret. Generate
ONE secret and set the SAME value on BOTH workers:

```
# 1. generate the secret once and copy it:
openssl rand -hex 32

# 2. set it on apns-push:
cd workers/apns-push
wrangler secret put APNS_INTERNAL_SECRET
# paste the value from step 1

# 3. set the SAME value on cron:
cd workers/cron
wrangler secret put APNS_INTERNAL_SECRET
# paste the EXACT same value
```

If the two values do not match, the cron notification drain gets 401
from /push and no server-side notifications are delivered.

### Redeploy after setting the secrets

```
cd workers/apns-push  && wrangler deploy
cd workers/cron       && wrangler deploy
cd workers/ai-proxy   && wrangler deploy
```

Deploy order matters slightly: apns-push before cron (so the service
binding resolves against a worker that already enforces the secret).

### Smoke check

- Notifications: trigger `POST /flush-notifications` on the cron worker;
  a due job should reach `sent`, not stick on `pending` with `apns-401`.
- Telemetry: a signed-in user's brain dump should still land in
  `raw_dumps` (verify per Step 5). A logged-out / no-JWT POST to
  `/ingest-event` should now return 401.

---

## Backend cleanup sprint (2026-05-18) — worker deploy steps

The "reinvented wheel" cleanup added two worker changes that need a deploy
to take effect. The repo is SAFE to deploy as-is right now — both changes
fall back to the existing behaviour until you complete the steps below.
A routine `wrangler deploy` of any worker will NOT break.

### Item #5 — native Rate Limiting (SAFE, deploy picks it up automatically)

The racy KV-counter rate limiter is replaced by Cloudflare's native
Rate Limiting binding. The `[[ratelimits]]` blocks are ALREADY UNCOMMENTED
in `workers/ai-proxy/wrangler.toml` and `workers/apns-push/wrangler.toml`
— this binding is **declarative**: Cloudflare provisions it on deploy, no
`wrangler` CLI resource step is needed.

Steps:
1. Make sure Wrangler is ≥ 4.36 (`wrangler --version`).
2. `wrangler deploy` ai-proxy and apns-push as normal.
3. That's it — the workers prefer the native limiter and fall back to the
   old KV counter only if the binding is somehow absent. Once confirmed
   live you may delete the `RATE_KV` namespace + binding (optional).

namespace_ids used: 2001 (AI), 2002 (telemetry), 2003 (apns push). These
are arbitrary positive integers, unique per account — change only if they
collide with an existing limiter.

### Item #4 — Cloudflare Queues for the brain-dump enrichment queue

The hand-rolled `q:enrich:*` KV queue migrates to a native Cloudflare
Queue (native retry/backoff + a real DLQ). The producer/consumer bindings
are deliberately **COMMENTED OUT** in `workers/ai-proxy/wrangler.toml` and
`workers/cron/wrangler.toml` — an uncommented binding pointing at a queue
that does not exist makes `wrangler deploy` FAIL. Until you run the steps
below the workers keep using the KV queue (the code falls back when the
`ENRICH_QUEUE` binding is undefined). Nothing breaks if you never do this.

Steps (run in order):
1. Create the queue and its dead-letter queue:
   ```
   wrangler queues create ollie-enrich-queue
   wrangler queues create ollie-enrich-dlq
   ```
2. In `workers/ai-proxy/wrangler.toml` uncomment the `[[queues.producers]]`
   block (binding `ENRICH_QUEUE`, queue `ollie-enrich-queue`).
3. In `workers/cron/wrangler.toml` uncomment the `[[queues.consumers]]`
   block (queue `ollie-enrich-queue`, dead_letter_queue `ollie-enrich-dlq`).
4. Deploy in this order: `wrangler deploy` ai-proxy, then cron.
5. Smoke check: a signed-in user's brain dump should still land in
   `raw_dumps` + `enriched_signals` (now via the Queue instead of the
   5-min KV scan). Check the cron worker's logs for `[queue:enrich]`.
6. Once the Queue path is confirmed healthy, the 5-min `scheduled()`
   enrich-drain in `workers/cron/src/index.ts` can be removed — it is
   currently kept as a belt-and-braces fallback.

If you decide NOT to migrate to Queues, no action is needed — leave the
blocks commented and the KV path keeps running.

---

## Practice-bug audit fixes (2026-05-18) — worker deploy steps

Three audit fixes touch worker code. None is dangerous to deploy; the repo
is consistent as-is. Deploy steps below.

### Item #1 — double-delivery cron decommissioned (apps/api / ollie-notifications)

`apps/api` (`ollie-notifications`) ran a per-minute cron that scanned
`scheduled_jobs` and delivered pushes — the SAME table `workers/cron`
(`ollie-cron`) drains every 5 min. Running both = duplicate pushes + a
broken daily cap. Fix: the `[triggers]` block in `apps/api/wrangler.toml`
is removed and `scheduled()` is now an inert no-op.

- VERIFIED: `ollie-notifications` is **NOT currently deployed**
  (`wrangler deployments list --name ollie-notifications` → "Worker does
  not exist on your account"). So **no redeploy is required** — there is
  no live cron to stop.
- IF you ever deploy `ollie-notifications` (it is still a valid HTTP
  worker for `/register-token`, `/send`, `/account/delete`): deploy the
  updated `wrangler.toml` so the cron trigger does not arm. Never run the
  apps/api cron and `flushNotificationQueue` at the same time.

### Item #12 — drain.ts raw_dumps idempotency (workers/cron / ollie-cron)

`insertRawDump` is now an UPSERT on the `id` primary key
(`on_conflict=id`, `prefer=resolution=merge-duplicates`). A retry after a
crash between the raw write and the `enriched_signals` write no longer
creates a duplicate `raw_dumps` row. Applies to BOTH active paths
(`drainEnrichQueue` KV-scan and `handleEnrichQueueBatch` Queues consumer).

- DB requirement: `raw_dumps.id` must be the PRIMARY KEY (or carry a
  UNIQUE constraint) for PostgREST `on_conflict=id` to resolve. It already
  is — no migration needed. If a future schema change drops that, the
  upsert silently degrades to a plain insert.
- Deploy: routine `wrangler deploy` of `ollie-cron`.

### Item #13 — countSentToday fail-closed (workers/cron / ollie-cron)

The daily-notification-cap count query previously returned `0` on any
error → the cap was silently disabled for every user during a Supabase
blip. It now returns a sentinel; `processJob` leaves the job `pending`
(retried next 5-min tick) instead of delivering against an unknown budget.
Repeated failures still flip the job to `failed` via the normal retry cap,
so it cannot retry forever.

- Deploy: routine `wrangler deploy` of `ollie-cron`. No secrets, no
  schema, no new bindings. Bundled with the Item #12 deploy.

Summary: **deploy `ollie-cron` once** to pick up #12 + #13. #1 needs no
deploy (worker not live).

---

## New-device sign-in migration (2026-05-18) — Supabase only, Serra-runnable

The "sign in from a new device" auth flow is code-complete in
`packages/auth/src/index.ts`, but it stays broken in prod until ONE
migration is applied. No worker deploy, no secrets, no env change.

### Why

On a new device the app has no local salt, so it asks Supabase for the
non-secret `salt` + `encrypted_server_pw` (keyed by email) using only the
anon key. Today `profiles` blocks anon entirely, so the request fails and
the user is stuck on "import a backup". This migration opens a narrow,
column-limited anon read for exactly those recovery columns.

Safe because: a salt is non-secret by design, and `encrypted_server_pw`
is ciphertext that is useless without the user's passphrase — and the
passphrase never leaves the device. Anon can read ONLY 4 columns
(`id, email, salt, encrypted_server_pw`); everything else stays hidden.

### Apply

Apply this one migration in order via `supabase db push`, or paste it in
the Supabase dashboard SQL editor:

- `supabase/migrations/20260518000001_profiles_anon_email_lookup.sql`

(Additive only — it does not touch existing rows or the authenticated-user
policies. The `email` column + index already exist from an earlier
migration, so they are not re-created.)

### Verify (1 min, in the Supabase SQL editor)

```sql
-- anon must have column-level SELECT on exactly these 4 columns:
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_name = 'profiles' AND grantee = 'anon';
-- expect 4 rows: id, email, salt, encrypted_server_pw  (SELECT)

-- the anon policy must exist:
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'profiles' AND policyname = 'profiles_select_anon_recovery';
-- expect 1 row, roles = {anon}, cmd = SELECT
```

### Smoke test (real new-device path)

1. Sign up / sign in once on device A (so a `profiles` row with `salt` +
   `encrypted_server_pw` + `email` exists).
2. On device B (or a fresh incognito profile with cleared localStorage),
   sign in with the SAME email + passphrase. It should succeed — the
   client recovers the salt from Supabase (`recovered_from_server`).
3. With a WRONG passphrase on device B it must still fail with
   "wrong passphrase" — recovery does not bypass the passphrase.

### Rollback

If anything looks wrong, `supabase/rollbacks/20260518000001_profiles_anon_email_lookup.down.sql`
re-locks `profiles` to the anon-gets-nothing state.

---

## Security audit medium fixes (2026-05-18) — S8 worker deploy steps

The S4–S8 medium-severity security fixes are code-complete. Four of the
five (S4 secret-log leakage, S5 stale consent cache, S6 credential wipe,
S7 PBKDF2 iteration count) are **client/package-only** — they ship in the
normal web/desktop build, NO worker deploy needed.

**S8 — PostgREST error bodies no longer leak to callers — touches the
workers and DOES need a `wrangler deploy` to go live.**

### What changed (S8)

Workers used to return raw upstream error bodies to the caller
(`detail: errText`). PostgREST error bodies disclose table, column, and
constraint names — an information-disclosure vector. Now:

- `workers/ai-proxy` — `/generate-invite`, `/claim-invite`, `/label`,
  `/ingest-event` return a GENERIC body `{ error, request_id }`. The full
  upstream detail is logged SERVER-SIDE only (`console.error`, visible in
  `wrangler tail`), tagged with the same `request_id` for support
  correlation.
- New shared helper `upstreamError()` in `@ollie/worker-http`.

### Deploy steps (Serra-runnable)

NO new secrets, NO new bindings. Just redeploy the affected worker:

```
cd workers/ai-proxy   && wrangler deploy
```

Old web clients keep working: the response still has an `error` field
they branch on; only the `detail`/`status` extras are gone.

### Smoke check (S8)

1. Force a Supabase error you can observe — e.g. POST `/ingest-event` with
   a row that violates a column constraint.
2. The HTTP response body must be `{ "error": "ingest_failed",
   "request_id": "..." }` — NO table/column/constraint names, NO `detail`.
3. `wrangler tail ollie-ai-proxy` must show the full PostgREST detail
   server-side, on a line carrying the SAME `request_id` the caller got.

### Frontend note

The web app does not consume the removed `detail`/`status` fields, so no
web change is required for S8. If any caller surfaced `detail` in a UI
string (none found in this repo), it would now show the generic code —
acceptable, and the `request_id` can be surfaced to users for support.

---

## Out of scope here (deferred post-beta)

- Cold-storage rotation cron.
- B2B aggregate-rollup tables.
