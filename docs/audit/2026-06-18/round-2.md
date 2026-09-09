# Ollie Repo Audit — Round 2 (2026-06-18)

## Round summary

This round merges findings from 20 audit lanes spanning the native Tauri app, Cloudflare workers (ai-proxy, cron, apns-push, sentry-tunnel), the `@ollie/sync`/`@ollie/crypto`/`@ollie/store` packages, `@ollie/logic` detectors, the orchestrator, supporting packages (crisis-lexicon, pii-scrub, notifications, api, auth), and the Supabase migrations. The dominant theme is an **identity/encryption mismatch at the data layer**: the app authenticates with Clerk (text ids + raw session JWTs) while six core tables declare `uuid` columns referencing `auth.users` with `auth.uid()` RLS, and the encrypted-sync wire path writes base64 strings into `bytea` columns — so the entire authenticated encrypted-sync write path is non-functional against the real schema. A second cluster is **non-durable notification scheduling**: multiple orchestrator/finance paths route through bare `setTimeout`, which both overflows past ~24.8 days (firing immediately) and dies on app quit. A third cluster is **missing rate limits + idempotency on the most expensive AI endpoints** (`/route/dump`, `/route/:module`, `/brain-copy`) plus client-minted-too-late dump ids that duplicate work on retry. Several finance-sync correctness bugs (keyset-pagination row drops, cursor advancing past decrypt failures, clock-mixed LWW) threaten silent data loss. Pervasive lower-severity hygiene issues recur across modules: copy-pasted Box lifecycle scaffolds, duplicated `newId()`/reminder helpers, dark-mode wired only halfway, and migration promises that cache rejections forever.

---

## Critical

**Encrypted/auth wire format mismatch: base64 strings written to Postgres bytea columns**
- Location: packages/sync/src/index.ts:156-158, packages/sync/src/finance.ts:350-351; supabase/migrations/20260512000001_encrypted_state.sql:31-34, 20260514000008_finance_records.sql:52-57
- Dimension: correctness
- Detail: encrypted_state/finance_records declare ciphertext/iv/encrypted_payload as `bytea` with `octet_length(iv)=12` checks, but the sync clients write `bytesToBase64(...)` strings and POST them straight through `api.supabase.rest.upsert`, which only `JSON.stringify`s. PostgREST coerces JSON strings to bytea via hex/escape rules, NOT base64, so a 12-byte IV base64 (16 chars) fails the octet_length check and the INSERT is rejected. finance.ts even has a comment claiming a base64→\x hex conversion happens "below" but no such code exists. The entire encrypted-sync write path cannot persist a single valid row, and every test mocks the upsert so the bytea round-trip is never exercised. Fix: pick one wire format end-to-end (text columns + base64, OR keep bytea and convert base64→\x hex on write / hex→bytes on read) and add a real PostgREST round-trip integration test.

**Core data tables use uuid/auth.users PK + auth.uid() RLS, but app authenticates with Clerk (text)**
- Location: supabase/migrations/20260512000001_encrypted_state.sql:23, 20260513000001_scheduled_jobs.sql:20, 20260514000008_finance_records.sql:37, 20260514000009_plaid_items.sql:21, 20260514000010_plaid_inbox.sql:36, 20260515000001_notification_delivery.sql:106
- Dimension: correctness
- Detail: Six core tables declare `user_id uuid NOT NULL references auth.users(id)` with RLS `auth.uid() = user_id`. The app passes the Clerk text id (`user_2ab...`) and a RAW Clerk session JWT (no `getToken({template:'supabase'})` exists anywhere in the repo). Two failures: (1) inserting a Clerk text id into a uuid column throws `invalid input syntax for type uuid` — the same class that already forced cook_history and grocery_purchase_history to be retyped uuid→text, but these six were never retyped, so server reminders, finance sync, Plaid, and push-token registration silently fail for every real user; (2) a raw Clerk JWT is not Supabase-signed, so `auth.uid()` is NULL and every `_select_own` policy denies reads. Fix: pick ONE identity model (Supabase JWT template + uuid, OR retype to text + RLS on `auth.jwt()->>'sub'`) and verify end-to-end before shipping encrypted sync.

---

## High

**AI-cost endpoints /route/dump, /route/:module, /brain-copy have NO rate limit**
- Location: workers/ai-proxy/src/index.ts:386-406 (dispatch), dump.ts, route.ts, brain-copy.ts
- Dimension: resilience
- Detail: Every other endpoint gets a `checkRate()` gate; the three most expensive routes do not, and implement no internal limiter. `/route/dump` fans out Voyage batch-embed + Groq Llama-3.3-70B classify + optional Gemini vision + pass-2 split; `/route/:module` does Voyage embed + Groq tool-call; `/brain-copy` calls gpt-oss-120b. A single valid Clerk JWT can loop these to drain the Voyage/Groq/Gemini budgets and CF CPU. wrangler.toml scopes AI_RATE_LIMITER to `/brain-dump + /v1/messages` only, confirming the omission. Fix: add `checkRate(env.AI_RATE_LIMITER, env.RATE_KV, 'rl:routedump:'+userId)` after JWT verify in each handler (tighter bucket for vision dumps).

**No end-to-end dump idempotency key: a timed-out-but-succeeded dump duplicates on retry**
- Location: apps/native/src/dump/BrainDumpInput.tsx:188-195, apps/native/src/api/workers.ts:335-342, workers/ai-proxy/src/router/dump.ts:208
- Dimension: idempotency
- Detail: The client never sends a dumpId; the worker mints `body.dumpId ?? crypto.randomUUID()` AFTER the network round-trip. routeDump has a 30s timeout. On a timed-out-but-completed dump, the user's retry gets a brand-new server dumpId → duplicate dump_inbox rows, duplicate dump_archive, and a second pass of module writes (a second 'milk', a second admin task). Violates constitution rule 6; the harness cannot dedupe because the only stable key is generated after the point of non-determinism. Fix: generate dumpId on the CLIENT at submit, persist with the pending draft, send it, reuse the same id on retry (worker already honors body.dumpId).

**FocusTimer counts setInterval ticks instead of wall-clock — drifts/stalls when backgrounded**
- Location: apps/native/src/modules/work/FocusTimer.tsx:154-162
- Dimension: correctness
- Detail: Decrements secondsLeft by 1 per 1s tick with no wall-clock anchor (no endTime/Date.now/visibilitychange). WKWebView throttles/pauses background timers, so a 25–50 min session left backgrounded runs far longer or stalls and never reconciles on resume. Fix: store endTimeMs at start, compute secondsLeft from (endTimeMs − Date.now()) each tick, recompute on visibilitychange/focus.

**Dumped mood valence + energy level silently discarded (string vs number type mismatch)**
- Location: apps/native/src/modules/mood/handler.ts:32,45-60; mood/types.ts:35-37,70-78
- Dimension: correctness
- Detail: Router schema emits string enums (valence 'pos'|'neu'|'neg', level 'low'|'mid'|'high'); local MoodAction declares them as numbers; handler double-casts `as unknown as MoodAction` so TS never catches it. getValence/getEnergyLevel gate on `typeof v === 'number'` so stored strings return null — every dump-logged mood loses valence + energy on display. A stale comment wrongly claims mood isn't in the schema union. Fix: import MoodAction from router/schema.ts, normalize enums→numbers in the handler, remove the cast.

**Brain-dump goal creation bypasses the active-goal cap (max-5 invariant half-enforced)**
- Location: apps/native/src/modules/goals/repo.ts:141-171 (ensure) vs 180-186 (create); goals/handler.ts:30,40,53,66
- Dimension: correctness
- Detail: goals.create() enforces ACTIVE_GOAL_CAP and throws GoalCapError, but the dump handler's create_goal (and progress/milestone/obstacle notes via resolveGoalId→ensure) calls goals.ensure() which has NO cap check. A dump can create unlimited goals, skipping the required why/obstacle/premortem/ulysses fields and leaving the 72h low-mood delete-lock with nothing to read. Fix: gate ensure() auto-creation on the cap for create_goal; for notes, attach to the unassigned bucket instead of inflating the registry when at cap.

**Module migrations cache a rejected promise forever — one transient failure poisons the module for the session**
- Location: apps/native/src/modules/*/migrate.ts (13 files; e.g. finance/migrate.ts:132-209, admin/migrate.ts:78-123, grocery/migrate.ts:92-158, cycle/migrate.ts:38-40)
- Dimension: resilience
- Detail: Pattern `if (!migrationPromise) migrationPromise = (async()=>{...})()`. If the IIFE rejects (SQLite locked at boot, failed ALTER), the rejected promise is memoised; every later migrateX() returns it, so the module's handler fails permanently until app restart. Only a test-only `_resetAdminMigration` exists. Concurrent boot + first-dump is exactly when contention is likely. Fix: `.catch(e => { migrationPromise = null; throw e; })` so the next call retries; ideally route module schemas through the ledger-backed runMigrations. (Reported by both native-modules and native-data-crypto lanes.)

**Finance sync inbound cursor advances past rows that failed to decrypt → permanent data loss**
- Location: packages/sync/src/finance.ts:442-447,462-467,532
- Dimension: correctness
- Detail: maxUpdatedAt is bumped for EVERY row before the decrypt is attempted; a decrypt failure is only logged and skipped, but the cursor has already moved past it and is persisted via writeCursor. The next pull uses `gt.cursor` and never sees that row again — silently dropped on this device forever. Contradicts groceryPull.ts which halts the cursor on a failed-apply row. Fix: only advance maxUpdatedAt for successfully-applied (or tombstone) rows; clamp the written cursor below any failed row's updated_at.

**Finance sync keyset pagination drops rows sharing updated_at across a page boundary**
- Location: packages/sync/src/finance.ts:425-428,442-444,532,544-546
- Dimension: correctness
- Detail: Pages by `order: updated_at.asc, limit: 500`, advancing with strict `gt.${cursor}`. The server trigger clamps every row's updated_at to transaction `now()`, so a batch upsert stamps all rows the same timestamp. If >500 rows share a timestamp, page 2's `gt.T` returns 0 and remaining rows stamped T are never pulled — permanent silent loss on any sync batch >500 records (finance expects "low thousands"). Fix: composite cursor (updated_at, id) with order updated_at.asc,id.asc, or `gte` + per-page seen-id dedupe; add a test seeding >500 rows sharing one timestamp. (Reported by both native-data-crypto and crypto-sync-store lanes.)

**Module-blob syncIn echoes every inbound apply back to the server (re-upload ping-pong)**
- Location: packages/sync/src/index.ts:248-249, 270-274, 310-314
- Dimension: correctness
- Detail: applyModule → store.setModule fires the module's `*` subscriber registered in start(), which sets `_sync_local_ts` and calls debouncedPush — scheduling a re-upload of the blob just received. Line 249 resets the ts but the push is already queued, so the device ships the remote blob back out. Two active devices steadily ping-pong. The finance client fixes exactly this by refreshing its snapshot after syncIn; index.ts has no equivalent guard. Fix: an `applying` suppression flag around applyModule so syncIn-originated writes don't enqueue a push.

**Native Supabase client never carries the user's JWT — all SDK reads hit RLS as anon**
- Location: apps/native/src/api/supabase.ts:49-56
- Dimension: correctness
- Detail: getSupabaseClient() builds the client with only the anon key (no setSession/accessToken/Clerk bridge). body/sleep handlers that import it query RLS-protected tables as `anon`, which every core table revokes or has no policy for — so reads/writes are silently denied. Combined with the uuid/Clerk mismatch, there is no working authenticated client path to the encrypted-data tables. Fix: wire the Clerk session into supabase-js v2's `accessToken` async option.

**scheduleAt cancel() races the async native-schedule path; OS notification cannot be cancelled**
- Location: apps/native/src/notify/systemNotify.ts:283-329
- Dimension: correctness
- Detail: scheduleAt returns a handle synchronously, but the native-scheduler decision happens inside a later `.then()` that emits 'ollie-schedule-notif' and only then sets nativeScheduled=true. A cancel() before that resolves (common create-then-undo) sees timerId null AND nativeScheduled false, does nothing, yet the emit still permanently schedules the OS notification — the reminder fires after the user undid it. Fix: an `aborted` flag checked before emit, and have cancel() emit 'ollie-cancel-notif' for the id regardless of nativeScheduled (Rust cancel is idempotent).

**Orchestrator/finance notifications use bare setTimeout: >24.8d fires immediately + multi-day timers lost on quit**
- Location: apps/native/src/notify/systemNotify.ts:383-393 (scheduleSystemNotification); packages/notifications/src/backends/web.ts:76-81; packages/orchestrator/src/finance.ts:1299-1308,1381-1391; wired via store.ts:111-118
- Dimension: correctness
- Detail: This is the slot every cadence/finance orchestrator (cycle/sleep/body/finance) uses to schedule future notifications. It computes delay = fireAt − now and calls setTimeout with no upper-bound clamp and no cancellable/tracked handle. (1) delay >2,147,483,647 ms (~24.8 days) overflows setTimeout's 32-bit signed int and fires IMMEDIATELY — a bill 28 days out (fireAt = due−3d) pings ~25 days early; (2) even sub-24.8d timers are in-process, die on app quit/reload, and leak across HMR/teardown — unlike the durable scaleAt() OS-scheduler path the rest of the app uses. Fix: route this slot through the durable native scheduleAt path (stable id from spec.dedupe_key), clamp delay <2.1e9 in both web.ts and systemNotify.ts, and track/return cancellable handles. (Reported by native-state-flow, native-nav-notify, and orchestrator lanes.)

**resumeScheduled re-fires notifications the native backend already delivered (reintroduces NC6 duplicate bug)**
- Location: packages/notifications/src/index.ts:153-170
- Dimension: correctness
- Detail: On boot, resumeScheduled iterates persisted ScheduledRecords and for any fireAt<=now calls deliverImmediate(r.spec) unconditionally, ignoring r.platform_id even though the record's comment acknowledges native backends already fired the OS notification. On reopen the user gets a second copy of a notification the OS already showed while closed; deliverImmediate also bypasses isRecentlySeen dedupe and the daily cap. Fix: skip deliverImmediate when platform_id is truthy; route catch-up through the dedupe/cap-aware path.

**work/goals time-windowed cues have no recurring scanner — fire only on boot or store mutation**
- Location: packages/orchestrator/src/work.ts:273-372,410-436; goals.ts:228-313,320-322
- Dimension: correctness
- Detail: scanCues detects cues valid only in narrow time windows (meeting_30m 28–32min, session_end 0–3min, session_90_warn, deadline_30d, weekly_check_in) but is invoked only at init and debounced on a source-key mutation; there is no recurring interval. A cue whose window opens while no relevant key mutates is silently missed. meeting_30m is worst: work.bridge captures meetings only AFTER they happen, so work.meetings never holds a future start_at and the before-window can essentially never fire. Fix: fold scanCues into a low-frequency recurring driver (reuse the cadence-scanner 30-min interval + visibilitychange) or move time-window cues to the durable scheduleNotification path.

**hit_count PostgREST "increment" is invalid — popularity signal silently dead**
- Location: workers/ai-proxy/src/router/route.ts:432; feed-me.ts:776
- Dimension: correctness
- Detail: cacheHitUpdate PATCHes routing_cache with `{ hit_count: { increment: 1 } }`. PostgREST has no atomic-increment JSON operator; hit_count is `int not null`, so a JSON object yields a 400 that the fire-and-forget `.catch(console.error)` swallows. hit_count never increments; every cache row stays at 0, making the Decision-3 popularity-weighted eviction inert. route.test.ts only asserts the PATCH fires, not that the body is valid. Fix: read-modify-write the integer, or a SECURITY DEFINER RPC `routing_cache_bump(id)`; assert an integer body in tests.

**Design-system Button/Input primitives bypassed by ~68 raw <button> / 10 raw <input> across modules**
- Location: apps/native/src/modules/**/*Box.tsx; primitives at apps/native/src/ui/Button.tsx, ui/Input.tsx
- Dimension: reinvented-wheel
- Detail: ui/Button.tsx is a real accessible primitive (variant, aria-busy, loading spinner, focus CSS) but `<Button` is rendered by ZERO module files; modules use 68 raw <button> with hand-rolled inline styles. Result: duplicated tap/hover/disabled styling per call site, lost keyboard/focus + aria-busy, and a dead design-system component. Same for Input. Fix: codemod raw elements to the primitives, add missing variants once, add an ESLint no-restricted-syntax rule banning raw <button>/<input> in src/modules.

**Dark mode half-wired: module Boxes read the static light `colors` alias, never useTokens()**
- Location: apps/native/src/theme/tokens.ts:116 (colors = lightPalette), consumed by ~17 module files; ThemeProvider useTokens() used by 0 non-theme files
- Dimension: correctness
- Detail: ThemeProvider builds a mode-aware token bundle and darkPalette is fully defined, but `export const colors = lightPalette` is a static light-only alias and every Box imports it (470 `colors.` refs). Zero components outside src/theme call useTokens(). Inline `color={colors.inkFaint}` always renders light regardless of resolved mode, so toggling dark mode produces a broken half-light/half-dark screen. Fix: consume `useTokens().palette` or convert inline colors to `var(--ollie-color-*)`, then delete/rename the static alias.

**Every handler blind-casts router payload with no runtime validation of required fields**
- Location: apps/native/src/modules/{finance,admin,work,grocery,pets,medication,goals,cycle,body,sleep,habits}/handler.ts
- Dimension: validation
- Detail: Handlers do `const p = fragment.payload as XAction` and trust required fields. Payload comes from an AI worker over the network and is never schema-validated natively. Unguarded required fields written straight to SQLite: medication medName (empty-named registry rows), admin task text / phone-task person. The dispatcher try/catch only helps on a throw; a thin/garbage row write does not throw. Fix: a shared per-action validate(payload) that rejects empty/missing required strings and returns ok:false instead of persisting undefined/'' rows.

**Sensitive health/financial data stored unencrypted at rest; native encryption sync path never wired**
- Location: apps/native/src/store.ts:57-58, modules/cycle/bridge.ts:68, modules/cycle/repo.ts
- Dimension: security
- Detail: Native captures all module data into plaintext SQLite and mirrors into @ollie/store backed by localStorage. Menstrual/pregnancy, medication, mood, finance all sit cleartext on disk in both places. The cycle bridge itself flags the plaintext gap. @ollie/crypto + @ollie/sync exist but createSyncClient/createFinanceSyncClient are referenced nowhere under apps/native, and encryptedKv has no callers — the memory note that "cycle is already encrypted" only holds if sync is started, which it isn't. App-lock protects the UI, not the files. Fix: wire the sync clients at boot OR wrap sensitive repos through encryptedKv / SQLCipher; stop mirroring health/finance to plaintext localStorage; correct DATA_SCHEMA.md.

**Turkish dotted-İ names silently bypass the PII name wordlist**
- Location: packages/pii-scrub/src/wordlists.ts:198-202 (isLikelyName uses word.toLowerCase())
- Dimension: validation
- Detail: Wordlist names are lowercase; matching uses locale-independent toLowerCase, which turns 'İ' into 'i'+U+0307 (so 'İlker'.toLowerCase() !== 'ilker'). Common Turkish names (İlker, İsmail, İrem, İşıl) never match and are emitted UNREDACTED into the opt-in research corpus; the capitalization heuristic is not a reliable backstop. Fix: Turkish-aware fold ('İ'→'i', 'I'→'ı') or toLocaleLowerCase('tr') before matching; add a golden test for İ-initial names.

**Crisis raw text leaks to client in CrisisSignal.matches[].line despite stated zero-storage invariant**
- Location: packages/crisis-lexicon/src/index.ts:150,174-189; types.ts:68-73; workers/ai-proxy/src/router/dump.ts:248,258-275
- Dimension: security
- Detail: extractMatchedLine() returns the full raw line that triggered a crisis match; the dump router returns the whole crisis object in the HTTP response while setting originalDump:'' and commenting that the text "isn't even echoed back." matches[].line directly contradicts that — the most sensitive sentence the user types is echoed in the response, available to client logging / Sentry replay / network capture. Fix: drop the `line` field (tier + language + pattern-id suffice for the client banner) or strip it before returning; verify no telemetry captures the response body on the crisis path.

**cron wrangler.toml Queues consumer block is UNcommented while its header says it is commented — latent deploy-blocker**
- Location: workers/cron/wrangler.toml:45-63
- Dimension: correctness
- Detail: The header documents the block as left commented because an uncommented consumer pointing at a non-existent queue makes `wrangler deploy` FAIL, but lines 58-63 ([[queues.consumers]], ollie-enrich-queue/dlq) are live TOML. Either the queues were silently provisioned (prose stale and misleading) or the next cron deploy fails hard; the ai-proxy producer must be uncommented in lockstep or the consumer drains a queue nobody writes to, leaving the 5-min KV-scan as the only live enrichment path. Fix: reconcile with reality; add a deploy smoke check asserting referenced queues exist.

---

## Medium

**13 module Boxes run an always-on 6s SQLite poll that does not pause when the window is hidden**
- Location: apps/native/src/modules/*/Box.tsx + todo/TodoScreen.tsx (e.g. GroceryBox.tsx:149-161)
- Dimension: perf
- Detail: Each Box installs setInterval(refresh, 6000) + a focus listener; refresh fans out 3–5 parallel SQLite reads. The timer fires regardless of document.visibilityState — unlike main.tsx pushScanner which guards on visibility — so a backgrounded Tauri window wakes every 6s for a read storm + full re-render (battery). Fix: gate the interval on visibilityState==='visible', or move to an event-driven refresh (ollie:data-changed) + visibilitychange.

**scheduleSystemNotification arms an unbounded, untracked setTimeout (latent overflow + no cancellation)**
- Location: apps/native/src/notify/systemNotify.ts:383-393
- Dimension: resilience
- Detail: Companion to the bare-setTimeout finding above, from the state-flow lane: the orchestrator slot computes delay with no clamp and no returned handle, so it isn't torn down on orchestrator.teardown() and overflows >24.8 days. Latent today (all live call sites stay under the ceiling) but any quarterly/annual reminder silently misfires, and timers leak across HMR/teardown. Fix: clamp delay, return/track a cancellable handle, prefer the durable native path.

**Layer-2 re-route adopts unvalidated AI JSON and breaks its own documented fallback**
- Location: apps/native/src/modules/body/handler.ts:46-78 (and identical sleep/handler.ts:44-76)
- Dimension: validation
- Detail: maybeUpgradeFragment does `JSON.parse(first.data) as BodyAction` with no check of module/action discriminant or required fields, then replaces the fragment. A valid-JSON/invalid-action payload does NOT fall through (contrary to the doc comment) — the handler switch hits exhaustive() and throws, converting a recoverable Layer-1 fragment into a silently-failed one; a known-action/missing-field payload writes an undefined row. Fix: validate the parsed payload (object, module match, known action, required fields) before adopting; on failure return the ORIGINAL fragment.

**Grocery handler reads payload fields absent/mistyped vs schema (quantity string→number, unit invented)**
- Location: apps/native/src/modules/grocery/handler.ts:25-26,80-81 vs router/schema.ts:335,343
- Dimension: leaky-abstraction
- Detail: Schema declares pantry_add `{item, quantity?: string, ...}` with no unit; the handler casts quantity to number and reads a nonexistent unit field. unit always resolves to null (never captured from dumps); if the worker honors the schema and sends quantity as a string, it lands mistyped in a numeric REAL column. The escape-hatch casts bypass the compiler. Fix: reconcile schema and handler (decide quantity numeric vs string, add or drop unit) and remove the inline casts.

**Dump archive write is fire-and-forget and races the store mirror it feeds — current dump missing this cycle**
- Location: apps/native/src/dump/DumpScreen.tsx:153, modules/dispatch.ts:116, modules/dump/bridge.ts:51
- Dimension: correctness
- Detail: `void dumpArchive.record(...)` is not awaited before dispatch; runAllSyncs → dump bridge reads dumpArchive.list() to populate dump.items, frequently before this dump's INSERT commits. recomputeBrain then computes today's capacity/harm missing the just-submitted dump, undercounting capture-load for the whole current cycle (self-corrects next dump). Fix: await dumpArchive.record() before dispatchRouterOutput (it swallows errors, so awaiting is safe).

**Multiple create_goal fragments in one dump: only the first gets a modal, the rest are silently dropped**
- Location: apps/native/src/dump/DumpScreen.tsx:125-145
- Dimension: correctness
- Detail: onResult `find`s ONE create_goal fragment for the modal but the dispatch filter strips EVERY create_goal fragment. A dump with two goals opens a modal for the first only; the second is removed from dispatch and never surfaced — goal-intent lost (goals are precious/capped). Fix: queue all create_goal fragments and open modals sequentially, or strip only the matched fragment by identity.

**No concurrent-submit guard: Cmd+Enter / voice mic bypass the disabled Send button and double-submit**
- Location: apps/native/src/dump/BrainDumpInput.tsx:141-151, 246-255, 305-312
- Dimension: idempotency
- Detail: submit() sets loading but has no `if (state.kind==='loading') return` guard; the keyboard and voice paths fire submit() ungated by isLoading. Two fast Cmd+Enters send two POSTs which (with the no-idempotency-key finding) produce two independent routes → duplicate items/tasks/archive rows. Fix: early `if (state.kind==='loading') return;` at the top of submit().

**Widget App Group snapshot persists finance + pantry data in plaintext, readable without app unlock**
- Location: apps/native/src/snapshot/writeSnapshot.ts:24-57,75-76
- Dimension: security
- Detail: The snapshot (monthSpend, nextBill merchant+amount, pantry names) is written as plaintext JSON into the App Group container so a widget/Siri intent can read it WITHOUT launching the app — deliberately outside the app-lock boundary. This exposes spending, next bill payee/amount, and groceries at rest, bypassing the lock the user believes protects everything. Fix: minimize snapshot contents (drop merchant/exact amounts or gate behind a setting) and/or encrypt with a Keychain key; document the widget snapshot is outside the lock.

**encryptedKv envelope omits PBKDF2 iteration count, contradicting the S7 migration contract**
- Location: apps/native/src/storage/encrypted.ts:23-60; packages/crypto/src/index.ts:30-40,127-131
- Dimension: correctness
- Detail: @ollie/crypto's S7 design requires every envelope to store its iteration count and decrypt with it (fallback LEGACY 100k). StoredEnvelope has only {iv, ciphertext, salt}; set()/get() both derive with the DEFAULT 600k. It can't decrypt legacy-100k data, and any future iteration bump makes all prior encryptedKv values permanently undecryptable. Latent (no live callers) but a data-loss landmine the moment it's used. Fix: add `iterations` to StoredEnvelope, write CRYPTO_PARAMS on set(), pass `env.iterations ?? LEGACY` on get(); add an iteration-bump round-trip test.

**Main encrypted_state sync LWW compares device wall-clock against server-clamped timestamps**
- Location: packages/sync/src/index.ts:241-249,272
- Dimension: correctness
- Detail: LWW skips a remote row when `remoteTs <= localTs`, where localTs is `nowFn()` (device clock) and remoteTs is the server-clamped updated_at. Comparing device-clock ms against a server timestamp is unreliable: a fast-clock device always "wins" and ignores newer remote edits (lost update); a slow-clock device overwrites its own newer data with stale blobs. Whole-module replacement means one bad comparison reverts an entire module. Fix: track the last-applied remote server timestamp and compare remote-vs-remote plus a local dirty flag; stop seeding localTs from nowFn(). (Reported by native-data-crypto and crypto-sync-store lanes.)

**Handlers read req.json() with no Content-Length / body-size guard (memory DoS)**
- Location: workers/ai-proxy/src/router/dump.ts:156-182; route.ts:247-254; feed-me.ts:167-173; partner.ts:97-103,160-165
- Dimension: validation
- Detail: The /brain-dump proxy pre-checks Content-Length and caps bytes; the JSON handlers do not. dump.ts caps body.text/image only AFTER req.json() parses the whole body, and route.ts has NO length cap on body.text before PII-scrub/embed/classify. A multi-MB JSON with a giant dumpId or arbitrary keys is fully parsed first. Fix: check content-length against a per-route max before req.json() and 413 early; add an explicit body.text cap on /route/:module.

**Clerk JWT verify omits azp/audience check**
- Location: workers/ai-proxy/src/clerk-verify.ts:58-74
- Dimension: security
- Detail: verifyClerkJwt validates signature + issuer only. Clerk's manual-verification guidance recommends asserting `azp` (and/or aud) against an allowlist, otherwise a token minted for a different app on the same Clerk instance, or with an unexpected azp, is accepted as a valid Ollie user — and every authed write endpoint trusts this one function. No explicit clock-skew handling. Fix: pass an authorizedParties/audience allowlist (reuse ALLOWED_ORIGINS) to jwtVerify or assert payload.azp after verify. (Reported by worker-ai-validation and worker-ai-logic lanes.)

**/validate-invite and /claim-invite have no worker-level rate limit (enumeration oracle)**
- Location: workers/ai-proxy/src/index.ts:375-380; src/invites.ts:148-295
- Dimension: resilience
- Detail: invites.ts claims reliance on a per-IP CF rate limit that does not exist in wrangler.toml. /validate-invite is unauthenticated, hits Supabase REST per call, and returns distinct valid/not_found/used/expired reasons — an unthrottled invite-code brute-force/enumeration oracle. Fix: add checkRate keyed on cf-connecting-ip (validate) and user id (claim), and collapse the validate reason codes to a single boolean.

**Vectorize per-user cache cap + decay eviction documented but never enforced — unbounded growth**
- Location: workers/ai-proxy/src/router/vectorize.ts:36,195,128-160
- Dimension: resilience
- Detail: The header documents 10k-per-user cap + 30-day decay eviction "enforced lazily on writes," but cacheUpsert does no count check or delete; CAP_PER_USER is used only in a full-wipe helper; evictionScore has zero callers; TTL is enforced only on read, never deleting stale rows. A heavy user's namespace grows without bound and stale/misrouted rows linger (can be returned before the read-side TTL check). Fix: implement lazy eviction in cacheUpsert or a cron sweep; otherwise remove the false "enforced lazily" claim.

**/route/:module routing_cache is shared across ALL users (no user scoping)**
- Location: workers/ai-proxy/src/router/route.ts:380-419; supabase/migrations/20260521000001_routing_cache.sql:24-53
- Dimension: correctness
- Detail: routing_cache has no user column; cacheLookup filters only on module + cosine≥0.85. The first user to utter an ambiguous phrase pins its classification for every later user within 0.85 cosine — across all 11 tiered modules (finance, medication, body, cycle), a mis- or adversarially-seeded classification becomes a shared poison row with no per-user override. Contrast the per-user-namespaced Vectorize cache in /route/dump. Fix: add user_hash to routing_cache + the lookup RPC, or bound which modules may use the shared cache.

**enriched_signals INSERT is not idempotent — crash/retry after raw_dumps upsert duplicates signal rows**
- Location: workers/cron/src/drain.ts:200-215, 325-364
- Dimension: idempotency
- Detail: processOne upserts raw_dumps idempotently then plain-INSERTs enriched_signals (no unique constraint/on_conflict). If insertEnrichedSignal succeeds but CACHE_KV.delete (or message.ack) doesn't run before isolate eviction, the next tick re-inserts a second enriched_signals row for the same dump_id, double-counting enrichment_cost_usd and skewing B2B aggregates. Fix: unique constraint on enriched_signals(dump_id) + POST on_conflict=dump_id merge.

**No retry backoff/jitter on the KV-scan enrich drain — failing dumps retry every 5 min flat**
- Location: workers/cron/src/drain.ts:109-167, 368-374
- Dimension: resilience
- Detail: drainEnrichQueue bumps a flat retry counter and re-attempts every 5-min tick to MAX_RETRIES, with no exponential backoff or jitter (constitution rule 5). During an Anthropic 5xx outage every queued dump re-calls in lockstep, multiplying cost when upstream is degraded. The Queues path has native backoff but is gated behind the unprovisioned-queue block. Fix: store next_attempt_at and skip until backoff (5min·2^n + jitter, capped) elapses, or finish Queues provisioning and retire the KV scan.

**flush daily-budget cap is racy across overlapping ticks / multi-device fan-out — can overshoot**
- Location: workers/cron/src/flush-notifications.ts:182-241, 392-430
- Dimension: correctness
- Detail: countSentToday reads the DB count; the per-batch cache only increments locally. An overlapping scheduled tick + manual POST each read the same count and each deliver up to (cap−count), so total ~2×cap; selectDueJobs doesn't lease rows, so overlapping drains re-select the same pending rows (only the status=eq.pending guard on updateJob, checked AFTER the APNs push, prevents double-send). Fix: lease rows at selection (PATCH status→processing with pending guard, return claimed) to close both the double-send and budget race; document the cap counts jobs not per-device deliveries.

**API retry uses exponential backoff with NO jitter (violates harness invariant)**
- Location: packages/api/src/client.ts:242
- Dimension: resilience
- Detail: delay = baseDelayMs * 2^attempt, fully deterministic. Constitution rule 5 requires jitter; without it, many clients hitting a flaky upstream retry in lockstep, a thundering herd against the worker/Supabase. Fix: full/decorrelated jitter, e.g. delay = base * 2^attempt * (0.5 + random*0.5), keeping the cap.

**routeViaHaiku rate-limit gate is ineffective under concurrency and only updates on success**
- Location: packages/api/src/anthropic.ts:17,167-171,230
- Dimension: correctness
- Detail: __lastCallTs is written only after a successful fetch, so two near-simultaneous callers both pass the gate and fire (min-gap unenforced under concurrency), and a burst of failing calls is never rate-limited. Also uses raw fetch(), bypassing the @ollie/api client the package docs mandate. Fix: set __lastCallTs at gate-pass (before fetch), advance on failure too; route through the api client.

**Vault.create() silently overwrites an existing vault, orphaning all previously-encrypted data**
- Location: packages/auth/src/index.ts:139-173
- Dimension: correctness
- Detail: create() doesn't check state().exists before writing a fresh salt + verifier. Called when a vault exists (re-onboarding bug, double-tap, ungated flow), it derives a key from a NEW salt, making every previously-encrypted blob permanently undecryptable — silent irreversible data loss with no guard. Fix: guard create() to return 'vault-exists' if salt+verifier exist; make reset an explicit two-step.

**Snooze action loses server-push durability and uses placeholder title**
- Location: apps/native/src/notify/notificationActions.ts:96-104
- Dimension: correctness
- Detail: The snooze branch reschedules only via client scheduleAt and never calls scheduleServerReminder, so a snooze handled in a short-lived background wake (the documented use case) may never fire again (no Supabase scheduled_jobs row). The native macOS path calls handleAction with no title/body, so the snoozed copy falls back to the literal 'reminder' and loses its OLLIE_REMINDER category/buttons. Fix: also call scheduleServerReminder with the same dedupe_key; carry original title/body through the native action event payload.

**invite_funnel views are not security_invoker — definer-rights views bypass RLS on telemetry tables**
- Location: supabase/migrations/20260519000003_invite_funnel_views.sql:33,81
- Dimension: security
- Detail: invite_funnel and invite_funnel_by_channel lack `with (security_invoker = on)`, so they run with owner privileges and read invites/session_events/raw_dumps/retention_events bypassing RLS while aggregating cross-user behaviour + user_hashes. Only the current GRANT list prevents exposure — a single `grant select ... to authenticated` would leak every user's activation timeline. Fix: add security_invoker = on to both views (durable), or a lint guard against granting to authenticated/anon.

**Crisis lexicons still PENDING_SERRA_APPROVAL — module's own merge gate unsatisfied**
- Location: packages/crisis-lexicon/data/lexicon.{en,tr,es}.json (last_reviewed_by)
- Dimension: standards
- Detail: The module header states lexicons must be reviewed by @serra before any alpha merge; all three files still carry last_reviewed_by 'PENDING_SERRA_APPROVAL'. Crisis detection is the highest-stakes classifier (false negative = missed suicidality signal); shipping unreviewed clinical content breaches the package's own invariant. Fix: block alpha on Serra's sign-off per lexicon, or a CI check that fails on PENDING_SERRA_APPROVAL.

**Selecting peak-|rho| over 7 lags then gating with one bootstrap CI is post-selection biased**
- Location: packages/logic/src/patterns/sleep-mood-lag.ts:71-97
- Dimension: correctness
- Detail: The detector keeps the max |rho| over 7 lags then computes a 90% bootstrap CI on the winning lag and requires it to exclude zero. Bootstrapping the already-selected maximum doesn't correct for multiple comparisons, so real coverage is <90% and false positives are inflated; the package ships a BH-FDR helper used by sibling detectors but not this one. Fix: BH-adjust p-values across the lag family, widen the CI for the max-over-7 selection, or bootstrap the max statistic itself.

---

## Low

**Three conflicting cycle-phase boundary definitions classify the same day differently**
- Location: packages/logic/src/cycle/phase.ts:52-55, phase.ts:144-146, patterns/phase-fold.ts:48-53
- Dimension: correctness
- Detail: The follicular/ovulation cutoff is hardcoded three incompatible ways (for a 28-day cycle the ovulation window is [10,15], [12,15], [11,15]); detectSymptomInPhase and correlateSymptom can disagree on the same event, and both are user-facing. menstrual cutoff also differs. Fix: a single canonical phaseForDay(day, cycleLen, bleedLen) with a pinned inequality test table. (Marked high by the detectors lane; downgraded here as a cross-detector inconsistency rather than data loss — keep visible.)

**computeMonthlyOutflow month arithmetic skips months at month-end, corrupting MoM baseline**
- Location: packages/logic/src/finance/recurring.ts:490-493 (used by monthOverMonthDelta:512-534)
- Dimension: correctness
- Detail: setMonth(getMonth()+offset) keeps day-of-month, so from a 31st the baseline samples {current-duplicate, January, December}, dropping February and double-counting the current month — wrong up/down/flat verdicts for ~3 days each month. Sibling monthlyVolatility does it correctly anchored at day 1. Fix: build target from new Date(year, month+offset, 1); add a test with now on 29th–31st.

**detectSavingsTransfers pairs any same-day same-amount in/out as high-confidence savings + auto_apply**
- Location: packages/logic/src/finance/savings-detection.ts:123-148, 233-242
- Dimension: correctness
- Detail: Pass 1 matches outbound↔inbound solely on identical date + amount, no savings account/keyword required, flagged confidence:'high'. Refund+repurchase, Venmo reimbursement, bill-split all match, and matchTransfersToGoals sets auto_apply for a pair within 5% of a goal's median — a coincidence silently auto-increments goal progress. Fix: require corroborating savings keyword/account before high confidence; keep keyword-less coincidences at medium/low (no auto_apply).

**detectSavingsTransfers reads Date.now() for IDs, violating the purity/determinism contract**
- Location: packages/logic/src/finance/savings-detection.ts:91-94,137,163
- Dimension: determinism
- Detail: The header promises pure functions with injected now, but nextId() uses Date.now() + a module-level counter with no injectable now/idFn. Transfer IDs change between identical runs, so downstream dedup keyed on them can't recognize a re-processed transfer (same deposit applied twice). Fix: derive the id deterministically from inputs or thread an injected now/idFn like the episode helpers.

**detectChangePoint fires on any nonzero delta when both windows have zero variance**
- Location: packages/logic/src/cycle/posterior.ts:53-65
- Dimension: correctness
- Detail: When both 6-cycle windows are internally constant, pooledSd=0 and any delta>0 satisfies delta>2*pooledSd, so a trivial 2-day shift is flagged as a change-point and truncates the posterior, discarding history. Fix: floor pooledSd with a MIN_SIGMA before the test, mirroring posteriorCycleLength.

**detectLutealCollapse divides completions by total habit count, biasing rates when habits added mid-window**
- Location: packages/logic/src/habits/detectors-tier1.ts:168-184
- Dimension: perf
- Detail: Rates use completions/(dayCount * arr.length), counting habits that didn't exist during a window day, depressing rates; if new-habit proportion differs between luteal and non-luteal days the ratio skews and the collapse verdict trips/misses spuriously. Fix: count only habits active on each day (created_at<=day, not archived) in the per-day denominator.

**Cache-miss classification poisons cache even at low confidence**
- Location: workers/ai-proxy/src/router/dump.ts:386-419; route.ts:325-327
- Dimension: correctness
- Detail: On a miss, the result is cacheUpserted regardless of confidence, including <0.60 results just demoted to dump_only/needsConfirm; future near-duplicates hit the cached (possibly wrong) classification for 30 days, compounded by dead hit_count and absent eviction. Fix: skip the cache write (or short-TTL/provisional flag) when confidence is below the needs-confirm band.

**Batched classify max_tokens scales unbounded with fragment count**
- Location: workers/ai-proxy/src/router/dump-classify.ts:292
- Dimension: perf
- Detail: maxTokens = 256*items.length + 256 with no clamp, and segmentation applies no fragment cap on a 10k-char dump; a pathological dump requests thousands of output tokens, raising cost and risking Groq free-tier per-request limits (forcing the batch down the cascade). Fix: cap fragment count (~20) and clamp maxTokens to min(4096, 256*N+256).

**Box lifecycle scaffold (migrate→refresh→setReady + 6s poll + focus refresh) copy-pasted across 12-13 modules**
- Location: apps/native/src/modules/*/Box.tsx (e.g. SleepBox.tsx:80-106, BodyBox.tsx:97-123)
- Dimension: clean-code
- Detail: Two near-identical effects (mount migrate→refresh→setReady with cancelled guard; setInterval(POLL_MS)+focus listener) and `const POLL_MS = 6000` are repeated verbatim in 11–13 files. A fix (event-driven store sub, pause-when-hidden) must be made 13 times. Fix: extract a `useBoxData({migrate, refresh})` hook owning the sequence, interval, focus-refresh, ready flag, and cancelled guard.

**Oversized monolithic Box components (Grocery 1349, Finance 1268, Medication 1082, Work 1005, Goals 998)**
- Location: apps/native/src/modules/grocery/GroceryBox.tsx + finance/medication/work/goals Box files
- Dimension: clean-code
- Detail: Five Boxes exceed ~1000 lines; GroceryBox has ~45 inline render fns + 53 inline style literals mixing fetch, tab persistence, shelf-life loading, aging, and four modes — any state change re-renders the whole tree, modes can't be tested in isolation, and fresh style objects allocate per render. Fix: split per-mode child components and hoist style objects to module-level consts/CSS modules; target <~400 lines per Box.

**Small-caps label style (SMCP_STYLE / `ln`) re-declared ~19 times instead of living in the design system**
- Location: apps/native/src — 19 declarations (SleepBox.tsx:38, BodyBox.tsx:52, TabBar.tsx, Router.tsx, etc.)
- Dimension: clean-code
- Detail: `{ fontVariantCaps:'all-small-caps', letterSpacing:'0.08em' }` is hand-declared in 19 files, and 0.08em even disagrees with the token letterSpacings.caps 0.10em. Fix: a `<Kicker>`/`<Eyebrow>` component (small-caps + caption + inkFaint) and/or an `smcp` style atom; reconcile 0.08 vs 0.10em.

**newId() generator duplicated verbatim in 13 repos**
- Location: apps/native/src/modules/*/repo.ts (e.g. finance/repo.ts:69-73)
- Dimension: reinvented-wheel
- Detail: The same `crypto.randomUUID() ?? fallback` is copy-pasted into 13 module repos, differing only by a one-char prefix. Drift risk if the ID strategy changes. Fix: extract storage/id.ts `newId(prefix='')`.

**scheduleReminderIfPresent duplicated between admin and work handlers**
- Location: apps/native/src/modules/admin/handler.ts:119-145, work/handler.ts:177-201
- Dimension: reinvented-wheel
- Detail: Two ~25-line near-identical reminder-scheduling helpers differing only in module tag + action_url; the work copy's comment admits the duplication and defers consolidation until a second caller — now reached. Fix: a shared scheduleTaskReminder(remindIn, taskId, {title, body, module, actionUrl}).

**start_timer relies on in-process setTimeout — lost on app close, ignores remindIn server path**
- Location: apps/native/src/modules/work/handler.ts:126-147
- Dimension: resilience
- Detail: start_timer uses a raw setTimeout that fires only while the JS context is alive and, unlike create_task, doesn't call scheduleReminderIfPresent — so a "set a 25 min timer" dump on a phone that locks/backgrounds never fires, contradicting the app-closed reminder guarantee. Fix: route through the OS-local + server-reminder path; gate the setTimeout fallback to desktop only if the macOS instant-fire bug blocks it on desktop.

**worker↔native module drift drops a fragment to ok:false with only console.error — no telemetry, no resurface**
- Location: apps/native/src/modules/dispatch.ts:50-67
- Dimension: resilience
- Detail: When the worker routes to a Module the native stubHandlers registry doesn't know (hand-synced union), dispatch pushes ok:false + console.error. The raw dump is archived but the dump UX is silent and console.error in a shipped webview is unobservable, so the drift isn't actually surfaced as the comment claims. Fix: emit a telemetry event/Sentry breadcrumb on the no-handler branch.

**Draft confirm 'keep' has no in-flight guard — double-tap applies the fragment twice**
- Location: apps/native/src/dump/DumpScreen.tsx:188-197; dump/NeedsConfirmCard.tsx:93-110
- Dimension: idempotency
- Detail: onKeep awaits applyFragment then dismissConfirm; the keep button has no disabled state and the card is removed only after the async resolves, so a mobile double-tap fires applyFragment twice (two pantry rows). Fix: disable keep/undo once tapped, or dismiss the card synchronously before awaiting.

**Deep-link box route has no module allow-list; forwards arbitrary path segments to navigate()**
- Location: apps/native/src/navigation/useDeepLinks.tsx:39
- Dimension: validation
- Detail: resolveDeepLink maps `ollie://box/<rest>` to `/box/${rest}` with no validation against the known module set. Impact is contained (client-side React Router, escaped render), but deep links are an attacker-influenceable entry point, so unvalidated forwarding is a latent footgun if box routes gain side effects. Fix: validate rest against the module-id registry and return null otherwise.

**App-command event channel (schedule/cancel/snapshot) reachable by any webview JS with CSP disabled**
- Location: apps/native/src-tauri/tauri.conf.json:24; src/local_notifications.rs:59-68; src/group_container.rs:55
- Dimension: security
- Detail: Because the app is served over localhost the ACL blocks invoke(), so the code listens for ungated Tauri events; with `security.csp: null`, any injected script can emit those events to schedule/cancel arbitrary OS notifications and write App-Group JSON. The snapshot handler validates shape+size, but the notification handlers don't bound title/body length or schedule volume. Threat model is local, so low. Fix: set a real CSP (script-src 'self' + Clerk/Turnstile origins); rate-limit/bound the schedule listener.

**Bundle identifier inconsistency between macOS conf, iOS conf, and App Group (snapshot inert on iOS)**
- Location: apps/native/src-tauri/tauri.conf.json:5, tauri.ios.conf.json:2, src/group_container.rs:12
- Dimension: correctness
- Detail: macOS identifier is com.ollie.app while iOS is app.ollie.ollie; the App Group GROUP_ID is the Team-ID-prefixed string compiled for BOTH platforms, so on iOS containerURLForSecurityApplicationGroupIdentifier is asked for a non-matching group id, container_path() returns None, and every snapshot write silently fails (Err ignored) — the widget/Siri feature is inert on iOS with no error surfaced. Fix: make GROUP_ID platform-conditional, align the macOS bundle id, and log the write Err.

**sentry-tunnel is an unauthenticated open proxy with wildcard CORS and no body-size limit**
- Location: workers/sentry-tunnel/src/index.ts:22-107
- Dimension: security
- Detail: Accepts any POST from any origin, validates only DSN host + project id (embedded in shipped clients), not the DSN public key, then forwards to Sentry — anyone who learns the project id can spam your Sentry quota/issues; request.text() has no size cap (CPU/egress flood). Blast radius is your own Sentry quota, so low. Fix: max body-size guard + validate DSN public key (or rely on Sentry-side limits); tighten CORS to app origins.

**apns-push KV rate-limit is read-then-write racy and eventually-consistent**
- Location: workers/apns-push/src/index.ts:135-149
- Dimension: resilience
- Detail: checkRate does get→parse→compare→put, so concurrent requests both read the same count and lose increments; KV is eventually consistent across colos. The 5 req/s "cap" is best-effort, not a hard ceiling. Abuse surface is small now (gated by APNS_INTERNAL_SECRET). Fix: document as soft, or use a Durable Object / Rate Limiting binding for an atomic counter if a hard cap is needed.

**flush APNs delivery doesn't distinguish permanent token failures (410/BadDeviceToken) from transient**
- Location: workers/cron/src/flush-notifications.ts:221-241,311-340
- Dimension: resilience
- Detail: processJob treats any non-ok as transient and routes through applyRetry; 410/Unregistered/BadDeviceToken tokens never succeed but are retried to MAX_ATTEMPTS and never pruned from push_tokens, wasting the retry budget and (since anyOk requires one ok) failing whole jobs for multi-device users with one stale token. The Apple reason is captured but unused. Fix: on a permanent reason, delete/deactivate the token row and treat it as non-retryable.

**cadence-scanner in-process sessionFired Set grows unbounded on long-lived sessions**
- Location: packages/orchestrator/src/cadence-scanner.ts:343,379,386,399,483
- Dimension: perf
- Detail: sessionFired keys embed the local day, so each new day adds fresh keys per still-overdue entry; it's cleared only in teardown while the persisted lastFired twin is pruned to 30 days. A desktop app left open for weeks (documented usage) accumulates ~(overdue × days) keys — a slow leak. Fix: prune sessionFired by embedded day like lastFired, or rebuild it from lastFired each scan.

**Two divergent isoWeekKey implementations (local vs UTC) used as cross-module dedupe keys**
- Location: packages/orchestrator/src/body-weekly.ts:313-322 (local) vs body-correlations.ts:172-184 (UTC), goals.ts:89-100 (UTC)
- Dimension: clean-code
- Detail: body-weekly computes the ISO week from local time while the other two use UTC. They agree on mid-week dates today, but near local midnight on a Sun/Mon boundary they can disagree, and these keys feed notification dedupe/aggregation. Three copies of a subtle date algorithm is a maintenance + edge-case hazard. Fix: a single shared UTC-based isoWeekKey helper.

**ingest-event forwards arbitrary client row keys to Supabase REST**
- Location: workers/ai-proxy/src/telemetry.ts:200-259
- Dimension: validation
- Detail: handleIngestEvent validates the table + overwrites user_hash/user_id + bounds key count/size, but passes body.row verbatim, relying entirely on DB column constraints. Acceptable for append-only telemetry today, but a future table added to ALLOWED_TABLES with a sensitive writable column would be silently exploitable. Fix: per-table column whitelist dropping unknown keys.

**feed-me / route / partner failures swallowed; clients can't distinguish auth/limit from upstream**
- Location: workers/ai-proxy/src/router/feed-me.ts:214-222,338-345
- Dimension: resilience
- Detail: feed-me returns 200 with source:'static_fallback' on Voyage failure and on full-cascade exhaustion; combined with the missing rate limit on sibling /route endpoints, there's no backpressure signal on the most expensive paths — an attacker burns the full Gemini→Groq→CF→OpenRouter cascade while getting 200s. Fix: keep the static_fallback UX but emit a telemetry counter on provider-exhaustion; ensure the rate-limit fix covers feed-me's cost path.

**Per-module migrationPromise caches a rejected promise (data-crypto restatement)**
- Location: apps/native/src/modules/grocery/migrate.ts:92-158, cycle/migrate.ts:38-40
- Dimension: resilience
- Detail: Same root cause as the high-severity migrate finding, reported independently by the data-crypto lane at low severity: a rejected migration promise is memoised and blocks in-session retry, unlike the ledger-backed runMigrations. Fix: null out migrationPromise on rejection; route module schemas through runMigrations.

**Module-blob upsert dedupe key (module,updated_at) is not actually unique**
- Location: packages/sync/src/index.ts:151-161,184-209
- Dimension: correctness
- Detail: drainOnce removes shipped queue entries by `${module} ${updated_at}`; two pushModule calls for the same module within the same millisecond produce identical keys, so a still-pending newer entry can be removed as "shipped" and dropped. Low likelihood given the 300ms debounce. Fix: identify queue entries by a monotonic per-enqueue sequence id.

**_inspect().queueDepth reports pre-coalesce length; cross-tab `mod.startsWith('_')` filter is dead**
- Location: packages/store/src/cross-tab.ts:24; packages/sync/src/index.ts:306
- Dimension: clean-code
- Detail: Two minor observability/isolation issues: _inspect returns the raw queue length (can mislead diagnostics), and the cross-tab `_` guard never fires because internal sync bookkeeping (_sync_queue, _sync_local_ts) are KEYS inside the `shared` module, not module names — so cross-tab writes to shared's sync-queue still re-notify shared subscribers in other tabs, giving false isolation. Fix: report coalesced depth; namespace sync bookkeeping under a separate top-level key and filter on it.

**@ollie/research-stream is entirely dead code — zero production call sites for a privacy-critical package**
- Location: packages/research-stream/src/index.ts
- Dimension: reinvented-wheel
- Detail: No import of '@ollie/research-stream' anywhere in apps/ or workers/; the doc claims it's used by retention/session hooks/consent-audit but those wirings don't exist (the live path is orchestrator/research.ts). 350 lines of privacy-sensitive code + GDPR export/delete/withdraw ship unused, falsely implying GDPR withdrawal is wired. Fix: delete the package or wire it to the claimed paths; otherwise mark the doc as unwired.

**Multi-word brand allowlist entries can never match single-token isBrand() callers**
- Location: packages/pii-scrub/src/brand-allowlist.ts:17-71; index.ts:310-318,397-403
- Dimension: correctness
- Detail: BRAND_ENTRIES includes multi-word brands ('royal canin', 'general mills', 'yapı kredi'), but isBrand() does a single-token Set lookup and all callers pass one word — so ~15 multi-word entries are dead, causing over-redaction (real brand tokens wrongly tagged [NAME]). Low (over-redaction, not a leak). Fix: phrase-match multi-word brands, or split into distinctive single tokens.

**Exclusion guard in detectCrisisIn doesn't implement the documented 'another non-excluded match' rule**
- Location: packages/crisis-lexicon/src/index.ts:99-126 vs types.ts:52-57
- Dimension: correctness
- Detail: The doc says a match is dropped on exclusion UNLESS another non-excluded match fires; the implementation sets one exclusionHit boolean on any exclusion substring and suppresses ALL tier-1 matches, so an unrelated genuinely-concerning tier-1 phrase in the same dump is wrongly suppressed — leaning toward false negatives, against the module's stated priority. Fix: track which span overlaps an exclusion and suppress only that match.

**Aggregated digest notifications bypass the daily-cap budget check**
- Location: packages/notifications/src/index.ts:124-127,390-404
- Dimension: correctness
- Detail: When a spec has aggregation_group, the daily-cap check in notify() is skipped and the flush delivers via deliverNow(spec, true) without re-consulting countDeliveredToday/daily_cap, so digests + subsequent flushes can exceed budget.daily_cap. Fix: re-check the daily cap in the digest delivery path.

**createApnsJwtSigner cache ignores config changes (stale token if key/team rotates)**
- Location: packages/apns-jwt/src/index.ts:90-105
- Dimension: correctness
- Detail: getApnsJwt caches purely by expiry, not keyed on keyId/teamId/authKey, so a config change (key rotation, multi-app teamId) within the ~45-min reuse window returns a token signed with the old key → APNs 403 until expiry. Low (config is module-static today) but the per-call API invites the bug. Fix: include a hash of (keyId+teamId) in the cache entry; re-sign on change.

**Four worker tables created without IF NOT EXISTS — non-idempotent migrations (truncated lane)**
- Location: supabase/migrations/2026* (db-migrations lane, content truncated in source)
- Dimension: correctness
- Detail: The db-migrations lane flagged four worker tables created without `IF NOT EXISTS`, making the migrations non-idempotent on re-run. The lane JSON was truncated mid-entry in the source, so exact table names/line numbers are unconfirmed — flagged here as a placeholder so the next round re-confirms. Fix: add `IF NOT EXISTS` (or guard via the migration ledger) and verify the full table list.
