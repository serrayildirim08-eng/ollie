# Ollie Repo Audit — Round 3 (2026-06-18)

This round consolidates findings from 20 audit lanes spanning the native app (UI architecture, state flow, dump flow, modules, data/crypto, nav/notify), the Cloudflare workers (ai-proxy validation + logic, cron/apns/sentry), the shared packages (logic detectors, orchestrator, crypto/sync/store, misc), and the database migrations. The dominant theme is a cluster of **silently-broken persistence paths** that pass tests only because the REST/SQL layer is mocked: the `/route/:module` cache is dead end-to-end (missing RPC + missing column), `encrypted_state` upserts fail with a unique violation after the first write per module, bytea columns receive raw base64 that the IV CHECK constraint rejects, and `push_tokens`/`encrypted_state` are keyed on Supabase `uuid` while the app's identity is Clerk text. A second theme is a **falsified store.set no-op assumption** that three subsystems reason from (it does no equality check), driving watcher/AI-copy churn on every dump. A third theme is **missing rate limits on the two most expensive AI endpoints** (`/route/dump`, `/route/:module`) plus duplicated/diverged UI primitives, non-idempotent dump retries, and migration promises that cache rejections for the whole session.

---

## Critical

**`/route/:module` cache is fully dead — every request pays full Groq cost (RPC + column both missing)**
- Location: workers/ai-proxy/src/router/route.ts:393-465; supabase/migrations/20260521000001_routing_cache.sql
- Dimension: correctness
- Detail: cacheLookup POSTs to /rest/v1/rpc/routing_cache_lookup but no migration defines that function — the 404 is treated as "T1 not yet deployed" so every lookup is a forced miss. cacheWrite (and feed-me.ts) write a `text_sample` column the routing_cache table does not have, so every write fails with PGRST204/400 (fire-and-forget, only console.error). Net: cache neither reads nor writes; /route/grocery, /route/feed-me etc. invoke Groq Llama on every call with zero dedup. Tests mock the PATCH so they never catch it. The /route/dump Vectorize cache is separate and unaffected.

**`encrypted_state` upsert omits on_conflict — every push after the first for a module fails with a unique violation**
- Location: packages/sync/src/index.ts:199-201 (rows 151-161); packages/api/src/client.ts:320-330
- Dimension: correctness
- Detail: Rows are built with no id, relying on the (user_id, module) unique constraint for idempotent upsert, but rest.upsert sends `Prefer: resolution=merge-duplicates` without an `on_conflict` query param. PostgREST resolves merge against the PK (id, default gen_random_uuid()), so every POST gets a new id, never collides on the PK, and the 2nd+ push for a module violates `encrypted_state_unique_module unique (user_id, module)` → 409 forever. drainOnce treats it as retryable, loops, then exhausts. Tests fully mock rest.upsert.

**bytea columns are sent raw base64 strings — Postgres stores literal text, IV octet_length CHECK rejects every write**
- Location: packages/sync/src/index.ts:156-157; packages/sync/src/finance.ts:350-351,453; supabase/migrations/20260512000001_encrypted_state.sql:31-34, 20260514000008_finance_records.sql:52-57
- Dimension: correctness
- Detail: ciphertext/iv (and finance encrypted_payload/iv) are base64-encoded and shipped in a JSON body to `bytea` columns. PostgREST decodes JSON strings into bytea via `\x` hex (not base64), so the base64 text is stored as literal ASCII bytes. A 12-byte IV base64s to 16 chars → stored as 16 bytes → fails `check (octet_length(iv) = 12)`, rejecting the insert. The finance.ts comment claims a "base64 → \x hex" conversion that does not exist anywhere. Even if the CHECK passed, the other device would decrypt base64-of-base64 garbage. Path never ran against a live DB.

---

## High

**False "store.set no-ops on deep-equal" assumption — store.set has no equality check, fires every subscriber on every dump**
- Location: packages/store/src/store.ts:129-134; apps/native/src/modules/dispatch.ts:106-108; apps/native/src/bridge/index.ts:60-66
- Dimension: correctness
- Detail: store.set unconditionally writes and notifies — there is NO equality check. Yet three comment blocks justify the all-modules sweep on the claim that "store.set no-ops on deep-equal values, so unchanged modules cause zero watcher churn." After every dump, runAllSyncs sweeps all 12 bridges; each rebuilds brand-new arrays from SQLite and calls store.set with new object identity, notifying every `<module>.patterns`/`shared.patterns` subscriber app-wide even when nothing changed. Fix: short-circuit store.set on structural equality (makes the comments true and kills churn), or delete the comments and diff per-bridge.

**TodayNoticings re-runs an async AI-copy pipeline on every store.patterns notification (no debounce)**
- Location: apps/native/src/modules/brain/TodayNoticings.tsx:98-111
- Dimension: perf
- Detail: useTodaysNoticings subscribes one refresh() to patterns on all 12 module namespaces + 3 shared keys. refresh() fetches a Clerk bearer token and Promise.all's resolveNoticingCopy (AI call/cache) per noticing. Because store.set never deep-equal-suppresses, one dump's sweep fires ~15 overlapping async pipelines in the same tick; last-resolving setItems wins, wasting token fetches/copy resolutions and risking a stale-state race (slower earlier call clobbers fresher result). Needs microtask-batched single refresh + a generation guard.

**No idempotency: dump retry after timeout double-routes and double-writes every fragment**
- Location: apps/native/src/dump/BrainDumpInput.tsx:188-243; workers/ai-proxy/src/router/dump.ts:208
- Dimension: idempotency
- Detail: RouteDumpRequest carries an optional dumpId and the worker keys archive/telemetry on it, but submit() never populates body.dumpId. The worker does `dumpId = body.dumpId ?? crypto.randomUUID()`, so every POST gets a new id and a full re-classify + re-dispatch. Client timeout is 30s while the worker does network + Voyage + Groq; a slow-but-successful route returns code:'timeout', draft stays, user retries → all module handlers run again (duplicate grocery/finance/admin rows, a 2nd work notification). No content-keyed dedupe anywhere. Violates harness idempotency invariant. Fix: stable client dumpId reused on retry + short-TTL KV dedupe in worker.

**`/route/dump` and `/route/:module` — the most expensive AI endpoints — have no rate limiting**
- Location: workers/ai-proxy/src/index.ts:395-406
- Dimension: resilience
- Detail: Every other AI/cost endpoint is wrapped in checkRate, but /route/dump (Voyage batch embed + pass-2 split + batched Groq classify + Gemini vision) and /route/:module (Voyage embed + Groq tool-call) dispatch directly with no checkRate, and the handlers don't rate-limit either. An authenticated user (or leaked Clerk token) can loop them to burn Voyage/Groq/Gemini budget unbounded. The native limiters in wrangler.toml are never applied here. Compounded by the dead /route cache pushing all traffic to paid upstreams. Fix: wrap both in checkRate keyed on the verified Clerk sub (resolveUserIdForRateLimit exists).

**`/route/:module` accepts unbounded text body (no size cap before AI calls)**
- Location: workers/ai-proxy/src/router/route.ts:246-254
- Dimension: validation
- Detail: handleRoute only checks text is a non-empty string — no length bound, no Content-Length guard. /brain-dump caps at 1 MiB and /route/dump at 10k chars, but /route/:module has neither, so a multi-MB text flows straight into voyageEmbed + groqClassify, inflating token cost and worker memory unbounded. Fix: MAX_TEXT_CHARS + 413.

**MoodAction type drift: schema says string enums, mood module says numbers (masked by `as unknown as` double-cast)**
- Location: apps/native/src/modules/mood/types.ts:35-37 vs apps/native/src/router/schema.ts:179-181; handler at mood/handler.ts:32
- Dimension: correctness
- Detail: schema.ts declares valence 'pos'|'neu'|'neg', intensity 1|2|3, level 'low'|'mid'|'high' (the router source of truth). mood/types.ts declares all three as number. The worker emits strings, but handler.ts imports the number MoodAction and uses `as unknown as MoodAction` to suppress the error, then writes p.level/p.valence raw; readers expect numbers (1-5) so numeric aggregation silently misbehaves. The handler's "mood not yet in ActionPayload union" comment is stale (schema.ts:136 already includes it). Fix: import MoodAction from schema, drop the double-cast, map enum→number at write time.

**Finance sync cursor advances past rows that fail to decrypt → permanent silent data loss**
- Location: packages/sync/src/finance.ts:443-444,532
- Dimension: correctness
- Detail: maxUpdatedAt is computed for every row up front, before/regardless of decrypt success. A row whose decrypt throws is caught and skipped (fail-closed) but its updated_at already advanced the cursor, which is written unconditionally. Next pull uses `gt.<cursor>` and never sees the skipped row again — any transient decrypt failure (cold-boot key not rehydrated, truncated payload, relogin window) permanently drops that finance record with only a console.warn. groceryPull handles this correctly by halting; finance violates the pattern. Fix: derive cursor only from successfully-applied rows.

**Inbound sync echoes every pulled module straight back out and corrupts the LWW watermark**
- Location: packages/sync/src/index.ts:248-249, 270-274, 310-314
- Dimension: correctness
- Detail: syncIn applies a remote row via store.setModule, which fires the module subscriber registered in start(): it (1) overwrites the watermark it just set to remoteTs with `now`, and (2) calls debouncedPush(m), re-encrypting and re-uploading the just-pulled blob. Every boot re-uploads all synced modules and stamps the watermark to now, which can cause a genuinely newer remote update from another device to be skipped on the next pull. finance.ts guards against this; index.ts has no suppression. Fix: re-entrancy flag around applyModule to skip local_ts write + debouncedPush.

**Delta-sync cursor uses gt. on a non-unique updated_at — rows sharing the boundary timestamp are permanently skipped**
- Location: packages/sync/src/finance.ts:419-546 (428, 442-444, 532, 544-546)
- Dimension: correctness
- Detail: syncIn pages with order=updated_at.asc, limit=500, advancing via strict `gt.<maxUpdatedAt>`. If the 500th and 501st rows share updated_at (common: server trigger clamps updated_at>=now(), bulk writes produce same-ms ties), the next page's `gt.` excludes every row on the boundary timestamp — silent data-loss-on-pull. encrypted_state (one row per module) is immune; the per-record finance path is exposed. Fix: order by (updated_at, id) with a composite/keyset cursor or gte. + applied-id de-dupe.

**hit_count PATCH uses unsupported `{increment:1}` object — popularity/eviction signal never updates**
- Location: workers/ai-proxy/src/router/route.ts:432; feed-me.ts:776
- Dimension: correctness
- Detail: cacheHitUpdate PATCHes `{ hit_count: { increment: 1 } }`. PostgREST has no increment merge syntax; it sends the literal object as the new value for an `int not null` column → 400. hit_count never increments, last_hit_at never updates, so eviction (evictionScore = hitCount * decay) and popularity retention operate on permanently-zero counts. route.test.ts asserts the PATCH "fires" against a mocked OK, never catching the 400. Fix: atomic increment RPC.

**push_tokens.user_id is uuid but the worker writes Clerk text ids — silent insert failure kills app-closed cron notifications**
- Location: supabase/migrations/20260515000001_notification_delivery.sql:106; apps/api/src/worker.ts:353-373
- Dimension: correctness
- Detail: push_tokens.user_id is `uuid not null references auth.users(id)`, but the register worker POSTs body.user_id = a Clerk id (text). The insert fails on type/FK, so tokens are never mirrored to Postgres and the cron→APNs app-closed notification path has no tokens to push to. Same Clerk-vs-uuid identity mismatch as the dormant account-delete gap, but this path is live. Fix: verify/wire the Clerk→uuid mapping (or change column type) before relying on cron push.

**CadenceHint subline component copy-pasted across 9 module Boxes (already diverging)**
- Location: apps/native/src/modules/{work,finance,sleep,pets,admin,goals,body,cycle,grocery}/*Box.tsx (e.g. WorkBox.tsx:546, FinanceBox.tsx:1027, SleepBox.tsx:330, GroceryBox.tsx:1302)
- Dimension: reinvented-wheel
- Detail: The "last X N days ago · usually every M days" subline is a near-identical CadenceHint in 9 Box files. The math is correctly shared via @ollie/cadence, but the presentation component was never extracted and has drifted: Finance uses a <span fontWeight:500>, others <Text scale=caption>; Sleep accepts nullable estimate while Work/Finance require non-null; Grocery has a different prop signature. Same logic, 9 maintenance points. Fix: extract one <CadenceHint> into lib/ and delete the copies.

**Per-module data-load + poll + window-focus-refetch boilerplate (no shared hook)**
- Location: apps/native/src/modules/{sleep,finance,work,grocery,admin,body,mood,medication,pets,cycle,goals,habits}/*Box.tsx
- Dimension: reinvented-wheel
- Detail: Every Box hand-rolls the same lifecycle: refresh() callback, mount effect with a cancelled flag, a second effect doing setInterval(refresh, POLL_MS) + window focus listener + cleanup, plus a ready flag — ~30 lines repeated across ~13 modules, with POLL_MS=6000 re-declared in 12 files. This is exactly the deterministic plumbing the harness rule wants centralized. Fix: one useModuleData(refreshFn, {pollMs}) hook + a single shared POLL_MS.

---

## Medium

**onResult (the entire dispatch) is fired without await; loading clears before any handler writes**
- Location: apps/native/src/dump/BrainDumpInput.tsx:243
- Dimension: correctness
- Detail: submit() calls `if (onResult) onResult(res.data)` with no await, yet onResult is async and runs dispatchRouterOutput + card setup. submit() resolves and returns to idle before handlers finish their DB writes, so a user can fire a second dump while the first's handlers + fire-and-forget runAllSyncs are in flight (overlapping dispatch+sync), and a synchronous throw in onResult becomes an unhandled rejection. Fix: await onResult or add an in-flight guard.

**shared.actionLog mirror is a read-modify-write that races across overlapping dump syncs**
- Location: apps/native/src/modules/dump/bridge.ts:72-85
- Dimension: resilience
- Detail: syncToStore does get→merge→set on shared.actionLog, not atomic. Because onResult isn't awaited, two dumps' runAllSyncs interleave: both read the same snapshot, second set() overwrites the first, dropping the first's rows. Other modules also write shared.actionLog, widening the window. Append-only archive recovers it on the next sweep, but goals low-mood/sunk-cost detectors can transiently miss a row and concurrent non-dump writers can be clobbered with no recovery. Fix: store.update() with an updater, or serialize runAllSyncs.

**Local crisis false-positive swallows the ack with no banner — dump gives zero feedback**
- Location: apps/native/src/dump/BrainDumpInput.tsx:166-167; DumpScreen.tsx:119-220
- Dimension: correctness
- Detail: submit() withholds the optimistic ack when local detectCrisis matches, deferring to the post-route crisis path. But if the local lexicon trips while the server verdict is NOT crisis (the two detectors are hand-synced separate codebases), onCrisis never fires and onResult intentionally fires no ack — the dump routes and writes but the user sees nothing: a silent success that reads as a dropped dump on an ack-first ADHD product. Fix: in onResult, fire the ack when localCrisis suppressed it AND res.data.crisis is falsy.

**Router payload trusted as typed action with no runtime validation; required strings unguarded in most handlers**
- Location: all apps/native/src/modules/*/handler.ts (grocery, work, admin, medication, cycle, pets)
- Dimension: validation
- Detail: Every handler does `const p = fragment.payload as XAction` — compile-time cast over LLM worker output with zero runtime validation. Only finance/sleep/body/goals guard required strings. normaliseName('') returns '' so an empty item inserts a junk pantry/shopping row; medication.logDose auto-registers a med by name, so an empty med name permanently pollutes the registry. No chokepoint validates RouterOutput before dispatch. Fix: a runtime guard at the dispatch boundary rejecting empty/whitespace required fields (raw dump is archived, so dropping is safe).

**scheduleAt trusts worker-supplied scheduledAtMs with no sanity bounds — past timestamp fires immediately**
- Location: apps/native/src/notify/systemNotify.ts:252-264; admin/handler.ts:125-144; work/handler.ts:183-200
- Dimension: resilience
- Detail: scheduleReminderIfPresent only checks typeof scheduledAtMs === 'number' then hands it to scheduleAt, which fires NOW if delay <= 1000. scheduledAtMs is computed against the worker's clock; clock skew, a replayed/stale dump, or a worker bug emitting a past/absurd-future timestamp fires instantly ("remind me to call mama in 1 minute" → pings now, the exact class of bug noted at systemNotify.ts:234-240) or silently drops the reminder. Fix: reject past/beyond-horizon timestamps, or re-derive fire time from amount/unit against the device clock.

**Module migration promise caches the rejection for the whole session — one transient failure bricks the module until restart**
- Location: apps/native/src/modules/*/migrate.ts (grocery:92-159, finance:132-208, + cycle/goals/admin/medication/habits/body/sleep/work/pets/mood/brain)
- Dimension: resilience
- Detail: Every module memoizes `migrationPromise = (async()=>{...})()` with no reset on failure. If the first migrate rejects (locked DB, partial ALTER, transient plugin error), the rejected promise is cached forever; every subsequent handler.apply awaits it, re-throws, and dispatch converts to ok:false — the module is dead for the session with no retry. Only admin exposes a test-only reset. The sql layer also silently returns null/memShim on Database.load failure, making migrations no-op and reads return empty with no signal. Fix: on failure null out migrationPromise so the next call retries.

**Idle re-render storm: every Box polls every 6s and setState with fresh array identity unconditionally**
- Location: apps/native/src/modules/*/*.tsx POLL_MS=6000 setInterval (mood:62-75, grocery:111-161, work:126-138; 13 boxes)
- Dimension: perf
- Detail: All 13 boxes run setInterval(refresh, 6000) + window focus refresh; refresh() re-reads SQLite and setState's a NEW array/Map identity even when rows are byte-identical, so the open box re-renders its full list every 6s, re-running WhenCaption formatting, qtyLabel, and a useMemo keyed on the new identity (never hits). Bounded to one mounted box but a steady wake-every-6s drain/jank on battery. Fix: compare fetched rows before setState and gate the interval on document.visibilityState.

**Batched classify is all-or-nothing: one count mismatch fails the whole dump with no partial salvage**
- Location: workers/ai-proxy/src/router/dump-classify.ts:240-243, 275-303; dump.ts:362-381
- Dimension: resilience
- Detail: classifyBatch sends all cache-miss fragments in one call; parseBatchResults THROWS if results.length !== expected. The cascade retries the same prompt; if every provider miscounts (common with weaker fallback models on a 6+ fragment dump), the whole dump returns 502/429 — every fragment lost, including correctly-classified ones. The old per-fragment path failed only the bad fragment. Fix: on terminal count-mismatch fall back to per-fragment classifyFragment for the misses, or pad/truncate + mark unmatched needsConfirm.

**Gemini/vision retry doubles a full multimodal request on 429/503 with no jitter — thundering-herd + double cost**
- Location: workers/ai-proxy/src/gemini.ts:64-71; vision.ts:76-83
- Dimension: resilience
- Detail: Both Gemini callsites retry once on 429/503 with a fixed sleep (900/1000ms) and no jitter. When Gemini is rate-limited, every concurrent worker invocation sleeps the same interval and re-fires together — a synchronized second wave that worsens the overload, and vision re-uploads the full base64 image (up to 8MB), doubling egress + token cost on the request most likely to fail again. Violates harness rule 5 (exponential backoff + jitter). Fix: add jitter, prefer cascade advance over in-place retry, cap vision retry to 503 only.

**Cross-module mirror in body.log_movement leaks an orphan pets row on undo**
- Location: apps/native/src/modules/body/handler.ts:177-207
- Dimension: correctness
- Detail: body.log_movement mirrors to pets.log_care via petsEvents.logCare when the payload carries a `pet` hint, but unlike every other Approach-B mirror (grocery→finance, finance→admin, sleep→medication, work→body) it does not capture the mirrored row id; undo is just undoFor(body row). Undoing "walked the dog" deletes the body movement but leaves a permanent orphan pets care row. Fix: capture the pets row id and remove both on undo.

**Snooze reschedule on native macOS path drops the original notification title/body**
- Location: apps/native/src/notify/notificationActions.ts:96-104,113-119; local_notifications.rs:239-243
- Dimension: correctness
- Detail: snooze reschedules with `{ title: title ?? 'reminder', body }`, but the native macOS delegate emits only { actionId, extra } and never forwards title/body. So tapping "Snooze 1h" on a real macOS reminder reschedules to literally "reminder" with no body — the user loses what it was about. The iOS plugin path forwards title/body and works; only the macOS native path (the documented primary dogfood surface) is broken. Fix: include title/body in the Rust ollie-notif-action payload, or re-derive from extra.refId.

**Central ledger-based SQLite migration runner is dead code; 14 modules reinvent the PRAGMA-probe-then-ALTER it was built to replace**
- Location: apps/native/src/storage/migrate.ts:45-88
- Dimension: reinvented-wheel
- Detail: storage/migrate.ts ships a versioned, idempotent, resume-safe ledger runner (runMigrations + appliedMigrations) whose header says it exists so modules stop hand-rolling CREATE TABLE IF NOT EXISTS + PRAGMA backfills. But runMigrations/appliedMigrations have ZERO production callers; only addColumnIfMissing is used, and only by admin. All other 13 modules still hand-roll the exact pattern the runner was meant to eliminate, with subtly different error handling. The claimed safety properties are delivered nowhere. Fix: migrate modules onto the runner, or delete it to stop implying a guarantee.

**Time-windowed work/goals cues are never driven by a timer — narrow-window reminders silently missed**
- Location: packages/orchestrator/src/work.ts:273-372,408-438; goals.ts:228-313,325-358
- Dimension: correctness
- Detail: scanCues() runs ONLY on a 500ms debounced store-key subscription + a single cold-start scan. There is no recurring timer. But the cues match narrow wall-clock windows (meeting 28-32min, session_end 0-3min, 90-min warn 85-90min; goals weekly Sunday, deadline 28-32d, paused_14d). If no relevant store mutation lands inside the window, the scan never runs and the reminder never fires. The cadence-scanner's 30-min interval and main.tsx's pantry scan are separate paths that don't call scanCues. Fix: add a recurring foreground timer in each orchestrator init() (1-min for work, daily-at-local-time for goals), mirroring medication/cycle/body.

**work/goals scanCues dedup is in-memory only and the system-notification path ignores dedupe_key — cues re-fire on every app restart**
- Location: packages/orchestrator/src/work.ts:148,264-271,445; goals.ts:130,219-226,365; systemNotify.ts:383-393
- Dimension: correctness
- Detail: Both scanCues dedup via a module-instance Set (firedCues) cleared on teardown and never persisted; the native scheduleSystemNotification adapter DROPS spec.dedupe_key entirely (unlike notify() which enforces 24h dedupe). On every restart/reload the Set resets and any cue whose window is still satisfied re-fires (work four_blocks_today re-pings if ≥4 blocks today; goals deadline_30d re-pings while in the 28-32d band) — ADHD-shame risk. Fix: persist fired-cue keys to the store, or route through notify() which honors dedupe_key.

**cadence-scanner persisted dedup key is scoped to local calendar day but notify()'s dedup is a rolling 24h window — second push near midnight**
- Location: packages/orchestrator/src/cadence-scanner.ts:241-244,376-388; packages/notifications/src/budget.ts:79-82
- Dimension: correctness
- Detail: buildDedupeKey appends localDayKey so the key rotates at local midnight, with a comment claiming this "matches notify()'s 24h dedupe scope" — it does not. notify()/isRecentlySeen dedups against now-24h keyed by the exact string. An item firing at 23:30 Monday gets a new key string at 00:30 Tuesday, so both the scanner's dedup and notify() see it as new → two pushes ~1h apart for the same overdue item. Fix: a stable per-item min-interval check (≥20h) independent of the day suffix, and correct the comment.

**Cross-tab invalidation never fires per-key (subscribeKey) listeners**
- Location: packages/store/src/cross-tab.ts:25; store.ts:75-101, 164-168
- Dimension: correctness
- Detail: installCrossTabSync calls _invalidateModule(mod) → notify(mod, '*', next). In notify, the per-key fan-out block is skipped when key === '*', so only module-level subscribe() listeners are notified — every subscribeKey() listener stays stale. useStoreSlice and most orchestrators rely on subscribeKey, so a cross-tab write invalidates the cache but never re-renders/recomputes until something else triggers them. Bounded on single-window desktop/mobile, real on web/PWA multi-tab. Fix: fan out to all key subscribers for the module on cross-tab invalidate.

**store.set hands subscribers and getModule callers a live reference to the internal cache object**
- Location: packages/store/src/store.ts:48-64, 129-134, 146-152, 91, 130
- Dimension: correctness
- Detail: readModule caches and returns the same parsed object instance; set() mutates state[key] in place then notify() passes readModule(mod) (the same mutated object) to '*' subscribers, and getModule() returns the live cache. A consumer that retains the object sees mutations it never subscribed to, and a consumer that mutates it corrupts the cache outside set() (no persist, no notify). Orchestrators reading getModule are exposed. Fix: shallow-copy before mutating in set(); return a clone/frozen copy from getModule().

**Empty-after-scrub guard misses MEDICAL/MEDICATION/SEXUAL/MENTAL_HEALTH tokens — ships sensitive-only rows to research corpus**
- Location: packages/orchestrator/src/research.ts:163, 265
- Dimension: pii-scrub
- Detail: Both flush() and runResearchPipeline() strip only (EMAIL|PHONE|ADDRESS|URL|GPS|NUMERIC|NAME) before the `stripped.length < 3` skip, but @ollie/pii-scrub also emits [MEDICAL], [MEDICATION], [SEXUAL], [MENTAL_HEALTH]. So "I have endometriosis" → "[MEDICAL]" and self-harm phrases → "[MENTAL_HEALTH]" pass the empty-after-scrub filter and are POSTed to /label and appended to research_corpus. Raw PII is redacted (no plaintext leak) but it pollutes the corpus with placeholder-only rows and routes the most sensitive categories into the labeling pipeline the scrubbers exist to keep out. Fix: add the sensitive categories to both strip regexes, ideally derived from the RedactionType union.

**Multi-word allowlisted brands are over-redacted to [NAME], destroying the B2B brand signal**
- Location: packages/pii-scrub/src/index.ts:310-318, 388-439; brand-allowlist.ts:17-71
- Dimension: pii-scrub
- Detail: The allowlist has ~12+ multi-word entries (General Mills, Burger King, Amazon Prime, etc.), but isBrand() is only ever called on a single token (the name-pass tokenizer splits on non-letters / operates per-word). isBrand('general') and isBrand('mills') both return false, so "General Mills" → "[NAME] [NAME]". Single-word brands are protected; every multi-word brand is silently destroyed — defeating the documented purpose of the allowlist. Fix: a brand-phrase pass before the name pass that scans 1-3 token windows against the allowlist.

**apns-push worker duplicates ES256 JWT signing + json() instead of using @ollie/apns-jwt and @ollie/worker-http**
- Location: workers/apns-push/src/index.ts (getApnsJwt/pemToBinary/b64url/__jwtCache, local json ~155-200)
- Dimension: reinvented-wheel
- Detail: @ollie/apns-jwt exists to be "one copy to audit and maintain" and apps/api uses it correctly, but the LIVE push worker (invoked by cron via APNS_PUSH binding) still hand-rolls its own getApnsJwt/pemToBinary/b64url/__jwtCache and a local json(). Two independent ES256 implementations for the same Apple key; the apns-jwt doc even claims it replaced this copy, but it was never removed. Fix: import createApnsJwtSigner + json/notFound, add the workspace deps, delete the local copies.

**Crisis lexicons still PENDING_SERRA_APPROVAL — the module's own invariant forbids shipping to alpha**
- Location: packages/crisis-lexicon/data/lexicon.{en,tr,es}.json vs src/index.ts:14-16
- Dimension: standards
- Detail: All three lexicons carry last_reviewed_by="PENDING_SERRA_APPROVAL"; the module header states this must be @serra before any merge that ships to alpha. The data backs both the router's crisis classifier and the client-side zero-network safety net, yet nothing prevents an alpha build from shipping unreviewed crisis content (a missed crisis signal is the unrecoverable direction). Fix: get the lexicons reviewed and stamped, or add a vitest that fails when any last_reviewed_by === 'PENDING_SERRA_APPROVAL'.

**Sentry tunnel is an unauthenticated open relay with no rate limit — quota-burn / abuse vector**
- Location: workers/sentry-tunnel/src/index.ts:25-98
- Dimension: security
- Detail: Accepts any POST from any origin (CORS *, no auth, no rate limit, no body-size cap) and forwards to Sentry ingest as long as the envelope DSN matches a hard-coded host+project allow-list. The DSN public key ships in the client bundle (public by design), so the allow-list is not a secret — anyone can craft envelopes to flood the Sentry project, burn event quota/overage, or inject forged errors. Fix: body-size limit + per-IP rate limit + optional non-secret shared header.

**iOS App Transport Security fully relaxed (arbitrary loads in web content)**
- Location: apps/native/src-tauri/gen/apple/native_iOS/Info.plist:34-40
- Dimension: security
- Detail: NSAppTransportSecurity sets NSAllowsArbitraryLoadsInWebContent=true and NSAllowsLocalNetworking=true. The first disables ATS for all WebView content, permitting plaintext HTTP / untrusted-TLS loads inside a webview that already runs as a remote origin with no CSP. NSAllowsLocalNetworking is justified (localhost server); the blanket arbitrary-loads is broader than needed. Generated file — fix must go in the source/template or a regen reverts it. Fix: keep local networking, remove arbitrary-loads-in-web-content or scope per-domain NSExceptionDomains.

**/brain-copy not covered by index-level rate limit**
- Location: workers/ai-proxy/src/index.ts:386-388
- Dimension: resilience
- Detail: /brain-copy dispatches to handleBrainCopy with no checkRate; brain-copy.ts doesn't rate-limit either. It calls Groq gpt-oss-120b (maxTokens 600). Auth + 4000-char prompt cap bound per-request blast radius, but an authenticated user can loop it to burn Groq budget. Lower than /route/dump because the client caches per noticing/day/lang with static fallback. Fix: wrap in the same per-user checkRate (TELEM_RATE_LIMITER).

**MAD scaling convention is contradictory across finance writers and readers — cash-flow band and anomaly z-scores miscalibrated**
- Location: packages/logic/src/finance/recurring.ts:99-122,226; anomaly.ts:43,102; reports.ts:184,195,278,287; math.ts:40-43
- Dimension: correctness
- Detail: Two incompatible definitions of what *_mad stores. Writers via fMad store SCALED MAD (1.4826*rawMAD ≈ σ); readers treat it as RAW and re-scale (reports.ts cash-flow does 1.4826 * amount_mad; predictNextDue does 1.4826 * mad). Feeding a buildPattern result into these double-scales (≈2.20× rawMAD): the cash-flow band is ~48% too wide and predictNextDue downgrades tight schedules. detectAnomaly divides the modified-z by ~σ instead of rawMAD, making it ~1.4826× too small so the 3.5 threshold misses real outliers. reports.ts analyzePayFrequency writes RAW, so writers also disagree. Fix: pick one convention (store RAW), align all writers/readers, add a fixture test.

**computeMonthlyOutflow month arithmetic skips short months on the 29th-31st — month-over-month baseline double-counts current month**
- Location: packages/logic/src/finance/recurring.ts:484-534
- Dimension: correctness
- Detail: Builds the target year-month with setMonth on a Date still carrying the current day-of-month. On March 31, offset -1 sets Feb but Feb 31 rolls to March 3 → ym stays '2026-03' instead of '2026-02'. So monthOverMonthDelta gets the current month's outflow in place of the prior month and skips it for ~3 days each month. Fix: normalize to the 1st before shifting.

**Cold-start / boot-relative timer drift in orchestrators (change-point window, body hourly tick)**
- Location: packages/logic/src/cycle/posterior.ts:53-65; predict/posterior.ts:80-92; packages/orchestrator/src/body.ts:340-345
- Dimension: correctness
- Detail: (a) detectChangePoint gates on length≥9 but takes recent=slice(-6) vs older=slice(-12,-6), so for 9-11 observations it compares 6 points against 3-5 — asymmetric noise exactly in the early-history regime; cycle/posterior.ts also lacks the `pooledSd > 0` guard predict has, diverging on a perfectly-regular→regular shift. (b) body's emitSupplementDue/emitPostureNudge run on a boot-relative hourly setInterval, not aligned to the clock hour, so a top-of-hour due item may not be evaluated for up to ~59 min. Fix: require length≥12 (or symmetric windows) + add the pooledSd guard; align the body tick to the next clock hour.

**scheduleWeeklyReview / scheduleBodyCorrelationPass can busy-re-arm if a setTimeout fires early (suspend/resume, clock skew)**
- Location: packages/orchestrator/src/body-weekly.ts:406-415; body-correlations.ts:282-295
- Dimension: resilience
- Detail: arm() computes delay = max(0, fireAt - now) and on fire re-arms. setTimeout isn't guaranteed to fire at-or-after target across suspend/resume or wall-clock change; an early fire can produce a 0ms re-arm loop. emitWeeklyReview is idempotent per ISO week, but runBodyCorrelationPass only cools down on emit, not on the pass, so a 0-delay loop re-runs the full snapshot+correlations every tick until the clock crosses the boundary. Fix: floor the re-arm delay (≥60s) and verify now >= fireAt before treating it as real.

---

## Low

**Cmd+Enter submit path has no in-flight guard against re-entrant submits**
- Location: apps/native/src/dump/BrainDumpInput.tsx:141-151, 246-255
- Dimension: resilience
- Detail: submit() sets state to 'loading' but has no early-return when already loading; the only guard is the disabled button/textarea. Cmd+Enter calls void submit() directly, and because onResult isn't awaited state flips back quickly, so a rapid second Enter (or mic auto-submit during a manual submit) launches a second concurrent route of a near-identical dump — a duplicate write given the no-idempotency finding. Fix: `if (state.kind === 'loading') return;` + an in-flight ref.

**Box load effects run a migration on every mount with no module-level guard**
- Location: apps/native/src/modules/work/WorkBox.tsx:112-124; grocery/GroceryBox.tsx:130-147 (mirrored across modules); grocery/bridge.ts:38
- Dimension: resilience
- Detail: Each box's mount effect awaits migrate<Module>() before first refresh, and the cancelled flag guards only setState, not the migration. migrateGrocery also runs inside syncToStore (boot + every dump). Repeated mounts (StrictMode, quick route flips) re-invoke the migration; if any isn't strictly idempotent/cheap it's redundant first-paint I/O. Relies on an unstated idempotency invariant spread across many modules. Fix: run migrations once at boot or gate behind a session flag.

**GroceryBox auto-archive effect can re-fire on transient poll snapshots**
- Location: apps/native/src/modules/grocery/GroceryBox.tsx:207-229
- Dimension: correctness
- Detail: The effect depends on pantryItems, replaced with a fresh array every 6s poll. Between archive() resolving and refresh() completing, a poll can re-set pantryItems to a snapshot still containing the not-yet-archived row, re-triggering the effect and issuing duplicate archive() calls. archive is presumably idempotent so data stays correct, but it's redundant writes driven by poll cadence. Fix: track in-flight archive ids in a ref, or derive from a single authoritative read.

**useStoreSlice returns a new setter function every render (unmemoized)**
- Location: packages/store/src/react.ts:27
- Dimension: clean-code
- Detail: Returns [value, (next) => store.set(...)] where the setter is re-created every render; consumers that list it in a useEffect/useCallback dep or pass it to a memoized child re-run effects and defeat memoization, contrary to React's useState contract. Fix: useCallback keyed on [store, mod, key].

**encryptedKv envelope omits the PBKDF2 iteration count — guaranteed decrypt failure after any future iteration bump**
- Location: apps/native/src/storage/encrypted.ts:39-61
- Dimension: correctness
- Detail: The S7 crypto redesign requires every envelope to store its iteration count and the read path to pass it to deriveKey (LEGACY fallback). Auth vault and finance export do this; encryptedKv.set() persists only {iv, ciphertext, salt} and get() calls deriveKey without iterations (always current default). Round-trips today, but the moment PBKDF2_ITERATIONS is bumped, every previously-written value becomes permanently undecryptable. No production caller wires encryptedKv yet, so it's a latent landmine. Fix: add kdf_iter to the envelope, write it, and read it with a LEGACY fallback.

**kv.get does unguarded JSON.parse — a single corrupt stored value throws on every read of that key forever**
- Location: apps/native/src/storage/kv.ts:38-49
- Dimension: resilience
- Detail: kv.get returns JSON.parse(raw) with no try/catch. A truncated/corrupted value (crash mid-write, external edit, partial disk write) throws a SyntaxError up through encryptedKv.get and any other reader, and the bad value is never cleared so the key keeps throwing. The crypto layer hardened the analogous corrupt-plaintext case; the kv layer feeding it was not. Fix: wrap the two parses in try/catch returning null.

**finance renewal_for whitelist drifts from schema enum and silently swallows valid mirror types**
- Location: apps/native/src/modules/finance/handler.ts:47-52 vs router/schema.ts:264
- Dimension: correctness
- Detail: The admin-renewal mirror gates on a hardcoded 8-literal ALLOWED_RENEWAL_TYPES Set duplicating the schema's renewal_for enum, while admin.log_renewal accepts an open union. If the schema enum gains a value, the finance handler silently won't mirror it (no error, no admin row) until someone notices the missing renewal. Fix: derive the whitelist from a shared constant, or relax to mirror any non-empty renewal_for.

**work.start_timer uses a raw setTimeout that dies with the process / does not survive app close**
- Location: apps/native/src/modules/work/handler.ts:126-147
- Dimension: resilience
- Detail: start_timer schedules its completion notification via a bare setTimeout(mins*60_000). If the app is quit before it fires (or backgrounded on iOS where JS timers freeze), no notification is produced — unlike the remindIn path which arms scheduleServerReminder → cron → APNs. The timer isn't persisted so it can't be resumed after a reload. Fix: route through scheduleAt + scheduleServerReminder, or persist + re-arm on reload.

**scheduleReminderIfPresent duplicated near-verbatim between admin and work handlers**
- Location: apps/native/src/modules/admin/handler.ts:119-145; work/handler.ts:177-201
- Dimension: reinvented-wheel
- Detail: The two helpers are byte-identical except extra.module ('admin' vs 'work') and action_url. Both build the same `reminder:<taskId>` dedupe id and call scheduleAt + scheduleServerReminder. Both contain a comment justifying non-extraction "while only two callers exist" — there are now exactly two diverging only by two params. Fix: extract scheduleTaskReminder(remindIn, taskId, {title, body, module, actionUrl}).

**Deep-link box target not validated against module allowlist**
- Location: apps/native/src/navigation/useDeepLinks.tsx:39
- Dimension: validation
- Detail: resolveDeepLink maps ollie://box/<rest> to /box/<rest> stripping only leading slashes, with no allowlist check. Any external app/page can fire ollie://box/<anything>. Blast radius is limited today (unknown ids fall to BoxPlaceholder/NotFound) but it's unvalidated external-input → navigation that becomes a problem when /box/:id gains side effects. Tests cover only happy-path ids. Fix: validate rest against known module ids; add adversarial cases (.., encoded slashes, query strings).

**Notification category_id and extra_json piped from webview into OS userInfo without validation/length cap**
- Location: apps/native/src/notify/systemNotify.ts:295-305; local_notifications.rs:128-194
- Dimension: validation
- Detail: The webview emits ollie-schedule-notif with arbitrary category_id and extra_json; Rust schedule() stores them verbatim with no shape/size check (only the snapshot path is capped). routeNotificationAction does guard module ∈ {admin,work} + requires refId (good), but title/body/extra are unbounded and fully attacker-influenced if the event channel is reachable — compounding the remote-ACL/CSP issues. Fix: cap title/body/extra_json length in Rust schedule(), validate category_id against the known REMINDER_CATEGORY constant.

**Cold-start deep link guarded only per hook-instance, not per process**
- Location: apps/native/src/navigation/useDeepLinks.tsx:60, 76-84
- Dimension: correctness
- Detail: coldHandled is a useRef local to each useDeepLinks() instance. It protects StrictMode double-invoke, but on remount (auth flip between SignedIn/SignedOut, fast-refresh, route-level remount) a new instance gets a fresh false and re-applies getCurrent(), re-navigating the user to the original launch deep link. The "handled once" invariant is tied to component lifetime, not app lifetime. Fix: promote the flag to module scope.

**/validate-invite is unauthenticated with no per-user rate limit (enumeration surface)**
- Location: workers/ai-proxy/src/index.ts:375-377; invites.ts:148-193
- Dimension: resilience
- Detail: handleValidateInvite is intentionally unauthenticated (landing page reads it pre-signup) and does a service-role Supabase lookup per call with no rate limit (only /generate-invite has the 5/day cap). The 30^8 keyspace makes brute-force impractical, but unauthenticated callers can still loop unbounded service-role reads. The comment's stated intent ("rely on the per-IP CF rate limit") isn't actually implemented. Fix: add a per-IP checkRate on /validate-invite and /claim-invite.

**partner snapshot phrases not length-capped per entry**
- Location: workers/ai-proxy/src/router/partner.ts:168-170
- Dimension: validation
- Detail: putSnapshot filters phrases to strings and slices to 5 entries but, unlike self_word (capped at 40 chars), does not cap each phrase's length. An authenticated user can store 5 arbitrarily large strings served verbatim to the paired partner, and /partner/* has no shared body-size cap. Fix: .slice(0, 200) per phrase.

**ai_call cost metric mislabels every cascade/tier call, defeating cost attribution**
- Location: workers/ai-proxy/src/groq.ts:127-137; route.ts:525; json-cascade.ts:76
- Dimension: perf
- Detail: Only groqChat emits the ai_call metric; Gemini/CF/OpenRouter cascade fallbacks emit none, and the tier-ladder always passes the static label 'route' regardless of fast vs accurate model. So the live cost dashboard systematically undercounts spend — every Gemini fallback, CF/OpenRouter call, and accurate-model escalation is invisible. Compounded by the dead /route cache pushing more traffic to fallbacks. Fix: emit a uniform ai_call metric from all providers and thread the real model name + tier into the label.

**label.ts MAX_SCRUBBED_CHARS const (2000) contradicts the documented 280-char hard cap**
- Location: workers/ai-proxy/src/label.ts:24, 63, 130
- Dimension: clean-code
- Detail: The header promises "Hard cap: 280 chars" as a cost guard, but MAX_SCRUBBED_CHARS = 2000 and safe is sliced to 2000 — ~7x the documented bound. Per-call Anthropic input cost (and ESTIMATED_COST_PER_CALL_USD=0.001 used to decrement the daily budget) is understated, so the soft daily budget can blow before the KV counter says so. Fix: reconcile comment and constant, re-derive the cost estimate from the actual max input size.

**Per-user Vectorize cache lookup is not module-scoped — cross-intent poisoning possible within a user**
- Location: workers/ai-proxy/src/router/vectorize.ts:83-122
- Dimension: correctness
- Detail: cacheLookup queries Vectorize with filter:{userId}, topK:1, similarity ≥0.85, returning whatever module the top match was cached under, with no module/intent guard. Two semantically-near phrases meaning different things ("apple" grocery vs "apple stock" finance; "walk" body vs "walk the dog" pets) can collide above 0.85 and inherit the wrong cached module + payload with source:'cache'. Uncommon at 0.85 but possible for short fragments. Fix: topK>1 + intent-compatibility check, or a normalized-text fingerprint requiring shared key tokens for short fragments.

**Queues consumer/producer blocks are LIVE but comments claim they are commented out — deploy-breaking contradiction**
- Location: workers/cron/wrangler.toml:45-63; workers/ai-proxy/wrangler.toml:64-80
- Dimension: correctness
- Detail: The header comment says "COMMENTED OUT ... an uncommented consumer binding pointing at a queue that does not exist makes wrangler deploy FAIL," but the [[queues.consumers]] / [[queues.producers]] blocks below are active TOML. Either (a) the queues were never provisioned and deploy will FAIL as warned, or (b) they exist and the system silently migrated onto native Queues while every code comment still asserts the KV path is authoritative — ops can't reason about which delivery path is live. Unreviewed since the 951cf2b port. Fix: make code + comments + TOML agree.

**enriched_signals INSERT is not idempotent — a retry after a partial-write crash can duplicate signal rows**
- Location: workers/cron/src/drain.ts:200-215, 325-364
- Dimension: correctness
- Detail: processOne upserts raw_dumps idempotently then plain-INSERTs enriched_signals (no on_conflict). The safety argument breaks for the native Queues path: handleEnrichQueueBatch calls message.retry() on ANY throw, including after insertEnrichedSignal succeeded but before ack, or a transient network error on a committed write. On redelivery raw_dumps merges but enriched_signals gets a second row. Live now that the queue path is wired. Fix: unique constraint on dump_id + on_conflict=dump_id merge.

**Enrich drain BATCH_CAP of 50 is consumed by retry-counter keys, shrinking real throughput**
- Location: workers/cron/src/drain.ts:120-124
- Dimension: correctness
- Detail: KV list uses prefix `q:enrich:` limit 50, but RETRY_PREFIX `q:enrich:retry:` is a strict extension of that prefix, so retry counters fill the 50-key page and are then skipped. When many dumps are stuck retrying, the drain processes far fewer than 50 actual payloads per tick (worst case near zero), starving healthy dumps behind a failing backlog. Fix: store retry counters under a disjoint prefix.

**APNs JWT cache never invalidates on a 403 ExpiredProviderToken — pushes fail for up to ~45 min with no self-heal**
- Location: workers/apns-push/src/index.ts:153-187 (124-129)
- Dimension: correctness
- Detail: The module-global __jwtCache is shared across isolate requests and reused while >15 min validity remains (~45 min reuse, fine per policy). But if Apple rejects the token early (clock skew, key rotation), the cache is never invalidated on a 403 ExpiredProviderToken, so every push for the remaining window returns 403 with no self-heal. Fix: on 403 ExpiredProviderToken, null __jwtCache and retry the sign once.

**KV rate-limit is a non-atomic read-modify-write — under-counts under concurrent pushes**
- Location: workers/apns-push/src/index.ts:135-149
- Dimension: resilience
- Detail: checkRate does get then put(count+1) with no atomicity; KV is eventually consistent with no CAS, so N concurrent requests in the same 1s slot all read the same count and pass, and a burst straddling a second boundary gets 2× budget. Low impact (only cron, internal-secret-gated, batched calls) but the documented "5 req/sec per user" guarantee isn't enforced. Fix: Durable Object or native Rate Limiting binding, or downgrade the comment to best-effort.

**Dead env var SUPABASE_SERVICE_ROLE_KEY declared and documented but never read**
- Location: workers/cron/src/index.ts:36; wrangler.toml:72; README.md:39
- Dimension: clean-code
- Detail: The cron Env declares SUPABASE_SERVICE_ROLE (used everywhere) and SUPABASE_SERVICE_ROLE_KEY (read nowhere). Ops are told via wrangler.toml note + README + test fixture to provision a second copy of the most powerful Supabase key that does nothing — a wasted rotation surface and a confusion about which is authoritative. Fix: delete it from Env/toml/README/fixture; add back when the daily stubs need it.

**Luteal-spending correlation injects structural-zero days, biasing Spearman ρ and inflating sample size**
- Location: packages/logic/src/body/correlations/luteal-spending.ts:115-136
- Dimension: correctness
- Detail: The day loop pushes a point for every luteal day, using spend=0 for days with no transaction. For a sparse logger most days are (day, 0); these structural zeros pull the Spearman rank correlation and inflate sampleSize so minN≥14 passes on a handful of real observations, and the "avg $X/day" copy is computed over a mean including the zero days. Fix: decide whether zeros are signal; if not, restrict the paired series to logged-transaction days and base minN on non-zero days.

**friction-signature day-of-week rate can exceed 1 and valley index can resolve to a zero-data weekday**
- Location: packages/logic/src/habits/detectors-tier0.ts:520-535
- Dimension: correctness
- Detail: dowRate = dowCount / (dowDays * arr.length) assumes one-habit-per-day, so a habit completed multiple times a day pushes the rate above 1.0, distorting the peak/valley spread and the spread≥minSpread gate. The valley uses indexOf(min) on the unfiltered array, so if min===0 it returns the first 0 which may not be the intended valley. Fix: clamp/dedupe completions to one-per-habit-per-day; search the valley index within the filtered set.

**Sleep-debt window cutoff mixes local-midnight date parse against an epoch cutoff at the boundary**
- Location: packages/logic/src/sleep/stats.ts:59-80
- Dimension: correctness
- Detail: cutoff = now - W*DAY_MS (epoch) but inclusion uses new Date(night_of+'T12:00:00').getTime() >= cutoff (local). Noon anchoring avoids DST (good), but >= against a cutoff derived from an arbitrary now time-of-day covers W days plus the fractional part of today, so nightsCounted is off-by-one near the edge depending on when the function runs. Deterministic when now is injected (tests do); production wall-clock calls get a jittery boundary. Fix: normalize cutoff to a day boundary.

**bootstrapCI default RNG seed is coupled to the iteration count**
- Location: packages/logic/src/stats/index.ts:166-191
- Dimension: clean-code
- Detail: The default rng is mulberry32(iters), so two callers differing only in iters get different RNG streams and bumping iters for precision silently changes the resampling stream rather than just adding samples; there's no way to vary the seed without varying iters. Fix: default to a fixed constant seed or accept an explicit seed option.

**Finance outbound LWW timestamp source diverges from inbound LWW comparison**
- Location: packages/sync/src/finance.ts:266 vs 501-505
- Dimension: correctness
- Detail: On push, updated_at_ms = last_edited_at else now() (created_at ignored). On pull, LWW uses last_edited_at ?? created_at ?? 0 for both sides. A record with only created_at is pushed with updated_at_ms=now() but compared on pull via created_at, so the per-record LWW winner is decided on a different clock than the write. Edge case but can let a stale record win. Fix: use `last_edited_at ?? created_at ?? now()` consistently for both the queued ms and the comparison.

**Migration snapshot pruning relies on millisecond-unique Date.now() keys for chronological ordering**
- Location: packages/store/src/migrations.ts:116, 162-176
- Dimension: resilience
- Detail: Snapshot keys are `...pre_migration.${Date.now()}` and pruneOldSnapshots sorts them lexically. Two migration runs within the same ms (fast test/boot loops) collide and the second setItem overwrites the first snapshot; lexical sort is only chronological while digit count is constant (benign until 2286). The real risk is same-ms snapshot loss. Fix: append a random suffix/counter or store a numeric timestamp field and sort numerically.

**Notification daily-cap counts the local day of `now`, not of each delivery, and disagrees with the cron-side cap definition**
- Location: packages/notifications/src/budget.ts:57-65, 47-51
- Dimension: correctness
- Detail: countDeliveredToday uses startOfLocalDay(now) and counts log entries with ts >= start. The same log is also consulted by the server-schedule path, but the client counts against local-day-of-now while the cron worker enforces against its own clock with a stamped cap — no shared "today" definition. On a travel/DST boundary the two can disagree, letting the cap be exceeded by the sum of both paths. Fix: document as best-effort across client+cron, or unify on a single UTC/user-tz day window shared by both enforcers.

**research-stream device_id fallback UUID throws if crypto.getRandomValues is unavailable**
- Location: packages/research-stream/src/index.ts:338-349
- Dimension: resilience
- Detail: randomUuid() tries crypto.randomUUID() then falls back to crypto.getRandomValues(bytes); if the runtime has no crypto, the fallback dereferences getRandomValues on undefined and throws out of synchronous track()/ensureDeviceId(), violating the module's never-throw-on-failure contract. Low (Tauri/iOS/Node 20 all have crypto). Fix: guard the fallback to a non-crypto random id, and/or wrap ensureDeviceId in track().

**apps/api /account/delete keys deletion on Supabase Auth uuid while the app's identity is Clerk text — would silently delete zero rows if deployed**
- Location: apps/api/src/account-delete.ts:111-121, 263
- Dimension: correctness
- Detail: USER_SCOPED_TABLES deletes by user_id uuid and resolveUser asks Supabase Auth, but @ollie/auth identity is Clerk (text). If deployed as the GDPR erasure path, a Clerk-authenticated user resolves to no/empty Supabase user_id and the cascade deletes nothing while reporting success — a GDPR false-positive. Latent: apps/api is never deployed. Fix: verify/wire the Clerk→uuid mapping and fail closed when resolveUser yields no id before deploying.

---

## Cross-cutting cleanups (low)

**RemoveButton reimplemented 11 times with drifting styles**
- Location: apps/native/src/modules/{mood,medication,finance,work,body,goals,grocery,sleep,cycle,admin,pets}/*Box.tsx
- Dimension: clean-code
- Detail: An identical "remove" text button is locally redefined in 11 module files and has drifted (AdminBox adds type=button + cubic-bezier transition, BodyBox a 200ms ease, CycleBox fontFamily). A ui/Button primitive is bypassed; only AdminBox sets type=button, so the other 10 submit any enclosing form. Fix: a single RemoveButton (or ui/Button variant) with type=button baked in.

**formatDays helper defined identically in 9 files**
- Location: apps/native/src/modules/{finance,cycle,pets,work,sleep,grocery,body,goals,admin}/*Box.tsx
- Dimension: reinvented-wheel
- Detail: The byte-identical singular/plural day-count formatter belongs in @ollie/cadence (alongside daysSinceLast) not duplicated per module. Fix: move it to the shared layer, export once, delete the 9 copies.

**SMCP_STYLE small-caps constant duplicated 15 times**
- Location: apps/native/src/modules/*Box.tsx (14×) + navigation/Router.tsx:48
- Dimension: clean-code
- Detail: const SMCP_STYLE = { fontVariantCaps:'all-small-caps', letterSpacing:'0.08em' } is byte-identical in 14 module files + Router.tsx; a theme tokens file already exists. Fix: add smallCaps (and a <Kicker>/<ModuleHeader>) to theme/ui and import.

**Type scale primitive (Text) bypassed by 157 raw inline fontSize declarations**
- Location: apps/native/src/modules/*Box.tsx (FinanceBox 26, GroceryBox 21, MedicationBox 18, FeedMeView 17, GoalsBox 14...) + 72 inline fontFamily
- Dimension: standards
- Detail: ui/Text.tsx defines a deliberate type scale and theme/tokens.ts a space scale, yet modules set fontSize/fontFamily/letterSpacing inline 157+ times, mixing <Text scale> and raw <span fontSize:74> in adjacent rows. Typography is inconsistent screen-to-screen and can't be retuned centrally. Fix: route text through <Text scale>, add the few missing hero sizes, pull spacing from the space token.

**Module Box screens are oversized god-files (1000-1349 lines)**
- Location: grocery/GroceryBox.tsx (1349), finance/FinanceBox.tsx (1268), medication/MedicationBox.tsx (1082), work/WorkBox.tsx (1005), goals/GoalsBox.tsx (998), grocery/FeedMeView.tsx (907), admin/AdminBox.tsx (880)
- Dimension: clean-code
- Detail: FinanceBox packs ~13 components into one file; the size hides the cross-file duplication (each file re-grows its own RemoveButton/formatDays because nobody can see the others). Fix: split each Box into a folder (container + ./rows/ + ./forms/), extracting genuinely shared pieces to ui/ first.

**Dead layout primitives: Container, Spacer, and (near-dead) Box**
- Location: apps/native/src/layout/Container.tsx (0 importers), Spacer.tsx (0 importers), Box.tsx (only navigation/Layout.tsx)
- Dimension: clean-code
- Detail: The layout barrel exports five primitives but only Stack (26) and Row (22) are used. Container and Spacer have zero consumers; Box has one. ~310 lines of dead/near-dead primitive code implying a layout system never adopted. Fix: delete Container/Spacer; decide whether Box earns one usage or inline it.

**Hand-listed module registry: 14 imports + 14 routes maintained by hand**
- Location: apps/native/src/navigation/Router.tsx:29-43, 105-117
- Dimension: clean-code
- Detail: Each module is imported and wired to a box/<name> Route by hand with the partner route gated inline, so every new module touches two hand-edited lists. Modules already have barrel index.ts files. Fix: a module manifest [{id, path, Component, flag?}] mapped to <Route>, driving both the router and ModulesIndex.
