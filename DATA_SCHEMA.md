# ollie · data schema · 2026-05-14

**Status:** locked design, not yet migrated. Awaiting `wrangler deploy` + Supabase migration.

This document defines the 7 Supabase tables that hold ollie's telemetry + B2B research signal data. It encodes the data strategy decided in the 2026-05-14 strategy session ([memory: project_ollie_data_strategy.md]).

---

## 1. Strategy context

- **Positioning:** ADHD-built, for everyone. ICP is mass-market overwhelmed adults.
- **Collection posture:** AGGRESSIVE. Raw brain-dump text IS collected (PII-scrubbed) — it is the highest-value signal.
- **Two revenue lenses:** (a) B2B research sales of anonymized aggregates to 10 sectors, (b) brand sentiment dashboards.
- **Consent model:** [memory: ollie-consent-screen-2-toggles] — `consent.necessary` is mandatory at sign-up (one-way toggle). Every authenticated user is implicitly opted in.
- **Cycle restriction:** US-located users do NOT contribute cycle module data — Roe-post legal exposure. Worker-side country filter enforced.
- **Identity:** `user_hash = SHA256(email + system_salt)`. Irreversible, links across devices, breaks if email changes.

## 2. Pipeline overview

```
[Client app]
   │  emits void:retention:* / void:session:* / void:module:* / void:dump:* events
   ▼
[Cloudflare Worker · ai-proxy/extended]
   │  1. PII scrub (names, phones, emails, addresses → "[NAME]" etc, brands kept)
   │  2. Country gate (US + cycle module = drop content, keep skeleton)
   │  3. Anthropic Haiku 4.5 categorize → {sectors, brands, topic, sentiment, intent}
   │  4. Cost track (per-call $ logged)
   ▼
[Supabase tables 1-7]
```

All tables: RLS enabled, `service_role` write-only, no anon access. Indexes flagged per table.

---

## 3. Tables

### 3.1 `raw_dumps` — PII-scrubbed brain-dump text

Every brain-dump (typed or voice-transcribed), after PII scrub. Brand mentions preserved.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | gen_random_uuid() |
| `user_hash` | text NOT NULL | SHA256(email + salt). Indexed. |
| `device_id` | text NOT NULL | random UUID per install |
| `created_at` | timestamptz NOT NULL DEFAULT now() | client-supplied ts also stored as `event_ts` |
| `event_ts` | timestamptz NOT NULL | client local time (UTC) |
| `locale` | text NOT NULL | e.g. `en-US` |
| `country` | text NOT NULL | e.g. `US`, `TR`, `INTL` |
| `modality` | text NOT NULL CHECK (modality IN ('voice','text','paste')) | how it was entered |
| `scrubbed_text` | text NOT NULL | PII-removed text, brands preserved |
| `char_count` | int NOT NULL | post-scrub length |
| `routing_module` | text | which module router picked (e.g. `finance`) |
| `app_version` | text NOT NULL | client build, e.g. `0.0.1-build.234` |

**Indexes:** `(user_hash, created_at DESC)`, `(country, created_at)`, `(routing_module)`.

**Example row:**
```json
{
  "id": "9a3...",
  "user_hash": "a3f9...",
  "device_id": "iPhone-xyz",
  "created_at": "2026-05-14T23:47:00Z",
  "event_ts": "2026-05-14T23:47:00Z",
  "locale": "en-US",
  "country": "US",
  "modality": "voice",
  "scrubbed_text": "[NAME] ile Spotify çıkar artık",
  "char_count": 38,
  "routing_module": "finance",
  "app_version": "0.0.1-build.234"
}
```

**Retention:** keep indefinitely. Hot for ~12 months, archive to cold storage thereafter (decision deferred).

---

### 3.2 `enriched_signals` — Anthropic-tagged signals (★ B2B revenue table)

One row per `raw_dumps` row. Holds the structured insight derived by the categorizer.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `dump_id` | uuid NOT NULL REFERENCES raw_dumps(id) ON DELETE CASCADE | |
| `user_hash` | text NOT NULL | denormalized for fast queries. Indexed. |
| `created_at` | timestamptz NOT NULL | when enrichment ran |
| `sectors` | text[] NOT NULL | e.g. `['fintech','cpg']`. GIN index. |
| `brands` | text[] | e.g. `['spotify']`. GIN index. |
| `topic` | text | one slug, e.g. `subscription_forgot_cancel` |
| `sentiment` | text CHECK (sentiment IN ('joyful','calm','neutral','frustrated','anxious','sad','angry','overwhelmed')) | |
| `intent` | text CHECK (intent IN ('cancel','remind','vent','plan','purchase','research','log','seek_help')) | nullable |
| `urgency` | text CHECK (urgency IN ('low','medium','high')) | |
| `demographic_hints` | jsonb | e.g. `{"age_band":"25-34","life_stage":null}`. Optional, model's best guess from context. |
| `enrichment_model` | text NOT NULL | e.g. `claude-haiku-4-5-20251001` |
| `enrichment_cost_usd` | numeric(10,6) NOT NULL | per-call cost track |
| `enrichment_latency_ms` | int | for monitoring |

**Indexes:** `(user_hash, created_at)`, GIN on `sectors`, GIN on `brands`, `(topic)`, `(sentiment, created_at)`.

**Example row:**
```json
{
  "dump_id": "9a3...",
  "user_hash": "a3f9...",
  "created_at": "2026-05-14T23:47:01Z",
  "sectors": ["fintech", "cpg"],
  "brands": ["spotify"],
  "topic": "subscription_forgot_cancel",
  "sentiment": "frustrated",
  "intent": "cancel",
  "urgency": "low",
  "demographic_hints": {"age_band": "25-34"},
  "enrichment_model": "claude-haiku-4-5-20251001",
  "enrichment_cost_usd": 0.000128,
  "enrichment_latency_ms": 740
}
```

**This is the table B2B clients buy aggregated reports against.** Sample query: "Top 20 brands mentioned with frustrated sentiment among 25-34 demo in May."

---

### 3.3 `retention_events` — D1/D7/D30 + session-started markers

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_hash` | text NOT NULL | Indexed. |
| `event_type` | text NOT NULL CHECK (event_type IN ('installed','session_started','d1_returned','d7_returned','d30_returned')) | |
| `event_at` | timestamptz NOT NULL | |
| `session_count` | int | running session counter for this user |
| `hours_since_install` | numeric(10,2) | |
| `country` | text NOT NULL | |
| `locale` | text NOT NULL | |
| `device_id` | text NOT NULL | |
| `app_version` | text NOT NULL | |

**Indexes:** `(user_hash, event_at)`, `(event_type, event_at)`.

**Example rows for one user (truncated):**
```json
{"user_hash":"a3f9...", "event_type":"installed", "event_at":"2026-05-13T19:02:00Z", "session_count":0, ...}
{"user_hash":"a3f9...", "event_type":"session_started", "event_at":"2026-05-14T09:01:00Z", "session_count":2, "hours_since_install":13.98, ...}
{"user_hash":"a3f9...", "event_type":"d1_returned", "event_at":"2026-05-14T09:01:01Z", "hours_since_install":14.0, ...}
```

---

### 3.4 `session_events` — Session start + end with summary

One row per session (started_at row + later updated on end).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_hash` | text NOT NULL | Indexed. |
| `session_id` | uuid NOT NULL UNIQUE | client-generated |
| `started_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz | nullable until session closes |
| `duration_seconds` | int | filled on close |
| `modules_opened` | text[] | e.g. `['habit','finance','cycle']`. GIN. |
| `voice_used` | bool DEFAULT false | |
| `text_used` | bool DEFAULT false | |
| `brain_dumps_count` | int DEFAULT 0 | |
| `country` | text NOT NULL | |
| `device_id` | text NOT NULL | |
| `app_version` | text NOT NULL | |

**Indexes:** `(user_hash, started_at)`, `(started_at)` for cohort queries, GIN on `modules_opened`.

---

### 3.5 `module_events` — Per-module open/close

One row per module-open. Higher cardinality than `session_events`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_hash` | text NOT NULL | Indexed. |
| `session_id` | uuid NOT NULL | links to session_events |
| `module` | text NOT NULL | e.g. `finance`, `cycle`, `habit` |
| `opened_at` | timestamptz NOT NULL | |
| `closed_at` | timestamptz | |
| `duration_seconds` | int | |
| `actions_count` | int DEFAULT 0 | tap/edit/save events within module |
| `country` | text NOT NULL | |

**Cycle restriction:** if `country = 'US'` AND `module = 'cycle'`, skip the row entirely (worker enforces).

**Indexes:** `(user_hash, opened_at)`, `(module, opened_at)`.

---

### 3.6 `crisis_events` — Anonymous count-only

Hyper-sensitive. NO content, NO user_hash, NO device_id.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_at` | timestamptz NOT NULL | |
| `country` | text NOT NULL | |
| `hotline_shown` | text NOT NULL | e.g. `988`, `182`, `INTL` |
| `app_version` | text NOT NULL | |

**That's it.** No way to tie a crisis row back to a person. Pure population-level signal.

**Indexes:** `(event_at)`, `(country)`.

---

### 3.7 `consent_audit` — Legal trail

One row per consent state change (sign-up + every later modification).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_hash` | text NOT NULL | Indexed. |
| `consent_necessary` | bool NOT NULL | always true after sign-up (one-way) |
| `consent_marketing` | bool NOT NULL | toggleable |
| `consented_at` | timestamptz NOT NULL | |
| `event_source` | text NOT NULL CHECK (event_source IN ('signup','settings_change','delete_account')) | |
| `ip_country` | text | derived from CF request, NOT from settings |
| `user_agent` | text | truncated to 200 chars |
| `app_version` | text NOT NULL | |

**Indexes:** `(user_hash, consented_at)`.

**Why `ip_country` separate from `country`:** legal proof of jurisdiction of consent. A user can pick `country = US` in settings but consent from a TR IP — both are evidence.

---

## 4. Privacy rules — codified

These apply at the worker level, before any row hits Supabase:

1. **PII scrub** removes: human names (named-entity recognition), phone numbers, emails, postal addresses, GPS coords, full URLs (paths stripped, domain kept). Brand names kept.
2. **US + cycle:** if `country === 'US'` AND `module === 'cycle'` OR signal `sectors` includes `'femtech'` from a US user, drop the `scrubbed_text` field AND the `enriched_signals` row. Keep only the bare `module_events` row with `module = 'cycle'` for retention/usage metrics. NO content reaches Supabase from US cycle activity.
3. **Crisis:** never write to `raw_dumps` OR `enriched_signals` — only to `crisis_events`.
4. **No email/passphrase** anywhere in any table.
5. **user_hash regeneration:** if user changes email, generate new hash. Old hash data stays anonymized. There is NO mapping table.
6. **Right to delete:** `DELETE FROM <table> WHERE user_hash = $1` on every table. `consent_audit` row gets a `delete_account` event_source then is purged 30 days later (legal retention).

---

## 5. RLS policy

```sql
-- All 7 tables:
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
REVOKE ALL ON <table> FROM anon, authenticated;
-- Only service_role (used by worker) can write.
-- No SELECT policy for end-users — they cannot read their own rows.
```

Reasoning: end users don't need to see their telemetry. Serra reads via service_role from a separate analytics dashboard (future work, not Supabase Studio).

---

## 6. Sizing estimate

Per active user per month (rough):
- 100 brain-dumps → 100 `raw_dumps` + 100 `enriched_signals` (~50 KB)
- 30 sessions → 30 `session_events` (~5 KB)
- 60 module opens → 60 `module_events` (~3 KB)
- 5 retention events lifecycle → 5 `retention_events` (~1 KB)
- 0-2 crisis events → minimal

**~60 KB/user/month.** 1,000 active users = ~60 MB/month. Supabase free tier (500 MB) handles ~8k user-months. Comfortable runway for alpha + early beta.

Anthropic enrichment cost: ~$0.00013 × 100 dumps × 1,000 users = ~$13/month at 1k users. Linear scale.

---

## 7. Migration plan

Each table = one SQL migration file. Order matters (FK constraint on enriched_signals → raw_dumps):

| # | File | Depends on |
|---|---|---|
| 1 | `20260514_000001_raw_dumps.sql` | — |
| 2 | `20260514_000002_enriched_signals.sql` | raw_dumps |
| 3 | `20260514_000003_retention_events.sql` | — |
| 4 | `20260514_000004_session_events.sql` | — |
| 5 | `20260514_000005_module_events.sql` | session_events (soft) |
| 6 | `20260514_000006_crisis_events.sql` | — |
| 7 | `20260514_000007_consent_audit.sql` | — |

Every migration ships a sibling `.down.sql`.

After migrations:
1. Extend `workers/ai-proxy/src/index.ts` to handle the `/enrich-dump` POST path
2. New worker route OR extend ai-proxy: `/ingest-event` for retention/session/module/crisis events
3. Bridge retention events (native app, e.g. `apps/native/src/api/`) through `@ollie/research-stream` to the new ingest endpoint _(original plan referenced the now-deleted `apps/web/src/lib/retention.ts`)_
4. Hook `lib/account-boot.ts` to write `consent_audit` row on sign-up

---

## 8. Decisions locked 2026-05-14

1. **Cold storage rotation:** ✅ LOCKED — **12 months hot in Supabase, archive to R2/S3 thereafter.** Cron worker handles rotation. Implementation deferred to post-alpha.
2. **PII scrub model:** ✅ LOCKED — **Hybrid.** Worker runs cheap regex pass first (names, phones, emails, addresses). Then Anthropic Haiku 4.5 receives the regex-cleaned text + an explicit "don't echo PII" system prompt as belt-and-suspenders. Two-layer defense, near-zero added cost.
3. **Real-time vs batch enrichment:** ✅ LOCKED — **Batch.** Queue (KV-backed) + cron worker every 5 min. Brain-dump UX gets zero added latency. B2B signals lag ~5 min behind raw_dumps — acceptable since signals aren't user-facing.
4. **Aggregation tables:** deferred. For B2B reports we'll want pre-aggregated rollups (daily, weekly). Not in this schema — derived later from these 7 base tables once usage patterns are visible.
5. **Sentry session replay** is its own stream — does NOT touch these 7 tables. Sentry-side configuration is separate.

---

## 9. Next steps

1. Serra runs Supabase migrations (Step 7).
2. Extend `workers/ai-proxy` with `/enrich-dump` + `/ingest-event` handlers (Step 7).
3. Wire `lib/retention.ts` → ingest endpoint (Step 7).
4. Write integration test that walks the full pipeline on one synthetic dump.
5. Burn-in for 1 week with Serra-only traffic before broadening to alpha.
