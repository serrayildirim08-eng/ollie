# Ollie — Deep Repo Audit (3 blind rounds x 10 dimensions)

> Method: 10 dimensions audited independently in 3 blind rounds (no round saw another's findings), then clustered per dimension. Confidence = how many rounds independently found the issue (1-3).

## Totals

- **129** distinct issues
- Severity: critical 10 / high 33 / medium 48 / low 38
- Confidence: 3/3 = 9 / 2/3 = 36 / 1/3 = 84

## All issues — ordered by importance (severity, then confidence)

| # | Sev | Conf | Dimension | Issue | Location |
|---|---|---|---|---|---|
| 1 | critical | 3/3 | structure | Cloudflare Worker misplaced in apps/ instead of workers/ | `/Users/serrayildirim/ollie/apps/api/ (package @ollie/api-worker)` |
| 2 | critical | 3/3 | validation | Device token interpolated into APNs URL without encoding/validation in /send | `/Users/serrayildirim/ollie/apps/api/src/worker.ts:464 (and tokens array at 400-409)` |
| 3 | critical | 2/3 | duplication | fetch-with-timeout (AbortController + setTimeout + finally) hand-rolled 5+ times | `packages/api/src/client.ts:144-220, packages/api/src/anthropic.ts, packages/orchestrator/src/braindump-dispatch.ts:153-209, apps/native/src/api/workers.ts:359-413, workers/ai-proxy/src/invites.ts:402-410` |
| 4 | critical | 2/3 | cleancode | dispatchAction is a ~465-line god function routing 10+ modules with deep nesting | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157` |
| 5 | critical | 2/3 | security | Live third-party API keys (Voyage, Gemini) sit in plaintext .env needing rotation | `/Users/serrayildirim/ollie/.env` |
| 6 | critical | 2/3 | security | Supabase project ref + anon JWT in plaintext .env.local | `/Users/serrayildirim/ollie/.env.local` |
| 7 | critical | 1/3 | structure | Duplicate APNs workers with overlapping functionality | `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts and /Users/serrayildirim/ollie/apps/api/src/worker.ts` |
| 8 | critical | 1/3 | duplication | UUID/newId generation duplicated across ~14 module repos + orchestrator + dump | `apps/native/src/modules/*/repo.ts (12+ modules), packages/orchestrator/src/braindump-dispatch.ts, apps/native/src/dump/archive.ts` |
| 9 | critical | 1/3 | flows | 5 admin events emitted but never registered in @ollie/events | `packages/orchestrator/src/admin.ts:365,390,414,438,460` |
| 10 | critical | 1/3 | cleancode | createFinanceOrchestrator is a 1315-line monolithic closure with 40+ inner functions | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:241-1555` |
| 11 | high | 3/3 | flows | Admin orchestrator emits ~14-15 events that have no consumer (only phone_task_detected is subscribed) | `packages/orchestrator/src/admin.ts (multiple emit sites); subscriber at admin.ts:563` |
| 12 | high | 3/3 | flows | Module-pattern events depend on a single non-guaranteed consumer (patterns orchestrator); work pattern handling is consistent but fragile on init order | `packages/orchestrator/src/patterns.ts:53-61, 282-286` |
| 13 | high | 3/3 | cleancode | Pervasive single-letter variable names across worker validation and orchestrator code | `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:198,254-287; cloudflare-ai.ts:36; router/dump.ts:384; router/feed-me.ts:384; router/cook-history.ts:177; packages/crypto/src/index.ts:73-88; packages/orchestrator/src/finance.ts (s/o/p/r, 15+ sites)` |
| 14 | high | 3/3 | security | Service-role key used for all PostgREST writes with no RLS backstop on telemetry/invites tables | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts (telemetry routes) + /Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:165,236,267 + /Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply.ts:169-194` |
| 15 | high | 3/3 | types_errors | Unvalidated JSON.parse cast in decryptData() | `packages/crypto/src/index.ts:206` |
| 16 | high | 2/3 | structure | Confusing @ollie/api vs @ollie/api-worker naming across layers | `/Users/serrayildirim/ollie/packages/api/package.json (@ollie/api) vs /Users/serrayildirim/ollie/apps/api/package.json (@ollie/api-worker)` |
| 17 | high | 2/3 | structure | Duplicate test/ and tests/ directories in pii-scrub package | `/Users/serrayildirim/ollie/packages/pii-scrub/test and /Users/serrayildirim/ollie/packages/pii-scrub/tests` |
| 18 | high | 2/3 | duplication | Duplicate Supabase REST construction (headers + POST) across 14 call sites | `workers/ai-proxy/src/{label,telemetry,invites}.ts + workers/ai-proxy/src/router/{purchase,cook-history,replenishment,feed-me,partner,route,server-apply}.ts, workers/cron/src/{drain,flush-notifications}.ts, apps/api/src/{worker,account-delete}.ts` |
| 19 | high | 2/3 | duplication | Authorization Bearer-token extraction (auth.slice('Bearer '.length)) repeated 11 times | `workers/ai-proxy/src/index.ts:540 + workers/ai-proxy/src/router/{transcribe,feed-me,purchase,server-apply-routes,replenishment,partner,cook-history,route,brain-copy,dump}.ts` |
| 20 | high | 2/3 | duplication | Safe response-text reader duplicated as safeText / .text().catch().slice() in 15 files | `packages/api/src/client.ts:309-311, apps/native/src/api/workers.ts:415-417, workers/cron/src/flush-notifications.ts:486-492, apps/api/src/account-delete.ts:383-385, plus workers/ai-proxy/src/{gemini,openrouter,groq}.ts + router/{feed-me,transcribe,vision,purchase,dump,cook-history,route,replenishment}.ts` |
| 21 | high | 2/3 | standards | External API / request JSON cast to a type with no runtime validation | `workers/ai-proxy/src/router/transcribe.ts:89; feed-me.ts:717,950; dump.ts:157; route.ts:416; partner.ts:110; vectorize.ts:108` |
| 22 | high | 2/3 | flows | Router MODULE_CONFIGS and native dispatch stubHandlers can drift, causing route-success / dispatch-fail data loss | `workers/ai-proxy/src/router/route.ts:118-130 (MODULE_CONFIGS); apps/native/src/modules/dispatch.ts:51-58 (handler lookup)` |
| 23 | high | 2/3 | cleancode | grocery.config.ts is an 1820-line file mixing data, types, schema, and prompt-building logic | `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820` |
| 24 | high | 2/3 | security | Missing ENVIRONMENT guard on STAGING_TEST_BEARER in /brain-copy and /apply-inbox + /sync/grocery-pantry | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/brain-copy.ts:49 and /Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:30` |
| 25 | high | 2/3 | security | Spoofable x-user-id grants identity in dev mode (T0_JWT_ENFORCED=0) — IDOR if misconfigured to prod | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:91-110, /Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:154-161, /Users/serrayildirim/ollie/workers/ai-proxy/src/router/replenishment.ts:103-113` |
| 26 | high | 1/3 | structure | Worker tsconfig.json files duplicate base config instead of extending tsconfig.base.json | `/Users/serrayildirim/ollie/workers/apns-push/tsconfig.json and /Users/serrayildirim/ollie/packages/worker-http/tsconfig.json` |
| 27 | high | 1/3 | structure | No ESLint import-boundary enforcement for monorepo layering | `/Users/serrayildirim/ollie/eslint.config.mjs` |
| 28 | high | 1/3 | duplication | SHA-256-to-hex conversion hand-rolled 5 times | `workers/ai-proxy/src/index.ts:551-558, workers/ai-proxy/src/telemetry.ts:46-50, workers/ai-proxy/src/router/shelf-life.ts:48-60, workers/ai-proxy/src/router/vectorize.ts:240-247, workers/ai-proxy/src/router/server-apply.ts:52-58` |
| 29 | high | 1/3 | duplication | randomUUID() fallback reimplemented in worker/package code instead of using worker-http | `packages/research-stream/src/index.ts:338-349, packages/orchestrator/src/braindump-dispatch.ts:312-317, apps/native/src/dump/archive.ts:74-78, workers/ai-proxy/src/{label.ts:209, telemetry.ts, router/dump.ts}` |
| 30 | high | 1/3 | standards | Supabase FORCE RLS / GRANT coverage not audited beyond the 6 worker tables | `supabase/migrations/20260615000002_force_rls_and_grants.sql` |
| 31 | high | 1/3 | flows | Dead event flow: goals:convert_to_habit has a listener but no production emitter | `packages/orchestrator/src/habits.ts:266 (listener); no production emitter` |
| 32 | high | 1/3 | flows | Dead event flow: sleep:wind_down_step has a listener but the WindDownChecklist UI never emits it | `packages/orchestrator/src/sleep.ts:646 (listener); apps/native/src/modules/sleep/bridge.ts:175 (documented-but-unimplemented emit)` |
| 33 | high | 1/3 | flows | groqClassify model ladder falls back to [undefined], passing undefined as the model arg | `workers/ai-proxy/src/router/route.ts:507,512` |
| 34 | high | 1/3 | lint | Unsafe double/chained type casts in capacitor notifications backend | `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:38,73` |
| 35 | high | 1/3 | lint | Unguarded console.log/warn in shipped notifications package leaks to prod | `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:77,81,85,260,265,289; backends/capacitor.ts:277` |
| 36 | high | 1/3 | cleancode | applyGroceryMutations is a 247-line function with duplicated remove/check logic and repeated inline snapshot pattern | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-648` |
| 37 | high | 1/3 | validation | spec.dedupe_key.slice() called without null check in sendApns | `/Users/serrayildirim/ollie/apps/api/src/worker.ts:489` |
| 38 | high | 1/3 | validation | Telemetry string fields in /enrich-dump validated for type only, no length/empty bounds | `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:129-139` |
| 39 | high | 1/3 | validation | Partner snapshot phrases not length-bounded per item in /partner/snapshot | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:168-169` |
| 40 | high | 1/3 | validation | Unvalidated `since` ISO param in /sync/grocery-pantry | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:50, server-apply.ts:175` |
| 41 | high | 1/3 | security | Telemetry/user-data tables only got FORCE ROW LEVEL SECURITY recently; coverage may be incomplete | `/Users/serrayildirim/ollie/supabase/migrations/20260615000002_force_rls_and_grants.sql` |
| 42 | high | 1/3 | types_errors | JSON.parse on untrusted persisted data without try/catch in kv.get | `apps/native/src/storage/kv.ts:43,48` |
| 43 | high | 1/3 | types_errors | Unvalidated JSON.parse + cast of tool-call arguments in router | `workers/ai-proxy/src/router/route.ts:539` |
| 44 | medium | 2/3 | structure | apps/native colocates 61 test files in src/ unlike the rest of the monorepo | `/Users/serrayildirim/ollie/apps/native/src/ (61 *.test.ts[x] files) and /Users/serrayildirim/ollie/apps/native/vitest.config.ts` |
| 45 | medium | 2/3 | duplication | JSON request-body parse try/catch -> bad_json boilerplate in 10+ handlers | `workers/ai-proxy/src/{label.ts:107-110, telemetry.ts:121-125, invites.ts:69-74}, workers/ai-proxy/src/router/{purchase.ts:113-122, cook-history.ts:102-111, ...}, apps/api/src/worker.ts` |
| 46 | medium | 2/3 | standards | globalThis cast to `any` to reach platform APIs (btoa/atob/Buffer, navigator, crypto.randomUUID) | `packages/crypto/src/index.ts:85-86,219,226; packages/research-stream/src/index.ts:144-146,340` |
| 47 | medium | 2/3 | flows | Grocery routing events consumed only by UI hook — lost if hook unmounted / not yet mounted; mutation failures are silent | `packages/orchestrator/src/braindump-dispatch.ts:744-879 (emit + async routing)` |
| 48 | medium | 2/3 | flows | Boot race: orchestrator.init() subscribes to store keys before fire-and-forget runAllSyncs populates them | `apps/native/src/store.ts:119,132 (init before non-awaited runAllSyncs); apps/native/src/bridge/index.ts:59-66 (in-app captures never mirror until next dump)` |
| 49 | medium | 2/3 | lint | Intentional console statements lack eslint-disable annotations (telemetry/error logging) | `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:105,138,177,201,310,325; apps/native/src/dump/BrainDumpInput.tsx:197; apps/native/src/navigation/Layout.tsx:21; apps/native/src/modules/dispatch.ts:111,120,151; apps/native/src/bridge/index.ts:75; apps/native/src/main.tsx:41,46; apps/native/src/dump/MicButton.tsx:61; workers/ai-proxy/src/groq.ts:127` |
| 50 | medium | 2/3 | lint | TODO comments for ES i18n in finance code with no tracked owner | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:923-929,1366; packages/logic/src/finance/adhd-tax-detection.ts:46` |
| 51 | medium | 2/3 | cleancode | Overly permissive `as Record<string, unknown>` casts defeat type narrowing in worker validators | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:384; router/cook-history.ts:177; router/vision.ts:125; router/partner.ts:132; label.ts:198` |
| 52 | medium | 2/3 | validation | /ingest-event row accepted with size bounds but no schema/column or key-name validation | `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:212-226` |
| 53 | medium | 2/3 | validation | /route/:module context accepted as unknown with no size bound before reaching the model | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-254 (passed at ~314)` |
| 54 | medium | 2/3 | validation | user_id injected into KV key in /register-token without sanitization | `/Users/serrayildirim/ollie/apps/api/src/worker.ts:315-327` |
| 55 | medium | 2/3 | validation | /label scrubbed_text not size-checked before scrubPII; locale not value-validated | `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:108-130` |
| 56 | medium | 2/3 | types_errors | Response JSON cast to inline shape without runtime validation (Anthropic/Haiku) | `packages/api/src/anthropic.ts:204-206` |
| 57 | medium | 2/3 | types_errors | RPC/worker response cast to typed Array/Row without shape validation | `workers/ai-proxy/src/router/partner.ts:110; workers/ai-proxy/src/router/feed-me.ts:564-577` |
| 58 | medium | 2/3 | types_errors | parseInt/parseFloat `\|\| 0` masks NaN, silently zeroing counters/budgets | `workers/ai-proxy/src/index.ts:520; workers/ai-proxy/src/label.ts:137; workers/apns-push/src/index.ts:138` |
| 59 | medium | 1/3 | structure | packages/logic exports field omits 8 sub-namespaces it actually exports | `/Users/serrayildirim/ollie/packages/logic/package.json (exports) vs src/index.ts` |
| 60 | medium | 1/3 | structure | orchestrator test imports a root tool by traversing out of the package | `/Users/serrayildirim/ollie/packages/orchestrator/tests/finance.test.ts:12` |
| 61 | medium | 1/3 | duplication | Shared Anthropic call pattern (prompt-caching headers + content[0].text parse) duplicated | `workers/ai-proxy/src/label.ts:153-173, workers/cron/src/drain.ts:224-247 (and workers/ai-proxy/src/index.ts)` |
| 62 | medium | 1/3 | duplication | Retry/backoff counter logic hand-rolled in both cron drain jobs instead of @ollie/sync scheduler | `workers/cron/src/drain.ts:150-161, workers/cron/src/flush-notifications.ts:248-270; existing helper at packages/sync/src/retry.ts` |
| 63 | medium | 1/3 | duplication | Gemini 429/503 retry + response-parsing duplicated between gemini.ts and vision.ts | `workers/ai-proxy/src/gemini.ts:59-86, workers/ai-proxy/src/router/vision.ts:70-101` |
| 64 | medium | 1/3 | flows | Draft (grey-zone) fragments not mirrored to store, so watchers run on stale data until 'keep' is tapped | `apps/native/src/modules/dispatch.ts:64-70, 107-121` |
| 65 | medium | 1/3 | flows | Research orchestrator flush() never emits research:flush_succeeded / flush_failed | `packages/orchestrator/src/research.ts (flush function, ~L134-188)` |
| 66 | medium | 1/3 | flows | Cycle prediction dedup keyed on exact predictedTs — skips legitimate re-emits and grows unbounded | `packages/orchestrator/src/cycle.ts:144-150,157,216` |
| 67 | medium | 1/3 | flows | Notification daily-cap uses UTC midnight, misaligned with user local day | `workers/cron/src/flush-notifications.ts:393-400` |
| 68 | medium | 1/3 | flows | Notification scheduler silently falls back to DEFAULT_BUDGET when budget read fails | `packages/notifications/src/server-schedule.ts:83` |
| 69 | medium | 1/3 | flows | Server reminder bridge: getToken null/hang handling and unstable useEffect deps cause silent failures + effect churn | `apps/native/src/notify/serverReminderBridge.ts:74-80,93` |
| 70 | medium | 1/3 | algorithms | Bayesian posterior mean omits effective-sample-size normalization of the weighted data term | `packages/logic/src/cycle/posterior.ts:41 (with 34-38)` |
| 71 | medium | 1/3 | algorithms | Symptom-clustering hit rate excludes the final cycle from both numerator and denominator inconsistently | `packages/logic/src/cycle/symptom-clustering.ts:54,66` |
| 72 | medium | 1/3 | lint | `void x` used to suppress unused-var lint instead of the configured `_` prefix | `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:201; packages/orchestrator/tests/cycle.test.ts:84; packages/logic/src/finance/recurring.ts:473; packages/logic/src/body/caffeine-sleep.ts:395` |
| 73 | medium | 1/3 | lint | FocusTimer useEffect hooks disable exhaustive-deps with stale-closure risk | `/Users/serrayildirim/ollie/apps/native/src/modules/work/FocusTimer.tsx:188,200` |
| 74 | medium | 1/3 | lint | Widespread no-explicit-any eslint-disables (46 sites) | `/Users/serrayildirim/ollie/packages/ (verified: 46 occurrences; non-test src includes sync/finance.ts, orchestrator/admin.ts, notifications/backends/capacitor.ts, research-stream/src/index.ts, crypto/src/index.ts)` |
| 75 | medium | 1/3 | cleancode | Mutable module-level _aiProxyBaseUrl global mutated via exported setter breaks encapsulation and test isolation | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:135-140` |
| 76 | medium | 1/3 | cleancode | Repeated inline complex generic types on store.update calls (15+ sites) | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:732-735,770-773,778-787,800-809 and similar` |
| 77 | medium | 1/3 | cleancode | Underscore-prefixed helpers and duplicated date-parsing in sleep patterns lack clarity | `/Users/serrayildirim/ollie/packages/logic/src/sleep/patterns.ts:60-73,98-117` |
| 78 | medium | 1/3 | cleancode | buildBasePrompt takes 4 ungrouped positional parameters | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:813-818` |
| 79 | medium | 1/3 | validation | No length validation on invitee_user_hash in /claim-invite | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:215-223` |
| 80 | medium | 1/3 | validation | Partner pair code regex accepts 4-6 digits, allowing weak/short codes | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:104` |
| 81 | medium | 1/3 | validation | Timestamp fields in /purchase and /cook-history not validated after Date construction | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:137, cook-history.ts:126` |
| 82 | medium | 1/3 | security | Hardcoded predictable STAGING_TEST_USER_ID risks contaminating production data | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:17 and /Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:108` |
| 83 | medium | 1/3 | security | No format/length validation on invitee_user_hash in /claim-invite | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:215-223` |
| 84 | medium | 1/3 | security | Unauthenticated, unthrottled /validate-invite enables invite-code brute force | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:148-193` |
| 85 | medium | 1/3 | security | Rate-limit bucket collapses to a shared 'anon' key when user id and IP are absent | `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:421-429 and 533-549` |
| 86 | medium | 1/3 | security | Upstream Supabase error text returned to clients may leak internal detail | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:126-139 (upstreamError) and similar callers` |
| 87 | medium | 1/3 | security | No MIME-type validation on base64 image/PDF in /route/dump | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:154-180` |
| 88 | medium | 1/3 | security | Oversized scrubbed_text scrubbed in full before truncation in /label | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/../label.ts:130` |
| 89 | medium | 1/3 | security | Legacy 100k PBKDF2 iterations retained for old encrypted payloads | `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:48-55` |
| 90 | medium | 1/3 | types_errors | Double cast `as unknown as T` bypasses type safety in API client | `packages/api/src/client.ts:194` |
| 91 | medium | 1/3 | types_errors | Outer async promise chains lack a top-level .catch() (unhandled rejection risk) | `apps/native/src/notify/systemNotify.ts:283-313; apps/native/src/modules/dispatch.ts:107-121` |
| 92 | low | 3/3 | validation | excludeDishes array has no length bound in /feed-me | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466` |
| 93 | low | 3/3 | types_errors | Best-effort .catch(() => {}) blocks swallow errors with zero observability | `apps/native/src/modules/partner/repo.ts:112,129,130,168; packages/research-stream/src/index.ts:192-193,212-222; packages/consent/src/index.ts:245` |
| 94 | low | 2/3 | duplication | Rate-limit time-bucket slot calculation duplicated | `workers/ai-proxy/src/index.ts:517-518, workers/ai-proxy/src/invites.ts:299-307` |
| 95 | low | 2/3 | standards | Untyped catch parameters flagged as strict violation (largely a false positive) | `Across workers/ai-proxy, packages/orchestrator, packages/*, apps/native (~154 sites); narrowing examples: dump.ts:375, transcribe.ts:73-77` |
| 96 | low | 2/3 | standards | Fire-and-forget Promise.catch handlers swallow errors; repeated pattern not DRY | `workers/ai-proxy/src/router/feed-me.ts:242-243,356; dump.ts:314,351,418,479` |
| 97 | low | 2/3 | flows | Several pattern/lifecycle events emitted with no consumer (body:weekly_review, body:hydration_drop_detected, cycle:luteal_phase_entered, finance:bill_paid_on_time, finance:spending_spike_detected) | `packages/orchestrator/src/body.ts:275, body-weekly.ts:364, cycle.ts, finance.ts` |
| 98 | low | 2/3 | algorithms | Bootstrap CI uses asymmetric rounding (floor for low, ceil-1 for high) for symmetric percentiles | `packages/logic/src/stats/index.ts:188-189` |
| 99 | low | 2/3 | algorithms | Dysmenorrhea consecutive-run detection works but is fragile (backwards loop reads i+1) | `packages/logic/src/cycle/flags.ts:122-126` |
| 100 | low | 2/3 | cleancode | Magic numbers without explanatory constants/comments across workers | `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:244; index.ts:122; telemetry.ts:224; router/dump.ts:69` |
| 101 | low | 1/3 | structure | Inconsistent tsconfig include patterns across packages | `/Users/serrayildirim/ollie/packages/*/tsconfig.json` |
| 102 | low | 1/3 | structure | @ollie/orchestrator depends on 7 sibling packages (highest coupling) | `/Users/serrayildirim/ollie/packages/orchestrator/package.json` |
| 103 | low | 1/3 | duplication | Notification permission request try/catch duplicated across 3 backends | `workers/notifications/src/backends/electron.ts:55, web.ts:32-37, capacitor.ts:185-201` |
| 104 | low | 1/3 | duplication | ISO timestamp generation has no centralized helper | `workers/ai-proxy/src/telemetry.ts:158, workers/ai-proxy/src/invites.ts:101 & 229, workers/cron/src/flush-notifications.ts:232 & 354 (17+ sites)` |
| 105 | low | 1/3 | duplication | Insert-response builder + canonical normalization duplicated in grocery/cook handlers | `workers/ai-proxy/src/router/purchase.ts:177-180 & 220-228, workers/ai-proxy/src/router/cook-history.ts:165-168` |
| 106 | low | 1/3 | standards | Module-level setInterval / fire-and-forget scan started without cleanup | `apps/native/src/main.tsx:43-48` |
| 107 | low | 1/3 | standards | Critical env var typed as `string \| undefined` but passed to ClerkProvider without narrowing | `apps/native/src/main.tsx:50-58,93` |
| 108 | low | 1/3 | flows | Registry-only orphan: void:dump:receipt is defined but never emitted or consumed | `packages/events/src/registry.ts:32; packages/events/src/shapes.ts:28` |
| 109 | low | 1/3 | flows | grocery:routed fallback branch omits recipe_parent key, inconsistent with success branch | `packages/orchestrator/src/braindump-dispatch.ts:818-844` |
| 110 | low | 1/3 | flows | Crisis short-circuit discards all fragments with no diagnostic log | `apps/native/src/modules/dispatch.ts:40-42` |
| 111 | low | 1/3 | algorithms | snapToWordBoundaries relies on isWord(undefined) instead of explicit bounds checks | `packages/logic/src/journal/extract.ts:187-192` |
| 112 | low | 1/3 | algorithms | Late-bedtime detector counts only post-midnight times as 'late' (likely intentional night-owl detection, worth confirming) | `packages/logic/src/sleep/stats.ts:264-267` |
| 113 | low | 1/3 | algorithms | Anti-goal excerpt extraction omits leading context, unlike the contagion detector | `packages/logic/src/goals/phase3.ts:423 (cf. line 87)` |
| 114 | low | 1/3 | algorithms | DISPUTED: goal-interference foundB tag assignment (verified correct in code) | `packages/logic/src/goals/phase3.ts:462-465` |
| 115 | low | 1/3 | algorithms | DISPUTED: finance-cycle-spend division-by-zero (already guarded) | `packages/logic/src/patterns/finance-cycle-spend.ts:33,54-55` |
| 116 | low | 1/3 | lint | Repeated `as unknown as typeof fetch` casts in test doubles | `/Users/serrayildirim/ollie/packages/research-stream/tests/research.test.ts:179,198,213,228 (and workers/ test suites)` |
| 117 | low | 1/3 | lint | Inline bare catch blocks inconsistent with codebase multi-line style | `/Users/serrayildirim/ollie/packages/notifications/src/backends/electron.ts:55,66,82,90,109,120; packages/research-stream/src/index.ts:193` |
| 118 | low | 1/3 | cleancode | Mode-state init uses a fragile literal ternary chain instead of an allowed-set check | `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:93-98` |
| 119 | low | 1/3 | cleancode | Silent fire-and-forget catch blocks swallow errors with no observability | `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:749,798,827,845,863,873,891 (and 829-846 empty grocery fallback)` |
| 120 | low | 1/3 | cleancode | Vague TODO comments without owner, priority, or timeline | `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:923,929,1366; apps/native/src/modules/partner/repo.ts:39` |
| 121 | low | 1/3 | validation | No upper bound on body.qty in /grocery/purchase | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:210-214` |
| 122 | low | 1/3 | validation | No Content-Length pre-check on /transcribe audio body before buffering | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts:51-57` |
| 123 | low | 1/3 | validation | No length validation on channel in /generate-invite before normalizeChannel | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:92` |
| 124 | low | 1/3 | validation | Image mime passed to Gemini without magic-byte verification in /vision | `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:62 (validated 127-130)` |
| 125 | low | 1/3 | validation | sentry-tunnel projectId not format-validated before allowlist check | `/Users/serrayildirim/ollie/workers/sentry-tunnel/src/index.ts:75-77` |
| 126 | low | 1/3 | security | Invite expiry compared with exact client/server clock, no skew tolerance | `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:189` |
| 127 | low | 1/3 | types_errors | split(':').map(Number) destructured without length/range validation | `packages/orchestrator/src/body.ts:158; packages/orchestrator/src/sleep.ts:339` |
| 128 | low | 1/3 | types_errors | Non-null assertions (!) on nullable values in logic/sleep stats and goals | `packages/logic/src/sleep/stats.ts:54-55; packages/logic/src/goals/phase2.ts:106,271` |
| 129 | low | 1/3 | types_errors | APNs credential env vars passed to signer without presence validation | `apps/api/src/worker.ts:436-442 (callsite 407)` |

## Detail by dimension

### structure (11)

#### [critical · conf 3/3] Cloudflare Worker misplaced in apps/ instead of workers/
- **Location:** `/Users/serrayildirim/ollie/apps/api/ (package @ollie/api-worker)`
- **Problem:** apps/api is a Cloudflare Worker (package @ollie/api-worker, description 'Cloudflare Worker — APNs sender + device-token register', has wrangler.toml + src/worker.ts entry with /register-token, /send, /account/delete, /health, /cron/tick). It lives in apps/ alongside the user-facing native app, but all other Cloudflare Workers (ai-proxy, apns-push, cron, sentry-tunnel) live in workers/ and follow @ollie/worker-* naming. This breaks the layering model (apps/ = user-facing apps, workers/ = serverless functions) and the name 'apps/api' misleadingly suggests a REST API server. Verified: no package imports @ollie/api-worker, so the move is low-risk.
- **Fix:** Move apps/api/ to workers/apns-register/ (or workers/apns-notifications to match function) and rename the package from @ollie/api-worker to @ollie/worker-apns-register to match the @ollie/worker-* convention. pnpm-workspace.yaml already globs workers/*, so no workspace change needed. No dependent import paths to update (confirmed nothing imports it).

#### [critical · conf 1/3] Duplicate APNs workers with overlapping functionality
- **Location:** `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts and /Users/serrayildirim/ollie/apps/api/src/worker.ts`
- **Problem:** Two APNs workers coexist with overlapping but divergent surfaces: workers/apns-push (@ollie/worker-apns-push) exposes a single /push endpoint with rate limiting and signs APNs JWTs via pemToBinary + crypto.subtle; apps/api (@ollie/api-worker) exposes /register-token, /send, /account/delete, /health, /cron/tick and signs JWTs via @ollie/apns-jwt. It is unclear which is the deployed canonical worker, creating maintenance burden and risk of operational divergence (two independent JWT-signing paths).
- **Fix:** Decide the canonical worker and consolidate. If apps/api is production, migrate the rate-limited /push logic into it (now relocated to workers/ per the misplacement fix) and delete workers/apns-push; otherwise migrate /register-token, /send, /account/delete into workers/apns-push and delete apps/api. Standardize on one JWT-signing implementation (@ollie/apns-jwt) and update wrangler.toml + deploy docs to name the single worker.

#### [high · conf 2/3] Confusing @ollie/api vs @ollie/api-worker naming across layers
- **Location:** `/Users/serrayildirim/ollie/packages/api/package.json (@ollie/api) vs /Users/serrayildirim/ollie/apps/api/package.json (@ollie/api-worker)`
- **Problem:** Two 'api' packages in different layers cause confusion: packages/api (@ollie/api) is a shared HTTP client library (createOllieAPI, routeViaHaiku) imported by @ollie/notifications, @ollie/research-stream, @ollie/sync, and apps/native; apps/api (@ollie/api-worker) is a Cloudflare Worker. The bare name 'api' reads like an app or server rather than a client library, and the apps/ location of the worker compounds the ambiguity.
- **Fix:** Once the worker is moved to workers/ (see misplacement finding), the worker ambiguity resolves. For added clarity, optionally rename packages/api to packages/api-client (@ollie/api-client) and update imports in @ollie/notifications, @ollie/research-stream, @ollie/sync, and apps/native. Ensure @ollie/api stays dependency-light (currently only depends on @ollie/logic) so it remains a universal browser+server HTTP client.

#### [high · conf 1/3] Worker tsconfig.json files duplicate base config instead of extending tsconfig.base.json
- **Location:** `/Users/serrayildirim/ollie/workers/apns-push/tsconfig.json and /Users/serrayildirim/ollie/packages/worker-http/tsconfig.json`
- **Problem:** Both workers/apns-push/tsconfig.json and packages/worker-http/tsconfig.json copy the full compilerOptions block (target ES2022, module ESNext, moduleResolution Bundler, strict, esModuleInterop, skipLibCheck, noImplicitReturns, noFallthroughCasesInSwitch, isolatedModules) rather than using 'extends': '../../tsconfig.base.json'. Confirmed by reading both files. This violates DRY and means base-config changes silently skip these two. Other workers (ai-proxy, cron, sentry-tunnel) extend the base.
- **Fix:** Replace each with an extends form keeping only Worker-specific overrides. apns-push: { "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["@cloudflare/workers-types"], "lib": ["ES2022"] }, "include": ["src"] }. worker-http: same but preserve "noEmit": true and "include": ["src", "tests"].

#### [high · conf 1/3] No ESLint import-boundary enforcement for monorepo layering
- **Location:** `/Users/serrayildirim/ollie/eslint.config.mjs`
- **Problem:** eslint.config.mjs defines only a voice-library guard, react-hooks rules, and TypeScript rules — no import/boundary rules. The intended apps/ -> packages/ -> workers/ layering is implicit and unenforceable. The codebase does not currently violate it (no @ollie/native or @ollie/api-worker imports inside packages/), but nothing prevents future layering violations or circular dependencies.
- **Fix:** Add import-boundary enforcement via eslint-plugin-import or no-restricted-imports rules: (1) packages/* may import only packages/*; (2) workers/* may import only packages/*; (3) apps/* may import packages/ + workers/; (4) nothing may import from apps/. Scope rules by file path overrides in eslint.config.mjs.

#### [high · conf 2/3] Duplicate test/ and tests/ directories in pii-scrub package
- **Location:** `/Users/serrayildirim/ollie/packages/pii-scrub/test and /Users/serrayildirim/ollie/packages/pii-scrub/tests`
- **Problem:** packages/pii-scrub has BOTH a test/ directory (containing only golden fixtures, test/golden/) and a tests/ directory (containing tests/scrub.test.ts). Confirmed present. All 16 other packages use a single tests/ directory, and pii-scrub's tsconfig includes only tests/, so the test/ tree is outside the declared TS include and breaks the uniform layout, creating confusion about where tests/fixtures live.
- **Fix:** Move test/golden/ into tests/golden/ (or rename test/ to tests/fixtures/) and delete the stray test/ directory. Update the samples.json relative path inside tests/scrub.test.ts accordingly. Standardize on the single tests/ directory.

#### [medium · conf 2/3] apps/native colocates 61 test files in src/ unlike the rest of the monorepo
- **Location:** `/Users/serrayildirim/ollie/apps/native/src/ (61 *.test.ts[x] files) and /Users/serrayildirim/ollie/apps/native/vitest.config.ts`
- **Problem:** apps/native has 61 *.test.ts/.tsx files colocated next to source inside src/ (e.g. src/dump/BrainDumpInput.test.tsx, src/settings/features.test.ts, src/notify/serverReminder.test.ts). Every packages/* uses a dedicated tests/ directory. vitest.config.ts sets no explicit include glob, so test discovery falls back to the default **/*.test.{ts,tsx} pattern, making the location implicit. This complicates dist filtering and uniform tooling.
- **Fix:** Preferred: move all *.test.ts[x] from apps/native/src/ into apps/native/tests/ mirroring the source tree, and set vitest.config.ts include: ['tests/**/*.test.{ts,tsx}']. Acceptable alternative: keep colocation but make it explicit with include: ['src/**/*.test.{ts,tsx}'] and document it as an intentional app-level pattern.

#### [medium · conf 1/3] packages/logic exports field omits 8 sub-namespaces it actually exports
- **Location:** `/Users/serrayildirim/ollie/packages/logic/package.json (exports) vs src/index.ts`
- **Problem:** src/index.ts re-exports sub-namespaces (consumption, corrections, predict, products, prompts, ritual, stats, util) that have no corresponding entry in the package.json exports map. Current consumers reach them through the main '.' import so nothing breaks today, but the incomplete exports map misrepresents the public API surface and blocks sub-path imports/discoverability.
- **Fix:** Add the missing entries to package.json exports: ./consumption, ./corrections, ./predict, ./products, ./prompts, ./ritual, ./stats, ./util, each pointing to ./src/<name>/index.ts, so the exports map matches src/index.ts.

#### [medium · conf 1/3] orchestrator test imports a root tool by traversing out of the package
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/tests/finance.test.ts:12`
- **Problem:** finance.test.ts line 12 imports scanForBanned from '../../../tools/banned-phrases.cjs', traversing three levels out of the package to reach a root-level tool. Confirmed present. This breaks package encapsulation and couples the test to the tooling directory layout; banned-phrase scanning is already wired as the eslint 'ollie/no-banned-copy' rule, so the test-time check is redundant.
- **Fix:** Remove the cross-boundary import from the test and rely on the existing eslint 'ollie/no-banned-copy' rule for banned-phrase enforcement. If a runtime assertion is still wanted, expose the scanner via a vitest setup file or a proper workspace dev dependency rather than a '../../../' path.

#### [low · conf 1/3] Inconsistent tsconfig include patterns across packages
- **Location:** `/Users/serrayildirim/ollie/packages/*/tsconfig.json`
- **Problem:** tsconfig include globs are inconsistent across packages: 8 use ['src','tests'], 7 use ['src/**/*','tests/**/*'], and 1 uses ['src','tests','data']. Semantically identical (TS resolves 'src' as 'src/**') but the variation adds cognitive load and hinders tooling standardization.
- **Fix:** Standardize on ['src','tests'] (simplest, identical semantics) across all package tsconfigs, keeping the 'data' entry only where a data/ directory genuinely exists.

#### [low · conf 1/3] @ollie/orchestrator depends on 7 sibling packages (highest coupling)
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/package.json`
- **Problem:** orchestrator depends on @ollie/store, @ollie/events, @ollie/logic, @ollie/notifications, @ollie/consent, @ollie/pii-scrub, @ollie/cadence — the highest workspace-dependency count in the monorepo (confirmed). Not a blocker, but high fan-in signals a coarse-grained module that is harder to test in isolation and at greater risk of circular dependencies as it grows.
- **Fix:** Review the orchestrator's responsibilities; if it grows further, split thin top-level coordination (boot sequence, event flow) from domain-specific handlers (body-correlations, braindump-dispatch, finance) into smaller coordination modules to reduce coupling. Aligns with the brain/body (judgment vs deterministic harness) separation.

### duplication (15)

#### [critical · conf 1/3] UUID/newId generation duplicated across ~14 module repos + orchestrator + dump
- **Location:** `apps/native/src/modules/*/repo.ts (12+ modules), packages/orchestrator/src/braindump-dispatch.ts, apps/native/src/dump/archive.ts`
- **Problem:** Every native module repo (goals, sleep, pets, cycle, body, admin, habits, grocery, work, finance, medication, mood) defines an identical newId() function — try crypto.randomUUID() then fall back to a prefixed Date+Math.random string — differing only in the module prefix (s_, c_, b_, h_, ...). The orchestrator and dump archive repeat the same generation logic but unprefixed, creating both duplication and an inconsistency (no prefix means you can't trace which service minted an id). Verified: grep found 13 `function newId` in apps/native/src/modules alone.
- **Fix:** Create apps/native/src/lib/id-gen.ts exporting newModuleId(prefix: string): string with the single fallback implementation. Import it in every module repo (passing the module prefix) and in the orchestrator/dump (passing 'o'/'d'). Delete the 14+ local copies.

#### [critical · conf 2/3] fetch-with-timeout (AbortController + setTimeout + finally) hand-rolled 5+ times
- **Location:** `packages/api/src/client.ts:144-220, packages/api/src/anthropic.ts, packages/orchestrator/src/braindump-dispatch.ts:153-209, apps/native/src/api/workers.ts:359-413, workers/ai-proxy/src/invites.ts:402-410`
- **Problem:** The AbortController + setTimeout(abort) + fetch(signal) + finally clearTimeout pattern is reimplemented identically in at least 5 files (verified via grep for `new AbortController`). braindump-dispatch.ts:159-160 is verbatim with the copies in api/client.ts and apps/native/src/api/workers.ts, with only the timeout constant differing. This is reliability-critical code that drifts independently per copy.
- **Fix:** Export `fetchWithTimeout(url, init, timeoutMs)` from @ollie/worker-http alongside json()/upstreamError(). Replace all 5+ inline implementations with the shared helper so timeout/abort semantics stay consistent.

#### [high · conf 2/3] Duplicate Supabase REST construction (headers + POST) across 14 call sites
- **Location:** `workers/ai-proxy/src/{label,telemetry,invites}.ts + workers/ai-proxy/src/router/{purchase,cook-history,replenishment,feed-me,partner,route,server-apply}.ts, workers/cron/src/{drain,flush-notifications}.ts, apps/api/src/{worker,account-delete}.ts`
- **Problem:** Every Supabase REST call hand-rolls the same three headers (apikey, authorization: Bearer <service-role>, content-type) and the same POST/fetch shape. Verified: 14 files reference `apikey:`. flush-notifications.ts already extracted supabaseHeaders() but only for its own file, and purchase/cook-history/replenishment/feed-me repeat the full fetch-with-headers block. Both rounds independently flagged the header pattern (R1) and the POST pattern (R2) — same root cause.
- **Fix:** Create a shared Supabase REST client (e.g. packages/worker-http supabaseRest(env, path, body, opts) + supabaseRestHeaders(serviceRole)). Replace all 14 header constructions and the 4+ POST blocks with it so auth/header config is defined once.

#### [high · conf 2/3] Authorization Bearer-token extraction (auth.slice('Bearer '.length)) repeated 11 times
- **Location:** `workers/ai-proxy/src/index.ts:540 + workers/ai-proxy/src/router/{transcribe,feed-me,purchase,server-apply-routes,replenishment,partner,cook-history,route,brain-copy,dump}.ts`
- **Problem:** Handlers manually check the 'Bearer ' prefix and slice it off before passing to verifyClerkJwt. Verified: 11 files in workers/ai-proxy/src do this. Hand-rolled prefix slicing is typo-prone and inconsistently validated (some check startsWith, some assume the prefix). R3 also flagged the related Bearer-header injection on the client side, same root cause of no shared auth-header helper.
- **Fix:** Add extractBearerToken(authHeader): string | null and buildAuthHeaders(token?) to @ollie/worker-http. Replace all 11 manual extractions and the client-side header builders (braindump-dispatch.ts:163-164, apps/native/src/api/workers.ts:365-370) with these.

#### [high · conf 2/3] Safe response-text reader duplicated as safeText / .text().catch().slice() in 15 files
- **Location:** `packages/api/src/client.ts:309-311, apps/native/src/api/workers.ts:415-417, workers/cron/src/flush-notifications.ts:486-492, apps/api/src/account-delete.ts:383-385, plus workers/ai-proxy/src/{gemini,openrouter,groq}.ts + router/{feed-me,transcribe,vision,purchase,dump,cook-history,route,replenishment}.ts`
- **Problem:** Two framings of the same root cause: a named safeText() helper redefined ~4 times (R3, verified: client.ts, workers.ts, account-delete.ts, flush-notifications.ts each has its own), and the inline provider/router pattern `(await res.text().catch(() => '')).slice(0, 200|300)` repeated 11 times in ai-proxy (R2, verified). All are 'safely read a Response body for logging, optionally truncate'. @ollie/sync also has safeErrSummary() for the same S4 safe-logging goal.
- **Fix:** Export a single safeResponseText(res, maxLen?) from @ollie/worker-http (and reuse @ollie/sync safeErrSummary for error objects). Replace the 4 safeText copies and the 11 inline text().catch().slice() sites; parameterize truncation length.

#### [high · conf 1/3] SHA-256-to-hex conversion hand-rolled 5 times
- **Location:** `workers/ai-proxy/src/index.ts:551-558, workers/ai-proxy/src/telemetry.ts:46-50, workers/ai-proxy/src/router/shelf-life.ts:48-60, workers/ai-proxy/src/router/vectorize.ts:240-247, workers/ai-proxy/src/router/server-apply.ts:52-58`
- **Problem:** crypto.subtle.digest('SHA-256', ...) followed by byte-to-hex conversion is implemented 5 times with minor stylistic variations (for-loop vs spread+map). Verified: 5 files in workers/ai-proxy/src contain the `toString(16).padStart(2,'0')` hex conversion. index.ts and shelf-life.ts use the loop form; telemetry/vectorize/server-apply use the spread+map form.
- **Fix:** Add `sha256Hex(data: string | Uint8Array): Promise<string>` to @ollie/worker-http (or a packages/crypto). Import in all 5 sites and delete the local conversions.

#### [high · conf 1/3] randomUUID() fallback reimplemented in worker/package code instead of using worker-http
- **Location:** `packages/research-stream/src/index.ts:338-349, packages/orchestrator/src/braindump-dispatch.ts:312-317, apps/native/src/dump/archive.ts:74-78, workers/ai-proxy/src/{label.ts:209, telemetry.ts, router/dump.ts}`
- **Problem:** @ollie/worker-http already exports newRequestId() (verified at packages/worker-http/src/index.ts:66) with crypto.randomUUID + manual v4 fallback, but research-stream, orchestrator, dump archive each reimplement the same fallback, and several ai-proxy workers call bare crypto.randomUUID() directly for DB-row ids. Distinct from the native-module newId cluster (different file set, no module prefixes) but same 'reinvented UUID helper' root cause.
- **Fix:** Promote/export a generic uuid()/id() from @ollie/worker-http (reusing the newRequestId fallback). Replace the 3 fallback reimplementations and the bare crypto.randomUUID() worker calls with it.

#### [medium · conf 2/3] JSON request-body parse try/catch -> bad_json boilerplate in 10+ handlers
- **Location:** `workers/ai-proxy/src/{label.ts:107-110, telemetry.ts:121-125, invites.ts:69-74}, workers/ai-proxy/src/router/{purchase.ts:113-122, cook-history.ts:102-111, ...}, apps/api/src/worker.ts`
- **Problem:** Endpoint handlers repeat `try { body = (await req.json()) as T } catch { return json({error:'bad_json'},400) }` verbatim. Verified: 10 files in workers/ai-proxy/src reference 'bad_json'. purchase.ts and cook-history.ts are word-for-word identical (R2).
- **Fix:** Add parseJsonBody<T>(req) to @ollie/worker-http returning {ok:true,body} | {ok:false,response: json(...,400)}. Use it across the 10+ endpoints.

#### [medium · conf 1/3] Shared Anthropic call pattern (prompt-caching headers + content[0].text parse) duplicated
- **Location:** `workers/ai-proxy/src/label.ts:153-173, workers/cron/src/drain.ts:224-247 (and workers/ai-proxy/src/index.ts)`
- **Problem:** Both /label and the cron drain call Anthropic with identical 'anthropic-beta: prompt-caching-2024-07-31' headers, system-prompt-as-cache_control-array body shape, and content[0].text JSON-extraction parsing. Verified: prompt-caching appears in label.ts, index.ts, drain.ts. Drift risk: cache config and parse logic must be edited in multiple places.
- **Fix:** Extract callAnthropic(config, systemPrompt, userMessage) into a shared worker module so prompt-caching headers and response parsing are defined once.

#### [medium · conf 1/3] Retry/backoff counter logic hand-rolled in both cron drain jobs instead of @ollie/sync scheduler
- **Location:** `workers/cron/src/drain.ts:150-161, workers/cron/src/flush-notifications.ts:248-270; existing helper at packages/sync/src/retry.ts`
- **Problem:** drain.ts bumpRetry() keeps a per-id KV counter capped at MAX_RETRIES=12; flush-notifications.ts independently increments job.attempts capped at MAX_ATTEMPTS=3. A BackoffScheduler already exists in packages/sync/retry.ts but neither drain uses it. Per the harness retry constitution (max attempts + backoff owned by the deterministic layer), this logic should be one shared implementation.
- **Fix:** Surface createBackoffScheduler/BackoffScheduler from @ollie/sync as the public job-retry API (or a thin job-retry wrapper) and route both drain jobs through it rather than per-table counters.

#### [medium · conf 1/3] Gemini 429/503 retry + response-parsing duplicated between gemini.ts and vision.ts
- **Location:** `workers/ai-proxy/src/gemini.ts:59-86, workers/ai-proxy/src/router/vision.ts:70-101`
- **Problem:** vision.ts reimplements gemini.ts's 429/503-retry-with-setTimeout (900ms vs 1000ms — an unintended inconsistency) and the candidates[0].content.parts.map(p=>p.text??'').join() extraction (join('') vs join(' ')), instead of reusing geminiJson. Two copies of the same Gemini API contract that have already diverged.
- **Fix:** Extract geminiWithRetry(url, opts, delayMs) and extractGeminiContent(data) into a shared workers/ai-proxy/src/gemini helper; have vision.ts call them so retry delay and join behavior are single-sourced.

#### [low · conf 2/3] Rate-limit time-bucket slot calculation duplicated
- **Location:** `workers/ai-proxy/src/index.ts:517-518, workers/ai-proxy/src/invites.ts:299-307`
- **Problem:** Both the general per-key limiter and checkInviteRate() compute `Math.floor(Date.now()/1000)` then `Math.floor(now / RATE_WINDOW_SEC)` for the sliding-window KV slot, plus the increment+TTL put. Identical 60s-window logic implemented twice (flagged independently in R1 and R2).
- **Fix:** Add a small RateLimiter/makeRateLimitSlot(key, windowSec) helper (worker-http or a KV-utils module) and use it for both invite and general rate limiting.

#### [low · conf 1/3] Notification permission request try/catch duplicated across 3 backends
- **Location:** `workers/notifications/src/backends/electron.ts:55, web.ts:32-37, capacitor.ts:185-201`
- **Problem:** electron, web, and capacitor backends each wrap Notification.requestPermission() in try/catch with their own fallback ('denied'/undefined/default). The permission-acquisition + fallback flow is duplicated per backend.
- **Fix:** Add requestPermissionWithFallback() to a shared packages/notifications permission-helpers module returning a normalized 'granted'|'denied'|'default'; call it from all three backends.

#### [low · conf 1/3] ISO timestamp generation has no centralized helper
- **Location:** `workers/ai-proxy/src/telemetry.ts:158, workers/ai-proxy/src/invites.ts:101 & 229, workers/cron/src/flush-notifications.ts:232 & 354 (17+ sites)`
- **Problem:** Direct new Date().toISOString() (and Date.now()+ttl variants) appears 17+ times across workers. Low risk today, but fragile if UTC assertions or a clock abstraction (e.g. for testing) are ever needed.
- **Fix:** Add nowIso() (and optionally isoFromNow(ms)) to @ollie/worker-http and use it for timestamp creation, centralizing any future timezone/clock handling.

#### [low · conf 1/3] Insert-response builder + canonical normalization duplicated in grocery/cook handlers
- **Location:** `workers/ai-proxy/src/router/purchase.ts:177-180 & 220-228, workers/ai-proxy/src/router/cook-history.ts:165-168`
- **Problem:** purchase.ts and cook-history.ts share the same `insertedId ? {inserted:true,id} : {inserted:true}` response ternary, and purchase.ts hand-rolls normalizeCanonical (trim+lowercase+set lookup) that other list-based handlers (feed-me) likely need too.
- **Fix:** Add makeInsertResponse(insertedId?) and normalizeCanonical(raw, allowedSet) to a small shared router-utils module; reuse in purchase, cook-history, and feed-me.

### standards (7)

#### [high · conf 2/3] External API / request JSON cast to a type with no runtime validation
- **Location:** `workers/ai-proxy/src/router/transcribe.ts:89; feed-me.ts:717,950; dump.ts:157; route.ts:416; partner.ts:110; vectorize.ts:108`
- **Problem:** The dominant standards gap across the workers: responses from Groq, Voyage, Gemini and Supabase — plus inbound request bodies — are cast with `as { ... }` straight off `res.json()`/`req.json()` with zero runtime shape validation. TypeScript only checks the cast at compile time; if an upstream API changes shape or returns an error envelope, the cast still succeeds and the failure surfaces later as an undefined-property access far from the source, making it hard to map back to the bad response. transcribe.ts:89 compounds this with `.catch(() => ({}))`, so a parse failure is indistinguishable from a genuinely empty transcription. dump.ts:157 casts the request body as `typeof body` with no per-field validation. Confirmed in code: e.g. `const data = (await res.json().catch(() => ({}))) as { text?: string };` (transcribe.ts:89) and `body = (await req.json()) as typeof body;` (dump.ts:157).
- **Fix:** Add small type-guard/validator functions at each external boundary and validate before use. For transcribe: parse without the empty-object fallback and 502 on parse failure, then verify `typeof data.text === 'string' || data.text === undefined`. For Voyage/Gemini/Supabase rows: validate array-ness and element shape (e.g. every embedding is `number[]`; every cache row has the expected string fields) and reject with 502 on mismatch. For dump request bodies: after `const raw = await req.json()`, guard `typeof raw === 'object' && raw !== null` then check each required field explicitly. A shared `assertShape`/`isXxx` helper keeps this DRY across routers.

#### [medium · conf 2/3] globalThis cast to `any` to reach platform APIs (btoa/atob/Buffer, navigator, crypto.randomUUID)
- **Location:** `packages/crypto/src/index.ts:85-86,219,226; packages/research-stream/src/index.ts:144-146,340`
- **Problem:** Cross-platform environment detection casts `globalThis` to `any` (or to a loose `{ crypto?: { getRandomValues?: (a: any) => any } }`) to access btoa/atob/Buffer, navigator.onLine, and crypto.randomUUID. The `any` cast disables type checking on every property reached through it, which is the kind of escape hatch strict mode is meant to prevent. Confirmed: `const g: any = globalThis;` at crypto/src/index.ts:219 and :226, and the `getRandomValues?: (a: any) => any` shape at :85-86; research-stream/src/index.ts:144-146 has the same `const g: any = globalThis;`. Note: these are intentional, guarded with `typeof ... === 'function'` checks, and carry eslint-disable comments, so this is a hygiene/standards finding, not a correctness bug.
- **Fix:** Replace the broad `any` with a narrow typed view of globalThis, e.g. `const g = globalThis as { btoa?: (s: string) => string; atob?: (s: string) => string; Buffer?: typeof Buffer };` and `as { navigator?: { onLine?: boolean }; crypto?: { randomUUID?: () => string } }`. This keeps the same runtime guards while restoring type checking on the accessed members. Acceptable to keep as-is if the team treats the eslint-disabled cross-platform shims as a sanctioned exception.

#### [high · conf 1/3] Supabase FORCE RLS / GRANT coverage not audited beyond the 6 worker tables
- **Location:** `supabase/migrations/20260615000002_force_rls_and_grants.sql`
- **Problem:** Migration 20260615000002 adds FORCE ROW LEVEL SECURITY and explicit GRANTs, but only for 6 tables (grocery_purchase_history, cook_history, routing_cache, partner_codes, partner_pairs, partner_snapshots). Without FORCE RLS, policies do not apply to the table OWNER role, so any owner-context connection bypasses every policy. Any other worker-accessed table created before this migration may still lack FORCE RLS, leaving a defense-in-depth gap. The migration is also very recent (2026-06-15), so coverage of the full table set is unverified.
- **Fix:** Run an audit query to find every public table missing forced RLS: `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relforcerowsecurity;` Apply FORCE ROW LEVEL SECURITY to any worker-accessed table in that list. Separately confirm worker mutations (INSERT/UPDATE/DELETE) always run with service_role creds and never an end-user JWT, and assert SUPABASE_SERVICE_ROLE presence at worker boot.

#### [low · conf 2/3] Untyped catch parameters flagged as strict violation (largely a false positive)
- **Location:** `Across workers/ai-proxy, packages/orchestrator, packages/*, apps/native (~154 sites); narrowing examples: dump.ts:375, transcribe.ts:73-77`
- **Problem:** Round 3 reported 154 `catch (e)`/`catch (err)` sites as strict-mode violations. This framing is incorrect: tsconfig.base.json sets `strict: true`, which enables `useUnknownInCatchVariables`, so an unannotated catch parameter is already typed `unknown` — it does NOT violate noImplicitAny and the project type-checks clean (confirmed 163 such sites repo-wide). The legitimate residual is consistency: a few handlers narrow via `(err as { status?: number })?.status` (dump.ts:375) which casts rather than guards. So this is a style/consistency nit, not a standards breach.
- **Fix:** No mandatory change. Optionally adopt a single convention — either rely on the implicit `unknown` everywhere, or annotate `catch (err: unknown)` consistently — and replace ad-hoc casts like `(err as { status?: number })?.status` with a shared `errorStatus(err: unknown)` / `errorMessage(err: unknown)` helper that uses `instanceof Error` and `'status' in err` guards.

#### [low · conf 1/3] Module-level setInterval / fire-and-forget scan started without cleanup
- **Location:** `apps/native/src/main.tsx:43-48`
- **Problem:** A 30-minute pantry-push scan interval is created at module scope and never cleared. It is guarded by a `document.visibilityState` check and is app-lifetime by design, but an uncancellable module-level interval is awkward for tests, hot-reload, and Storybook, and bypasses the orchestrator's lifecycle management. Confirmed at main.tsx:43-48.
- **Fix:** Move the interval into a React effect with cleanup (`useEffect(() => { const id = setInterval(...); return () => clearInterval(id); }, [])`) in a top-level component, or register it with the store/orchestrator lifecycle so it can be stopped. Functional as-is; this is hygiene only.

#### [low · conf 1/3] Critical env var typed as `string | undefined` but passed to ClerkProvider without narrowing
- **Location:** `apps/native/src/main.tsx:50-58,93`
- **Problem:** VITE_CLERK_PUBLISHABLE_KEY is read as `string | undefined` and a runtime `if (!PUBLISHABLE_KEY) throw` guards it, so behavior is correct. The minor standards point is that the throw does not narrow the const's type, so the value handed to ClerkProvider still reads as possibly-undefined at the type level. Confirmed at main.tsx:50-58 and :93.
- **Fix:** Narrow after the guard, e.g. assign to a new `const publishableKey: string = PUBLISHABLE_KEY` inside/after the throw branch, or use a small assert helper, so the value passed to ClerkProvider is statically `string`.

#### [low · conf 2/3] Fire-and-forget Promise.catch handlers swallow errors; repeated pattern not DRY
- **Location:** `workers/ai-proxy/src/router/feed-me.ts:242-243,356; dump.ts:314,351,418,479`
- **Problem:** Best-effort cache updates and similar background work use `void fn().catch((e) => console.error(...))`. The errors are logged (so not fully silent), but the pattern is copy-pasted across routers with no metric/observability and no shared helper, and a few sites swallow without any counter. Acceptable as best-effort but a consistency/observability standards nit.
- **Fix:** Extract a shared `bestEffort(promise, label)` helper that logs and increments a failure metric, and route the fire-and-forget cache updates through it so the pattern is consistent and observable.

### flows (19)

#### [critical · conf 1/3] 5 admin events emitted but never registered in @ollie/events
- **Location:** `packages/orchestrator/src/admin.ts:365,390,414,438,460`
- **Problem:** admin.ts unconditionally emits admin:cost_of_delay (L365), admin:ef_scaffold (L390), admin:decision_recall (L414), admin:doc_refs (L438), and admin:schedule_drift (L460). VERIFIED: none of these 5 names exist in packages/events/src/registry.ts (which does register the other ~12 admin:* events at L204-216). The emit() function warns on unregistered names and the typed-payload contract is broken for these 5, so they slip past shape validation and pollute logs on every emit.
- **Fix:** Add the 5 missing events to packages/events/src/registry.ts with their actual emitted payload shapes, e.g. 'admin:cost_of_delay': { payload: '{ task_id: string, ts: number }' }, 'admin:ef_scaffold': { payload: '{ ef_state: string, count: number, ts: number }' }, 'admin:decision_recall': { payload: '{ rule_id: string, ts: number }' }, 'admin:doc_refs': { payload: '{ task_id: string, count: number, ts: number }' }, 'admin:schedule_drift': { payload: '{ category: string, ts: number }' }. Add matching entries to shapes.ts if shape validation is desired.

#### [high · conf 3/3] Admin orchestrator emits ~14-15 events that have no consumer (only phone_task_detected is subscribed)
- **Location:** `packages/orchestrator/src/admin.ts (multiple emit sites); subscriber at admin.ts:563`
- **Problem:** All 3 rounds independently found this. The admin orchestrator emits ~15 admin:* events (open_loop_missing, cost_of_delay, decision_recall, defer_chain, doc_refs, ef_scaffold, firehose_dump, last_5pct, paperwork_split, renewal_cue, schedule_drift, stale_ball, two_minute_tasks, appointment_completed, recurring_pattern). VERIFIED: the ONLY events.on('admin:...') subscriber in the orchestrator is admin:phone_task_detected (admin.ts:563). The remaining events are emitted into the void — no notification, no telemetry bridge (orphan-cue-bridge does not list them), no UI update. Significant pattern-detection work produces no observable effect.
- **Fix:** Pick one consistent path: (a) add the actionable admin:* events to BRIDGED_CUE_EVENTS in orphan-cue-bridge.ts so they are at least captured for telemetry, OR (b) wire a dedicated admin-insight aggregator that subscribes to all admin:* events and consolidates into shared.moduleInsights + scheduleNotification, mirroring the patterns.ts MODULE_PATTERN_EVENTS model, OR (c) delete the emits that are genuinely unused. Do not leave registered-but-orphaned emits in shipped code.

#### [high · conf 1/3] Dead event flow: goals:convert_to_habit has a listener but no production emitter
- **Location:** `packages/orchestrator/src/habits.ts:266 (listener); no production emitter`
- **Problem:** habits.ts:266 subscribes to goals:convert_to_habit to cross-dispatch a goal into a habit when the user taps 'convert to habit'. VERIFIED: grep across apps/ and packages/ finds zero production emits of this event — only test emits in goals-cues.test.ts. The event is registered (registry.ts:201) and test-covered, but the UI never emits it, so the entire goal→habit conversion path is dead.
- **Fix:** Add the missing UI emit in the goals detail view (apps/native/src/modules/goals) so tapping 'convert to habit' fires events.emit('goals:convert_to_habit', { goal_id, habit_title, cadence, ts: Date.now() }). If the feature is not intended for this release, remove the dead listener + registry entry to avoid implying a working flow.

#### [high · conf 1/3] Dead event flow: sleep:wind_down_step has a listener but the WindDownChecklist UI never emits it
- **Location:** `packages/orchestrator/src/sleep.ts:646 (listener); apps/native/src/modules/sleep/bridge.ts:175 (documented-but-unimplemented emit)`
- **Problem:** sleep.ts:646 listens for sleep:wind_down_step to append each ritual-step tap to windDownLog for the wind-down friction detector. VERIFIED: zero production emits exist — only test emits in sleep.test.ts. The comment at bridge.ts:175 documents the UI 'should' emit this, but the WindDownChecklist never does, so the friction detector receives no step-level data and the feature is inert.
- **Fix:** Implement emission in the WindDownChecklist component: on each item check/uncheck, events.emit('sleep:wind_down_step', { ts: Date.now(), step_id, step_label, action: 'checked'|'unchecked' }). Matches the registered shape at registry.ts:141.

#### [high · conf 3/3] Module-pattern events depend on a single non-guaranteed consumer (patterns orchestrator); work pattern handling is consistent but fragile on init order
- **Location:** `packages/orchestrator/src/patterns.ts:53-61, 282-286`
- **Problem:** All 3 rounds flagged this. Six module-pattern events (goals/sleep/work/finance/habits/grocery :pattern_detected) are emitted by their detectors and consolidated into shared.moduleInsights + scheduleNotification ONLY by the patterns orchestrator (MODULE_PATTERN_EVENTS at patterns.ts:54-61, the sole subscriber at L282-286). VERIFIED: work:pattern_detected IS included in the array (Round 1's claim that it is missing is FALSE). The real risk all rounds converge on: this is a single point of dependency. If patternsOrch.init() is not called, races, or is torn down, every module's pattern alert is silently lost. The boot sequence currently inits patterns before module orchestrators, but nothing enforces or documents that invariant, and there is no fallback consumer.
- **Fix:** Make patterns orchestrator init non-optional and ordered-before-modules in createOrchestrator, with a startup assertion that the 6 subscribers are registered before module emits can fire. Document the ordering invariant at both the patterns.ts subscription site and each emit site. Consider a resilient two-phase design: per-module buffering of pattern events that survives init-order, plus a secondary aggregation pass after all modules initialize.

#### [high · conf 2/3] Router MODULE_CONFIGS and native dispatch stubHandlers can drift, causing route-success / dispatch-fail data loss
- **Location:** `workers/ai-proxy/src/router/route.ts:118-130 (MODULE_CONFIGS); apps/native/src/modules/dispatch.ts:51-58 (handler lookup)`
- **Problem:** Rounds 1 and 3 found the two halves of one root cause. route.ts maintains MODULE_CONFIGS (11 modules) while dispatch.ts resolves handlers from stubHandlers (14 entries, adds crisis/dump_only/mood). If the router classifies a fragment into a module the native app has no handler for, dispatch.ts:52-57 pushes { ok: false, note: 'no handler for <module>' } and continues — but the dump is still acked, so the user believes input was captured when it was silently dropped. There is no compile-time or runtime cross-check that the AI-proxy module list and the native handler registry stay in sync.
- **Fix:** Establish one authoritative module list (e.g. router/schema.ts) that both route.ts MODULE_CONFIGS and dispatch.ts stubHandlers import/derive from, OR add a build-time `satisfies Record<Module, ModuleHandler>` assertion plus a lint/test that fails when the two key sets diverge. Additionally, escalate a 'no handler' result at the dispatch level (not just per-fragment) so the dump ack reflects partial failure instead of silently succeeding.

#### [high · conf 1/3] groqClassify model ladder falls back to [undefined], passing undefined as the model arg
- **Location:** `workers/ai-proxy/src/router/route.ts:507,512`
- **Problem:** VERIFIED: route.ts:507 builds `const modelLadder = tier?.models ?? [undefined];` then L512 loops and passes each `model` into groqChat. When no tier config exists (grocery + any future module without a tier entry), the ladder is literally [undefined], so groqChat receives an explicit undefined model rather than the param being omitted. Whether this safely falls back to the worker default depends entirely on groqChat's handling of undefined; if it forwards undefined into the request body it can fail or produce undefined behavior.
- **Fix:** Confirm groqChat treats undefined/missing model as 'use worker default'. If not, change to a guarded default, e.g. `const modelLadder = tier?.models?.length ? tier.models : [DEFAULT_GROQ_MODEL];`, so an explicit valid model name is always passed.

#### [medium · conf 2/3] Grocery routing events consumed only by UI hook — lost if hook unmounted / not yet mounted; mutation failures are silent
- **Location:** `packages/orchestrator/src/braindump-dispatch.ts:744-879 (emit + async routing)`
- **Problem:** Rounds 1 and 2 converge here. grocery:routing:pending and grocery:routed are emitted by the braindump dispatcher and consumed ONLY by the UI hook (useGroceryRouting); there is no backend consumer. If the grocery screen is not mounted when the event fires (dispatch before mount), the result evaporates — a race not present for orchestrator-consumed events. Compounding it (Round 2): when the routing AI call fails/returns null the fallback emits an empty/partial result with no user-facing error; for mutations (remove/check/move_to_pantry) this is a silent no-op the user assumes succeeded.
- **Fix:** Decouple from event timing: write the routing result to a store key (e.g. shared.lastGroceryRoutingResult) the UI reads reactively, OR add a backend buffer the UI can drain retroactively (like the research intake buffer). Wrap callGroceryRoute in try/catch and emit a dedicated grocery:routing:failed (with error: true for mutations) so the UI can show a 'couldn't process that' state instead of a silent drop.

#### [medium · conf 1/3] Draft (grey-zone) fragments not mirrored to store, so watchers run on stale data until 'keep' is tapped
- **Location:** `apps/native/src/modules/dispatch.ts:64-70, 107-121`
- **Problem:** VERIFIED: when fragment.needsConfirm is true (0.60-0.79 confidence), dispatch.ts:64-70 records the entry as a draft and `continue`s WITHOUT calling handler.apply(), so nothing is written to the module repo. runAllSyncs (L107-121) then mirrors only already-written data, so the Layer-2 watchers never see the pending fragment. They compute and cache state from pre-fragment data until applyFragment() eventually runs on 'keep' (possibly minutes later or never), creating a flow discontinuity between the confirm card and the watcher view.
- **Fix:** On draft, write the fragment to the module repo with a 'pending'/'draft' status (or a separate pending table) and run the sync, so watchers can see what is awaiting confirmation; OR publish pending fragments to a dedicated store key (e.g. shared.pendingFragments) the watchers read. applyFragment() then promotes the draft to committed on 'keep'.

#### [medium · conf 2/3] Boot race: orchestrator.init() subscribes to store keys before fire-and-forget runAllSyncs populates them
- **Location:** `apps/native/src/store.ts:119,132 (init before non-awaited runAllSyncs); apps/native/src/bridge/index.ts:59-66 (in-app captures never mirror until next dump)`
- **Problem:** Rounds 3 and 1 describe one capture/sync timing root cause. At boot, orchestrator.init() (store.ts:119) subscribes to store keys before the fire-and-forget `void runAllSyncs(store)` (L132) populates them, so watchers can tick on an empty store, cache empty results, and not recompute until the next change. Related (bridge/index.ts:59-66, the 'great disconnect'): in-app capture UIs (e.g. FocusTimer) write SQLite without mirroring to the store; syncToStore runs only on boot + after dumps, so a capture made and then app-quit-without-dump never reaches watchers until next launch.
- **Fix:** Populate all store keys with empty defaults BEFORE orchestrator.init(), or gate watcher computation on a 'boot-sync-done' signal with a timeout fallback. For in-app captures, mirror each capture to the store immediately (write + event) or add a sync-on-app-suspend lifecycle hook so backgrounded captures are not lost until next launch.

#### [medium · conf 1/3] Research orchestrator flush() never emits research:flush_succeeded / flush_failed
- **Location:** `packages/orchestrator/src/research.ts (flush function, ~L134-188)`
- **Problem:** flush() ships rows to /label and calls an internal onError on failure but never emits the registered research:flush_succeeded or research:flush_failed events. External telemetry subscribers therefore cannot observe pipeline health (success counts, failure reasons) — the only failure signal is an internal callback.
- **Fix:** Emit at the end of flush(): on success events.emit('research:flush_succeeded', { count: drain.length, ts: Date.now() }); on catch events.emit('research:flush_failed', { count: pending.size, reason: err.message, ts: Date.now() }).

#### [medium · conf 1/3] Cycle prediction dedup keyed on exact predictedTs — skips legitimate re-emits and grows unbounded
- **Location:** `packages/orchestrator/src/cycle.ts:144-150,157,216`
- **Problem:** cycle:period_* dedup uses a Set in store key '_predictionEmittedKeys' with keys like `period_approaching:${nextTs}` (exact timestamp). When a prediction is revisited with the same timestamp it is silently skipped (intended), but the set is appended to (L216) and never pruned, so over months it accumulates thousands of stale keys. The window-vs-exact-timestamp coupling also means timestamp drift produces a new emit while same-timestamp revisits are suppressed inconsistently.
- **Fix:** Key the dedup on a window rather than an exact timestamp, e.g. `period_approaching:week_of:${isoWeek}`, so a prediction fires once per window regardless of small timestamp drift; and/or periodically prune emitted keys older than N days to bound the set.

#### [medium · conf 1/3] Notification daily-cap uses UTC midnight, misaligned with user local day
- **Location:** `workers/cron/src/flush-notifications.ts:393-400`
- **Problem:** countSentToday computes start-of-day via setUTCHours(0,0,0,0) because the cron worker cannot decrypt the user's timezone. A Pacific user with a daily cap of 4 has the cap reset at 08:00 local (00:00 UTC), not local midnight. Commented as 'close enough for a soft cap', but it is a silent behavioral discrepancy from user expectation.
- **Fix:** Store a non-encrypted user_timezone column (push_tokens or user_settings) so the worker computes correct local midnight, OR move the calendar-day cap to the client (which can decrypt timezone) and let the server enforce only hard DB limits. Document the current behavior as a known limitation either way.

#### [medium · conf 1/3] Notification scheduler silently falls back to DEFAULT_BUDGET when budget read fails
- **Location:** `packages/notifications/src/server-schedule.ts:83`
- **Problem:** scheduleServerJob uses `const budget = deps.budget ?? DEFAULT_BUDGET;` with no logging. If the user's real (encrypted) budget could not be read, the default cap is silently applied — which may be looser than the user's actual cap, allowing notifications to bypass the intended limit, invisibly to ops.
- **Fix:** Log a warning when deps.budget is missing so the fallback is observable; better, treat a failed budget read as a distinct 'budget_unavailable' signal so the worker can refuse to over-send rather than trusting the default cap.

#### [medium · conf 1/3] Server reminder bridge: getToken null/hang handling and unstable useEffect deps cause silent failures + effect churn
- **Location:** `apps/native/src/notify/serverReminderBridge.ts:74-80,93`
- **Problem:** useServerReminderBridge calls await getToken(); a thrown error returns silently (L76) and a null token returns silently (L80) with no diagnostic distinction — on Electron/desktop getToken can hang or return null, so server-side reminders fail invisibly. Separately, the useEffect deps [getToken, userId] include getToken, which is a fresh reference each render from useAuth(), so the effect re-installs the reminder capability on every render and the cleanup cannot abort in-flight async closures from the prior iteration.
- **Fix:** Add a timeout wrapper around getToken() and log distinctly for 'token threw' vs 'token null' (plus an error counter for ops). Stabilize the effect: wrap getToken via useCallback or move the bridge setup to module scope so it wires once per auth change, and add a cancellation token so superseded async reminder closures abort before resolving.

#### [low · conf 2/3] Several pattern/lifecycle events emitted with no consumer (body:weekly_review, body:hydration_drop_detected, cycle:luteal_phase_entered, finance:bill_paid_on_time, finance:spending_spike_detected)
- **Location:** `packages/orchestrator/src/body.ts:275, body-weekly.ts:364, cycle.ts, finance.ts`
- **Problem:** Rounds 1 and 2 both found body:hydration_drop_detected and body:weekly_review emitted with zero events.on subscribers; Round 1 adds cycle:luteal_phase_entered, finance:bill_paid_on_time, finance:spending_spike_detected. These are registered and emitted but reach no notification, telemetry, or UI consumer — wasted detection work that also makes flow auditing harder. (Round 1's separate worry that the scheduleWeeklyReview chain is unverified is the same body:weekly_review thread.)
- **Fix:** For each: add to BRIDGED_CUE_EVENTS for telemetry, route through scheduleNotification if it should surface a prompt, or remove the emit if obsolete. For body:weekly_review specifically, confirm body.ts has an explicit subscriber forwarding to scheduleNotification (mirroring cycle.ts) and document the init dependency.

#### [low · conf 1/3] Registry-only orphan: void:dump:receipt is defined but never emitted or consumed
- **Location:** `packages/events/src/registry.ts:32; packages/events/src/shapes.ts:28`
- **Problem:** void:dump:receipt is defined in the registry and shapes but has zero emitters and zero listeners anywhere in the codebase — dead schema for a flow that was never built.
- **Fix:** Remove it from registry.ts and shapes.ts if unplanned; if planned, implement both the producer (braindump-dispatch / routing) and a consumer (likely telemetry).

#### [low · conf 1/3] grocery:routed fallback branch omits recipe_parent key, inconsistent with success branch
- **Location:** `packages/orchestrator/src/braindump-dispatch.ts:818-844`
- **Problem:** The success branch (L818-822) emits items with explicit recipe_parent (value or undefined); the AI-failure fallback branch (L840) emits items WITHOUT the recipe_parent key at all. recipe_parent is optional so this is not a hard contract break, but the inconsistency (omitted vs explicit undefined) can confuse consumers that distinguish 'present-and-undefined' from 'absent'.
- **Fix:** Standardize the item shape across both branches — emit recipe_parent: undefined explicitly in the fallback at L840, or omit it consistently in both.

#### [low · conf 1/3] Crisis short-circuit discards all fragments with no diagnostic log
- **Location:** `apps/native/src/modules/dispatch.ts:40-42`
- **Problem:** When output.crisis is true, dispatch returns { entries: [], crisisSkipped: true } immediately (VERIFIED at L40-42). This is correct safety behavior, but no diagnostic is logged about which fragments were skipped — a user in crisis who also logged medication/finance has that data silently archived-but-unprocessed with no audit trail.
- **Fix:** Log a count (and optionally the modules) of skipped fragments before returning, e.g. console.log(`[dispatch] crisis short-circuit, skipped ${output.fragments.length} fragments`), so ops can detect lost context without exposing fragment content.

### algorithms (9)

#### [medium · conf 1/3] Bayesian posterior mean omits effective-sample-size normalization of the weighted data term
- **Location:** `packages/logic/src/cycle/posterior.ts:41 (with 34-38)`
- **Problem:** The posterior precision combine uses dataPrec = effN / sigmaUser^2 (line 38), which correctly treats the EWMA weights as contributing an effective count effN of observations. But the posterior mean (line 41) adds the raw weightedSum / sigmaUser^2 instead of the EWMA-weighted MEAN times dataPrec. weightedSum = sum(weights[i]*L[i]) is a weighted sum, not a weighted mean; to be consistent with dataPrec it must be divided by effN. As written, postMean = (prior.mean*priorPrec + weightedSum/sigmaUser^2)/postPrec over-weights the data by roughly a factor of effN, pulling the predicted cycle length toward the raw weighted sum of recent cycle lengths and producing a biased forecast whenever the prior still carries weight. The bug is masked only when effN ~= 1.
- **Fix:** Use the normalized weighted mean for the data term: const weightedMean = weightedSum / effN; then postMean = (prior.mean * priorPrec + weightedMean * dataPrec) / postPrec; (equivalently prior.mean*priorPrec + (weightedSum/effN)*(effN/sigma^2) = prior.mean*priorPrec + weightedSum/sigma^2 only when the intent is raw-sum — confirm against the precision term so both sides use the same effN convention).

#### [medium · conf 1/3] Symptom-clustering hit rate excludes the final cycle from both numerator and denominator inconsistently
- **Location:** `packages/logic/src/cycle/symptom-clustering.ts:54,66`
- **Problem:** totalCycles is set to starts.length - 1 (line 54), and any symptom event whose cycleIdx is the last start index is dropped (line 66: cycleIdx >= starts.length - 1 continue). The last (most recent, possibly still-open) cycle is treated as non-countable. This is internally consistent for the denominator but means symptoms that recur primarily in the most recent cycle never contribute to hitRate, so a real and current pattern can read as 0% until a new cycle starts. If the last cycle is genuinely partial this exclusion is defensible, but the denominator (length-1) and the per-event guard should be documented as deliberately dropping the open cycle, and ideally the open cycle should only be excluded when it is actually incomplete (no following start).
- **Fix:** Decide and document one convention. If only completed cycles count, the current code is correct but add a comment. If the latest complete cycle should count, gate the exclusion on whether a subsequent cycleStartTs exists (i.e. exclude only the truly open trailing cycle), and align totalCycles with the set of cycles actually eligible for events.

#### [low · conf 2/3] Bootstrap CI uses asymmetric rounding (floor for low, ceil-1 for high) for symmetric percentiles
- **Location:** `packages/logic/src/stats/index.ts:188-189`
- **Problem:** The bootstrap confidence interval computes lo = stats[floor((alpha/2)*iters)] but hi = stats[ceil((1-alpha/2)*iters) - 1]. The two tails of a symmetric CI are indexed with different rounding rules, so the lower and upper tails do not carry equal probability mass and the interval is mildly asymmetric. For alpha=0.1, iters=1000 this gives lo at index 50 and hi at index 899, an off-by-one relative to a consistent floor convention. Impact is small (one position out of `iters`) and bounded by the min/max clamps, so this is cosmetic-to-low for the drift/effect thresholds that consume it, but it is a genuine inconsistency.
- **Fix:** Use one rounding convention for both bounds, e.g. hi = stats[Math.min(iters - 1, Math.floor((1 - alpha / 2) * iters))], matching the floor used for lo; or add a comment justifying the ceil if it is an intentional inclusive upper boundary.

#### [low · conf 2/3] Dysmenorrhea consecutive-run detection works but is fragile (backwards loop reads i+1)
- **Location:** `packages/logic/src/cycle/flags.ts:122-126`
- **Problem:** Two rounds flagged the backwards loop counting consecutive severe cycles. The claim that it throws/reads out of bounds is FALSE: line 124 short-circuits with `i === orderedSevere.length - 1 ||` before ever evaluating orderedSevere[i + 1], so on the first (highest) index the i+1 access never happens, and for all other i the i+1 element is in-bounds. The run logic is correct on the pre-sorted ascending array. The only real issue is readability/fragility: a backwards loop comparing orderedSevere[i+1] - orderedSevere[i] === 1 is confusing and a future refactor (e.g. removing the sort guarantee or reordering) could silently break it.
- **Fix:** No functional change required. For clarity, iterate forward from the end with an explicit 'previous index' variable, or add a comment noting orderedSevere is sorted ascending and the i+1 access is guarded by the first disjunct.

#### [low · conf 1/3] snapToWordBoundaries relies on isWord(undefined) instead of explicit bounds checks
- **Location:** `packages/logic/src/journal/extract.ts:187-192`
- **Problem:** The expansion loops `while (e < text.length && isWord(text[e - 1]) && isWord(text[e])) e++;` are safe because isWord coerces undefined to '' via `c ?? ''` and the regex fails on '', and because `e < text.length` bounds the read of text[e]. So there is no crash and no out-of-bounds throw (JS returns undefined, not an error). The redundant `isWord(text[e])` term combined with the `e < text.length` guard makes the condition harder to reason about than necessary, and the loop's correctness depends entirely on the defensive `?? ''` in isWord — a maintainability hazard rather than a live bug.
- **Fix:** Keep the defensive isWord, but simplify the loop conditions so the intent is explicit, e.g. expand left while s > 0 && isWord(text[s-1]) and expand right while e < text.length && isWord(text[e]); the extra isWord(text[s])/isWord(text[e-1]) terms can be dropped once bounds are explicit.

#### [low · conf 1/3] Late-bedtime detector counts only post-midnight times as 'late' (likely intentional night-owl detection, worth confirming)
- **Location:** `packages/logic/src/sleep/stats.ts:264-267`
- **Problem:** `const late = bts.filter((b) => b < 360 || b === 0)` counts bedtimes between midnight and 6 AM (and exactly midnight) as 'late', and the detector additionally requires medWake >= 600 (wake at/after 10 AM) to fire. One round claimed this is inverted because evening bedtimes (e.g. 11 PM = 1380 min) are not counted. In context the combination (sleeps after midnight + wakes after 10 AM) is a coherent delayed-sleep-phase / night-owl signal, so it is most likely intentional. The genuine risk is that a 10-11 PM-then-after-midnight drifter is undercounted, and 'late' as a name is ambiguous. Not a clear bug; confirm the threshold matches the product definition of 'late'.
- **Fix:** Confirm the intended definition of 'late bedtime'. If only post-midnight sleepers are meant, add a comment to that effect. If pre-midnight late-evening bedtimes (e.g. >= 22:00) should also count, extend the predicate to `b >= 1320 || b < 360` (treating 0 as midnight).

#### [low · conf 1/3] Anti-goal excerpt extraction omits leading context, unlike the contagion detector
- **Location:** `packages/logic/src/goals/phase3.ts:423 (cf. line 87)`
- **Problem:** extractAntiGoalInDump slices the excerpt as text.slice(Math.max(0, m.index), m.index + 60), capturing only from the match forward, while the contagion detector (line 87) captures text.slice(Math.max(0, m.index - 10), m.index + 40), including 10 chars of preceding context. Purely a UX/consistency nit in surfaced copy — no incorrect detection — but the two excerpting strategies in the same module diverge for no stated reason.
- **Fix:** For consistency and readability of surfaced excerpts, change line 423 to text.slice(Math.max(0, m.index - 10), m.index + 60).trim(); matching the contagion detector's leading-context convention.

#### [low · conf 1/3] DISPUTED: goal-interference foundB tag assignment (verified correct in code)
- **Location:** `packages/logic/src/goals/phase3.ts:462-465`
- **Problem:** One round claimed foundB on line 464 (`tagsA.includes(pA) ? pB : pA`) is computed from the wrong array. On inspection this is CORRECT: the enclosing if (line 462) guarantees exactly one of (tagsA has pA && tagsB has pB) or (tagsA has pB && tagsB has pA). When tagsA includes pA, goal B necessarily holds pB, so foundB = pB; when tagsA does not include pA (so holds pB), goal B holds pA, so foundB = pA. foundA mirrors this correctly. No fix needed; flagging so the orchestrator can dismiss the false positive rather than act on the proposed change.
- **Fix:** No change. The proposed 'fix' (switching to tagsB.includes(pB)) would yield the same result under the if-guard but is unnecessary; leave lines 462-465 as-is.

#### [low · conf 1/3] DISPUTED: finance-cycle-spend division-by-zero (already guarded)
- **Location:** `packages/logic/src/patterns/finance-cycle-spend.ts:33,54-55`
- **Problem:** One round claimed dailyLuteal/dailyFoll (lines 54-55) can divide by zero because phaseDays could become 0 between the line-33 check and the division. In the actual code phaseDays is fully accumulated in the loop at 28-32 and is never mutated afterward, and line 33 returns null if either luteal or follicular is 0. Therefore the denominators are guaranteed positive at lines 54-55. No live division-by-zero exists; flagging to dismiss the false positive.
- **Fix:** No change required. phaseDays is immutable after line 33's guard; the divisions are safe.

### lint (9)

#### [high · conf 1/3] Unsafe double/chained type casts in capacitor notifications backend
- **Location:** `/Users/serrayildirim/ollie/packages/notifications/src/backends/capacitor.ts:38,73`
- **Problem:** Two type-system-abuse casts in the shipped notifications package. Line 38: `new Function('s','return import(s)') as (s: string) => Promise<unknown> as never` casts the dynamic-import wrapper through `Promise<unknown>` then to `never`, fully defeating type checking (the declared type is `Promise<any>` via the no-explicit-any disable on line 35). The `as never` is meaningless and masks the real return type. Line 73: `globalThis as unknown as CapacitorGlobal` uses the cast-through-unknown escape hatch so the final cast is unchecked. Verified present in source.
- **Fix:** Line 38: drop the `as never` and assign directly: `const dynImport = (s: string): Promise<unknown> => (new Function('s','return import(s)') as (s: string) => Promise<unknown>)(s);` then narrow `mod` at each call site (already done via `mod?.LocalNotifications ?? null`). Line 73: define a runtime guard instead of casting globalThis, or accept `globalThis as CapacitorGlobal` only if the interface marks every field optional so it is structurally compatible. Keep one documented eslint-disable for the unavoidable `new Function` dynamic import only.

#### [high · conf 1/3] Unguarded console.log/warn in shipped notifications package leaks to prod
- **Location:** `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:77,81,85,260,265,289; backends/capacitor.ts:277`
- **Problem:** The notifications package — shipped into the app, not a worker — logs unconditionally in several hot paths: NOOP_BACKEND.deliver/schedule/cancel (index.ts:77/81/85) print every notification (also spams test output), notify() prints on illegal-category and missing-dedupe_key drops (index.ts:260/265), suppression-deferred prints full dedupe_key+reasons+fireAt (index.ts:289), and capacitor.ts:277 prints captured device-token prefixes. Verified present. Unlike worker telemetry these are diagnostic noise on the client with no debug gate and (in NOOP/validation paths) leak notification content + token fragments.
- **Fix:** Route through the package's existing event bus / a single internal debug logger gated on an explicit flag, e.g. `if (globalThis.__OLLIE_DEBUG__) console.log(...)`, or downgrade NOOP_BACKEND logging to test-only utilities. For the validation drops in notify(), emit a structured event (infrastructure already exists) rather than console.warn so prod has no console output and observability still captures it.

#### [medium · conf 2/3] Intentional console statements lack eslint-disable annotations (telemetry/error logging)
- **Location:** `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:105,138,177,201,310,325; apps/native/src/dump/BrainDumpInput.tsx:197; apps/native/src/navigation/Layout.tsx:21; apps/native/src/modules/dispatch.ts:111,120,151; apps/native/src/bridge/index.ts:75; apps/native/src/main.tsx:41,46; apps/native/src/dump/MicButton.tsx:61; workers/ai-proxy/src/groq.ts:127`
- **Problem:** Intentional structured-telemetry and non-fatal-error console calls (metric:'dump_roundtrip', 'screen_render', 'ai_call'; '[bridge] … (non-fatal)' warnings) are not annotated with eslint-disable-next-line no-console, while sibling lines (store.ts:80, formatRelativeTime.ts:135) are. The pattern is inconsistent: where annotated they are intentional, where not it is ambiguous whether they are intentional or stray debug, which defeats the lint signal. Found independently across native app (round 2, ~15 sites) and worker telemetry (round 1).
- **Fix:** Add `// eslint-disable-next-line no-console` above each intentional call, or better, funnel telemetry through a single `logMetric()` / `logNonFatal()` helper that carries one eslint-disable internally — then a bare console.* anywhere else correctly trips the linter and stays meaningful as an audit signal.

#### [medium · conf 2/3] TODO comments for ES i18n in finance code with no tracked owner
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:923-929,1366; packages/logic/src/finance/adhd-tax-detection.ts:46`
- **Problem:** Untracked TODO comments in finance code, recurring around the same root cause: Spanish (ES) i18n / taxProfile-onboarding not yet wired. finance.ts has 'add ES translation when i18n layer supports notification copy' plus two taxProfile-onboarding defensive-fallback TODOs; adhd-tax-detection.ts:46 has '* English only. (TODO: add ES)'. None reference an issue or owner, so they are invisible to release tracking — and Ollie is committed to EN+ES+TR, making the ES gap a real product item, not cosmetic.
- **Fix:** Convert each to an issue-anchored reference, e.g. `// TODO(#NNN): add ES copy once i18n layer supports notification strings`, or log them in docs/CHECKLIST.md (the project's single source of truth) under the i18n work item so the ES coverage gap is tracked rather than buried in comments.

#### [medium · conf 1/3] `void x` used to suppress unused-var lint instead of the configured `_` prefix
- **Location:** `/Users/serrayildirim/ollie/packages/notifications/src/index.ts:201; packages/orchestrator/tests/cycle.test.ts:84; packages/logic/src/finance/recurring.ts:473; packages/logic/src/body/caffeine-sleep.ts:395`
- **Problem:** Four sites use `void <var>;` to silence no-unused-vars even though eslint.config.mjs already sets varsIgnorePattern/argsIgnorePattern to `^_`. emitLogEvent(entry) does nothing but `void entry;`; tests/recurring/caffeine-sleep keep `void before/lastAt/_halfLife`. This is an ad-hoc workaround that bypasses the project's established convention and reads as dead code.
- **Fix:** Adopt the configured pattern: rename to `_before`, `_lastAt` (or drop the binding entirely) and remove the `void` line. For emitLogEvent, either drop the parameter (`function emitLogEvent(): void {}`) or rename to `_entry`. For caffeine-sleep `_halfLife` (a reserved API field), keep it as a real property with a JSDoc note instead of a `void` statement.

#### [medium · conf 1/3] FocusTimer useEffect hooks disable exhaustive-deps with stale-closure risk
- **Location:** `/Users/serrayildirim/ollie/apps/native/src/modules/work/FocusTimer.tsx:188,200`
- **Problem:** Two useEffects suppress react-hooks/exhaustive-deps while reading values not in their dep arrays. The effect ending ~line 188 reads chosenDuration, events, fireNotify, onSessionLogged but depends only on [timerState, secondsLeft]; the effect ending ~line 200 reads chosenDuration for resetDuration but depends only on [timerState]. Captured stale values can produce wrong notify/log behavior or reset the timer to an outdated duration.
- **Fix:** Add the read values to the dep arrays ([timerState, secondsLeft, chosenDuration, events, fireNotify, onSessionLogged] and [timerState, chosenDuration]). If that over-fires the timer, move the unstable callbacks into refs (useRef + assign in an effect) and read ref.current inside, so the disable is removed rather than papered over.

#### [medium · conf 1/3] Widespread no-explicit-any eslint-disables (46 sites)
- **Location:** `/Users/serrayildirim/ollie/packages/ (verified: 46 occurrences; non-test src includes sync/finance.ts, orchestrator/admin.ts, notifications/backends/capacitor.ts, research-stream/src/index.ts, crypto/src/index.ts)`
- **Problem:** grep confirms exactly 46 `eslint-disable-next-line @typescript-eslint/no-explicit-any` across packages/. The rule is warn-level (ratchet), but the volume of disables masks real type holes; most are in tests (sync ×19, research/crypto tests) but several are in shipped src (sync/finance.ts ×2, orchestrator/admin.ts, notifications capacitor ×3, research-stream/src ×2, crypto/src ×3).
- **Fix:** Prioritize the ~11 non-test src disables: replace `any` with `unknown` + a narrowing guard, or a precise interface. Leave test mocks for a later pass but add a shared test-typing helper (see fetch-mock cluster) to shrink the count. Keep the warn ratchet so the number can only go down.

#### [low · conf 1/3] Repeated `as unknown as typeof fetch` casts in test doubles
- **Location:** `/Users/serrayildirim/ollie/packages/research-stream/tests/research.test.ts:179,198,213,228 (and workers/ test suites)`
- **Problem:** Mock fetch implementations are cast `as unknown as typeof fetch` in 10+ test sites, duplicating an unsafe cast-through-unknown across suites. Cosmetic/maintainability — tests only — but the duplication invites copy-paste drift.
- **Fix:** Add a shared test helper, e.g. `export const asFetch = (impl: unknown): typeof fetch => impl as typeof fetch;` in a test-utils module, or use `vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()`, and replace the inline casts.

#### [low · conf 1/3] Inline bare catch blocks inconsistent with codebase multi-line style
- **Location:** `/Users/serrayildirim/ollie/packages/notifications/src/backends/electron.ts:55,66,82,90,109,120; packages/research-stream/src/index.ts:193`
- **Problem:** Several single-line bare catch blocks (`catch { return undefined; }`, `catch { /* noop */ }`, `catch { /* registry warn ok */ }`) are valid per config but differ from the multi-line catch style used elsewhere, and the research-stream one omits an error binding so the suppressed error type is unclear. Purely stylistic/readability.
- **Fix:** Optional consistency pass: expand to multi-line blocks and, where the comment hints at a specific expected failure, bind and comment the error: `catch (err) { /* registry schema not loaded yet — safe to ignore */ }`. Low priority; only worth doing alongside other edits to these files.

### cleancode (14)

#### [critical · conf 1/3] createFinanceOrchestrator is a 1315-line monolithic closure with 40+ inner functions
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:241-1555`
- **Problem:** The largest function in the codebase (~1315 lines, file total 1556 confirmed) initializes the entire finance orchestrator in one closure: getSettings/getRecords/setRecords/setKey/processDump/recomputeDerived/pushNotificationFor plus 5+ event subscriptions, all nested up to 10 levels deep. Untestable in isolation, no module boundaries. (Round 2 also flagged the same file for 15+ single-letter payload vars s/o/p/r and Round 3 for vague TODOs at lines 923/929/1366 — see separate clusters.)
- **Fix:** Refactor into a class-based FinanceOrchestrator: extract processDump, recomputeRecurring, trackADHDTax, notification logic into 50-100 line methods, and a small helpers object for getSettings/setRecords. Breaks the monolith into testable units.

#### [critical · conf 2/3] dispatchAction is a ~465-line god function routing 10+ modules with deep nesting
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:692-1157`
- **Problem:** dispatchAction spans lines 692-1157 (file total 1157 confirmed) and handles routing for grocery/cycle/finance/work/goals/body/astrology/health/etc. via one massive if-else chain. Each module handler is 100+ lines with inline store updates, event emission, and error handling. The grocery branch alone (lines 758-847) nests an async IIFE 4-5 levels deep (if result -> if isMutation -> if target==='pantry' -> for-loop), capturing id/data/isMutation/ts plus opts.recordGroceryPurchase/onGroceryMutation as implicit dependencies. High cyclomatic complexity, hard to test or maintain.
- **Fix:** Extract each module into a dedicated handler (dispatchGroceryAction, dispatchWorkAction, ...) and route via a dispatch map Record<string, handler>. For the grocery async branch, extract a named async function handleGroceryRouteResult(result, id, data, isMutation, opts, ts) with explicit params and early returns to flatten nesting.

#### [high · conf 3/3] Pervasive single-letter variable names across worker validation and orchestrator code
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:198,254-287; cloudflare-ai.ts:36; router/dump.ts:384; router/feed-me.ts:384; router/cook-history.ts:177; packages/crypto/src/index.ts:73-88; packages/orchestrator/src/finance.ts (s/o/p/r, 15+ sites)`
- **Problem:** All three rounds independently flagged cryptic single-letter variables in critical validation/transform paths. Confirmed: label.ts:198 `const v = validateLabel(parsedLabel)`, cloudflare-ai.ts:36 `const t = text.trim()`. Other instances: crypto index.ts g/s/r for globalThis/subtle/getRandomValues; label.ts validateLabel destructures to conf/tag; finance.ts uses s/o/p/r 15+ times; feed-me/cook-history use b/e for `as Record<string, unknown>`. These force readers to trace back to the assignment, raising cognitive load in exactly the code where correctness matters most.
- **Fix:** Rename to semantic names: v->validationResult, t->trimmedText, g/s/r->globalRef/subtleApi/getRandomValuesApi, conf/tag->confidence/adhdPatternTag, s/o/p/r->settings/opts/payload/result, b/e->bodyRecord. No behavior change, pure readability.

#### [high · conf 2/3] grocery.config.ts is an 1820-line file mixing data, types, schema, and prompt-building logic
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/modules/grocery.config.ts:1-1820`
- **Problem:** Confirmed 1820 lines combining: type definitions, CANONICAL_ITEMS/INTENT_VERBS/CATEGORIES, a ~1200-line SHELF_LIFE_DETAIL data record (200+ entries), and builder functions. buildSystemPrompt (lines 1612-1760) embeds a ~148-line hardcoded Gemini prompt template mixing depletion-vs-possession policy, quantity rules, mutation semantics, and multi-language guidance in one wall of text. No separation of concerns; hard to navigate, test, or update a single shelf-life entry or prompt policy block.
- **Fix:** Split into grocery/types.ts, grocery/shelf-life.ts (data only), grocery/builders.ts, grocery/config.ts (orchestration). Decompose buildSystemPrompt into named policy constants (DEPLETION_POLICY, QUANTITY_PARSING_RULES, MUTATION_LOGIC) composed via [HEADER, ...].join('\n\n').

#### [high · conf 1/3] applyGroceryMutations is a 247-line function with duplicated remove/check logic and repeated inline snapshot pattern
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-648`
- **Problem:** applyGroceryMutations handles add/remove/check/move_to_pantry across ~247 lines. The remove and check cases each duplicate near-identical pantry-vs-shopping branches. The snapshot-capture idiom (declare `let snapshot = null`, mutate it inside a store.update closure, then `if (snapshot !== null)` emit a callback) is repeated 4+ times (lines 467-499, 501-532, 540-575, 580-620), each needing a `snapshot as {...}` assertion (lines 481, 514) because the closure infers implicit any. The complex item shape type is also re-declared inline twice (467, 501).
- **Fix:** Extract per-mutation helpers (applyAddMutation/applyRemoveMutation/applyCheckMutation/applyMoveToPantry) and a generic captureAndEmit<T>(store, module, key, matcher, callback) to centralize the snapshot+emit pattern. Define named PantrySnapshot/ShoppingSnapshot types at module scope and annotate the updater return type to drop the assertions.

#### [medium · conf 2/3] Overly permissive `as Record<string, unknown>` casts defeat type narrowing in worker validators
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:384; router/cook-history.ts:177; router/vision.ts:125; router/partner.ts:132; label.ts:198`
- **Problem:** Validation functions cast request bodies straight to Record<string, unknown> (`const b = raw as ...`, `const e = body as ...`) before checking individual properties, discarding type-level safety. Validators also return inconsistent shapes — feed-me's validateBody returns {body}|{error} while cook-history's validateEvent returns string|null — so callers must handle two different error conventions, raising the risk of error-handling bugs.
- **Fix:** Use type predicates (`function isValidFeedMeBody(o: unknown): o is ValidatedBody`) so post-check code is typed without casts, or adopt zod/io-ts. Standardize on one ValidationResult<T> = {success:true;data:T}|{success:false;code:string} discriminated union across the worker.

#### [medium · conf 1/3] Mutable module-level _aiProxyBaseUrl global mutated via exported setter breaks encapsulation and test isolation
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:135-140`
- **Problem:** A module-level `let _aiProxyBaseUrl` is mutated through the exported _setAiProxyBaseUrl function and read in callGroceryRoute/dispatchAction. The underscore implies privacy but it is exported. One test (or concurrent request) changing the URL leaks into others; DispatchOptions already carries opts.aiProxyBaseUrl (checked at line 742), making the global redundant.
- **Fix:** Remove the global and the _setAiProxyBaseUrl export; thread the base URL through DispatchOptions everywhere, including test overrides.

#### [medium · conf 1/3] Repeated inline complex generic types on store.update calls (15+ sites)
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:732-735,770-773,778-787,800-809 and similar`
- **Problem:** Complex generics like store.update<Array<{ id: string; name: string; ts: number; checked: boolean }>>(...) are re-declared inline 15+ times across grocery/work/goals/body handlers. Refactoring any schema requires editing every call site and the duplicated types bloat compiled output.
- **Fix:** Define named domain types (GroceryItem, GroceryPantryItem, WorkMeeting, ...) once at module level and reference them in store.update<GroceryItem[]>(...).

#### [medium · conf 1/3] Underscore-prefixed helpers and duplicated date-parsing in sleep patterns lack clarity
- **Location:** `/Users/serrayildirim/ollie/packages/logic/src/sleep/patterns.ts:60-73,98-117`
- **Problem:** Exported statistical helpers _median/_mean use a private-looking underscore prefix with no comment on their role. detectRevengeBedtime defines two nested helpers (targetEpochForNight, bedtimeEpoch) that each repeat the same `/^(\d{4})-(\d{2})-(\d{2})$/` regex + date-parsing with no explanation of the YYYY-MM-DD/UTC contract.
- **Fix:** Either give the helpers public names (medianValue/meanValue) or document them as internal. Extract a shared _parseNightOfDate() (with a NIGHT_OF_FORMAT constant + comment noting ISO 8601 / UTC) used by both nested functions.

#### [medium · conf 1/3] buildBasePrompt takes 4 ungrouped positional parameters
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:813-818`
- **Problem:** buildBasePrompt(body, sanitizedPantry, sanitizedPetName, signals) passes four separate positional args and branches internally on user-vs-pet mode, making call sites error-prone and the signature hard to extend.
- **Fix:** Group into a PromptContext interface { body; pantry; petName; signals } and accept buildBasePrompt(context: PromptContext).

#### [low · conf 1/3] Mode-state init uses a fragile literal ternary chain instead of an allowed-set check
- **Location:** `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryBox.tsx:93-98`
- **Problem:** GroceryBox initializes mode by comparing the saved sessionStorage value against four hardcoded literals ('now'||'shop'||'pantry'||'feed-me'). If the Mode set changes, this check must be updated separately and silently.
- **Fix:** Define const ALLOWED_MODES: readonly Mode[] = ['now','shop','pantry','feed-me'] and use (saved && ALLOWED_MODES.includes(saved)) ? saved : 'now'.

#### [low · conf 2/3] Magic numbers without explanatory constants/comments across workers
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:244; index.ts:122; telemetry.ts:224; router/dump.ts:69`
- **Problem:** Several unexplained magic numbers in the ai-proxy worker (all locations confirmed). label.ts:244 `expirationTtl: 60 * 60 * 36` (36h budget TTL, no rationale). index.ts:122 `MAX_PROXY_BODY_BYTES = 1024 * 1024` (named but no comment on why 1MB). telemetry.ts:224 `rowKeys.length > 64 || ...length > 16 * 1024` (raw 64 and 16KB). dump.ts:69 `MAX_TEXT_CHARS = 10_000` (comment exists but no concrete justification of the threshold).
- **Fix:** Promote each to a named constant with a one-line rationale comment, e.g. KV_BUDGET_TTL_SECONDS = 36*60*60 // survives day boundary; MAX_TELEMETRY_ROW_COLUMNS = 64 // Analytics Engine column limit; MAX_TELEMETRY_ROW_SIZE_BYTES = 16*1024. Expand MAX_TEXT_CHARS comment with typical dump size + headroom factor.

#### [low · conf 1/3] Silent fire-and-forget catch blocks swallow errors with no observability
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:749,798,827,845,863,873,891 (and 829-846 empty grocery fallback)`
- **Problem:** Multiple `catch { /* non-fatal */ }` / `catch { /* fire-and-forget */ }` blocks discard all errors, creating debugging blind spots. Separately, when AI grocery classification fails on a mutation the code silently emits items:[] (line 840), dropping the user's input with no telemetry or user-visible signal — a deliberate but undocumented loss-of-input path.
- **Fix:** Add a logFatal(category, error) hook invoked in these catches (no-op in production) to preserve fire-and-forget UX while enabling debugging. For the empty-mutation fallback, add an explanatory comment plus a telemetry event so its frequency is observable.

#### [low · conf 1/3] Vague TODO comments without owner, priority, or timeline
- **Location:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:923,929,1366; apps/native/src/modules/partner/repo.ts:39`
- **Problem:** Several TODOs lack owner/priority/date (finance.ts:923/929 hardcoded taxProfile default pending onboarding UI; 1366 missing ES translation; partner/repo.ts:39 stubbed signals read). These accumulate as silent tech debt.
- **Fix:** Adopt an actionable format: // TODO(owner, P#, target-date): context [ticket]. e.g. // TODO(Serra, P2, 2026-07-30): replace hardcoded taxProfile default once onboarding writes finance.taxProfile.

### validation (18)

#### [critical · conf 3/3] Device token interpolated into APNs URL without encoding/validation in /send
- **Location:** `/Users/serrayildirim/ollie/apps/api/src/worker.ts:464 (and tokens array at 400-409)`
- **Problem:** The /send endpoint accepts body.tokens as a string array (or looks them up from KV) and passes each element straight into sendApns, where it is interpolated into a URL with no encoding or format validation: `const url = \`https://${host}/3/device/${deviceToken}\``. A token containing slashes, ?, #, & corrupts the URL / enables path-traversal-style requests to APNs. Individual tokens are also never validated for type, emptiness, or length, and the tokens array itself has no upper bound — an attacker can submit thousands of entries, causing Promise.all() to spawn unbounded concurrent APNs requests (DoS). Real APNs tokens are 64 hex chars; nothing enforces that.
- **Fix:** Validate + bound tokens before use: filter to `typeof t === 'string' && /^[a-f0-9]{64}$/i.test(t)`; reject if `tokens.length > 100`. As defense-in-depth also encode in the URL: `const url = \`https://${host}/3/device/${encodeURIComponent(deviceToken)}\``.

#### [high · conf 1/3] spec.dedupe_key.slice() called without null check in sendApns
- **Location:** `/Users/serrayildirim/ollie/apps/api/src/worker.ts:489`
- **Problem:** Line 489 calls `spec.dedupe_key.slice(0, 64)` for the apns-collapse-id header, but the NotificationSpec type allows dedupe_key to be undefined (it is set conditionally in jobToSpec and used optionally elsewhere in the payload at line 475). A /send request whose spec omits dedupe_key throws a runtime TypeError and fails the push instead of returning a clean 400. The /send validation at line 396 only checks title and category exist.
- **Fix:** Guard the access: `'apns-collapse-id': (spec.dedupe_key ?? '').slice(0, 64),` — or validate dedupe_key presence/length in handleSend alongside title and category.

#### [high · conf 1/3] Telemetry string fields in /enrich-dump validated for type only, no length/empty bounds
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:129-139`
- **Problem:** handleEnrichDump checks that device_id, raw_text, event_ts, locale, country, app_version are strings, but never bounds their length and never rejects empty strings. An attacker can send arbitrarily long values (unbounded memory / queue-serialization / downstream Supabase DoS) or empty values (device_id:'' produces meaningless telemetry rows). This contrasts with purchase.ts validateEvent() which enforces canonical length and non-empty trims. raw_text is scrubbed but still not sanity-bounded before scrub.
- **Fix:** After the type checks, add bounds + non-empty guards modeled on purchase.ts: device_id 1..256, locale 1..10, country 2..5, app_version 1..50, and a sanity cap on raw_text length before scrubPII. Reject with 400 'invalid_payload' on violation.

#### [high · conf 1/3] Partner snapshot phrases not length-bounded per item in /partner/snapshot
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:168-169`
- **Problem:** putSnapshot filters body.phrases to max 5 string items but never bounds the length of each phrase. Five multi-MB phrases bypass the implicit item cap and can exhaust DB storage / hit Supabase resource limits.
- **Fix:** Add a per-item length filter: `.filter((p): p is string => typeof p === 'string' && p.length <= 500).slice(0, 5)`.

#### [high · conf 1/3] Unvalidated `since` ISO param in /sync/grocery-pantry
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:50, server-apply.ts:175`
- **Problem:** The `since` query param is read and passed to pullGroceryPantry where it is interpolated into the Supabase filter `&updated_at=gt.${encodeURIComponent(sinceIso)}` with no validation that it is a real ISO-8601 timestamp. encodeURIComponent escapes it but invalid values like ?since=now waste DB resources / fail at query time, and the value should be format-checked before use.
- **Fix:** Validate before use: `const d = new Date(since); if (isNaN(d.getTime())) return json({ error: 'invalid_since_format' }, 400);` then pass d.toISOString().

#### [medium · conf 2/3] /ingest-event row accepted with size bounds but no schema/column or key-name validation
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:212-226`
- **Problem:** handleIngestEvent validates table is allowlisted and that the row is a non-array object with <=64 keys and <16KiB serialized size, but never validates the SHAPE: key names are not constrained to valid column identifiers (a single huge key name or null-byte key passes), and individual field values are not bounded or whitelisted per table. Malformed rows can trigger Supabase constraint violations or smuggle unexpected columns despite the server forcing user_hash identity.
- **Fix:** Define a per-table column allowlist and reject rows with unknown keys: `const cols = allowedCols[body.table]; if (rowKeys.some(k => !cols.includes(k))) return json({ error: 'invalid_columns' }, 400);` and/or enforce key regex `/^[a-z_][a-z0-9_]*$/i` plus per-value length caps.

#### [medium · conf 2/3] /route/:module context accepted as unknown with no size bound before reaching the model
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:246-254 (passed at ~314)`
- **Problem:** body.context is typed unknown and passed straight into groqClassify()/prompt builders without any validation of type, depth, or serialized size. A deeply nested or multi-KB context inflates the model request (cost + latency) and could bypass module prompt boundaries.
- **Fix:** Bound the serialized context in the handler: `if (body.context && JSON.stringify(body.context).length > 8192) return json({ error: 'context_too_large' }, 413);` (round 1/3 suggest 8KB; round 2 suggested 32KB — pick the tighter 8KB).

#### [medium · conf 2/3] user_id injected into KV key in /register-token without sanitization
- **Location:** `/Users/serrayildirim/ollie/apps/api/src/worker.ts:315-327`
- **Problem:** body.user_id is accepted with only a truthy check and embedded directly into the KV key `user:${body.user_id}`. Colons/slashes in user_id can break KV namespacing assumptions or collide keys. Separately, token and platform are not format-validated (token should be 64 hex chars; platform should be 'ios'|'macos').
- **Fix:** Sanitize/validate: reject user_id not matching `/^[a-zA-Z0-9_-]+$/`, require `/^[a-f0-9]{64}$/i.test(body.token)`, and `['ios','macos'].includes(body.platform)` before the KV put.

#### [medium · conf 1/3] No length validation on invitee_user_hash in /claim-invite
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:215-223`
- **Problem:** invitee_user_hash is checked for string type and non-emptiness but has no upper length bound, so an unbounded hash gets inserted into the database.
- **Fix:** Add `if (body.invitee_user_hash.length > 128) return json({ error: 'invalid_payload' }, 400);`.

#### [medium · conf 1/3] Partner pair code regex accepts 4-6 digits, allowing weak/short codes
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/partner.ts:104`
- **Problem:** Validation `/^\d{4,6}$/` accepts 4-5 digit codes even though sixDigit() always produces exactly 6 digits. A 4-digit code has only 10,000 possibilities, easing brute-force, and no rate-limit guards the pair endpoint.
- **Fix:** Require exactly 6 digits (`/^\d{6}$/`) to match the generator, and add per-IP rate limiting (e.g., 5 attempts/min) on /partner/pair.

#### [medium · conf 1/3] Timestamp fields in /purchase and /cook-history not validated after Date construction
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:137, cook-history.ts:126`
- **Problem:** Both endpoints bound the epoch-ms ts (7d past / 1d future) then call `new Date(body.ts).toISOString()`, but never validate the resulting Date is valid. Edge/overflow epoch values can yield 'Invalid Date' (toISOString throws) or corrupt rows.
- **Fix:** Construct and check before insert: `const iso = new Date(body.ts); if (isNaN(iso.getTime())) return { error: 'invalid_ts' };` then use iso.toISOString().

#### [medium · conf 2/3] /label scrubbed_text not size-checked before scrubPII; locale not value-validated
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/label.ts:108-130`
- **Problem:** Two gaps in the /label endpoint: (1) scrubbed_text is sliced to MAX_SCRUBBED_CHARS only AFTER passing the full raw input through scrubPII — a multi-MB body is processed before truncation; (2) locale is type-checked but not validated against an allowed set, so an arbitrary locale string is embedded in the Anthropic user message (feed-me.ts validates locale against ALLOWED_LOCALES).
- **Fix:** Bound input early: `if (body.scrubbed_text.length > MAX_SCRUBBED_CHARS * 2) return { error: 'text_too_large' };` before scrubPII; and validate locale: `const ALLOWED = new Set(['en','es','tr']); if (!ALLOWED.has(body.locale)) return json({ error: 'invalid_locale' }, 400);`.

#### [low · conf 3/3] excludeDishes array has no length bound in /feed-me
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466`
- **Problem:** Each excludeDishes item is length-checked (<= PANTRY_MAX_ITEM_LEN) but the array itself is unbounded, so a client can send thousands of items, consuming memory/CPU in the filter loop and inflating the prompt.
- **Fix:** Add an array-length guard right after the Array.isArray check: `if (b.excludeDishes.length > 100) return { error: 'invalid_exclude_dishes' };`.

#### [low · conf 1/3] No upper bound on body.qty in /grocery/purchase
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:210-214`
- **Problem:** qty is validated as a finite non-negative number but has no maximum, so qty:999999999999 passes and can overflow downstream numeric handling/UI.
- **Fix:** Add an upper bound: `|| e.qty > 999999` to the invalid_qty condition.

#### [low · conf 1/3] No Content-Length pre-check on /transcribe audio body before buffering
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts:51-57`
- **Problem:** The 25MB audio limit is enforced only after `req.arrayBuffer()` reads the entire body. A body larger than the declared Content-Length can be buffered into memory before the check, unlike /brain-dump which pre-checks Content-Length.
- **Fix:** Pre-check the header: `const len = Number(req.headers.get('content-length') ?? '0'); if (len > MAX_AUDIO_BYTES) return json({ error: 'audio_too_large' }, 413);` before reading the body.

#### [low · conf 1/3] No length validation on channel in /generate-invite before normalizeChannel
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:92`
- **Problem:** body.channel is passed to normalizeChannel() (which caps at 40 chars internally), but the raw unknown value is not length-guarded at the boundary, leaving the cap dependent solely on normalizeChannel's internal logic.
- **Fix:** Add a boundary guard: `if (typeof body.channel === 'string' && body.channel.length > 200) return json({ error: 'channel_too_long' }, 400);` before normalizeChannel.

#### [low · conf 1/3] Image mime passed to Gemini without magic-byte verification in /vision
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/vision.ts:62 (validated 127-130)`
- **Problem:** image.mime is checked against ALLOWED_MIMES then passed directly as inline_data.mime_type. A valid mime with mismatched bytes (png mime + jpeg data) can cause Gemini parse errors. The allowlist mitigates security risk; this is mostly a UX/robustness issue.
- **Fix:** Optionally verify the base64 magic bytes match the declared mime; otherwise the existing allowlist is acceptable for this low risk.

#### [low · conf 1/3] sentry-tunnel projectId not format-validated before allowlist check
- **Location:** `/Users/serrayildirim/ollie/workers/sentry-tunnel/src/index.ts:75-77`
- **Problem:** projectId is extracted via `pathname.replace(/^\//, '')` and checked only against ALLOWED_PROJECT_IDS.has(). Multi-segment paths produce values like 'foo/bar' that fail the Set check (so low risk), but the code assumes a single numeric id and does not enforce numeric format.
- **Fix:** Add numeric guard: `if (!/^\d+$/.test(projectId) || !ALLOWED_PROJECT_IDS.has(projectId)) return error;`.

### security (15)

#### [critical · conf 2/3] Live third-party API keys (Voyage, Gemini) sit in plaintext .env needing rotation
- **Location:** `/Users/serrayildirim/ollie/.env`
- **Problem:** The .env file holds active production credentials in plaintext: VOYAGE_API_KEY=[REDACTED]... and GEMINI_API_KEY=[REDACTED].... VERIFIED: the file is git-ignored (git check-ignore matches; git ls-files reports it untracked), so Round 3's 'committed to git' claim is FALSE — but the file is world-readable (0644) and the keys are real, live, and have already been pasted into chat transcripts per the project's own rotation memory. Any disk/backup/transcript exposure leaks them. This is exactly the pre-launch token-rotation debt the team already tracked.
- **Fix:** Revoke and reissue the Voyage and Gemini keys at their providers NOW. Store them only as Cloudflare Workers secrets (wrangler secret put), never in a repo-local file. If a local file is unavoidable for dev, chmod 600 it and use separate dev-scoped keys. Add a .env.example with placeholder values.

#### [critical · conf 2/3] Supabase project ref + anon JWT in plaintext .env.local
- **Location:** `/Users/serrayildirim/ollie/.env.local`
- **Problem:** SUPABASE_URL (project ref ykxzfzkfsolwgmheiwpx) and a full SUPABASE_ANON_KEY JWT live in plaintext in .env.local. VERIFIED git-ignored + untracked, file mode 0644. The anon key is client-distributable by design, so its sole exposure is only as severe as the RLS posture behind it — and the RLS findings below show FORCE RLS was only applied to 6 tables on 2026-06-15, meaning the anon/owner role could bypass policies on other tables before that. The real risk is the anon key + a permissive table = unauthorized reads/writes.
- **Fix:** Rotate the Supabase anon key. Keep server secrets (SERVICE_ROLE) only in Workers secrets — never let it land in any .env. Confirm FORCE RLS + revoke-from-anon on every user-data table (see RLS finding) so the anon key is harmless even if leaked. chmod 600 the dev file.

#### [high · conf 2/3] Missing ENVIRONMENT guard on STAGING_TEST_BEARER in /brain-copy and /apply-inbox + /sync/grocery-pantry
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/brain-copy.ts:49 and /Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:30`
- **Problem:** VERIFIED. /route/dump gates its staging side-door with `const stagingDoorAllowed = env.ENVIRONMENT !== 'production'` (dump.ts:138, audit #43 defense-in-depth). brain-copy.ts:49 (`if (!(env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER))`) and server-apply-routes.ts:30 (`if (env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER) return STAGING_TEST_USER_ID`) have NO such guard. If STAGING_TEST_BEARER is ever set on the production worker, anyone holding that bearer bypasses Clerk and runs as 'staging-test-user', writing/draining the inbox and grocery sync. NOTE: Round 1's separate 'auth bypass when STAGING_TEST_BEARER is unset' sub-claim is a misread — when the secret is undefined the code falls through to the JWT branch and still rejects invalid tokens. The genuine, reproducible gap is the missing production guard.
- **Fix:** Mirror the dump.ts pattern in both files. Add `ENVIRONMENT?: string` to each env interface and gate: `const stagingDoorAllowed = env.ENVIRONMENT !== 'production'; if (stagingDoorAllowed && env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER) {…} else { verify Clerk JWT }`. Better: extract one shared authUser() helper used by every route so the policy lives in one place.

#### [high · conf 3/3] Service-role key used for all PostgREST writes with no RLS backstop on telemetry/invites tables
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts (telemetry routes) + /Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:165,236,267 + /Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply.ts:169-194`
- **Problem:** VERIFIED. Every Supabase write goes out as `authorization: Bearer ${env.SUPABASE_SERVICE_ROLE}` + `apikey: SUPABASE_SERVICE_ROLE`, which bypasses RLS entirely. Ownership (user_id / user_hash) is enforced ONLY by the worker's server-side derivation and querystring filters (e.g. invites.ts:165 `?code=eq.${encodeURIComponent(code)}`, server-apply.ts `grocery_pantry?user_id=eq.${userId}`). There is no defense-in-depth: if the service-role key leaks, an error echoes a header, or a filter expression is bypassable, every user's data is readable/writable. The invites table in particular predates the RLS push and relies wholly on the key staying server-side.
- **Fix:** 1) Keep SUPABASE_SERVICE_ROLE strictly as a Workers secret; never log request/response headers. 2) Add an application-layer ownership assertion after fetches that filter by user_id (e.g. `if (rows.some(r => r.user_id !== userId)) throw`) for grocery_pantry sync. 3) Add RLS + a least-privilege role for the invites table so a leaked key isn't an instant full dump. 4) Prefer RPCs/prepared filters over hand-built querystrings.

#### [high · conf 1/3] Telemetry/user-data tables only got FORCE ROW LEVEL SECURITY recently; coverage may be incomplete
- **Location:** `/Users/serrayildirim/ollie/supabase/migrations/20260615000002_force_rls_and_grants.sql`
- **Problem:** Migration 20260615000002 (audit #75-#82) applies FORCE ROW LEVEL SECURITY + explicit GRANTs to only 6 tables: grocery_purchase_history, cook_history, routing_cache, partner_codes, partner_pairs, partner_snapshots. Before this, the table OWNER (and possibly anon/authenticated) could bypass RLS policies on these. Other sensitive tables (raw_dumps, enriched_signals, retention_events, profiles, invites, dump_inbox) need the same audit — raw_dumps has `force row level security` + revoke-from-anon, but invites does not appear to have any RLS. This is the backstop that makes the anon-key and service-role exposures non-catastrophic.
- **Fix:** Audit every public-schema table holding user data. Apply `ALTER TABLE … FORCE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated`, and owner-scoped policies uniformly. Add invites to this set. Treat 'new table => RLS + revoke + policy' as a checked invariant (lint/CI on migrations).

#### [high · conf 2/3] Spoofable x-user-id grants identity in dev mode (T0_JWT_ENFORCED=0) — IDOR if misconfigured to prod
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/purchase.ts:91-110, /Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:154-161, /Users/serrayildirim/ollie/workers/ai-proxy/src/router/replenishment.ts:103-113`
- **Problem:** VERIFIED. When T0_JWT_ENFORCED === '0', purchase/feed-me/replenishment accept a client-supplied x-user-id header as the authenticated identity (replenishment.ts:106 `const headerUser = req.headers.get('x-user-id')`). The header===path 'belt + suspenders' check is meaningless against a spoofed header — an attacker sets both to the victim's id. This is gated to dev today, but it is one misconfiguration (T0_JWT_ENFORCED=0 shipped to prod, or unset) away from a full IDOR across purchase writes, feed-me, and replenishment reads.
- **Fix:** Default to JWT-enforced in every environment; require ENVIRONMENT==='production' to FORCE enforcement regardless of T0_JWT_ENFORCED. Move the x-user-id bypass behind an explicit DEV_MODE secret that can never be set in prod, and add an alert if any prod worker reports T0_JWT_ENFORCED==='0'. For read-only reference data like /replenishment, drop the bypass entirely.

#### [medium · conf 1/3] Hardcoded predictable STAGING_TEST_USER_ID risks contaminating production data
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/server-apply-routes.ts:17 and /Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:108`
- **Problem:** VERIFIED. `STAGING_TEST_USER_ID = 'staging-test-user'` is a fixed, guessable identity used whenever the staging bearer is accepted. Combined with the missing ENVIRONMENT guard above, a leaked staging bearer hitting a misconfigured prod worker writes rows owned by this predictable id, polluting production tables and rate-limit buckets. The id is also a single static rate-limit key (see below).
- **Fix:** Once the ENVIRONMENT guard is added (so the door cannot open in prod), the blast radius shrinks. Additionally source the test user id from a secret (env.STAGING_TEST_USER_ID) rather than hardcoding, and ensure staging never points at the production database.

#### [medium · conf 1/3] No format/length validation on invitee_user_hash in /claim-invite
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:215-223`
- **Problem:** VERIFIED. /claim-invite checks only that invitee_user_hash is a non-empty string before PATCHing it into the invites row. It is supposed to be a SHA-256 hex (64 chars, [0-9a-f]) but an oversized or non-hex value is accepted and persisted, enabling junk/oversized writes and weakening any downstream assumption that the column is a clean hash.
- **Fix:** Add `if (!/^[a-f0-9]{64}$/.test(body.invitee_user_hash)) return json({ error: 'invalid_user_hash' }, 400);` before the PATCH.

#### [medium · conf 1/3] Unauthenticated, unthrottled /validate-invite enables invite-code brute force
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:148-193`
- **Problem:** VERIFIED. handleValidateInvite has no auth and no per-IP rate limit in the handler — it directly looks up `?code=eq.${code}` and returns valid/used/expired/not_found. An attacker can enumerate the invite keyspace at request rate, harvesting valid codes before claiming. (The keyspace is 30^8, large, but the endpoint also reveals used vs not_found, leaking validity.)
- **Fix:** Add a per-IP rate limit (e.g. 5/min via the existing checkRate + cf-connecting-ip key) to /validate-invite. Return a uniform response for not_found vs used so validity isn't oracle-leaked, and consider requiring the code to arrive via the invite landing flow.

#### [medium · conf 1/3] Rate-limit bucket collapses to a shared 'anon' key when user id and IP are absent
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:421-429 and 533-549`
- **Problem:** VERIFIED. /brain-dump derives its rate-limit key as `x-user-id || cf-connecting-ip || 'anon'` (index.ts:421-424). A caller omitting both shares one global 'anon' bucket — a single attacker can exhaust it and rate-limit all anon callers, or (less likely at the CF edge) evade per-user limits. resolveUserIdForRateLimit (533-549) returns null with no IP, and the purchase path then skips the limit. In production CF always sets cf-connecting-ip so impact is bounded, but the fallback is fragile for any non-edge path.
- **Fix:** For limited endpoints, fail closed: if no x-user-id AND no cf-connecting-ip, return 401 rather than bucketing as 'anon' or skipping the limit. Keep the per-IP bucket as the unauthenticated fallback and apply a stricter per-IP cap distinct from the per-user limit.

#### [medium · conf 1/3] Upstream Supabase error text returned to clients may leak internal detail
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:126-139 (upstreamError) and similar callers`
- **Problem:** Several invites handlers forward raw PostgREST error text to the client via upstreamError(...). Constraint-violation messages can echo column names, values, and schema detail (and in pathological cases request fragments), aiding enumeration of the invites schema. Service-role credentials are not in the body, but internal error surface should not reach clients.
- **Fix:** Log full upstream errors server-side behind a request id; return a generic client-facing code ('supabase_error') with only an HTTP status. Never pass through raw PostgREST text.

#### [medium · conf 1/3] No MIME-type validation on base64 image/PDF in /route/dump
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:154-180`
- **Problem:** /route/dump accepts an optional base64 image/PDF and validates structure (isVisionImage) + byte size (MAX_IMAGE_BYTES = 8MB) but does not validate the declared MIME or magic bytes before forwarding to Gemini. A disguised payload could be passed to the upstream vision model. Bounded risk (Gemini is hardened, size capped) but an explicit allowlist is cheap.
- **Fix:** Validate magic bytes against an allowlist (JPEG FFD8FF, PNG 89504E47, PDF 25504446) and reject others with 400 before the vision call.

#### [medium · conf 1/3] Oversized scrubbed_text scrubbed in full before truncation in /label
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/../label.ts:130`
- **Problem:** In /label, `scrubPII(body.scrubbed_text).slice(0, MAX_SCRUBBED_CHARS)` runs the PII regex scan over the ENTIRE input before truncating to 2000 chars. An authenticated user posting a multi-MB string forces a full-length regex scan (CPU/memory), unlike /ingest-event which size-checks (16 KiB) before processing.
- **Fix:** Add a pre-scrub length guard: reject body.scrubbed_text over ~10 KiB with 413, then scrub. Mirror the /ingest-event size-check pattern.

#### [medium · conf 1/3] Legacy 100k PBKDF2 iterations retained for old encrypted payloads
- **Location:** `/Users/serrayildirim/ollie/packages/crypto/src/index.ts:48-55`
- **Problem:** VERIFIED. New derivations use PBKDF2_ITERATIONS = 600_000 (OWASP-current). Payloads written before the S7 bump carry no stored count and decrypt at LEGACY_PBKDF2_ITERATIONS = 100_000, below OWASP guidance. Anyone obtaining a pre-S7 encrypted backup/profile can brute-force the passphrase ~6x cheaper. The structural fix (storing the count per envelope) is already done; the residual risk is the un-migrated old payloads.
- **Fix:** On next successful decrypt/sign-in, re-encrypt old (100k) payloads at 600k and persist the new envelope. Log deprecation for 100k payloads and set a sunset date after which they are rejected with 'upgrade required'.

#### [low · conf 1/3] Invite expiry compared with exact client/server clock, no skew tolerance
- **Location:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/invites.ts:189`
- **Problem:** VERIFIED. Expiry is `new Date(row.expires_at).getTime() <= Date.now()` with no grace window. Minor robustness issue around clock skew; the /claim-invite PATCH already enforces expiry server-side via `expires_at=gt.now()` so the security-critical path is atomic. Low impact.
- **Fix:** Optional: rely on the DB-side `expires_at=gt.now()` check (already used in claim) as the source of truth and treat the validate-endpoint comparison as advisory, or add a small (~30-60s) tolerance.

### types_errors (12)

#### [high · conf 3/3] Unvalidated JSON.parse cast in decryptData()
- **Location:** `packages/crypto/src/index.ts:206`
- **Problem:** decryptData() runs `return JSON.parse(text) as T;` with no try/catch. If the decrypted plaintext is not valid JSON (corrupt/tampered ciphertext, key mismatch, schema drift), this throws a raw SyntaxError that callers may not anticipate or distinguish from crypto-layer failures. Confirmed at line 206: the function validates iv/ciphertext presence but does nothing to make the parse failure legible. Found independently in all 3 rounds (Round 1 rated critical, Rounds 2-3 effectively high; calibrated to high since it throws rather than corrupts and the path is reachable from encrypted state sync).
- **Fix:** Wrap the parse to produce a descriptive, attributable error: `try { return JSON.parse(text) as T; } catch (err) { throw new Error('@ollie/crypto: decrypted payload is not valid JSON', { cause: err }); }`

#### [high · conf 1/3] JSON.parse on untrusted persisted data without try/catch in kv.get
- **Location:** `apps/native/src/storage/kv.ts:43,48`
- **Problem:** kv.get() does `return JSON.parse(raw) as T;` on both the Tauri store path (line 43) and the localStorage fallback (line 48) with no try/catch. Corrupt or partially-written JSON in either backend throws and propagates into every caller that reads app state, a crash risk on a hot path that touches user-controlled stored data.
- **Fix:** Wrap both parses and degrade gracefully: `try { return JSON.parse(raw) as T; } catch (err) { console.warn('[kv] corrupt JSON for key', key, err); return null; }`

#### [high · conf 1/3] Unvalidated JSON.parse + cast of tool-call arguments in router
- **Location:** `workers/ai-proxy/src/router/route.ts:539`
- **Problem:** `args = JSON.parse(call.function.arguments) as Record<string, unknown>;` parses LLM-produced tool-call arguments and casts straight to an object with no validation. Malformed model output (non-JSON, or JSON that is not an object) either throws uncaught or yields a non-object that downstream property access then mishandles silently.
- **Fix:** Parse defensively and assert object shape: `let args: Record<string, unknown>; try { const p = JSON.parse(call.function.arguments); if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new Error('args not an object'); args = p as Record<string, unknown>; } catch (err) { /* skip/return error for this tool call */ }`

#### [medium · conf 2/3] Response JSON cast to inline shape without runtime validation (Anthropic/Haiku)
- **Location:** `packages/api/src/anthropic.ts:204-206`
- **Problem:** `const data = (await resp.json()) as { content?: Array<{ text?: string }> };` asserts the Claude response shape with no runtime check. Confirmed at lines 204-207: downstream uses `data?.content?.[0]?.text ?? ''` and an Array.isArray(parsed) guard, so a malformed response degrades to returning null rather than crashing — real but contained, hence medium. The cast gives a false sense of type safety and produces no diagnostic about what the API actually returned. Found in Rounds 1 and 3.
- **Fix:** Add a type guard before use: `function isHaikuResponse(x: unknown): x is { content?: Array<{ text?: string }> } { return typeof x === 'object' && x !== null && (!('content' in x) || Array.isArray((x as { content?: unknown }).content)); }` and log/return null on mismatch.

#### [medium · conf 1/3] Double cast `as unknown as T` bypasses type safety in API client
- **Location:** `packages/api/src/client.ts:194`
- **Problem:** When parseJson is false, `const data = (await res.text()) as unknown as T;` launders a raw string into arbitrary T with zero validation. Any caller that assumes T has structured properties will hit runtime errors on a text body. Round 2 also flagged the adjacent error cast at line 208 (`err as Error & {...}` without a null/object guard) as the same family of unsafe-cast pattern in this file.
- **Fix:** Only assert T when parseJson is true; for text responses, constrain T to string at the type level or validate before asserting. For the error cast, guard first: `if (typeof err === 'object' && err !== null) { const e = err as Error & { name?: string; __timeout?: boolean }; ... }`

#### [medium · conf 2/3] RPC/worker response cast to typed Array/Row without shape validation
- **Location:** `workers/ai-proxy/src/router/partner.ts:110; workers/ai-proxy/src/router/feed-me.ts:564-577`
- **Problem:** Two workers cast `await res.json()` (or `.json().catch(() => [])`) directly to a typed shape with no per-field validation. partner.ts:110 casts to `Array<{ user_id; expires_at }>` — if the endpoint returns an object the catch hides it and required fields are never checked. feed-me.ts:564 parses cook_signals then casts to CookSignalsRpcRow; this one is partly mitigated (confirmed try/catch at 563-567 plus a `if (!row) return …` null guard and coerceSignalList on each field), so it is the least severe of the cluster. Found in Rounds 1, 2, and 3 across the worker JSON-cast pattern.
- **Fix:** Validate shape before trusting it. partner.ts: `const rows = await lookup.json().catch(() => []); if (!Array.isArray(rows)) return []; return rows.filter(r => typeof r?.user_id === 'string');`. feed-me.ts: keep the existing guards and add an object/array check before casting to CookSignalsRpcRow.

#### [medium · conf 2/3] parseInt/parseFloat `|| 0` masks NaN, silently zeroing counters/budgets
- **Location:** `workers/ai-proxy/src/index.ts:520; workers/ai-proxy/src/label.ts:137; workers/apns-push/src/index.ts:138`
- **Problem:** Three sites use the `raw ? parseInt(raw, 10) || 0 : 0` (or parseFloat) idiom. Because NaN is falsy, a corrupt non-numeric KV value parses to NaN then collapses to 0 — silently resetting a rate-limit counter (index.ts:520 and apns-push:138) or losing budget-spend precision (label.ts:137) instead of surfacing the corruption. The apns-push case is the most consequential: a corrupted counter reads as 0 and lets requests through the rate limit. Found in Round 2 (all three) and reinforced as a class.
- **Fix:** Validate finiteness explicitly: `const n = parseInt(raw, 10); const count = Number.isFinite(n) ? n : 0;` — and for the rate-limit path, prefer rejecting/alerting on corrupt state rather than defaulting to 0.

#### [medium · conf 1/3] Outer async promise chains lack a top-level .catch() (unhandled rejection risk)
- **Location:** `apps/native/src/notify/systemNotify.ts:283-313; apps/native/src/modules/dispatch.ts:107-121`
- **Problem:** Two fire-and-forget chains can leak unhandled rejections. systemNotify.scheduleAt() voids `loadNotificationPlugin().then(async … )` where inner steps are caught (307-311) but the outer chain has no terminal .catch — a rejection before the inner handler runs is swallowed. dispatch.dispatchRouterOutput() does `void Promise.all([...]).then(() => recomputeBrain(store)).catch(...)`, but runAllSyncs is not individually caught, so a runAllSyncs rejection short-circuits the Promise.all and recomputeBrain never runs (the post-dispatch brain recompute silently does not happen).
- **Fix:** Attach a terminal .catch to scheduleAt's outer chain; in dispatch, wrap each member of Promise.all in its own .catch so one failure can't suppress recomputeBrain: `Promise.all([runAllSyncs(store).catch(e=>console.error('[bridge] runAllSyncs',e)), recordMoodFromDump(...).catch(...)]).then(()=>recomputeBrain(store)).catch(...)`.

#### [low · conf 1/3] split(':').map(Number) destructured without length/range validation
- **Location:** `packages/orchestrator/src/body.ts:158; packages/orchestrator/src/sleep.ts:339`
- **Problem:** Both orchestrators parse an HH:MM string via `const [hh, mm] = hhmm.split(':').map(Number)` and feed the result into time math. body.ts:158 has no guard, so '25:99' or '12:' yields out-of-range or 0 values silently. sleep.ts:339 is materially safer: confirmed it is gated by `if (/^\d{2}:\d{2}$/.test(targetBedtime))` at line 338, so only the body.ts site is genuinely exposed — severity reduced to low accordingly. Round 3 flagged both.
- **Fix:** Guard body.ts the way sleep.ts already does: validate `/^\d{1,2}:\d{2}$/` and bounds (`hh 0-23, mm 0-59`) before using; return null on failure.

#### [low · conf 1/3] Non-null assertions (!) on nullable values in logic/sleep stats and goals
- **Location:** `packages/logic/src/sleep/stats.ts:54-55; packages/logic/src/goals/phase2.ts:106,271`
- **Problem:** Several spots force-unwrap nullable values. stats.ts:54-55 calls `_mean(wak)!.toFixed(2)` where _mean() can return null on an empty array, throwing on .toFixed. goals/phase2.ts:271 does `byGoal.get(r.goal_id)!.push(r)` assuming the Map key was initialized. phase2.ts:106 uses double-assertion `history!.goals!` after optional chaining. These are mostly guarded by surrounding length checks in practice but the assertions defeat the compiler's null protection where the invariant isn't proven.
- **Fix:** Replace assertions with safe access: `wak.length >= 3 ? Number(_mean(wak)!.toFixed(2)) : null`; `(byGoal.get(r.goal_id) ?? (()=>{ const a:Row[]=[]; byGoal.set(r.goal_id,a); return a; })()).push(r)`; and in phase2.ts compute `const goals = Array.isArray(history?.goals) ? history!.goals : [];`.

#### [low · conf 3/3] Best-effort .catch(() => {}) blocks swallow errors with zero observability
- **Location:** `apps/native/src/modules/partner/repo.ts:112,129,130,168; packages/research-stream/src/index.ts:192-193,212-222; packages/consent/src/index.ts:245`
- **Problem:** A recurring pattern of intentional graceful-degradation catches that log nothing: partner/repo.ts network syncs (.catch(() => {})), research-stream trackTable POST (confirmed lines 211-222: nested try + `.catch(() => {})`) and event emit (192-193), and consent audit syncRef (245). The behavior (non-blocking) is correct, but failures of partner sync, research ingest, and consent-audit sync are completely invisible, making field debugging of these subsystems impossible. Flagged across all 3 rounds.
- **Fix:** Keep non-blocking but add a single console.warn per catch: e.g. `.catch((err) => { console.warn('[research-stream] trackTable failed (non-fatal)', (err as Error).message); })`, and similarly for partner/repo and consent.

#### [low · conf 1/3] APNs credential env vars passed to signer without presence validation
- **Location:** `apps/api/src/worker.ts:436-442 (callsite 407)`
- **Problem:** getApnsJwt() forwards env.APNS_AUTH_KEY / APNS_KEY_ID / APNS_TEAM_ID into the signer with no check that they are defined; handleSend (line ~407) then uses the jwt in Promise.all. If any secret is missing the failure surfaces deep in the signer with an opaque message rather than a clear 'missing APNs credentials' at the boundary. Related: tokensForUser (worker.ts:420-424) silently returns [] on JSON.parse failure of stored tokens with no log.
- **Fix:** Validate at the boundary: `if (!env.APNS_AUTH_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) throw new Error('missing APNs credentials');` and add a console.warn in tokensForUser's catch.

