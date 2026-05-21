# Repo Split Sprint — Day 1 Report

**Date**: 2026-05-22
**Sprint**: Repo Split (Day 1 of 8, planned 2026-05-22 onwards)
**Author**: Backend senior pod
**Status**: Day 1 audit + first PR shipped. Day 2 needs 5 Serra decisions before continuing.

---

## TL;DR for Serra

1. **PR #18 opened (draft)** — `fix/sentry-orphan-modules` → `main`. Phantom-module dispatcher fix, 335/335 tests passing. Review when you have a `apps/web` Pages CI in place; merge is your call.
2. **PR for money-v2/toast/aiRoute Sentry fixes is NOT opened**. The files those fixes touch (`apps/web/src/modules/money-v2/`, `apps/web/src/router.tsx`, `apps/web/src/lib/aiRoute.ts`) don't exist on `main`. Those bug reports are against the redesign branch, not prod. Section §3.B.
3. **`PR #17` already open for `alpha-notifications-mobile` → main** (8 commits, 38 files, +2408/-196, sits cleanly on `main` HEAD). This is your "alpha prep" branch. Review it; it's essentially `recover-stranded-notifications` rebased clean.
4. **Deleted (Serra pre-approved yesterday)**: `garden-game-design` (exact duplicate of recover-stranded), `sprint-consolidated-2026-05-15` (worktree gone, archived 11 patches to `.git/branch-archive-2026-05-22/sprint-consolidated/`).
5. **5 branch decisions need you** — listed in §5.
6. **Stash cleanup proposal in §6** — 1 stash from yesterday (keep), 13 stashes from ≥7 days ago (export + drop).

---

## §1. Branch inventory (post-cleanup)

| Branch | Ahead/main | Behind/main | Origin state | Status |
|--------|-----------|-------------|-------------|--------|
| `main` | — | — | synced (`d10c6a6`) | source of truth |
| `feat/t0-clerk-jwt-verify` | 7 | 0 | pushed | T0 work, separate sprint |
| `alpha-notifications-mobile` | 8 | 0 | pushed | **PR #17 open**, ready to review |
| `chore/b3-infra-hygiene` | 29 | 2 | no origin | all 5 unique commits already in `redesign/money-v2` → **safe to delete** (Serra confirm) |
| `fix/dump-dispatch-phantom` | 36 | 2 | no origin | content extracted into PR #18 → **safe to delete after PR #18 merges** |
| `fix/money-and-react-dispatcher-sentry` | 38 | 2 | no origin | content stays here until redesign lands → **keep until redesign merges** |
| `garden-draco-assets` | 2 | 6 | ahead 1 | 2 legitimate commits (Draco compression + research orchestrator boot) → **needs PR or merge into redesign**, see §5 |
| `recover-stranded-notifications` | 24 | 2 | ahead 8 behind 3 | superset of alpha; alpha is the cleaner rebased version → **delete after PR #17 merges** |
| `redesign/money-v2` | 43 | 2 | ahead 1 | the 38-commit pile, source for topic splits → **stays alive through Day 2-8** |
| `fix/sentry-orphan-modules` | 2 | 0 | pushed | **PR #18 (draft) open** |
| `chore/split-day1-report` | 1 | 0 | (this branch) | this report; merge or rebase as you like |

---

## §2. PRs opened today

### PR #18 (NEW) — `fix/sentry-orphan-modules` → `main`
- **Link**: https://github.com/serrayildirim08-eng/ollie/pull/18
- **State**: Draft
- **Content**: Cherry-picked `02a3b0d` + `7d0fc4e` from `redesign/money-v2` (originally `fix/dump-dispatch-phantom`)
- **Tests**: 335/335 passing on `pnpm -F @ollie/orchestrator test --run`
- **Risk**: LOW. Isolated to dispatcher + tests. No schema/auth/migration.
- **Files**: 4 (dispatcher core, test, fallback-route, pets test fixture)
- **Merge gate**: needs your review + Pages CI for `apps/web` (Path A blocker).

### PR #17 (PRE-EXISTING) — `alpha-notifications-mobile` → `main`
- **Link**: https://github.com/serrayildirim08-eng/ollie/pull/17
- **State**: Open (not draft)
- **Content**: 8 commits — push notification permission row, quiet hours, iPhone responsive, BETA_INVITE_REQUIRED off, Epworth Sleepiness Scale, dead-surface cleanup, supabase migration relocation
- **Files**: 38 files, +2408/-196
- **Action**: Review when you can; this is the clean rebased alpha branch.

---

## §3. PRs NOT opened (and why)

### §3.A — Why no separate PR for `recover-stranded-notifications`
It's a longer-history version of the same 8 commits in `alpha-notifications-mobile` (different SHAs, same content via cherry-pick). Diff between `alpha` HEAD ↔ `recover` HEAD is **7 lines** (one pets test fixture). `alpha` is rebased onto current `main`; `recover` is not. **Use PR #17, drop `recover-*` after it merges.**

### §3.B — Why no PR for money-v2/toast/aiRoute Sentry fixes (`fix/money-and-react-dispatcher-sentry`)
This was the original plan. Killed during audit because the target files don't exist on `main`:

- `apps/web/src/modules/money-v2/selectors.ts` — **only on redesign branch**
- `apps/web/src/router.tsx` — **only on redesign branch**
- `apps/web/src/lib/aiRoute.ts` — **only on redesign branch** (commit `53a65a0` creates it from scratch there)
- `apps/web/src/components/ToastContext.test.tsx` — only on redesign branch

The Sentry crashes (`SF-115x`, `SF-1148`, `SF-1149`) are against builds of `redesign/money-v2`, not prod main. Cherry-picking these onto `main` would produce a non-compiling tree (referenced files missing).

**Action**: keep these commits parked on `fix/money-and-react-dispatcher-sentry` + `redesign/money-v2`. They become a normal Day 4-6 topic-split PR alongside the rest of the money-v2 redesign (see topic `money-v2-module` below).

---

## §4. Topic split plan (Day 2-8)

The 43-commit `redesign/money-v2` pile breaks into the following topics. Owner suggestions follow your `REPO_SPLIT_PROPOSAL.md` shape (junior = mechanical cherry-pick, senior = needs judgment, native = needs you-or-pod-discussion).

| # | Topic | Branch | Commits | Risk | Owner | Notes |
|---|-------|--------|---------|------|-------|-------|
| 1 | sentry-orphan-modules | `fix/sentry-orphan-modules` | `02a3b0d`, `7d0fc4e` | LOW | senior | **DONE — PR #18** |
| 2 | retention-bridge | `feat/retention-bridge` | `cbdd7f3`, `7d04d6b`, `f39335a` | LOW | junior | day-30 prompt + flushNotificationQueue + audit doc fix. All shared packages. |
| 3 | orphan-events-cleanup | `feat/orphan-events` | `538759d`, `eefd7f2`, `d0de2bf` | LOW | junior | A+C bucket wiring + dead-event removal |
| 4 | faz2-module-fixes | `feat/faz2-modules` | `4048b01`, `bb95d17`, `468eb06`, `9df6300`, `0b93a42` | MED | junior | body/work/goals/sleep/admin/pets/finance Faz 2. Touches many modules — needs careful test pass. |
| 5 | new-screens | `feat/new-screens` | `d5f0689` | LOW | junior | crisis, gallery, insights, voice screens |
| 6 | retention-server-fixes | `fix/retention-server` | `78346d8`, `91ced55`, `1710f63` | LOW | senior | retention bridge wire + APNs user_id + remove fake encryption UI |
| 7 | consent-source-consolidate | `refactor/consent-consolidate` | `fdc2a1f` | MED | senior | consent source + brain-dump dispatch unify. Auth-adjacent. |
| 8 | alpha-prep | `alpha-notifications-mobile` | 8 commits | LOW | junior | **PR #17 already open** — same 8 commits also live in redesign as `a1c9d16`/`6c32303`/`d81fa75`/`c573e8c`/`e9ffa5d`/`6ab6bb0`/`5a83621`/`68eedb9` |
| 9 | infra-hygiene | `chore/infra-hygiene` | `27ef92b`, `3c59332`, `47a6fa6`, `bc058f4`, `29e963c` | MED | senior | 8-agent audit fixes + Plaid removal + audit gaps + checkpoint + logic helpers consolidate. **The Plaid removal is a product decision already locked — no DB drop, just dead code.** |
| 10 | work-vision-phase1 | `feat/work-matters` | `9ed51e5`, `a16bfbc` | MED | senior | matter container + dump→matter routing + onboarding age input |
| 11 | desktop-shell | `feat/desktop-shell` | `b6b15e4`, `9809a52`, `6aebf17` | **HIGH** | native (you) | Clerk auth migration + v2-shell + desktop thin-spine + on-device Apple Intelligence routing. Auth migration alone needs careful supervision. |
| 12 | money-v2-module | `feat/money-v2` | `a477c90`, `4edc592`, `af2d346`, `53a65a0` + the whole `redesign/money-v2` add-modules diff | **HIGH** | native (you) | The actual money-v2 module + the 4 Sentry fixes (§3.B). This is the biggest topic — pull the whole module add as one PR, then squash the Sentry fixes inline. |
| 13 | T1-routing-cache | `feat/routing-cache` | `e7fe7bf` | MED | senior | routing_cache migration + PII-scrub expansion + brand allowlist. **Has a migration — never delegate.** |

**Sequencing recommendation**:
- **Day 2**: Topics 2, 3, 5 (juniors, mechanical, LOW risk)
- **Day 3**: Topics 4, 6 (mixed)
- **Day 4**: Topics 7, 9 (senior, MED)
- **Day 5-6**: Topics 10, 13 (senior, MED+migration)
- **Day 7-8**: Topics 11, 12 (you, HIGH — auth migration + money-v2 module)

---

## §5. Branch decisions you need to make (Day 2 first action)

Each is one sentence; answer "keep / archive / delete" plus one liner:

1. **`recover-stranded-notifications`** — delete after PR #17 merges? (it's already obsoleted by `alpha-notifications-mobile`)
2. **`chore/b3-infra-hygiene`** — delete local now? (all 5 commits already in `redesign/money-v2`; will resurface as topic #9)
3. **`garden-draco-assets`** — PR to `main` as standalone (Draco-compressed glb assets + research orchestrator boot are both prod-relevant)? Or merge into `redesign/money-v2` first?
4. **`fix/dump-dispatch-phantom`** — delete after PR #18 merges? (content already extracted)
5. **`fix/money-and-react-dispatcher-sentry`** — keep until the money-v2 redesign lands (topic #12), then delete? Or rebase + park now under `redesign/money-v2`'s history?
6. **`feat/t0-clerk-jwt-verify`** — separate sprint as flagged; ignored from split plan. Confirm.

---

## §6. Stash cleanup proposal

13 stashes total. Recommended action:

| stash | Age | Branch | Topic | Action |
|-------|-----|--------|-------|--------|
| `stash@{0}` | 1 day | `fix/usetoast-provider-sentry` | iOS app icon WIP | **KEEP** — yesterday's work, may still be live |
| `stash@{1}` | 7 days | `garden-draco-assets` | orchestrator goals/habits WIP | export + drop |
| `stash@{2}` | 8 days | `sprint-b-prime-consent-pipeline` | cycle pill WIP | export + drop |
| `stash@{3}` | 8 days | `sprint-b-double-prime-research-emits` | settings + dispatcher WIP | export + drop |
| `stash@{4}` | 8 days | same | iOS Info.plist FF WIP | export + drop |
| `stash@{5}` | 8 days | same | App.tsx + dispatcher WIP | export + drop |
| `stash@{6}` | 8 days | same | pre-pull stash | export + drop |
| `stash@{7}` | 8 days | same | marketing-fix snapshot | export + drop |
| `stash@{8}` | 8 days | `main` | ModuleScreen events test + ai-proxy WIP | export + drop |
| `stash@{9}` | 8 days | `sprint-b-prime-consent-pipeline` | invite.ts WIP | export + drop |
| `stash@{10}` | 8 days | same | DEPLOY_TODO + AuthFlow WIP | export + drop |
| `stash@{11}` | 8 days | `post-merge-cleanup` | i18n + App.tsx | export + drop |
| `stash@{12}` | 8 days | same | events registry pre-filter | export + drop |
| `stash@{13}` | 8 days | same | events registry full | export + drop |

**Proposed mechanism**:
```bash
mkdir -p /Users/serrayildirim/ollie/.git/stashes-archived-2026-05-22
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13; do
  git stash show -p "stash@{$i}" > /Users/serrayildirim/ollie/.git/stashes-archived-2026-05-22/stash-$i.patch
done
# then: git stash drop stash@{13} stash@{12} ... (drop in reverse order)
```

**Hold for Serra approval** before executing.

---

## §7. Deletions executed today (Serra pre-approved 2026-05-21)

- `garden-game-design` — **DELETED** local. HEAD `a1c9d16` was exact duplicate of `recover-stranded-notifications` HEAD. Zero unique commits.
- `sprint-consolidated-2026-05-15` — **DELETED** local + worktree (`.claude/worktrees/agent-ada765115988f5181/`). 11 unique commits **archived as patches** to `.git/branch-archive-2026-05-22/sprint-consolidated/` before deletion.

**Origin deletion (`git push origin --delete`) NOT performed** — only local cleanup, awaiting your explicit approval before touching origin.

---

## §8. Permissions hygiene (Day 1)

- No production deploy attempted.
- No force-push.
- No `git reset --hard` on any branch.
- Only origin push: the new branch `fix/sentry-orphan-modules` for PR #18.
- Local deletions: only the two pre-approved branches.
- All deleted branches archived to `.git/branch-archive-2026-05-22/` before drop where they contained unique commits.

---

## §9. Day 2 first-action queue

In order:
1. Serra answers the 6 questions in §5 (≤ 5 minutes).
2. Serra approves stash archive+drop plan in §6.
3. Pod starts Day 2 topics: 2, 3, 5 (junior cherry-picks, LOW risk).
4. Senior reviews and pushes those 3 PRs (draft, like PR #18) by EOD Day 2.
5. PR #17 + #18 merge gate: Pages CI for `apps/web` (Path A blocker — separate task).
