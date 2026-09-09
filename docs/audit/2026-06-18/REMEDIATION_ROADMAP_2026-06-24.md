# Deep Audit Remediation — Roadmap (2026-06-24)

Source audit: `docs/audit/2026-06-18/FINAL_AUDIT.md` + `fix-plan.json` (181 findings).
Verified status as of 2026-06-24 (evidence: git commit-message scan + working-tree inspection).

## Where we are (verified, not from memory)

- **~42 findings FIXED** — confirmed by finding-id (`#NN`) in commit messages on `feat/outside-shell-phase-a`; last audit commit `15fc8de` (2026-06-19 01:58).
- **108 findings REMAIN** — 89 code-fixable (42 assisted + 47 auto), 19 Serra-only.
- **Not stranded:** audit fixes are present on the active branch `redesign/olive-neumorphic` (`15fc8de` is an ancestor of HEAD).
- The autonomous `/loop` was **PAUSED at iter 9** for TestFlight triage. TestFlight is now resolved (cable install). Loop can resume — but see collision analysis below first.

## ⚠️ Collision with the live redesign session (the key constraint)

A parallel session is doing the **olive-neumorphic / Rooms redesign**. Evidence (`git diff 15fc8de..HEAD` + `git status`):

- The redesign already rewrote **nearly every module UI file** (`modules/*/Box.tsx`, brain, navigation, `theme/tokens.ts`, `layout/Box.tsx`) and parts of the backend (`orchestrator/{admin,chores,sleep,cadence-scanner,index}.ts`, `ai-proxy/router/dump-classify`, `router/schema.ts`).
- **Right now (uncommitted):** Health Room build — `cycle/*`, `medication/*`, `mood/*`, `navigation/Router.tsx`, new `rooms/HealthRoom.tsx`. ~24 dirty files.

**Implication:**
1. **Physical:** both sessions share the `~/ollie` working tree. Any edit/commit I make there can disrupt the live uncommitted work. → All automated fix work MUST run in a **separate git worktree / branch**, never in `~/ollie` directly.
2. **Logical:** the audit's **design-system cleanup** findings touch the exact files being redesigned. Fixing pre-redesign code = merge-conflict hell AND wasted effort (the code is being rewritten anyway). → **Defer all UI/design-system findings until the redesign lands**, then re-audit the new UI.

## Three lanes

### Lane A — COLD ZONE (safe now, no collision) — automatable
Backend/logic/worker files the redesign is **not** touching. Run in an isolated worktree off current HEAD; disjoint files → clean merge later.

| # | Finding (plain) | Files |
|---|---|---|
| #78 | Sync LWW: fast device clock always wins → lost updates | packages/sync |
| #77 | Crisis raw text leaks to client despite zero-storage rule | packages/crisis |
| #166 | Crisis exclusion guard over-suppresses real tier-1 matches | packages/crisis |
| #171 | PII scrub leaks 4-digit codes/PINs as "a year" | packages/research-stream |
| #85 | Invite endpoints trust client user-hash → attribution poisoning | api/auth |
| #155 | ingest-event forwards arbitrary keys to Supabase REST | workers/api-proxy |
| #19 | apns-push hand-rolls ES256 instead of @ollie/apns-jwt | workers/apns-push |
| #20 | apns-push KV rate-limit non-atomic (5/s not enforced) | workers/apns-push |
| #175 | Dead SUPABASE_SERVICE_ROLE_KEY env var in cron | workers/cron |
| #48 | notify arms unbounded setTimeout (>24.8d fires instantly) | packages/orchestrator/notify |
| #71 | finance/body bare setTimeout: long timers lost on quit | packages/orchestrator |
| #161 | flush retries permanent token failures (410) forever | packages/orchestrator/notify |
| #8 | Work/goals time-windowed cues never fire on a timer | packages/orchestrator/{work,goals} |
| #69 | goals.ensure() bypasses active-goal cap | packages/orchestrator/goals |
| #96 | scanCues dedup ignored on system-notify path → re-fire | packages/orchestrator/{work,goals} |
| #139 | habit-rebirth counts cadence gaps as restarts | packages/logic/habits |
| #143 | savings-transfer auto_apply without keyword corroboration | packages/logic/finance |
| #106 | body change-point cold-start window + pooledSd guard | packages/logic/body |

**Done-definition (Lane A):** each finding has a focused diff; full suite green (`typecheck + lint 0-err + test TZ=UTC`); lands on branch `audit/cold-zone-2026-06-24`; I review every diff before it counts as done; Serra merges.

### Lane B — UI / DESIGN-SYSTEM (BLOCKED until redesign lands)
`#17` RemoveButton dedup · `#32` raw button/input · `#59` SMCP small-caps · `#60` Box god-files · `#176` raw fontSize/fontFamily · `#180` inline flex vs layout primitives · `#179` GroceryNow hardcoded hex. Plus the `cycle`/`medication`/`mood`/`dump`/`tauri-conf` findings (`#72 #51 #142 #105 #98 #87 #89 #90 #128 #54 #132 #103`) that sit in the live hot zone.
**Action:** do nothing now. After the redesign branch merges, run a fresh UI-layer audit (the new code is itself unaudited) and sweep design-system debt against the final code.

### Lane C — SERRA-ONLY (decisions + prod access)
- **#22 identity (CRITICAL):** apply `20260618000002_identity_clerk_text.sql` to prod. Unblocks #67/#68/#75/#109/#112/#113/#63. Without it, real users' reminders + finance sync + push silently fail.
- **#24 routing cache:** apply `20260618000003_routing_cache_revive.sql` (+ revives #9/#75).
- **#102/#114:** apply `20260618000004_security_invoker...sql`; **force-RLS:** `20260618000001...sql`.
- After identity migration is live: I write **#67** (native supabase-js Clerk JWT wiring).
- Product decisions: #29 grocery qty (string vs number), #66 /brain-copy (own template vs remove), #26 mood payload shape, #128 dump-dismiss behavior, #55 App Group PII scope, #101 KV vs Queues.
- Larger tracks: #30/#108 at-rest field encryption (3A), #73 multi-device crypto (4B).
- Won't-fix: #62 research-stream (decision 6).

## Sequence
1. **Now:** run Lane A in isolated worktree (no collision). Parallel to redesign.
2. **Serra, when ready:** apply the 4 migrations (Lane C) → I wire #67.
3. **After redesign merges:** re-audit UI, then Lane B sweep.
4. Product decisions (Lane C) handled one at a time, not as a batch.
