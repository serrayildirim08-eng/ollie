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

## Out of scope here (deferred to Phase 2)

- `session_events` / `module_events` client hooks (need `App.tsx`
  + `ModuleScreen.tsx` instrumentation).
- `consent_audit` rows from sign-up flow.
- Cold-storage rotation cron.
- B2B aggregate-rollup tables.
