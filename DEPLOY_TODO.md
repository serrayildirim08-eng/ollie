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

## Out of scope here (deferred post-beta)

- Cold-storage rotation cron.
- B2B aggregate-rollup tables.
