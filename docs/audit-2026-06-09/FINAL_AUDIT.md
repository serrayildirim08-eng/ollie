# Ollie Repo — Final Deep Audit Report

_Date: today · Branch: feat/brain @ 2325ee5 · 20 dimensions × 3 independent rounds (60 audits) + cross-round clustering._

**Confidence = number of independent rounds (out of 3) that found the issue.** 3 = found every round (most reliable), 1 = found once (verify).

## Summary

| Metric | Count |
|---|---|
| Distinct issues | 274 |
| 🔴 Critical | 10 |
| 🟠 High | 80 |
| Confidence 3/3 | 23 |
| Confidence 2/3 | 41 |
| Confidence 1/3 | 210 |

## Ranked Issues (severity, then confidence)

| # | Sev | Conf | Issue | Dimension | File |
|---|---|---|---|---|---|
| 1 | 🔴 | 3/3 | CrisisSignal schema mismatch between worker and native client (type/language vs tier/languages/matches) | API Contract Consistency | `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77` |
| 2 | 🔴 | 3/3 | Crisis banner message + 'notice' kicker + dismiss affordance hardcoded English only | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:303-308` |
| 3 | 🔴 | 2/3 | IDOR: telemetry endpoints verify JWT but never pass userId to handlers, which trust client-supplied user_hash / row.user_id | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343` |
| 4 | 🔴 | 2/3 | remindIn hint silently lost when low-confidence fragments are demoted to dump_only | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:281` |
| 5 | 🔴 | 2/3 | Crisis lexicons marked PENDING_SERRA_APPROVAL — alpha-blocking safety gate (all 3 languages) | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.en.json:4` |
| 6 | 🔴 | 1/3 | Gemini API key exposed in URL query string | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:55` |
| 7 | 🔴 | 1/3 | Promise.all without error boundary in flush-notifications aborts the rest of the batch | Error Handling & Resilience | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:223` |
| 8 | 🔴 | 1/3 | Non-numeric confidence coerced to 0, triggering spurious demotion and data loss | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:200` |
| 9 | 🔴 | 1/3 | grocery_purchase_history uses UUID for user_id but receives text Clerk IDs | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:13` |
| 10 | 🔴 | 1/3 | push_tokens_touch_updated_at() trigger uses comparison operator (=) instead of assignment (:=) | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260515000001_notification_delivery.sql:130` |
| 11 | 🟠 | 3/3 | CORS Access-Control-Allow-Origin '*' exposes all worker endpoints to any origin | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131` |
| 12 | 🟠 | 3/3 | Centralized UUID/request-ID generation missing across packages (research-stream, worker-http, orchestrator) | Reinvented Wheels & Duplication | `packages/research-stream/src/index.ts:338-349` |
| 13 | 🟠 | 3/3 | Unsafe `as unknown as ModuleHandler<Module>` casts in module registry | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:94-109` |
| 14 | 🟠 | 3/3 | API client casts response to generic T without runtime validation | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/api/src/client.ts:194` |
| 15 | 🟠 | 3/3 | Theme tokens cast `as unknown as Record<...>` in tokensToCssVars bypasses type safety | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:208-225` |
| 16 | 🟠 | 3/3 | Fire-and-forget Vectorize cache operations silently inflate AI cost with no alerting | Error Handling & Resilience | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-269` |
| 17 | 🟠 | 3/3 | RoutingSummary.pass2Triggered present in worker output but absent from native schema | API Contract Consistency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:415` |
| 18 | 🟠 | 3/3 | Fragment.needsConfirm required in worker schema but optional in native schema | API Contract Consistency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:49` |
| 19 | 🟠 | 3/3 | enriched_signals INSERT has no idempotency guarantee (no unique constraint on dump_id, plain POST without upsert) | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-365` |
| 20 | 🟠 | 3/3 | TodayNoticings kicker + affordance labels hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147` |
| 21 | 🟠 | 3/3 | NotifyPrimeLine notification prompt + button labels hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49` |
| 22 | 🟠 | 3/3 | MicButton mic/error/status messages + aria-labels hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:71` |
| 23 | 🟠 | 3/3 | PhotoIntake error messages + aria-labels + status text hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54` |
| 24 | 🟠 | 3/3 | json-cascade.ts provider fallback chain has zero tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts (lines 55-122)` |
| 25 | 🟠 | 3/3 | pass1Segment (Pass 1 segmentation) has zero unit tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts (lines 53-82, helpers 89-103)` |
| 26 | 🟠 | 3/3 | detectFragmentLanguage (lang-detect) has zero unit tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts (lines 19-45, 116-166)` |
| 27 | 🟠 | 3/3 | pass2Split (segmentation-llm Pass 2) has zero unit tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts (lines 33-56)` |
| 28 | 🟠 | 3/3 | React type version mismatch between @ollie/store and apps/native | Dependency Health | `/Users/serrayildirim/ollie/packages/store/package.json:18` |
| 29 | 🟠 | 2/3 | verifyJwt dual-mode Supabase fallback returns null on service errors and skips issuer validation | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:364-400` |
| 30 | 🟠 | 2/3 | T0_JWT_ENFORCED dev gate accepts spoofable x-user-id and relies on implicit fail-closed default | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:217-230` |
| 31 | 🟠 | 2/3 | Missing size/bounds validation on body.row object in /ingest-event | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-208` |
| 32 | 🟠 | 2/3 | Multiple exponential-backoff retry implementations (api/client vs sync/retry) | Reinvented Wheels & Duplication | `packages/api/src/client.ts:222-250` |
| 33 | 🟠 | 2/3 | Capacitor backend uses `Promise<any>` dynamic import / unvalidated globalThis cast | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:36-38` |
| 34 | 🟠 | 2/3 | TOCTOU race in finance sync drain queue cleanup loses concurrently-enqueued items | Async & Concurrency | `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:335-401` |
| 35 | 🟠 | 2/3 | applyGroceryMutations is ~248 lines with 4-level nesting and duplicated pantry/shopping logic | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-647` |
| 36 | 🟠 | 2/3 | grocery.config.ts is ~1,820 lines mixing 600+ food-data entries with config code | Clean Code & Complexity | `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820` |
| 37 | 🟠 | 2/3 | Package tsconfigs do not extend tsconfig.base.json, causing strict-setting drift | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json` |
| 38 | 🟠 | 2/3 | noUnusedLocals/noUnusedParameters enabled only in apps/native, not in tsconfig.base.json | Linting & Config Hygiene | `/Users/serrayildirim/ollie/tsconfig.base.json` |
| 39 | 🟠 | 2/3 | Voyage embedding indices not bounds-checked, producing a sparse embeddings array | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:449-459` |
| 40 | 🟠 | 2/3 | scheduled_jobs dedupe unique index is partial (pending-only), so reschedules after a job fires create duplicate rows; upsert sends no on_conflict | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/supabase/migrations/20260513000001_scheduled_jobs.sql:47-49` |
| 41 | 🟠 | 2/3 | BrainDumpInput error messages + default placeholder hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:94` |
| 42 | 🟠 | 2/3 | classifyFragment (dump-classify, Layer 1 classifier wrapper) untested | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts (lines 1-285)` |
| 43 | 🟠 | 1/3 | STAGING_TEST_BEARER backdoor can bypass Clerk JWT verification with no production guard | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:123` |
| 44 | 🟠 | 1/3 | Raw unscrubbed user input logged in worker dump telemetry | Secrets & Token Exposure | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:387` |
| 45 | 🟠 | 1/3 | Unsafe parseFloat on budget env/KV values without bounds validation | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:137-140` |
| 46 | 🟠 | 1/3 | No request body size limit on /brain-dump and /v1/messages endpoints | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:389` |
| 47 | 🟠 | 1/3 | Missing maximum text length validation in /route/dump | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:148-157` |
| 48 | 🟠 | 1/3 | UUID generation logic duplicated across 16+ module repositories | Reinvented Wheels & Duplication | `apps/native/src/modules/goals/repo.ts:81-85` |
| 49 | 🟠 | 1/3 | Duplicate mean() implementations across 4 locations | Reinvented Wheels & Duplication | `packages/logic/src/stats/index.ts:29-30` |
| 50 | 🟠 | 1/3 | No module boundary enforcement in ESLint or TypeScript | File & Module Structure | `/Users/serrayildirim/ollie/eslint.config.mjs:1-79` |
| 51 | 🟠 | 1/3 | Unvalidated store cast `as unknown as SnapshotStoreLike` in body-correlations orchestrator | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:108` |
| 52 | 🟠 | 1/3 | Unsafe JSON.parse without schema validation across dump/repo files | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/dump/archive.ts:134` |
| 53 | 🟠 | 1/3 | Promise.all without per-element error handler in native post-dispatch path | Error Handling & Resilience | `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-101` |
| 54 | 🟠 | 1/3 | Unhandled promise rejection in braindump-dispatch grocery routing IIFE | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:847` |
| 55 | 🟠 | 1/3 | Missing timeout on APNs JWT fetch in send path | Error Handling & Resilience | `/Users/serrayildirim/ollie/apps/api/src/worker.ts:406-413` |
| 56 | 🟠 | 1/3 | Silent data loss when sync queue persistence fails after successful upsert | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/sync/src/index.ts:199-212` |
| 57 | 🟠 | 1/3 | Empty catch blocks in auth vault crypto operations hide key-derivation and cleanup failures | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/auth/src/index.ts:167-171` |
| 58 | 🟠 | 1/3 | Grocery pattern detectors swallow detector failures with empty catch blocks | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:293-297` |
| 59 | 🟠 | 1/3 | Finance pattern detectors swallow detector failures with empty catch blocks | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:118` |
| 60 | 🟠 | 1/3 | enqueueUpsert encryption failure is unhandled and can drop or corrupt queued rows | Async & Concurrency | `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:255-271` |
| 61 | 🟠 | 1/3 | Non-atomic token-bucket rate limiter in APNs worker allows burst overage | Async & Concurrency | `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:135-142` |
| 62 | 🟠 | 1/3 | dispatchAction is 467 lines with 10+ inline module-specific branches | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157` |
| 63 | 🟠 | 1/3 | shelf-life.ts: empty interface with stale eslint-disable referencing a removed rule | Linting & Config Hygiene | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/shelf-life.ts:34-35` |
| 64 | 🟠 | 1/3 | Cache TTL broken on every hit: cacheHitBump drops createdAt | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:171-186` |
| 65 | 🟠 | 1/3 | Incorrect summary truncation logic in rule-based journal extraction | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:140-145` |
| 66 | 🟠 | 1/3 | phaseForDay produces incorrect phase boundaries for short cycles (<23 days) | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:48-52` |
| 67 | 🟠 | 1/3 | matchItem substring matching too permissive — allows false-positive mutation targets | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:111-122` |
| 68 | 🟠 | 1/3 | Orphaned admin:* cue events emitted with zero consumers | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:196-250` |
| 69 | 🟠 | 1/3 | 42+ additional orphaned cue events across finance/grocery/goals/habits/work/sleep/body/pets/burhan/cycle | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src` |
| 70 | 🟠 | 1/3 | Sleep orchestrator reads sleep.debt with wrong field name (debt_hours vs totalDeficitHours), silently disabling pacing-breach detection | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/sleep.ts:379-382` |
| 71 | 🟠 | 1/3 | finance.settings is a one-way mirror that drops UI-modified settings on the next bridge sync | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/finance/bridge.ts:164-169` |
| 72 | 🟠 | 1/3 | finance.taxProfile read by orchestrator but never written by any bridge or onboarding path | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:921-952` |
| 73 | 🟠 | 1/3 | Module 'mood' in routing enum but not registered in worker MODULE_CONFIGS | API Contract Consistency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:19` |
| 74 | 🟠 | 1/3 | Idempotency-key infrastructure missing across dump/event ingestion (client + telemetry endpoints) | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159` |
| 75 | 🟠 | 1/3 | partner sync tables missing GRANT statements (service_role cannot access) | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-55` |
| 76 | 🟠 | 1/3 | grocery_purchase_history missing GRANT statements for authenticated role | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31-43` |
| 77 | 🟠 | 1/3 | cook_history missing GRANT statements for authenticated and service_role | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:25-38` |
| 78 | 🟠 | 1/3 | routing_cache missing GRANT statements (service_role worker cannot access) | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70-78` |
| 79 | 🟠 | 1/3 | Missing FORCE ROW LEVEL SECURITY on partner sync tables | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-49` |
| 80 | 🟠 | 1/3 | Missing FORCE ROW LEVEL SECURITY on grocery_purchase_history | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31` |
| 81 | 🟠 | 1/3 | Missing FORCE ROW LEVEL SECURITY on cook_history | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:26` |
| 82 | 🟠 | 1/3 | Missing FORCE ROW LEVEL SECURITY on routing_cache | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70` |
| 83 | 🟠 | 1/3 | N+1 store.update() calls in applyGroceryMutations loop | Performance & Cost | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-812` |
| 84 | 🟠 | 1/3 | N+1 query pattern in goals.listWithLatest() | Performance & Cost | `/Users/serrayildirim/ollie/apps/native/src/modules/goals/repo.ts:105-122` |
| 85 | 🟠 | 1/3 | Serial per-row /label calls in research orchestrator flush | Performance & Cost | `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:158-187` |
| 86 | 🟠 | 1/3 | ACTION_DESCRIPTION in brain copy prompt hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/packages/logic/src/brain/copy.ts:102-104` |
| 87 | 🟠 | 1/3 | /route/dump request omits app language (locale field never populated) | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:187-194` |
| 88 | 🟠 | 1/3 | groq/gemini/cloudflare-ai provider client modules have no tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/groq.ts` |
| 89 | 🟠 | 1/3 | dump.test.ts is a smoke test only — no error-path coverage for Voyage/Groq/rate-limiting | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts (lines 136-232)` |
| 90 | 🟠 | 1/3 | Deprecated Clerk package - migrate to @clerk/react | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:15` |
| 91 | 🟡 | 3/3 | Finance merge casts FinanceRecord to `Record<string, unknown>` for dynamic key assignment | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41` |
| 92 | 🟡 | 3/3 | NeedsConfirmCard hardcoded English text + aria-labels | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:60` |
| 93 | 🟡 | 3/3 | TypeScript version drift across workspace - both 5.8.3 and 5.9.3 installed | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:42` |
| 94 | 🟡 | 2/3 | Inline setTimeout sleep pattern instead of shared sleep() utility | Reinvented Wheels & Duplication | `workers/ai-proxy/src/gemini.ts:63` |
| 95 | 🟡 | 2/3 | @ollie/notifications declares @ollie/api as a runtime dependency for a type-only import | File & Module Structure | `/Users/serrayildirim/ollie/packages/notifications/package.json:24` |
| 96 | 🟡 | 2/3 | `getRandomValues` typed with `any` parameter/return in crypto package | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:85-86` |
| 97 | 🟡 | 2/3 | Sleep parse casts SleepRecord through `unknown as Record<string, unknown>` | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:161` |
| 98 | 🟡 | 2/3 | Grocery orchestrator: unvalidated payload cast and result cast in item route | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:176` |
| 99 | 🟡 | 2/3 | cadence-scanner fires notifications without await or failure tracking | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:405-420` |
| 100 | 🟡 | 2/3 | research-stream trackTable fire-and-forget POST loses data with no retry | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:211-222` |
| 101 | 🟡 | 2/3 | Fire-and-forget Promise.all post-dispatch chain has fragile error boundary | Async & Concurrency | `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109` |
| 102 | 🟡 | 2/3 | MUTATION_RE regex mixes EN/TR/ES verbs in one undocumented alternation | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99` |
| 103 | 🟡 | 2/3 | Grocery async routing closure in dispatchAction is deeply nested and duplicated | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:721-847` |
| 104 | 🟡 | 2/3 | O(n²) deduplication in brain noticing selection (nested findIndex inside filter) | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:335` |
| 105 | 🟡 | 2/3 | Orchestrator-internal dedup keys persisted to store with no external reader/writer (incl. finance _recurringCandidatesConfirmed/Dismissed) | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src (scattered across all orchestrators)` |
| 106 | 🟡 | 2/3 | Fragment.payload typed as generic Record<string,unknown> in worker vs ActionPayload discriminated union in native | API Contract Consistency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:46` |
| 107 | 🟡 | 2/3 | Multi-device APNs delivery is not per-token idempotent; retry re-pushes to devices that already succeeded | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:221-241` |
| 108 | 🟡 | 2/3 | Vision extraction 429 retry uses hardcoded 1s sleep with no exponential backoff or jitter | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:76-83` |
| 109 | 🟡 | 2/3 | PatternCards dismiss aria-label hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/patterns/PatternCards.tsx:138` |
| 110 | 🟡 | 2/3 | transcribe.ts (Groq Whisper audio path) untested | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts (91 lines)` |
| 111 | 🟡 | 2/3 | cook-history.ts untested despite being in the main flow | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/cook-history.ts (236 lines)` |
| 112 | 🟡 | 2/3 | Flaky setTimeout-based async waits in braindump-dispatch tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/packages/orchestrator/tests/braindump-dispatch.test.ts (lines 395, 432, 455)` |
| 113 | 🟡 | 2/3 | LIVE classifier regression suite is gated out of CI | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.live.test.ts (lines 32, 35, 71)` |
| 114 | 🟡 | 1/3 | Missing rate-limit enforcement on public shelf-life endpoints when caller id is null | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:258-303` |
| 115 | 🟡 | 1/3 | Service-role Supabase REST calls in invites lack HTTPS/protocol-downgrade validation | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:107-108` |
| 116 | 🟡 | 1/3 | Invite endpoints accept inviter_user_hash / invitee_user_hash without format validation | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:75-76` |
| 117 | 🟡 | 1/3 | Account deletion endpoint has no rate limiting on retries | Security & Authorization | `/Users/serrayildirim/ollie/apps/api/src/account-delete.ts:134-256` |
| 118 | 🟡 | 1/3 | Telemetry tables lack explicit service_role grants in migrations | Security & Authorization | `/Users/serrayildirim/ollie/supabase/migrations/20260514000001_raw_dumps.sql:45-49` |
| 119 | 🟡 | 1/3 | Partial device push token logged to console in capacitor backend | Secrets & Token Exposure | `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:277` |
| 120 | 🟡 | 1/3 | Non-atomic daily-budget cost tracking race condition in /label | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:135-144` |
| 121 | 🟡 | 1/3 | Unsafe parseInt on legacy KV rate-limit counter | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:467` |
| 122 | 🟡 | 1/3 | Unvalidated body.text length in /route/:module handler | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-249` |
| 123 | 🟡 | 1/3 | Path parameter module name not length-validated in /route/:module | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:366-370` |
| 124 | 🟡 | 1/3 | startOfDay() reimplemented in 3 separate locations | Reinvented Wheels & Duplication | `packages/logic/src/medication/index.ts:115-119` |
| 125 | 🟡 | 1/3 | newRequestId() in @ollie/worker-http duplicates UUID fallback pattern | Reinvented Wheels & Duplication | `packages/worker-http/src/index.ts:65-73` |
| 126 | 🟡 | 1/3 | Median function reimplemented in cadence module | Reinvented Wheels & Duplication | `packages/cadence/src/index.ts:206-214` |
| 127 | 🟡 | 1/3 | Duplicated word-boundary regex helpers in admin and work constants | Reinvented Wheels & Duplication | `packages/logic/src/admin/constants.ts:5-18` |
| 128 | 🟡 | 1/3 | createDebouncer() not broadly exported; per-key debounce likely to be reinvented | Reinvented Wheels & Duplication | `packages/sync/src/retry.ts:31-49` |
| 129 | 🟡 | 1/3 | @ollie/logic exposes 17 internal submodule exports that allow bypassing the orchestrator facade | File & Module Structure | `/Users/serrayildirim/ollie/packages/logic/package.json:8-27` |
| 130 | 🟡 | 1/3 | @ollie/logic exports field is incomplete — 7 implemented submodules are not exported | File & Module Structure | `/Users/serrayildirim/ollie/packages/logic/package.json:8-27` |
| 131 | 🟡 | 1/3 | @ollie/orchestrator exports internal dedup utility used only by tests | File & Module Structure | `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:40` |
| 132 | 🟡 | 1/3 | @ollie/orchestrator has no package.json exports field — entire src/ is implicitly importable | File & Module Structure | `/Users/serrayildirim/ollie/packages/orchestrator/package.json:1-10` |
| 133 | 🟡 | 1/3 | globalThis typed as `any` for navigator/crypto in research-stream | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:145` |
| 134 | 🟡 | 1/3 | Redundant non-null assertions after Array.isArray guard in goals detectors | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/logic/src/goals/velocity.ts:98` |
| 135 | 🟡 | 1/3 | Journal extraction casts emotions array through `unknown[]` during validation | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:281` |
| 136 | 🟡 | 1/3 | Finance orchestrator unnecessary double-cast after in-operator narrowing | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:953` |
| 137 | 🟡 | 1/3 | Layout components double-cast space key lookups through unknown | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/layout/Box.tsx:78` |
| 138 | 🟡 | 1/3 | Mood handler casts fragment.payload to MoodAction without validation | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/modules/mood/handler.ts:32` |
| 139 | 🟡 | 1/3 | Object.keys() loses type information in journal extraction loop | TypeScript Type Safety | `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:262` |
| 140 | 🟡 | 1/3 | Research orchestrator flush timer can produce unhandled rejection if onError throws | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:193` |
| 141 | 🟡 | 1/3 | Sync scheduler does not signal operator on retry exhaustion | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/sync/src/retry.ts:121-127` |
| 142 | 🟡 | 1/3 | Partner bilateral snapshot writes suppress errors causing silent state divergence | Error Handling & Resilience | `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:112` |
| 143 | 🟡 | 1/3 | updateJob failures in flush-notifications are swallowed, risking duplicate delivery | Error Handling & Resilience | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:471-476` |
| 144 | 🟡 | 1/3 | No timeout on Supabase queries in flush-notifications can hang the cron worker | Error Handling & Resilience | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:365` |
| 145 | 🟡 | 1/3 | Supabase REST error body parse failure masks original error code | Error Handling & Resilience | `/Users/serrayildirim/ollie/apps/api/src/worker.ts:234-241` |
| 146 | 🟡 | 1/3 | Cron drain treats 200 OK as success without verifying written rows | Error Handling & Resilience | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:318-322` |
| 147 | 🟡 | 1/3 | Empty catch hides inbound decryption failures in sync syncIn | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/sync/src/index.ts:238-252` |
| 148 | 🟡 | 1/3 | sync/finance syncIn unbounded recursion can overflow the stack | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:544-546` |
| 149 | 🟡 | 1/3 | sync/finance drainOnce loses upserts when a delete fails mid-drain | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:340-395` |
| 150 | 🟡 | 1/3 | worker-http newRequestId silently falls back to weak random IDs on crypto failure | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/worker-http/src/index.ts:66-72` |
| 151 | 🟡 | 1/3 | Unchecked dual KV deletes after processing in cron drain risk duplicate enrichment | Async & Concurrency | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:144-147` |
| 152 | 🟡 | 1/3 | No circuit breaker / coalescing on Vectorize cache lookup in dump route causes AI stampede on outage | Async & Concurrency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:264-271` |
| 153 | 🟡 | 1/3 | Fragile fire-and-forget boot scan in cadence-scanner | Async & Concurrency | `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:445-450` |
| 154 | 🟡 | 1/3 | Dead placeholder promise in research orchestrator init | Async & Concurrency | `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:218-223` |
| 155 | 🟡 | 1/3 | recomputeDerived is a 1000+ line god function with repeated emit/dedup try-catch boilerplate | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:274-1100` |
| 156 | 🟡 | 1/3 | Inline store.update type declarations repeated 30+ times instead of module-scope aliases | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:413-423` |
| 157 | 🟡 | 1/3 | emitResearchRow called inline 11+ times with near-identical arguments | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:366-383` |
| 158 | 🟡 | 1/3 | applyCapitalizedNameHeuristic has three nested loops with hard-to-follow flag logic | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/pii-scrub/src/index.ts:388-440` |
| 159 | 🟡 | 1/3 | Unused eslint-disable no-console directives (rule not configured) | Linting & Config Hygiene | `/Users/serrayildirim/ollie/apps/native/src/lib/formatRelativeTime.ts:135` |
| 160 | 🟡 | 1/3 | Unused destructured variable 'calls' in cadence-scanner test | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages/orchestrator/tests/cadence-scanner.test.ts:235` |
| 161 | 🟡 | 1/3 | Unused test helper function 'makeVoyageOk' | Linting & Config Hygiene | `/Users/serrayildirim/ollie/workers/ai-proxy/tests/route.test.ts:45` |
| 162 | 🟡 | 1/3 | ESLint flat config ignores all *.config files and tools/, leaving plugin/config code unlinted | Linting & Config Hygiene | `/Users/serrayildirim/ollie/eslint.config.mjs:32` |
| 163 | 🟡 | 1/3 | No log emitted when remindIn is structurally lost via demotion | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285-291` |
| 164 | 🟡 | 1/3 | Missing integration test for remindIn under the low-confidence demotion path | Dump Routing Flow Correctness | `/Users/serrayildirim/ollie/workers/ai-proxy/tests` |
| 165 | 🟡 | 1/3 | Timezone-dependent cadence dedupe key can fire duplicate notifications across timezone changes | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:232-239` |
| 166 | 🟡 | 1/3 | Grocery mutation regex fails to match common natural phrasings like 'threw it out' | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99` |
| 167 | 🟡 | 1/3 | Sub-orchestrator init() registers event listeners with no idempotency guard (double-subscribe on re-init) | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:273-312` |
| 168 | 🟡 | 1/3 | Watcher tick may observe stale store data between SQLite write and bridge sync (fire-and-forget dispatch) | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:89-109` |
| 169 | 🟡 | 1/3 | cycle.lastEditedByCycle always written empty; 72h recent-edit suppression never fires | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:150` |
| 170 | 🟡 | 1/3 | sleep.windDownLog read-merged with no SQLite owner; stale entries can never be pruned | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:179-180` |
| 171 | 🟡 | 1/3 | sleep.medsLog read-merged but written by no bridge; cross-feed broken, entries never cleared | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:187-189` |
| 172 | 🟡 | 1/3 | pets.coregulation_log read-merged but only appended by dump mood flow, never pruned on dump deletion | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/pets/bridge.ts:160-165` |
| 173 | 🟡 | 1/3 | admin.phoneTasks store-consistency gap (reported as never-written; actually written but with no UI capture source) | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:530-544` |
| 174 | 🟡 | 1/3 | dump-schema.ts hand-mirrored from native schema with no automated sync/drift check | API Contract Consistency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:1-6` |
| 175 | 🟡 | 1/3 | KV retry path has no jitter or backoff — lock-step 5-min retries cause a thundering herd | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:160-162` |
| 176 | 🟡 | 1/3 | MAX_RETRIES=12 (~1h at fixed 5-min intervals) risks DLQ-ing valid entries during a transient outage | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:78` |
| 177 | 🟡 | 1/3 | updateJob PATCH does not verify a row was actually updated (no row-count check) | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:455-477` |
| 178 | 🟡 | 1/3 | Partner snapshot upsert has no idempotency key for concurrent in-flight retries | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:173-179` |
| 179 | 🟡 | 1/3 | APNs push worker rate-limit counter is not atomic across instances | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:129-143` |
| 180 | 🟡 | 1/3 | APNs push worker does not deduplicate identical in-flight requests | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:55-125` |
| 181 | 🟡 | 1/3 | Drain treats enriched_signals constraint/FK errors as transient, retrying a permanently-failing write into the DLQ | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:143-163` |
| 182 | 🟡 | 1/3 | Missing rollback (.down.sql) migrations for 10 recent schema changes | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/rollbacks/` |
| 183 | 🟡 | 1/3 | partner_snapshots missing updated_at trigger | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-55` |
| 184 | 🟡 | 1/3 | partner_snapshots missing index on updated_at column | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-45` |
| 185 | 🟡 | 1/3 | Tables created without explicit public schema prefix | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:11` |
| 186 | 🟡 | 1/3 | cook_history authenticated RLS policies dropped during type migration but not recreated | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260530144446_fix_cook_history_clerk_id_text.sql:15-17` |
| 187 | 🟡 | 1/3 | Drain queue processes dumps serially, blocking on Anthropic + Supabase | Performance & Cost | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:122-164` |
| 188 | 🟡 | 1/3 | Serial per-fragment pass-2 segmentation on cache misses in dump route | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:198-218` |
| 189 | 🟡 | 1/3 | Duplicate buildBasePrompt() calls in feed-me router | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:269,908,981` |
| 190 | 🟡 | 1/3 | GoalsBox polls all goals + cadence every 6s with no debounce/dedup | Performance & Cost | `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:75-95,111-123` |
| 191 | 🟡 | 1/3 | Repeated multi-pass filter+map chains in finance cycle correlation | Performance & Cost | `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:84-94` |
| 192 | 🟡 | 1/3 | Duplicated complementary filter+map over overlap array in sleep correlation | Performance & Cost | `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:162-163` |
| 193 | 🟡 | 1/3 | DumpScreen heading 'What's in your head?' hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:215` |
| 194 | 🟡 | 1/3 | Navigation module labels/hints (Router) hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/navigation/Router.tsx:88-120` |
| 195 | 🟡 | 1/3 | Primary route tab labels hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/navigation/routes.ts:37-40` |
| 196 | 🟡 | 1/3 | TodoScreen decision-variant buttons hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:505` |
| 197 | 🟡 | 1/3 | GroceryNow status strings hardcoded English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryNow.tsx:112-115` |
| 198 | 🟡 | 1/3 | Module checkbox/confirm aria-labels hardcoded English (GoalsBox + work/admin) | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:372` |
| 199 | 🟡 | 1/3 | dump-schema applyConfidencePolicy boundaries untested | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts (lines 67-89)` |
| 200 | 🟡 | 1/3 | Worker-level PII scrubber regex patterns are not unit-tested | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/pii.ts (lines 48-77+)` |
| 201 | 🟡 | 1/3 | Handler tests assert on mock calls instead of resulting state | Test Quality & Coverage | `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/handler.test.ts (lines 50-64)` |
| 202 | 🟡 | 1/3 | Retry scheduler untested for concurrent cancellation and timer-fire races | Test Quality & Coverage | `/Users/serrayildirim/ollie/packages/sync/tests/retry.test.ts (line 26)` |
| 203 | 🟡 | 1/3 | Only the orchestrator package has coverage gates | Test Quality & Coverage | `/Users/serrayildirim/ollie/packages/orchestrator/vitest.config.ts (lines 12-20)` |
| 204 | 🟡 | 1/3 | crypto decrypt fallback for legacy payloads missing kdf_iter is untested | Test Quality & Coverage | `/Users/serrayildirim/ollie/packages/crypto/tests/crypto.test.ts (lines 185-230)` |
| 205 | 🟡 | 1/3 | Consent sync tests assert on the mock, not on local state mutation | Test Quality & Coverage | `/Users/serrayildirim/ollie/packages/consent/tests/consent.test.ts (lines 152-162, 314-320)` |
| 206 | 🟡 | 1/3 | Unused dependency: @tauri-apps/plugin-opener | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:29` |
| 207 | 🟡 | 1/3 | Missing peer dependency declaration consideration for @ollie/store consumers | Dependency Health | `/Users/serrayildirim/ollie/packages/store/package.json:17-18` |
| 208 | ⚪ | 2/3 | Secrets in gitignored .env.local (Sentry DSN + Supabase anon key) | Secrets & Token Exposure | `/Users/serrayildirim/ollie/.env.local:8` |
| 209 | ⚪ | 2/3 | Unvalidated excludeDishes array size in /feed-me endpoint | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466` |
| 210 | ⚪ | 2/3 | Finance threshold magic numbers hardcoded inline instead of named constants | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:96-100` |
| 211 | ⚪ | 2/3 | Volatile @cloudflare/workers-types specifier pinned to a stale date | Dependency Health | `/Users/serrayildirim/ollie/apps/api/package.json:19` |
| 212 | ⚪ | 1/3 | Shared telemetry rate-limit bucket lets /ingest-event spam high-cardinality tables | Security & Authorization | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343` |
| 213 | ⚪ | 1/3 | Real API keys in gitignored .env and worker .dev.vars | Secrets & Token Exposure | `/Users/serrayildirim/ollie/.env:4` |
| 214 | ⚪ | 1/3 | Unvalidated anthropic-beta header forwarded upstream | Input Validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:411-412` |
| 215 | ⚪ | 1/3 | isoTodayWork() reinvents dayKey() formatting | Reinvented Wheels & Duplication | `apps/native/src/modules/work/repo.ts:84-90` |
| 216 | ⚪ | 1/3 | startOfWeek()/endOfWeek() private to body-weekly; not consolidated | Reinvented Wheels & Duplication | `packages/orchestrator/src/body-weekly.ts:69-78` |
| 217 | ⚪ | 1/3 | sleep() defined privately in @ollie/api rather than as a shared utility | Reinvented Wheels & Duplication | `packages/api/src/client.ts:379-381` |
| 218 | ⚪ | 1/3 | Duplicated _consentOnGoals helper across goals phase2 and phase3 | Reinvented Wheels & Duplication | `packages/logic/src/goals/phase2.ts` |
| 219 | ⚪ | 1/3 | Test files colocated with source code in apps/native (inconsistent with packages) | File & Module Structure | `/Users/serrayildirim/ollie/apps/native/src` |
| 220 | ⚪ | 1/3 | @ollie/notifications declares 7 unused subpath exports, creating false API-stability signals | File & Module Structure | `/Users/serrayildirim/ollie/packages/notifications/package.json:8-17` |
| 221 | ⚪ | 1/3 | Large monolithic barrel index files in orchestrator and notifications | File & Module Structure | `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:1-341` |
| 222 | ⚪ | 1/3 | apps/native imports orchestrator-internal types (CadenceTrackedEntry) not in the public API | File & Module Structure | `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/index.ts` |
| 223 | ⚪ | 1/3 | Missing internal return type on supabase IIFE arrow function | TypeScript Type Safety | `/Users/serrayildirim/ollie/apps/native/src/api/supabase.ts:62` |
| 224 | ⚪ | 1/3 | Event emit throws if validatePayload throws, crashing dispatch | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/events/src/index.ts:35-40` |
| 225 | ⚪ | 1/3 | Scheduled notification delay clamped to 0 fires immediately without warning | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:175-181` |
| 226 | ⚪ | 1/3 | research-stream scheduleFlush may leak/stack timers on rapid reschedule | Error Handling & Resilience | `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:253-260` |
| 227 | ⚪ | 1/3 | Flag-based coordination between async native schedule and cancel() in systemNotify has a race | Async & Concurrency | `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:275-314` |
| 228 | ⚪ | 1/3 | Unnecessary Promise.resolve().then() wrapper around recomputeCapacity in brain recompute | Async & Concurrency | `/Users/serrayildirim/ollie/apps/native/src/modules/brain/index.ts:54` |
| 229 | ⚪ | 1/3 | Duplicated cacheWrite implementation across ai-proxy router modules | Async & Concurrency | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:438` |
| 230 | ⚪ | 1/3 | Stale audit-task comment in dispatchAction contradicts implemented schema | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:24-25` |
| 231 | ⚪ | 1/3 | Stale taxProfile TODO comments in finance.ts reference an unshipped feature | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:154-159` |
| 232 | ⚪ | 1/3 | Magic number 30 * 60_000 for default work meeting duration | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:935` |
| 233 | ⚪ | 1/3 | Legacy work detectors still exported from legacy.ts | Clean Code & Complexity | `/Users/serrayildirim/ollie/packages/logic/src/work/index.ts:14` |
| 234 | ⚪ | 1/3 | Incomplete partner signal implementation left as a TODO stub | Clean Code & Complexity | `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:1` |
| 235 | ⚪ | 1/3 | Layer-1 router SYSTEM_PROMPT is a ~10k-char inline string literal with no bound guard | Clean Code & Complexity | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:44-145` |
| 236 | ⚪ | 1/3 | DEV-only test-milk button in GroceryBox has no removal criteria | Clean Code & Complexity | `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:17` |
| 237 | ⚪ | 1/3 | crisis-lexicon moduleResolution casing differs from base ('bundler' vs 'Bundler') | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json:5` |
| 238 | ⚪ | 1/3 | Inconsistent tsconfig include patterns across packages (non-recursive vs recursive globs) | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages` |
| 239 | ⚪ | 1/3 | Inconsistent explicit rootDir declarations across packages | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages` |
| 240 | ⚪ | 1/3 | Inconsistent outDir handling in noEmit packages | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages` |
| 241 | ⚪ | 1/3 | Redundant explicit strict: true in child tsconfigs | Linting & Config Hygiene | `/Users/serrayildirim/ollie/packages/apns-jwt/tsconfig.json` |
| 242 | ⚪ | 1/3 | No dedicated lint CI gate; lint runs inside the build job without explicit visibility | Linting & Config Hygiene | `/Users/serrayildirim/ollie/.github/workflows/ci.yml:36` |
| 243 | ⚪ | 1/3 | phaseFold has O(n*m) complexity scanning all cycles per event | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:62-82` |
| 244 | ⚪ | 1/3 | DAY_MS constant duplicated across modules instead of shared import | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:154` |
| 245 | ⚪ | 1/3 | createdAt tiebreak in selection uses POSITIVE_INFINITY sentinel for missing values | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:342-345` |
| 246 | ⚪ | 1/3 | medianAmountOf empty-input safety is implicit (guard present but undocumented) | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/cadence/src/recurring.ts:174` |
| 247 | ⚪ | 1/3 | Fertile-window widen factor rounding may introduce ±0.5 day error for high SD | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/cycle/prediction.ts:103-109` |
| 248 | ⚪ | 1/3 | Grocery replenishment soonestOutMs tracked sequentially during pantry scan | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:140-175` |
| 249 | ⚪ | 1/3 | Deferability resolver contract for [0,1] range not enforced at type level | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:193-203` |
| 250 | ⚪ | 1/3 | Cadence nextExpectedTs computed for low-data confidence can show spurious overdue dates | Algorithms Correctness & Efficiency | `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:147` |
| 251 | ⚪ | 1/3 | finance.goals written by orchestrator but not mirrored by native bridge (savings-goal feature dark on native) | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:664,1081` |
| 252 | ⚪ | 1/3 | burhan store keys empty-on-boot: event-driven module with no bridge pre-population | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/burhan.ts:68-69,79` |
| 253 | ⚪ | 1/3 | body.correlations written by orchestrator but not seeded by native bridge (undefined on cold start) | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:117-118` |
| 254 | ⚪ | 1/3 | shared.signals has no bridge initialization; empty until body watcher first fires | State & Store Consistency | `/Users/serrayildirim/ollie/packages/orchestrator/src/body-signals.ts:138-146` |
| 255 | ⚪ | 1/3 | Cycle pregnancy flags written before items (ORDER MATTERS) — documented and safe under synchronous store.set | State & Store Consistency | `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:129-153` |
| 256 | ⚪ | 1/3 | bumpRetry counter is racy (TOCTOU); concurrent drains can under-count retries and block DLQ promotion | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:368-374` |
| 257 | ⚪ | 1/3 | Daily notification budget retry-loop compounds enriched_signals duplication for analytics | Idempotency & Retry Harness | `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:189-196` |
| 258 | ⚪ | 1/3 | finance_records.deleted_at lacks tombstone immutability constraint | DB, Migrations & Schema | `/Users/serrayildirim/ollie/supabase/migrations/20260514000008_finance_records.sql:65` |
| 259 | ⚪ | 1/3 | Research intake buffers data for up to 60s before consent re-check | Performance & Cost | `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:126-150` |
| 260 | ⚪ | 1/3 | Per-write Vectorize metadata JSON.stringify on every cache upsert/bump | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:151` |
| 261 | ⚪ | 1/3 | Cache-hit bump runs after response and silently drops on failure | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:302-306` |
| 262 | ⚪ | 1/3 | Likely dead groqChat import in feed-me.ts | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:30` |
| 263 | ⚪ | 1/3 | grocery module excluded from MODULE_TIERS escalation (undocumented tradeoff) | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:143-189` |
| 264 | ⚪ | 1/3 | pass-2 segmentation maxTokens=1024 may be larger than needed | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts:34-39` |
| 265 | ⚪ | 1/3 | Serial Voyage embed then cache lookup in /route/:module (single-fragment only) | Performance & Cost | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:260-277` |
| 266 | ⚪ | 1/3 | Turkish crisis lexicon has incomplete tier coverage vs English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.tr.json` |
| 267 | ⚪ | 1/3 | Spanish crisis lexicon missing a tier-4 pattern vs English | i18n Trilingual Coverage (EN/ES/TR) | `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.es.json` |
| 268 | ⚪ | 1/3 | dump-coverage mock regression suite cannot catch real prompt regressions | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.test.ts (lines 66-93)` |
| 269 | ⚪ | 1/3 | partner.ts router module has no tests | Test Quality & Coverage | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts` |
| 270 | ⚪ | 1/3 | Loose Tauri plugin version constraints - missing patch versions | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:28` |
| 271 | ⚪ | 1/3 | Heavy/redundant @clerk/clerk-react in a native desktop app | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:15` |
| 272 | ⚪ | 1/3 | Missing @types/react-dom in @ollie/store despite React hook exports | Dependency Health | `/Users/serrayildirim/ollie/packages/store/package.json:20-25` |
| 273 | ⚪ | 1/3 | Unused devDependency: @types/zxcvbn | Dependency Health | `/Users/serrayildirim/ollie/packages/crypto/package.json:17` |
| 274 | ⚪ | 1/3 | Possibly unnecessary @fontsource/dm-mono dependency | Dependency Health | `/Users/serrayildirim/ollie/apps/native/package.json:16` |

## 🎯 Highest-confidence issues (3/3 rounds)

### [CRITICAL] CrisisSignal schema mismatch between worker and native client (type/language vs tier/languages/matches)
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:227`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/src/types.ts:61-74`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:323`
- **Problem:** The native client schema (schema.ts:72-77) defines CrisisSignal as { detected: true; type: 'ideation'|'method_seeking'|'distress'|'panic'; confidence: number; language: 'en'|'es'|'tr' }. But the worker calls detectCrisis() (dump.ts:227) which returns @ollie/crisis-lexicon's actual CrisisSignal — { detected: true; tier: 1|2|3|4; languages: LexiconLanguage[]; matches: Array<{language,tier,pattern,line}> } — and ships it straight through. The native CrisisBanner reads crisis.type and crisis.language (DumpScreen.tsx:323) which do not exist on the real response, so the crisis banner renders undefined values for a safety-critical surface. Verified: crisis-lexicon types.ts:61-74 has no `type`/`confidence`/`language` fields; DumpScreen.tsx:323 reads `crisis.type` and `crisis.language`.
- **Fix:** Make @ollie/crisis-lexicon the single source of truth: have the native client import CrisisSignal from @ollie/crisis-lexicon and update DumpScreen.tsx to read crisis.tier / crisis.languages / crisis.matches. (Alternative: transform the lexicon signal to the native shape in the worker before responding, mapping tier→type and languages[0]→language, but a `confidence` source would need to be invented — prefer importing the lexicon type.)

### [CRITICAL] Crisis banner message + 'notice' kicker + dismiss affordance hardcoded English only
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:303-308`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:304`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:307-308`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:323`
- **Problem:** The CrisisBanner shows safety-critical messaging hardcoded in English only: the 'notice' kicker, the body 'Something in what you wrote sounded heavy. If it's urgent, a crisis line in your country can help right now.', and the dismiss affordance. This is the most safety-sensitive UI in the app, shown to users who may be in crisis, and it never reaches ES/TR speakers. R3 split the kicker into a separate finding but it is the same banner/root problem.
- **Fix:** Thread AppLang to CrisisBanner and create a trilingual message table keyed by language for the body, the 'notice' kicker (es: 'aviso', tr: 'uyarı'), and the dismiss affordance; render using the current app language setting.

### [HIGH] CORS Access-Control-Allow-Origin '*' exposes all worker endpoints to any origin
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131`
- **Problem:** The worker returns 'Access-Control-Allow-Origin': '*' on every CORS preflight/response (corsHeaders, lines 124-131, applied via withCors()). Any website can therefore make cross-origin requests to the worker. Round 1 and 2 rate this high-impact because it compounds the telemetry IDOR holes: a malicious page could craft Authorization headers and user_hash values to poison or exfiltrate telemetry for any user with a leaked/stolen session token. Round 3 notes the auth checks are a strong mitigation (sensitive endpoints require JWT or shared secret) but agrees the wide policy plus missing security headers (no X-Content-Type-Options, Referrer-Policy, HSTS) enlarges the auth-bypass / confused-deputy attack surface affecting all users at once.
- **Fix:** Restrict Access-Control-Allow-Origin to an allowlist of trusted origins (e.g. ollie.app, platform.ollie.app, the Electron/Capacitor app origins); validate the incoming Origin header and echo back only on match. Fetch the allowed list from env for dev/staging. Add defense-in-depth security headers (X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, Strict-Transport-Security). Document the trust model for who may call the worker.

### [HIGH] Centralized UUID/request-ID generation missing across packages (research-stream, worker-http, orchestrator)
- **Files:** `packages/research-stream/src/index.ts:338-349`, `packages/worker-http/src/index.ts:65-73`, `packages/orchestrator/braindump-dispatch.ts:312-317`, `workers/ai-proxy/src/telemetry.ts:125`
- **Problem:** Three (per rounds 1 and 3; round 1 also notes a fourth at ai-proxy/telemetry.ts) package-level UUID/ID generators independently implement crypto.randomUUID-first logic with ad-hoc fallbacks: research-stream's randomUuid() (full RFC4122 v4), worker-http's newRequestId() (req_ prefix + Date.now/Math.random), and orchestrator's newId() (minimal fallback). Fallback paths diverge in UUID quality and standards-compliance, and @ollie/crypto exists but does not export UUID generation. This is the package-level counterpart to the module-repo newId() duplication.
- **Fix:** Export from @ollie/crypto (or a new @ollie/uuid) two functions: uuid() for spec-compliant v4 (use research-stream's implementation as the base) and shortId(prefix?) for prefixed request/record IDs. Update worker-http to shortId('req_'), orchestrator and research-stream to uuid(), and the ai-proxy telemetry call site.

### [HIGH] Unsafe `as unknown as ModuleHandler<Module>` casts in module registry
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:94-109`
- **Problem:** Each module handler (grocery, pets, finance, etc.) is cast through `as unknown as ModuleHandler<Module>` to fit a homogeneous Record<Module, ModuleHandler<Module>> registry. This discards specific handler type information and hides structural mismatches between concrete handler types and the generic registry constraint until runtime.
- **Fix:** Use a `satisfies Record<Module, ModuleHandler<Module>>` constraint or a type-safe registry builder/common supertype so handlers conform without the double-cast, preserving compile-time shape checking.

### [HIGH] API client casts response to generic T without runtime validation
- **Files:** `/Users/serrayildirim/ollie/packages/api/src/client.ts:194`, `/Users/serrayildirim/ollie/packages/api/src/client.ts:199`
- **Problem:** The api client casts responses to the generic type T without validation. When parseJson is false, response text is cast via `(await res.text()) as unknown as T`; when true, `(await res.json()) as T` is used directly. A mismatched server shape (or arbitrary text) silently flows to callers typed as T with no guarantee it matches.
- **Fix:** Add runtime validation (e.g. Zod schema or a validator callback parameter) before casting, or return text as string for the parseJson=false path and let callers parse. Constrain T to validatable types for high-risk endpoints.

### [HIGH] Theme tokens cast `as unknown as Record<...>` in tokensToCssVars bypasses type safety
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:208-225`, `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:370-382`
- **Problem:** Design tokens (palette, fonts, fontSizes, fontWeights) are cast through `as unknown as Record<string, string|number>` for CSS variable serialization. The double cast hides token shape mismatches; if a token type changes or contains an unexpected value it passes through silently into CSS variables.
- **Fix:** Define overloaded/strict writeGroup signatures per token type (Record<string,string> vs Record<string,number>) or use Object.entries with explicit narrowing to eliminate the unsafe `as unknown` bridge.

### [HIGH] Fire-and-forget Vectorize cache operations silently inflate AI cost with no alerting
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-269`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:303-305`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:361-371`
- **Problem:** Vectorize cacheLookup, cacheHitBump, and cacheUpsert are spawned via keepAlive/Promise.all with only a .catch that console.errors and (for lookup) returns null. A lookup failure falls through to a cache miss, silently triggering full AI calls; an upsert failure prevents future caching. There is no metric, alert, or circuit breaker, so a Vectorize outage produces a 100% miss rate that quietly multiplies token spend. If the worker terminates before waitUntil drains, the error log itself can be lost.
- **Fix:** Add Sentry/metric instrumentation to the fire-and-forget catch handlers so persistent Vectorize failures surface an alert instead of silently inflating cost. Track consecutive cache failures and emit a degradation signal (e.g. cache_errors count in response telemetry) so the client/operator can detect it. Keep fail-open routing on miss.

### [HIGH] RoutingSummary.pass2Triggered present in worker output but absent from native schema
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:415`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:58`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:99-104`, `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts:112`
- **Problem:** The worker always emits pass2Triggered in the summary object (dump.ts:415, declared in dump-schema.ts:58), but the native client RoutingSummary (schema.ts:99-104) defines only moduleCount, cacheHitRate, aiCalls, durationMs — no pass2Triggered. The worker test (dump.test.ts:112) also omits it from its assertion. Not a runtime crash (extra JSON fields are ignored in JS), but it is real schema drift: the contract documentation diverges and the client cannot type-safely access the telemetry. Verified in both schema files.
- **Fix:** Pick one direction and make it consistent across all three surfaces: either add pass2Triggered: number to the native RoutingSummary (if the client should surface pass-2 trigger telemetry), or remove it from the worker output and dump-schema.ts. Update workers/ai-proxy/tests/dump.test.ts to match whichever is chosen.

### [HIGH] Fragment.needsConfirm required in worker schema but optional in native schema
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:49`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:91`
- **Problem:** The worker Fragment schema declares needsConfirm as a required boolean (dump-schema.ts:49) and applyConfidencePolicy (dump-schema.ts:67-89) always populates it. The native Fragment schema declares it optional — needsConfirm?: boolean (schema.ts:91). The contracts disagree: the server always sends the field but the client types it as possibly-undefined, weakening type safety for consumers that validate worker responses against the native schema. Verified in both files.
- **Fix:** Make both required, since applyConfidencePolicy always computes a value. Change native schema.ts:91 to needsConfirm: boolean; and confirm any client checks handle the false case (low-confidence confirmed route) as well as true.

### [HIGH] enriched_signals INSERT has no idempotency guarantee (no unique constraint on dump_id, plain POST without upsert)
- **Files:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-365`, `/Users/serrayildirim/ollie/supabase/migrations/20260514000002_enriched_signals.sql:13-28`, `/Users/serrayildirim/ollie/workers/cron/wrangler.toml:58-63`
- **Problem:** processOne() writes raw_dumps via an idempotent UPSERT (on_conflict=id, prefer=resolution=merge-duplicates) but writes enriched_signals via a plain POST with prefer='return=minimal' and no on_conflict handling. The enriched_signals table itself has only an FK on dump_id (REFERENCES raw_dumps(id)) and no UNIQUE constraint on dump_id. If a crash, network timeout, or Postgres connection drop occurs between the raw_dumps upsert succeeding and the enriched_signals write completing (before the KV/queue entry is cleared), the retry re-runs both writes: raw_dumps merges safely, but enriched_signals creates a duplicate enrichment row for the same dump_id. This pollutes the primary B2B revenue table and skews analytics signal counts. This is true for both the legacy KV-prefix queue path (q:enrich:*, used while the Cloudflare Queues consumer is commented out in wrangler.toml) and, once provisioned, the Queues path — handleEnrichQueueBatch still calls the same unprotected insertEnrichedSignal(). The in-code comment claiming the write 'either fully succeeded or fully failed' does not hold for partial/mid-write failures. Verified: insertEnrichedSignal posts with prefer:'return=minimal' only; the migration defines no unique index on dump_id.
- **Fix:** Add a UNIQUE constraint on enriched_signals(dump_id) and change insertEnrichedSignal() to UPSERT (POST with on_conflict=dump_id + prefer=resolution=merge-duplicates), matching the raw_dumps pattern. Resolve this before uncommenting the Cloudflare Queues consumer binding, and test idempotency by simulating a crash after the raw_dumps upsert succeeds on both the KV-prefix and Queues paths.

### [HIGH] TodayNoticings kicker + affordance labels hardcoded English
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147`, `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:179`, `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:186`
- **Problem:** The noticings surface renders three hardcoded English strings on every card: 'worth a glance' kicker, 'not now' postpone button, 'dismiss' button. The component already has lang via useAppLang() (line 68) but does not apply it. Highest severity assigned by R3 (high).
- **Fix:** Create a trilingual lookup table for these three strings and select by the already-available lang from useAppLang().

### [HIGH] NotifyPrimeLine notification prompt + button labels hardcoded English
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49`, `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:127`, `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:135`
- **Problem:** The default permission prompt ('allow ollie to send quiet reminders?') and the 'allow' / 'not now' buttons are hardcoded English. R3 notes a sibling instance in FocusTimer using 'allow ollie to ping you when a session ends?'. ES/TR users see English prompts. Highest severity assigned by R3 (high).
- **Fix:** Move labels to a trilingual table, thread useAppLang into NotifyPrimeLine, and select by language; apply the same pattern to FocusTimer.

### [HIGH] MicButton mic/error/status messages + aria-labels hardcoded English
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:71`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:81-84`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:116`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:124-126`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:206`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:210`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:216-217`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:239`
- **Problem:** MicButton displays hardcoded English error/status messages ('this app build can't reach the microphone', 'mic blocked — allow microphone access in System Settings', 'no microphone found', 'not signed in', 'heard nothing — try again', 'transcribe failed'), the recording overlay label 'listening… just pause when you're done', 'transcribing…', plus aria-labels 'Stop recording' / 'Record a voice note' and title 'speak your dump'. Rounds split the error messages vs display labels but they are the same component. Highest severity assigned (high).
- **Fix:** Extract all MicButton strings (errors, status, overlay label, aria-labels, title) into a trilingual map keyed by language via useAppLang, following the FALLBACK pattern in @ollie/logic/brain/copy.ts.

### [HIGH] PhotoIntake error messages + aria-labels + status text hardcoded English
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:273-274`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:317`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:376`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:433`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:438`
- **Problem:** The reasonCopy function returns English-only validation errors ('This kind of photo isn't supported yet.', 'Photo is too large, try a smaller one.', 'Couldn't read that photo — try another.') and the component has hardcoded English aria-labels ('Attach a photo', 'Remove photo', 'Attached PDF', 'Remove PDF') and status text ('reading…'). R2/R3 cited the error fn; R1 cited the aria-labels/status — same component, same root problem. Highest severity assigned (high).
- **Fix:** Convert reasonCopy to accept AppLang and return localized messages; thread lang through usePhotoIntake and localize all aria-labels and status strings via a trilingual map.

### [HIGH] json-cascade.ts provider fallback chain has zero tests
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts (lines 55-122)`
- **Problem:** The jsonCascade() function orchestrates the free-tier provider fallback chain (Groq -> Cloudflare -> Gemini -> OpenRouter) and is the mechanism that prevents a single Groq json_validate_failed from silently collapsing a multi-topic dump to one fragment (dogfood B3, 2026-06-05). It is called by both pass2Split (segmentation-llm) and classifyFragment (dump-classify), yet has no unit test file. A regression where a parse() rejection doesn't advance the chain, lastErr isn't threaded so the wrong error bubbles up, or empty/truncated content doesn't trigger fallthrough would silently degrade routing quality and cause data loss with no test signal.
- **Fix:** Add tests/json-cascade.test.ts covering: (1) first provider succeeds -> returns immediately, others not called; (2) first provider throws -> next provider called and succeeds; (3) parse() rejects first output -> advances to next provider; (4) all providers throw -> the LAST error bubbles up (not the first); (5) empty/truncated content triggers fallthrough; (6) provider-subset chains (groq-only, groq+cf) from conditional env pushes; (7) label/logging side-effect on fallthrough.

### [HIGH] pass1Segment (Pass 1 segmentation) has zero unit tests
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts (lines 53-82, helpers 89-103)`
- **Problem:** pass1Segment is foundational to the brain-dump pipeline: it splits dump text into sentence fragments and flags items needing pass-2 LLM segmentation via the Decision A heuristic (words > 7, OR words > 4 with no conjunction and no terminal punctuation). It runs on every dump but has no unit test file. Complex untested logic includes trilingual conjunction re-splitting (TR/EN/ES), word counting, word-count threshold boundaries, the Intl.Segmenter fallback regex path, and regex.lastIndex/global-flag resets. It is only exercised indirectly through dump/route integration tests, so the unit behavior is never directly asserted.
- **Fix:** Add tests/segmentation.test.ts covering: (1) basic sentence splits; (2) conjunction re-splitting in all three languages; (3) word-count boundary cases (4,5,6,7,8 words) around the needsPass2 threshold; (4) edge cases: empty string, single word, punctuation-only, very long sentence; (5) Intl.Segmenter fallback regex path; (6) regex.lastIndex reset behavior; (7) locale fallback.

### [HIGH] detectFragmentLanguage (lang-detect) has zero unit tests
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts (lines 19-45, 116-166)`
- **Problem:** detectFragmentLanguage runs on every fragment after pass-2 and classifies text as tr/en/es/mixed/unknown using stopword density + diacritic scoring with a MIXED_THRESHOLD (0.25) and a fallback to 'en' for unanchored Latin text. It has no unit tests. Untested branches: pure-language detection per language, mixed-language stopword collisions (e.g. 'a' is both EN and ES), all-diacritic text, exact MIXED_THRESHOLD boundary, diacritic bump amounts, no-signal -> unknown vs en fallback, and empty/single-word/punctuation-only input. The output drives telemetry labels and potentially routing context.
- **Fix:** Add tests/lang-detect.test.ts covering: (1) pure TR (stopwords+diacritics), EN, ES; (2) mixed-language at the 0.25 threshold boundary; (3) no-signal input -> correct unknown/en fallback; (4) diacritic bumps at edge amounts; (5) edge cases: empty string, single word, punctuation-only, unanchored Latin text.

### [HIGH] pass2Split (segmentation-llm Pass 2) has zero unit tests
- **Files:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts (lines 33-56)`
- **Problem:** pass2Split wraps jsonCascade to run LLM-driven re-splitting on fragments flagged by pass1Segment's Decision A heuristic, validating the expected { fragments: string[] } shape and trimming/filtering results. It has no unit tests. Untested: valid response parsing, output trim/filter, shape validation rejecting non-arrays and arrays of non-strings, empty-array and single-element results, large arrays, per-fragment max-length constraints, and error messages capturing the offending provider and a snippet of bad JSON.
- **Fix:** Add tests/segmentation-llm.test.ts covering: (1) mock jsonCascade returns valid { fragments: [...] }; (2) trimming and filtering of results; (3) shape validation rejects non-array and array-of-non-strings; (4) empty array and single fragment; (5) large array; (6) malformed/missing JSON escalates with a useful error; (7) provider 429/503 escalates through the cascade.

### [HIGH] React type version mismatch between @ollie/store and apps/native
- **Files:** `/Users/serrayildirim/ollie/packages/store/package.json:18`, `/Users/serrayildirim/ollie/packages/store/package.json:21-22`, `/Users/serrayildirim/ollie/apps/native/package.json:32`, `/Users/serrayildirim/ollie/apps/native/package.json:38`
- **Problem:** @ollie/store pins react ^18.3.1 and @types/react ^18.3.12 (resolves to 18.3.28) in devDependencies, and its peerDependencies allow react >=18. But apps/native consumes the store while using react ^19.1.0 (resolves to 19.2.6) and @types/react ^19.1.8 (resolves to 19.2.15). Since store exports a React hook entry (./react) that uses React types, consumers on React 19 may hit type mismatches: store is developed/tested against React 18 types while consumers run React 19. Both React versions are installed in node_modules, risking double-loading and subtle type errors in hook consumption (e.g. useStoreSlice).
- **Fix:** Update @ollie/store devDependencies to react ^19.1.0 and @types/react ^19.1.x to match the version consumers actually run, and tighten/clarify peerDependencies to explicitly support React 19. This aligns store's test-time types with the runtime React used by apps/native.

### [MEDIUM] Finance merge casts FinanceRecord to `Record<string, unknown>` for dynamic key assignment
- **Files:** `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`
- **Problem:** FinanceRecord is cast through unknown to `Record<string, unknown>` to perform a dynamic key assignment in the merge loop, bypassing type safety. Unexpected keys/values can be silently copied into the financial record.
- **Fix:** Use type-safe assignment, e.g. iterate with Object.entries and narrow keys via `out[k as keyof FinanceRecord] = v` after a null/undefined guard, or use Object.assign with properly-typed Partial<FinanceRecord>.

### [MEDIUM] NeedsConfirmCard hardcoded English text + aria-labels
- **Files:** `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:60`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:72`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:78`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:95`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:109`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:113`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:127`
- **Problem:** The routing confirmation card renders hardcoded English visible strings ('photo' badge, 'not sure · confirm?' kicker, 'keep', 'undo') plus English aria-labels ('From your photo', 'Keep this routing', 'Undo this routing'). None are localized to ES/TR. Multiple rounds split the visible text vs aria-labels into separate findings, but it is the same component and root problem.
- **Fix:** Pass lang: AppLang as a prop (or read via useAppLang if converted to a hook) and use a trilingual lookup table for all visible labels and aria-labels.

### [MEDIUM] TypeScript version drift across workspace - both 5.8.3 and 5.9.3 installed
- **Files:** `/Users/serrayildirim/ollie/apps/native/package.json:42`, `/Users/serrayildirim/ollie/packages/store/package.json:23`
- **Problem:** apps/native pins typescript ~5.8.3 while the rest of the workspace (root and packages/*) uses ^5.6.0, which resolves to 5.9.3 in the lock file. As a result two TypeScript copies (5.8.3 and 5.9.3) are installed. This bloats the install and can cause subtle type-checking inconsistencies between the native app and the workspace packages it builds against.
- **Fix:** Unify TypeScript across the workspace to a single version. Either align apps/native to the workspace's ^5.6.0 (so it also resolves to 5.9.3), or bump everything to a common ^5.8.x. If the tighter native pin is intentional for Tauri build stability, use ^5.8.0 as a middle ground applied workspace-wide.

## Full detail by dimension

### Security & Authorization — 11 issue(s)

- **[critical·conf 2/3]** IDOR: telemetry endpoints verify JWT but never pass userId to handlers, which trust client-supplied user_hash / row.user_id
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-224`
  - The /enrich-dump, /ingest-event, and /label router branch verifies the JWT and derives the authenticated userId (index.ts line 324), but never passes that userId into handleEnrichDump or handleIngestEvent (lines 336-342 call them with only (req, env)). Verified against source. As a result: handleEnrichDump (telemetry.ts 91-159) queues a brain-dump into the shared KV namespace (q:enrich:*) using a fully client-controlled body.user_hash with no ownership check, letting an attacker with any valid JWT poison the enrichment queue (drained by cron into raw_dumps/enriched_signals) as another user; and handleIngestEvent (telemetry.ts 168-224) forwards a client-supplied body.row straight to Supabase REST INSERT using the service-role key (bypassing RLS), letting an attacker forge retention_events, session_events, module_events, or crisis_events for any user_id. Round 2 also flags this design as fragile defense-in-depth: a future handler/endpoint added to the router could be reached without the auth re-check.
  - Fix: Thread the verified userId from the router into handleEnrichDump and handleIngestEvent. In handleEnrichDump, derive the correct user_hash server-side from the verified userId (and VITE_USER_HASH_SALT) and ignore/compare the client value, rejecting on mismatch. In handleIngestEvent, validate body.row.user_id === userId (or the table-specific owner column) before INSERT. Add a redundant ownership assertion inside each delegated handler so a router refactor cannot silently drop the check (defense-in-depth); consider a SECURITY.md invariant plus a lint rule for new endpoints.
- **[high·conf 3/3]** CORS Access-Control-Allow-Origin '*' exposes all worker endpoints to any origin
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131`
  - The worker returns 'Access-Control-Allow-Origin': '*' on every CORS preflight/response (corsHeaders, lines 124-131, applied via withCors()). Any website can therefore make cross-origin requests to the worker. Round 1 and 2 rate this high-impact because it compounds the telemetry IDOR holes: a malicious page could craft Authorization headers and user_hash values to poison or exfiltrate telemetry for any user with a leaked/stolen session token. Round 3 notes the auth checks are a strong mitigation (sensitive endpoints require JWT or shared secret) but agrees the wide policy plus missing security headers (no X-Content-Type-Options, Referrer-Policy, HSTS) enlarges the auth-bypass / confused-deputy attack surface affecting all users at once.
  - Fix: Restrict Access-Control-Allow-Origin to an allowlist of trusted origins (e.g. ollie.app, platform.ollie.app, the Electron/Capacitor app origins); validate the incoming Origin header and echo back only on match. Fetch the allowed list from env for dev/staging. Add defense-in-depth security headers (X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, Strict-Transport-Security). Document the trust model for who may call the worker.
- **[high·conf 2/3]** verifyJwt dual-mode Supabase fallback returns null on service errors and skips issuer validation
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:364-400`
  - verifyJwt tries Clerk first, then falls back to legacy Supabase auth. Two related root problems in the same fallback: (1) Round 1 -- the fallback returns null on missing SUPABASE_URL/ANON_KEY, non-ok response, and any caught exception, so 'service error / config drift' is indistinguishable from 'invalid token', masking config issues and network failures during the migration window. (2) Round 2 -- the Supabase fallback calls GET /auth/v1/user without validating the JWT's iss claim, so a token signed by a different/legacy Supabase instance (or a leaked cross-environment session token) could be accepted if Supabase is misconfigured. Both are facets of an under-hardened fallback path.
  - Fix: Distinguish token-invalid (return null) from service-error (throw/log + emit a metric) and log a dedicated line whenever the fallback path executes so operators can watch the migration window. After /auth/v1/user succeeds, validate the iss claim matches the expected Supabase issuer URL. Set and enforce a sunset date to remove the Supabase fallback once legacy sessions age out.
- **[high·conf 2/3]** T0_JWT_ENFORCED dev gate accepts spoofable x-user-id and relies on implicit fail-closed default
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:217-230`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:140-161`
  - Auth gates across the router (e.g. /route/:module route.ts 217-230, /feed-me/:user feed-me.ts 140-161, plus /route/dump and /purchase) use the pattern `if (env.T0_JWT_ENFORCED !== '0')`, so any value except literal '0' enforces JWT -- fail-closed, which both rounds agree is the right posture. The concern is two-fold and shared: (a) when the flag is set to '0' the endpoint authenticates purely from an unsecured, spoofable x-user-id header, so a misconfigured '0' in staging/prod lets an attacker impersonate any user_id and receive their personalized AI output; (b) the safe default is implicit (unset = enforce) and the inverted `!== '0'` sense is fragile/confusing under refactor. Round 1 found feed-me functionally correct but confusing; Round 2 rated the route.ts open-mode spoofing high.
  - Fix: Treat dev mode as the explicit special case: gate it on `T0_JWT_ENFORCED === '0'` with a loud comment ('DEV ONLY: x-user-id is spoofable'), and add a deploy-time assertion that production never ships with the flag set to '0'. Document each flag's default (ENABLED) and lifecycle in the Env type, and log the resolved value at startup. Consider removing the open-mode fallback entirely now that Clerk is deployed.
- **[high·conf 1/3]** STAGING_TEST_BEARER backdoor can bypass Clerk JWT verification with no production guard
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:123`
  - In /route/dump, if env.STAGING_TEST_BEARER is set and the request bearer matches it, the request authenticates as STAGING_TEST_USER_ID without any Clerk verification. Comments claim it is staging-only, but nothing technically prevents the secret from being configured in production. A leaked or misconfigured STAGING_TEST_BEARER would let any caller authenticate as the staging test user and reach /route/dump.
  - Fix: Add an explicit guard that throws if STAGING_TEST_BEARER is present on a production environment, or move the bypass into staging-only code paths excluded from the prod build. Ensure no production deployment has the secret set.
- **[medium·conf 1/3]** Missing rate-limit enforcement on public shelf-life endpoints when caller id is null
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:258-303`
  - The unauthenticated /shelf-life/all and /shelf-life/lookup/:item endpoints only run checkRate when resolveUserIdForRateLimit() returns a non-null value (lines 264-274, 285). If it returns null, the rate-limit branch is skipped entirely, so a caller that omits x-user-id and has a missing/varying IP is never throttled, enabling cache-burning abuse.
  - Fix: Make resolveUserIdForRateLimit always return a non-null key (fall back to 'anon' or a per-request bucket), or rate-limit all shelf-life requests under a fixed 'shelf-life-public' bucket for unauthenticated callers regardless of resolved id.
- **[medium·conf 1/3]** Service-role Supabase REST calls in invites lack HTTPS/protocol-downgrade validation
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:107-108`
  - Invite handlers send the Supabase service-role key in apikey and Authorization headers to URLs built from env.SUPABASE_URL with user-controlled input (invitation codes) in query params. There is no startup validation that SUPABASE_URL is HTTPS-only, so a misconfigured or downgraded URL could expose service-role credentials.
  - Fix: Validate SUPABASE_URL is HTTPS at startup and reject protocol downgrade; properly encode user-controlled query parameters. Consider using the Supabase admin SDK instead of raw REST for better encapsulation.
- **[medium·conf 1/3]** Invite endpoints accept inviter_user_hash / invitee_user_hash without format validation
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:75-76`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:219-220`
  - /generate-invite and /claim-invite only check that inviter_user_hash and invitee_user_hash are non-empty strings, accepting arbitrary opaque values. Malformed hashes could cause unexpected behavior or information leakage in downstream queries that rely on the hash to scope/de-anonymize invitations.
  - Fix: Enforce the expected hash format (e.g. 64-char SHA-256 hex or fixed-length base64) -- validate length and character set before use.
- **[medium·conf 1/3]** Account deletion endpoint has no rate limiting on retries
  - Files: `/Users/serrayildirim/ollie/apps/api/src/account-delete.ts:134-256`
  - handleAccountDelete verifies JWT and confirm token but is not gated behind a rate limiter. A holder of a valid JWT can rapidly retry the endpoint, risking resource exhaustion or race conditions during the cascade delete.
  - Fix: Add per-user rate limiting (e.g. 1 attempt / 5 min per user_id) using the existing rate-limiter binding or a dedicated bucket.
- **[medium·conf 1/3]** Telemetry tables lack explicit service_role grants in migrations
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260514000001_raw_dumps.sql:45-49`
  - raw_dumps, enriched_signals, retention_events, session_events, module_events, and crisis_events run `revoke all from anon, authenticated` and enable/force RLS but have no explicit `grant insert,select,update,delete ... to service_role`. Writes currently work via implicit grants, but the authorization intent is unclear and would silently break if table ownership or role hierarchy changes. research_corpus (20260514000012_research_corpus.sql:69) sets the explicit-grant precedent.
  - Fix: Add explicit `grant insert, select, update, delete on public.<table> to service_role;` for all 6 telemetry tables, immediately following each `revoke all` line.
- **[low·conf 1/3]** Shared telemetry rate-limit bucket lets /ingest-event spam high-cardinality tables
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343`
  - /enrich-dump, /ingest-event, and /label share one per-user bucket (`rl:telemetry:${userId}`, ~10 req/min). Because /ingest-event accepts any of 5 tables (including high-volume module_events/session_events) while the other endpoints have fixed-cost payloads, the shared bucket creates asymmetry -- a user can spam flexible writes within the pooled limit. Defense-in-depth, not a correctness bug.
  - Fix: Give /ingest-event its own bucket (`rl:ingest:${userId}`) and/or add per-table write quotas inside handleIngestEvent to bound high-cardinality tables.

### Secrets & Token Exposure — 4 issue(s)

- **[high·conf 1/3]** Raw unscrubbed user input logged in worker dump telemetry
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:387`
  - The /route/dump handler logs up to 120 chars of the raw combinedDump (pre-PII-scrub) to Cloudflare worker logs. combinedDump may contain unfiltered PII (names, emails, phone numbers, medical info) that scrubPII() removes into cleanDump — but the telemetry log uses combinedDump, not cleanDump. Verified at line ~387: 'input: combinedDump.slice(0, 120)'. Note: the same console.log also logs fragment text via 'f.text.slice(0, 60)', which is likewise derived from raw (unscrubbed) input and should be checked.
  - Fix: Replace 'input: combinedDump.slice(0, 120)' with 'input: cleanDump.slice(0, 120)'. Audit every field in this console.log (including the per-fragment 'text' slices) to ensure only PII-scrubbed text is ever logged, never raw combinedDump-derived strings.
- **[medium·conf 1/3]** Partial device push token logged to console in capacitor backend
  - Files: `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:277`
  - When no push-register worker endpoint is configured, the capacitor backend logs the first 12 chars of the device token plus an ellipsis. Device tokens are sensitive routing identifiers that could be correlated with user activity; even truncated, the prefix is exposed in logs. Verified: console.log('[notify · capacitor] device token captured (no worker endpoint set):', t.slice(0, 12) + '…'). This is a fallback path that should only run in development.
  - Fix: Remove the log or gate it behind import.meta.env.DEV. If debugging is needed, hash the token rather than logging a raw prefix, ensuring it never appears in production logs.
- **[low·conf 2/3]** Secrets in gitignored .env.local (Sentry DSN + Supabase anon key)
  - Files: `/Users/serrayildirim/ollie/.env.local:8`, `/Users/serrayildirim/ollie/.env.local:13`
  - Production/dev credentials are stored in .env.local: the VITE_SENTRY_DSN (line 8) and the SUPABASE_ANON_KEY JWT (line 13), plus worker URLs. The file is correctly gitignored and never committed. The Sentry DSN is intentionally public (it carries only the public key plus org/project IDs), and the Supabase anon key is the public client role key — neither is a true server secret. The remaining residual risk is local developer-machine compromise, not repo exposure. Verified: file header reads '# ollie · local secrets. Git-ignored. Do not commit.'
  - Fix: No code change needed; .gitignore protection is already correct and a Sentry DSN is designed to be public. Optionally document in CONTRIBUTING.md / onboarding that .env files are sensitive and must not be shared. If a developer machine is ever known to be compromised, rotate the keys.
- **[low·conf 1/3]** Real API keys in gitignored .env and worker .dev.vars
  - Files: `/Users/serrayildirim/ollie/.env:4`, `/Users/serrayildirim/ollie/.env:5`, `/Users/serrayildirim/ollie/workers/ai-proxy/.dev.vars:1`
  - Real third-party API keys live in local dev files: VOYAGE_API_KEY and GEMINI_API_KEY in .env (used by router build scripts), and GROQ_API_KEY in workers/ai-proxy/.dev.vars (used by Wrangler local dev). Verified all three present. Both files are properly gitignored, so there is no repo exposure — the residual risk is developer-machine compromise. (Note: per project memory, these specific Voyage/Gemini/Groq keys have been flagged as chat-exposed and are already queued for rotation at beta-launch gate.)
  - Fix: Keep the .gitignore protection (already correct). Rotate these keys at the planned pre-launch rotation gate and immediately if any dev machine is known compromised. Document key-regeneration steps in the worker/router README (e.g. Groq via console.groq.com → API Keys).

### Input Validation — 11 issue(s)

- **[critical·conf 1/3]** Gemini API key exposed in URL query string
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:55`
  - The Gemini API key is passed as a URL query parameter (`...:generateContent?key=${geminiKey}`), which gets recorded in HTTP request logs, Cloudflare access logs, and potentially cached by proxies. This exposes the secret in plaintext across infrastructure and violates API key handling best practices.
  - Fix: Move the API key out of the URL into the Authorization header (Authorization: Bearer ${geminiKey}) or the request body.
- **[high·conf 2/3]** Missing size/bounds validation on body.row object in /ingest-event
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-208`
  - The /ingest-event endpoint accepts an arbitrary body.row object (Record<string, unknown>) with minimal validation — only that it is an object and not an array — then forwards it directly to Supabase REST via JSON.stringify(body.row) with no size limit. An attacker can send a multi-megabyte or deeply nested object, consuming worker memory/bandwidth before any schema validation and potentially causing OOM crashes or DoS.
  - Fix: Add a size check before stringify/forward: const rowStr = JSON.stringify(body.row); if (rowStr.length > 65536) return json({ error: 'row_too_large' }, 400). For known event tables, optionally whitelist allowed column names and validate field types.
- **[high·conf 1/3]** Unsafe parseFloat on budget env/KV values without bounds validation
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:137-140`
  - parseFloat is called on KV-retrieved usage values and the DAILY_LABEL_BUDGET_USD environment variable without finiteness or bounds checking. A corrupted or maliciously injected KV value yields NaN/Infinity, silently bypassing the cost cap or producing incorrect budget calculations.
  - Fix: Validate parseFloat results with Number.isFinite() and clamp to expected ranges, e.g. const used = usedRaw ? Math.max(0, parseFloat(usedRaw) || 0) : 0; and reject non-finite budget values.
- **[high·conf 1/3]** No request body size limit on /brain-dump and /v1/messages endpoints
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:389`
  - The /brain-dump and /v1/messages endpoints read the entire request body via req.text() with no size validation, then hash and cache the payload. An attacker can send arbitrarily large payloads to consume worker memory/CPU and pollute the cache, risking OOM or DoS, since Cloudflare Workers do not enforce a strict request body limit by default.
  - Fix: Check body size before processing: const MAX_BODY_BYTES = 1024 * 1024; if (bodyText.length > MAX_BODY_BYTES) return withCors(json({ error: 'body_too_large' }, 413)).
- **[high·conf 1/3]** Missing maximum text length validation in /route/dump
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:148-157`
  - The /route/dump endpoint accepts body.text without validating its maximum length. An attacker can send a 10+ MB text value that is then processed through segmentation, embedding, and classification, exhausting worker memory, hitting API rate limits, and burning budget on Voyage/Groq/Gemini. The image field has a MAX_IMAGE_BYTES guard but text has none.
  - Fix: Add a MAX_TEXT_BYTES constant (1-2 MB) and validate body.text.length before segmentation, returning 413 Payload Too Large when exceeded, mirroring the existing image size check.
- **[medium·conf 1/3]** Non-atomic daily-budget cost tracking race condition in /label
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:135-144`
  - The daily label budget uses a non-atomic KV read-then-write. Concurrent requests each read the same used value and write back, so concurrent spend can exceed the daily budget. Although the endpoint fails open (503), budget enforcement is effectively broken under concurrency.
  - Fix: Use Durable Objects or a dedicated atomic counter for increments; alternatively check budget before the expensive call with a separate in-flight 'pending' counter, or explicitly document that the cap is best-effort and remove the false impression of hard enforcement.
- **[medium·conf 1/3]** Unsafe parseInt on legacy KV rate-limit counter
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:467`
  - parseInt(raw, 10) returns NaN on a corrupted/non-numeric KV value, which then collapses to 0 via `|| 0`, resetting the rate-limit counter and allowing limit bypass. The same pattern appears in invites.ts.
  - Fix: Validate the parsed integer: const parsed = parseInt(raw, 10); const count = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0.
- **[medium·conf 1/3]** Unvalidated body.text length in /route/:module handler
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-249`
  - The generic /route/:module handler accepts body.text as a string without any maximum length validation. An attacker can send a multi-megabyte string, consuming worker memory and forcing expensive embedding/classify operations.
  - Fix: After parsing, enforce a length bound: if (typeof body.text !== 'string' || body.text.length > 100000) return json({ error: 'text_too_long' }, 400).
- **[medium·conf 1/3]** Path parameter module name not length-validated in /route/:module
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:366-370`
  - The /route/:module path parameter is extracted via regex and passed to handleRoute without a length check. Although handleRoute validates the module against MODULE_CONFIGS, an arbitrarily long module string (64KB+) is still parsed and logged before rejection.
  - Fix: Add a length guard on the extracted module name before dispatch: if (module.length > 64) return withCors(json({ error: 'invalid_module' }, 400)).
- **[low·conf 2/3]** Unvalidated excludeDishes array size in /feed-me endpoint
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466`
  - The excludeDishes array is validated per-item (each string capped at PANTRY_MAX_ITEM_LEN, 100 chars) but the array length itself is never capped. A client can send excludeDishes with thousands of items, each passing the trim().length check, inflating the Gemini prompt context, wasting tokens, and consuming memory.
  - Fix: Add a maximum array-length check before the loop, e.g. if (b.excludeDishes.length > 50) return { error: 'exclude_dishes_too_large' }; choose a realistic limit (5-20 items typical).
- **[low·conf 1/3]** Unvalidated anthropic-beta header forwarded upstream
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:411-412`
  - The anthropic-beta header is read from the incoming request and forwarded to Anthropic's API without validation. Injection risk is limited since Anthropic controls the endpoint, but a malformed value violates defense-in-depth and could cause unexpected behavior or mislogging.
  - Fix: Validate the header against an allowlist of supported beta strings before forwarding, e.g. const ALLOWED_BETAS = new Set(['prompt-caching-2024-07-31']); only forward when beta is in the set.

### Reinvented Wheels & Duplication — 14 issue(s)

- **[high·conf 3/3]** Centralized UUID/request-ID generation missing across packages (research-stream, worker-http, orchestrator)
  - Files: `packages/research-stream/src/index.ts:338-349`, `packages/worker-http/src/index.ts:65-73`, `packages/orchestrator/braindump-dispatch.ts:312-317`, `workers/ai-proxy/src/telemetry.ts:125`
  - Three (per rounds 1 and 3; round 1 also notes a fourth at ai-proxy/telemetry.ts) package-level UUID/ID generators independently implement crypto.randomUUID-first logic with ad-hoc fallbacks: research-stream's randomUuid() (full RFC4122 v4), worker-http's newRequestId() (req_ prefix + Date.now/Math.random), and orchestrator's newId() (minimal fallback). Fallback paths diverge in UUID quality and standards-compliance, and @ollie/crypto exists but does not export UUID generation. This is the package-level counterpart to the module-repo newId() duplication.
  - Fix: Export from @ollie/crypto (or a new @ollie/uuid) two functions: uuid() for spec-compliant v4 (use research-stream's implementation as the base) and shortId(prefix?) for prefixed request/record IDs. Update worker-http to shortId('req_'), orchestrator and research-stream to uuid(), and the ai-proxy telemetry call site.
- **[high·conf 2/3]** Multiple exponential-backoff retry implementations (api/client vs sync/retry)
  - Files: `packages/api/src/client.ts:222-250`, `packages/sync/src/retry.ts:90-154`
  - Two implementations of exponential-backoff retry exist: api/client.ts executeWithRetry (base_delay * 2^attempt) and sync/retry.ts createBackoffScheduler (Math.min(maxDelay, base * 2^attempt) with maxAttempts cap and exhausted flag). Rounds 2 and 3 disagree on disposition: round 2 argues this is intentional separation (HTTP request retry vs sync drain scheduling, with sync/retry.ts comments acknowledging the prior consolidation was only for hand-rolled sync clients) and recommends no action beyond documentation; round 3 treats it as a single-source-of-truth violation and recommends unifying onto the more complete sync/retry.ts scheduler. Severity kept at high (round 3's assignment).
  - Fix: Decide intent explicitly. If unifying (round 3): extract a shared configurable backoff scheduler (the sync/retry.ts version is more complete) and have both consumers import it. If keeping separate (round 2): document in each module why HTTP-request retry and sync-drain scheduling remain independent, to prevent accidental future refactors. At minimum, add the clarifying comments.
- **[high·conf 1/3]** UUID generation logic duplicated across 16+ module repositories
  - Files: `apps/native/src/modules/goals/repo.ts:81-85`, `apps/native/src/modules/work/repo.ts`, `apps/native/src/modules/{sleep,pets,cycle,body,habits,admin,grocery,finance,medication,mood,archive}/repo.ts`
  - The newId() function with a crypto.randomUUID fallback (using Date.now/Math.random) is defined identically (only the prefix differs) in 16 module repositories: goals, sleep, pets, cycle, body, habits, admin, grocery, finance, work, medication, mood, and archive. Each module reimplements the same fallback logic instead of importing a shared utility.
  - Fix: Extract to a shared @ollie/crypto or @ollie/id utility exporting newId(prefix: string): string. Update all 16 repository files to import and use it.
- **[high·conf 1/3]** Duplicate mean() implementations across 4 locations
  - Files: `packages/logic/src/stats/index.ts:29-30`, `packages/logic/src/habits/helpers.ts:15`, `packages/logic/src/body/signals.ts:111`, `packages/cadence/src/index.ts:216`, `packages/logic/src/body/math.ts`
  - The mean() function is reimplemented 4 times: stats/index.ts (canonical), habits/helpers.ts, body/signals.ts, and cadence/index.ts. The stats module is intended as the single source of truth, but body/math.ts does not re-export mean, leading body callers to define their own.
  - Fix: Delete the mean() implementations from habits/helpers.ts, body/signals.ts, and cadence/index.ts; import from @ollie/logic/stats instead. Update @ollie/body/math.ts to re-export mean from stats to preserve the existing body import path.
- **[medium·conf 2/3]** Inline setTimeout sleep pattern instead of shared sleep() utility
  - Files: `workers/ai-proxy/src/gemini.ts:63`, `workers/ai-proxy/src/router/vision.ts:77`, `packages/api/src/client.ts:379-381`, `packages/research-stream/src/index.ts`
  - sleep() is defined privately in @ollie/api/client.ts (for its retry loop) and is implicitly re-needed elsewhere: research-stream's scheduleFlush uses inline setTimeout (round 1), and two ai-proxy workers (gemini.ts, router/vision.ts) reimplement `new Promise(r => setTimeout(r, ms))` inline rather than importing a shared helper (round 3). Both rounds flag the same root problem: no shared, exported sleep utility. Severity kept at medium (round 3's assignment).
  - Fix: Export sleep() from a shared location (@ollie/logic/src/util or a small @ollie/async module) and update @ollie/api, research-stream, and both ai-proxy workers to import it, so timeout behavior can be tuned in one place.
- **[medium·conf 1/3]** startOfDay() reimplemented in 3 separate locations
  - Files: `packages/logic/src/medication/index.ts:115-119`, `packages/notifications/src/budget.ts:47-51`, `apps/native/src/modules/brain/capacity.ts:106-110`
  - Identical local-midnight date logic is reimplemented as startOfDay (medication), startOfLocalDay (notifications/budget.ts), and startOfDayMs (brain/capacity.ts). Each package redefines this common date utility independently.
  - Fix: Export startOfDay() from @ollie/logic/src/util/index.ts (which already exports dayKey and other time utilities). Update the other two locations to import it.
- **[medium·conf 1/3]** newRequestId() in @ollie/worker-http duplicates UUID fallback pattern
  - Files: `packages/worker-http/src/index.ts:65-73`
  - newRequestId() is a package-level prefixed-UUID wrapper that duplicates the same crypto.randomUUID-with-Math.random fallback pattern as the module newId() functions rather than delegating to a shared utility. (Round 1 listed this as a distinct finding from the broader packages cluster; it overlaps the worker-http entry in the consolidated UUID issue above.)
  - Fix: After a shared UUID utility exists in @ollie/crypto, refactor newRequestId() to delegate to it (e.g. return `req_${shortId()}`), removing the local fallback.
- **[medium·conf 1/3]** Median function reimplemented in cadence module
  - Files: `packages/cadence/src/index.ts:206-214`, `packages/logic/src/stats/index.ts:37`
  - @ollie/cadence implements its own median() instead of importing the canonical median() from @ollie/logic/stats, which correctly handles even-length arrays. The module comment notes a prior bug where some median implementations returned the wrong element for even-length arrays, making divergence a real correctness risk.
  - Fix: Import median from @ollie/logic/stats in cadence and delete the local implementation.
- **[medium·conf 1/3]** Duplicated word-boundary regex helpers in admin and work constants
  - Files: `packages/logic/src/admin/constants.ts:5-18`, `packages/logic/src/work/constants.ts:15-18`
  - The word-boundary regex wrapper helpers/constants (_LEFT/_L, _RIGHT/_R, _wrap) used to build multilingual keyword-detection regexes are copy-pasted identically across admin/constants.ts and work/constants.ts.
  - Fix: Extract _LEFT, _RIGHT, and _wrap to packages/logic/src/util/regex-boundaries.ts and import them in both admin/constants.ts and work/constants.ts for consistent regex compilation.
- **[medium·conf 1/3]** createDebouncer() not broadly exported; per-key debounce likely to be reinvented
  - Files: `packages/sync/src/retry.ts:31-49`
  - sync/retry.ts exports a generic per-key createDebouncer(), and its comment notes both sync clients previously hand-rolled the same debounce. The pattern is generic enough that future modules outside @ollie/sync may reinvent it because there is no broadly discoverable shared debounce utility.
  - Fix: Promote createDebouncer to a discoverable shared export (document it in @ollie/sync's barrel, or extract a dedicated @ollie/debounce package) so other packages reuse it instead of re-implementing.
- **[low·conf 1/3]** isoTodayWork() reinvents dayKey() formatting
  - Files: `apps/native/src/modules/work/repo.ts:84-90`
  - isoTodayWork() manually formats the current date as YYYY-MM-DD in local time, exactly duplicating dayKey() from @ollie/logic/src/util/index.ts.
  - Fix: Replace the body with `return dayKey(Date.now());` after importing dayKey from @ollie/logic, or remove isoTodayWork entirely in favor of dayKey.
- **[low·conf 1/3]** startOfWeek()/endOfWeek() private to body-weekly; not consolidated
  - Files: `packages/orchestrator/src/body-weekly.ts:69-78`
  - startOfWeek() and endOfWeek() are private date-math utilities in body-weekly.ts. Not currently duplicated, but they are commonly needed and belong with the other shared time utilities for future reuse and discoverability.
  - Fix: Export startOfWeek() and endOfWeek() from @ollie/logic/src/util/index.ts alongside dayKey, nextDayKey, and daysBetweenKeys.
- **[low·conf 1/3]** sleep() defined privately in @ollie/api rather than as a shared utility
  - Files: `packages/api/src/client.ts:379-381`
  - The trivial sleep() helper is defined privately in api/client.ts for its retry loop while the same pattern recurs elsewhere. Round 1 framed this as the low-priority discoverability angle (export a tiny shared utility); round 3 escalated the same root cause to medium via the inline-setTimeout finding (consolidated separately above). Listed here as round 1's distinct low-severity framing.
  - Fix: Optionally export sleep() from @ollie/logic/src/util or a small @ollie/async module for consistency and discoverability; superseded by the consolidated medium-severity sleep finding if that is acted on.
- **[low·conf 1/3]** Duplicated _consentOnGoals helper across goals phase2 and phase3
  - Files: `packages/logic/src/goals/phase2.ts`, `packages/logic/src/goals/phase3.ts`
  - _consentOnGoals (a 3-line optional-consent-boolean check) is copy-pasted identically in goals/phase2.ts and phase3.ts, indicating incomplete refactoring.
  - Fix: Extract _consentOnGoals to goals/helpers.ts (or the goals index) and import it in both phase2.ts and phase3.ts.

### File & Module Structure — 10 issue(s)

- **[high·conf 1/3]** No module boundary enforcement in ESLint or TypeScript
  - Files: `/Users/serrayildirim/ollie/eslint.config.mjs:1-79`, `/Users/serrayildirim/ollie/tsconfig.base.json`
  - The monorepo has no ESLint rules or TypeScript configuration enforcing module boundaries (e.g., preventing apps from importing internal orchestrator files, or lower-level packages from importing higher-level ones). With ~642 source files and a clear dependency hierarchy (logic -> orchestrator -> apps), there is no automated guard against accidental layering violations. A consumer could import from @ollie/orchestrator/src/research or @ollie/store/src/migrations without detection.
  - Fix: Implement an ESLint rule (via eslint-plugin-import or a custom no-restricted-imports rule) to enforce package boundary constraints. For example: ban imports from @ollie/*/src/* (forcing all imports through package.json exports), or bar apps/native from importing internal sub-modules of @ollie/orchestrator that are not in its public API.
- **[medium·conf 2/3]** @ollie/notifications declares @ollie/api as a runtime dependency for a type-only import
  - Files: `/Users/serrayildirim/ollie/packages/notifications/package.json:24`, `/Users/serrayildirim/ollie/packages/notifications/src/server-schedule.ts:20`
  - The @ollie/notifications package lists @ollie/api as a runtime dependency (package.json line 24), but the only use of @ollie/api in the package is a type-only import (`import type { OllieAPI } from '@ollie/api'` in src/server-schedule.ts line 20). This mis-declared dependency creates unclear dependency intent: the package has no actual runtime reliance on @ollie/api, only on its type definitions. (Note: one round claimed @ollie/api was entirely absent from the dependencies block; the file confirms it IS present at line 24, so the real defect is mis-classification, not omission.)
  - Fix: Move @ollie/api from dependencies to devDependencies in notifications/package.json, since it is only used for type information. This clarifies that notifications has no runtime reliance on api. If a future runtime use is intended, keep it in dependencies with an explanatory comment.
- **[medium·conf 1/3]** @ollie/logic exposes 17 internal submodule exports that allow bypassing the orchestrator facade
  - Files: `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`
  - The @ollie/logic package declares all submodules (cycle, brain, finance, crisis, meditation, etc.) as public exports via its package.json exports field (lines 10-27). This enables apps/native and apps/api to import directly from @ollie/logic/brain, @ollie/logic/cycle, etc. instead of consuming logic through the @ollie/orchestrator facade, violating the intended layering where orchestrator should be the sole direct consumer and re-exporter of logic submodules. apps/native imports from @ollie/logic/brain (6+ files), /cycle, /crisis; apps/api imports similarly; orchestrator/src imports from 13+ @ollie/logic/X submodules directly.
  - Fix: Remove submodule exports from @ollie/logic/package.json, keeping only the root export ('.'). Force all apps (native, api) to import from @ollie/orchestrator or from the @ollie/logic root (which re-exports submodules via `export * as X`). This restores the boundary so orchestrator becomes the sole direct consumer of logic submodules.
- **[medium·conf 1/3]** @ollie/logic exports field is incomplete — 7 implemented submodules are not exported
  - Files: `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`, `/Users/serrayildirim/ollie/packages/logic/src/dissection/`
  - The @ollie/logic package exports 17 submodules (cycle, pets, grocery, etc.) but does NOT export 7 implemented submodules: consumption, corrections, dissection, predict, products, prompts, ritual. These modules exist in src/ (e.g., /packages/logic/src/dissection/) but are absent from the exports list, so callers must use the full root import or undocumented subpaths. CODEBASE_MAP.md itself flags this inconsistency: 'Missing from exports: consumption, corrections, dissection, predict, products, prompts, ritual (importable only via the root index.ts namespace).'
  - Fix: Either add all 7 submodules to the exports map in package.json for a consistent API surface, or intentionally re-export them only via the root namespace and document that as the contract. Make the public API surface deliberate rather than accidental.
- **[medium·conf 1/3]** @ollie/orchestrator exports internal dedup utility used only by tests
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:40`
  - @ollie/orchestrator exports appendCapped and DEFAULT_DEDUP_CAP from ./dedup-store at the public API level (index.ts line 40). These are implementation details used internally by orchestrators (work.ts, finance.ts, cycle.ts) for bounding emitted-id arrays. Outside the package they are referenced only in orchestrator/tests/dedup-store.test.ts — no consumer in apps/ or other packages uses them.
  - Fix: Remove the dedup-store exports from the public API (index.ts line 40). Keep them importable from './dedup-store' directly for tests if needed, but they should not be part of the public @ollie/orchestrator interface.
- **[medium·conf 1/3]** @ollie/orchestrator has no package.json exports field — entire src/ is implicitly importable
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/package.json:1-10`
  - @ollie/orchestrator has no package.json exports field, unlike @ollie/logic (17 subpaths) and @ollie/notifications (7 subpaths). It relies on implicit file resolution, making its API surface ambiguous — consumers could import from src/research, src/braindump-dispatch, or src/types without a bundler error.
  - Fix: Add an exports field to orchestrator's package.json listing all public sub-modules (e.g., './cycle', './patterns', './research', './braindump-dispatch') so the module API is explicit, allowing bundlers to enforce proper import paths and making the boundary clear.
- **[low·conf 1/3]** Test files colocated with source code in apps/native (inconsistent with packages)
  - Files: `/Users/serrayildirim/ollie/apps/native/src`, `/Users/serrayildirim/ollie/apps/native/src/notify/serverReminder.test.ts`, `/Users/serrayildirim/ollie/apps/native/src/modules/brain/copy.test.ts`
  - Test files (.test.ts) are placed alongside source code within apps/native/src/ (43 test files), whereas all packages (orchestrator, logic, crypto, etc.) follow the convention of a separate tests/ directory. This inconsistency makes it harder to distinguish production code from test code at a glance.
  - Fix: Migrate the .test.ts files from apps/native/src to a dedicated tests/ directory at the app root (or per-module) to match the package structure convention, which also reduces the src/ surface for Vite builds.
- **[low·conf 1/3]** @ollie/notifications declares 7 unused subpath exports, creating false API-stability signals
  - Files: `/Users/serrayildirim/ollie/packages/notifications/package.json:8-17`
  - The @ollie/notifications package declares subpath exports for internal implementation modules (backends/web, backends/electron, backends/capacitor, budget, aggregator, server-schedule, suppression) in its exports field (lines 9-16), but none of these subpaths are imported anywhere in the codebase — a grep confirms zero actual imports. They appear only as documentation examples in src/index.ts line 8, misleading consumers into thinking these are stable public APIs when they are internal details.
  - Fix: Either (a) remove the unused subpath exports from package.json and treat these modules as package-internal, OR (b) if they are intended public API, document the stable contract and ensure real usage. As-is they create false signals about API stability.
- **[low·conf 1/3]** Large monolithic barrel index files in orchestrator and notifications
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:1-341`, `/Users/serrayildirim/ollie/packages/notifications/src/index.ts`
  - @ollie/orchestrator's index.ts is 341 lines and re-exports 40+ items from 15+ sub-modules (cycle, pets, body, grocery, sleep, finance, patterns, admin, dump, habits, work, goals, burhan, medication, orphan-cue-bridge, research, body-weekly, body-correlations, body-signals, matter-routing, cadence-scanner). @ollie/notifications/src/index.ts is 485 lines. These large barrels mix types, functions, and interfaces, complicating tree-shaking/dead-code elimination and blurring the public vs. internal boundary.
  - Fix: Split orchestrator's index.ts into logical sub-exports (e.g., orchestrator/cycle, orchestrator/patterns, orchestrator/research) matching the sub-modules, or add an exports field to limit the barrel to a smaller, deliberate public surface.
- **[low·conf 1/3]** apps/native imports orchestrator-internal types (CadenceTrackedEntry) not in the public API
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/index.ts`, `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts`
  - The native app imports the CadenceTrackedEntry type from @ollie/orchestrator across many module files (cycle, sleep, pets, body, goals, admin, habits, work, finance, medication index.ts). Although type-only, these imports depend on orchestrator's implementation detail (cadence-scanner.ts) rather than a stable explicit public API, so internal restructuring could break them.
  - Fix: Either (1) add CadenceTrackedEntry and related types to orchestrator's public API (via the package.json exports field), or (2) move the type definition to the orchestrator root and re-export it there, ensuring stability across changes.

### TypeScript Type Safety — 18 issue(s)

- **[high·conf 3/3]** Unsafe `as unknown as ModuleHandler<Module>` casts in module registry
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:94-109`
  - Each module handler (grocery, pets, finance, etc.) is cast through `as unknown as ModuleHandler<Module>` to fit a homogeneous Record<Module, ModuleHandler<Module>> registry. This discards specific handler type information and hides structural mismatches between concrete handler types and the generic registry constraint until runtime.
  - Fix: Use a `satisfies Record<Module, ModuleHandler<Module>>` constraint or a type-safe registry builder/common supertype so handlers conform without the double-cast, preserving compile-time shape checking.
- **[high·conf 3/3]** API client casts response to generic T without runtime validation
  - Files: `/Users/serrayildirim/ollie/packages/api/src/client.ts:194`, `/Users/serrayildirim/ollie/packages/api/src/client.ts:199`
  - The api client casts responses to the generic type T without validation. When parseJson is false, response text is cast via `(await res.text()) as unknown as T`; when true, `(await res.json()) as T` is used directly. A mismatched server shape (or arbitrary text) silently flows to callers typed as T with no guarantee it matches.
  - Fix: Add runtime validation (e.g. Zod schema or a validator callback parameter) before casting, or return text as string for the parseJson=false path and let callers parse. Constrain T to validatable types for high-risk endpoints.
- **[high·conf 3/3]** Theme tokens cast `as unknown as Record<...>` in tokensToCssVars bypasses type safety
  - Files: `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:208-225`, `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:370-382`
  - Design tokens (palette, fonts, fontSizes, fontWeights) are cast through `as unknown as Record<string, string|number>` for CSS variable serialization. The double cast hides token shape mismatches; if a token type changes or contains an unexpected value it passes through silently into CSS variables.
  - Fix: Define overloaded/strict writeGroup signatures per token type (Record<string,string> vs Record<string,number>) or use Object.entries with explicit narrowing to eliminate the unsafe `as unknown` bridge.
- **[high·conf 2/3]** Capacitor backend uses `Promise<any>` dynamic import / unvalidated globalThis cast
  - Files: `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:36-38`, `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:73`
  - The Capacitor backend defeats type checking in two places: the dynamic import is typed `(s: string) => Promise<any>` and cast through a chain ending in `as never`, and globalThis is cast `as unknown as CapacitorGlobal` without validating Capacitor is present. Missing plugin methods/properties and runtime unavailability are hidden from static analysis.
  - Fix: Define a generic typed import wrapper `<T>(s: string) => Promise<T>` with a type guard validating required plugin methods (LocalNotifications/PushNotifications), and gate the global access behind a type-safe check returning T | null.
- **[high·conf 1/3]** Unvalidated store cast `as unknown as SnapshotStoreLike` in body-correlations orchestrator
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:108`
  - Store is cast `as unknown as SnapshotStoreLike` to satisfy takeUserDataSnapshot's signature. The cast hides any structural mismatch between the actual Store interface and SnapshotStoreLike, deferring type errors to runtime method calls.
  - Fix: Make Store implement SnapshotStoreLike directly, or create a proper adapter function that validates the conversion at build time.
- **[high·conf 1/3]** Unsafe JSON.parse without schema validation across dump/repo files
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/archive.ts:134`, `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/repo.ts`
  - `JSON.parse(...) as unknown` appears in multiple persistence paths (dump archive, grocery/work repos) relying only on downstream filter checks rather than schema validation. Any change to filter logic or corrupted/changed persisted structure could allow bad data through or crash on access.
  - Fix: Wrap JSON.parse in try/catch and validate the parsed shape with a Zod/io-ts schema at parse time, returning a typed, guaranteed-correct result.
- **[medium·conf 3/3]** Finance merge casts FinanceRecord to `Record<string, unknown>` for dynamic key assignment
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`
  - FinanceRecord is cast through unknown to `Record<string, unknown>` to perform a dynamic key assignment in the merge loop, bypassing type safety. Unexpected keys/values can be silently copied into the financial record.
  - Fix: Use type-safe assignment, e.g. iterate with Object.entries and narrow keys via `out[k as keyof FinanceRecord] = v` after a null/undefined guard, or use Object.assign with properly-typed Partial<FinanceRecord>.
- **[medium·conf 2/3]** `getRandomValues` typed with `any` parameter/return in crypto package
  - Files: `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:85-86`
  - crypto.getRandomValues is typed as `(a: any) => any` with an eslint-disable, allowing any input/output without validation for a security-sensitive crypto operation. A non-ArrayBufferView argument would fail at runtime.
  - Fix: Use the standardized Web Crypto signature `getRandomValues?: (buffer: ArrayBufferView) => ArrayBufferView` and remove the any escape hatch.
- **[medium·conf 2/3]** Sleep parse casts SleepRecord through `unknown as Record<string, unknown>`
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:161`, `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:38`
  - In the sleep merge logic, the typed SleepRecord output is cast `as unknown as Record<string, unknown>` to allow dynamic key assignment, losing all type information about valid SleepRecord keys despite a null check.
  - Fix: Use a narrowly-typed setIfDefined helper or Object.assign with Partial<SleepRecord> and proper key narrowing to avoid the intermediate unknown cast.
- **[medium·conf 2/3]** Grocery orchestrator: unvalidated payload cast and result cast in item route
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:176`, `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:201`
  - The grocery orchestrator casts unchecked data: onPeriodLogged accepts `payload: unknown` and immediately casts to a partial object without validation, and a map() result is cast `as unknown as ShoppingItem[]` without verifying the constructed shape. Malformed payloads or builder shape changes flow through unchecked.
  - Fix: Add a type guard (e.g. isPeriodLoggedPayload) or Zod validation before casting the payload, and construct the array as ShoppingItem[] (or via a factory) so TypeScript verifies shape at compile time.
- **[medium·conf 1/3]** globalThis typed as `any` for navigator/crypto in research-stream
  - Files: `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:145`, `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:340`
  - globalThis is typed as `any` to access navigator.onLine and crypto.randomUUID without type errors, defeating type safety for global environment assumptions.
  - Fix: Define a minimal interface for the needed globalThis subset (e.g. { navigator?: { onLine?: boolean }; crypto?: { randomUUID?: () => string } }) and cast through it instead of any.
- **[medium·conf 1/3]** Redundant non-null assertions after Array.isArray guard in goals detectors
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/goals/velocity.ts:98`
  - Code checks `Array.isArray(history?.goals)` then uses redundant double non-null assertions `history!.goals!`. The guard already narrows the type. Pattern repeats across goal detectors (phase1/phase2/phase3/velocity) and obscures intent.
  - Fix: Drop the redundant assertions: `const goals = history?.goals ?? [];` (or rely on the narrowed guard result).
- **[medium·conf 1/3]** Journal extraction casts emotions array through `unknown[]` during validation
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:281`
  - In journal extraction, `e['emotions']` is cast through `as unknown[]` during the validation loop, losing type information; non-string values are only caught at the subsequent runtime typeof check.
  - Fix: Narrow earlier with `Array.isArray(e['emotions'])` and a type guard, then iterate the narrowed array without the unsafe cast.
- **[medium·conf 1/3]** Finance orchestrator unnecessary double-cast after in-operator narrowing
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:953`
  - After an in-operator check, taxProfile is cast `as unknown as { calculator: TaxCalculator }` to access .calculator. The in-operator already provides runtime safety; the double cast is unnecessary and hides taxProfile's actual type from static analysis.
  - Fix: Define a type guard for the calculator-bearing shape, or type the in-operator result properly so the narrowed branch exposes .calculator without the unknown cast.
- **[medium·conf 1/3]** Layout components double-cast space key lookups through unknown
  - Files: `/Users/serrayildirim/ollie/apps/native/src/layout/Box.tsx:78`, `/Users/serrayildirim/ollie/apps/native/src/layout/Row.tsx`, `/Users/serrayildirim/ollie/apps/native/src/layout/Stack.tsx`, `/Users/serrayildirim/ollie/apps/native/src/layout/Container.tsx`, `/Users/serrayildirim/ollie/apps/native/src/layout/Spacer.tsx`
  - resolveSpace() casts the space key lookup `space[val as unknown as SpaceKey]` despite an in-operator runtime guard. The double cast signals the prop type union doesn't narrow naturally. Pattern repeats across Box/Row/Stack/Container/Spacer.
  - Fix: Strengthen the prop type union (e.g. `string & {}`) so TypeScript narrows naturally after the `in` check, eliminating the unknown cast.
- **[medium·conf 1/3]** Mood handler casts fragment.payload to MoodAction without validation
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/mood/handler.ts:32`
  - fragment.payload is cast `as unknown as MoodAction` without prior validation. A malformed payload passes through; the switch default offers partial safety but property access on a bad payload could still crash.
  - Fix: Validate fragment.payload against a MoodAction schema (Zod/io-ts) before casting, returning an error result on validation failure.
- **[medium·conf 1/3]** Object.keys() loses type information in journal extraction loop
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:262`
  - Object.keys(e) returns string[] even though e is Record<string, unknown>, so iteration loses type information and requires re-narrowing. Works at runtime via guards but is fragile if logic changes.
  - Fix: Use Object.entries(e) and destructure key and value so TypeScript preserves type information across the loop.
- **[low·conf 1/3]** Missing internal return type on supabase IIFE arrow function
  - Files: `/Users/serrayildirim/ollie/apps/native/src/api/supabase.ts:62`
  - The exported supabase constant uses an IIFE arrow function annotated on the export but with no explicit return type on the function body, making it harder to verify the Proxy construction matches SupabaseClient.
  - Fix: Add an explicit return type to the IIFE so the Proxy-vs-SupabaseClient match is statically verified.

### Error Handling & Resilience — 25 issue(s)

- **[critical·conf 1/3]** Promise.all without error boundary in flush-notifications aborts the rest of the batch
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:223`
  - Promise.all(tokens.map(t => pushOne(...))) collects delivery results, but a rejection from any pushOne (e.g. a network error before the internal try/catch) throws and halts processing of all remaining tokens, violating the documented guarantee that one bad job never starves the rest of the batch.
  - Fix: Use Promise.allSettled, or wrap each pushOne in a catch that returns a failed-result object, so a single token failure cannot abort delivery to the remaining tokens.
- **[high·conf 3/3]** Fire-and-forget Vectorize cache operations silently inflate AI cost with no alerting
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-269`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:303-305`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:361-371`
  - Vectorize cacheLookup, cacheHitBump, and cacheUpsert are spawned via keepAlive/Promise.all with only a .catch that console.errors and (for lookup) returns null. A lookup failure falls through to a cache miss, silently triggering full AI calls; an upsert failure prevents future caching. There is no metric, alert, or circuit breaker, so a Vectorize outage produces a 100% miss rate that quietly multiplies token spend. If the worker terminates before waitUntil drains, the error log itself can be lost.
  - Fix: Add Sentry/metric instrumentation to the fire-and-forget catch handlers so persistent Vectorize failures surface an alert instead of silently inflating cost. Track consecutive cache failures and emit a degradation signal (e.g. cache_errors count in response telemetry) so the client/operator can detect it. Keep fail-open routing on miss.
- **[high·conf 1/3]** Promise.all without per-element error handler in native post-dispatch path
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-101`
  - Promise.all([runAllSyncs(store), recordMoodFromDump(...)]).then(recomputeBrain) has the only meaningful .catch wrapping recordMoodFromDump, while the outer chain catch merely logs. If runAllSyncs rejects (its resolve-not-reject contract is not enforced) the whole chain fails silently, and there is no per-branch recovery or context about which sync failed.
  - Fix: Wrap each Promise.all element in its own .catch, or use Promise.allSettled so one rejection cannot fail the whole chain. Add which-sync context to the error log for post-mortems.
- **[high·conf 1/3]** Unhandled promise rejection in braindump-dispatch grocery routing IIFE
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:847`
  - The fire-and-forget grocery routing IIFE (void (async () => {...})()) has no trailing .catch. An error thrown inside the IIFE (event emit, error-handling logic) becomes an unhandled promise rejection rather than being logged/handled.
  - Fix: Append .catch to the IIFE: void (async () => { ... })().catch(err => onError?.(err, ...)).
- **[high·conf 1/3]** Missing timeout on APNs JWT fetch in send path
  - Files: `/Users/serrayildirim/ollie/apps/api/src/worker.ts:406-413`
  - getApnsJwt() is awaited with no timeout on every /send request. If signing or the underlying fetch stalls, the request blocks indefinitely and can exhaust worker request limits.
  - Fix: Wrap getApnsJwt in an explicit timeout (Promise.race with a timeoutPromise(5000)) or add timeout support to the apnsSigner interface.
- **[high·conf 1/3]** Silent data loss when sync queue persistence fails after successful upsert
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/index.ts:199-212`
  - After a successful Supabase upsert, drainOnce calls writeQueue() to drop shipped entries. If writeQueue() throws, the method still returns success; on next reload readQueue returns stale data and entries are re-shipped forever, creating a logical inconsistency despite the idempotent upsert.
  - Fix: Wrap writeQueue in try/catch; on failure log and call drainScheduler.scheduleRetry() (and return) so the cleanup is retried rather than reported as done.
- **[high·conf 1/3]** Empty catch blocks in auth vault crypto operations hide key-derivation and cleanup failures
  - Files: `/Users/serrayildirim/ollie/packages/auth/src/index.ts:167-171`, `/Users/serrayildirim/ollie/packages/auth/src/index.ts:202-206`, `/Users/serrayildirim/ollie/packages/auth/src/index.ts:212-216`, `/Users/serrayildirim/ollie/packages/auth/src/index.ts:220-235`
  - create()/unlock()/lock()/reset() swallow errors with empty catches. If events.emit throws, callers still get ok:true while the vault may not be secure. In lock()/reset(), store.remove() failures are ignored, so a corrupted index can leave the verifier / old key material persisted while reporting success.
  - Fix: For crypto-critical ops (create, unlock) log emit failures at warn level so they are visible; for cleanup ops (lock, reset) log store.remove failures and consider throwing on critical cleanup failure instead of silently leaving key material.
- **[high·conf 1/3]** Grocery pattern detectors swallow detector failures with empty catch blocks
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:293-297`
  - detectPatterns wraps each of the five detectors in try/catch with only /* pass */ and no logging. A detector that throws (null history, bad shelf-life data) is silently dropped; callers cannot distinguish 'no pattern' from 'detector crashed'.
  - Fix: Add console.warn (or a metrics sink) with the detector name and a safe error summary inside each catch, preserving fault tolerance while enabling diagnostics.
- **[high·conf 1/3]** Finance pattern detectors swallow detector failures with empty catch blocks
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:118`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:154`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:193`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:239`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:261`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:303`, `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:333`
  - The seven F1-F7 detectors each catch with /* */ or /* swallow */ and no logging. Errors (date parsing, array access, regex) disappear; no caller can tell whether a pattern failed or simply did not match.
  - Fix: Log each catch with the pattern name and safeErrSummary (already imported at line 26), e.g. catch (err) { console.warn('[logic/finance] F1 detector failed', safeErrSummary(err)); }.
- **[medium·conf 2/3]** cadence-scanner fires notifications without await or failure tracking
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:405-420`
  - notify() is fired fire-and-forget with only a defensive .catch that logs. The entry is marked fired and de-duplicated before delivery is confirmed, so a rejected notify means the user misses the notification forever. If the same key fails repeatedly (bad URL, backend down), the scanner keeps retrying every 30 minutes with no backoff or circuit breaker, wasting resources on a known failure.
  - Fix: Track a per-key consecutive-failure counter; after ~3 failures skip the key for the day and log at warning level so operator alerts catch systematic notification failures. Optionally do not add to the fired/de-dup set until delivery is confirmed.
- **[medium·conf 2/3]** research-stream trackTable fire-and-forget POST loses data with no retry
  - Files: `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:211-222`
  - trackTable POSTs to /ingest-event via void f(...).catch(() => {}) with an empty best-effort catch. If the worker is down the research row is lost silently with no logging and no retry queue; rapid successive calls can all fail unobserved.
  - Fix: At minimum add explicit error logging to the catch handler (e.g. console.error('[research] trackTable failed', e)) so failures are visible. Better: queue failed rows in a small in-memory retry buffer and re-attempt on the next trackTable, mirroring the existing flush mechanism.
- **[medium·conf 1/3]** Research orchestrator flush timer can produce unhandled rejection if onError throws
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:193`
  - The setInterval callback runs void flush().catch(err => onError(...)). If onError itself throws it becomes an unhandled rejection; and a throw in onCorpusAppended() invoked inside flush may not be caught.
  - Fix: Wrap the entire interval callback in try/catch (or guarantee onError never throws) so timer ticks cannot produce unhandled rejections.
- **[medium·conf 1/3]** Sync scheduler does not signal operator on retry exhaustion
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/retry.ts:121-127`
  - When scheduleRetry hits maxAttempts it logs a warning, returns false, and leaves the queue intact, but no operator alert fires. If the server is down longer than the backoff window, the queue silently stops retrying and state goes unsynchronized.
  - Fix: Add an onExhausted callback to BackoffSchedulerOptions invoked at max retries, routed to Sentry/metrics so operators know sync is stuck.
- **[medium·conf 1/3]** Partner bilateral snapshot writes suppress errors causing silent state divergence
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:112`, `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:130`, `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:168`
  - putPartnerSnapshot and unpairPartner use .catch(() => {}). If a snapshot write fails, this device's state diverges from the partner's view with no retry and no log to surface the mismatch later.
  - Fix: Log each suppressed error with dumpId/userId context for offline debugging, and set a 'sync pending' flag so a later successful sync or boot retries the snapshot.
- **[medium·conf 1/3]** updateJob failures in flush-notifications are swallowed, risking duplicate delivery
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:471-476`
  - updateJob logs but never throws, so a failed PATCH to mark a job 'sent' is lost: the job stays 'pending' in the DB while in-memory stats report it sent. A crash before the next tick re-runs the job, potentially delivering a notification twice.
  - Fix: Return a boolean success from updateJob; on false, do not mark the job processed (reject applyRetry) so it retries cleanly on the next tick instead of double-delivering.
- **[medium·conf 1/3]** No timeout on Supabase queries in flush-notifications can hang the cron worker
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:365`, `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:405`, `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:440`, `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:465`
  - Supabase fetch() calls have no explicit timeout. If Supabase hangs, the worker blocks until the ~30s runtime timeout, stalling other scheduled jobs.
  - Fix: Add an AbortController with a ~5s timeout to each fetch and clear it in finally.
- **[medium·conf 1/3]** Supabase REST error body parse failure masks original error code
  - Files: `/Users/serrayildirim/ollie/apps/api/src/worker.ts:234-241`
  - In supabaseSelect, a non-ok response extracts the error body via await res.text(); if res.text() itself fails the exception is caught and null returned, losing the status/error and masking whether the failure was network, 5xx, or malformed.
  - Fix: Use a safeText helper with an explicit fallback that still preserves res.status, e.g. const detail = await safeText(res) ?? `<unreadable: ${res.status}>`.
- **[medium·conf 1/3]** Cron drain treats 200 OK as success without verifying written rows
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:318-322`
  - insertRawDump/insertEnrichedSignal check res.ok but do not validate the response body shape or row count. A 200 with an error JSON or partial write is treated as success and the KV entry is deleted, permanently losing the data.
  - Fix: Parse and validate the response (e.g. throw if returned rows are empty) before deleting the source KV entry.
- **[medium·conf 1/3]** Empty catch hides inbound decryption failures in sync syncIn
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/index.ts:238-252`
  - syncIn logs and continues on a per-row decrypt failure. If decryption fails due to a key mismatch (password change, unrotated key), every inbound row fails and the local store goes stale with no user awareness.
  - Fix: Track consecutive decrypt failures and emit an alert event when a threshold is exceeded (e.g. sync:mass_decrypt_failure) so a systemic key mismatch surfaces.
- **[medium·conf 1/3]** sync/finance syncIn unbounded recursion can overflow the stack
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:544-546`
  - syncIn recurses whenever rows.length >= PAGE_LIMIT with no depth limit. If the remote table grows faster than the cursor advances (concurrent writes, stuck cursor), the stack grows unbounded; the 'bounded by the cursor advancing' comment fails in a replay scenario.
  - Fix: Convert the recursion to a loop, or cap recursion depth (e.g. 10 pages) and break with a logged warning when exceeded.
- **[medium·conf 1/3]** sync/finance drainOnce loses upserts when a delete fails mid-drain
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:340-395`
  - On a non-auth upsert failure the function returns before the delete loop (correct), but the delete loop's own early return on failure leaves the queue dirty: if 10 upserts succeed and 1 delete fails, those upserts are dropped from snapshots and never re-sent. The unauthorized branch emits an event but the surrounding control flow can still let later stages run inconsistently.
  - Fix: Track upsert and delete success independently: clear the upsert queue once upserts succeed, attempt deletes only after, and on any failure log the queue state so a stalled sync is diagnosable.
- **[medium·conf 1/3]** worker-http newRequestId silently falls back to weak random IDs on crypto failure
  - Files: `/Users/serrayildirim/ollie/packages/worker-http/src/index.ts:66-72`
  - newRequestId swallows crypto.randomUUID errors and falls back to a predictable timestamp + Math.random string. On a worker with broken crypto, request_ids can collide, breaking log correlation, and the fallback is weak/predictable.
  - Fix: Log the crypto failure at warn level so operators know correlation is degraded; flag the fallback in responses or use a stronger entropy source (high-precision timer + counter).
- **[low·conf 1/3]** Event emit throws if validatePayload throws, crashing dispatch
  - Files: `/Users/serrayildirim/ollie/packages/events/src/index.ts:35-40`
  - emit() expects validatePayload to warn+return false on invalid input, but if validatePayload throws (malformed shape) the exception propagates out of emit, crashing a caller that assumed a non-fatal emit.
  - Fix: Wrap validatePayload in try/catch inside emit: on throw, console.error and return without delivering.
- **[low·conf 1/3]** Scheduled notification delay clamped to 0 fires immediately without warning
  - Files: `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:175-181`
  - scheduleInProcessTimer computes delay = Math.max(0, fireAt - Date.now()). When fireAt is in the past, semantics silently shift from 'fire at X' to 'fire immediately' with no warning, which may violate intent for late-resumed records.
  - Fix: Log when delay is clamped to 0 (e.g. console.warn('[notify] scheduled notification delivered late', dedupe_key)).
- **[low·conf 1/3]** research-stream scheduleFlush may leak/stack timers on rapid reschedule
  - Files: `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:253-260`
  - scheduleFlush assigns flushTimer without clearing a prior timer first; rapid successive calls (e.g. on flush failure + reschedule) can leave stale timers running.
  - Fix: Always clearTimeout(flushTimer) before assigning a new setTimeout.

### Async & Concurrency — 11 issue(s)

- **[high·conf 2/3]** TOCTOU race in finance sync drain queue cleanup loses concurrently-enqueued items
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:335-401`, `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:370-374`, `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:397-400`, `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:319-327`
  - drainOnce() reads the queue once at line 335, performs async API upserts (line 357), then re-reads the queue at line 371 to remove shipped items — but builds shippedIds from the ORIGINAL snapshot `q` (line 372), not the freshly-read `next`. The identical pattern repeats for deletes at lines 397-399. Because debouncedDiff()→diffAndEnqueue() runs asynchronously and can enqueue new rows between the two reads, the cleanup filters the current queue against a stale snapshot. Confirmed in code: `next.upserts.filter((u) => !shippedIds.has(u.id))` where shippedIds derives from `q.upserts`. Items enqueued mid-drain that happen to share an id with a shipped item are silently dropped without being synced; this is a TOCTOU correctness bug on user financial data.
  - Fix: Track only the ids actually shipped in THIS drain attempt, re-read the queue at cleanup, and remove exactly those ids from the current queue (which is already what re-reading `next` intends — the bug is that the filter predicate still references `q`). Better: make drainOnce the sole writer during its execution (a simple in-flight guard), or tag entries with a per-enqueue sequence number so concurrent mutations are distinguishable from the shipped snapshot. Apply the same fix to both the upsert (370-374) and delete (380-401) branches.
- **[high·conf 1/3]** enqueueUpsert encryption failure is unhandled and can drop or corrupt queued rows
  - Files: `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:255-271`, `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:283-317`
  - enqueueUpsert() awaits encryptData (line 259) with no local try/catch before pushing to the queue. diffAndEnqueue() calls it sequentially for each added/updated row (lines 298, 305). If encryptData throws, the rejection propagates only to diffAndEnqueue's single .catch (line 323), which logs a summary and abandons the entire diff cycle — so every row after the failing one in that cycle is silently never enqueued, and the snapshot is still advanced at line 316, meaning those rows are treated as already-synced and will not be retried.
  - Fix: Wrap encryptData in try/catch inside enqueueUpsert; on failure either rethrow with row context or log-and-skip without advancing the snapshot for that id, so the row is re-diffed next cycle rather than lost.
- **[high·conf 1/3]** Non-atomic token-bucket rate limiter in APNs worker allows burst overage
  - Files: `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:135-142`
  - checkRate() does a check-then-act against Cloudflare KV: kv.get(slot) → parse count → compare to max → kv.put(count+1). KV provides no atomicity between the get and put, so two concurrent requests can both read the same count, both pass the `count >= max` gate, and both write count+1 — collapsing two increments into one. Under bursty traffic the 5 req/window limit can be exceeded.
  - Fix: Treat this as a soft/approximate limit and document it as such, or move to an atomic counter (Durable Object) for a hard limit. If approximate is acceptable, add downstream backoff/retry to tolerate occasional overage.
- **[medium·conf 2/3]** Fire-and-forget Promise.all post-dispatch chain has fragile error boundary
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109`
  - The post-dispatch chain floats `void Promise.all([runAllSyncs(store), recordMoodFromDump(...).catch(...)]).then(() => recomputeBrain(store)).catch(...)`. Internal handlers exist, but the design relies on an unenforced contract: a comment claims runAllSyncs 'resolves-not-rejects', yet there is no explicit .catch on runAllSyncs to enforce it — if that contract is later violated the floated promise rejects silently. recomputeBrain runs inside .then(), so a synchronous throw there is caught, but the overall pattern carries implicit ordering assumptions (watchers may read store keys before the mirror/brain recompute lands).
  - Fix: Add an explicit .catch on runAllSyncs to enforce the never-rejects contract, and wrap recomputeBrain in `.then(async () => { await recomputeBrain(store); })` so any throw is reliably funneled to the existing top-level .catch. If watcher consistency on the mirrored keys matters, document the acceptable race window.
- **[medium·conf 1/3]** Unchecked dual KV deletes after processing in cron drain risk duplicate enrichment
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:144-147`
  - After processOne succeeds, the code deletes the queue entry and the retry counter with two separate awaited deletes (lines 145-146) and then increments succeeded. Neither delete result is verified. If the entry delete fails (or the worker dies between the two), the same dump entry remains and will be reprocessed on the next drain — causing duplicate enrichment. If only the retry-counter delete fails, the retry count leaks and skews future retry decisions.
  - Fix: Run both deletes via Promise.all and wrap in try/catch so a failed entry-delete does not count as succeeded; rely on processOne being idempotent (idempotency key) so any unavoidable reprocess is a no-op rather than a duplicate.
- **[medium·conf 1/3]** No circuit breaker / coalescing on Vectorize cache lookup in dump route causes AI stampede on outage
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:264-271`
  - The dump route fans out per-fragment Vectorize lookups via Promise.all, each with .catch(() => null) (lines 266-269). On a Vectorize outage every fragment resolves to a cache miss and falls through to the AI classify path. Across concurrent dumps this turns a cache backend failure into a thundering herd against Groq/Gemini/Cloudflare with no circuit breaker, request coalescing, or degraded fallback.
  - Fix: Add a short-lived circuit breaker that, after repeated Vectorize failures, returns a synthetic all-miss / degraded state without hammering downstream AI; optionally coalesce identical embeddings within a request window to dedupe AI calls.
- **[medium·conf 1/3]** Fragile fire-and-forget boot scan in cadence-scanner
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:445-450`
  - The boot scan setTimeout callback runs `void scanOnce().catch(...)`. If scanOnce throws synchronously before returning its promise, the .catch cannot intercept it, producing an uncaught error in the timer. The pattern relies on scanOnce never throwing synchronously, which is unenforced.
  - Fix: Wrap the call in an async IIFE so synchronous throws become rejections caught by .catch: `void (async () => { await scanOnce(); })().catch(...)`.
- **[medium·conf 1/3]** Dead placeholder promise in research orchestrator init
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:218-223`
  - init() creates `void Promise.resolve().then(() => { if (now() > 0) { /* placeholder */ } })`. The comment says it nudges a recompute for observability, but the callback does no work — the real flush waits for the interval. This is dead code that misleads about initialization behavior and adds an empty microtask.
  - Fix: Remove the dead block, or if a real boot recompute is intended, call `void flush().catch(...)` inside the then(); if it exists only to keep `now` referenced for tests, replace with an explicit test hook and a TODO.
- **[low·conf 1/3]** Flag-based coordination between async native schedule and cancel() in systemNotify has a race
  - Files: `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:275-314`
  - scheduleAt() returns its handle synchronously while an async branch (loadNotificationPlugin().then) decides the native-vs-timer path and sets nativeScheduled (line 291). cancel() reads nativeScheduled synchronously (line 306). If cancel() is invoked before the async branch resolves, it sees nativeScheduled=false and only clears the in-process timer; the native schedule may still be armed afterward, so the notification fires despite cancellation (orphaned native timer). The reverse interleaving also leaves ambiguity about which path owns cancellation.
  - Fix: Replace the boolean flags with promise-based coordination: store the pending native-scheduling promise and, in cancel(), await/chain it so the cancel runs against whichever path actually won; or guard schedule and cancel with a shared mutex.
- **[low·conf 1/3]** Unnecessary Promise.resolve().then() wrapper around recomputeCapacity in brain recompute
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/brain/index.ts:54`
  - recomputeCapacity is wrapped in `Promise.resolve().then(() => recomputeCapacity(store, now)).catch(...)` inside Promise.all, even though recomputeCapacity is already async. The wrapper adds a pointless microtask and obscures the chain; it does have one minor benefit (it would catch a synchronous throw from recomputeCapacity), but that can be achieved without the extra Promise.resolve.
  - Fix: Simplify to `recomputeCapacity(store, now).catch((err) => { ... })`. If guarding against a synchronous throw is desired, keep that intent explicit rather than via Promise.resolve().then().
- **[low·conf 1/3]** Duplicated cacheWrite implementation across ai-proxy router modules
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:438`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:779`
  - An identical cacheWrite() function (same Supabase routing_cache target, same signature and body) is defined in both route.ts and feed-me.ts. The duplication is a maintenance hazard: a schema or endpoint change must be applied in two places or the copies will drift.
  - Fix: Extract cacheWrite into a shared module (e.g. workers/ai-proxy/src/shared/cache.ts) and import it in both files.

### Clean Code & Complexity — 17 issue(s)

- **[high·conf 2/3]** applyGroceryMutations is ~248 lines with 4-level nesting and duplicated pantry/shopping logic
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-647`
  - The applyGroceryMutations function spans ~248 lines with a switch over four cases (add, remove, check, move_to_pantry), each containing internal if/else for pantry vs shopping plus nested try-catch. Each case repeats nearly identical snapshot-capture, mutation-callback, and undo-payload logic, violating single-responsibility and making the function hard to test and maintain.
  - Fix: Extract each case into a private handler (applyAddMutation, applyRemoveMutation, applyCheckMutation, applyMoveToPantryMutation) and pull common patterns into helpers: createMutationSnapshot() for pre-state, applyMutationCallback() for onGroceryMutation with error handling, and createMutationReverse() for undo payloads. Further factor pantry-vs-shopping into a shared helper. Target <100 lines per function.
- **[high·conf 2/3]** grocery.config.ts is ~1,820 lines mixing 600+ food-data entries with config code
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820`
  - grocery.config.ts mixes large data tables (SHELF_LIFE_DETAIL ~600 items, ALIAS_MAP 100+ entries, CANONICAL_ITEMS) with utility/builder functions (lookupShelfLife, buildSystemPrompt, buildFunctionSchema). The file is ~94% data, making it unmaintainable to search/edit/review, inflating bundle size, and conflating domain data with logic.
  - Fix: Move SHELF_LIFE_DETAIL, ALIAS_MAP, CANONICAL_ITEMS, and CRITICAL_REMINDER_CANONICAL into a separate data module (grocery-data.ts or shelf-life.json in a /data dir), following the existing @ollie/logic/grocery/data.ts pattern. Keep only schema types, the ModuleConfig builder, and lookup utilities in grocery.config.ts; import data at runtime.
- **[high·conf 1/3]** dispatchAction is 467 lines with 10+ inline module-specific branches
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157`
  - dispatchAction is ~467 lines with 10+ sequential module branches (grocery, cycle, finance, work, goals, body, astrology, pets, admin, habits, health), each with inline store mutations following identical patterns but different schemas. This violates single-responsibility and makes the function hard to test, modify, and reason about.
  - Fix: Refactor into a dispatch table mapping module -> handler function, or extract per-module handlers (dispatchGrocery, dispatchCycle, dispatchFinance, ...) called from a thin router. This lowers cognitive load and isolates module changes.
- **[medium·conf 2/3]** MUTATION_RE regex mixes EN/TR/ES verbs in one undocumented alternation
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`
  - MUTATION_RE is a long single-line alternation mixing English, Turkish, and Spanish mutation verbs without per-language grouping or inline documentation. It is hard to audit which verbs belong to which language, hard to extend one language without affecting others, and hard to understand why phrase context (e.g. 'drop X from') is required versus bare verbs.
  - Fix: Split into per-language arrays/sub-patterns (MUTATION_VERBS_EN, MUTATION_VERBS_TR, MUTATION_VERBS_ES) and build the regex dynamically, or add a comment block above the regex breaking it down by language and explaining the phrase-context requirement that avoids false positives like 'got milk'.
- **[medium·conf 2/3]** Grocery async routing closure in dispatchAction is deeply nested and duplicated
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:721-847`, `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:875-892`
  - The grocery routing path defines void async IIFE closures (~130 lines at 758-847, plus a second similar block at 875-892) implementing a state machine: mutation vs non-mutation branching, conditional placeholder writes, async callGroceryRoute, fallback logic, nested loops over result items, and event emissions. The logic reaches 4 levels of nesting, is duplicated across the two blocks, and cannot be tested in isolation.
  - Fix: Extract the async logic into a named helper (e.g. applyAIGroceryResult(result, isMutation, store, ts, opts)) called from both sites, and split the add vs mutation paths into sibling functions (applyGroceryAdd / applyGroceryMutation). This reduces nesting, removes duplication, and makes the flow testable.
- **[medium·conf 1/3]** recomputeDerived is a 1000+ line god function with repeated emit/dedup try-catch boilerplate
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:274-1100`
  - recomputeDerived exceeds 1000 lines and handles nearly every finance computation: recurring detection, anomalies, D3 patterns, subscriptions, bills, savings, taxes, impulse pauses, milestone tracking. It also repeats the same try-catch + read-previous-state + filter-new + emit + append-to-dedup-set pattern across ~15 blocks, creating heavy boilerplate that is hard to navigate, test, and reuse.
  - Fix: Split recomputeDerived into per-domain functions (computeRecurringPatterns, detectAnomalies, detectD3Patterns, emitSubscriptionEvents, computeSavingsMetrics, ...) so recomputeDerived becomes a thin orchestrator (~50-100 lines each). Extract a helper like emitOncePerKey(key, items, keyFn, emitFn) to collapse the duplicated dedup/emit/store try-catch blocks.
- **[medium·conf 1/3]** Inline store.update type declarations repeated 30+ times instead of module-scope aliases
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:413-423`, `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:442-452`, `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:468-479`, `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:502-512`, `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:540-554`
  - Nearly every store mutation is preceded by a 3-8 line inline generic type declaration (store.update<Array<{ id: string; name: string; ... }>>(...)). These shapes are repeated 30+ times across grocery and the module branches in dispatchAction, bloating the file and making schema changes painful.
  - Fix: Define type aliases once at module scope (e.g. type GroceryItem, type PantryItem) and use store.update<GroceryItem[]>(...) instead of inline full types, reducing repetition and centralizing schema.
- **[medium·conf 1/3]** emitResearchRow called inline 11+ times with near-identical arguments
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:366-383`
  - Each module branch in dispatchAction calls emitResearchRow directly with the same signature (table, rowId, data, ts, getLocale()) at ~12 sites (737, 858, 937, 947, 983, 995, 1004, 1018, 1055, 1088, 1118, 1136). This is repeated boilerplate and the intent (only emit for scrubbable tables) is implicit at each call.
  - Fix: Introduce a wrapper such as emitIfScrubbable(table, rowId, text, ts, getLocale) that encapsulates the locale resolution and scrubbable-table intent, and call it from each branch instead of emitResearchRow directly.
- **[medium·conf 1/3]** applyCapitalizedNameHeuristic has three nested loops with hard-to-follow flag logic
  - Files: `/Users/serrayildirim/ollie/packages/pii-scrub/src/index.ts:388-440`
  - applyCapitalizedNameHeuristic uses a multi-pass algorithm with three loops (split parts, build isNameWord/isAnchor maps, then flagging) and a two-condition name-detection block (adjacency check plus a backward scan for trigger words) that is difficult to follow and test.
  - Fix: Extract the two conditions into helpers isPartOfNameRun(i, isAnchor, words) and isPrecededByTrigger(i, words), then simplify the main loop to flagged[i] = isPartOfNameRun(...) || isPrecededByTrigger(...).
- **[low·conf 2/3]** Finance threshold magic numbers hardcoded inline instead of named constants
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:96-100`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:436`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:628`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:667`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:708`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:746-747`
  - recomputeDerived contains magic numbers scattered inline: the 72-hour anomaly cooldown (72 * 60 * 60 * 1000 at line 436), savings percent milestones ([25,50,75,100]), a day-of-month check, and other date math. Some thresholds are named consts (DEBOUNCE_MS, MAX_DUMP_LEN, SAVINGS_LEDGER_CAP) but tuning values are inconsistently inlined, making them hard to find and adjust.
  - Fix: Consolidate configurable thresholds into a single FINANCE_THRESHOLDS config object at module top (e.g. { cooldownMs: 72*3600*1000, savingsPercentMilestones: [25,50,75,100], ... }) with a named ANOMALY_COOLDOWN_HOURS, and allow injection via orchestrator options so tests can override.
- **[low·conf 1/3]** Stale audit-task comment in dispatchAction contradicts implemented schema
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:24-25`
  - The jsdoc at lines 24-25 describes 'Audit-task 1 (2026-05-14): work + goals routes populate ... so the W-*/G-* pattern detectors see the data' as future work, but the code at 929-947 (work meetings) and 954-961 (goals) already writes the correct schema. The comment is stale and misleading.
  - Fix: Delete the audit-task comment if the schema is complete, or update it to specify remaining work and link to a tracking issue.
- **[low·conf 1/3]** Stale taxProfile TODO comments in finance.ts reference an unshipped feature
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:154-159`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:449-451`
  - Comments at lines 154-159 and 449-451 refer to finance.taxProfile as a future onboarding-UI-driven feature with fallback logic already in place, creating confusion about whether the feature exists or is blocked.
  - Fix: Either implement and remove the TODOs if the feature now ships, or restate the comments to clearly mark the feature deferred with a linked tracking issue number.
- **[low·conf 1/3]** Magic number 30 * 60_000 for default work meeting duration
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:935`
  - Work meetings are created with end_at = ts + 30 * 60_000 (30 minutes) as an unexplained literal; the intent (default meeting length) is only inferable from context.
  - Fix: Add a module-level constant DEFAULT_WORK_MEETING_DURATION_MS = 30 * 60 * 1000 and use it at line 935.
- **[low·conf 1/3]** Legacy work detectors still exported from legacy.ts
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/work/index.ts:14`
  - index.ts re-exports detectDeepFocusHours and detectPacingBreach from ./legacy ('W0 legacy', 'pre-dates consent gate convention, behavior preserved verbatim'), suggesting deprecated code that may no longer be used after the pattern-system refactor.
  - Fix: Audit whether the W0 detectors are emitted anywhere. If unused, remove legacy.ts, the exports, and references in patterns.ts; if still used, drop the 'legacy' label and add an explicit deprecation note with a removal timeline/issue.
- **[low·conf 1/3]** Incomplete partner signal implementation left as a TODO stub
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/partner/repo.ts:1`
  - The partner repo contains a TODO(signals) noting it should be replaced with a real read of the user's mood/energy/cycle/body data, indicating signal detection is stubbed/incomplete technical debt.
  - Fix: Either complete the implementation by reading actual mood/energy/cycle/body data from the store, or document the blocker explicitly with a linked issue and removal date.
- **[low·conf 1/3]** Layer-1 router SYSTEM_PROMPT is a ~10k-char inline string literal with no bound guard
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:44-145`
  - SYSTEM_PROMPT is a ~102-line, ~10,000-character embedded string defining the brain-dump router behavior. While embedding prompts is reasonable, it makes the file harder to read/edit, and the only guardrail against bloat is a runtime length log with no build-time enforcement.
  - Fix: Optionally extract the prompt to its own file and import it, and add a test/build-time assertion (e.g. SYSTEM_PROMPT.length < 8000) to catch prompt bloat during development.
- **[low·conf 1/3]** DEV-only test-milk button in GroceryBox has no removal criteria
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:17`
  - The GroceryBox docstring notes a DEV-only 'insert test milk' button stays, but provides no removal timeline or issue reference, risking it shipping to production.
  - Fix: Remove the button, or add a dated/issue-linked TODO for cleanup, or gate it behind an environment variable (e.g. process.env.GROCERY_DEV_MODE).

### Linting & Config Hygiene — 13 issue(s)

- **[high·conf 2/3]** Package tsconfigs do not extend tsconfig.base.json, causing strict-setting drift
  - Files: `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json`, `/Users/serrayildirim/ollie/packages/worker-http/tsconfig.json`, `/Users/serrayildirim/ollie/packages/apns-jwt/tsconfig.json`, `/Users/serrayildirim/ollie/workers/apns-push/tsconfig.json`, `/Users/serrayildirim/ollie/apps/native/tsconfig.json`, `/Users/serrayildirim/ollie/tsconfig.base.json`
  - Several packages define standalone tsconfig.json files that do not set "extends": "../../tsconfig.base.json" and instead duplicate (partial) base settings. This causes drift from the canonical strict config. Verified against the repo: crisis-lexicon omits forceConsistentCasingInFileNames, noFallthroughCasesInSwitch, noImplicitReturns, and jsx; workers/apns-push and apps/native both omit forceConsistentCasingInFileNames; packages apns-jwt and worker-http carry noFallthroughCasesInSwitch and noImplicitReturns but still omit forceConsistentCasingInFileNames. The missing forceConsistentCasingInFileNames allows case-sensitivity import bugs that pass on macOS dev machines but fail on case-sensitive Linux CI. Missing noFallthroughCasesInSwitch (where applicable) allows unintended switch fall-through. Each diverging config is its own future maintenance hazard since base changes won't propagate.
  - Fix: Make every package/app/worker config extend ../../tsconfig.base.json and remove duplicated compilerOptions, keeping only genuinely package-specific overrides (e.g. types: [@cloudflare/workers-types], noEmit, lib). Where extending is incompatible (e.g. apps/native Vite/Tauri setup), explicitly re-add the missing base settings — at minimum forceConsistentCasingInFileNames: true everywhere, plus noFallthroughCasesInSwitch and noImplicitReturns on the worker/lexicon configs.
- **[high·conf 2/3]** noUnusedLocals/noUnusedParameters enabled only in apps/native, not in tsconfig.base.json
  - Files: `/Users/serrayildirim/ollie/tsconfig.base.json`, `/Users/serrayildirim/ollie/apps/native/tsconfig.json`, `/Users/serrayildirim/ollie/packages/logic/tsconfig.json`
  - Only apps/native/tsconfig.json sets noUnusedLocals: true and noUnusedParameters: true. All other packages inherit tsconfig.base.json, which does not set these flags, so TypeScript-level unused-variable checking is inconsistent across the monorepo. Packages silently allow unused locals/params while the native app catches them. The ESLint rule @typescript-eslint/no-unused-vars exists but only at warn level (verified in eslint.config.mjs), so unused vars are not a hard failure outside native. This is a distinct root problem from configs not extending base.
  - Fix: Add noUnusedLocals: true and noUnusedParameters: true to tsconfig.base.json so all packages get consistent compile-time checking, or deliberately document why they are intentionally omitted. Additionally, since lint only warns, ensure pnpm lint failures (or these warnings) block CI if you rely on lint to catch unused vars.
- **[high·conf 1/3]** shelf-life.ts: empty interface with stale eslint-disable referencing a removed rule
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/shelf-life.ts:34-35`
  - export interface ShelfLifeEnv {} is an empty interface guarded by `// eslint-disable-next-line @typescript-eslint/no-empty-interface`. The no-empty-interface rule has been removed/renamed in current @typescript-eslint, so the directive is stale/unused, while the empty interface itself would now trip @typescript-eslint/no-empty-object-type. The accompanying comment claims the interface form is needed so callers can union the env shape, but the disable target is wrong.
  - Fix: Either replace with `export type ShelfLifeEnv = Record<string, never>;`, or if the interface form is intentional, update the directive to the current rule: `// eslint-disable-next-line @typescript-eslint/no-empty-object-type`.
- **[medium·conf 1/3]** Unused eslint-disable no-console directives (rule not configured)
  - Files: `/Users/serrayildirim/ollie/apps/native/src/lib/formatRelativeTime.ts:135`, `/Users/serrayildirim/ollie/apps/native/src/store.ts:80`, `/Users/serrayildirim/ollie/apps/native/src/store.ts:134`, `/Users/serrayildirim/ollie/apps/native/src/store.ts:142`
  - Multiple `// eslint-disable-next-line no-console` directives exist (one in formatRelativeTime.ts, three in store.ts), but no-console is not configured anywhere in eslint.config.mjs (verified). The directives are therefore inert noise; if reportUnusedDisableDirectives is enabled they would themselves be flagged.
  - Fix: Remove all four unused eslint-disable no-console comments. If suppressing console output is genuinely desired, add a real no-console rule to eslint.config.mjs first; otherwise drop the directives.
- **[medium·conf 1/3]** Unused destructured variable 'calls' in cadence-scanner test
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/tests/cadence-scanner.test.ts:235`
  - `const { backend, calls } = makeBackend();` destructures calls, which is never referenced in the 'picks the right copy template per module' test body (verified: calls appears only on the destructure line). This violates @typescript-eslint/no-unused-vars (warn level, varsIgnorePattern ^_).
  - Fix: Drop calls from the destructure (`const { backend } = makeBackend();`) or, if intentionally kept, prefix with underscore to match the configured varsIgnorePattern.
- **[medium·conf 1/3]** Unused test helper function 'makeVoyageOk'
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/tests/route.test.ts:45`
  - function makeVoyageOk(): FetchMockFn is defined but never called (verified: the only occurrence in the file is the definition itself). This is dead test scaffolding that trips @typescript-eslint/no-unused-vars.
  - Fix: Remove makeVoyageOk if obsolete, or prefix with underscore (_makeVoyageOk) if intentionally retained as reference, or wire it into a test that needs a successful Voyage mock.
- **[medium·conf 1/3]** ESLint flat config ignores all *.config files and tools/, leaving plugin/config code unlinted
  - Files: `/Users/serrayildirim/ollie/eslint.config.mjs:32`
  - eslint.config.mjs globally ignores '**/*.config.{js,mjs,cjs,ts}' and 'tools/**'. This is intentional (build tooling), but it means the local eslint-plugin-ollie source (tools/eslint-plugin-ollie/index.cjs) and any config files are never linted, so that code can drift from standards. Since the plugin enforces the voice-library banned-copy rule, regressions in it would silently weaken a production-critical guard.
  - Fix: Add a brief comment in eslint.config.mjs documenting why these globs are ignored. If the eslint-plugin-ollie source is production-critical, add a dedicated lint pass (or unit tests, which already exist for the banned-phrases scanner) covering tools/eslint-plugin-ollie/index.cjs.
- **[low·conf 1/3]** crisis-lexicon moduleResolution casing differs from base ('bundler' vs 'Bundler')
  - Files: `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json:5`, `/Users/serrayildirim/ollie/tsconfig.base.json:4`, `/Users/serrayildirim/ollie/apps/native/tsconfig.json:10`
  - crisis-lexicon (and apps/native) use lowercase moduleResolution: 'bundler' while tsconfig.base.json uses 'Bundler'. TypeScript treats this case-insensitively so there is no functional bug, but the inconsistency is avoidable noise. This is mostly subsumed by the broader 'configs don't extend base' issue (extending base would eliminate the divergence).
  - Fix: Standardize on the base spelling ('Bundler'), ideally by having configs extend tsconfig.base.json so the value is inherited rather than re-declared.
- **[low·conf 1/3]** Inconsistent tsconfig include patterns across packages (non-recursive vs recursive globs)
  - Files: `/Users/serrayildirim/ollie/packages`
  - Some packages use non-recursive include patterns like ["src", "tests"] (api, apns-jwt, cadence, events, logic, orchestrator, store, worker-http) while others use recursive globs ["src/**/*", "tests/**/*"] (auth, consent, crypto, notifications, pii-scrub, research-stream, sync). Works today due to flat directory layouts but risks silently missing files if subdirectories are added.
  - Fix: Standardize on recursive globs ["src/**/*", "tests/**/*"] across all package tsconfigs to prevent future include gaps.
- **[low·conf 1/3]** Inconsistent explicit rootDir declarations across packages
  - Files: `/Users/serrayildirim/ollie/packages`
  - Some packages that extend base explicitly set rootDir: "." (auth, consent, crypto, notifications, pii-scrub, research-stream, sync) while others omit it (api, apns-jwt, cadence, crisis-lexicon, events, logic, orchestrator, store, worker-http). Since "." is the default, this is cosmetic but reduces clarity.
  - Fix: Either remove the redundant rootDir: "." from packages that match the default, or standardize on always declaring it. Document the chosen convention.
- **[low·conf 1/3]** Inconsistent outDir handling in noEmit packages
  - Files: `/Users/serrayildirim/ollie/packages`
  - Packages with noEmit: true (apns-jwt, consent, crisis-lexicon, pii-scrub, worker-http) vary in whether they specify outDir. With noEmit no files are emitted so outDir is irrelevant, but the inconsistent presence/absence across noEmit packages is confusing.
  - Fix: Standardize: omit outDir for all noEmit packages (and optionally add a one-line comment noting it is intentionally omitted), or keep it everywhere. Pick one convention.
- **[low·conf 1/3]** Redundant explicit strict: true in child tsconfigs
  - Files: `/Users/serrayildirim/ollie/packages/apns-jwt/tsconfig.json`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json`, `/Users/serrayildirim/ollie/packages/worker-http/tsconfig.json`
  - apns-jwt, crisis-lexicon, and worker-http declare strict: true even though tsconfig.base.json already enforces it. Note: this only counts as 'redundant' for configs that extend base; per the higher-severity finding these configs currently do NOT extend base, so today the declaration is actually load-bearing. Once they extend base it becomes removable duplication.
  - Fix: After converting these configs to extend tsconfig.base.json, remove the redundant strict: true. If not extending, leave it.
- **[low·conf 1/3]** No dedicated lint CI gate; lint runs inside the build job without explicit visibility
  - Files: `/Users/serrayildirim/ollie/.github/workflows/ci.yml:36`
  - CI runs `pnpm lint` inside the combined 'typecheck + test' build job (verified: typecheck, lint, test run sequentially). It does block the job on failure, but there is no dedicated lint job or artifact, reducing visibility in PR reviews and coupling lint to the broader build step. Lint warnings (e.g. the warn-level no-unused-vars) would not fail CI.
  - Fix: Optionally split lint into its own CI job for visibility/artifacts. More importantly, decide whether warn-level rules (no-unused-vars, exhaustive-deps) should be errors so they actually gate PRs, since today they pass CI.

### Dump Routing Flow Correctness — 6 issue(s)

- **[critical·conf 2/3]** remindIn hint silently lost when low-confidence fragments are demoted to dump_only
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:281`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:338`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:342`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:67-89`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:100`
  - When a classified fragment has confidence < 0.60, applyConfidencePolicy (dump-schema.ts:79-88) demotes it to dump_only and wraps the original payload inside a nested originalGuess object: { module:'dump_only', payload:{ action:'archive_only', reason:'low_confidence', originalGuess:{ module, payload } } }. injectScheduledAt is then called on tiered.payload (dump.ts:285 cache path, dump.ts:342 AI path), but that wrapper has no top-level remindIn — any time-deferred reminder is now buried at tiered.payload.originalGuess.payload.remindIn and is silently discarded. Users' 'remind me in N' requests on low-confidence fragments never schedule a notification, and the classifier system prompt's stated rule (dump-classify.ts:100, 'never dump_only when remindIn present') is unenforceable because applyConfidencePolicy has no awareness of remindIn and will demote regardless. Verified against source: the nesting and the immediate injectScheduledAt call both exist as described.
  - Fix: Resolve remindIn -> scheduledAtMs BEFORE applying the confidence policy, OR have applyConfidencePolicy detect a remindIn field and either preserve the original classification or hoist remindIn to the top level of the demoted payload. Either way, never discard remindIn when moving a fragment between confidence tiers, and align the system-prompt rule with the actual enforcement.
- **[critical·conf 1/3]** Non-numeric confidence coerced to 0, triggering spurious demotion and data loss
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:200`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:231`
  - When the LLM returns a non-numeric confidence (string, null, undefined), the parser silently coerces it to 0 (dump-classify.ts:200 single-result, :231 batch-result: `typeof r.confidence === 'number' ? r.confidence : 0`). Confidence 0 falls below the 0.60 threshold, so applyConfidencePolicy demotes an otherwise-correctly-classified fragment to dump_only.archive_only with the real routing buried in originalGuess. The user loses the correct routing; the fragment is archived instead of acted on. Verified in source.
  - Fix: Do not default to 0. Prefer throwing so the provider cascade can fall through to the next provider, or at minimum log a warning and default to a mid-range value (e.g. 0.65, the needs-confirm band) so a parse glitch does not masquerade as a low-confidence verdict.
- **[high·conf 2/3]** Voyage embedding indices not bounds-checked, producing a sparse embeddings array
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:449-459`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:456-457`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:276`
  - voyageEmbedBatch pre-allocates out = new Array(texts.length) and assigns each embedding to out[slot] where slot = row.index (or array position as fallback) at dump.ts:456-457. There is no validation that row.index falls within [0, texts.length), nor a post-loop check that every slot is filled. If Voyage returns out-of-bounds, duplicate, or skipped indices, out becomes sparse with undefined holes. The only existing guard (line 446) checks rows.length === texts.length and per-row embedding dimension, but not index contiguity. Downstream, embeddings[i] (dump.ts:276) can then be undefined, which is passed to cacheLookup (silently treated as a cache miss, re-classifying the fragment every request) and to cacheHitBump. Confirmed in source.
  - Fix: Validate each index: if (typeof row.index !== 'number' || row.index < 0 || row.index >= texts.length) throw. After the forEach, assert no slot is undefined (e.g. for each j, throw if out[j] === undefined). Alternatively ignore row.index entirely and assign strictly by input order since the response is documented as input-ordered.
- **[high·conf 1/3]** Cache TTL broken on every hit: cacheHitBump drops createdAt
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:171-186`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:101-102`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:156`
  - cacheUpsert writes createdAt (vectorize.ts:156), but cacheHitBump re-upserts the entry on every cache hit WITHOUT createdAt (metadata block at lines 175-183 omits it). cacheLookup reads `const createdAt = typeof meta.createdAt === 'number' ? meta.createdAt : 0` (line 101) then evicts when `Date.now() - createdAt > TTL_MS` (line 102). After the first hit, createdAt is gone, so it defaults to 0 and `Date.now() - 0` always exceeds the 30-day TTL — every previously-hit entry is treated as expired and dropped, defeating the cache for exactly the popular entries it should retain (and breaking the intended 30-day eviction semantics). Confirmed in source. Note: the effect is premature eviction, not the indefinite reuse one round hypothesized, but the createdAt-loss bug is real either way.
  - Fix: Preserve createdAt in cacheHitBump by threading the original createdAt through CacheRow and including it in the upsert metadata, or restructure so hit-count bumps update in place without overwriting createdAt.
- **[medium·conf 1/3]** No log emitted when remindIn is structurally lost via demotion
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:285-291`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:342-348`
  - The router warns only when injectScheduledAt returns status==='dropped' (malformed/out-of-range remindIn) at dump.ts:286-291 and :343-348. When a fragment is demoted to dump_only and its remindIn ends up nested in originalGuess, injectScheduledAt finds nothing at the top level and returns 'absent' — no warning is logged. This is the exact silent-data-loss path, yet it produces no operational signal, giving a false sense of correctness. Confirmed against source.
  - Fix: After applyConfidencePolicy demotes a fragment, inspect originalGuess.payload for remindIn and emit an explicit warning if present (ideally as part of fixing the demotion data loss itself).
- **[medium·conf 1/3]** Missing integration test for remindIn under the low-confidence demotion path
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/tests`
  - remindIn injection is unit-tested in isolation and low-confidence demotion has its own fixtures, but no test combines them — i.e. a fragment carrying 'remind me to X in N' classified at confidence < 0.60. This gap is why the critical silent-loss bug went undetected.
  - Fix: Add integration tests in the dump router suite covering: remindIn preserved when confidence >= 0.60; defined behavior (preserved or explicitly logged-and-dropped) when confidence < 0.60; and cache hits carrying remindIn across confidence tiers.

### Algorithms Correctness & Efficiency — 14 issue(s)

- **[high·conf 1/3]** Incorrect summary truncation logic in rule-based journal extraction
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:140-145`
  - Summary generation maps each sentence-break delimiter to its index (or 80 if absent/out-of-range) then takes Math.min(80, ...indices), returning the SMALLEST index. The reporting round argues this truncates summaries at the earliest break rather than the intended first sentence break within the first 80 characters, potentially losing content. (Note: depending on intended semantics, `Math.min` may actually select the first sentence end, which can be correct — confirm desired behavior before changing.)
  - Fix: If the intent is the latest break before position 80, filter breaks under 80 and take the maximum: `const breaks = [80, ...(['. ', '? ', '! ', '\n'].map(s => { const idx = trimmed.indexOf(s); return idx > 0 && idx < 80 ? idx : -1; }).filter(x => x >= 0))]; const firstBreak = Math.max(...breaks);`. Otherwise document that Math.min selects the first sentence end.
- **[high·conf 1/3]** phaseForDay produces incorrect phase boundaries for short cycles (<23 days)
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:48-52`
  - phaseForDay uses fixed offsets (cycleLengthDays - 18 for follicular, cycleLengthDays - 13 for ovulation). For short cycles (<23 days) these produce nonsensical assignments: a 21-day cycle gives cycleLengthDays - 18 = 3, so the follicular band collapses (days 1-5 are already menstrual), violating the menstrual→follicular→ovulation→luteal sequence.
  - Fix: Guard short cycles: `if (cycleLengthDays < 21) return 'unknown';` before the calculations, or scale boundaries proportionally to cycle length (e.g. menstrual [1,5], follicular [6, cycleLengthDays-13], ovulation [cycleLengthDays-12, cycleLengthDays-7], luteal [cycleLengthDays-6, cycleLengthDays]).
- **[high·conf 1/3]** matchItem substring matching too permissive — allows false-positive mutation targets
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:111-122`
  - matchItem matches via bidirectional substring inclusion (`a.includes(b) || b.includes(a)`) with no minimum-length check (only empty-string guard). This permits dangerous false positives like 'rice'⊃'ice', 'chocolate'⊃'late', 'pasta'⊃'a'. For mutation operations (remove/check/move_to_pantry) a false match causes silent data loss or misrouting when the AI returns a short/unusual canonical or name. The 'intentionally permissive' comment justifies plural handling (eggs↔egg) but lacks any length floor.
  - Fix: Require a minimum matched substring length before accepting a substring match, e.g. only accept when the shorter string is >= 3 chars (or >= 50% of the shorter string). Keep the exact-canonical match path as the preferred fast path.
- **[medium·conf 2/3]** O(n²) deduplication in brain noticing selection (nested findIndex inside filter)
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:335`
  - Candidate deduplication uses `.filter((c, i, arr) => arr.findIndex((o) => o.id === c.id) === i)`. For each element, findIndex re-scans the whole array, giving O(n²) complexity. With the current MAX_NOTICINGS cap of 3 this is not a practical concern, but as candidate lists grow (hundreds of items) it becomes inefficient.
  - Fix: Replace with Set-based O(n) dedup: `const seen = new Set(); const deduped = candidates.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })`.
- **[medium·conf 1/3]** Timezone-dependent cadence dedupe key can fire duplicate notifications across timezone changes
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:232-239`
  - localDayKey builds the dedupe key from getFullYear/getMonth/getDate (LOCAL time). If a user crosses a timezone boundary and a cadence scan runs in a different local calendar day on the same UTC day, the key differs and the same noticing can fire twice. The 24h dedupe window in notify() may not catch this when scans are <24h apart in UTC but on different local days.
  - Fix: For multi-timezone support, derive the key from UTC calendar day (getUTCFullYear/getUTCMonth/getUTCDate). Otherwise add a comment documenting that localDayKey assumes a stable timezone and is safe only for browser-side single-timezone use.
- **[medium·conf 1/3]** Grocery mutation regex fails to match common natural phrasings like 'threw it out'
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`
  - MUTATION_RE includes 'threw out' but the `\b` boundary means 'I threw it out' does NOT match (only 'threw out [item]' does). Such inputs are not recognized as mutations, so a synchronous placeholder add is written and a later AI result with action='remove' is treated as an 'add' path, potentially duplicating items.
  - Fix: Broaden the alternation to cover intervening pronouns/phrasings (e.g. 'threw|threw it|threw them|threw out') or loosen the trailing boundary; extend test fixtures with common phrasings in EN/ES/TR.
- **[low·conf 1/3]** phaseFold has O(n*m) complexity scanning all cycles per event
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/patterns/phase-fold.ts:62-82`
  - phaseFold loops over every event and, for each, linearly scans cycles until a match (with a break). With n events and m cycles this is O(n*m). Acceptable for typical runs (<50 cycles, <1000 events) but optimizable given cycles are sorted by start timestamp.
  - Fix: Use binary search over the sorted cycles to locate the containing cycle per event, reducing to O(n*log m). Only needed if profiling shows it matters.
- **[low·conf 1/3]** DAY_MS constant duplicated across modules instead of shared import
  - Files: `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:154`, `/Users/serrayildirim/ollie/packages/cadence/src/recurring.ts:78`, `/Users/serrayildirim/ollie/packages/brain/src/brain/harm.ts:23`
  - DAY_MS (24*60*60*1000 / 86_400_000) is redefined in multiple modules rather than imported from @ollie/logic/util, creating maintenance burden and drift risk.
  - Fix: Import DAY_MS from @ollie/logic/util in all three modules.
- **[low·conf 1/3]** createdAt tiebreak in selection uses POSITIVE_INFINITY sentinel for missing values
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:342-345`
  - When createdAt is missing, Number.POSITIVE_INFINITY is used as default. Two missing values tie, falling through to id.localeCompare, which may yield unintuitive ordering. Not incorrect, but the sentinel intent is undocumented.
  - Fix: Add a comment explaining missing createdAt is treated as 'least recently created', or ensure the gatherer always populates createdAt.
- **[low·conf 1/3]** medianAmountOf empty-input safety is implicit (guard present but undocumented)
  - Files: `/Users/serrayildirim/ollie/packages/cadence/src/recurring.ts:174`
  - medianAmountOf accesses sorted[mid-1]/sorted[mid] after filtering; it is protected by `if (values.length === 0) return null;` but the safety relies on that guard not being removed.
  - Fix: Add a clarifying comment (`// Guard above ensures values.length > 0`) to document the invariant.
- **[low·conf 1/3]** Fertile-window widen factor rounding may introduce ±0.5 day error for high SD
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/cycle/prediction.ts:103-109`
  - `const widen = Math.max(0, Math.round(layer1.sd - 2))` rounds before widening. For sd<2.5 widen=0 (always 7-day window, reasonable); for sd>7 rounding can introduce ±0.5 day error in the confidence window. Clinically minor since cycle windows are inherently ±1 day.
  - Fix: If precision matters, keep fractional days (`const widen = Math.max(0, layer1.sd - 2)`) and allow number in FertileWindowDays; otherwise document the rounding behavior in a comment.
- **[low·conf 1/3]** Grocery replenishment soonestOutMs tracked sequentially during pantry scan
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:140-175`
  - detectReplenishNeeded iterates all pantry items tracking soonestOutMs sequentially. O(n) and correct; the round itself notes no change is needed for typical pantries (<100 items).
  - Fix: No change needed. If later profiling flags it, sort the needed array by predictedOutAtMs once and take sorted[0] instead of maintaining soonestOutMs during iteration.
- **[low·conf 1/3]** Deferability resolver contract for [0,1] range not enforced at type level
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:193-203`
  - resolvedDeferability clamps learned values to [0,1] only when finite. scoreNoticing's urgencyWeight assumes deferability is always in [0,1]. If a future learned-map resolver returns NaN/Infinity before the clamp, or the clamp is removed, scoring produces invalid weights. A fragility for the Sprint 4 learned-map feature rather than a current bug.
  - Fix: Enforce the contract at the type or runtime level (e.g. an enum-like `0 | 0.5 | 1` resolver type, or a documented assertion that resolvers must return a number in [0,1] or null/undefined).
- **[low·conf 1/3]** Cadence nextExpectedTs computed for low-data confidence can show spurious overdue dates
  - Files: `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:147`
  - When CV demotion sets confidence='low-data' (CV > threshold but sampleSize >= 2), nextExpectedTs is still computed as lastTs + medianIntervalMs from an unreliable median. This can produce false 'overdue' results for highly irregular patterns.
  - Fix: Return nextExpectedTs=null when confidence==='low-data' even if medianIntervalMs is non-zero: `nextExpectedTs: confidence === 'low-data' ? null : (lastTs + medianIntervalMs)`.

### State & Store Consistency — 18 issue(s)

- **[high·conf 1/3]** Orphaned admin:* cue events emitted with zero consumers
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:196-250`, `/Users/serrayildirim/ollie/packages/orchestrator/src/orphan-cue-bridge.ts:38-46`
  - The admin orchestrator emits ~15 cue events that have no events.on() listeners anywhere: admin:appointment_completed, admin:cost_of_delay, admin:decision_recall, admin:defer_chain, admin:doc_refs, admin:ef_scaffold, admin:firehose_dump, admin:last_5pct, admin:open_loop_missing, admin:paperwork_split, admin:recurring_pattern, admin:renewal_cue, admin:schedule_drift, admin:stale_ball, admin:two_minute_tasks. They are not in BRIDGED_CUE_EVENTS in orphan-cue-bridge.ts (which covers only 7 events). The detection work runs but the results fall to the floor with no consumer to record, surface, or act on them.
  - Fix: Either add the 15 admin:* events to BRIDGED_CUE_EVENTS (with enum entries in BridgedCueEvent) so they are captured by the telemetry tap, or implement real consumers (APNs, store writes, data pipeline) for each. Otherwise the admin orchestrator's pattern detection is wasted compute.
- **[high·conf 1/3]** 42+ additional orphaned cue events across finance/grocery/goals/habits/work/sleep/body/pets/burhan/cycle
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src`, `/Users/serrayildirim/ollie/packages/orchestrator/src/orphan-cue-bridge.ts:38-46`
  - Beyond the admin orphans, ~42 other cue events are emitted but never listened to. Examples: finance (adhd_tax_candidate_detected, anomaly_detected, bill_due_predicted, spending_spike_detected, subscription_detected, etc.), grocery (interest_capture_detected, pattern_detected, routed, routing:pending), goals (pattern_detected), habits (completed, luteal_collapse_detected, morning_check, pattern_detected), work (hyperfocus_detected, matters_routed, pattern_detected), sleep (debt_accumulated, pacing_breach_detected, short_sleep_run_detected, wind_down_window), body (hydration_drop_detected, posture_nudge, supplement_due, weekly_review), pets (guilt_copy_generated, health_flag_raised), burhan (add_leaf, element_added), cycle (luteal_phase_entered, period_logged, pill_missed). Union of ~80 emitted events minus ~34 listened = ~46 orphans. Some are partially wired (one consumer), but most fall through with no tracker/bridge/APNs hook, and registry comments overstate consumption.
  - Fix: Extend orphan-cue-bridge.ts BRIDGED_CUE_EVENTS to capture all remaining cues under a unified telemetry tap (the emit -> ring-buffer pattern scales for free per emitter), or implement per-event consumers. Reconcile the misleading consumption claims in registry.ts comments with reality.
- **[high·conf 1/3]** Sleep orchestrator reads sleep.debt with wrong field name (debt_hours vs totalDeficitHours), silently disabling pacing-breach detection
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/sleep.ts:379-382`
  - The sleep orchestrator writes the computeSleepDebt result as-is ({ totalDeficitHours, nightsCounted }) into sleep.debt, but then reads it back expecting a debt_hours field: line 379 `store.get<{ debt_hours?: number } | null>('sleep','debt',null)`, line 381 `const debtHrs = debt?.debt_hours ?? 0`. Since debt_hours never exists on the written object, debtHrs is always 0, so the threshold at line 382 (`if (debtHrs >= 4 ...`) never trips and sleep:pacing_breach_detected never fires correctly. Verified against source. (Note: this is a distinct root cause from the orphaned-event finding — even when fixed, that event still has no consumer.)
  - Fix: Read the correct field: change line 381 to `const debtHrs = debt?.totalDeficitHours ?? 0` and update the type annotation on line 379 to { totalDeficitHours?: number; nightsCounted?: number }. Re-verify the >=4 / >=8 thresholds make sense against the totalDeficitHours value range.
- **[high·conf 1/3]** finance.settings is a one-way mirror that drops UI-modified settings on the next bridge sync
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/finance/bridge.ts:164-169`
  - The native finance bridge only seeds finance.settings when null and otherwise relies on orchestrator DEFAULT_SETTINGS, but never reads or merges user-configured settings (currency, month_anchor, etc.) back from a persistent store. Any settings edited in the UI are lost on the next bridge sync because there is no finance settings SQLite table for the bridge to read from. This is a silent one-way mirror.
  - Fix: Persist settings: add a finance_settings SQLite table (or read the existing store value before seeding defaults) so the bridge preserves UI edits across syncs instead of overwriting them with defaults.
- **[high·conf 1/3]** finance.taxProfile read by orchestrator but never written by any bridge or onboarding path
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:921-952`
  - The finance orchestrator reads finance.taxProfile.selfEmployed (line 930) to drive tax set-aside logic, but no bridge or code path writes finance.taxProfile (TODOs at lines 921-929 confirm the onboarding UI was never built). It always falls back to non-self-employed, so self-employed users get silently wrong tax set-aside results. Verified against source.
  - Fix: Add a finance_settings/finance_profile SQLite table with a self_employed (and optional calculator) flag and mirror it into finance.taxProfile in the bridge. Until that UI exists, at minimum seed finance.taxProfile with { selfEmployed: false } in the orchestrator init so the contract is explicit.
- **[medium·conf 2/3]** Orchestrator-internal dedup keys persisted to store with no external reader/writer (incl. finance _recurringCandidatesConfirmed/Dismissed)
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src (scattered across all orchestrators)`, `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:337-338`, `/Users/serrayildirim/ollie/packages/orchestrator/src/dedup-store.ts`, `/Users/serrayildirim/ollie/packages/orchestrator/src/body.ts:195,273`, `/Users/serrayildirim/ollie/packages/orchestrator/src/work.ts`, `/Users/serrayildirim/ollie/packages/orchestrator/src/habits.ts`, `/Users/serrayildirim/ollie/packages/orchestrator/src/sleep.ts`, `/Users/serrayildirim/ollie/packages/orchestrator/src/cycle.ts`
  - The orchestrators write many private dedup-tracking keys to the shared store (e.g. _predictionEmittedKeys, _anomalyEmittedIds, _billDuePredictedIds, _recurringCandidatesEmitted, _recurringCandidatesConfirmed, _recurringCandidatesDismissed, _staleSubEmittedIds, _morningCheckEmittedDay, _debtAccumulatedDay, _windDownWindowDay, _postureNudgeEmittedBuckets, _hydrationEmittedAt, _hyperfocusEmittedIds, _pillMissedEmittedDates). These exist purely for intra-orchestrator dedup to avoid re-emitting on every recompute. They are never read by the UI or other modules, polluting the store namespace and complicating schema audits. Verified: finance._recurringCandidatesConfirmed/Dismissed are read at finance.ts:337-338 but only by the finance orchestrator itself; no bridge or UI writes or consumes them, so the confirm/dismiss dedup state never persists from any UI action. If an orchestrator is disabled or recomputed in isolation, this dedup state goes stale and duplicate/orphan events can re-fire.
  - Fix: Move orchestrator-local dedup state into module-scope Maps/WeakMaps inside the orchestrator closure rather than the shared store. Keep only high-level OUTPUT keys (patterns, lastRecomputeAt) in the store. If cross-boot dedup persistence is genuinely needed, use a separate internal storage layer with an explicit '_internal' convention and document the contract. For the finance confirm/dismiss case specifically: either wire an event subscriber that listens for finance:recurring_candidate_confirmed/dismissed and writes these keys, or remove the read since nothing currently populates it from the UI.
- **[medium·conf 1/3]** Sub-orchestrator init() registers event listeners with no idempotency guard (double-subscribe on re-init)
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:273-312`, `/Users/serrayildirim/ollie/packages/orchestrator/src/dump.ts:59,99-105`
  - RootOrchestrator.init() calls init() on all 14+ sub-orchestrators, each registering listeners via events.on(). There is no uniform guard checking whether init() already ran. If init() is called twice (dev hot-reload, accidental app re-boot), every listener is registered again, causing events to be processed twice, colliding state writes, and duplicated notifications. Sub-orchestrators keep an unsubs[] array but never verify it is empty before re-subscribing.
  - Fix: Add a uniform initialized flag to createOrchestrator and each sub-orchestrator that returns early on a second init(), or make init() idempotent by unsubscribing before resubscribing. Document the init/teardown contract: init() once, teardown() before any re-init.
- **[medium·conf 1/3]** Watcher tick may observe stale store data between SQLite write and bridge sync (fire-and-forget dispatch)
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:89-109`
  - The dispatch path fires runAllSyncs and recomputeBrain as non-awaited promises (line 95-96 `void Promise.all([...])`) to keep the dump ack/UI responsive. This means a watcher subscribe callback can fire after a SQLite write but before the corresponding bridge sync lands, so a watcher reads stale store data for one tick (e.g. dump writes work.focus_log, habits watcher reads work.focus_log before the work bridge runs). The trade-off is documented at lines 89-94 but the race remains observable.
  - Fix: Documented design trade-off. Mitigate by ensuring modules tolerate stale/empty inputs (most already use ?? [] defaults), or for timing-sensitive pattern detection subscribe after the sync completes rather than on direct store changes. Measure real-world impact before changing the architecture.
- **[medium·conf 1/3]** cycle.lastEditedByCycle always written empty; 72h recent-edit suppression never fires
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:150`
  - The cycle bridge always writes cycle.lastEditedByCycle as {} (documented gap, fail-open). The orchestrator uses this key to suppress recent-edit health flags for 72h after a user manually logs a period/pill. With no edit timestamps in SQLite, the suppression never triggers, so users see redundant 'period late' / 'missed pill' flags even seconds after logging the event themselves.
  - Fix: Add a last_edited_at column to cycle_events (or a cycle_edits table) and populate cycle.lastEditedByCycle with real edit timestamps so the 72h suppression window works as designed.
- **[medium·conf 1/3]** sleep.windDownLog read-merged with no SQLite owner; stale entries can never be pruned
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:179-180`
  - The sleep bridge read-merges the existing windDownLog (preserving entries) but never reads it from SQLite; the only writer is the sleep:wind_down_step event subscription. Cold start leaves it empty; warm start preserves prior entries forever, and user-deleted steps are never cleared because the bridge has no authoritative source to re-derive from. The docstring flags it but the code leaves the hybrid broken.
  - Fix: Clarify ownership: either make the bridge authoritative by reading wind_down events from SQLite, or have only event subscribers write it and stop the bridge touching it. The current read-merge-without-source creates orphan entries that can never be pruned.
- **[medium·conf 1/3]** sleep.medsLog read-merged but written by no bridge; cross-feed broken, entries never cleared
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/bridge.ts:187-189`, `/Users/serrayildirim/ollie/apps/native/src/modules/medication/bridge.ts`
  - The sleep bridge documents medsLog as fed by a separate medication-module dump flow, but neither the sleep bridge nor the medication bridge actually populates it from SQLite. Cold start leaves it empty (so detectMedicationTimingDrift has no data); warm start preserves prior entries forever with no pruning. The docstring calls it a GAP but the code leaves it broken.
  - Fix: Either wire the medication module to write its dose logs into sleep.medsLog so the timing-drift detector has real data, or remove the read-merge and leave it empty until the cross-feed is built. Document the chosen path so the watcher contract is explicit.
- **[medium·conf 1/3]** pets.coregulation_log read-merged but only appended by dump mood flow, never pruned on dump deletion
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/pets/bridge.ts:160-165`
  - The pets bridge read-merges coregulation_log, documented as fed by the dump mood/pet-mention flow rather than this SQLite mirror. There is no pruning mechanism: appended entries stick forever, and if the user later deletes the originating dump, the coregulation entry stays in the store because the bridge never re-syncs from SQLite.
  - Fix: Define a TTL or cap (e.g. last 100 entries or < 90 days) and apply it in the bridge read-merge, or sync the log from a coregulation_events SQLite table so deletions propagate.
- **[medium·conf 1/3]** admin.phoneTasks store-consistency gap (reported as never-written; actually written but with no UI capture source)
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:530-544`
  - The admin orchestrator reads and writes admin.phoneTasks (verified: store.set at admin.ts:544; read at 539). The round-2 claim that it is 'written nowhere' is inaccurate — the orchestrator itself populates it from detected phone-task clusters. The real residual gap is the lack of a dedicated capture source/UI in apps/native to seed phone tasks (unlike admin.tasks from voice capture), so the cluster may stay empty and admin:phone_reminder_due cues may not surface in practice.
  - Fix: Confirm whether the orchestrator's phone-task clustering has a real input source. If not, either wire a phone-task capture path (voice/manual) into apps/native and mirror it, or remove the empty cue from the admin watcher. The store key itself is already written, so no 'add a writer' fix is needed.
- **[low·conf 1/3]** finance.goals written by orchestrator but not mirrored by native bridge (savings-goal feature dark on native)
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:664,1081`, `/Users/serrayildirim/ollie/apps/native/src/modules/finance/bridge.ts`
  - The finance orchestrator writes finance.goals (line 1081, verified) and reads it internally (line 664) for dedup/goal advancement, but the native finance bridge mirrors records, cancellations, and settings — not goals. On native, finance.goals stays empty because nothing syncs it from SQLite, so the savings-goal feature fails silently there.
  - Fix: Add finance.goals mirroring to apps/native/src/modules/finance/bridge.ts by querying the savings goals table, or explicitly document finance.goals as web-only. If it is meant to work on native, prioritize the bridge sync.
- **[low·conf 1/3]** burhan store keys empty-on-boot: event-driven module with no bridge pre-population
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/burhan.ts:68-69,79`, `/Users/serrayildirim/ollie/apps/native/src/bridge/index.ts`
  - The burhan orchestrator reads/writes burhan.state and burhan.lastAddedAt but has no corresponding native bridge in the SYNCS list. Unlike SQLite-mirrored modules, burhan is event-driven, so on app startup these keys are null until init() and event handlers populate them — an asymmetry that risks a brief window where watchers see empty burhan state.
  - Fix: Either create a burhan bridge that reads state from SQLite (if burhan events are persisted), or explicitly document burhan as append-only/event-driven-only and seed an empty state in init() plus add defensive null handling in consumers.
- **[low·conf 1/3]** body.correlations written by orchestrator but not seeded by native bridge (undefined on cold start)
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:117-118`, `/Users/serrayildirim/ollie/apps/native/src/modules/body/bridge.ts`
  - The body-correlations orchestrator writes body.correlations after its analysis pass, but the native body bridge never initializes it. On cold start, before any correlation pass runs, UI reads of body.correlations return undefined. The watcher eventually populates it, but there is a window where the key does not exist (unlike body.episodes / body.supplements which are pre-seeded).
  - Fix: Initialize body.correlations to [] in the body bridge syncToStore() to match the existing pre-seed pattern, preventing undefined reads on cold start.
- **[low·conf 1/3]** shared.signals has no bridge initialization; empty until body watcher first fires
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/body-signals.ts:138-146`
  - shared.signals is read with a default ([]) by body-signals.ts but has no bridge-based initialization on native; it is only populated by runBodySignalsPass() during body recompute. On cold start it is empty until the body watcher fires. Not a bug given the defensive default, but any consumer expecting it to exist on boot would read empty.
  - Fix: No action required if all consumers use defensive defaults. If any consumer expects signals to exist on boot, seed shared.signals = [] in a bridge initialization or store setup rather than only in the orchestrator.
- **[low·conf 1/3]** Cycle pregnancy flags written before items (ORDER MATTERS) — documented and safe under synchronous store.set
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/cycle/bridge.ts:129-153`
  - The cycle bridge intentionally sets cycle.pregnant and cycle.pregnancyEndTs before cycle.items so the items-subscriber recompute sees correct pregnancy state. Because store.set is synchronous and fires subscribers immediately, the documented ordering is currently safe. The risk is only latent: a future refactor introducing async store writes would break the implicit ordering guarantee.
  - Fix: No change needed now. The orchestrator already reads the pregnancy flag defensively. Keep the defensive read to protect against a future async-store-write refactor, and keep the ORDER MATTERS comment.

### API Contract Consistency — 6 issue(s)

- **[critical·conf 3/3]** CrisisSignal schema mismatch between worker and native client (type/language vs tier/languages/matches)
  - Files: `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:227`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/src/types.ts:61-74`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:323`
  - The native client schema (schema.ts:72-77) defines CrisisSignal as { detected: true; type: 'ideation'|'method_seeking'|'distress'|'panic'; confidence: number; language: 'en'|'es'|'tr' }. But the worker calls detectCrisis() (dump.ts:227) which returns @ollie/crisis-lexicon's actual CrisisSignal — { detected: true; tier: 1|2|3|4; languages: LexiconLanguage[]; matches: Array<{language,tier,pattern,line}> } — and ships it straight through. The native CrisisBanner reads crisis.type and crisis.language (DumpScreen.tsx:323) which do not exist on the real response, so the crisis banner renders undefined values for a safety-critical surface. Verified: crisis-lexicon types.ts:61-74 has no `type`/`confidence`/`language` fields; DumpScreen.tsx:323 reads `crisis.type` and `crisis.language`.
  - Fix: Make @ollie/crisis-lexicon the single source of truth: have the native client import CrisisSignal from @ollie/crisis-lexicon and update DumpScreen.tsx to read crisis.tier / crisis.languages / crisis.matches. (Alternative: transform the lexicon signal to the native shape in the worker before responding, mapping tier→type and languages[0]→language, but a `confidence` source would need to be invented — prefer importing the lexicon type.)
- **[high·conf 3/3]** RoutingSummary.pass2Triggered present in worker output but absent from native schema
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:415`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:58`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:99-104`, `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts:112`
  - The worker always emits pass2Triggered in the summary object (dump.ts:415, declared in dump-schema.ts:58), but the native client RoutingSummary (schema.ts:99-104) defines only moduleCount, cacheHitRate, aiCalls, durationMs — no pass2Triggered. The worker test (dump.test.ts:112) also omits it from its assertion. Not a runtime crash (extra JSON fields are ignored in JS), but it is real schema drift: the contract documentation diverges and the client cannot type-safely access the telemetry. Verified in both schema files.
  - Fix: Pick one direction and make it consistent across all three surfaces: either add pass2Triggered: number to the native RoutingSummary (if the client should surface pass-2 trigger telemetry), or remove it from the worker output and dump-schema.ts. Update workers/ai-proxy/tests/dump.test.ts to match whichever is chosen.
- **[high·conf 3/3]** Fragment.needsConfirm required in worker schema but optional in native schema
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:49`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:91`
  - The worker Fragment schema declares needsConfirm as a required boolean (dump-schema.ts:49) and applyConfidencePolicy (dump-schema.ts:67-89) always populates it. The native Fragment schema declares it optional — needsConfirm?: boolean (schema.ts:91). The contracts disagree: the server always sends the field but the client types it as possibly-undefined, weakening type safety for consumers that validate worker responses against the native schema. Verified in both files.
  - Fix: Make both required, since applyConfidencePolicy always computes a value. Change native schema.ts:91 to needsConfirm: boolean; and confirm any client checks handle the false case (low-confidence confirmed route) as well as true.
- **[high·conf 1/3]** Module 'mood' in routing enum but not registered in worker MODULE_CONFIGS
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:19`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:118-130`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:29`
  - 'mood' is a valid Module value in the enum (dump-schema.ts:19 and native schema.ts:29) and has a full MoodAction union in the native schema (schema.ts:156-159), but the worker MODULE_CONFIGS registry registers only 11 modules (admin, grocery, body, cycle, finance, goals, habits, medication, pets, sleep, work) — no 'mood'. Verified by reading route.ts: the registry object has no mood entry. If the Layer-1 router classifies a fragment as 'mood', the per-module tier-ladder lookup finds no config, risking undefined behavior or a missed escalation path on the worker side.
  - Fix: Either create workers/ai-proxy/src/modules/mood.config.ts with a ModuleConfig and add it to MODULE_CONFIGS in route.ts, or remove 'mood' from the Module enum if mood routing is not yet live on the worker. Cross-check the native mood handler at apps/native/src/modules/mood/* to decide which.
- **[medium·conf 2/3]** Fragment.payload typed as generic Record<string,unknown> in worker vs ActionPayload discriminated union in native
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:46`, `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:88`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:118`, `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/handler.ts:20`
  - The worker defines Fragment.payload as Record<string, unknown> (dump-schema.ts:46), while the native schema defines it as ActionPayload, a discriminated union of 13 per-module action types (schema.ts:88, 112-125). The runtime behavior is fine (plain JS objects are compatible), but the type contract is weak: native code must cast payloads unsafely — `f.payload as { action?: string }` (DumpScreen.tsx:118, also 122/134) and `fragment.payload as GroceryAction` (grocery/handler.ts:20) — losing compile-time exhaustiveness checking that module handlers receive the correct payload shape. Verified in both files; casts confirmed at the cited lines.
  - Fix: Move ActionPayload (and the per-module action unions) into a shared package (e.g. packages/router-schema or an @ollie/router-contract) and import it in both dump-schema.ts and native schema.ts, typing payload: ActionPayload on both sides. This restores compile-time discriminated-union safety in the worker and lets module handlers drop the unsafe casts.
- **[medium·conf 1/3]** dump-schema.ts hand-mirrored from native schema with no automated sync/drift check
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:1-6`
  - The worker dump-schema.ts header explicitly states it is a hand-kept mirror of apps/native/src/router/schema.ts ('Kept in sync by hand for now. Dedup via packages/router-schema/ later'). This manual sync is the root cause that has already produced the other contract mismatches in this audit (CrisisSignal shape, pass2Triggered, needsConfirm optionality, payload typing). No CI/lint check enforces consistency, so future schema edits can silently diverge. Verified: header at lines 1-6.
  - Fix: Build the promised packages/router-schema (or @ollie/router-contract) as a single source of truth imported by both the worker and native, and add a CI check (shared-type compilation or a lint rule) that fails when the contracts drift. This is the structural fix that prevents recurrence of the mismatches above.

### Idempotency & Retry Harness — 13 issue(s)

- **[high·conf 3/3]** enriched_signals INSERT has no idempotency guarantee (no unique constraint on dump_id, plain POST without upsert)
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-365`, `/Users/serrayildirim/ollie/supabase/migrations/20260514000002_enriched_signals.sql:13-28`, `/Users/serrayildirim/ollie/workers/cron/wrangler.toml:58-63`
  - processOne() writes raw_dumps via an idempotent UPSERT (on_conflict=id, prefer=resolution=merge-duplicates) but writes enriched_signals via a plain POST with prefer='return=minimal' and no on_conflict handling. The enriched_signals table itself has only an FK on dump_id (REFERENCES raw_dumps(id)) and no UNIQUE constraint on dump_id. If a crash, network timeout, or Postgres connection drop occurs between the raw_dumps upsert succeeding and the enriched_signals write completing (before the KV/queue entry is cleared), the retry re-runs both writes: raw_dumps merges safely, but enriched_signals creates a duplicate enrichment row for the same dump_id. This pollutes the primary B2B revenue table and skews analytics signal counts. This is true for both the legacy KV-prefix queue path (q:enrich:*, used while the Cloudflare Queues consumer is commented out in wrangler.toml) and, once provisioned, the Queues path — handleEnrichQueueBatch still calls the same unprotected insertEnrichedSignal(). The in-code comment claiming the write 'either fully succeeded or fully failed' does not hold for partial/mid-write failures. Verified: insertEnrichedSignal posts with prefer:'return=minimal' only; the migration defines no unique index on dump_id.
  - Fix: Add a UNIQUE constraint on enriched_signals(dump_id) and change insertEnrichedSignal() to UPSERT (POST with on_conflict=dump_id + prefer=resolution=merge-duplicates), matching the raw_dumps pattern. Resolve this before uncommenting the Cloudflare Queues consumer binding, and test idempotency by simulating a crash after the raw_dumps upsert succeeds on both the KV-prefix and Queues paths.
- **[high·conf 2/3]** scheduled_jobs dedupe unique index is partial (pending-only), so reschedules after a job fires create duplicate rows; upsert sends no on_conflict
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260513000001_scheduled_jobs.sql:47-49`, `/Users/serrayildirim/ollie/packages/notifications/src/server-schedule.ts:72-78`
  - The unique index scheduled_jobs_dedupe_uniq is defined WHERE dedupe_key IS NOT NULL AND status='pending', so the constraint stops applying once a job reaches a terminal status (sent/rejected/muted/failed). When a job with the same dedupe_key is re-enqueued after the prior one fired (e.g. a monthly digest reschedule), the upsert INSERTs a new row instead of merging — violating the idempotency contract that a dedupe_key resolves to one canonical job per user. Compounding this, scheduleServerJob()'s call to api.supabase.rest.upsert() passes no on_conflict target; it relies entirely on the client always sending prefer=resolution=merge-duplicates, which only merges when a matching UNIQUE constraint actually fires — which it won't for terminal rows. Verified: migration WHERE clause is 'where dedupe_key is not null and status = ''pending''.
  - Fix: Make the index unconditional: CREATE UNIQUE INDEX scheduled_jobs_dedupe_uniq ON scheduled_jobs (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL (drop the status predicate). Then have scheduleServerJob explicitly specify the on_conflict target (user_id,dedupe_key) so the upsert merges correctly even after the prior job reaches a terminal status. Test by POSTing a duplicate dedupe_key while a prior job is 'sent'.
- **[high·conf 1/3]** Idempotency-key infrastructure missing across dump/event ingestion (client + telemetry endpoints)
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:91-159`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-224`, `/Users/serrayildirim/ollie/apps/native/src/api/workers.ts:241-248`
  - The dump/event ingestion path has no idempotency key end to end. handleEnrichDump() generates a fresh crypto.randomUUID() per call and queues unconditionally; handleIngestEvent() INSERTs straight to Supabase (retention_events/session_events/module_events) with no dedup; and the client enrichDump() is fire-and-forget via post() with no Idempotency-Key header and no idempotency_key field in EnrichDumpRequest. A client retry after a network timeout or 5xx — for what the user experienced as a single brain-dump — produces duplicate raw_dumps + enriched_signals rows and duplicate telemetry events, because neither server endpoint nor the client can recognize the retry.
  - Fix: Introduce an idempotency key flowing client→server: client generates a stable key (e.g. hash of scrubbed_text + event_ts + user_hash, persisted so retries reuse it) and sends it as an Idempotency-Key header / request field. Servers check CACHE_KV under idempotency:<key> (and idempotency:ingest:<key>) before queueing/inserting, return the original ID/200 on a hit with a short TTL (~1h), and only otherwise proceed. Add the idempotency_key field to EnrichDumpRequest and the QueuedDump interface.
- **[medium·conf 2/3]** Multi-device APNs delivery is not per-token idempotent; retry re-pushes to devices that already succeeded
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:221-241`
  - When a scheduled_jobs row has multiple device tokens, the drain pushes to all tokens via Promise.all and marks the job 'sent' if anyOk=true. There is no per-token delivery state. If token-1 succeeds but token-2 fails, the job is later retried (or re-run via flushNotificationQueue) and pushOne(token-1) is invoked again, re-delivering a duplicate notification to the already-notified device. No stable apns-id / idempotency key is sent to APNs to suppress the duplicate.
  - Fix: Track per-device delivery state — e.g. a delivered_tokens set or delivery_log JSONB on the job row, updated after each successful push and consulted on retry — or generate a stable apns-id per (job, device) so APNs collapses duplicates. At minimum, document that multi-device users may receive duplicate notifications on retry.
- **[medium·conf 1/3]** KV retry path has no jitter or backoff — lock-step 5-min retries cause a thundering herd
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:160-162`
  - On a failed enrich entry, bumpRetry increments q:enrich:retry:<id> and the live entry is left in place to retry on the next 5-min cron tick, with no jitter or backoff. Up to BATCH_CAP (50) failed entries therefore re-hit Anthropic/Supabase at the exact same clock tick every 5 minutes. At scale this is a thundering-herd pattern that can drive cascading failures during a downstream wobble.
  - Fix: Store retry metadata {count, next_retry_at} and set next_retry_at = now + 2^count * 1000ms + random(0,1000ms); skip entries whose next_retry_at is in the future. Or migrate to Cloudflare Queues, which provides built-in retry/backoff configured in wrangler.toml.
- **[medium·conf 1/3]** MAX_RETRIES=12 (~1h at fixed 5-min intervals) risks DLQ-ing valid entries during a transient outage
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:78`, `/Users/serrayildirim/ollie/workers/cron/wrangler.toml:62`
  - MAX_RETRIES is hardcoded to 12, which at fixed 5-min intervals caps total retry time at ~60 minutes with no exponential backoff; the Cloudflare Queue consumer config mirrors this with max_retries=12. A single longer transient Anthropic/Supabase degradation (e.g. >1h) pushes still-valid entries into the DLQ, effectively dropping data that would have succeeded on a later retry.
  - Fix: Raise MAX_RETRIES (e.g. 36 / ~3h) or make it env-configurable, and pair it with exponential backoff so early retries are quick and later ones spread to 15-30 min. For the Queues path, add a retry-delay/backoff configuration to wrangler.toml.
- **[medium·conf 1/3]** updateJob PATCH does not verify a row was actually updated (no row-count check)
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:455-477`
  - updateJob() correctly guards with WHERE status=eq.pending (idempotent no-op if the job already moved on), but it only checks resp.ok and never inspects how many rows the PATCH matched. If another process changes the job's status between SELECT and PATCH, the PATCH returns 200 with 0 rows modified and the code proceeds as if it succeeded, leaving delivery stats inconsistent.
  - Fix: Add prefer:'count=exact' (or return=representation) and parse the Content-Range header / returned rows to confirm a row matched; return a boolean from updateJob. If 0 rows matched, log it (another worker won the race — fine for idempotency) but do not double-increment stats.
- **[medium·conf 1/3]** Partner snapshot upsert has no idempotency key for concurrent in-flight retries
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:173-179`
  - putSnapshot() uses prefer:'return=minimal,resolution=merge-duplicates' on a user_id-PK row, which is correct for sequential duplicates, but sends no Idempotency-Key and has no client-side idempotency tracking. If the client retries on timeout while the original request is still in flight, two concurrent upserts for the same user_id race on conflict-resolution ordering.
  - Fix: Either add an Idempotency-Key header (client generates a stable key, server caches it in CACHE_KV with a TTL and returns the cached response on retry), or explicitly document and rely on the user_id PK + updated_at ordering keeping only the latest snapshot per user.
- **[medium·conf 1/3]** APNs push worker rate-limit counter is not atomic across instances
  - Files: `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:129-143`
  - The per-window rate-limit (Math.floor(now/windowSec) slot in KV, namespaced per user/device_token) does a non-atomic read-check-write: get count → if count>=max return false → put count+1. Concurrent requests from multiple app instances/devices can each read count<max and each write count+1, allowing more than the intended 5 req/sec under high concurrency.
  - Fix: Use a Durable Object (or atomic counter) for per-user rate-limit state, or explicitly document that the cap is approximate under concurrency (likely acceptable for push notifications).
- **[medium·conf 1/3]** APNs push worker does not deduplicate identical in-flight requests
  - Files: `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:55-125`
  - The worker forwards directly to api.push.apple.com with no dedup based on payload or request ID. If the cron drain sends the same job twice (retry loop or cron re-execution) before the first completes, APNs receives two identical requests. This is distinct from the multi-device drain-side dedup gap: this is request-level dedup at the push worker itself.
  - Fix: Compute a hash of (deviceToken, payload) and store it in KV with a short TTL (~60s); if a duplicate arrives inside the window, return 200 without re-calling APNs.
- **[medium·conf 1/3]** Drain treats enriched_signals constraint/FK errors as transient, retrying a permanently-failing write into the DLQ
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:143-163`
  - The catch block in the drain loop does not inspect the error type: a duplicate/constraint error on the enriched_signals INSERT (once a unique constraint exists, or the current FK-related failure mode) is handled identically to a network timeout. The entry is left for retry, hits the same deterministic error every tick, accumulates retries, and lands in the generic DLQ — masking that the failure is application-level (the enriched row was never written because a prior attempt already wrote it), not transient.
  - Fix: Inspect the error: on a constraint/duplicate/FK error, route immediately to a distinct poison DLQ (e.g. dlq:enrich:poison:<id>) with the full error message and stop retrying, so ops can see it is a schema/idempotency bug rather than a transient outage. (Largely moot once enriched_signals uses a proper UPSERT, but the generic-catch behavior should still be hardened.)
- **[low·conf 1/3]** bumpRetry counter is racy (TOCTOU); concurrent drains can under-count retries and block DLQ promotion
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:368-374`
  - bumpRetry does get → parse → +1 → put on q:enrich:retry:<id> — a non-atomic check-then-act. If two drains run concurrently (e.g. manual trigger overlapping the scheduled cron), both read the same value and write the same N, losing an increment. After 12 real failures spread across concurrent runs the counter can still read ~6, indefinitely preventing DLQ promotion of a genuinely-poison entry. Verified: code is `const raw = await kv.get(key); const next = (raw ? parseInt(raw,10)||0 : 0) + 1; await kv.put(...)`.
  - Fix: Use an atomic counter (Cloudflare D1 or a Durable Object) instead of KV get/put, or log each attempt under a unique composite key (RETRY_PREFIX:id:timestamp) and count attempts at DLQ-check time. Migrating to Cloudflare Queues also provides atomic retry counting.
- **[low·conf 1/3]** Daily notification budget retry-loop compounds enriched_signals duplication for analytics
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:189-196`
  - The daily-budget count query correctly fails closed (returns COUNT_UNAVAILABLE = Number.MAX_SAFE_INTEGER so the job stays pending and is retried rather than delivered against an unknown budget). The gate itself is sound, but it creates a retry loop that, combined with the unprotected enriched_signals INSERT, can accumulate duplicate enrichment rows that skew the very signal counts analytics depends on. Low severity and contingent on the enriched_signals duplicate issue.
  - Fix: Fix the enriched_signals idempotency issue first, then verify retry loops do not accumulate duplicate analytics rows.

### DB, Migrations & Schema — 16 issue(s)

- **[critical·conf 1/3]** grocery_purchase_history uses UUID for user_id but receives text Clerk IDs
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:13`, `workers/ai-proxy/src/router/purchase.ts:127`
  - The grocery_purchase_history table defines user_id as UUID, but the ai-proxy worker inserts text values from Clerk JWT 'sub' claims. This is the same defect cook_history had before migration 20260530144446_fix_cook_history_clerk_id_text.sql. Every INSERT will fail with 'invalid input syntax for type uuid', breaking the purchase tracking pipeline.
  - Fix: Create a follow-up migration like 20260530144446_fix_cook_history_clerk_id_text.sql to: (1) drop RLS policies referencing user_id in uuid=uuid comparisons, (2) ALTER COLUMN user_id TYPE text, (3) drop/recreate grocery_replenishment_estimates(uuid) with a text parameter, (4) re-grant execute permissions.
- **[critical·conf 1/3]** push_tokens_touch_updated_at() trigger uses comparison operator (=) instead of assignment (:=)
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260515000001_notification_delivery.sql:130`
  - The push_tokens_touch_updated_at() trigger function uses a single equals sign (=) instead of the PL/pgSQL assignment operator (:=). In PL/pgSQL = is comparison, not assignment, so every UPDATE to push_tokens will fail or misbehave at runtime.
  - Fix: Change line 130 from `new.updated_at = now();` to `new.updated_at := now();` to match the syntax in all other trigger functions (encrypted_state, profiles, finance_records).
- **[high·conf 1/3]** partner sync tables missing GRANT statements (service_role cannot access)
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-55`
  - partner_codes, partner_pairs, and partner_snapshots have RLS enabled with service_role ALL policies, but the migration lacks GRANT statements. Without explicit table grants, even service_role cannot access these tables despite valid RLS policies, blocking the ai-proxy worker from reading/writing partner data.
  - Fix: Add at the end of the migration: grant select, insert, update, delete on public.partner_codes/partner_pairs/partner_snapshots to service_role; and revoke all on these tables from anon, authenticated.
- **[high·conf 1/3]** grocery_purchase_history missing GRANT statements for authenticated role
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31-43`
  - grocery_purchase_history has RLS enabled with authenticated SELECT and service_role INSERT policies, but no GRANT statements give the authenticated role table-level access. RLS policies cannot take effect without the underlying table GRANTs.
  - Fix: Add after the policies: grant usage on schema public to authenticated; grant select, insert on public.grocery_purchase_history to authenticated and to service_role (following finance_records/profiles/encrypted_state pattern).
- **[high·conf 1/3]** cook_history missing GRANT statements for authenticated and service_role
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:25-38`
  - cook_history has RLS enabled with SELECT/UPDATE policies for authenticated and INSERT for service_role, but the migration lacks table-level GRANT statements, so the RLS policies cannot take effect.
  - Fix: Add before the GRANT EXECUTE line: grant usage on schema public to authenticated; grant select, insert, update on public.cook_history to authenticated and to service_role; revoke all on public.cook_history from anon.
- **[high·conf 1/3]** routing_cache missing GRANT statements (service_role worker cannot access)
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70-78`
  - routing_cache has RLS enabled with a service_role full-access policy but no GRANT statements. Without explicit grants, the service_role Cloudflare worker cannot read or write the table despite the valid policy, blocking routing cache functionality.
  - Fix: Add after the policy: grant select, insert, update, delete on public.routing_cache to service_role; revoke all on public.routing_cache from anon, authenticated.
- **[high·conf 1/3]** Missing FORCE ROW LEVEL SECURITY on partner sync tables
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-49`
  - partner_codes, partner_pairs, and partner_snapshots enable RLS but do not FORCE it. Without FORCE RLS the table owner (migration/deployment role) can bypass RLS and read all rows, creating a privilege-escalation surface for sensitive partner data.
  - Fix: Add `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;` after each ENABLE RLS statement, consistent with 20260512000001_encrypted_state.sql.
- **[high·conf 1/3]** Missing FORCE ROW LEVEL SECURITY on grocery_purchase_history
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31`
  - grocery_purchase_history enables RLS but does not force it, so the table owner could bypass RLS policies and read all user grocery data. Inconsistent with the established security pattern.
  - Fix: Add `ALTER TABLE grocery_purchase_history FORCE ROW LEVEL SECURITY;` after the ENABLE RLS statement.
- **[high·conf 1/3]** Missing FORCE ROW LEVEL SECURITY on cook_history
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:26`
  - cook_history enables RLS but does not force it. Even though access is effectively via the SECURITY DEFINER feed_me_cook_signals RPC, the missing FORCE RLS leaves a theoretical owner-bypass path to user cooking history.
  - Fix: Add `ALTER TABLE cook_history FORCE ROW LEVEL SECURITY;` immediately after the ENABLE RLS statement.
- **[high·conf 1/3]** Missing FORCE ROW LEVEL SECURITY on routing_cache
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70`
  - routing_cache enables RLS but does not force it. The table holds module routing classifications and embeddings meant to be service_role-only; without FORCE RLS the owner could bypass the policy and enumerate the entire cache.
  - Fix: Add `ALTER TABLE routing_cache FORCE ROW LEVEL SECURITY;` after the enable statement for defense-in-depth.
- **[medium·conf 1/3]** Missing rollback (.down.sql) migrations for 10 recent schema changes
  - Files: `/Users/serrayildirim/ollie/supabase/rollbacks/`, `/Users/serrayildirim/ollie/supabase/migrations/`
  - Ten forward migrations lack corresponding rollback scripts: grant_service_role, grant_research_tables, invites_channel, invite_funnel_views, seed_alpha_invites, routing_cache, grocery_purchase_history, cook_history, fix_cook_history_clerk_id_text, and partner_bilateral_sync. The absence of documented rollbacks creates operational/disaster-recovery risk.
  - Fix: Create .down.sql scripts for the ten migrations: DROP TABLE IF EXISTS for table migrations, inverse ALTERs, REVOKE for GRANTs, and DELETE...WHERE for seeds.
- **[medium·conf 1/3]** partner_snapshots missing updated_at trigger
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-55`
  - partner_snapshots has an updated_at column defaulting to now() but, unlike encrypted_state/finance_records/plaid_items/push_tokens, lacks a BEFORE trigger to refresh updated_at on INSERT/UPDATE. Worker updates will leave stale timestamps.
  - Fix: Add a partner_snapshots_touch_updated_at() trigger function (new.updated_at := now()) and a BEFORE INSERT OR UPDATE trigger, matching the other tables.
- **[medium·conf 1/3]** partner_snapshots missing index on updated_at column
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-45`
  - partner_snapshots is frequently updated (each partner status push) but has no index on updated_at, so queries filtering/ordering by recency will full-scan. Similar tables (plaid_items, encrypted_state, push_tokens) index updated_at.
  - Fix: Add `CREATE INDEX partner_snapshots_updated_at ON public.partner_snapshots (updated_at DESC);`.
- **[medium·conf 1/3]** Tables created without explicit public schema prefix
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:11`, `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql`, `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql`
  - Five tables (grocery_purchase_history, cook_history, partner_codes, partner_pairs, partner_snapshots) are created without the explicit public. schema prefix, inconsistent with other migrations that use public.tablename. They default to public in Supabase but explicit qualification is safer across schema configurations.
  - Fix: Prefix the CREATE TABLE statements with public. for all five tables.
- **[medium·conf 1/3]** cook_history authenticated RLS policies dropped during type migration but not recreated
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260530144446_fix_cook_history_clerk_id_text.sql:15-17`
  - The fix migration drops cook_history_self_select and cook_history_self_update (which referenced uuid=uuid) but does not recreate them with the new text type, leaving cook_history with RLS enabled but no authenticated SELECT/UPDATE path (only service_write INSERT). The comment says this is intentional (all access via SECURITY DEFINER RPC), but the asymmetry is undocumented as deliberate.
  - Fix: This is correct-by-design (RPC is the read path); document the intentional policy drop in the migration comment, or add explicit deny policies for authenticated/anon SELECT to make intent unambiguous.
- **[low·conf 1/3]** finance_records.deleted_at lacks tombstone immutability constraint
  - Files: `/Users/serrayildirim/ollie/supabase/migrations/20260514000008_finance_records.sql:65`
  - finance_records.deleted_at is nullable for soft-delete tombstones, but no CHECK constraint or trigger prevents unsetting it once set or future-dating it, so a malformed client could break the immutable-tombstone semantic.
  - Fix: Add `CHECK (deleted_at IS NULL OR deleted_at <= now())` and/or a trigger preventing un-setting deleted_at once set; document the soft-delete semantic.

### Performance & Cost — 17 issue(s)

- **[high·conf 1/3]** N+1 store.update() calls in applyGroceryMutations loop
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-812`
  - applyGroceryMutations iterates AI-routed grocery items and calls store.update() for EACH item (lines 406-646), and the async AI-routing path (lines 775-812) likewise calls store.update() once per item to append to pantry/shopping slices. A 5-item grocery classification triggers 5 separate store mutations with redundant array-spread copies instead of one batched write per slice.
  - Fix: Accumulate mutations by target slice (pantry/items) into a map, then apply one store.update() per slice. Reduces store.update() calls from O(N) to O(2) and eliminates repeated array spreads.
- **[high·conf 1/3]** N+1 query pattern in goals.listWithLatest()
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/goals/repo.ts:105-122`
  - listWithLatest() calls goals.list() once, then runs a separate SELECT for each goal's latest progress event inside a for-loop, producing N+1 database queries for N goals.
  - Fix: Replace the per-goal loop with a single batched query using a LEFT JOIN against a per-goal latest-progress subquery (GROUP BY goal_id ORDER BY logged_at DESC), fetching all latest events in one round trip.
- **[high·conf 1/3]** Serial per-row /label calls in research orchestrator flush
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:158-187`
  - The research flush drains up to ~60 buffered scrubbable writes and awaits labelClient.postLabel() in a serial for-loop, one HTTP round-trip at a time. A 10-row batch costs 10 sequential ~100-300ms round-trips (1-3s of artificial delay) instead of one parallel flush.
  - Fix: Parallelize with Promise.all over the drain array (await Promise.all(drain.map(write => labelClient.postLabel({...})))), or use a bulk /label endpoint if available, dropping flush latency from O(N) to O(1).
- **[medium·conf 2/3]** Vision extraction 429 retry uses hardcoded 1s sleep with no exponential backoff or jitter
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:76-83`
  - On a Gemini 429 (rate limit), the vision handler sleeps a fixed 1000ms and retries exactly once. There is no exponential backoff, no jitter, and no provider fallback. Under concurrent image-dump load, all rate-limited requests sleep and retry at the same second, likely hitting the limit again and wasting Gemini budget on guaranteed-fail retries while blocking the worker for 1s.
  - Fix: Add exponential backoff with jitter (e.g. base 100ms, +-25%) or, preferably, propagate the 429 to the caller (/route/dump) so the request returns a soft rate-limit immediately instead of blocking the worker. Better still, integrate vision into the jsonCascade multi-provider fallback chain (e.g. Cloudflare Workers AI) used by dump-classify, or return a graceful static fallback.
- **[medium·conf 1/3]** Drain queue processes dumps serially, blocking on Anthropic + Supabase
  - Files: `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:122-164`
  - drainEnrichQueue() loops up to 50 KV entries and awaits processOne() for each, which serially awaits callAnthropic then two Supabase inserts. Each iteration blocks the next; at ~1s Anthropic + ~200ms inserts per dump, a 50-dump drain can exceed 60s per run.
  - Fix: Parallelize processOne calls with bounded concurrency (e.g. Promise.all in windows of 10). Consider batching enrichment into a single Anthropic call if supported, and Promise.all the two independent inserts (insertRawDump + insertEnrichedSignal) once dumpId is known.
- **[medium·conf 1/3]** Serial per-fragment pass-2 segmentation on cache misses in dump route
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:198-218`
  - When pass-1 flags fragments for pass-2 LLM splitting (~30% of dumps), the handler awaits pass2Split() per flagged fragment in a for-loop. A 3-fragment dump needing pass-2 fires 3 sequential AI calls, even though classification is later batched into a single Groq request.
  - Fix: Collect all fragments needing pass-2 and send them in one jsonCascade call with a multi-fragment prompt ('You are given N fragments... respond with { "fragments": [[...],[...]] } in the SAME order'), merging results back. Drops typical pass-2 from 3 calls to 1.
- **[medium·conf 1/3]** Duplicate buildBasePrompt() calls in feed-me router
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:269,908,981`
  - buildBasePrompt() runs three times per /feed-me request: once for the JSON cascade system prompt (269), again in geminiSuggest() (908) and groqSuggest() (981), duplicating expensive prompt/config construction even though only one provider ultimately executes.
  - Fix: Build the prompt once in handleFeedMe and pass the result (systemPrompt, userTurn, config) into geminiSuggest and groqSuggest instead of rebuilding inside each.
- **[medium·conf 1/3]** GoalsBox polls all goals + cadence every 6s with no debounce/dedup
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:75-95,111-123`
  - refresh() fans out listWithLatest + listByKind x3 plus N per-goal cadence RPCs and runs every 6s (POLL_MS=6000) plus on window focus. With several active goals this is 4+N RPCs per poll; on slow connections or rapid tab re-focuses, refresh() calls pile up and starve other work.
  - Fix: Track the in-flight refresh Promise and reuse/cancel it on repeated calls within the interval; throttle the focus listener so rapid switches within 6s don't re-fire. Prefer a store subscription over polling for real-time updates.
- **[medium·conf 1/3]** Repeated multi-pass filter+map chains in finance cycle correlation
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:84-94`
  - correlateFinanceWithCycle calls entries.filter().map() five times (luteal, follicular, menstrual, ovulation_window, plus nonLuteal), each walking the full entries array. For 100+ days of history this is 5 full passes where one would suffice.
  - Fix: Iterate entries once into a Map<phase, number[]> of totals, then call fMedian() once per phase. Reduces O(5N) to O(N+P).
- **[medium·conf 1/3]** Duplicated complementary filter+map over overlap array in sleep correlation
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:162-163`
  - correlateFinanceWithSleepDebt filters the overlap array twice over complementary conditions (debt>=2 for lowSleep, debt<2 for normalSleep), scanning the whole array twice to partition the same data.
  - Fix: Single-pass partition: iterate overlap once, pushing each spend value into lowSleep or normalSleep. Reduces 2N to N.
- **[low·conf 1/3]** Research intake buffers data for up to 60s before consent re-check
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/src/research.ts:126-150`
  - Writes are buffered for 60s (batchIntervalMs) and hasResearchConsent() is only checked at flush time. After a mid-session opt-out, writes keep accumulating in the pending buffer for up to 60s before the pipeline stops; nothing leaves the device until flush, but it is a privacy-latency gap.
  - Fix: Check consent (or at least drop on opt-out) at onIntake rather than only on flush, so opted-out data is never buffered. Make onIntake async or spawn a fire-and-forget consent check.
- **[low·conf 1/3]** Per-write Vectorize metadata JSON.stringify on every cache upsert/bump
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vectorize.ts:151`
  - Every cache upsert and hit-bump JSON.stringify's the full payload object (which can contain nested hints/reminders/schedule metadata) per fragment per dump. Not a latency bottleneck but unnecessary repeated CPU cost for high-volume users.
  - Fix: Have dump-classify return a pre-stringified payloadStr alongside the payload object so the cache layer reuses it instead of re-stringifying.
- **[low·conf 1/3]** Cache-hit bump runs after response and silently drops on failure
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:302-306`
  - On cache hit, cacheHitBump() runs in a keepAlive() closure and only logs on failure. If the Vectorize write fails, hitCount/lastHitAt are never recorded, silently degrading the eviction score (hitCount x exp(-age/30d)) over time.
  - Fix: Emit cache-bump failures to a telemetry sink for observability; optionally add a short retry/circuit-breaker. If hitCount accuracy becomes critical, move the bump into the response path with a short timeout.
- **[low·conf 1/3]** Likely dead groqChat import in feed-me.ts
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:30`
  - feed-me.ts imports groqChat and GroqMessage, but the visible code uses geminiJson/cloudflareJson/openRouterJson for function calling, suggesting the import may be dead after a refactor away from Groq for recipe generation.
  - Fix: Verify groqChat is unused beyond the inspected range; if so, remove the import and GroqMessage type to trim bundle size.
- **[low·conf 1/3]** grocery module excluded from MODULE_TIERS escalation (undocumented tradeoff)
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:143-189`
  - MODULE_TIERS defines confidence-based two-call escalation for 10 modules but deliberately omits grocery, so grocery always does a single Groq call while other modules pay tier escalation on ~30% of misses. A deliberate consistency-with-cache choice, not a bug, but undocumented.
  - Fix: Add a code comment above MODULE_TIERS explaining why grocery is excluded (cache consistency) and the cost implication, for future maintainers.
- **[low·conf 1/3]** pass-2 segmentation maxTokens=1024 may be larger than needed
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts:34-39`
  - pass2Split sets maxTokens=1024 (raised from 512 to avoid json_validate_failed truncation). Since ~30% of dumps fire pass-2, the larger budget raises inference cost; typical multi-topic splits of 3-5 fragments likely fall well below 1024.
  - Fix: Profile actual pass-2 output token usage; if ~99th percentile is below 768, reduce maxTokens to 768 (~25% pass-2 cost saving), confirmed via A/B test to avoid truncation regressions.
- **[low·conf 1/3]** Serial Voyage embed then cache lookup in /route/:module (single-fragment only)
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:260-277`
  - handleRoute calls voyageEmbed then cacheLookup serially. Acceptable for the current single-fragment path; flagged only as a note that the /route/dump Promise.all batching pattern should be adopted if multi-fragment support is added. Latency attribution is correct.
  - Fix: No action for the current single-fragment path. If multi-item batch classification is added, apply the Promise.all embed+lookup pattern from /route/dump.

### i18n Trilingual Coverage (EN/ES/TR) — 19 issue(s)

- **[critical·conf 3/3]** Crisis banner message + 'notice' kicker + dismiss affordance hardcoded English only
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:303-308`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:304`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:307-308`, `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:323`
  - The CrisisBanner shows safety-critical messaging hardcoded in English only: the 'notice' kicker, the body 'Something in what you wrote sounded heavy. If it's urgent, a crisis line in your country can help right now.', and the dismiss affordance. This is the most safety-sensitive UI in the app, shown to users who may be in crisis, and it never reaches ES/TR speakers. R3 split the kicker into a separate finding but it is the same banner/root problem.
  - Fix: Thread AppLang to CrisisBanner and create a trilingual message table keyed by language for the body, the 'notice' kicker (es: 'aviso', tr: 'uyarı'), and the dismiss affordance; render using the current app language setting.
- **[critical·conf 2/3]** Crisis lexicons marked PENDING_SERRA_APPROVAL — alpha-blocking safety gate (all 3 languages)
  - Files: `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.en.json:4`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.es.json`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.tr.json`, `/Users/serrayildirim/ollie/packages/crisis-lexicon/src/index.ts`
  - All three crisis lexicons (EN, ES, TR) carry "last_reviewed_by": "PENDING_SERRA_APPROVAL". The code comment in crisis-lexicon/src/index.ts states last_reviewed_by must be @serra before any merge that ships to alpha. This is a blocking approval gate for crisis detection in every language. Verified: lexicon.en.json line 4 still reads PENDING_SERRA_APPROVAL.
  - Fix: Serra must review and approve each of the three lexicons, then set last_reviewed_by to @serra (and update last_reviewed_at) before shipping the feat/brain branch to alpha.
- **[high·conf 3/3]** TodayNoticings kicker + affordance labels hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147`, `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:179`, `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:186`
  - The noticings surface renders three hardcoded English strings on every card: 'worth a glance' kicker, 'not now' postpone button, 'dismiss' button. The component already has lang via useAppLang() (line 68) but does not apply it. Highest severity assigned by R3 (high).
  - Fix: Create a trilingual lookup table for these three strings and select by the already-available lang from useAppLang().
- **[high·conf 3/3]** NotifyPrimeLine notification prompt + button labels hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49`, `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:127`, `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:135`
  - The default permission prompt ('allow ollie to send quiet reminders?') and the 'allow' / 'not now' buttons are hardcoded English. R3 notes a sibling instance in FocusTimer using 'allow ollie to ping you when a session ends?'. ES/TR users see English prompts. Highest severity assigned by R3 (high).
  - Fix: Move labels to a trilingual table, thread useAppLang into NotifyPrimeLine, and select by language; apply the same pattern to FocusTimer.
- **[high·conf 3/3]** MicButton mic/error/status messages + aria-labels hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:71`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:81-84`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:116`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:124-126`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:206`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:210`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:216-217`, `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:239`
  - MicButton displays hardcoded English error/status messages ('this app build can't reach the microphone', 'mic blocked — allow microphone access in System Settings', 'no microphone found', 'not signed in', 'heard nothing — try again', 'transcribe failed'), the recording overlay label 'listening… just pause when you're done', 'transcribing…', plus aria-labels 'Stop recording' / 'Record a voice note' and title 'speak your dump'. Rounds split the error messages vs display labels but they are the same component. Highest severity assigned (high).
  - Fix: Extract all MicButton strings (errors, status, overlay label, aria-labels, title) into a trilingual map keyed by language via useAppLang, following the FALLBACK pattern in @ollie/logic/brain/copy.ts.
- **[high·conf 3/3]** PhotoIntake error messages + aria-labels + status text hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:273-274`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:317`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:376`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:433`, `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:438`
  - The reasonCopy function returns English-only validation errors ('This kind of photo isn't supported yet.', 'Photo is too large, try a smaller one.', 'Couldn't read that photo — try another.') and the component has hardcoded English aria-labels ('Attach a photo', 'Remove photo', 'Attached PDF', 'Remove PDF') and status text ('reading…'). R2/R3 cited the error fn; R1 cited the aria-labels/status — same component, same root problem. Highest severity assigned (high).
  - Fix: Convert reasonCopy to accept AppLang and return localized messages; thread lang through usePhotoIntake and localize all aria-labels and status strings via a trilingual map.
- **[high·conf 2/3]** BrainDumpInput error messages + default placeholder hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:94`, `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:176`, `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:217-223`
  - BrainDumpInput shows 7 hardcoded English error messages (e.g. 'sign in to dump', "Couldn't read the photo. Try again or type it out.", 'going too fast — your words are saved, try again in a few seconds', 'took too long — your words are saved, try again', 'no connection — your words are saved, try again', 'server hiccup ({status}) — your words are saved', 'something went wrong — your words are saved') and the DEFAULT_PLACEHOLDER "What's in your head?" constant. ES/TR users cannot understand failure feedback. Highest severity assigned (high).
  - Fix: Build a trilingual error map keyed by (errorCode, lang), thread useAppLang, and make the default placeholder language-aware.
- **[high·conf 1/3]** ACTION_DESCRIPTION in brain copy prompt hardcoded English
  - Files: `/Users/serrayildirim/ollie/packages/logic/src/brain/copy.ts:102-104`
  - The ACTION_DESCRIPTION constant ('you can offer to add the item back onto the shopping list') is hardcoded English and embedded in the system prompt sent to LLMs generating copy in ES/TR. This biases non-English models toward English output and violates the trilingual AI-copy requirement.
  - Fix: Make ACTION_DESCRIPTION a Record<CopyActionKind, Record<AppLang, string>> with EN/ES/TR variants and have buildCopyPrompt select ACTION_DESCRIPTION[action][lang].
- **[high·conf 1/3]** /route/dump request omits app language (locale field never populated)
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:187-194`, `/Users/serrayildirim/ollie/apps/native/src/dump/api/types.ts:53`
  - RouteDumpRequest supports an optional locale field (types.ts:53) but BrainDumpInput never sets body.locale. The worker therefore cannot determine the user's language and falls back to English server-side routing/copy, undermining trilingual responses at the root.
  - Fix: Set body.locale = getAppLang() before the routeDump call.
- **[medium·conf 3/3]** NeedsConfirmCard hardcoded English text + aria-labels
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:60`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:72`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:78`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:95`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:109`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:113`, `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:127`
  - The routing confirmation card renders hardcoded English visible strings ('photo' badge, 'not sure · confirm?' kicker, 'keep', 'undo') plus English aria-labels ('From your photo', 'Keep this routing', 'Undo this routing'). None are localized to ES/TR. Multiple rounds split the visible text vs aria-labels into separate findings, but it is the same component and root problem.
  - Fix: Pass lang: AppLang as a prop (or read via useAppLang if converted to a hook) and use a trilingual lookup table for all visible labels and aria-labels.
- **[medium·conf 2/3]** PatternCards dismiss aria-label hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/patterns/PatternCards.tsx:138`
  - The dismiss button aria-label 'Dismiss noticing' is hardcoded English, breaking screen-reader i18n for ES/TR. R3 mentions PatternCards generically within its cross-component button finding; R1 pinpoints this file+line.
  - Fix: Import useAppLang and set the aria-label from a trilingual map {en:'Dismiss noticing', es:'Descartar noticia', tr:'Bildirimi kapat'}.
- **[medium·conf 1/3]** DumpScreen heading 'What's in your head?' hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:215`
  - The primary brain-dump entry heading 'What's in your head?' is hardcoded English (and duplicated as BrainDumpInput's DEFAULT_PLACEHOLDER). Shown to all users on the main capture screen.
  - Fix: Make the heading language-aware via useAppLang with EN/ES ('¿Qué hay en tu mente?')/TR ('Aklında ne var?') variants.
- **[medium·conf 1/3]** Navigation module labels/hints (Router) hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/navigation/Router.tsx:88-120`
  - MODULE_GROUPS hardcodes all module labels and hints (e.g. 'you', 'your stuff', 'Body', 'Mood', 'water, movement, symptoms') in English only; these appear in the modules navigation drawer.
  - Fix: Build a language-aware module registry/hook returning localized MODULE_GROUPS for the active app language.
- **[medium·conf 1/3]** Primary route tab labels hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/navigation/routes.ts:37-40`
  - primaryRoutes hardcodes 'Home', 'To-Do', 'Modules', 'Settings' in the main tab bar with no localization.
  - Fix: Compute route labels from useAppLang or store (routeId, lang) translations in a separate structure.
- **[medium·conf 1/3]** TodoScreen decision-variant buttons hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:505`, `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:514`, `/Users/serrayildirim/ollie/apps/native/src/todo/TodoScreen.tsx:523`
  - The decision-variant action buttons 'cancel', 'keep', 'decide later' are hardcoded English, violating the trilingual requirement.
  - Fix: Import useAppLang and thread a trilingual map through the DECISION_VARIANT rendering.
- **[medium·conf 1/3]** GroceryNow status strings hardcoded English
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryNow.tsx:112-115`
  - Three grocery status strings ('Your kitchen is empty. Dump what you bought.', 'A few things worth a glance.', "Nothing urgent — here's what's on hand.") are English-only.
  - Fix: Thread AppLang into GroceryNow and localize the three status messages.
- **[medium·conf 1/3]** Module checkbox/confirm aria-labels hardcoded English (GoalsBox + work/admin)
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/goals/GoalsBox.tsx:372`
  - GoalsBox accept button has hardcoded aria-label 'okay, keep it'; similar 'mark done'/'mark undone' aria-labels exist in other modules (work, admin). These accessibility strings are not localized.
  - Fix: Create a centralized i18n module for common action/confirmation/status strings and thread lang through all module components.
- **[low·conf 1/3]** Turkish crisis lexicon has incomplete tier coverage vs English
  - Files: `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.tr.json`
  - Turkish lexicon tiers are imbalanced vs English (Tier 1: 4 vs 5; Tier 4: 6 vs 8), missing patterns like 'tonight is the night' and 'saying goodbye' variants, which may reduce crisis-detection sensitivity for Turkish users.
  - Fix: Add the missing Turkish patterns to match English tier coverage, validated with Turkish-speaking clinical advisors for cultural appropriateness.
- **[low·conf 1/3]** Spanish crisis lexicon missing a tier-4 pattern vs English
  - Files: `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.es.json`
  - Spanish tier 4 (imminent) has 7 entries vs English's 8, missing the 'tied the noose' method-indicating pattern, reducing imminent-risk detection in Spanish.
  - Fix: Add the Spanish translation of the 'tied the noose' pattern to complete tier-4 coverage.

### Test Quality & Coverage — 20 issue(s)

- **[high·conf 3/3]** json-cascade.ts provider fallback chain has zero tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts (lines 55-122)`
  - The jsonCascade() function orchestrates the free-tier provider fallback chain (Groq -> Cloudflare -> Gemini -> OpenRouter) and is the mechanism that prevents a single Groq json_validate_failed from silently collapsing a multi-topic dump to one fragment (dogfood B3, 2026-06-05). It is called by both pass2Split (segmentation-llm) and classifyFragment (dump-classify), yet has no unit test file. A regression where a parse() rejection doesn't advance the chain, lastErr isn't threaded so the wrong error bubbles up, or empty/truncated content doesn't trigger fallthrough would silently degrade routing quality and cause data loss with no test signal.
  - Fix: Add tests/json-cascade.test.ts covering: (1) first provider succeeds -> returns immediately, others not called; (2) first provider throws -> next provider called and succeeds; (3) parse() rejects first output -> advances to next provider; (4) all providers throw -> the LAST error bubbles up (not the first); (5) empty/truncated content triggers fallthrough; (6) provider-subset chains (groq-only, groq+cf) from conditional env pushes; (7) label/logging side-effect on fallthrough.
- **[high·conf 3/3]** pass1Segment (Pass 1 segmentation) has zero unit tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts (lines 53-82, helpers 89-103)`
  - pass1Segment is foundational to the brain-dump pipeline: it splits dump text into sentence fragments and flags items needing pass-2 LLM segmentation via the Decision A heuristic (words > 7, OR words > 4 with no conjunction and no terminal punctuation). It runs on every dump but has no unit test file. Complex untested logic includes trilingual conjunction re-splitting (TR/EN/ES), word counting, word-count threshold boundaries, the Intl.Segmenter fallback regex path, and regex.lastIndex/global-flag resets. It is only exercised indirectly through dump/route integration tests, so the unit behavior is never directly asserted.
  - Fix: Add tests/segmentation.test.ts covering: (1) basic sentence splits; (2) conjunction re-splitting in all three languages; (3) word-count boundary cases (4,5,6,7,8 words) around the needsPass2 threshold; (4) edge cases: empty string, single word, punctuation-only, very long sentence; (5) Intl.Segmenter fallback regex path; (6) regex.lastIndex reset behavior; (7) locale fallback.
- **[high·conf 3/3]** detectFragmentLanguage (lang-detect) has zero unit tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts (lines 19-45, 116-166)`
  - detectFragmentLanguage runs on every fragment after pass-2 and classifies text as tr/en/es/mixed/unknown using stopword density + diacritic scoring with a MIXED_THRESHOLD (0.25) and a fallback to 'en' for unanchored Latin text. It has no unit tests. Untested branches: pure-language detection per language, mixed-language stopword collisions (e.g. 'a' is both EN and ES), all-diacritic text, exact MIXED_THRESHOLD boundary, diacritic bump amounts, no-signal -> unknown vs en fallback, and empty/single-word/punctuation-only input. The output drives telemetry labels and potentially routing context.
  - Fix: Add tests/lang-detect.test.ts covering: (1) pure TR (stopwords+diacritics), EN, ES; (2) mixed-language at the 0.25 threshold boundary; (3) no-signal input -> correct unknown/en fallback; (4) diacritic bumps at edge amounts; (5) edge cases: empty string, single word, punctuation-only, unanchored Latin text.
- **[high·conf 3/3]** pass2Split (segmentation-llm Pass 2) has zero unit tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts (lines 33-56)`
  - pass2Split wraps jsonCascade to run LLM-driven re-splitting on fragments flagged by pass1Segment's Decision A heuristic, validating the expected { fragments: string[] } shape and trimming/filtering results. It has no unit tests. Untested: valid response parsing, output trim/filter, shape validation rejecting non-arrays and arrays of non-strings, empty-array and single-element results, large arrays, per-fragment max-length constraints, and error messages capturing the offending provider and a snippet of bad JSON.
  - Fix: Add tests/segmentation-llm.test.ts covering: (1) mock jsonCascade returns valid { fragments: [...] }; (2) trimming and filtering of results; (3) shape validation rejects non-array and array-of-non-strings; (4) empty array and single fragment; (5) large array; (6) malformed/missing JSON escalates with a useful error; (7) provider 429/503 escalates through the cascade.
- **[high·conf 2/3]** classifyFragment (dump-classify, Layer 1 classifier wrapper) untested
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts (lines 1-285)`
  - classifyFragment is the Layer 1 classifier invoked on every fragment. The existing dump-coverage.test.ts mocks Groq but explicitly does NOT cover the classifier wrapper's own parsing/assembly logic (its comment: 'only the network is mocked'). Untested: confidence-score extraction, JSON parse failures, malformed/missing tool_calls, module/action mismatch handling, payload-shape assembly, and missing-required-field handling.
  - Fix: Add isolated unit tests that mock Groq minimally and focus on classifyFragment internals: (1) well-formed tool_calls -> correct confidence/module/payload extraction; (2) empty/null content -> throws or returns sentinel; (3) malformed or missing tool_calls -> handled gracefully; (4) confidence missing -> sensible default.
- **[high·conf 1/3]** groq/gemini/cloudflare-ai provider client modules have no tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/groq.ts`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/gemini.ts`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/cloudflare-ai.ts`
  - The three provider HTTP-client wrappers used throughout the router and by jsonCascade have zero test coverage. Untested: error status codes (429, 503, 5xx) and their handling, malformed/invalid-JSON responses, rate-limit retry/backoff, timeout behavior, API-key validation at call time, and metric/logging side effects (including no secret leakage on error).
  - Fix: Add unit tests per provider: (1) successful request -> parsed response; (2) network error throws; (3) HTTP 429/503/502 surfaced/logged correctly with backoff where applicable; (4) parse failures caught safely without leaking secrets; (5) missing API key validated at call time.
- **[high·conf 1/3]** dump.test.ts is a smoke test only — no error-path coverage for Voyage/Groq/rate-limiting
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump.test.ts (lines 136-232)`, `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts (lines 177, 260, 322-332)`
  - The /route/dump handler test covers only happy paths plus missing-auth/missing-issuer/missing-text. It does NOT test production error paths that dump.ts implements: Voyage embedding failures (504/429/malformed -> voyage_embed_failed/502), Groq classify cascade failure and 429 (which must return 429 not 502), Groq 503 -> Gemini fallback, both Groq AND Gemini 429 -> 429, vision extraction failure (vision_failed/502), pass-2 cascade total failure -> graceful pass-1 fallback, and Vectorize upsert failure (log but don't block). A grep for 502/429/rate_limited/voyage/groq_classify_failed in the test file returns zero matches.
  - Fix: Add error-path tests: (1) Voyage 503/429 -> 502 voyage_embed_failed; (2) Groq 429 -> 429 rate_limited (not 502); (3) Groq 503 -> Gemini fallback; (4) Groq+Gemini both 429 -> 429; (5) vision throws -> 502 vision_failed; (6) pass-2 all providers fail -> graceful fallback to pass-1 fragment; (7) Vectorize upsert failure logged but response still succeeds.
- **[medium·conf 2/3]** transcribe.ts (Groq Whisper audio path) untested
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts (91 lines)`
  - transcribe handles audio-to-text input via Groq Whisper and has no test file. Untested paths: valid audio buffer -> transcript, mime-type mapping, empty/oversized/corrupted audio error handling, and the failure path returning a clean error.
  - Fix: Add tests/transcribe.test.ts: (1) valid audio buffer -> transcript returned; (2) mime-type mapping for supported formats; (3) empty/oversized/corrupted audio -> error handled gracefully without leaking internals.
- **[medium·conf 2/3]** cook-history.ts untested despite being in the main flow
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/cook-history.ts (236 lines)`
  - cook-history (historical data aggregation for context-aware classification) has no test file. Untested: history fetch/filter logic, temporal windowing (how far back history is considered), de-duplication, and graceful degradation when history is empty or the fetch fails.
  - Fix: Add tests/cook-history.test.ts: (1) successful fetch -> correctly aggregated/shaped for classifier context; (2) fetch fails -> classification proceeds without history (graceful degradation); (3) history truncated to the correct time window; (4) de-duplication works.
- **[medium·conf 2/3]** Flaky setTimeout-based async waits in braindump-dispatch tests
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/tests/braindump-dispatch.test.ts (lines 395, 432, 455)`
  - Several tests use hard-coded real setTimeout (10ms / 20ms) to wait for fire-and-forget async AI dispatch to settle, without vi.useFakeTimers() in scope. These arbitrary delays create race conditions: on a slow or loaded CI machine the timeout may be too short, causing intermittent flakes. The 'kind=add AI pantry result' test in particular depends on a fetch mock completing within 10ms.
  - Fix: Replace setTimeout with deterministic synchronization: (1) have dispatchAction expose/return a promise for its async work so tests can await it; (2) inject a test seam that resolves when the async task completes; or (3) use vi.useFakeTimers() with vi.advanceTimersByTimeAsync().
- **[medium·conf 2/3]** LIVE classifier regression suite is gated out of CI
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.live.test.ts (lines 32, 35, 71)`
  - The live Layer 1 classifier regression suite is gated by describe.skipIf(!LIVE) on DUMP_COVERAGE_LIVE=1. It runs ~580 Groq calls over 140+ fixtures, costs $3-5, takes 10-30 min, and is never invoked in any .github/workflows config, so it only runs manually/on-demand. CI runs only the mock version, which gives 100% mock confidence but cannot catch real prompt/model-output regressions. The 95%+ pass threshold is documented but has no automated gate, so classifier regressions only surface in dogfood/production.
  - Fix: Integrate the live suite into CI as a scheduled nightly job, a pre-release gated job, or a staging cron sampler. Switch the skip condition from a manual env var to a CI-aware trigger (e.g. GITHUB_EVENT_NAME==='schedule'), record baseline pass rates with a dashboard, retry 429s aggressively, and document the <80% / 80-94% / 95%+ thresholds per module-action pair.
- **[medium·conf 1/3]** dump-schema applyConfidencePolicy boundaries untested
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts (lines 67-89)`
  - applyConfidencePolicy enforces server-side confidence tiers (>=0.80 silent, 0.60-0.79 needsConfirm, <0.60 demote to dump_only) — labeled Decision #5 server-side enforcement. It is only covered indirectly via dump.test.ts; the threshold boundaries themselves are never directly asserted. Untested: confidence exactly at 0.80 and 0.60, the originalGuess payload shape on demotion, and degenerate inputs (negative, NaN, Infinity).
  - Fix: Add isolated unit tests: (1) 0.80 -> needsConfirm=false, module unchanged; (2) 0.79 -> needsConfirm=true; (3) 0.60 -> needsConfirm=true; (4) 0.59 -> demoted to dump_only with originalGuess preserved; (5) edge inputs 0, -1, Infinity, NaN.
- **[medium·conf 1/3]** Worker-level PII scrubber regex patterns are not unit-tested
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/pii.ts (lines 48-77+)`
  - The worker-level PII scrubber uses order-dependent regex patterns (documented constraint: URL must run before email/phone) and a hit counter. None are unit-tested. This worker copy duplicates @ollie/pii-scrub (which has a 100-sample golden test), so it risks drifting from the canonical version. Untested: each pattern's match/exclude behavior, the order-dependent execution (e.g. a URL containing an email scrubbed correctly), tricky cases (phone in an address, price strings vs phone numbers), and hit-count accuracy.
  - Fix: Add unit tests per pattern: URL, email, phone (E.164/US/intl, avoiding price strings), address/GPS/name; an ORDER test where a URL containing an email is scrubbed correctly (URL first); and hit-count assertions. Consider deduplicating against @ollie/pii-scrub to avoid drift.
- **[medium·conf 1/3]** Handler tests assert on mock calls instead of resulting state
  - Files: `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/handler.test.ts (lines 50-64)`
  - Grocery handler tests (and the same pattern across work/body/cycle/finance/etc.) mock all repository functions and assert via toHaveBeenCalledWith(), verifying the handler called a repo with given args but NOT that the intended state change happened. A bug where the wrong id is passed, the id is undefined, or a remove is skipped against real data would still pass. The pattern is also refactor-brittle (consolidating calls breaks tests even when behavior is correct), giving false confidence.
  - Fix: Shift to behavior-driven testing: either (1) use an in-memory SQLite store like the logic/ package tests and assert final DB state (e.g. after pantry.remove, re-query and confirm the row is gone), or (2) keep mocks but assert on the return value and side effects (call result.undo and verify state reverts).
- **[medium·conf 1/3]** Retry scheduler untested for concurrent cancellation and timer-fire races
  - Files: `/Users/serrayildirim/ollie/packages/sync/tests/retry.test.ts (line 26)`
  - The sync retry scheduler tests use fake timers to verify exponential backoff and that cancelAll() clears timers, but do not exercise the interaction of concurrent retries, cancellation, and timer cleanup. Untested: a timer firing while cancelAll() is mid-execution (double-execution), whether cancelled promises leak vs are collected, and timer resolution under load — edge cases that surface in production rather than unit tests.
  - Fix: Add fake-timer stress tests: (1) 100+ concurrent schedulers, cancel 50 mid-flight, verify none leak; (2) fire timers during cancelAll() execution and assert no double-execution; (3) assert cancelled timers are absent from the internal queue after cancelAll(); use setImmediate to interleave fires and cancellations; optionally a weak-reference leak check.
- **[medium·conf 1/3]** Only the orchestrator package has coverage gates
  - Files: `/Users/serrayildirim/ollie/packages/orchestrator/vitest.config.ts (lines 12-20)`
  - Only orchestrator has vitest coverage thresholds (stmts 78 / branches 55 / funcs 90 / lines 78). All other packages and workers — ai-proxy, logic, store, sync, notifications, auth, crypto, etc. — have no coverage monitoring. Regressions in critical modules like the ai-proxy router or the logic layer can erode coverage with no detection. This gate applies to 1 of 15+ packages.
  - Fix: Add vitest coverage gates to at least workers/ai-proxy (router/segmentation/cascade are critical), packages/logic (domain logic), and packages/store (data layer), with per-module thresholds (ai-proxy may need lower branch coverage for provider fallbacks). Start conservative and ratchet up quarterly, mirroring orchestrator's strategy.
- **[medium·conf 1/3]** crypto decrypt fallback for legacy payloads missing kdf_iter is untested
  - Files: `/Users/serrayildirim/ollie/packages/crypto/tests/crypto.test.ts (lines 185-230)`
  - The crypto suite is comprehensive and tests explicit PBKDF2 iteration counts and the S7 cross-count failure case, but it never tests the implicit fallback when a payload lacks a kdf_iter field entirely (very old persisted data in a legacy packed format). Such payloads, encrypted at 100k iterations, would be decrypted with the 600k default and fail — but the failure mode and the guidance to use LEGACY_PBKDF2_ITERATIONS are untested.
  - Fix: Add a test: encrypt with legacy 100k iterations and no kdf_iter field, attempt decrypt with the 600k default deriveKey, verify it fails cleanly and the error guides the caller toward LEGACY_PBKDF2_ITERATIONS.
- **[medium·conf 1/3]** Consent sync tests assert on the mock, not on local state mutation
  - Files: `/Users/serrayildirim/ollie/packages/consent/tests/consent.test.ts (lines 152-162, 314-320)`
  - Consent tests assert the sync callback was called with the right args but never verify that local state was actually updated. A regression where setConsent fires the sync callback but fails to update the in-memory cache would pass these tests, leaving local reads stale.
  - Fix: After the sync-mock assertions, verify state mutation: confirm a subsequent getConsent/getConsentSync returns the updated value, not just that the callback fired.
- **[low·conf 1/3]** dump-coverage mock regression suite cannot catch real prompt regressions
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.test.ts (lines 66-93)`
  - The mock-based dump-coverage.test.ts hardcodes each fixture's expected classification as the mocked Groq response, so the mock always returns fixture.expected. This exercises the classifier's response-shape handling but, by construction, cannot detect a real prompt/model regression (e.g. Groq starting to return dump_only for a fixture that should be grocery). The test's own comment acknowledges only the network is mocked — it is a confidence illusion against prompt drift.
  - Fix: Maintain a canonical fixtures file pairing fixture text with Groq ground-truth classifications, refreshed from live-suite runs (not hand-edited), and assert mock outputs against that ground truth; or wire the live suite into nightly CI so prompt regressions surface before they ship.
- **[low·conf 1/3]** partner.ts router module has no tests
  - Files: `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts`
  - partner.ts was listed among R1's nine untested core router modules but received no detailed coverage notes from any round. It ships with zero test coverage, so its callsite behavior is unverified.
  - Fix: Inventory partner.ts callsites and add unit tests for its primary functions and error paths once its responsibilities are confirmed; prioritize after the higher-traffic pipeline modules (segmentation, cascade, classify).

### Dependency Health — 11 issue(s)

- **[high·conf 3/3]** React type version mismatch between @ollie/store and apps/native
  - Files: `/Users/serrayildirim/ollie/packages/store/package.json:18`, `/Users/serrayildirim/ollie/packages/store/package.json:21-22`, `/Users/serrayildirim/ollie/apps/native/package.json:32`, `/Users/serrayildirim/ollie/apps/native/package.json:38`
  - @ollie/store pins react ^18.3.1 and @types/react ^18.3.12 (resolves to 18.3.28) in devDependencies, and its peerDependencies allow react >=18. But apps/native consumes the store while using react ^19.1.0 (resolves to 19.2.6) and @types/react ^19.1.8 (resolves to 19.2.15). Since store exports a React hook entry (./react) that uses React types, consumers on React 19 may hit type mismatches: store is developed/tested against React 18 types while consumers run React 19. Both React versions are installed in node_modules, risking double-loading and subtle type errors in hook consumption (e.g. useStoreSlice).
  - Fix: Update @ollie/store devDependencies to react ^19.1.0 and @types/react ^19.1.x to match the version consumers actually run, and tighten/clarify peerDependencies to explicitly support React 19. This aligns store's test-time types with the runtime React used by apps/native.
- **[high·conf 1/3]** Deprecated Clerk package - migrate to @clerk/react
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:15`
  - @clerk/clerk-react@5.61.3 is deprecated and no longer supported; the package registry marks it deprecated with a migration notice ('Please use @clerk/react instead'). It is a direct dependency of the native app and blocks the upgrade path to future Clerk versions.
  - Fix: Replace @clerk/clerk-react with @clerk/react in apps/native/package.json and follow Clerk's core-3 upgrade guide to verify API compatibility.
- **[medium·conf 3/3]** TypeScript version drift across workspace - both 5.8.3 and 5.9.3 installed
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:42`, `/Users/serrayildirim/ollie/packages/store/package.json:23`
  - apps/native pins typescript ~5.8.3 while the rest of the workspace (root and packages/*) uses ^5.6.0, which resolves to 5.9.3 in the lock file. As a result two TypeScript copies (5.8.3 and 5.9.3) are installed. This bloats the install and can cause subtle type-checking inconsistencies between the native app and the workspace packages it builds against.
  - Fix: Unify TypeScript across the workspace to a single version. Either align apps/native to the workspace's ^5.6.0 (so it also resolves to 5.9.3), or bump everything to a common ^5.8.x. If the tighter native pin is intentional for Tauri build stability, use ^5.8.0 as a middle ground applied workspace-wide.
- **[medium·conf 1/3]** Unused dependency: @tauri-apps/plugin-opener
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:29`
  - @tauri-apps/plugin-opener is declared in apps/native dependencies but has no static or dynamic import anywhere in apps/native/src. Only the Rust-side plugin is configured in src-tauri/Cargo.toml, so the JS binding appears unused.
  - Fix: Remove @tauri-apps/plugin-opener from apps/native/package.json unless required for Tauri framework init; re-add later with a concrete use case if opener functionality is needed.
- **[medium·conf 1/3]** Missing peer dependency declaration consideration for @ollie/store consumers
  - Files: `/Users/serrayildirim/ollie/packages/store/package.json:17-18`
  - @ollie/store declares peerDependencies { react: '>=18' } but apps/native does not surface react as a peer of the store relationship explicitly. Within the monorepo this works because native lists react in dependencies, but if @ollie/store were ever published standalone, downstream consumers would need to install react themselves and the requirement should be clear.
  - Fix: No action needed while @ollie/store is consumed only inside the monorepo. If it is ever published to npm, document the react peer requirement in its README so downstream users install react explicitly.
- **[low·conf 2/3]** Volatile @cloudflare/workers-types specifier pinned to a stale date
  - Files: `/Users/serrayildirim/ollie/apps/api/package.json:19`, `/Users/serrayildirim/ollie/packages/apns-jwt/package.json:17`, `/Users/serrayildirim/ollie/packages/worker-http/package.json`, `/Users/serrayildirim/ollie/workers/apns-push/package.json`, `/Users/serrayildirim/ollie/workers/cron/package.json`, `/Users/serrayildirim/ollie/workers/sentry-tunnel/package.json`
  - Multiple Cloudflare worker packages declare @cloudflare/workers-types ^4.20250906.0 (dated 2025-09-06) but the lock file resolves to 4.20260510.1 (2026-05-10). The caret on a date-versioned, high-churn package means the resolved version drifts far from the declared spec. It's benign (all v4.x) but indicates volatility and a stale specifier.
  - Fix: Update the specifier to ^4.20260510.0 (or later) to reflect the actually-resolved version, or pin to a known-good version to reduce surprise bumps. Document the chosen workers-types version in contributing guidelines.
- **[low·conf 1/3]** Loose Tauri plugin version constraints - missing patch versions
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:28`, `/Users/serrayildirim/ollie/apps/native/package.json:29`
  - @tauri-apps/plugin-notification and @tauri-apps/plugin-opener use loose ^2 ranges without minor/patch, while sibling plugins pin tighter (plugin-sql ^2.4.0, plugin-store ^2.4.3). The loose ranges can pull unexpected minor bumps on reinstall, hurting reproducibility.
  - Fix: Pin plugin-notification and plugin-opener to their current installed minor.patch (e.g. ^2.3.3 and ^2.5.4) to match the other Tauri plugins for reproducible builds.
- **[low·conf 1/3]** Heavy/redundant @clerk/clerk-react in a native desktop app
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:15`
  - @clerk/clerk-react adds a full web auth-provider library to a Tauri desktop app, where it appears to be used only for getUserId() and logout hooks. The bundle-size overhead may not be justified for such limited usage.
  - Fix: Evaluate whether Clerk is the right fit for the desktop app; if only basic user identification is needed, consider a lighter token-based adapter. If Clerk stays, isolate it behind a custom hook and document the decision.
- **[low·conf 1/3]** Missing @types/react-dom in @ollie/store despite React hook exports
  - Files: `/Users/serrayildirim/ollie/packages/store/package.json:20-25`, `/Users/serrayildirim/ollie/packages/store/src/react.ts:13`
  - @ollie/store exports a ./react entry that uses React hooks but only declares @types/react in devDependencies, not @types/react-dom. It currently works via pnpm autoInstallPeers, but the type dependency is implicit and could fail in stricter environments.
  - Fix: Add @types/react-dom to @ollie/store devDependencies to declare the type dependency explicitly and reduce reliance on implicit peer resolution.
- **[low·conf 1/3]** Unused devDependency: @types/zxcvbn
  - Files: `/Users/serrayildirim/ollie/packages/crypto/package.json:17`
  - @types/zxcvbn (^4.4.5) is declared as a devDependency but never referenced. The code dynamically imports zxcvbn (await import('zxcvbn')) and zxcvbn v4.4.2 ships its own TypeScript definitions, making the @types package redundant.
  - Fix: Remove @types/zxcvbn from packages/crypto/package.json devDependencies and run pnpm install to clean up; zxcvbn's bundled types are sufficient.
- **[low·conf 1/3]** Possibly unnecessary @fontsource/dm-mono dependency
  - Files: `/Users/serrayildirim/ollie/apps/native/package.json:16`
  - apps/native depends on @fontsource/dm-mono, imported only as CSS (400.css, 500.css) in main.tsx (~200KB uncompressed). If dm-mono is not actually rendered anywhere in the UI, the dependency and its CSS imports are dead weight.
  - Fix: Audit the design system to confirm dm-mono is rendered; if unused, remove the dependency and its CSS imports from main.tsx, or consolidate to fewer font weights if rarely used.

