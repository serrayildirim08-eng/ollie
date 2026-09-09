# Ollie Repo Audit — Round 1 (2026-06-18)

20 lanes audited the native app, Cloudflare workers, shared packages, and Supabase migrations. After merging exact and near-duplicate findings, this round surfaces **2 critical**, **15 high**, **23 medium**, and **23 low** distinct issues. The dominant themes: (1) the costliest AI router endpoints (`/route/dump`, `/route/:module`, `/brain-copy`) ship with no per-user rate limit and `/brain-copy` is effectively an open LLM proxy; (2) the encrypted-sync write path is fundamentally broken (base64 into bytea CHECK columns rejects every write) and multi-device decryption cannot work with per-device salts; (3) the dump→module update loop has real correctness holes (silent handler-failure loss, missing re-entrancy/idempotency guards, up-to-6s stale window); (4) a per-module migration memoise-the-rejected-promise pattern can brick a module's schema for the whole session while a resume-safe ledger sits unused; (5) several health detectors are statistically/temporally wrong (circular sleep-midpoint median, three conflicting cycle-phase boundaries, DST day-stepping); and (6) pervasive component/util/helper copy-paste across the native UI. Six worker-owned Supabase tables shipped ENABLE-but-not-FORCE RLS for ~a month, and migration history has drifted from prod.

---

## Critical

**AI router endpoints (/route/dump, /route/:module, /brain-copy) have NO per-user rate limit**
Location: workers/ai-proxy/src/index.ts:386-406
Dimension: cost / resilience
The three most expensive endpoints bypass `checkRate()` entirely. `/route/dump` fans out to Voyage embed + Groq 70B classify + Gemini vision + Cloudflare AI cascade; `/route/:module` runs Voyage + Groq tool-call with a 2-model tier ladder; `/brain-copy` runs Groq gpt-oss-120b. Every other write/AI endpoint (purchase, cook-history, transcribe, partner, feed-me, telemetry, server-apply) is rate-limited. A single authenticated user — or ANY caller when `T0_JWT_ENFORCED='0'` — can loop these and burn the Voyage/Groq/Gemini budget unbounded. Wrap all three in `checkRate()` keyed on the verified Clerk sub (resolveUserIdForRateLimit exists).

**Sync sends base64 to bytea columns — IV CHECK constraint rejects every encrypted sync write**
Location: packages/sync/src/index.ts:156-157, packages/sync/src/finance.ts:350-351, packages/api/src/client.ts:320-330
Dimension: correctness
Sync clients persist ciphertext/iv as base64 strings and POST them as raw JSON into Postgres `bytea` columns. PostgREST/pg parse JSON strings into bytea as hex/escape, NOT base64, so the literal ASCII of the base64 text is stored. `encrypted_state.iv` has `check (octet_length(iv) = 12)`; a 12-byte IV base64s to 16 chars → octet_length=16 → CHECK violation → every encrypted sync write is rejected (or, where no CHECK exists, stores garbage that fails to decrypt on pull). finance.ts even documents the needed base64→\x hex conversion but it exists nowhere. Fully masked because tests mock `upsert`. Fix: store base64 in text columns, or convert to `\x` hex before upsert; add a real bytea round-trip test.

---

## High

**Per-module migration caches a REJECTED promise — one transient failure bricks the module's schema for the session**
Location: apps/native/src/modules/{finance,cycle,goals,grocery,habits,mood,sleep,body,brain,pets,work,medication,admin}/migrate.ts; dump/archive.ts:38-47
Dimension: resilience
Every module memoises `if (!migrationPromise) migrationPromise = (async()=>{...})()`. If the first call rejects (DB lock, plugin-sql not loaded, transient ALTER), the rejected promise is cached forever; every later `migrateXxx()` returns it, so CREATE TABLE never re-runs and every handler throws (caught as ok:false → silent data loss) for the rest of the session. Only admin has a (test-only) reset. Fix: `.catch(e => { migrationPromise = null; throw e; })`, or route through the resume-safe ledgered runMigrations().

**Silent handler failure = silent loss of the dump's intended action**
Location: apps/native/src/dump/DumpScreen.tsx:164-220; apps/native/src/modules/dispatch.ts:80-88
Dimension: resilience
dispatchRouterOutput wraps handlers and converts failures to `result.ok === false`. DumpScreen only surfaces entries with `needsConfirm === true`; `ok:false` non-confirm entries are dropped. The optimistic "Okay!" already fired. So "bought milk" → ack shown → pantry write silently fails → nothing on screen. Raw words are archived but the intended state change is lost, contradicting the "a dump is never lost" contract. No retry, no dead-letter, no alert. Fix: detect `ok===false && !needsConfirm`, surface a quiet retry affordance, log a Sentry breadcrumb, ideally enqueue for bounded retry.

**No re-entrancy guard in submit() — keyboard/voice paths double-dispatch the same dump**
Location: apps/native/src/dump/BrainDumpInput.tsx:141-151, 246-255, 305-312
Dimension: correctness
submit() never bails when already loading; the only loading guard is the send Button's `disabled` prop. onKeyDown (`Cmd/Ctrl+Enter`) and the voice handler bypass that guard, so two rapid presses (or Enter during a ~30s route) call submit twice → two POST /route/dump → handlers write the fragment twice (grocery repo uses plain INSERT, no upsert). Fix: early `if (state.kind==='loading') return;` plus a ref-based in-flight flag.

**Client never sends dumpId — server idempotency key changes on every retry**
Location: apps/native/src/dump/BrainDumpInput.tsx:188-195; workers/ai-proxy/src/router/dump.ts:208; server-apply.ts:77,85-90
Dimension: resilience
RouteDumpRequest supports `dumpId` but the client never sets it, so the worker mints `crypto.randomUUID()` per request. server-apply keys its idempotent inbox on `${userId}:${dumpId}:${i}`, so a retry of a request that actually succeeded server-side produces a new dumpId → duplicate dump_inbox rows → duplicate writes once SERVER_APPLY is authoritative. Whole idempotency mechanism is inert. Fix: generate one stable dumpId per submission, reuse across retries.

**Dump writes don't notify the open Box — up to 6s stale window after every capture**
Location: apps/native/src/modules/dispatch.ts:116-130; all 14 *Box.tsx setInterval polls
Dimension: stale-state
Module repos write to SQLite (no change notification). dispatch mirrors to @ollie/store and recomputes brain but emits no signal a mounted Box can subscribe to. Each Box's only freshness path is a 6s setInterval (POLL_MS=6000). Dumping "bought milk" while on /box/grocery shows stale data for up to ~6s. TodayNoticings reacts instantly because it subscribes to @ollie/store keys; Boxes have no equivalent because their data is in SQLite. Fix: emit a `ollie:data:<module>` CustomEvent (or bump a store counter) on write; Boxes refresh on it.

**Grocery handler casts payload to wrong types vs schema — string quantity into numeric column, phantom `unit` field**
Location: apps/native/src/modules/grocery/handler.ts:24-27,79-82; router/schema.ts:335; grocery/repo.ts:33,127,141,163
Dimension: correctness
Schema declares `quantity?: string` (e.g. "2 liters") and `shopping_list_add` has no quantity/unit at all. The handler reads via fabricated casts `(p as {quantity?: number}).quantity` and `(p as {unit?: string}).unit`, passing quantity into a REAL/numeric column that even gets arithmetic (`(row.quantity ?? 0) + (quantity ?? 0)`). So a real "2 liters" string lands in numeric merge math (garbage/NaN), and `unit` is dead code always null. The `as` casts bypass the discriminated union built to prevent this. Fix: use the real schema type, treat quantity as a string.

**/brain-copy forwards a fully client-supplied system+user prompt to Groq verbatim (open LLM proxy)**
Location: workers/ai-proxy/src/router/brain-copy.ts:70-99
Dimension: prompt injection / cost / security
handleBrainCopy accepts arbitrary `system` and `user` strings (4000 chars each) and passes them straight to groqChat with the worker's GROQ_API_KEY. Nothing enforces it be a noticing-copy prompt — any authenticated user gets a free general-purpose gpt-oss-120b endpoint on Ollie's account. Combined with the missing rate limit, an uncapped open proxy. Fix: build the prompt server-side from {noticing, day, lang} with a fixed template, or at minimum rate-limit and hard-cap maxTokens.

**cacheHitBump drops createdAt — every repeat-hit Vectorize entry is permanently "expired" on next read**
Location: workers/ai-proxy/src/router/vectorize.ts:171-186 vs 100-102
Dimension: correctness / cost
cacheLookup drops rows when `Date.now() - createdAt > TTL_MS`, defaulting a missing createdAt to 0. cacheHitBump re-upserts metadata but omits createdAt, so after the first hit the row's createdAt is gone; next lookup sees 0 → treated as expired → null. Any phrase said a second time re-hits AI on the third utterance forever after; the popularity/hitCount machinery is silently defeated and AI cost is higher than intended. Fix: preserve createdAt in cacheHitBump or fall back to lastHitAt.

**label.ts daily cost cap is a non-atomic read-modify-write and uses a flat per-call estimate**
Location: workers/ai-proxy/src/label.ts:135-144,242-244,62-63
Dimension: cost / correctness
The cap reads today's KV spend, checks budget, then later writes `used + ESTIMATED_COST_PER_CALL_USD`. Concurrent calls all read the same `used` before any write → budget overshot by the number of in-flight requests. Worse, spend increments by a hardcoded flat $0.001 not actual usage; with claude-sonnet-4-6 and max_tokens=256 a single call's output alone can be ~$0.0038 (~4x), so tracked spend systematically understates and the cap fires late. Docstring also wrongly claims a 280-char cap (actual 2000). Fix: increment by real `response.usage` tokens, make atomic (DO counter).

**Sleep midpoint (chronotype / social-jetlag) uses a linear median on circular clock-time data**
Location: packages/logic/src/sleep/stats.ts:139-142,173,185-186
Dimension: correctness
Sleep midpoints are minutes in [0,1440) then run through a plain linear `_median`. Clock time is circular: midpoints clustering near midnight (1430 and 10) have true center ~0, but linear median = 720 (NOON) — a 12-hour error. computeSocialJetlag wraps the final delta but only AFTER each group's median is computed linearly, so msw/msf are wrong whenever a group straddles midnight — exactly the late-chronotype population MSFsc targets. Fix: circular mean via atan2(mean sin, mean cos), or anchor to a noon-cut biological-night frame.

**Three inconsistent cycle-phase boundary definitions produce different phase labels for the same day**
Location: packages/logic/src/patterns/phase-fold.ts:48-53; packages/logic/src/cycle/phase.ts:51-56,144-146
Dimension: correctness
The follicular/ovulation boundary is defined three ways: `day <= L-18` (phaseForDay), `day < L-18` (computePhaseForDate), `day < L-17` (correlateSymptom). Different detectors consume different functions on the same user data, so a symptom on day L-18 is "follicular" by one feature and "ovulation" by another, then surfaced as a clinical-sounding pattern. Fix: one shared phaseForDay used by all call sites, one documented convention.

**work/goals time-window notification cues never fire on a timer — only on store-key change**
Location: packages/orchestrator/src/work.ts:273-372,379-437; goals.ts:228-323
Dimension: correctness
work.scanCues dispatches strictly time-windowed cues (meeting_30m in [28,32]min, session_end in [0,3]min, session_90_warn in [85,90]min) but is invoked only at cold-start and on store.subscribeKey changes — there is NO recurring timer (unlike medication's 60s and body's hourly ticks). A meeting added in the morning gets its 30-min reminder only if some store key happens to mutate inside that 4-min window. Same for goals weekly_check_in/deadline_30d/paused_14d. Fix: add a self-arming interval (or fold into the cadence-scanner foreground tick).

**cycle prediction cues only emit on item change, not on the 60s clock tick**
Location: packages/orchestrator/src/cycle.ts:469 vs 340-342
Dimension: correctness
The 60s interval calls recomputeCycleTime() which refreshes phase/flags but does NOT call emitPredictionEvents() or emitPillMissed() — those run only inside full recomputeCycle(), triggered only by the cycle.items subscription + one cold-start. Prediction windows are narrow (period_imminent (0,1d], approaching (4d,5d], luteal_starting (2d,3d]), so if the user logs nothing during the open window the period-imminent / luteal-spending push is missed. The 60s tick gives a false impression cycle is time-driven. Fix: have the tick also call emitPredictionEvents/emitPillMissed (keys already deduped).

**Per-device random salt blocks multi-device decryption of synced data**
Location: packages/auth/src/index.ts:150-164; packages/sync/src/index.ts:87-91
Dimension: correctness
createVault generates a fresh random salt per device, persisted only locally in `shared.vault.salt`. The same passphrase derives a different AES key on device B, and since `shared` itself is encrypted and synced, the salt can't bootstrap from sync (reading it needs the key). The package advertises multi-device sync but there's no salt-sharing/key-handoff path, so a second device decrypts zero rows. Fix: deterministic shared salt (server-stored per-account value or profile_recovery handoff), or document single-device-only and gate the claim.

**Finance delta cursor can permanently skip rows that share an updated_at at a page boundary**
Location: packages/sync/src/finance.ts:420-447,544-546; migration 20260514000008:95-113
Dimension: correctness
syncIn pulls `order updated_at.asc limit 500` with a strict `updated_at=gt.<cursor>` and no secondary tiebreaker. The server trigger clamps client updated_at up to now(), so a bulk import can assign the SAME now() to far more than 500 rows. After page 1 the cursor becomes that timestamp and `gt.cursor` permanently excludes the same-timestamp tail — silent permanent data loss; recurse-on-full-page doesn't help. Fix: compound keyset cursor `(updated_at, id)`.

**Module-blob LWW: syncIn re-arms local timestamp and echoes pulled data, skipping later remote updates**
Location: packages/sync/src/index.ts:268-274,248-249,310-314
Dimension: correctness
Applying a remote row fires the same subscriber that bumps `_sync_local_ts.<m>` to now() AND re-pushes the just-pulled blob. The bumped ts then makes the next genuinely-newer remote row look older (`remoteTs <= localTs`) and be skipped → lost remote updates + wasted re-uploads. The finance path defends against this (snapshot refresh); the module-blob path does not. Fix: suppress subscriber side effects during applyModule, or set local ts to the row's remoteTs.

**Research corpus ships sensitive-category-only rows (privacy structure leak)**
Location: packages/orchestrator/src/research.ts:163,265
Dimension: pii-scrub
The "empty after scrub" gate strips only [EMAIL|PHONE|ADDRESS|URL|GPS|NUMERIC|NAME], NOT [MENTAL_HEALTH|MEDICAL|MEDICATION|SEXUAL]. A dump whose only content is a sensitive disclosure scrubs to e.g. "[MENTAL_HEALTH]" (len 15), passes the >=3 check, and is POSTed to research_corpus — leaking the category and fact-of-disclosure into the B2B corpus, exactly what those passes exist to prevent. Fix: add the sensitive tokens to both strip regexes, or have scrubPII return meaningfulResidualLength.

**routeViaHaiku rate-limit gate never updates timestamp on failure or concurrent calls**
Location: packages/api/src/anthropic.ts:17,169,230
Dimension: resilience
__lastCallTs is read at the gate but written only on a fully successful parse, and only after the await. So N parallel calls all see the old timestamp and fire N concurrent Anthropic requests (no burst protection), and every failing call skips the update so a retrying user hammers the proxy with no throttle — bypassable precisely under highest load. Fix: set __lastCallTs immediately after passing the gate, before issuing fetch.

**Dark-mode ThemeProvider/useTheme is dead infrastructure — every component imports static light-only colors**
Location: apps/native/src/theme/tokens.ts:116; theme/ThemeProvider.tsx; 30 components import { colors }
Dimension: dead-components
tokens.ts ships a full darkPalette + buildTokens(mode), ThemeProvider injects CSS vars and exposes useTheme/useTokens — but useTheme has ZERO consumers outside ThemeProvider itself, while 30 components statically import `colors` hardwired to lightPalette. Toggling mode recolors nothing; the entire dark-mode pipeline is inert and misleads readers into thinking dark mode works. Fix: either wire components to useTheme/CSS vars, or delete the dead pipeline.

---

## Medium

**Ledgered migration runner exists but no module uses it — 13 modules reinvent an inferior memoised-promise + PRAGMA pattern**
Location: apps/native/src/storage/migrate.ts vs apps/native/src/modules/*/migrate.ts
Dimension: reinvented-wheel
storage/migrate.ts provides a versioned `_ollie_migrations` ledger (run-once, resume-from-failure, addColumnIfMissing) built explicitly to replace per-module hand-rolled CREATE TABLE + ad-hoc PRAGMA backfills. runMigrations is imported only by store.ts; no module uses it. All 13 modules hand-roll the memoise + PRAGMA table_info + manual ALTER blocks (finance alone ~10), which is the source of the rejected-promise bug. Fix: migrate modules to register Migration[] with runMigrations().

**checkRate() ignores maxOverride when the native rate-limit binding is live — purchase/feed-me capped at 10/min**
Location: workers/ai-proxy/src/rate-limit.ts:37-40
Dimension: correctness
When AI_RATE_LIMITER/TELEM_RATE_LIMITER bindings are present (they are), checkRate returns `limiter.limit({key})` and never consults maxOverride; wrangler.toml hardcodes both to limit=10/60s. So purchase (intended 100), server-apply (60), cook-history/transcribe/partner all actually get 10/min — legitimate checkout bursts will 429. Functional regression hidden by the binding rollout. Fix: distinct bindings per budget tier, or make maxOverride explicitly authoritative; add a test.

**No runtime validation of router payloads before blind `as XxxAction` cast**
Location: apps/native/src/modules/dispatch.ts:50-89; every modules/*/handler.ts
Dimension: validation
dispatch pulls a handler by `fragment.module` and the handler does `payload as XxxAction` with zero runtime checks — nothing verifies payload.module === fragment.module, that action is known, or that required fields exist. Worker/native version drift or a colliding action writes a malformed row; the `as` cast erases the discriminated union meant to guard this. Fix: a shared assertPayload(module, payload) at dispatch checking module + known action before handoff.

**Layer-2 re-routing parses arbitrary worker JSON straight into a typed action with no shape validation**
Location: apps/native/src/modules/body/handler.ts:63-78; sleep/handler.ts:63-76
Dimension: validation
maybeUpgradeFragment takes the worker's Layer-2 response as `JSON.parse(first.data) as BodyAction/SleepAction` — only JSON-validity checked, not shape — then forces it into a body/sleep fragment and dispatches. A model returning `{action:'log_water', amountMl:'lots'}` or another module's action writes malformed rows. Duplicated verbatim in two modules. Fix: validate against known actions/required fields before upgrading (reuse assertPayload); keep original fragment on invalid shape.

**Safety-critical medication handler logs doses with no guard on empty/blank medName — auto-registers junk meds**
Location: apps/native/src/modules/medication/handler.ts:31-59; repo.ts:91-104
Dimension: validation
medName is trusted unconditionally; logDose → medications.ensure(name) INSERTs a registry row with normaliseName(name) and no non-empty check. A worker emitting `medName:''`/whitespace creates an empty-named med plus a dose event; the adherence watcher then computes against a phantom med. Fix: if normaliseName is empty, return ok:false rather than persist (same pattern finance already applies).

**scheduleReminderIfPresent duplicated verbatim across work and admin handlers**
Location: apps/native/src/modules/work/handler.ts:177-201; admin/handler.ts:119-145
Dimension: reinvented-wheel
A ~25-line helper (guard remindIn, build `reminder:<taskId>` id, scheduleAt with OLLIE_REMINDER_CATEGORY, scheduleServerReminder with dedupe_key) exists twice, differing only by module tag and action_url. The cross-fire/dedupe stable-id contract is now maintained in two places. The work copy's own docstring admits it mirrors admin. Fix: promote to one shared notify helper.

**encryptedKv stores no PBKDF2 iteration count — decrypt always assumes 600k, breaking legacy/cross-version payloads**
Location: apps/native/src/storage/encrypted.ts:40-65
Dimension: correctness
The envelope is {iv, ciphertext, salt} omitting the iteration count; get() always derives at the default 600k, violating the @ollie/crypto contract (each envelope must store its count, fall back to LEGACY 100k when absent). Any value written at 100k (or a future bumped count) becomes permanently undecryptable. Latent because encryptedKv currently has zero callers, but a live trap. Fix: persist `iterations` in the envelope and pass it on get; or delete the dead module.

**All local SQLite is plaintext on disk — cycle, medication, mood, finance, raw dump text unencrypted at rest**
Location: apps/native/src/storage/sqlite.ts:36; cycle/medication/mood/finance repo.ts; dump/archive.ts
Dimension: security
sqlite.ts opens a plain unencrypted `sqlite:ollie.db` with no SQLCipher/PRAGMA key. Every repo writes its most sensitive content as cleartext: pregnancy markers + bleeding intensity, med names + dose log, mood events, spend/income/merchant, and the full raw dump text. The @ollie/crypto stack exists but is unused for local rows (cycle/bridge.ts:68 flags "cycle SQLite is plaintext"). For a privacy/health product with biometric app-lock, at-rest plaintext means device-file or backup exfiltration exposes everything. Fix: SQLCipher keyed from the passphrase-derived key, or field-encrypt the highest-sensitivity columns.

**Dual identity model (Supabase uuid vs Clerk text) split across tables with no single source of truth**
Location: supabase/migrations/ (encrypted_state/profiles/finance_records/scheduled_jobs/push_tokens = uuid; routing_cache/grocery_purchase_history/cook_history/partner_*/dump_inbox/grocery_pantry = Clerk text)
Dimension: standards
Two parallel auth systems coexist; repeated uuid→text fix migrations are symptoms of new tables authored as `user_id uuid references auth.users` then failing at runtime against a Clerk worker. Guarantees the next worker-owned table repeats the bug, and a GDPR-erasure routine deleting by Supabase uuid would silently miss every Clerk-keyed table. Fix: document the identity boundary, add a migration checklist (worker tables use `user_id text`, no FK auth.users), verify GDPR covers both id spaces.

**Migration history drift: recent migrations partially applied to prod and applied manually, not via tracked db push**
Location: supabase/migrations/20260618000001...sql:1-3; 20260615000002...sql:15
Dimension: resilience
Multiple recent migrations carry comments like "may be partially applied to prod; forward-only fix" and "Apply at deploy; needs Serra/dev". The .sql files are not a reliable mirror of ollie-prod, so the FORCE-RLS hardening closing real owner-bypass gaps may or may not be live, with no way to confirm from the repo. Fix: run `supabase migration list` against prod, reconcile, apply outstanding via tracked db push.

**Six worker-owned tables shipped with ENABLE but not FORCE RLS for ~1 month (owner-bypass window)**
Location: supabase/migrations 20260521000001:70, 20260522000001:31, 20260522000002:26, 20260602103016:47-49, 20260611000001:32,55
Dimension: security
routing_cache, grocery_purchase_history, cook_history, partner_codes/pairs/snapshots, dump_inbox/grocery_pantry all shipped ENABLE-only RLS. Without FORCE, RLS doesn't apply to the table owner role, so any owner/pooler/trigger connection bypasses every policy — and partner_snapshots/dump_inbox hold cross-user + encrypted payload data. Closed only by 0615002/0618001 (unconfirmed live). Older tables used FORCE from day one — a regression in newer authorship. Fix: confirm FORCE live on all eight; add FORCE to the table-creation template; add a test asserting FORCE on every RLS table.

**partner_snapshots / dump_inbox cross-user safety depends entirely on worker code, not the database**
Location: workers/ai-proxy/src/router/partner.ts:135-153; migration 20260602103016:53-55
Dimension: security
These tables have a single `FOR ALL TO service_role USING(true) WITH CHECK(true)` policy; service_role bypasses RLS anyway, so the DB provides zero row-scoping. The only thing preventing user A reading user B's snapshot is the worker building the right `user_id=eq.<partnerId>` filter from a verified JWT. Correct today, but no defense-in-depth: one future filter bug or query-string injection leaks another user's data. Fix: add real RLS predicates / defense-in-depth scoping where feasible.

**/route/:module accepts unbounded body.text and body.context (no length cap)**
Location: workers/ai-proxy/src/router/route.ts:246-254
Dimension: validation
handleRoute checks only that body.text is non-empty; no max-length (contrast dump.ts MAX_TEXT_CHARS=10_000). body.context is `unknown` and rendered into the system prompt unbounded. A multi-MB text/context is sent to Voyage (token cost) and Groq — direct cost amplification, compounded by the missing rate limit. Fix: MAX_TEXT_CHARS guard returning 413 + cap serialized context size.

**/enrich-dump does not bound raw_text length before scrubbing + queuing**
Location: workers/ai-proxy/src/telemetry.ts:115-191; index.ts:343-371
Dimension: validation
handleEnrichDump checks raw_text is a string but applies no length cap and there's no Content-Length pre-check; the scrubbed payload is queued and later sent to Anthropic Haiku. Companion /ingest-event caps at 16 KiB and /brain-dump at 1 MiB; enrich-dump has neither. Large payloads inflate downstream Anthropic cost + queue storage. Fix: MAX_RAW_TEXT_CHARS cap returning 413 and/or Content-Length pre-check.

**/generate-invite and /claim-invite trust client-supplied user hashes instead of binding to the verified JWT**
Location: workers/ai-proxy/src/invites.ts:62-140,202-295
Dimension: validation
generate-invite verifies the JWT but writes `body.inviter_user_hash` (arbitrary client value); claim-invite writes `body.invitee_user_hash` unchecked. Telemetry already fixed exactly this IDOR class by overwriting with a server-derived hash; invites still trust the client. A user can mint/claim invites attributed to any other user's hash, poisoning funnel attribution. Fix: derive the hashes server-side from the verified userId (reuse deriveUserHash), ignore the client field.

**classifyBatch user message tells the model to "IGNORE the instruction above" — injection-fragile framing over attacker-controlled fragments**
Location: workers/ai-proxy/src/router/dump-classify.ts:284-290
Dimension: prompt injection / correctness
The batch user message interleaves user fragment text and instructs the model to "IGNORE the single-object response instruction above." Establishing an "ignore the previous instruction" pattern in the trusted prompt lowers the bar for a crafted fragment to redirect output shape (fragments are only PII-scrubbed, not injection-scrubbed). parseBatchResults also throws on any count mismatch, so a fragment that nudges merge/split fails the whole dump. Fix: make the batch instruction the primary system contract, fence/escape fragments, salvage partial results on mismatch.

**Module migrations cache rejected promises forever (data-crypto lane corroboration)**
Location: apps/native/src/modules/{grocery,medication,goals,finance}/migrate.ts; dump/archive.ts:38-47
Dimension: resilience
Same memoise-the-rejected-promise pathology as the high-severity finding, independently observed in the crypto/storage lane; diverges from the resume-safe central runMigrations ledger. Tracked together; fix is identical.

**Native encryptedKv ignores S7 PBKDF2 iteration migration (crypto-sync lane corroboration)**
Location: apps/native/src/storage/encrypted.ts:42-65
Dimension: correctness
Same encryptedKv missing-iteration-count bug independently found in the crypto lane: set() derives at 600k and stores no kdf_iter, get() derives at 600k, breaking any 100k-era envelope. Medium only because no production callers. Fix: persist kdf_iter and pass on get, default LEGACY 100k; or delete the dead module.

**Multiple persisted dedup arrays grow unbounded — the audit #8 leak, at sites that were missed**
Location: packages/orchestrator/src/finance.ts:362,643,646,769; cycle.ts:252; body.ts:177,201; admin.ts:506
Dimension: perf
appendCapped (cap 200) was added to fix unbounded emitted-id arrays re-serializing an ever-larger JSON blob each recompute. These arrays still append forever: finance _recurringCandidatesEmitted/_subCancelledIds/_billPaidOnTimeIds/_anomalyNotifiedIds, cycle _pillMissedEmittedDates, body _supplementDueEmittedKeys/_postureNudgeEmittedBuckets, admin _appointmentCompletedIds. The body ones accrete one key per supplement/work-hour per day and rewrite on the hourly tick. Fix: route through appendCapped or prune by date cutoff.

**cadence-scanner double-fires the same overdue item across a midnight boundary**
Location: packages/orchestrator/src/cadence-scanner.ts:242-244; notifications/src/budget.ts:79-82
Dimension: correctness
The dedupe key embeds the LOCAL day (`cadence:<module>:<key>:<YYYY-MM-DD>`); notify() dedupes by exact key within 24h. An item still overdue at 23:59 fires with day-key D; at 00:01 the new day produces a fresh key the 24h window can't match, so the same item fires again ~2 min later. The 30-min interval + visibilitychange scans make this real. Fix: key persisted dedupe on (module,key) + a last-fired-ts min-interval check rather than a calendar-day string.

**drain KV list mixes retry-counter keys into the batch, shrinking real throughput**
Location: workers/cron/src/drain.ts:75-124
Dimension: correctness
QUEUE_PREFIX `q:enrich:` and RETRY_PREFIX `q:enrich:retry:` overlap, so list({prefix: QUEUE_PREFIX, limit:50}) returns both payload and retry-counter keys. The loop skips retry keys but they still occupy list slots; under a backlog up to half the 50-key page is counters, so the drain processes far fewer than 50 real dumps per 5-min tick and can fall permanently behind. Counters share the 3-day TTL. Untested. Fix: give retry counters a non-overlapping prefix.

---

## Low

**formatDays + startOfDay date helpers copy-pasted instead of centralized**
Location: apps/native/src/modules/{finance,cycle,admin,work,body,grocery,pets,goals,sleep}/*Box.tsx; MedicationBox.tsx:1060; WorkBox.tsx:1001
Dimension: reinvented-wheel
`formatDays(d)` is defined 9 times byte-identical; the `setHours(0,0,0,0)` day-floor is hand-rolled in two boxes. No shared date util despite formatRelativeTime living in lib. Fix: move formatDays + startOfDay into apps/native/src/lib.

**RemoveButton component hand-rolled 11 times across module Boxes**
Location: apps/native/src/modules/{grocery,finance,work,admin,cycle,sleep,pets,goals,body,mood,medication}/*Box.tsx
Dimension: component-duplication
An identical remove affordance is a local `function RemoveButton` in 11 module files (rg -c → 11) and already drifts (some <Text>, some raw <button>). Any remove-UX change needs 11 edits. Fix: extract one `<RemoveButton>` into apps/native/src/ui/.

**CadenceHint ("usually every X days") duplicated near-verbatim in 9 module Boxes**
Location: apps/native/src/modules/{body,finance,sleep,cycle,pets,goals,admin,work,grocery}/*Box.tsx
Dimension: component-duplication
`function CadenceHint` is defined 9 times with essentially identical bodies, while its sibling WhenCaption IS correctly shared (lib/WhenCaption.tsx). They drift (BodyBox <Text> vs FinanceBox raw <span>). Fix: extract `<CadenceHint>` into lib alongside WhenCaption.

**GroceryNow introduces a third, hardcoded-hex color source diverging from theme tokens**
Location: apps/native/src/modules/grocery/GroceryNow.tsx:18-30
Dimension: inconsistent-patterns
GroceryNow hardcodes its own literal-hex palette ("owns its look"), so the app has three color sources (static colors alias, dead useTheme path, GroceryNow private hex). Theme/redesign changes can't propagate. Fix: add the redesign palette as named tokens, or track it as a temporary spike.

**Oversized module Box components — 800-1349 lines with up to 17 internal components each**
Location: apps/native/src/modules/grocery/GroceryBox.tsx (1349), finance/FinanceBox.tsx (1268), medication/MedicationBox.tsx (1082), work/WorkBox.tsx (1005), goals/GoalsBox.tsx (998), grocery/FeedMeView.tsx (907), admin/AdminBox.tsx (880), body/BodyBox.tsx (801)
Dimension: clean-code
GroceryBox packs 17 `function X` components plus data-loading in one file; 8 boxes exceed 800 lines and each hand-rolls 9-15 useState/useEffect load-subscribe pairs with no shared useModuleData hook. Fix: split into directories + a shared load hook.

**Layout primitives coexist with hand-rolled inline flex — inconsistent layout grammar**
Location: apps/native/src/modules/medication/MedicationBox.tsx (13 inline flex), finance/FinanceBox.tsx (12), grocery/GroceryBox.tsx (8)
Dimension: inconsistent-patterns
Real layout primitives (Stack/Row/Box) are imported by 18 module files yet the same files hand-roll inline `display:flex`/`flexDirection` 8-13 times; spacing is expressed two ways within one component. Fix: lint rule/convention favoring primitives, migrate worst offenders first.

**useBearer auth wrapper re-implemented in every auth-touching component**
Location: apps/native/src/modules/partner/PartnerBox.tsx:56, partner/PartnerCard.tsx:26, brain/TodayNoticings.tsx:118, grocery/FeedMeView.tsx:167
Dimension: reinvented-wheel
The `getBearer = useCallback(async () => (await getToken()) ?? '', [getToken])` wrapper is reinvented in 4 places, drifting on the fallback (`?? ''` vs `?? null`). Fix: one shared useBearer() hook with a single null/empty contract.

**newId() duplicated in 12 module repos**
Location: apps/native/src/modules/{admin,body,cycle,finance,goals,grocery,habits,medication,mood,pets,sleep,work}/repo.ts
Dimension: reinvented-wheel
Twelve repos define an identical newId() (crypto.randomUUID with a 1-2 char per-module prefix). A change touches 12 files. Fix: extract `newId(prefix?)` into a shared util.

**FocusTimer counts setInterval ticks instead of wall-clock — drifts and stalls when backgrounded**
Location: apps/native/src/modules/work/FocusTimer.tsx:148-165
Dimension: correctness
The countdown does `prev-1` on a 1s interval, measuring callbacks fired not elapsed time; WebView throttles/pauses hidden timers, so a 25-min session records less (or stalls then resumes). events.addFocus logs the nominal preset, not actual time — a data-integrity gap for a tracking feature. Fix: anchor to startTimestamp and compute remaining from Date.now().

**FocusTimer brown-noise Audio element is created but never released**
Location: apps/native/src/modules/work/FocusTimer.tsx:112-146
Dimension: memory-leak
noiseRef Audio is only ever paused, never nulled / src-cleared / load()ed on unmount, so the decoded ~120s loop buffer lingers until GC; repeated nav in/out accretes them. Fix: clear src/load() and null the ref in cleanup.

**Module-scope mutable _ackTick is shared global state that never resets**
Location: apps/native/src/dump/DumpScreen.tsx:45,106-109
Dimension: clean-code
A module-level `let _ackTick` forces Ack remount via key; being module-scope it's shared across instances, monotonically grows for the JS context's life, and leaks across HMR. Fix: use a component-local useRef counter.

**Confirm-card keep/undo have no in-flight guard — draft fragment can be applied twice**
Location: apps/native/src/dump/DumpScreen.tsx:188-208; NeedsConfirmCard.tsx:93-110
Dimension: correctness
onKeep awaits applyFragment then dismisses; the keep button is never disabled and dismissal is gated on the async apply. Double-tapping (or tapping during a slow write) applies twice → duplicate write. Same shape on undo. Fix: dismiss optimistically before awaiting, or disable buttons on tap.

**Goal-intent dump can be silently abandoned with no ack and no record of the goal**
Location: apps/native/src/dump/DumpScreen.tsx:119-137,258-269
Dimension: correctness
A goals/create_goal fragment is stripped from dispatch, the optimistic ack retracted, and GoalCreateModal opened. If the user dismisses without saving, no goal is created and the ack never fires (only onCreated fires it) — zero feedback. Raw text is archived but the user's "I want to go to Greece" produces nothing visible. Fix: on dismiss, file a lightweight goal note or fire a quiet ack.

**Optimistic ack shows "Okay!" for goal/crisis dumps during the entire route round-trip**
Location: apps/native/src/dump/BrainDumpInput.tsx:166-167; DumpScreen.tsx:115-117,136,222-228
Dimension: correctness
The instant ack fires before the route returns. Local crisis pre-screen helps but can miss what the server flags, and goal-intent is only knowable post-route, so "Okay!" flashes for the full ~30s round-trip and the retraction races the 2500ms auto-clear. Can read as "filed" when it wasn't. Fix (optional): gate goal/crisis ack behind the route result.

**start_timer uses in-process setTimeout — silently lost on app reload/quit**
Location: apps/native/src/modules/work/handler.ts:126-147
Dimension: resilience
Unlike create_task/log_deadline (OS-local notification + scheduled_jobs row surviving close), a started timer lives only in the JS VM; a reload/unmount/quit drops it with no notification — "set a 25 min timer" then close = nothing. Documented limitation. Fix: persist fire time via scheduleServerReminder, or surface that timers run only while open.

**App Group snapshot writes financial + health-adjacent PII to a shared container in plaintext**
Location: apps/native/src/snapshot/writeSnapshot.ts:37-80; src-tauri/src/group_container.rs:111-119
Dimension: security
writeSnapshot serialises monthly spend total, pantry names, next bill merchant+amount into snapshot.json written verbatim (no encryption, no protection class) into the App Group container shared with any app-group extension. Widens at-rest exposure alongside the plaintext DB. Fix: scope to the minimum the widget renders, set a file protection class, avoid exact amounts/merchant strings.

**groceryPull silently drops server-side depletions and tombstones — pantry can drift permanently out of sync**
Location: apps/native/src/sync/groceryPull.ts:55-76
Dimension: correctness
The pull only ever pantry.add() for non-deleted named rows; deleted/tombstone and depletion events are treated as no-ops AND the cursor advances past them, so a server-side "used up milk" is never reflected and never reconsidered — permanent divergence, not eventual consistency. Gated dark by VITE_SERVER_APPLY. Fix: handle row.deleted/depletions or don't advance the cursor past unapplied rows; add a tombstone-removal test.

**groceryPull cursor stored in localStorage, not the durable store/SQLite used for data**
Location: apps/native/src/sync/groceryPull.ts:15,35,75
Dimension: resilience
The sync cursor is in eviction-prone WKWebView localStorage while data lives in SQLite; if evicted while the DB persists, the next pull re-fetches from the beginning (wasteful, and combined with the depletion gap can resurrect removed items). Fix: persist the cursor in the same store as the data.

**medications_events declares a FOREIGN KEY that SQLite never enforces**
Location: apps/native/src/modules/medication/migrate.ts:43
Dimension: clean-code
The FK to medications_registry is inert because PRAGMA foreign_keys is never ON; behaviour is correct via manual cascade in repo.ts, but the declared FK is misleading documentation a maintainer may trust. Fix: remove the FK clause + comment the manual cascade, or enable the pragma connection-wide (only after auditing every module's delete path).

**scheduleAt() native-schedule path has an uncancellable cancel race**
Location: apps/native/src/notify/systemNotify.ts:268-330
Dimension: correctness
scheduleAt returns synchronously but the decide-to-use-OS-scheduler happens inside an async .then() that only later sets nativeScheduled=true. cancel() called before that resolves sees null/false and no-ops, yet the pending block still emits 'ollie-schedule-notif', orphaning an OS trigger that fires for a deleted/edited reminder and can't be re-cancelled. Fix: track a cancelled flag checked before emit, or emit cancel for the id regardless.

**Snooze reschedule drops action category + extra, so snoozed reminders lose buttons and completion routing**
Location: apps/native/src/notify/notificationActions.ts:96-104
Dimension: correctness
The snooze branch calls scheduleAt with only title/body, omitting actionTypeId (OLLIE_REMINDER_CATEGORY) and extra ({module,refId}). The snoozed notification then has no buttons and no userInfo, so routeNotificationAction bails — a snoozed reminder becomes a dead-end. On the native macOS path title/body are undefined so it says generic "reminder". Fix: re-pass category + meta, carry title/body through the native event.

**Tauri webview CSP disabled (csp: null) on a localhost-served Clerk webview**
Location: apps/native/src-tauri/tauri.conf.json:23-25
Dimension: security
app.security.csp is null so the webview enforces no CSP while loading Clerk/Supabase/worker origins and rendering user- + AI-derived dump content. Any injected script runs with full webview privileges and can emit the privileged Tauri events that bridge to native scheduling and App-Group disk writes. Fix: define a CSP scoped to the actual origins (self localhost:9527 + Clerk + Supabase + workers).

**Privileged native event channel reachable by any script in the webview**
Location: apps/native/src-tauri/src/local_notifications.rs:59-68; group_container.rs:55-84
Dimension: security
Because localhost is treated as remote, ACL blocks invoke(), so scheduling + snapshot writes route over core events with no per-capability gating — any webview script can emit 'ollie-schedule-notif' (spoofed title/body/time), 'ollie-cancel-notif' (suppress reminders), or 'ollie-write-snapshot'. group_container validates (64KB cap + shape) but local_notifications does not. Blast radius compounds with the null CSP. Fix: clamp/validate title/body length + fire-time range in the Rust schedule listener; consider a nonce handshake.

**Deep-link box/:id navigates to any string with no allowlist against the module registry**
Location: apps/native/src/navigation/useDeepLinks.tsx:39; Router.tsx:121-122
Dimension: validation
resolveDeepLink accepts `ollie://box/<anything>` including multi-segment and percent-encoded junk with no validation against known module ids. react-router contains the blast radius (unknown → benign BoxPlaceholder / 404), so it's a UX-hygiene issue on an external attacker-influenceable entry point. Fix: validate against the real module id set, no-op unknown/multi-segment.

**/validate-invite is unauthenticated and not rate-limited — invite-code enumeration**
Location: workers/ai-proxy/src/index.ts:375-377; invites.ts:148-193
Dimension: security
handleValidateInvite is intentionally unauthenticated (landing page) but dispatched with no checkRate; the header comment claims a per-IP CF rate limit that isn't actually wired. Keyspace is 30^8 so brute force is impractical and codes are single-use, but the documented protection doesn't exist and validity leaks pre-auth. Fix: add an IP-keyed checkRate around validate/claim.

**Clerk JWT verification does not validate the audience (azp/aud) claim**
Location: workers/ai-proxy/src/clerk-verify.ts:64-70
Dimension: security
verifyClerkJwt passes only { issuer }, no audience/azp check. Any token minted by the same Clerk instance (e.g. a different frontend on the same project) is accepted. Single-app today so low, but a defense-in-depth gap Clerk's guidance recommends closing. Fix: verify azp against an origin allowlist, or set audience.

**PII scrub runs only worker-side regex; combinedDump (unscrubbed) echoed in response and used for crisis/vision**
Location: workers/ai-proxy/src/router/dump.ts:202-212,248,453; src/pii.ts
Dimension: security / privacy
The embed/classify path scrubs PII but RouterOutput.originalDump returns the unscrubbed combinedDump, and crisis detection + vision use unscrubbed text. The worker-local regex scrubber lacks @ollie/pii-scrub's locale name wordlists + numeric pass, so non-Western/single names and many TR/ES identity tokens reach Groq/Gemini/OpenRouter on cache-miss. prompts/label.md references a [NUMERIC] token pii.ts never emits (drift). Fix: import @ollie/pii-scrub into the classify/label paths, reconcile the token references.

**computeScheduledAt caps only unit='day'; sec/min/hr reminders are unbounded**
Location: workers/ai-proxy/src/router/remindIn.ts:56-72
Dimension: correctness / resilience
The MAX_DAYS=30 ceiling rejects only day>30; the model can emit `{amount:9_999_999, unit:'hr'}` and computeScheduledAt returns a far-future (or overflowing) scheduledAtMs. Fix: convert to absolute ms first and reject anything beyond now + 30 days regardless of unit.

**Cloudflare Workers AI fallback tier does not request JSON mode**
Location: workers/ai-proxy/src/cloudflare-ai.ts:52-59
Dimension: resilience / correctness
cloudflareJson sends no response_format and relies on an unfence() regex, while Groq/Gemini/OpenRouter all enforce JSON. CF (tier 2) is therefore the cascade member most likely to return prose the parse rejects, adding a wasted call + latency on the common Groq-429 path. Fix: pass a JSON/grammar format if supported, or move CF to the last tier.

**Proxy cache key ignores anthropic-beta header and is not user-namespaced**
Location: workers/ai-proxy/src/index.ts:438-448,457-458
Dimension: correctness / perf
The /brain-dump + /v1/messages cache key is sha256(bodyText) only; the forwarded anthropic-beta header isn't keyed (a beta-only response shape could be served to a non-beta caller) and the key is global, not per x-user-id. The hardcoded `prompt-caching-2024-07-31` beta is also legacy/stale. Fix: include cache-affecting headers in the key, drop/update the legacy beta reference.

**detectHabitRebirthLegacy counts cadence-driven gaps as "restarts" with no per-habit baseline**
Location: packages/logic/src/habits/detectors-tier0.ts:624-633
Dimension: correctness
A "restart" is any gap >= minGapDays (7). A weekly/fortnightly habit trips the threshold on every normal interval, so a perfectly-adhered weekly habit reports one "restart" per week and the "you're cyclical" copy fires on ordinary low-frequency habits. Raw-ms gap also makes day0 09:00 vs day7 08:00 (6.96d) just-under. Fix: define restart relative to each habit's expected cadence.

**Fixed 24h day-stepping with local dayKey skips/double-counts a calendar day across DST**
Location: packages/logic/src/habits/detectors-tier0.ts:113,195,263,517,582,683 (and tier1.ts, phase2.ts, cross-module.ts, body/patterns.ts, sleep/patterns.ts)
Dimension: correctness
~16 detector loops do `t += DAY_MS` and bucket by local dayKey(t) without re-snapping to noon, so across DST a local date is double-counted (spring) or skipped (fall), dropping/doubling a day's data in 60-90d windows and shifting the rate ratios that gate pattern emission. The noon-snapped correlators are safe; tier0 habits loops are not. Fix: iterate by calendar-day key or snap each step to local noon.

**friction-signature min/max over inconsistent index sets can mislabel the "valley" day**
Location: packages/logic/src/habits/detectors-tier0.ts:528-536
Dimension: correctness
max is taken over all 7 days (uncovered forced to 0) while min filters to covered days; indexOf(min) returns the first match, so a genuinely-observed 0-rate day ties with uncovered days and valleyDow can point at the wrong weekday. Fix: restrict both max and min (and lookups) to covered weekdays.

**computePhaseForDate has no upper day bound — stale last-cycle returns "luteal" indefinitely**
Location: packages/logic/src/cycle/phase.ts:36-56
Dimension: resilience
day is measured purely from the most recent logged start with no cap; if the user stops logging, day grows unbounded and falls through to `return 'luteal'` (e.g. day=120). correlateLutealAndSpending masks it but other consumers get a wrong overconfident phase. Fix: return 'unknown' when day exceeds avgCycle + margin.

**bootstrapCI default RNG seed is derived from iters, not the data**
Location: packages/logic/src/stats/index.ts:172,188-189
Dimension: correctness
The default rng is `mulberry32(iters)` (constant 1000 for all inputs), so callers relying on the default get a CI built from the same fixed resample pattern regardless of data — deterministic but not data-independent as intended. Percentile indexing is also a no-interpolation approximation. Fix: default to a fixed documented constant or require a passed seed.

**cadence-scanner sessionFired Set grows unbounded over a long-lived session**
Location: packages/orchestrator/src/cadence-scanner.ts:343,379,386,399
Dimension: perf
sessionFired gains one (module,key,day) entry per overdue item seen and is only cleared on teardown, while persisted lastFired is pruned to 30 days. A days/weeks-open desktop shell accretes a new key per item per day with no upper bound. Fix: prune sessionFired by stripping entries older than today.

**body hourly tick is offset from clock hours, so a fixed-time reminder window can be skipped**
Location: packages/orchestrator/src/body.ts:341-345,162-163
Dimension: correctness
The setInterval(HOUR_MS) is armed at boot time, not aligned to wall-clock hours, while emitSupplementDue only emits within a 60-min window probed at 60-min spacing. If a tick lands just after a window closes the reminder is silently dropped for the day. Fix: align the first tick to the top of the hour, or scan every 5-10 min.

**work scanCues four_blocks_today can fire on a single re-logged session**
Location: packages/orchestrator/src/work.ts:318-368
Dimension: correctness
todayCount increments per focus_log entry with no dedupe on entry identity, so if the bridge ever mirrors the same work_event twice the count inflates and the "4 blocks today, rest" nudge fires on a false count. Fix: count distinct entries by ts (Set), mirroring the hyperfocus loop.

**KV token-bucket rate limit is non-atomic (read-modify-write race) — apns-push**
Location: workers/apns-push/src/index.ts:135-149
Dimension: resilience
checkRate does get then put(count+1) with no CAS; concurrent same-second requests all read the same count, pass the check, and write count+1, so the effective per-user ceiling exceeds the documented 5/sec under burst. Caller is the trusted cron binding so bounded, but the comment overstates the guarantee. Fix: document as best-effort, or move to a Durable Object / native Rate Limiting binding.

**Sentry tunnel is an unauthenticated public relay with no request body size limit**
Location: workers/sentry-tunnel/src/index.ts:26-88
Dimension: resilience
The endpoint accepts POST from any origin with no auth (intentional) and buffers the entire body via request.text() before validating; no Content-Length cap, so an attacker who knows the URL can stream large bodies into memory and (if DSN validates) forward to paid Sentry ingest. Fix: reject above a byte cap early (413), add a lightweight per-IP limit, validate from a bounded prefix.

**Sentry tunnel upstream fetch has no error handling or timeout**
Location: workers/sentry-tunnel/src/index.ts:82-96
Dimension: error-swallowing
The fetch to Sentry ingest is not wrapped in try/catch and has no AbortController; if ingest hangs the worker throws (generic 500) or blocks until the platform timeout — the one branch that can produce an uncaught error vs every other clean-status path. Fix: try/catch returning 502 with CORS + a ~10s AbortController.

**flush no-token path double-counts stats (no_token plus retried/failed)**
Location: workers/cron/src/flush-notifications.ts:212-219
Dimension: correctness
A no-token user calls applyRetry (increments retried/failed) THEN stats.no_token++, counting the job twice, so FlushStats don't reconcile (processed != sum of buckets). The test asserts only no_token===1. Fix: increment exactly one counter; either drop the separate no_token++ or have applyRetry suppress its own.

**apns-push worker has zero test coverage despite being the cert-burning relay**
Location: workers/apns-push/ (no tests/ directory)
Dimension: standards
The most security-sensitive worker (holds the Apple p8, signs ES256 JWTs, enforces bearer auth, validates device-token shape, runs the rate limiter) has no tests; cron and sentry-tunnel do. A regression in auth/token-validation ships undetected. Fix: add a vitest suite (missing secret → 401, wrong bearer → 401, non-hex token → 400, valid → APNs fetch, rate-limit 429).

**@ollie/apns-jwt de-duplication incomplete — apns-push still hand-rolls its own copy**
Location: workers/apns-push/src/index.ts:153-198; packages/apns-jwt/src/index.ts:1-17
Dimension: reinvented-wheel
The package exists solely to dedupe the ES256/p8 signing routine; apps/api adopted createApnsJwtSigner but apns-push still has its own getApnsJwt/pemToBinary/b64url/__jwtCache, so the duplication persists in one of the two original copies (e.g. the 45-min refresh margin is hardcoded in both). Fix: replace the local helpers with createApnsJwtSigner.

**Multi-word brand allowlist entries never match — pii-scrub silently scrubs known brands**
Location: packages/pii-scrub/src/brand-allowlist.ts:31-67; index.ts:310-318
Dimension: correctness
isBrand() does an exact whole-string Set lookup but ~15 entries are multi-word ("royal canin", "burger king", "coca-cola", "l'oreal"); the NAME pass tokenizes single words only, so "Royal Canin" can be NAME-redacted and the multi-word brand can never be preserved. The maintainers added coca+cola individually as a workaround, proving the gap. Fix: decompose multi-word brands into tokens (and document), or test adjacent-token bigrams + normalized forms.

**PII numeric scrub preserves any 4-digit number in 1900-2099 — leaks PINs / codes**
Location: packages/pii-scrub/src/index.ts:299-306
Dimension: pii-scrub
The NUMERIC pass exempts any 4-digit number in [1900,2099] as "a year", so a PIN/gate code/locker combo/last-4/apartment code in that range (a large fraction of real 4-digit numbers) is preserved verbatim in corpus text. Fix: only treat as a year with year context, or drop the exemption.

**Dead code: ADDRESS_NAME_STOPWORDS can never match an ADDRESS_REGEX result**
Location: packages/pii-scrub/src/index.ts:222-225,286
Dimension: clean-code
ADDRESS_REGEX requires a leading house number + street suffix, so a bare city/country ("New York") can't be a match; the stopword guard comparing the full match against those names is unreachable dead code implying a protection that isn't there. Fix: remove it, or rewrite to inspect the captured city/state portion.

**consent async getConsent() can serve a stale cached sentinel after a non-setter store write**
Location: packages/consent/src/index.ts:278-321,225-267
Dimension: correctness
getConsent memoizes per-userId and caches a sentinel when nothing is persisted; invalidation relies on every writer calling cache.clear(). Any new writer that forgets to clear silently serves stale consent — and consent staleness gates whether user data leaves the device. Fix: re-read the store on every getConsent and reconcile (or drop the cache; store reads are synchronous); add a non-setter-write invariant test.

**research-stream structured telemetry is gated on `necessary`, not research_optin — broad capture by app-boot**
Location: packages/research-stream/src/index.ts:157-166,179-223
Dimension: consent
hasConsent() returns hasNecessaryConsent(), and necessary is structurally true for any user who can boot the app, so structured session/module/retention rows POST for every user by default; research_optin only gates the free-text corpus path. Documented as intentional, but `necessary` is sold to the user as crash-analytics + replay, so the device-keyed structured-telemetry coupling needs a deliberate sign-off + aligned consent copy. Fix: confirm the legal posture and disclose it in the `necessary` copy, or gate behavioral rows behind research_optin.

**useStoreSlice shows stale value when mod/key prop changes**
Location: packages/store/src/react.ts:22-27
Dimension: correctness
useState's initializer runs only on mount, so when mod/key change between renders the component renders the previous slice's value until the next write (potentially indefinitely if the new key never changes). The re-subscribe effect doesn't re-seed state. Fix: add an effect that re-reads store.get on [store,mod,key] before subscribing.

**cross-tab sync ignores module names starting with '_'**
Location: packages/store/src/cross-tab.ts:24
Dimension: correctness
installCrossTabSync skips any module whose name startsWith('_'); current internal state rides inside 'shared' so it's fine today, but any genuine module ever named with a leading underscore would silently never cross-tab-invalidate. Fix: replace the broad filter with an explicit deny-list, or document + assert the no-leading-underscore invariant.

**Dead authenticated RLS policy on grocery_purchase_history (Clerk text id vs auth.uid uuid)**
Location: supabase/migrations/20260615000001...sql:27-30
Dimension: correctness
After the uuid→text retype, the self-select policy is `USING (auth.uid()::text = user_id)`, but user_id holds Clerk ids and the table is only reached via service_role; auth.uid()::text (a uuid) can never equal a Clerk id, so the policy always evaluates false and the matching authenticated SELECT grant returns zero rows — misleading dead code (the sibling cook_history correctly dropped its vestigial policies). Fix: drop the policy + revoke the grant, or document service_role-only.
