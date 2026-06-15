# Ollie Audit — Verification Roadmap

_Source: docs/audit-2026-06-09/FINAL_AUDIT.md · 274 findings · Branch feat/brain @ 2325ee5_

> ## ⏱️ STATUS — last reconciled 2026-06-14 (against `main` / git log, not memory)
>
> The Phase-1 criticals were worked through `IMPLEMENTATION_PLAN_top10.md`, which uses a
> **different numbering** than this file. Reconciled below. Verdicts re-checked against live code on 2026-06-14.
>
> | Roadmap # | Finding | Status | Evidence |
> |---|---|---|---|
> | #1 | Crisis signal schema mismatch | ✅ FIXED | `e435ce6` |
> | #2 | Trilingual crisis banner | ✅ FIXED | `e435ce6` |
> | #3 | Telemetry IDOR | ✅ FIXED | `e435ce6` |
> | #4 | remindIn hint lost on demotion | ✅ FIXED | `e435ce6` (AI data-loss) |
> | #5 | Crisis lexicon `PENDING_SERRA_APPROVAL` | 🔴 **OPEN — HUMAN (Serra)** | still PENDING in en/es/tr `lexicon.*.json` · alpha-blocker |
> | #6 | Gemini API key in URL query string | ✅ FIXED (2026-06-15) | `feb5a67` — moved to `x-goog-api-key` header in gemini/feed-me/vision (both retry paths); 1144 tests green |
> | #7 | flush-notifications Promise.all no boundary | ✅ OK | `pushOne` returns `{ok}`, never throws → batch not aborted (`flush-notifications.ts:223`) |
> | #8 | Non-numeric confidence coerced to 0 | ✅ FIXED | `e435ce6` (AI data-loss) |
> | #9 | grocery_purchase_history `user_id uuid` vs text Clerk ID | ✅ FIXED in code (2026-06-15) | `6a7b374` — migration `20260615000001` flips column+RLS+RPC to text. ⚠️ NOT yet applied to live DB (apply at deploy) |
> | #10 | push_tokens trigger `=` vs `:=` | ⚪ FALSE | PL/pgSQL accepts `=` as assignment; trigger works — not a bug |
>
> **Net (upd. 2026-06-15):** of the 10 roadmap criticals — **8 closed** (#1-4, #6, #7, #8, #9*), **1 false** (#10), **1 open** (#5 needs Serra). *#9 fixed in code, DB apply pending at deploy.
> Also shipped beyond this list (via plan top-10): SQLite migration runner, admin due-dates + ball_state resurfacing, draft-first 0.60-0.79, Partner behind a flag.
>
> **Phases 2-4 (findings #11+): NOT STARTED.** Checkboxes there are accurate (all open).

## Principle

The audit FINDS; it does not CONFIRM. Confidence (how many of 3 rounds saw it) is a **prior, not a verdict**:
- A finding can be **3/3 and still wrong** (all rounds shared the same misread).
- A finding can be **1/3 and real** (only one lens looked there).

So every finding gets an independent **verdict** before any fix:

| Verdict | Meaning | Next |
|---|---|---|
| REAL | code confirms the bug | goes to fix backlog |
| FALSE | code/behaviour contradicts it (hallucinated/stale) | discard, note why |
| HUMAN | a product/safety/scope decision, not a code fact | Serra decides |

**Verdict requires evidence:** the verifier opens the cited `file:line`, and for behavioural claims writes a tiny repro (failing test) or runs the path. No verdict from memory.

## Prioritisation

Order = **severity first, confidence second**. A critical-but-1/3 still gets verified early (cost of missing it far exceeds cost of checking). The 210 single-round findings are NOT all verified — they are **sampled** (see Phase 4).

## Verification method by finding type

| Finding type | How to verify | Artifact |
|---|---|---|
| Auth / IDOR / CORS / key-exposure | trace the request path + (where safe) probe the live worker | note + optional test |
| Behavioural bug (data loss, dropped field, batch abort) | write a **failing unit test** that reproduces it | test in repo |
| Schema / contract drift | diff the producer type vs the consumer type | note + type |
| DB / migration | read the migration + check column types vs real IDs | note |
| i18n / hardcoded copy | grep the string, confirm no locale lookup | note |
| Product / safety gate (e.g. lexicon approval) | escalate to Serra | decision |

---

## Phase 1 — All criticals (10) · verify every one regardless of confidence

**Done =** each has a verdict (REAL/FALSE/HUMAN) with evidence; every REAL has a repro test or a trace note; results logged in this file.

- [x] **#1** ✅ 🔴 _(conf 3/3)_ CrisisSignal schema mismatch between worker and native client (type/language vs tier/languages/matches)  
      `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77`  · _API Contract Consistency_
- [x] **#2** ✅ 🔴 _(conf 3/3)_ Crisis banner message + 'notice' kicker + dismiss affordance hardcoded English only  
      `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:303-308`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [x] **#3** ✅ 🔴 _(conf 2/3)_ IDOR: telemetry endpoints verify JWT but never pass userId to handlers, which trust client-supplied user_hash…  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343`  · _Security & Authorization_
- [x] **#4** ✅ 🔴 _(conf 2/3)_ remindIn hint silently lost when low-confidence fragments are demoted to dump_only  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:281`  · _Dump Routing Flow Correctness_
- [ ] **#5** 🔴 _(conf 2/3)_ Crisis lexicons marked PENDING_SERRA_APPROVAL — alpha-blocking safety gate (all 3 languages)  
      `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.en.json:4`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#6** 🔴 _(conf 1/3)_ Gemini API key exposed in URL query string  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:55`  · _Input Validation_
- [x] **#7** ✅ 🔴 _(conf 1/3)_ Promise.all without error boundary in flush-notifications aborts the rest of the batch  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:223`  · _Error Handling & Resilience_
- [x] **#8** ✅ 🔴 _(conf 1/3)_ Non-numeric confidence coerced to 0, triggering spurious demotion and data loss  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:200`  · _Dump Routing Flow Correctness_
- [ ] **#9** 🔴 _(conf 1/3)_ grocery_purchase_history uses UUID for user_id but receives text Clerk IDs  
      `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:13`  · _DB, Migrations & Schema_
- [x] **#10** ⚪FALSE 🔴 _(conf 1/3)_ push_tokens_touch_updated_at() trigger uses comparison operator (=) instead of assignment (:=)  
      `/Users/serrayildirim/ollie/supabase/migrations/20260515000001_notification_delivery.sql:130`  · _DB, Migrations & Schema_

---

## Phase 2 — Highest-trust set (3/3 confidence, 21) · the rounds agree, fast-confirm

**Done =** each verdict recorded; expect a high REAL rate (most reproducible). Spot-write tests for behavioural ones.

- [ ] **#11** 🟠 _(conf 3/3)_ CORS Access-Control-Allow-Origin '*' exposes all worker endpoints to any origin  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131`  · _Security & Authorization_
- [ ] **#12** 🟠 _(conf 3/3)_ Centralized UUID/request-ID generation missing across packages (research-stream, worker-http, orchestrator)  
      `packages/research-stream/src/index.ts:338-349`  · _Reinvented Wheels & Duplication_
- [ ] **#13** 🟠 _(conf 3/3)_ Unsafe `as unknown as ModuleHandler<Module>` casts in module registry  
      `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:94-109`  · _TypeScript Type Safety_
- [ ] **#14** 🟠 _(conf 3/3)_ API client casts response to generic T without runtime validation  
      `/Users/serrayildirim/ollie/packages/api/src/client.ts:194`  · _TypeScript Type Safety_
- [ ] **#15** 🟠 _(conf 3/3)_ Theme tokens cast `as unknown as Record<...>` in tokensToCssVars bypasses type safety  
      `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:208-225`  · _TypeScript Type Safety_
- [ ] **#16** 🟠 _(conf 3/3)_ Fire-and-forget Vectorize cache operations silently inflate AI cost with no alerting  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-269`  · _Error Handling & Resilience_
- [ ] **#17** 🟠 _(conf 3/3)_ RoutingSummary.pass2Triggered present in worker output but absent from native schema  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:415`  · _API Contract Consistency_
- [ ] **#18** 🟠 _(conf 3/3)_ Fragment.needsConfirm required in worker schema but optional in native schema  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:49`  · _API Contract Consistency_
- [ ] **#19** 🟠 _(conf 3/3)_ enriched_signals INSERT has no idempotency guarantee (no unique constraint on dump_id, plain POST without ups…  
      `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-365`  · _Idempotency & Retry Harness_
- [ ] **#20** 🟠 _(conf 3/3)_ TodayNoticings kicker + affordance labels hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#21** 🟠 _(conf 3/3)_ NotifyPrimeLine notification prompt + button labels hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#22** 🟠 _(conf 3/3)_ MicButton mic/error/status messages + aria-labels hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:71`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#23** 🟠 _(conf 3/3)_ PhotoIntake error messages + aria-labels + status text hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#24** 🟠 _(conf 3/3)_ json-cascade.ts provider fallback chain has zero tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts (lines 55-122)`  · _Test Quality & Coverage_
- [ ] **#25** 🟠 _(conf 3/3)_ pass1Segment (Pass 1 segmentation) has zero unit tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts (lines 53-82, helpers 89-103)`  · _Test Quality & Coverage_
- [ ] **#26** 🟠 _(conf 3/3)_ detectFragmentLanguage (lang-detect) has zero unit tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts (lines 19-45, 116-166)`  · _Test Quality & Coverage_
- [ ] **#27** 🟠 _(conf 3/3)_ pass2Split (segmentation-llm Pass 2) has zero unit tests  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts (lines 33-56)`  · _Test Quality & Coverage_
- [ ] **#28** 🟠 _(conf 3/3)_ React type version mismatch between @ollie/store and apps/native  
      `/Users/serrayildirim/ollie/packages/store/package.json:18`  · _Dependency Health_
- [ ] **#91** 🟡 _(conf 3/3)_ Finance merge casts FinanceRecord to `Record<string, unknown>` for dynamic key assignment  
      `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`  · _TypeScript Type Safety_
- [ ] **#92** 🟡 _(conf 3/3)_ NeedsConfirmCard hardcoded English text + aria-labels  
      `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:60`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#93** 🟡 _(conf 3/3)_ TypeScript version drift across workspace - both 5.8.3 and 5.9.3 installed  
      `/Users/serrayildirim/ollie/apps/native/package.json:42`  · _Dependency Health_

---

## Phase 3 — Two-round findings (2/3, 38) · likely real, confirm before fixing

**Done =** each verdict recorded. Group by file to verify neighbours together.

- [ ] **#29** 🟠 _(conf 2/3)_ verifyJwt dual-mode Supabase fallback returns null on service errors and skips issuer validation  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:364-400`  · _Security & Authorization_
- [ ] **#30** 🟠 _(conf 2/3)_ T0_JWT_ENFORCED dev gate accepts spoofable x-user-id and relies on implicit fail-closed default  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:217-230`  · _Security & Authorization_
- [ ] **#31** 🟠 _(conf 2/3)_ Missing size/bounds validation on body.row object in /ingest-event  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-208`  · _Input Validation_
- [ ] **#32** 🟠 _(conf 2/3)_ Multiple exponential-backoff retry implementations (api/client vs sync/retry)  
      `packages/api/src/client.ts:222-250`  · _Reinvented Wheels & Duplication_
- [ ] **#33** 🟠 _(conf 2/3)_ Capacitor backend uses `Promise<any>` dynamic import / unvalidated globalThis cast  
      `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:36-38`  · _TypeScript Type Safety_
- [ ] **#34** 🟠 _(conf 2/3)_ TOCTOU race in finance sync drain queue cleanup loses concurrently-enqueued items  
      `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:335-401`  · _Async & Concurrency_
- [ ] **#35** 🟠 _(conf 2/3)_ applyGroceryMutations is ~248 lines with 4-level nesting and duplicated pantry/shopping logic  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-647`  · _Clean Code & Complexity_
- [ ] **#36** 🟠 _(conf 2/3)_ grocery.config.ts is ~1,820 lines mixing 600+ food-data entries with config code  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820`  · _Clean Code & Complexity_
- [ ] **#37** 🟠 _(conf 2/3)_ Package tsconfigs do not extend tsconfig.base.json, causing strict-setting drift  
      `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json`  · _Linting & Config Hygiene_
- [ ] **#38** 🟠 _(conf 2/3)_ noUnusedLocals/noUnusedParameters enabled only in apps/native, not in tsconfig.base.json  
      `/Users/serrayildirim/ollie/tsconfig.base.json`  · _Linting & Config Hygiene_
- [ ] **#39** 🟠 _(conf 2/3)_ Voyage embedding indices not bounds-checked, producing a sparse embeddings array  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:449-459`  · _Dump Routing Flow Correctness_
- [ ] **#40** 🟠 _(conf 2/3)_ scheduled_jobs dedupe unique index is partial (pending-only), so reschedules after a job fires create duplica…  
      `/Users/serrayildirim/ollie/supabase/migrations/20260513000001_scheduled_jobs.sql:47-49`  · _Idempotency & Retry Harness_
- [ ] **#41** 🟠 _(conf 2/3)_ BrainDumpInput error messages + default placeholder hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:94`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#42** 🟠 _(conf 2/3)_ classifyFragment (dump-classify, Layer 1 classifier wrapper) untested  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts (lines 1-285)`  · _Test Quality & Coverage_
- [ ] **#94** 🟡 _(conf 2/3)_ Inline setTimeout sleep pattern instead of shared sleep() utility  
      `workers/ai-proxy/src/gemini.ts:63`  · _Reinvented Wheels & Duplication_
- [ ] **#95** 🟡 _(conf 2/3)_ @ollie/notifications declares @ollie/api as a runtime dependency for a type-only import  
      `/Users/serrayildirim/ollie/packages/notifications/package.json:24`  · _File & Module Structure_
- [ ] **#96** 🟡 _(conf 2/3)_ `getRandomValues` typed with `any` parameter/return in crypto package  
      `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:85-86`  · _TypeScript Type Safety_
- [ ] **#97** 🟡 _(conf 2/3)_ Sleep parse casts SleepRecord through `unknown as Record<string, unknown>`  
      `/Users/serrayildirim/ollie/packages/logic/src/sleep/parse.ts:161`  · _TypeScript Type Safety_
- [ ] **#98** 🟡 _(conf 2/3)_ Grocery orchestrator: unvalidated payload cast and result cast in item route  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/grocery.ts:176`  · _TypeScript Type Safety_
- [ ] **#99** 🟡 _(conf 2/3)_ cadence-scanner fires notifications without await or failure tracking  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:405-420`  · _Error Handling & Resilience_
- [ ] **#100** 🟡 _(conf 2/3)_ research-stream trackTable fire-and-forget POST loses data with no retry  
      `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:211-222`  · _Error Handling & Resilience_
- [ ] **#101** 🟡 _(conf 2/3)_ Fire-and-forget Promise.all post-dispatch chain has fragile error boundary  
      `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109`  · _Async & Concurrency_
- [ ] **#102** 🟡 _(conf 2/3)_ MUTATION_RE regex mixes EN/TR/ES verbs in one undocumented alternation  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`  · _Clean Code & Complexity_
- [ ] **#103** 🟡 _(conf 2/3)_ Grocery async routing closure in dispatchAction is deeply nested and duplicated  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:721-847`  · _Clean Code & Complexity_
- [ ] **#104** 🟡 _(conf 2/3)_ O(n²) deduplication in brain noticing selection (nested findIndex inside filter)  
      `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:335`  · _Algorithms Correctness & Efficiency_
- [ ] **#105** 🟡 _(conf 2/3)_ Orchestrator-internal dedup keys persisted to store with no external reader/writer (incl. finance _recurringC…  
      `/Users/serrayildirim/ollie/packages/orchestrator/src (scattered across all orchestrators)`  · _State & Store Consistency_
- [ ] **#106** 🟡 _(conf 2/3)_ Fragment.payload typed as generic Record<string,unknown> in worker vs ActionPayload discriminated union in na…  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:46`  · _API Contract Consistency_
- [ ] **#107** 🟡 _(conf 2/3)_ Multi-device APNs delivery is not per-token idempotent; retry re-pushes to devices that already succeeded  
      `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:221-241`  · _Idempotency & Retry Harness_
- [ ] **#108** 🟡 _(conf 2/3)_ Vision extraction 429 retry uses hardcoded 1s sleep with no exponential backoff or jitter  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:76-83`  · _Performance & Cost_
- [ ] **#109** 🟡 _(conf 2/3)_ PatternCards dismiss aria-label hardcoded English  
      `/Users/serrayildirim/ollie/apps/native/src/patterns/PatternCards.tsx:138`  · _i18n Trilingual Coverage (EN/ES/TR)_
- [ ] **#110** 🟡 _(conf 2/3)_ transcribe.ts (Groq Whisper audio path) untested  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts (91 lines)`  · _Test Quality & Coverage_
- [ ] **#111** 🟡 _(conf 2/3)_ cook-history.ts untested despite being in the main flow  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/cook-history.ts (236 lines)`  · _Test Quality & Coverage_
- [ ] **#112** 🟡 _(conf 2/3)_ Flaky setTimeout-based async waits in braindump-dispatch tests  
      `/Users/serrayildirim/ollie/packages/orchestrator/tests/braindump-dispatch.test.ts (lines 395, 432, 455)`  · _Test Quality & Coverage_
- [ ] **#113** 🟡 _(conf 2/3)_ LIVE classifier regression suite is gated out of CI  
      `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.live.test.ts (lines 32, 35, 71)`  · _Test Quality & Coverage_
- [ ] **#208** ⚪ _(conf 2/3)_ Secrets in gitignored .env.local (Sentry DSN + Supabase anon key)  
      `/Users/serrayildirim/ollie/.env.local:8`  · _Secrets & Token Exposure_
- [ ] **#209** ⚪ _(conf 2/3)_ Unvalidated excludeDishes array size in /feed-me endpoint  
      `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466`  · _Input Validation_
- [ ] **#210** ⚪ _(conf 2/3)_ Finance threshold magic numbers hardcoded inline instead of named constants  
      `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:96-100`  · _Clean Code & Complexity_
- [ ] **#211** ⚪ _(conf 2/3)_ Volatile @cloudflare/workers-types specifier pinned to a stale date  
      `/Users/serrayildirim/ollie/apps/api/package.json:19`  · _Dependency Health_

---

## Phase 4 — Single-round backlog (205, mostly 1/3) · SAMPLE, do not verify all

Each seen by only one round → high noise. Verifying all 205 is not worth it. Rule:

1. **Verify every `critical`/`high` in here** (severity overrides low confidence).
2. For `medium`/`low`: verify a **20% random sample per dimension**. If a dimension's sample is >50% FALSE, **discard the rest of that dimension** as noise. If <20% FALSE, **promote the dimension** to full verification.
3. Log the discard decision per dimension (no silent drop).

Full list: see `VERIFY_BACKLOG_conf1.md`. Counts per dimension:

| Dimension | # in backlog |
|---|---|
| Error Handling & Resilience | 21 |
| State & Store Consistency | 17 |
| Performance & Cost | 16 |
| DB, Migrations & Schema | 14 |
| Algorithms Correctness & Efficiency | 13 |
| Clean Code & Complexity | 12 |
| Reinvented Wheels & Duplication | 11 |
| Linting & Config Hygiene | 11 |
| Test Quality & Coverage | 11 |
| TypeScript Type Safety | 10 |
| Idempotency & Retry Harness | 10 |
| i18n Trilingual Coverage (EN/ES/TR) | 10 |
| File & Module Structure | 9 |
| Async & Concurrency | 9 |
| Input Validation | 8 |
| Dependency Health | 8 |
| Security & Authorization | 7 |
| Secrets & Token Exposure | 3 |
| Dump Routing Flow Correctness | 3 |
| API Contract Consistency | 2 |

---

## Execution

Manual verification of the ~69 prioritised items is doable but slow. Recommended: an **adversarial-verify workflow** — one independent agent per finding, prompted to **REFUTE** it (open the code, default to FALSE unless the bug is provable), returning {verdict, evidence, repro?}. Pipeline by phase; a finding survives only if the skeptic cannot refute it. This inverts the audit (which tried to FIND problems), so the two passes cancel each other's biases.

## Tracking

Tick the boxes above as verdicts land. Keep a one-line verdict log per finding: `#N — REAL/FALSE/HUMAN — <evidence file:line or test name>`.
