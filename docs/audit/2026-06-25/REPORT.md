# Full Repo Audit Report — Ollie

**Date:** 2026-06-25 · **Branch:** `redesign/olive-neumorphic`
**Method:** 20 angles × 3 independent rounds = 60 finder agents + 20 per-angle merge agents (confidence-scored). 6.55M tokens, ~88 min, read-only.
**Coverage note:** 1 finder (Angle 16 / Round 1) died on a 1M-context credit limit; Angle 16 covered by Rounds 2+3.
**Tallies:** 299 findings — 8 P0, 58 P1, 138 P2, 83 P3, 12 P4. Confidence: 93×c3, 59×c2, 147×c1. Status: 281 confirmed, 10 needs-runtime, 6 suspected, 2 product-decision.

> Machine-readable companions in this folder:
> - `findings.json` — all 299 findings, flat, ranked.
> - `full-merged-findings.json` — full per-finding detail (evidence / userImpact / smallestSafeFix / tests / dissent) per angle.
> - `angle-summaries.json` — per-angle summaries + implementation/runtime mismatches.

---

## 1. Overall Verdict
**Needs focused cleanup before more features — NOT ready for closed alpha yet.**

Architecture is sound: all 16 module handlers are real (graduated from stubs), 215 test files exist, no secrets tracked in git, recent audit fixes (RLS force, identity-text, rate-limit) are committed. The problem is not foundational — it lives in the **launch-safety + wiring** layer. ~6 blocker clusters; days-not-weeks of work. No refactor required, **door locks** required.

## 2. Plain-English Summary
The house is built well, but: the front door has no lock (AI proxy), the "delete me" button is fake (account-delete), your health belongings sit out on the table (no at-rest encryption), the next renovation will collapse the build (queue/deploy), and it's unclear whether the deed was filed with the county (identity migration applied to prod?). These must be fixed before inviting alpha testers.

## 3. What This App Is
A **life operating system for ADHD brains**. Single user: a high-life-load person (Serra herself = dogfood). Core promise: *brain dump → AI routes to the right module → module watches quietly, surfaces little, offers to act.* Today: 16 modules + 5-room IA genuinely work; dump→route→module is live on device. 2-layer AI (Layer 1 routing / Layer 2 watcher) is in place.

## 4. Core User Flows
| Flow | Status | Note |
|---|---|---|
| Sign-in (Clerk, Tauri localhost:9527) | working | blank white screen during auth loading (c1) |
| Brain dump → route → module | working | proxy unauthenticated (P0); Voyage single point of failure (P1) |
| Module watching / watcher noticing | partial | `void:braindump:submitted` never emitted → 9 orchestrator handlers dark (c2) |
| Onboarding | missing | new user lands on blank DumpScreen (c2) |
| Delete account (GDPR) | broken | deletes 0 rows (P0, c3) |
| Multi-device sync | unwired | `@ollie/sync` orphan; device writes plaintext SQLite (c3) |
| iOS push | dead end-to-end | empty entitlement, no token registration (c2) |
| Change language (EN/ES/TR) | no UI | everyone locked to English (c2) |

## 5. Feature Inventory (highlights)
| Feature | Status | Risk | Evidence |
|---|---|---|---|
| 16 module handlers | working | low | graduated from stubs |
| Partner | **fake** | P1 | `SAMPLE_SIGNALS` hardcoded → fabricated mood broadcast to real partner (c3) |
| Goals progress arc | **fake** | P2 | always 50% fill, no progress field in storage (c3) |
| Pets | partial | P2 | species hardcoded `guinea_pig` for all → vitamin-C warnings to cats (c1) |
| Care Circle / Garden | design-only | — | zero code |
| Consent screen | **unwired** | P1 | `configureConsent()` never called (c3) |
| Research pipeline | dead-code | P2 | `enrichDump()` zero call sites; GDPR consent UI may promise nothing |
| Crisis detection | working-but-unapproved | P1 | 3 lexicons `PENDING_SERRA_APPROVAL`, no CI gate (c3) |

## 6. Tech Stack Map
Frontend: React+TS / Tauri WKWebView. Native: Rust (src-tauri). Backend: 4 CF Workers (ai-proxy, apns-push, cron, sentry-tunnel) + apps/api (undeployed). DB: Supabase Postgres, 39 migrations, RLS. Auth: Clerk JWT. Device storage: SQLite + Tauri store (plaintext). AI: Voyage embeddings + Groq/Gemini + Anthropic proxy. Push: APNs. Test: vitest (215 files). Deploy: GitHub Actions.

## 7. Architecture Assessment
**Coherent:** monorepo boundaries, package separation, Brain/Body intent. **Weak:** (a) `apps/native/src/api/workers.ts` (1100 lines) is a second HTTP client parallel to `packages/api/client.ts` — silent contract drift (c3); (b) 3 parallel module-name registries hand-synced, already drifting (c1); (c) `@ollie/sync`, `@ollie/auth`, `@ollie/research-stream` fully orphaned yet CI still runs their tests.

## 8. Frontend Assessment
- **No error boundary anywhere** (c3) — one render throw crashes the whole shell. **P1.**
- `useModuleData` leaves screen frozen on infinite loading dot if SQLite migration/refresh fails (c3).
- All 14 Box components eager-imported at router boot, no code-splitting (c3).
- Tile component copy-pasted into 5 Room files, divergent (c3).

## 9. Backend/API Assessment
- `/brain-dump` + `/v1/messages` = **unauthenticated Anthropic proxy** (c3, P0). Rate-limit key is caller-supplied `x-user-id` — spoofable (c3).
- `cacheHitUpdate` sends `{hit_count:{increment:1}}` to PostgREST PATCH — invalid syntax, silently fails on every cache hit (c3). Test mocks 204 so it's masked.
- `medication` is routable in TS but absent from the SQL CHECK constraint → silent INSERT failure (runtime).

## 10. Database Assessment
- **profiles table dead under Clerk:** `uuid` FK → `auth.users`, `auth.uid()` RLS always NULL under Clerk JWT (c3). Salt roaming silently broken.
- GDPR cascade misses 5 tables: `dump_inbox, grocery_pantry, partner_*` (c2).
- 18/39 migrations have no rollback (c3).
- **Migration 0002 (uuid→text) — unconfirmed whether applied to prod** (c1, needs-runtime). If not applied, all client writes silently fail. **Most critical unknown.** Resolve with `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1`.

## 11. Auth/Permissions Assessment
Clerk JWT verify works, but: legacy Supabase auth fallback has no expiry (indefinite dual-auth, c3); `aud` claim not checked (c3); `profile_recovery_lookup` RPC is anon-callable + no rate-limit → account enumeration + offline passphrase brute-force (c2).

## 12. Security Assessment (P0/P1)
1. **Unauthenticated Anthropic proxy** (P0,c3) — anyone drains ANTHROPIC_API_KEY.
2. **CSP null** in `tauri.conf.json` (P1,c3) + `NSAllowsArbitraryLoadsInWebContent=true` — zero script restriction in webview.
3. **x-user-id rate-limit poisoning** (P1,c3) — DoS another user's quota.
4. **Tauri `sql:allow-execute`** grants renderer arbitrary access to all local health DB (c2).
5. **`STAGING_TEST_BEARER` bypass** activates when `ENVIRONMENT` is unset (`undefined !== 'production'` = true) (c1).
6. Live `GROQ_API_KEY` on disk (`workers/ai-proxy/.dev.vars`), unrotated after prior chat exposure (c1) — *value not printed.*

## 13. Privacy Assessment
- **Device data plaintext** — cycle/medication/mood/dump unencrypted in SQLite + localStorage (c3,P1). `encryptedKv` is written but has **zero callers** (unwired).
- **Worker PII scrubber lacks MEDICAL/MEDICATION/MENTAL_HEALTH/SEXUAL categories** — health terms reach Groq/Gemini/Anthropic unredacted (c3). 5 of 6 routes use weaker EN-only `pii.ts` → TR/ES names reach Anthropic (c2).
- `research_corpus` + `raw_dumps` excluded from account-delete, undisclosed in privacy policy (c3).
- Consent screen never shown (c3).

## 14. Validation & Boundary Safety
- `/route/dump` accepts `dumpId` with no length/format validation → KV 512-byte key overflow breaks idempotency (c3).
- `/label` interpolates `locale` directly into the Anthropic message — **prompt injection** (c1).
- AI-returned `module` value is **never validated against the MODULES list** → hallucinated module name flows to Vectorize cache + server-apply + dispatch (c3).

## 15. Performance/Reliability
- **No fetch timeout** on Voyage/Groq/Gemini calls — a stalled upstream hangs the worker for the full 30s (c3).
- 37+ screens poll SQLite **every 6 seconds** unconditionally, no visibility guard (c3).
- Cron drain: 50 serial Anthropic calls, no time-budget guard — worker killed mid-batch under backlog (c3).
- Groq free-tier 8k TPM — 2 concurrent dumps exhaust the bucket (c3).
- `cacheHitBump` drops `createdAt` → Vectorize entry self-destructs after first hit (c1).

## 16. External Services/AI
**Voyage = single point of failure for all classification; returns 502 on 429/5xx with no fallback** (c1). `GROQ_MODEL='openai/gpt-oss-120b'` validity suspected, needs runtime check. Voyage+Gemini+CF keys were chat-exposed; rotation is an unchecked alpha gate (c2).

## 17. Algorithms / Business Logic / AI
- **Crisis tier-1 (ambiguous distress) triggers full short-circuit** — code is `if(crisis)` (any tier) while the comment says "tier ≥ 2" → data silently discarded on ADHD burnout phrases (c3). Safety-critical logic-vs-comment mismatch.
- Low-confidence Vectorize cache hits replayed at default 0.8 confidence with no confirm card (c3).
- `hasConjunction` computed from already-split parts → always false at runtime, guard is a no-op (c3).

## 18. Reinvented Wheels / Overengineering
Second parallel HTTP client (workers.ts vs packages/api). 3 hand-synced module registries. Burhan (olive-tree) orchestrator runs every boot writing store keys but has **zero native UI consumers** (c2). `braindump-dispatch.ts` exported as live API, never called.

## 19. Underengineered Areas
Error boundary, onboarding, at-rest encryption wiring, fetch timeout, AI-output validation, language picker UI, consent wiring — all *missing*, not bad.

## 20. Dead/Stale Code
`@ollie/sync` + `@ollie/auth` + `@ollie/research-stream` orphaned (c3). `enrichDump()` / research orchestrator (665 lines) is a fully dead pipeline. `apps/api` (385-line account-delete) compiles but isn't deployed. `App.css` has no runtime effect.

## 21. Documentation Audit
- **README describes a defunct architecture** (apps/web + Electron + Capacitor); dev commands fail (c3).
- **CODEBASE_MAP.md is 43 days stale** — says crypto/sync/apps/api don't exist (they do), lists 4 packages (16 exist), misses rooms/ IA (c3).
- `DEPLOY_TODO.md` smoke test says **"Open Atelier"** — Atelier is a different product (law-firm AI) (c2).
- `DATA_SCHEMA.md` says "not yet migrated" — 39 migrations applied for months.

## 22. Testing Assessment
- **deploy-workers.yml has no test gate**, runs in parallel with ci.yml — broken code ships to prod workers (c2/c3). The **82 commits on this branch never passed CI** (CI only runs on main).
- Coverage thresholds defined but never enforced (`pnpm test` skips --coverage) (c3).
- Crisis positive path, Partner consent filtering, `executeAction` (4 of 5 actions) have zero tests.
- Rust/Tauri has **zero CI** — cargo check/clippy never runs (c3).

## 23. Build/Deploy/DevOps
- **Queue bindings are active TOML while comments say "COMMENTED OUT"** → next `wrangler deploy` hard-fails (c3, ai-proxy + cron + apps/api).
- **Staging shares prod KV/Vectorize namespaces** — staging writes contaminate prod cache + rate-limit (c2).
- iOS build number conflicts across 3 files (1.1.0 vs 1.1.1) → Apple rejects re-upload (c1).
- `scan-banned-phrases.cjs` scans 3 phantom paths, skips 281+ active UI files (c3).

## 24. Launch Readiness
**TestFlight is broken end-to-end** (installCount=0 ever, c3) — no working OTA channel for closed alpha. This + the blockers below stop alpha.

---

## Three-Round Finding Matrix — Blockers (deduped)
| ID | Finding | Sev | Conf | Status | Angles | Smallest safe fix |
|---|---|---|---|---|---|---|
| B1 | account-delete silently fails for all Clerk users (JWT→Supabase /auth/v1/user 401 + deletes by uuid + lives in undeployed worker) | P0 | 3 | confirmed | A5,A6,A18,A20 | verify JWT via Clerk, delete by Clerk text id, add 7 tables to USER_SCOPED_TABLES, deploy apps/api |
| B2 | `/brain-dump`+`/v1/messages` unauthenticated Anthropic proxy | P0 | 3 | confirmed | A4,A6,A7,A9,A16,A20 | require Clerk JWT, derive rate-key from JWT sub (not x-user-id) |
| B3 | Device health data plaintext (SQLite+localStorage) | P0/P1 | 3 | confirmed | A7,A8 | wire existing `encryptedKv` in place of browserAdapter |
| B4 | Queue bindings active → next worker deploy hard-fails | P0 | 3 | confirmed | A4,A14,A16 | provision the queue OR actually comment the TOML blocks |
| B5 | deploy-workers.yml has no test gate, runs against prod | P0/P1 | 2 | confirmed | A12,A13,A14 | add `needs: [ci]`, don't deploy until typecheck+test pass |
| B6 | Identity migration 0002 (uuid→text) — unconfirmed applied to prod | P0 | 1 | **needs runtime** | A20,A7 | run `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1` |

Long tail: 58 P1, 138 P2, 83 P3, 12 P4 — full list in `findings.json` / `full-merged-findings.json`.

## 25. P0/P1 Blockers (ordered)
B1–B6 above, plus these P1s: no error boundary (B7), consent unwired (B8), crisis lexicon unapproved (B9), TestFlight broken (B10), Partner fake signals (B11), Voyage single-point-of-failure (B12), dark-mode lightPalette in 40 files (B13).

## 26. P2 Important Fixes (138; top-confidence 51)
Goals fake 50% arc · PII scrubber missing health categories · grocery RLS dead under Clerk · no fetch timeout · 6s polling · hardcoded "good evening" · iOS bundle-id docs mismatch · 18 migrations without rollback.

## 27. P3/P4 Cleanup (95)
SMCP kicker copied to 13 places · 139 raw font-sizes bypass type scale · inline shadow tokens bypassed · orphan packages · stale docs · Burhan orchestrator with no UI.

## 28. Recommended Roadmap

### Phase 1 — Stabilize (no redesign, no features)
- **Goal:** close the trust + security holes blocking alpha.
- **Tasks:** B1–B10.
- **Likely files:** `apps/api/.../account-delete.ts`, `workers/ai-proxy/src/index.ts`, `apps/native/src/storage/`, `*/wrangler.toml`, `.github/workflows/deploy-workers.yml`, `apps/native/src/main.tsx` (error boundary), `packages/crisis-lexicon`.
- **Do not touch:** module handlers, redesign/olive UI, working dump→route engine.
- **Tests:** account-delete integration (Clerk JWT), proxy 401-without-auth, encryptedKv read/write, crisis positive-path.
- **Exit:** 6 blockers confirmed-fixed + `pg_typeof` verified + TestFlight install works.

### Phase 2 — Product/UX Completion
- **Goal:** core flows clear + usable.
- **Tasks:** onboarding (2 screens), language picker, Partner real signals OR clearly flag-off, remove goals fake-arc, wire consent screen, emit `void:braindump:submitted`.
- **Exit:** new user isn't lost without guidance; no fake features remain.

### Phase 3 — Architecture/Scale
- **Goal:** debt + performance.
- **Tasks:** unify the second HTTP client, collapse registries to one source, fetch timeout + poll visibility guard, dark-mode token refactor, orphan-package cleanup, Rust CI.

## 29. Top 20 Next Tasks
1. Fix account-delete with Clerk JWT + text id **(P0,c3)**
2. Add JWT auth to proxies **(P0,c3)**
3. Resolve queue TOML/provision **(P0,c3)**
4. deploy-workers `needs:[ci]` **(P0,c2)**
5. Verify migration 0002 via `pg_typeof` **(P0,c1)**
6. Wire encryptedKv **(P1,c3)**
7. Add error boundary **(P1,c3)**
8. Configure consent at boot **(P1,c3)**
9. Approve crisis lexicon + CI gate **(P1,c3)**
10. Fix crisis tier comment/code mismatch **(P1,c3)**
11. Add health categories to PII scrubber **(P2,c3)**
12. Validate AI module output against MODULES **(P2,c3)**
13. Set CSP **(P1,c3)**
14. Move rate-key from x-user-id to JWT sub **(P1,c3)**
15. Separate staging KV/Vectorize **(P1,c2)**
16. Add fetch timeout **(P2,c3)**
17. Guard/flag Partner SAMPLE_SIGNALS **(P1,c3)**
18. Language picker UI **(P1,c2)**
19. Update README+CODEBASE_MAP+DEPLOY_TODO **(P1/P2,c3)**
20. Onboarding 2-screen **(P2,c2)**

Per-task fix/risk/test detail is in `full-merged-findings.json`.

## 30. "Do Not Touch Yet" List
redesign/olive-neumorphic UI · working dump→route engine · 16 module handlers · Clerk-in-Tauri localhost:9527 setup · `gen/apple` (intentionally committed) · crisis detection *logic* (only the tier-bug + approval). These are either correct or high-risk to change.

## 31. Questions For Serra (decisions that block work)
1. **Was migration 0002 applied to prod?** — one SQL resolves it; B6 depends on it. Run the read-only SELECT?
2. **Is Partner in v1?** — if not, flag-off + SAMPLE_SIGNALS guard is enough; if yes, real-signal wiring enters Phase 1.
3. **Is sync in v1?** — `@ollie/sync` is orphan; is device-local enough, or is multi-device an alpha gate?
