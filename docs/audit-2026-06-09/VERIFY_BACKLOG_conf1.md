# Verify Backlog — single/low-confidence findings (205)

_Sampled per Phase 4 rule, not all verified. Ordered severity then confidence._

- [ ] **#43** 🟠 _(conf 1/3)_ STAGING_TEST_BEARER backdoor can bypass Clerk JWT verification with no production guard  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:123`  · _Security & Authorization_
- [ ] **#44** 🟠 _(conf 1/3)_ Raw unscrubbed user input logged in worker dump telemetry  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:387`  · _Secrets & Token Exposure_
- [ ] **#45** 🟠 _(conf 1/3)_ Unsafe parseFloat on budget env/KV values without bounds validation  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:137-140`  · _Input Validation_
- [ ] **#46** 🟠 _(conf 1/3)_ No request body size limit on /brain-dump and /v1/messages endpoints  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:389`  · _Input Validation_
- [ ] **#47** 🟠 _(conf 1/3)_ Missing maximum text length validation in /route/dump  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:148-157`  · _Input Validation_
- [ ] **#48** 🟠 _(conf 1/3)_ UUID generation logic duplicated across 16+ module repositories  
      `apps/native/src/modules/goals/repo.ts:81-85`  · _Reinvented Wheels & Duplication_
- [ ] **#49** 🟠 _(conf 1/3)_ Duplicate mean() implementations across 4 locations  
      `packages/logic/src/stats/index.ts:29-30`  · _Reinvented Wheels & Duplication_
- [ ] **#50** 🟠 _(conf 1/3)_ No module boundary enforcement in ESLint or TypeScript  
      `/Users/serrayildirim/ollie/eslint.config.mjs:1-79`  · _File & Module Structure_
- [ ] **#51** 🟠 _(conf 1/3)_ Unvalidated store cast `as unknown as SnapshotStoreLike` in body-correlations orchestrator  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:108`  · _TypeScript Type Safety_
- [ ] **#52** 🟠 _(conf 1/3)_ Unsafe JSON.parse without schema validation across dump/repo files  
      `/Users/serrayildirim/ollie/apps/native/src/dump/archive.ts:134`  · _TypeScript Type Safety_
- [ ] **#53** 🟠 _(conf 1/3)_ Promise.all without per-element error handler in native post-dispatch path  
      `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-101`  · _Error Handling & Resilience_
- [ ] **#54** 🟠 _(conf 1/3)_ Unhandled promise rejection in braindump-dispatch grocery routing IIFE  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:847`  · _Error Handling & Resilience_
- [ ] **#55** 🟠 _(conf 1/3)_ Missing timeout on APNs JWT fetch in send path  
      `/Users/serrayildirim/ollie/apps/api/src/worker.ts:406-413`  · _Error Handling & Resilience_
- [ ] **#56** 🟠 _(conf 1/3)_ Silent data loss when sync queue persistence fails after successful upsert  
      `/Users/serrayildirim/ollie/packages/sync/src/index.ts:199-212`  · _Error Handling & Resilience_
- [ ] **#57** 🟠 _(conf 1/3)_ Empty catch blocks in auth vault crypto operations hide key-derivation and cleanup failures  
      `/Users/serrayildirim/ollie/packages/auth/src/index.ts:167-171`  · _Error Handling & Resilience_
- [ ] **#58** 🟠 _(conf 1/3)_ Grocery pattern detectors swallow detector failures with empty catch blocks  
      `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:293-297`  · _Error Handling & Resilience_
- [ ] **#59** 🟠 _(conf 1/3)_ Finance pattern detectors swallow detector failures with empty catch blocks  
      `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:118`  · _Error Handling & Resilience_
- [ ] **#60** 🟠 _(conf 1/3)_ enqueueUpsert encryption failure is unhandled and can drop or corrupt queued rows  
      `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:255-271`  · _Async & Concurrency_
- [ ] **#61** 🟠 _(conf 1/3)_ Non-atomic token-bucket rate limiter in APNs worker allows burst overage  
      `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:135-142`  · _Async & Concurrency_
- [ ] **#62** 🟠 _(conf 1/3)_ dispatchAction is 467 lines with 10+ inline module-specific branches  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157`  · _Clean Code & Complexity_
- [ ] **#63** 🟠 _(conf 1/3)_ shelf-life.ts: empty interface with stale eslint-disable referencing a removed rule  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/shelf-life.ts:34-35`  · _Linting & Config Hygiene_
- [ ] **#64** 🟠 _(conf 1/3)_ Cache TTL broken on every hit: cacheHitBump drops createdAt  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:171-186`  · _Dump Routing Flow Correctness_
- [ ] **#65** 🟠 _(conf 1/3)_ Incorrect summary truncation logic in rule-based journal extraction  
      `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:140-145`  · _Algorithms Correctness & Efficiency_
- [ ] **#66** 🟠 _(conf 1/3)_ phaseForDay produces incorrect phase boundaries for short cycles (<23 days)  
      `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:48-52`  · _Algorithms Correctness & Efficiency_
- [ ] **#67** 🟠 _(conf 1/3)_ matchItem substring matching too permissive — allows false-positive mutation targets  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:111-122`  · _Algorithms Correctness & Efficiency_
- [ ] **#68** 🟠 _(conf 1/3)_ Orphaned admin:* cue events emitted with zero consumers  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:196-250`  · _State & Store Consistency_
- [ ] **#69** 🟠 _(conf 1/3)_ 42+ additional orphaned cue events across finance/grocery/goals/habits/work/sleep/body/pets/burhan/cycle  
      `/Users/serrayildirim/ollie/packages/orchestrator/src`  · _State & Store Consistency_
- [ ] **#70** 🟠 _(conf 1/3)_ Sleep orchestrator reads sleep.debt with wrong field name (debt_hours vs totalDeficitHours), silently disabli…  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/sleep.ts:379-382`  · _State & Store Consistency_
- [ ] **#71** 🟠 _(conf 1/3)_ finance.settings is a one-way mirror that drops UI-modified settings on the next bridge sync  
      `/Users/serrayildirim/ollie/apps/native/src/modules/finance/bridge.ts:164-169`  · _State & Store Consistency_
- [ ] **#72** 🟠 _(conf 1/3)_ finance.taxProfile read by orchestrator but never written by any bridge or onboarding path  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:921-952`  · _State & Store Consistency_
- [ ] **#73** 🟠 _(conf 1/3)_ Module 'mood' in routing enum but not registered in worker MODULE_CONFIGS  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:19`  · _API Contract Consistency_
- [ ] **#74** 🟠 _(conf 1/3)_ Idempotency-key infrastructure missing across dump/event ingestion (client + telemetry endpoints)  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159`  · _Idempotency & Retry Harness_
- [ ] **#75** 🟠 _(conf 1/3)_ partner sync tables missing GRANT statements (service_role cannot access)  
      `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-55`  · _DB, Migrations & Schema_
- [ ] **#76** 🟠 _(conf 1/3)_ grocery_purchase_history missing GRANT statements for authenticated role  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31-43`  · _DB, Migrations & Schema_
- [ ] **#77** 🟠 _(conf 1/3)_ cook_history missing GRANT statements for authenticated and service_role  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:25-38`  · _DB, Migrations & Schema_
- [ ] **#78** 🟠 _(conf 1/3)_ routing_cache missing GRANT statements (service_role worker cannot access)  
      `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70-78`  · _DB, Migrations & Schema_
- [ ] **#79** 🟠 _(conf 1/3)_ Missing FORCE ROW LEVEL SECURITY on partner sync tables  
      `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-49`  · _DB, Migrations & Schema_
- [ ] **#80** 🟠 _(conf 1/3)_ Missing FORCE ROW LEVEL SECURITY on grocery_purchase_history  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31`  · _DB, Migrations & Schema_
- [ ] **#81** 🟠 _(conf 1/3)_ Missing FORCE ROW LEVEL SECURITY on cook_history  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:26`  · _DB, Migrations & Schema_
- [ ] **#82** 🟠 _(conf 1/3)_ Missing FORCE ROW LEVEL SECURITY on routing_cache  
      `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70`  · _DB, Migrations & Schema_
- [ ] **#83** 🟠 _(conf 1/3)_ N+1 store.update() calls in applyGroceryMutations loop  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-812`  · _Performance & Cost_
- [ ] **#84** 🟠 _(conf 1/3)_ N+1 query pattern in goals.listWithLatest()  
      `/Users/serrayildirim/ollie/apps/native/src/modules/goals/repo.ts:105-122`  · _Performance & Cost_
- [ ] **#85** 🟠 _(conf 1/3)_ Serial per-row /label calls in research orchestrator flush  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:158-187`  · _Performance & Cost_
- [ ] **#86** 🟠 _(conf 1/3)_ ACTION_DESCRIPTION in brain copy prompt hardcoded English  
      `/Users/serrayildirim/ollie/packages/logic/src/brain/copy.ts:102-104`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#87** 🟠 _(conf 1/3)_ /route/dump request omits app language (locale field never populated)  
      `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:187-194`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#88** 🟠 _(conf 1/3)_ groq/gemini/cloudflare-ai provider client modules have no tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/groq.ts`  · _Test Quality & Coverage_
- [ ] **#89** 🟠 _(conf 1/3)_ dump.test.ts is a smoke test only — no error-path coverage for Voyage/Groq/rate-limiting  
      `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts (lines 136-232)`  · _Test Quality & Coverage_
- [ ] **#90** 🟠 _(conf 1/3)_ Deprecated Clerk package - migrate to @clerk/react  
      `/Users/serrayildirim/ollie/apps/native/package.json:15`  · _Dependency Health_
- [ ] **#114** 🟡 _(conf 1/3)_ Missing rate-limit enforcement on public shelf-life endpoints when caller id is null  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:258-303`  · _Security & Authorization_
- [ ] **#115** 🟡 _(conf 1/3)_ Service-role Supabase REST calls in invites lack HTTPS/protocol-downgrade validation  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:107-108`  · _Security & Authorization_
- [ ] **#116** 🟡 _(conf 1/3)_ Invite endpoints accept inviter_user_hash / invitee_user_hash without format validation  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:75-76`  · _Security & Authorization_
- [ ] **#117** 🟡 _(conf 1/3)_ Account deletion endpoint has no rate limiting on retries  
      `/Users/serrayildirim/ollie/apps/api/src/account-delete.ts:134-256`  · _Security & Authorization_
- [ ] **#118** 🟡 _(conf 1/3)_ Telemetry tables lack explicit service_role grants in migrations  
      `/Users/serrayildirim/ollie/supabase/migrations/20260514000001_raw_dumps.sql:45-49`  · _Security & Authorization_
- [ ] **#119** 🟡 _(conf 1/3)_ Partial device push token logged to console in capacitor backend  
      `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:277`  · _Secrets & Token Exposure_
- [ ] **#120** 🟡 _(conf 1/3)_ Non-atomic daily-budget cost tracking race condition in /label  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:135-144`  · _Input Validation_
- [ ] **#121** 🟡 _(conf 1/3)_ Unsafe parseInt on legacy KV rate-limit counter  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:467`  · _Input Validation_
- [ ] **#122** 🟡 _(conf 1/3)_ Unvalidated body.text length in /route/:module handler  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-249`  · _Input Validation_
- [ ] **#123** 🟡 _(conf 1/3)_ Path parameter module name not length-validated in /route/:module  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:366-370`  · _Input Validation_
- [ ] **#124** 🟡 _(conf 1/3)_ startOfDay() reimplemented in 3 separate locations  
      `packages/logic/src/medication/index.ts:115-119`  · _Reinvented Wheels & Duplication_
- [ ] **#125** 🟡 _(conf 1/3)_ newRequestId() in @ollie/worker-http duplicates UUID fallback pattern  
      `packages/worker-http/src/index.ts:65-73`  · _Reinvented Wheels & Duplication_
- [ ] **#126** 🟡 _(conf 1/3)_ Median function reimplemented in cadence module  
      `packages/cadence/src/index.ts:206-214`  · _Reinvented Wheels & Duplication_
- [ ] **#127** 🟡 _(conf 1/3)_ Duplicated word-boundary regex helpers in admin and work constants  
      `packages/logic/src/admin/constants.ts:5-18`  · _Reinvented Wheels & Duplication_
- [ ] **#128** 🟡 _(conf 1/3)_ createDebouncer() not broadly exported; per-key debounce likely to be reinvented  
      `packages/sync/src/retry.ts:31-49`  · _Reinvented Wheels & Duplication_
- [ ] **#129** 🟡 _(conf 1/3)_ @ollie/logic exposes 17 internal submodule exports that allow bypassing the orchestrator facade  
      `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`  · _File & Module Structure_
- [ ] **#130** 🟡 _(conf 1/3)_ @ollie/logic exports field is incomplete — 7 implemented submodules are not exported  
      `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`  · _File & Module Structure_
- [ ] **#131** 🟡 _(conf 1/3)_ @ollie/orchestrator exports internal dedup utility used only by tests  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:40`  · _File & Module Structure_
- [ ] **#132** 🟡 _(conf 1/3)_ @ollie/orchestrator has no package.json exports field — entire src/ is implicitly importable  
      `/Users/serrayildirim/ollie/packages/orchestrator/package.json:1-10`  · _File & Module Structure_
- [ ] **#133** 🟡 _(conf 1/3)_ globalThis typed as `any` for navigator/crypto in research-stream  
      `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:145`  · _TypeScript Type Safety_
- [ ] **#134** 🟡 _(conf 1/3)_ Redundant non-null assertions after Array.isArray guard in goals detectors  
      `/Users/serrayildirim/ollie/packages/logic/src/goals/velocity.ts:98`  · _TypeScript Type Safety_
- [ ] **#135** 🟡 _(conf 1/3)_ Journal extraction casts emotions array through `unknown[]` during validation  
      `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:281`  · _TypeScript Type Safety_
- [ ] **#136** 🟡 _(conf 1/3)_ Finance orchestrator unnecessary double-cast after in-operator narrowing  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:953`  · _TypeScript Type Safety_
- [ ] **#137** 🟡 _(conf 1/3)_ Layout components double-cast space key lookups through unknown  
      `/Users/serrayildirim/ollie/apps/native/src/layout/Box.tsx:78`  · _TypeScript Type Safety_
- [ ] **#138** 🟡 _(conf 1/3)_ Mood handler casts fragment.payload to MoodAction without validation  
      `/Users/serrayildirim/ollie/apps/native/src/modules/mood/handler.ts:32`  · _TypeScript Type Safety_
- [ ] **#139** 🟡 _(conf 1/3)_ Object.keys() loses type information in journal extraction loop  
      `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:262`  · _TypeScript Type Safety_
- [ ] **#140** 🟡 _(conf 1/3)_ Research orchestrator flush timer can produce unhandled rejection if onError throws  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:193`  · _Error Handling & Resilience_
- [ ] **#141** 🟡 _(conf 1/3)_ Sync scheduler does not signal operator on retry exhaustion  
      `/Users/serrayildirim/ollie/packages/sync/src/retry.ts:121-127`  · _Error Handling & Resilience_
- [ ] **#142** 🟡 _(conf 1/3)_ Partner bilateral snapshot writes suppress errors causing silent state divergence  
      `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:112`  · _Error Handling & Resilience_
- [ ] **#143** 🟡 _(conf 1/3)_ updateJob failures in flush-notifications are swallowed, risking duplicate delivery  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:471-476`  · _Error Handling & Resilience_
- [ ] **#144** 🟡 _(conf 1/3)_ No timeout on Supabase queries in flush-notifications can hang the cron worker  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:365`  · _Error Handling & Resilience_
- [ ] **#145** 🟡 _(conf 1/3)_ Supabase REST error body parse failure masks original error code  
      `/Users/serrayildirim/ollie/apps/api/src/worker.ts:234-241`  · _Error Handling & Resilience_
- [ ] **#146** 🟡 _(conf 1/3)_ Cron drain treats 200 OK as success without verifying written rows  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:318-322`  · _Error Handling & Resilience_
- [ ] **#147** 🟡 _(conf 1/3)_ Empty catch hides inbound decryption failures in sync syncIn  
      `/Users/serrayildirim/ollie/packages/sync/src/index.ts:238-252`  · _Error Handling & Resilience_
- [ ] **#148** 🟡 _(conf 1/3)_ sync/finance syncIn unbounded recursion can overflow the stack  
      `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:544-546`  · _Error Handling & Resilience_
- [ ] **#149** 🟡 _(conf 1/3)_ sync/finance drainOnce loses upserts when a delete fails mid-drain  
      `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:340-395`  · _Error Handling & Resilience_
- [ ] **#150** 🟡 _(conf 1/3)_ worker-http newRequestId silently falls back to weak random IDs on crypto failure  
      `/Users/serrayildirim/ollie/packages/worker-http/src/index.ts:66-72`  · _Error Handling & Resilience_
- [ ] **#151** 🟡 _(conf 1/3)_ Unchecked dual KV deletes after processing in cron drain risk duplicate enrichment  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:144-147`  · _Async & Concurrency_
- [ ] **#152** 🟡 _(conf 1/3)_ No circuit breaker / coalescing on Vectorize cache lookup in dump route causes AI stampede on outage  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:264-271`  · _Async & Concurrency_
- [ ] **#153** 🟡 _(conf 1/3)_ Fragile fire-and-forget boot scan in cadence-scanner  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:445-450`  · _Async & Concurrency_
- [ ] **#154** 🟡 _(conf 1/3)_ Dead placeholder promise in research orchestrator init  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:218-223`  · _Async & Concurrency_
- [ ] **#155** 🟡 _(conf 1/3)_ recomputeDerived is a 1000+ line god function with repeated emit/dedup try-catch boilerplate  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:274-1100`  · _Clean Code & Complexity_
- [ ] **#156** 🟡 _(conf 1/3)_ Inline store.update type declarations repeated 30+ times instead of module-scope aliases  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:413-423`  · _Clean Code & Complexity_
- [ ] **#157** 🟡 _(conf 1/3)_ emitResearchRow called inline 11+ times with near-identical arguments  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:366-383`  · _Clean Code & Complexity_
- [ ] **#158** 🟡 _(conf 1/3)_ applyCapitalizedNameHeuristic has three nested loops with hard-to-follow flag logic  
      `/Users/serrayildirim/ollie/packages/pii-scrub/src/index.ts:388-440`  · _Clean Code & Complexity_
- [ ] **#159** 🟡 _(conf 1/3)_ Unused eslint-disable no-console directives (rule not configured)  
      `/Users/serrayildirim/ollie/apps/native/src/lib/formatRelativeTime.ts:135`  · _Linting & Config Hygiene_
- [ ] **#160** 🟡 _(conf 1/3)_ Unused destructured variable 'calls' in cadence-scanner test  
      `/Users/serrayildirim/ollie/packages/orchestrator/tests/cadence-scanner.test.ts:235`  · _Linting & Config Hygiene_
- [ ] **#161** 🟡 _(conf 1/3)_ Unused test helper function 'makeVoyageOk'  
      `/Users/serrayildirim/ollie/workers/ai-proxy/tests/route.test.ts:45`  · _Linting & Config Hygiene_
- [ ] **#162** 🟡 _(conf 1/3)_ ESLint flat config ignores all *.config files and tools/, leaving plugin/config code unlinted  
      `/Users/serrayildirim/ollie/eslint.config.mjs:32`  · _Linting & Config Hygiene_
- [ ] **#163** 🟡 _(conf 1/3)_ No log emitted when remindIn is structurally lost via demotion  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285-291`  · _Dump Routing Flow Correctness_
- [ ] **#164** 🟡 _(conf 1/3)_ Missing integration test for remindIn under the low-confidence demotion path  
      `/Users/serrayildirim/ollie/workers/ai-proxy/tests`  · _Dump Routing Flow Correctness_
- [ ] **#165** 🟡 _(conf 1/3)_ Timezone-dependent cadence dedupe key can fire duplicate notifications across timezone changes  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:232-239`  · _Algorithms Correctness & Efficiency_
- [ ] **#166** 🟡 _(conf 1/3)_ Grocery mutation regex fails to match common natural phrasings like 'threw it out'  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`  · _Algorithms Correctness & Efficiency_
- [ ] **#167** 🟡 _(conf 1/3)_ Sub-orchestrator init() registers event listeners with no idempotency guard (double-subscribe on re-init)  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:273-312`  · _State & Store Consistency_
- [ ] **#168** 🟡 _(conf 1/3)_ Watcher tick may observe stale store data between SQLite write and bridge sync (fire-and-forget dispatch)  
      `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:89-109`  · _State & Store Consistency_
- [ ] **#169** 🟡 _(conf 1/3)_ cycle.lastEditedByCycle always written empty; 72h recent-edit suppression never fires  
      `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:150`  · _State & Store Consistency_
- [ ] **#170** 🟡 _(conf 1/3)_ sleep.windDownLog read-merged with no SQLite owner; stale entries can never be pruned  
      `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:179-180`  · _State & Store Consistency_
- [ ] **#171** 🟡 _(conf 1/3)_ sleep.medsLog read-merged but written by no bridge; cross-feed broken, entries never cleared  
      `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:187-189`  · _State & Store Consistency_
- [ ] **#172** 🟡 _(conf 1/3)_ pets.coregulation_log read-merged but only appended by dump mood flow, never pruned on dump deletion  
      `/Users/serrayildirim/ollie/apps/native/src/modules/pets/bridge.ts:160-165`  · _State & Store Consistency_
- [ ] **#173** 🟡 _(conf 1/3)_ admin.phoneTasks store-consistency gap (reported as never-written; actually written but with no UI capture so…  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:530-544`  · _State & Store Consistency_
- [ ] **#174** 🟡 _(conf 1/3)_ dump-schema.ts hand-mirrored from native schema with no automated sync/drift check  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:1-6`  · _API Contract Consistency_
- [ ] **#175** 🟡 _(conf 1/3)_ KV retry path has no jitter or backoff — lock-step 5-min retries cause a thundering herd  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:160-162`  · _Idempotency & Retry Harness_
- [ ] **#176** 🟡 _(conf 1/3)_ MAX_RETRIES=12 (~1h at fixed 5-min intervals) risks DLQ-ing valid entries during a transient outage  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:78`  · _Idempotency & Retry Harness_
- [ ] **#177** 🟡 _(conf 1/3)_ updateJob PATCH does not verify a row was actually updated (no row-count check)  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:455-477`  · _Idempotency & Retry Harness_
- [ ] **#178** 🟡 _(conf 1/3)_ Partner snapshot upsert has no idempotency key for concurrent in-flight retries  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:173-179`  · _Idempotency & Retry Harness_
- [ ] **#179** 🟡 _(conf 1/3)_ APNs push worker rate-limit counter is not atomic across instances  
      `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:129-143`  · _Idempotency & Retry Harness_
- [ ] **#180** 🟡 _(conf 1/3)_ APNs push worker does not deduplicate identical in-flight requests  
      `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:55-125`  · _Idempotency & Retry Harness_
- [ ] **#181** 🟡 _(conf 1/3)_ Drain treats enriched_signals constraint/FK errors as transient, retrying a permanently-failing write into th…  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:143-163`  · _Idempotency & Retry Harness_
- [ ] **#182** 🟡 _(conf 1/3)_ Missing rollback (.down.sql) migrations for 10 recent schema changes  
      `/Users/serrayildirim/ollie/supabase/rollbacks/`  · _DB, Migrations & Schema_
- [ ] **#183** 🟡 _(conf 1/3)_ partner_snapshots missing updated_at trigger  
      `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-55`  · _DB, Migrations & Schema_
- [ ] **#184** 🟡 _(conf 1/3)_ partner_snapshots missing index on updated_at column  
      `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-45`  · _DB, Migrations & Schema_
- [ ] **#185** 🟡 _(conf 1/3)_ Tables created without explicit public schema prefix  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:11`  · _DB, Migrations & Schema_
- [ ] **#186** 🟡 _(conf 1/3)_ cook_history authenticated RLS policies dropped during type migration but not recreated  
      `/Users/serrayildirim/ollie/supabase/migrations/20260530144446_fix_cook_history_clerk_id_text.sql:15-17`  · _DB, Migrations & Schema_
- [ ] **#187** 🟡 _(conf 1/3)_ Drain queue processes dumps serially, blocking on Anthropic + Supabase  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:122-164`  · _Performance & Cost_
- [ ] **#188** 🟡 _(conf 1/3)_ Serial per-fragment pass-2 segmentation on cache misses in dump route  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:198-218`  · _Performance & Cost_
- [ ] **#189** 🟡 _(conf 1/3)_ Duplicate buildBasePrompt() calls in feed-me router  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:269,908,981`  · _Performance & Cost_
- [ ] **#190** 🟡 _(conf 1/3)_ GoalsBox polls all goals + cadence every 6s with no debounce/dedup  
      `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:75-95,111-123`  · _Performance & Cost_
- [ ] **#191** 🟡 _(conf 1/3)_ Repeated multi-pass filter+map chains in finance cycle correlation  
      `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:84-94`  · _Performance & Cost_
- [ ] **#192** 🟡 _(conf 1/3)_ Duplicated complementary filter+map over overlap array in sleep correlation  
      `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:162-163`  · _Performance & Cost_
- [ ] **#193** 🟡 _(conf 1/3)_ DumpScreen heading 'What's in your head?' hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:215`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#194** 🟡 _(conf 1/3)_ Navigation module labels/hints (Router) hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/navigation/Router.tsx:88-120`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#195** 🟡 _(conf 1/3)_ Primary route tab labels hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/navigation/routes.ts:37-40`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#196** 🟡 _(conf 1/3)_ TodoScreen decision-variant buttons hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:505`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#197** 🟡 _(conf 1/3)_ GroceryNow status strings hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryNow.tsx:112-115`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#198** 🟡 _(conf 1/3)_ Module checkbox/confirm aria-labels hardcoded English (GoalsBox + work/admin)  
      `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:372`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#199** 🟡 _(conf 1/3)_ dump-schema applyConfidencePolicy boundaries untested  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts (lines 67-89)`  · _Test Quality & Coverage_
- [ ] **#200** 🟡 _(conf 1/3)_ Worker-level PII scrubber regex patterns are not unit-tested  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/pii.ts (lines 48-77+)`  · _Test Quality & Coverage_
- [ ] **#201** 🟡 _(conf 1/3)_ Handler tests assert on mock calls instead of resulting state  
      `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/handler.test.ts (lines 50-64)`  · _Test Quality & Coverage_
- [ ] **#202** 🟡 _(conf 1/3)_ Retry scheduler untested for concurrent cancellation and timer-fire races  
      `/Users/serrayildirim/ollie/packages/sync/tests/retry.test.ts (line 26)`  · _Test Quality & Coverage_
- [ ] **#203** 🟡 _(conf 1/3)_ Only the orchestrator package has coverage gates  
      `/Users/serrayildirim/ollie/packages/orchestrator/vitest.config.ts (lines 12-20)`  · _Test Quality & Coverage_
- [ ] **#204** 🟡 _(conf 1/3)_ crypto decrypt fallback for legacy payloads missing kdf_iter is untested  
      `/Users/serrayildirim/ollie/packages/crypto/tests/crypto.test.ts (lines 185-230)`  · _Test Quality & Coverage_
- [ ] **#205** 🟡 _(conf 1/3)_ Consent sync tests assert on the mock, not on local state mutation  
      `/Users/serrayildirim/ollie/packages/consent/tests/consent.test.ts (lines 152-162, 314-320)`  · _Test Quality & Coverage_
- [ ] **#206** 🟡 _(conf 1/3)_ Unused dependency: @tauri-apps/plugin-opener  
      `/Users/serrayildirim/ollie/apps/native/package.json:29`  · _Dependency Health_
- [ ] **#207** 🟡 _(conf 1/3)_ Missing peer dependency declaration consideration for @ollie/store consumers  
      `/Users/serrayildirim/ollie/packages/store/package.json:17-18`  · _Dependency Health_
- [ ] **#212** ⚪ _(conf 1/3)_ Shared telemetry rate-limit bucket lets /ingest-event spam high-cardinality tables  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343`  · _Security & Authorization_
- [ ] **#213** ⚪ _(conf 1/3)_ Real API keys in gitignored .env and worker .dev.vars  
      `/Users/serrayildirim/ollie/.env:4`  · _Secrets & Token Exposure_
- [ ] **#214** ⚪ _(conf 1/3)_ Unvalidated anthropic-beta header forwarded upstream  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:411-412`  · _Input Validation_
- [ ] **#215** ⚪ _(conf 1/3)_ isoTodayWork() reinvents dayKey() formatting  
      `apps/native/src/modules/work/repo.ts:84-90`  · _Reinvented Wheels & Duplication_
- [ ] **#216** ⚪ _(conf 1/3)_ startOfWeek()/endOfWeek() private to body-weekly; not consolidated  
      `packages/orchestrator/src/body-weekly.ts:69-78`  · _Reinvented Wheels & Duplication_
- [ ] **#217** ⚪ _(conf 1/3)_ sleep() defined privately in @ollie/api rather than as a shared utility  
      `packages/api/src/client.ts:379-381`  · _Reinvented Wheels & Duplication_
- [ ] **#218** ⚪ _(conf 1/3)_ Duplicated _consentOnGoals helper across goals phase2 and phase3  
      `packages/logic/src/goals/phase2.ts`  · _Reinvented Wheels & Duplication_
- [ ] **#219** ⚪ _(conf 1/3)_ Test files colocated with source code in apps/native (inconsistent with packages)  
      `/Users/serrayildirim/ollie/apps/native/src`  · _File & Module Structure_
- [ ] **#220** ⚪ _(conf 1/3)_ @ollie/notifications declares 7 unused subpath exports, creating false API-stability signals  
      `/Users/serrayildirim/ollie/packages/notifications/package.json:8-17`  · _File & Module Structure_
- [ ] **#221** ⚪ _(conf 1/3)_ Large monolithic barrel index files in orchestrator and notifications  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:1-341`  · _File & Module Structure_
- [ ] **#222** ⚪ _(conf 1/3)_ apps/native imports orchestrator-internal types (CadenceTrackedEntry) not in the public API  
      `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/index.ts`  · _File & Module Structure_
- [ ] **#223** ⚪ _(conf 1/3)_ Missing internal return type on supabase IIFE arrow function  
      `/Users/serrayildirim/ollie/apps/native/src/api/supabase.ts:62`  · _TypeScript Type Safety_
- [ ] **#224** ⚪ _(conf 1/3)_ Event emit throws if validatePayload throws, crashing dispatch  
      `/Users/serrayildirim/ollie/packages/events/src/index.ts:35-40`  · _Error Handling & Resilience_
- [ ] **#225** ⚪ _(conf 1/3)_ Scheduled notification delay clamped to 0 fires immediately without warning  
      `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:175-181`  · _Error Handling & Resilience_
- [ ] **#226** ⚪ _(conf 1/3)_ research-stream scheduleFlush may leak/stack timers on rapid reschedule  
      `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:253-260`  · _Error Handling & Resilience_
- [ ] **#227** ⚪ _(conf 1/3)_ Flag-based coordination between async native schedule and cancel() in systemNotify has a race  
      `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:275-314`  · _Async & Concurrency_
- [ ] **#228** ⚪ _(conf 1/3)_ Unnecessary Promise.resolve().then() wrapper around recomputeCapacity in brain recompute  
      `/Users/serrayildirim/ollie/apps/native/src/modules/brain/index.ts:54`  · _Async & Concurrency_
- [ ] **#229** ⚪ _(conf 1/3)_ Duplicated cacheWrite implementation across ai-proxy router modules  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:438`  · _Async & Concurrency_
- [ ] **#230** ⚪ _(conf 1/3)_ Stale audit-task comment in dispatchAction contradicts implemented schema  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:24-25`  · _Clean Code & Complexity_
- [ ] **#231** ⚪ _(conf 1/3)_ Stale taxProfile TODO comments in finance.ts reference an unshipped feature  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:154-159`  · _Clean Code & Complexity_
- [ ] **#232** ⚪ _(conf 1/3)_ Magic number 30 * 60_000 for default work meeting duration  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:935`  · _Clean Code & Complexity_
- [ ] **#233** ⚪ _(conf 1/3)_ Legacy work detectors still exported from legacy.ts  
      `/Users/serrayildirim/ollie/packages/logic/src/work/index.ts:14`  · _Clean Code & Complexity_
- [ ] **#234** ⚪ _(conf 1/3)_ Incomplete partner signal implementation left as a TODO stub  
      `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:1`  · _Clean Code & Complexity_
- [ ] **#235** ⚪ _(conf 1/3)_ Layer-1 router SYSTEM_PROMPT is a ~10k-char inline string literal with no bound guard  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:44-145`  · _Clean Code & Complexity_
- [ ] **#236** ⚪ _(conf 1/3)_ DEV-only test-milk button in GroceryBox has no removal criteria  
      `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:17`  · _Clean Code & Complexity_
- [ ] **#237** ⚪ _(conf 1/3)_ crisis-lexicon moduleResolution casing differs from base ('bundler' vs 'Bundler')  
      `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json:5`  · _Linting & Config Hygiene_
- [ ] **#238** ⚪ _(conf 1/3)_ Inconsistent tsconfig include patterns across packages (non-recursive vs recursive globs)  
      `/Users/serrayildirim/ollie/packages`  · _Linting & Config Hygiene_
- [ ] **#239** ⚪ _(conf 1/3)_ Inconsistent explicit rootDir declarations across packages  
      `/Users/serrayildirim/ollie/packages`  · _Linting & Config Hygiene_
- [ ] **#240** ⚪ _(conf 1/3)_ Inconsistent outDir handling in noEmit packages  
      `/Users/serrayildirim/ollie/packages`  · _Linting & Config Hygiene_
- [ ] **#241** ⚪ _(conf 1/3)_ Redundant explicit strict: true in child tsconfigs  
      `/Users/serrayildirim/ollie/packages/apns-jwt/tsconfig.json`  · _Linting & Config Hygiene_
- [ ] **#242** ⚪ _(conf 1/3)_ No dedicated lint CI gate; lint runs inside the build job without explicit visibility  
      `/Users/serrayildirim/ollie/.github/workflows/ci.yml:36`  · _Linting & Config Hygiene_
- [ ] **#243** ⚪ _(conf 1/3)_ phaseFold has O(n*m) complexity scanning all cycles per event  
      `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:62-82`  · _Algorithms Correctness & Efficiency_
- [ ] **#244** ⚪ _(conf 1/3)_ DAY_MS constant duplicated across modules instead of shared import  
      `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:154`  · _Algorithms Correctness & Efficiency_
- [ ] **#245** ⚪ _(conf 1/3)_ createdAt tiebreak in selection uses POSITIVE_INFINITY sentinel for missing values  
      `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:342-345`  · _Algorithms Correctness & Efficiency_
- [ ] **#246** ⚪ _(conf 1/3)_ medianAmountOf empty-input safety is implicit (guard present but undocumented)  
      `/Users/serrayildirim/ollie/packages/cadence/src/recurring.ts:174`  · _Algorithms Correctness & Efficiency_
- [ ] **#247** ⚪ _(conf 1/3)_ Fertile-window widen factor rounding may introduce ±0.5 day error for high SD  
      `/Users/serrayildirim/ollie/packages/logic/src/cycle/prediction.ts:103-109`  · _Algorithms Correctness & Efficiency_
- [ ] **#248** ⚪ _(conf 1/3)_ Grocery replenishment soonestOutMs tracked sequentially during pantry scan  
      `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:140-175`  · _Algorithms Correctness & Efficiency_
- [ ] **#249** ⚪ _(conf 1/3)_ Deferability resolver contract for [0,1] range not enforced at type level  
      `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:193-203`  · _Algorithms Correctness & Efficiency_
- [ ] **#250** ⚪ _(conf 1/3)_ Cadence nextExpectedTs computed for low-data confidence can show spurious overdue dates  
      `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:147`  · _Algorithms Correctness & Efficiency_
- [ ] **#251** ⚪ _(conf 1/3)_ finance.goals written by orchestrator but not mirrored by native bridge (savings-goal feature dark on native)  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:664,1081`  · _State & Store Consistency_
- [ ] **#252** ⚪ _(conf 1/3)_ burhan store keys empty-on-boot: event-driven module with no bridge pre-population  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/burhan.ts:68-69,79`  · _State & Store Consistency_
- [ ] **#253** ⚪ _(conf 1/3)_ body.correlations written by orchestrator but not seeded by native bridge (undefined on cold start)  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:117-118`  · _State & Store Consistency_
- [ ] **#254** ⚪ _(conf 1/3)_ shared.signals has no bridge initialization; empty until body watcher first fires  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/body-signals.ts:138-146`  · _State & Store Consistency_
- [ ] **#255** ⚪ _(conf 1/3)_ Cycle pregnancy flags written before items (ORDER MATTERS) — documented and safe under synchronous store.set  
      `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:129-153`  · _State & Store Consistency_
- [ ] **#256** ⚪ _(conf 1/3)_ bumpRetry counter is racy (TOCTOU); concurrent drains can under-count retries and block DLQ promotion  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:368-374`  · _Idempotency & Retry Harness_
- [ ] **#257** ⚪ _(conf 1/3)_ Daily notification budget retry-loop compounds enriched_signals duplication for analytics  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:189-196`  · _Idempotency & Retry Harness_
- [ ] **#258** ⚪ _(conf 1/3)_ finance_records.deleted_at lacks tombstone immutability constraint  
      `/Users/serrayildirim/ollie/supabase/migrations/20260514000008_finance_records.sql:65`  · _DB, Migrations & Schema_
- [ ] **#259** ⚪ _(conf 1/3)_ Research intake buffers data for up to 60s before consent re-check  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:126-150`  · _Performance & Cost_
- [ ] **#260** ⚪ _(conf 1/3)_ Per-write Vectorize metadata JSON.stringify on every cache upsert/bump  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:151`  · _Performance & Cost_
- [ ] **#261** ⚪ _(conf 1/3)_ Cache-hit bump runs after response and silently drops on failure  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:302-306`  · _Performance & Cost_
- [ ] **#262** ⚪ _(conf 1/3)_ Likely dead groqChat import in feed-me.ts  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:30`  · _Performance & Cost_
- [ ] **#263** ⚪ _(conf 1/3)_ grocery module excluded from MODULE_TIERS escalation (undocumented tradeoff)  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:143-189`  · _Performance & Cost_
- [ ] **#264** ⚪ _(conf 1/3)_ pass-2 segmentation maxTokens=1024 may be larger than needed  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts:34-39`  · _Performance & Cost_
- [ ] **#265** ⚪ _(conf 1/3)_ Serial Voyage embed then cache lookup in /route/:module (single-fragment only)  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:260-277`  · _Performance & Cost_
- [ ] **#266** ⚪ _(conf 1/3)_ Turkish crisis lexicon has incomplete tier coverage vs English  
      `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.tr.json`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#267** ⚪ _(conf 1/3)_ Spanish crisis lexicon missing a tier-4 pattern vs English  
      `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.es.json`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#268** ⚪ _(conf 1/3)_ dump-coverage mock regression suite cannot catch real prompt regressions  
      `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.test.ts (lines 66-93)`  · _Test Quality & Coverage_
- [ ] **#269** ⚪ _(conf 1/3)_ partner.ts router module has no tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts`  · _Test Quality & Coverage_
- [ ] **#270** ⚪ _(conf 1/3)_ Loose Tauri plugin version constraints - missing patch versions  
      `/Users/serrayildirim/ollie/apps/native/package.json:28`  · _Dependency Health_
- [ ] **#271** ⚪ _(conf 1/3)_ Heavy/redundant @clerk/clerk-react in a native desktop app  
      `/Users/serrayildirim/ollie/apps/native/package.json:15`  · _Dependency Health_
- [ ] **#272** ⚪ _(conf 1/3)_ Missing @types/react-dom in @ollie/store despite React hook exports  
      `/Users/serrayildirim/ollie/packages/store/package.json:20-25`  · _Dependency Health_
- [ ] **#273** ⚪ _(conf 1/3)_ Unused devDependency: @types/zxcvbn  
      `/Users/serrayildirim/ollie/packages/crypto/package.json:17`  · _Dependency Health_
- [ ] **#274** ⚪ _(conf 1/3)_ Possibly unnecessary @fontsource/dm-mono dependency  
      `/Users/serrayildirim/ollie/apps/native/package.json:16`  · _Dependency Health_