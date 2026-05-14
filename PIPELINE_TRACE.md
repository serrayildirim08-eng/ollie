# Telemetry pipeline · paper trace · 2026-05-14

End-to-end walk of one synthetic brain-dump from the user's keyboard
to two Supabase rows. No live API was called. This trace is the
"clicked through manually" remedy for the post-Sprint-5 audit critique.

---

## Synthetic input

User in Türkiye, signed in as `serra@example.com`, opens Ollie at
2026-05-14 23:47 local. Consent toggle is ON.

She types into the brain-dump box:

```
remind Alex Park to call me at +1 415 555 0100 about the Spotify cancellation
```

Routing module picks `finance` (the dump talks about a subscription).

---

## Step 1 — apps/web/src/hooks/useApplyBrainDump.ts

1. Crisis guard → no crisis line matched. Continue.
2. Reminder intercept → "to call" + "at +1 415 555 0100" doesn't match
   any parseable time phrase, so no reminder is set.
3. `extract(text)` → `[{module:'finance', action:'add', data: text}]`.
4. `applyRoute()` writes one entry into `finance.items`.
5. Toast: "routed → finance".
6. Step 5 (new): consent ON + `readUserHash()` returns
   `'4f3a…'` (SHA-256 of `serra@example.com` + VITE_USER_HASH_SALT)
   so the gate passes. `postEnrichDump()` fires with:
   ```json
   {
     "user_hash": "4f3a…",
     "device_id": "8e2c-…",
     "event_ts": "2026-05-14T23:47:00.000Z",
     "locale": "tr-TR",
     "country": "TR",
     "modality": "text",
     "raw_text": "remind Alex Park to call me at +1 415 555 0100 about the Spotify cancellation",
     "routing_module": "finance",
     "app_version": "0.0.1-build.234"
   }
   ```

Time on UI thread: ~1 ms. The `fetch()` is fire-and-forget; the user
sees the toast immediately.

---

## Step 2 — POST /enrich-dump (workers/ai-proxy)

`handleEnrichDump()` runs:

1. JSON parse OK, all required fields present.
2. `country === 'TR'` so the US-cycle restriction does not apply.
3. PII scrub:
   - `Alex Park` → `[NAME]`
   - `+1 415 555 0100` → `[PHONE]`
   - `Spotify` → kept (brand)
4. Scrubbed text: `"remind [NAME] to call me at [PHONE] about the Spotify cancellation"`
5. `id = crypto.randomUUID()` → e.g. `f5b9-…`
6. KV put at key `q:enrich:1715731620000:f5b9-…` with TTL 3 days.
   Stored value is the QueuedDump JSON.
7. Returns `{ id: "f5b9-…", queued: true }` in <50 ms.

Client ignores the response (fire-and-forget).

---

## Step 3 — workers/cron `*/5 * * * *` tick

Up to 5 minutes later, the every-5-minutes cron fires. `event.cron`
matches `*/5 * * * *` so the drain branch runs.

`drainEnrichQueue()`:

1. `CACHE_KV.list({prefix:'q:enrich:', limit:50})` → 1 key.
2. Read payload, parse OK.
3. `callAnthropic(env, scrubbedText)`:
   - POST `https://api.anthropic.com/v1/messages`
   - Model: `claude-haiku-4-5-20251001`
   - System prompt = ENRICH_SYSTEM_PROMPT (with `cache_control: ephemeral`).
   - User content = scrubbed text.
   - Response (illustrative):
     ```json
     {
       "sectors": ["entertainment"],
       "brands": ["spotify"],
       "topic": "subscription_cancel_intent",
       "sentiment": "neutral",
       "intent": "cancel",
       "urgency": "low",
       "demographic_hints": null
     }
     ```
   - usage.input_tokens ≈ 350, output_tokens ≈ 80
   - costUsd ≈ 0.000350 × 1.0 + 0.000080 × 5.0 = $0.00075
4. `insertRawDump()` → POST
   `https://<ref>.supabase.co/rest/v1/raw_dumps` with the scrubbed row
   + service-role headers. 201 Created.
5. `insertEnrichedSignal()` → POST
   `https://<ref>.supabase.co/rest/v1/enriched_signals` linked by
   `dump_id = f5b9-…`. 201 Created.
6. `CACHE_KV.delete('q:enrich:1715731620000:f5b9-…')`.
7. `CACHE_KV.delete('q:enrich:retry:f5b9-…')` (no-op since no retry counter existed).

Total wall-clock: ~700 ms inside the cron worker.

---

## Step 4 — what Serra sees in Supabase

`raw_dumps` (1 row):

| id | user_hash | country | scrubbed_text | routing_module |
|---|---|---|---|---|
| f5b9-… | 4f3a… | TR | remind [NAME] to call me at [PHONE] about the Spotify cancellation | finance |

`enriched_signals` (1 row):

| dump_id | sectors | brands | topic | sentiment | intent | urgency |
|---|---|---|---|---|---|---|
| f5b9-… | ["entertainment"] | ["spotify"] | subscription_cancel_intent | neutral | cancel | low |

The two rows join 1:1 by `dump_id`.

---

## Adjacent flows (covered by tests, not retraced)

- **`void:retention:installed` fires on first launch** → bridged through
  `makeRetentionBridge()` → `trackTable('retention_events', row)` →
  worker `/ingest-event` → INSERT into `retention_events`. Same shape
  for `session_started` / `d1_returned` / `d7_returned`.
- **US user dumps cycle content** → ai-proxy returns
  `{queued:false, reason:'us_cycle_restricted'}`, nothing hits KV or
  Supabase.
- **Failure mode**: Anthropic returns 500. KV entry stays. Retry counter
  ticks. After 12 failed runs (1 hour) the payload moves to
  `dlq:enrich:<id>` with a 14-day TTL.

---

## Confidence

- All scrub patterns are exercised by `workers/ai-proxy/tests/enrich-dump.test.ts`
  (8 PII test cases + happy path + US-cycle).
- Queue → Anthropic → Supabase → delete is exercised by
  `workers/cron/tests/drain.test.ts` (happy path + 4 failure modes).
- Retention bridge wiring is exercised by
  `apps/web/src/lib/retention.test.ts` (5 new bridge tests).
- The fire-and-forget client call is exercised by
  `apps/web/src/lib/enrich-bridge.test.ts` (6 tests).

What ISN'T tested by automation (yet):
- A live Supabase write — needs the secrets in DEPLOY_TODO.md set.
- A live Anthropic call — same.
- The exact `event.cron` string Cloudflare passes — wrangler dev can
  trigger both schedules manually but this trace is the on-paper proof
  in lieu of `wrangler deploy`.
