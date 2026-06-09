# `redesign/money-v2` → 9 PR Split Plan

**Date**: 2026-05-27
**Source branch**: `redesign/money-v2`
**Target**: `main`
**Scope**: 43 commits, ~918 files changed, +105k / −20k lines (full v2 redesign sprint)

---

## TL;DR

The branch accumulated a clean-slate v2 redesign + compliance work + infra fixes in one place. Splitting into 9 PRs lets the **compliance-critical PII-scrub** land alone with focused review, lets independent module redesigns merge in parallel, and keeps cleanup PRs from getting tangled with feature work.

**Merge sequence**: PR-1 → PR-2 → PR-3 → (PR-4, PR-5, PR-6 in parallel) → PR-7 → PR-8 → PR-9

**Estimated effort**: 1–2 weeks part-time. PR-1 alone may take a full day (compliance review). PR-8 is the largest by file count but lowest risk (cleanup-only).

---

## Bucket overview

| # | Bucket | Commits | Risk | Order | Parallel-able? |
|---|--------|---------|------|-------|----------------|
| 1 | **PII-scrub + T1 routing cache** | 1 | HIGH (compliance) | 1 | No — blocks all |
| 2 | **Notifications & push infra** | 6 | Medium | 2 | No — blocks 3 |
| 3 | **Faz 2 module upgrades + event wiring** | 10 | Medium | 3 | No — blocks 4–6 |
| 4 | **Work module + matter routing** | 1+ | Medium | 4 | Yes (with 5, 6) |
| 5 | **Money-v2 redesign + finance logic** | 2+ | Medium | 5 | Yes (with 4, 6) |
| 6 | **v2-shell + desktop + responsive** | 5 | Medium | 6 | Yes (with 4, 5) |
| 7 | **Apple Intelligence native bridges** | 1 | Medium | 7 | Yes (with 4–6) |
| 8 | **Code cleanup + audits + refactors** | 10 | Low (large blast) | 8 | No — after features |
| 9 | **Loose merges & dispatcher fixes** | 8 | Low | 9 | Yes (with 8) |

---

## PR-1 — PII-scrub + T1 routing cache (COMPLIANCE-CRITICAL)

**Why first**: This commit adds compliance-critical PII labeling (MEDICAL / MEDICATION / SEXUAL / MENTAL_HEALTH) and the routing_cache migration. Needs focused legal-grade review. Should not be entangled with UI work where reviewers might skim the schema migration.

**Commits**:
- `e7fe7bf` feat(T1): module-agnostic routing_cache migration + pii-scrub MEDICAL/MEDICATION/SEXUAL/MENTAL_HEALTH + brand allowlist

**Files**:
- `packages/pii-scrub/src/index.ts`, `brand-allowlist.ts`
- `supabase/migrations/20260521000001_routing_cache.sql`

**Risk**: HIGH (regulatory, schema migration, downstream blocker)

**How**: Cherry-pick the single commit onto a new branch `pr/pii-scrub-routing-cache`. Open PR with explicit reviewer ask: "scrub categories correct? migration safe to run on prod?" Land before anything else.

---

## PR-2 — Notifications & push infrastructure

**Why second**: Notifications cron + APNs + permission priming is foundational. PR-3 (Faz 2 modules) depends on event listeners + retention bridge being wired through this layer.

**Commits**:
- `7d04d6b` flushNotificationQueue cron drain (P1)
- `d81fa75` quiet hours, focus suppression, permission priming
- `6c32303` settings: push-notifications permission row
- `91ced55` include user_id in APNs token registration
- `a1c9d16` move stray notification_delivery down-migration to rollbacks/
- `f39335a` docs: correct flushNotificationQueue + day-30 status

**Files**:
- `packages/notifications/src/*`
- `workers/cron/*` (flush-notifications)
- `apps/api/src/worker.ts`
- `supabase/migrations/20260515000001_notification_delivery.*`

**Risk**: Medium (delivery mechanism + cron jobs + migration)

**Watchpoint**: APNs token registration fix (user_id) was a beta-blocker bug; verify the fix is consistent with what's currently deployed on cron worker.

---

## PR-3 — Faz 2/3 module upgrades + orphan event wiring

**Why third**: Touches many modules (body, sleep, pets, admin, finance, cycle, goals). Event registry + orphan-event wiring is consolidated here. Downstream module PRs (work, money) assume these events fire correctly.

**Commits**:
- `4048b01` feat(body,work,goals): Faz 2 Body fixes + Faz 3 new features
- `bb95d17` feat(sleep): Faz 2 Sleep module fixes
- `468eb06` feat(admin): Faz 2 Admin module fixes
- `9df6300` feat(pets): Faz 2 Pets module fixes
- `0b93a42` feat(finance): Faz 2 — analytics recompute on module's own forms
- `538759d` feat(events): wire A-bucket orphan events to listeners
- `eefd7f2` feat(events): resolve C-bucket orphan events
- `6ab6bb0` feat(sleep): Epworth Sleepiness Scale
- `cbdd7f3` feat(retention): day-30 prompt
- `78346d8` fix(retention): wire makeRetentionBridge for D1/D7/D30

**Files**:
- `packages/orchestrator/src/*` (body, sleep, pets, admin, finance, cycle)
- `packages/logic/src/*` (all modules)
- `packages/events/src/registry.ts`, `shapes.ts`
- `apps/web/src/modules/*`

**Risk**: Medium (broad surface but coherent theme)

**Watchpoint**: `4048b01` covers body+work+goals — work portion logically belongs with PR-4. **Decide**: cherry-pick by directory? Or accept that PR-3 has some work-module overlap, and PR-4 builds on top?

---

## PR-4 — Work module + matter routing (WORK-VISION Phase 1+2)

**Why parallel-able with PR-5, PR-6**: Self-contained new module, no shared files with money-v2 or shell.

**Commits**:
- `9ed51e5` Add matter container + dump→matter routing (WORK-VISION Phase 1+2)
- (work portion of `4048b01` — see PR-3 watchpoint)

**Files**:
- `packages/orchestrator/src/work.ts`
- `packages/logic/src/work/*` (phase2, legacy, pomodoro)
- `apps/web/src/modules/work-v2/*` (screens, selectors, store)

**Risk**: Medium (new feature, large module)

---

## PR-5 — Money-v2 redesign + finance logic

**Why parallel-able with PR-4, PR-6**: Money module is isolated. Depends on PR-1 (PII scrub) for routing cache shape but otherwise self-contained.

**Commits**:
- `0b93a42` (finance analytics portion — overlaps with PR-3, **decide split**)
- `a477c90` fix(money-v2): defensive guards for safeToSpendVM

**Files**:
- `apps/web/src/modules/money-v2/*` (full v2 redesign: income, bills, savings, tax-setaside, impulse-pause, ADHD-tax, subscriptions, shopping-check, private)
- `packages/logic/src/finance/*`
- `design/clean-slate-2026-05-18-v2/money-*.html`

**Risk**: Medium (large UI surface, isolated module)

**Watchpoint**: If PR becomes >100 files, consider splitting `modules/money-v2/screens/*` vs `logic/finance/*`.

---

## PR-6 — v2-shell, desktop, responsive

**Why after PR-3/4/5**: Shell wires the v2 modules into the new navigation. Module v2 redesigns should be reviewed first.

**Commits**:
- `b6b15e4` checkpoint: v2-shell is the app + Clerk auth migration
- `9809a52` feat: desktop thin-spine shell + desktop-aware Screen primitive
- `c573e8c` feat(mobile): responsive pass for iPhone
- `d5f0689` feat(screens): crisis, gallery, insights, voice
- `a16bfbc` Add age input to onboarding Welcome screen

**Files**:
- `apps/web/src/modules/v2-shell/*`
- `apps/web/src/pages/*` (V2PreviewScreen for each module, plus crisis/gallery/insights/voice)
- `apps/web/src/design/tokens.css`, `lib/useKeyboardInset.ts`, `useIsWideViewport.ts`
- `apps/desktop/*` (thin-spine shell, native bridge — note: `apps/desktop/native/` source from PR-7)
- `design/desktop-2026-05-19/`, `design/clean-slate-2026-05-18-v2/`

**Risk**: Medium (navigation + auth migration + many screens)

**Watchpoint**: Clerk auth migration is bundled here — make sure migration story is clearly documented in PR description.

---

## PR-7 — Apple Intelligence native bridges

**Why parallel-able**: Standalone native code. Doesn't block or depend on UI module work.

**Commits**:
- `6aebf17` feat: on-device Apple Intelligence routing — multi-route + macOS bridge

**Files**:
- `apps/desktop/native/ollie-ai-helper/` (Swift, Package.swift, OllieAIHelper.swift)
- `apps/desktop/main.js`, `preload.js`
- `apps/ios/ios/App/App/OllieAIPlugin.swift`, `OllieBridgeViewController.swift`
- `apps/web/src/hooks/aiRouteBridge.ts`, `apps/web/src/lib/ollie-ai.ts`

**Risk**: Medium (native platforms, but isolated)

**Watchpoint**: `.build/` artifact pollution — current `rewrite/native-foundation` had a 34MB orphan cache from this commit. Confirm `.build/` is gitignored before merging (already done on `rewrite/native-foundation`, commit `f4aa6ec` — port to PR-7 branch).

---

## PR-8 — Code cleanup + audits + refactors

**Why after features**: This bucket includes a mega-commit (`27ef92b`, 200+ files) that touches many areas. Merging cleanup after features keeps the diff reviewable and avoids constant rebases on cleanup commits.

**Commits**:
- `27ef92b` Fix 8-agent code audit (mega-commit, **consider re-splitting**)
- `3c59332` Close audit gaps: dead habits layer, posture toggle
- `bc058f4` Checkpoint: re-audit fixes + multi-pod work (tree green)
- `29e963c` Consolidate packages/logic duplicated helpers + habit-sleep TZ bug
- `fdc2a1f` consolidate consent source + unify brain-dump dispatch
- `d0de2bf` chore(events): remove 3 dead orphan events
- `5a83621` chore(alpha): remove dead 'go deeper' placeholder rows from sleep
- `68eedb9` chore(alpha): remove dead bank-link + cycle export/import
- `e9ffa5d` chore(invite): disable BETA_INVITE_REQUIRED gate
- `47a6fa6` Remove Plaid + TrueLayer bank integration

**Files**: Broad sweep across `packages/logic/*`, `packages/orchestrator/*`, `packages/auth/*`, `packages/consent/*`, `apps/web/src/lib/*`, audit docs.

**Risk**: Low individual risk but large blast radius (any other branch in flight needs to rebase after this lands).

**Watchpoint**: `27ef92b` is monolithic (200+ files). Decide: keep as-is and merge, OR cherry-pick + re-split by package. Re-splitting is high effort; keeping as-is is fine if the original commit was well-reviewed.

---

## PR-9 — Loose merges & dispatcher fixes

**Why last**: Scattered Sentry-driven fixes for toast, aiRoute, vite dedupe, dump-dispatch phantom modules. Can be cherry-picked into PR-5 or PR-6, OR landed as a final small PR.

**Commits**:
- `02081e2` Merge fix/money-and-react-dispatcher-sentry
- `53a65a0` ToastProvider inside AppRouter + missing aiRoute.ts
- `4657b02` Merge fix/dump-dispatch-phantom
- `02a3b0d` route 5 phantom modules to UI-read slices
- `7d0fc4e` test(web): useApplyBrainDump pets assertion update
- `af2d346` fix(toast): co-locate ToastProvider + Sentry regression guard
- `4edc592` fix(vite): dedupe react + preinclude in optimizeDeps
- `1710f63` fix(settings): remove fake at-rest encryption UI

**Files**:
- `apps/web/src/App.tsx`, `router.tsx`, `ToastContext.tsx`
- `apps/web/vite.config.ts`, `lib/aiRoute.ts`

**Risk**: Low (small focused fixes)

**Watchpoint**: `1710f63` (remove fake at-rest encryption UI) matches the v1=alpha decision (memory: `feedback_atelier_electron_always` / `project_ollie_v1_alpha_decisions`). Confirm no marketing copy still mentions encryption.

---

## CRITICAL UPDATE 2026-05-27 — source branch reconsideration

**Discovery**: `feat/t0-clerk-jwt-verify` is a **strict superset** of `redesign/money-v2`. It contains all 43 commits of money-v2 PLUS 14 additional commits from the 2026-05-22 grocery AI sprint. Total: **57 commits ahead of main**, ~980 files changed, +123k / −20k lines.

**The 14 unique-to-t0-clerk commits** (in chronological order, all from the grocery AI sprint marathon):
- `cccad74` feat(t0): wire Clerk JWT verify into ai-proxy worker
- `68dcb99` fix(ai-proxy): CORS preflight + bubble upstream error messages
- `e8cc69e` feat(T2): module-agnostic /route/:module endpoint + grocery dispatch wire
- `756359c` fix(grocery-routing): wire correct ai-proxy URL + auth token to dispatch
- `26a5055` fix(grocery-routing): AI result now MOVES items between shopping/pantry
- `184fcbb` tune(grocery): depletion + abbreviations + multi-line + ES/TR + quantity
- `c5c70de` feat(grocery-routing): SortedToast popup + integration hook + non-blocking dump input
- `c02db3a` feat(replenishment): adaptive per-user purchase cadence learning
- `7eee498` docs(feed-me): v2 spec — AI recipes + multi-suggest + diet + adaptive + pet feed
- `e1fdb5e` feat(grocery-v2): Feed Me v2 frontend — 3-card AI stack + diet/pet toggle + cook + reject
- `720a856` feat(feed-me): v2 backend + cook history endpoint
- `5b02d01` feat(grocery): list-mutation commands — remove/scratch/except/finished/throw-out
- `1d23e52` feat(grocery): undo stack + SortedToast variants — sprint closeout
- `755fdec` docs: sprint 2026-05-22 closeout runbook
- (1 docs commit `7d51aad`: add Repo Split Sprint section to ROADMAP)

**Decision (LOCKED 2026-05-28 by Serra)**: Option A — source branch is `feat/t0-clerk-jwt-verify`, single sprint of 15 PRs (PRs 1–9 from money-v2 + PRs 10–15 from grocery sprint).

Rationale: most token-efficient, cleanest (no mid-sprint rebase), no info lost between sprints.

(Option B kept here for history: source = `redesign/money-v2`, ship 9 PRs first, then 14-commit grocery follow-up. Rejected as less coherent.)

---

## Proposed grocery-sprint PRs (additions to the 9-PR plan if Option A)

These would slot in AFTER PR-9 (loose merges) since they depend on T1/T2 routing landing in PRs 1 + 11.

**PR-10 — T0 Clerk JWT verify (infrastructure)**
- `cccad74` wire Clerk JWT verify into ai-proxy worker
- `68dcb99` ai-proxy CORS preflight + error bubble
- Depends on: PR-1 (PII scrub) — no, actually independent
- Risk: Medium (auth migration, but ai-proxy-only scope)

**PR-11 — T2 module-agnostic routing endpoint**
- `e8cc69e` module-agnostic /route/:module endpoint + grocery dispatch wire
- Depends on: PR-1 (T1 routing_cache schema), PR-10 (Clerk JWT)
- Risk: Medium (new public worker endpoint)

**PR-12 — Grocery routing AI integration**
- `c5c70de` SortedToast popup + integration hook + non-blocking dump input
- `756359c` wire correct ai-proxy URL + auth token to dispatch
- `26a5055` AI result MOVES items between shopping/pantry
- `184fcbb` depletion + abbreviations + multi-line + ES/TR + quantity
- Depends on: PR-11 (T2 endpoint)
- Risk: Low (UI integration + tuning)

**PR-13 — Feed Me v2**
- `7eee498` v2 spec docs
- `720a856` v2 backend + cook history endpoint
- `e1fdb5e` v2 frontend — 3-card AI stack + diet/pet toggle + cook + reject
- Depends on: PR-5 (money-v2 redesign — for ADHD-friendly UI patterns?) — verify
- Risk: Medium (new AI feature, multi-component)

**PR-14 — Adaptive replenishment**
- `c02db3a` adaptive per-user purchase cadence learning
- Depends on: PR-12 (grocery integration)
- Risk: Medium (new learning logic, user-data-dependent)

**PR-15 — Grocery sprint closeout**
- `5b02d01` list-mutation commands — remove/scratch/except/finished/throw-out
- `1d23e52` undo stack + SortedToast variants — sprint closeout
- `755fdec` sprint closeout runbook docs
- Depends on: PR-12 + PR-13 + PR-14
- Risk: Low (polish + docs)

**Revised merge sequence** (Option A): PR-1 → PR-2 → PR-3 → (PR-4, PR-5, PR-6 parallel) → PR-7 → PR-8 → PR-9 → PR-10 → PR-11 → PR-12 → PR-13 → PR-14 → PR-15. Approx 2-3 weeks part-time.

---

## Branches this merge subsumes

**`recover-stranded-notifications`** — 24 commits ahead of main, but every single SHA is **also on `redesign/money-v2`** (shared history, not divergent work). The branch's original purpose (stranded flushNotificationQueue cron + day-30 prompt) shipped via PR #15 already. The 24 commits that followed are duplicates of money-v2 work.

**Action**: After PR-2 lands (notifications infra subset) and the rest of the money-v2 sprint completes, run `git branch --merged main` — `recover-stranded-notifications` should appear in the list. Delete then:
```
git branch -D recover-stranded-notifications
git push origin --delete recover-stranded-notifications
```

No separate merge needed. Skip the previous "Phase 3" plan step entirely.

---

## Flagged concerns

1. **Mega-commit `27ef92b`** (200+ files) — decide whether to keep monolithic in PR-8 or cherry-pick + re-split by package.

2. **Commit `4048b01` straddles body/work/goals** — work portion logically belongs with PR-4. Either cherry-pick by file or accept overlap.

3. **Commit `0b93a42` straddles Faz 2 finance + money-v2 logic** — same call as #2.

4. **No commits entangle routing infra with feature modules** — only PR-1 has T1 routing_cache schema, which is clean.

5. **Event-registry edits in PR-3** — single source of truth across multiple modules. Must be one PR.

6. **PR sequencing depends on team capacity** — if Serra is the only reviewer, sequential is the only path; parallel buckets (4–6) save calendar time only with a second reviewer.

---

## Pre-flight checklist (before opening PR-1)

- [ ] `redesign/money-v2` rebased on latest `main`
- [ ] All tests green on the source branch (`pnpm test` workspace-wide)
- [ ] Lint clean
- [ ] No uncommitted work on the source branch
- [ ] `backup/redesign-money-v2-pre-split` branch created as safety net
- [ ] PR-1 reviewer agreed (compliance review needed; this isn't a normal feature PR)

---

## What this plan does NOT cover

- The actual `git cherry-pick` mechanics (each PR is a separate branch + cherry-pick + force-push)
- Conflict resolution strategy if `main` advances during the sprint (likely: PR-1 lands, then rebase PR-2 on new main, etc.)
- CI cost — running CI 9 times for 9 PRs has real $ cost on the workers
- Beta-block status of each commit — some might be "must ship before 2026-07-20", some might not

These belong in a follow-up "execution plan" doc once PR-1 is on the way.
