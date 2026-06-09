# Ollie Product + Technical Health Audit

_Date: 2026-06-09 · Branch: feat/brain @ 2325ee5 · Read-only. Synthesised from a 5-agent subsystem sweep + the 20×3 deep audit (docs/audit-2026-06-09/FINAL_AUDIT.md)._

---

## 1. Product Summary

Based on the code, **Ollie is an ADHD-first "personal life brain": one low-friction capture surface that turns messy input into quiet, useful action.**

- **One front door.** A brain-dump box (`apps/native/src/dump/`) takes text, voice (Groq Whisper) and photos (Gemini OCR). The user offloads everything in one mess; Ollie sorts it.
- **AI does the sorting, not the user.** A Cloudflare worker (`workers/ai-proxy`) segments the dump into intent-fragments, classifies each into one of ~14 modules + an action, and routes it. Providers cascade Groq → Cloudflare → Gemini → OpenRouter.
- **Modules apply locally.** 13 module handlers (`apps/native/src/modules/*`) write to on-device SQLite, mirror to `@ollie/store`, and optionally sync **encrypted** (real AES-GCM-256) to Supabase. Identity is **Clerk**; Supabase is data + opt-in sync only.
- **A "brain" watches.** Layer-2 orchestrators (`packages/orchestrator`) + the brain module surface "noticings" on home — the deadline AND the milk — scored against the user's daily capacity.
- **Platforms:** Tauri desktop (macOS) + iOS. No public web (by design).

**One-line:** capture-anything → AI routes → modules act → the brain resurfaces what matters. The **capture + route** half is strong; the **resurface + life-admin** half is the weak link.

---

## 2. Core Loops Found in the App

Completeness = capture → store → surface, end-to-end and user-reachable.

| Loop | Key files | Complete | Supports "life brain"? | Verdict |
|---|---|---|---|---|
| **Brain dump** | `apps/native/src/dump/*`, `workers/ai-proxy/src/router/dump.ts`, `dump-classify.ts` | ~95% | ✅ It **is** the product | **KEEP** |
| **Admin tasks** | `apps/native/src/modules/admin/{handler,repo,types}.ts`, `todo/` | ~90% capture, weak on dates/resurfacing | ✅ The core of "life brain" | **KEEP + strengthen** (§6) |
| **Reminders** | `notify/{systemNotify,serverReminder,serverReminderBridge}.ts`, `workers/cron`, `router/remindIn.ts` | ~85% (live cron fire untested) | ✅ | **KEEP** (verify live fire) |
| **Pantry/shopping** | `modules/grocery/{handler,repo,bridge}.ts`, `router/{purchase,replenishment,shelf-life}.ts` | ~92% | ✅ | **KEEP** |
| **Feed Me** | `router/feed-me.ts`, `modules/feed-me.config.ts`, `grocery/FeedMeView.tsx` | ~88% (cook-history writer missing) | ➖ decorative | **SIMPLIFY / DEFER** |
| **Finance** | `modules/finance/{handler,repo,bridge}.ts`, `finance.config.ts` | ~90% (8 actions — broad) | ✅ "finance notes" | **KEEP, consider trimming actions** |
| **Partner** | `modules/partner/*`, `router/partner.ts` | ~70%, **orphan** (not dump-routable, no tests, mocked) | ❌ tangential | **DEFER (cut from v1)** |
| **Notifications** | `notify/*`, `workers/cron/flush-notifications.ts`, `apns-push` | ~85% (cron drain untested) | ✅ delivery layer | **KEEP** (verify) |
| **AI/OCR/voice** | `router/{vision,transcribe,segmentation-llm}.ts`, `dump/{PhotoIntake,MicButton}.tsx` | ~90% | ✅ widens capture | **KEEP** |

**Completeness ranking (most→least):** brain dump → grocery → finance ≈ admin ≈ AI/OCR/voice → notifications ≈ reminders ≈ Feed Me → **partner (orphan)**.

---

## 3. Feature Sprawl Analysis

The app is **disciplined** — no streaks, no astrology, no garden game, no social graph. Sprawl is concentrated in two pockets.

| Feature | Lean |
|---|---|
| Brain dump, Brain (noticings), Admin, Finance, Grocery (pantry/shopping), Reminders, AI/OCR/voice | **core** |
| Work, Sleep, Body, Mood, Habits, Goals, Todo aggregator, Notifications | **supporting** |
| Feed Me (recipe AI), Cycle (pregnancy pause), Medication | **experimental** |
| **Partner** (mocked bilateral sync), **Pets** (Tontin/Pinpon) | **remove/defer (v1)** |

**Worst sprawl:** (1) **Partner** — a whole pairing/consent/snapshot subsystem + Supabase migrations, fully mocked, zero tests, not even brain-dump-routable. Pure side-quest weight. (2) **Grocery's Feed Me** — ~70KB of recipe/diet/cook-history logic decorating an otherwise-core pantry loop.

Both can be feature-flagged out of v1 with **no impact on the life-brain core**.

---

## 4. Data Model and Persistence Risks

Three persistence layers, **partially mis-wired**.

- **`@ollie/store`** (`packages/store`): localStorage facade + in-memory cache, namespaced `void.state.<module>.v5`, with pre-migration snapshots (keeps last 3). Healthy. Read/write pairs balanced.
- **SQLite** (`apps/native/src/storage/sqlite.ts` + 13 module repos): the real on-device store. **⚠️ No centralised migration runner found** — repos assume tables exist; a schema bump has no declared upgrade path → risk of runtime query/schema mismatch. _Verify whether table creation is hardcoded in init; if so, formalise it._
- **Supabase** (27 migrations): `encrypted_state` + `finance_records` are properly RLS'd + AES-GCM opaque. Risks:
  - **`cook_history` Clerk-id band-aid** (`20260530144446_*`): column retyped uuid→text after writes failed; dead `auth.uid()` RLS dropped. Works only because access is service-role via the worker.
  - **`plaid_items`**: Plaid/bank-linking was **removed as a product decision** (empty tables left behind). → **dead schema; drop it.**
  - **Dead `auth.uid()` RLS** in `profiles`/`encrypted_state`/`finance_records`: returns NULL for service-role (the real path) → misleading dead code.
- **Auth split (Clerk vs Supabase):** Clerk is the **only** identity; Supabase Auth is unused but still referenced by RLS. Worker JWT verification (`clerk-verify.ts`) is solid. **Decision needed:** commit to "Clerk-only + service-role gate" and delete the dead `auth.uid()` policies, OR provision Supabase Auth rows. Also: profile-salt upsert (`serverReminderBridge.ts`) can **fail silently** → a new device can't decrypt; needs retry + error surface.
- **Encrypted state:** ✅ **real** AES-GCM-256, PBKDF2-SHA256 @ 600k iters, key never persisted, iteration-versioned envelope. Opt-in sync, LWW reconciliation. **But:** cycle data is written **plaintext to local SQLite** (doesn't route through `storage/encrypted.ts`) — the "engineers can't open it" promise is not yet true on-device. _(Note: Supabase-side cycle sync IS encrypted per prior confirmation; the gap is the local DB.)_
- **Stale docs:** `FEATURE_AUDIT_2026-05-31.md` describes a SQLite↔store "great disconnect" that was **reportedly fixed** by the rewiring (commit fd9c831) — the doc now misleads. `REWRITE_ROADMAP_RN.md`, `TAURI_MIGRATION_ROADMAP.md`, `MONEY_V2_SPLIT_PLAN.md`, `IOS_SETUP.md` likely describe completed work as "future." `ARCH_DECISION_NEEDED.md` is clean.

**Top cleanup:** SQLite migration runner · encrypt cycle on-device · drop plaid dead schema · delete/annotate dead RLS · refresh the 4 stale docs.

---

## 5. AI Flow Audit

**Current shape = WRITE-THEN-UNDO.**

- **Prompts:** lean Layer-1 router prompt (~7k chars, `dump-classify.ts:44`), pass-2 segmentation prompt (`segmentation-llm.ts`), per-module Layer-2 prompts (`modules/*.config.ts`), vision prompt (`vision.ts`).
- **Route:** `/route/dump` = JWT → pass1 segment → pass2 LLM segment (≈30% of dumps) → crisis check → embed+cache lookup (Voyage+Vectorize) → **one batched** classify call → confidence policy → apply.
- **Providers:** cascade defined in `router/json-cascade.ts` (Groq → CF → Gemini → OpenRouter). Resilient.
- **Schemas/validation:** outputs validated in `parseBatchResults` (`dump-classify.ts:207`) — bad JSON / count-mismatch **throws** and advances the cascade. **Two validation gaps** (from deep audit): non-numeric confidence is coerced to `0` (`:200`) → spurious demotion + data loss; and `remindIn` is silently lost when a low-confidence fragment is demoted to `dump_only` (`dump.ts:281/338`).
- **Confirmation tiers** (`dump-schema.ts:67`): ≥0.80 silent · 0.60–0.79 `needsConfirm` · <0.60 demote to `dump_only`.
- **Confirmation UX** (`DumpScreen.tsx:156`): handler **writes to SQLite first**, then — only for `needsConfirm` fragments — shows a card with **keep / undo** (undo = handler-returned closure that deletes the row). Crisis short-circuits all handlers.

**Recommendation — hybrid, not a wholesale switch:**
- **Keep write-then-undo for ≥0.80** confidence. This is the ADHD win: capture has zero friction, the app just acts, and undo is the safety net. Matches Ollie's "dump → tiny okay → silent module update" identity.
- **Move 0.60–0.79 to draft-first.** Today these write silently AND show a confirm card — the worst of both (a wrong write already happened). Don't write until the user taps keep. Same card, reordered: confirm → then apply.
- **<0.60 dump_only is fine** (already non-committal), but fix the `remindIn`/confidence-coercion data-loss bugs first.

Net: **tiered confirm** — silent above 0.8, draft-first in the grey zone. Small change in `applyConfidencePolicy` + dispatch ordering, big trust gain.

---

## 6. Admin Tasks Readiness

The "life brain" lives or dies here. Capture + reminders are strong; the **brain** part (dates, recurrence, resurfacing) is weak.

| Capability | Status | Note |
|---|---|---|
| Task capture | **PARTIAL** | 6 dump-routed actions (`admin/handler.ts:28–77`); **no manual quick-add UI** |
| Due dates | **PARTIAL** | renewals + appointments have dates; **generic `create_task`/`phone`/`paperwork` are dateless** (`types.ts:44`) |
| Recurring tasks | **ABSENT** | only a 7-day snooze on decisions; cadence is observational, not generative (`repo.ts:329`) |
| Reminders | **PRESENT** | 3-path (local + server + APNs), dedup'd, fires app-closed via cron |
| Categorization | **PARTIAL** | soft `kind` enum; no tags, no priority |
| Search | **ABSENT** | no search box, no FTS index, no filter |
| Completion | **PRESENT** | tasks `done=1`; renewals **deleted** (no history) |
| Resurfacing | **PARTIAL** | Layer-2 detectors emit noticings, but the key **A9 stale-ball is starved** — `admin_tasks` lacks `ball_state`/`last_transition_at` (`bridge.ts:20`); dismissals are session-only |

**Biggest gaps (ranked):** (1) forgotten-task resurfacing blocked by missing schema — the #1 ADHD object-permanence failure; (2) generic tasks dateless → can't sort/filter by urgency; (3) no recurrence → annual renewals must be re-dumped; (4) no search.

---

## 7. Recommended Ollie v1 Focus

**The smallest strong version: "dump anything → it becomes a tracked task/need → Ollie reminds you and resurfaces what you forgot."** One loop, done well.

**Must Have**
- Brain dump (text + voice + photo) → AI route. _(have)_
- Admin tasks with **due dates on every task** + **completion**. _(gap: dates)_
- **Resurfacing of forgotten/overdue tasks** (unblock A9). _(gap)_
- Reminders that fire **app-closed**, verified live end-to-end. _(verify)_
- Pantry/shopping + finance **capture** (not full PFM). _(have)_
- The **noticings home surface** (the brain), scored by capacity. _(have)_
- Crisis safety correct + trilingual. _(alpha-blocker, §9)_

**Should Have**
- Draft-first for grey-zone confidence (§5).
- Search/filter + categories on tasks.
- Recurring renewals (auto-next-instance).
- Light mood/sleep/body capture (low cost, real ADHD value).

**Could Have**
- Feed Me, habits, goals, medication, cycle.
- Manual quick-add task UI.

**Won't Have (v1)**
- Partner / care circle / any social or shared feature.
- Pets, garden game, astrology, brown noise.
- Bank linking (already removed).
- Public web.

---

## 8. Cleanup Checklist

**Stale docs to update**
- [ ] `FEATURE_AUDIT_2026-05-31.md` — mark the SQLite↔store "disconnect" resolved (fd9c831) or delete.
- [ ] `REWRITE_ROADMAP_RN.md`, `TAURI_MIGRATION_ROADMAP.md`, `MONEY_V2_SPLIT_PLAN.md`, `IOS_SETUP.md` — reconcile "future" claims with shipped reality.

**Dead code to remove**
- [ ] `plaid_items` / `plaid_inbox` empty tables + any Plaid refs (product-removed).
- [ ] Defer Partner module out of v1 nav (`navigation/Router.tsx:63`) behind a flag.
- [ ] Dead `auth.uid()` RLS policies (or annotate as advisory).

**Auth decisions**
- [ ] Commit to **Clerk-only + service-role gate**; delete dead Supabase-Auth RLS, OR provision Supabase Auth rows.
- [ ] Add retry + error surface to profile-salt upsert (`serverReminderBridge.ts`).

**Migrations to review**
- [ ] Add a **SQLite migration runner** + schema versioning (`storage/sqlite.ts`).
- [ ] Confirm RLS posture after dropping plaid + dead policies.

**Tests to add**
- [ ] Crisis end-to-end (worker signal → native card) — currently the schema mismatch is untested.
- [ ] Live reminder fire (cron drain → APNs).
- [ ] Cycle on-device encryption.
- [ ] Partner (if kept) — currently zero tests.

**AI validation improvements**
- [ ] Fix non-numeric confidence → 0 coercion (`dump-classify.ts:200`).
- [ ] Preserve `remindIn` when demoting to dump_only (`dump.ts:281/338`).
- [ ] Crisis signal schema: align worker output ↔ native `schema.ts:72`.

**UX simplifications**
- [ ] Defer Partner + Feed Me from v1 surface.
- [ ] Add due dates to generic tasks + a manual quick-add.
- [ ] Draft-first confirm in the 0.6–0.79 band.

---

## 9. Next 10 Implementation Tasks (priority order)

1. **Fix crisis signal schema mismatch** — worker sends `tier/languages/matches`, native reads `type/language`. `apps/native/src/router/schema.ts:72` ↔ worker crisis output. _(alpha-blocker, safety, 3/3 confidence)_
2. **Trilingualise the crisis banner** — hardcoded English. `apps/native/src/dump/DumpScreen.tsx:303`. _(alpha-blocker)_
3. **Add a SQLite migration runner + schema versioning** — `apps/native/src/storage/sqlite.ts` + each `modules/*/migrate.ts`. Unblocks every schema change below.
4. **Add due dates to generic admin tasks** — `modules/admin/types.ts:44`, `handler.ts:28`, `repo.ts`; surface in `todo/aggregateTodos.ts`.
5. **Unblock forgotten-task resurfacing (A9)** — add `ball_state` + `last_transition_at` to admin schema; wire `modules/admin/bridge.ts:20` → `packages/orchestrator/src/admin.ts` stale-ball detector.
6. **Close telemetry IDOR** — pass verified `userId` from `workers/ai-proxy/src/index.ts:315` into `telemetry.ts` handlers; reject mismatched `user_hash`/`row.user_id`.
7. **Fix two AI data-loss bugs** — `remindIn` lost on demotion (`router/dump.ts:281/338`) + confidence→0 coercion (`router/dump-classify.ts:200`).
8. **Draft-first in the grey zone** — make `applyConfidencePolicy` (`router/dump-schema.ts:67`) defer the write for 0.60–0.79 and have `DumpScreen` dispatch confirm-before-apply.
9. **Encrypt cycle on-device** — route `modules/cycle/repo.ts` writes through `storage/encrypted.ts`; audit medication/admin for the same gap.
10. **Defer Partner + drop dead schema + refresh stale docs** — flag Partner out of v1 (`navigation/Router.tsx:63`), drop `plaid_*` tables + dead `auth.uid()` RLS, update the 4 stale docs in §8.

_Tasks 1–2 gate alpha. 3 unblocks 4/5/9. 6–7 are confirmed data-integrity/security fixes from the deep audit. 8 is the trust upgrade. 10 is debt paydown._
