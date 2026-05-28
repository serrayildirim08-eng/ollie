# ollie · verification audit · 2026-05-11

Third pass. Verifying commit `8403ecd` against prior audit findings.

---

## Executive summary

- **The honest ones landed.** Burhan now actually grows when you log a period. Dashboard stats show real numbers. Onboarding keys reach the dashboard. Garden no longer encodes decay. Notification double-schedule is gone. Sync tests are green. Cron retries. Migrations back up first. The cycle from C1–C5 + NC1, NC4, NC5, NC6, NC7-doc, NH2 is mostly real.
- **One claim is straight false.** NH9 commit message says "droop prop deleted." It is not. `BurhanTree.tsx:18, 108, 129, 480, 513` still has the decay primitive intact. The constitutional rule "Burhan never decays" survives only because no caller passes droop≠0. Same foot-gun as before.
- **C2 is wired, not used.** `bootAccount()` runs at startup and instantiates auth + sync + research-stream — but there's still no sign-in UI. No path in the app calls `auth.signIn()`. So sync still never attaches in practice. The 12 lines of plumbing in `account-boot.ts` are real; the user-visible outcome (encrypted multi-device sync) is unchanged.
- **NH3 introduced a new schema split.** Home TimeTracker writes `{ts, duration_ms}` to `work.focus_log`; WorkModule's own pomodoro timer writes `{at, duration_min}` to the same key. Dashboard + work orch read the home shape and ignore the work shape. WorkModule's `todaySessions` reads the work shape and ignores the home shape. New Pattern A regression — the chain is half-closed.
- **NH6 chain is broken.** "Remind me to cancel" button restored and emits `void:reminder:scheduled` into the bus. But nothing in the bus listens for that event to call `scheduler.add()`. Even if it did, the resulting `void:toast` event has no listener anywhere in `apps/web`. Button works as ritual; reminder never fires; toast never appears.
- **NC2 chain is half-real.** Sleep/cycle/work/finance/body orchestrators all emit the source events as promised. Router writes the reflect targets. But only `finance.protective_cards` and `finance.cycle_card_visible` have UI consumers. `body.protective_cards` (hyperfocus → fatigue), `shared.reduce_motion_today`, `admin.reflected`, `habits.surface_water_habit`, `body.suggest_rest_check` are still written into the void. 5 of 6 chains end with no surface.
- **C5 alerts no one.** Migration rollback works. The `__ollie_migration_failed` global flag is set. Nothing reads it. User sees the same thing they saw before: nothing. Audit M2 promise unfulfilled.
- **Onboarding test file still wrong.** `OnboardingScreen.test.ts:37-41` re-defines its own `commitAll` with the OLD flat keys, then asserts those. The production `commitAll` now writes dotted keys. Tests pass but no longer protect production from regressing back to the broken keys.

The fix wave is roughly 60% honest — better than the 50% baseline the credibility audit set. Below: line-by-line verdict.

---

## VERIFIED-FIXED

- **NC1 Burhan life-event tree.** `Burhan3D.tsx:19, 72, 106` now accepts `lifeEvents` prop, overlays SVG on 2D and 3D paths. `DashboardScreen.tsx:128, 282` reads `burhan.state` from store, passes last-12 events to mini Burhan. `GardenScreen.tsx:434, 602` does same for full-size. Chain: log period → cycle orch emits `cycle:period_logged` (`cycle.ts:98`) → burhan orch listens (`burhan.ts:39, 117`) → appends flower → store.set → React subscribes via `useStoreSlice` → flower renders. End-to-end.

- **NC4 Onboarding key alignment.** `OnboardingScreen.tsx:161, 167` writes `settings.has_pets` + `consent.spending_research` dotted keys. `DashboardScreen.tsx:127` reads `settings.has_pets`. `App.tsx:99` + `GardenConsentScreen.tsx:26` read `consent.spending_research`. All three converge on the same convention. "No pets" answer now actually hides the pets cluster.

- **NC5 Garden consent routes through grantConsent.** `GardenConsentScreen.tsx:32-37` calls `getAccount()?.research?.grantConsent()`, which triggers `ensureDeviceId()` (`research-stream/index.ts:212`) generating the device UUID. Falls back to raw store write if account boot hasn't completed. Constitutional API path honored.

- **NC6 Notification double-schedule fixed.** `notifications/src/index.ts:317-332` — if `backend.schedule()` returns a truthy `platformId`, the in-process JS timer is skipped. Web (no platformId) keeps the JS fallback. Capacitor/Electron now fires exactly once.

- **C1 Auth threat model honest.** `auth/src/index.ts:1-51` — top-of-file comment explicitly names Pattern B, calls out exactly what Supabase sees (passphrase in transit + audit logs), forbids the marketing claim "Supabase never sees your password," and documents the ~1-day Pattern A migration. No code change to flow; doc honesty fixed.

- **C3 Sync tests green.** `pnpm --filter @ollie/sync test` → 6 passed. The previously-red offline-queue test is fine now.

- **C4 Cron exponential backoff.** `apps/api/src/worker.ts:148, 259-278` — `MAX_ATTEMPTS=5`, transient failures push `fire_at` forward by `2^attempts` minutes, permanent failures (unknown job_type) flip to `failed`. Reschedule helper centralized.

- **C5 Migration pre-snapshot + rollback.** `store/src/migrations.ts:57-138` — every `void.state.*` key snapshotted to `void.state._backup.pre_migration.<ts>` before any migration runs. On failure: restore each key, do NOT bump meta version (so next boot retries). Old snapshots pruned to last 3. Test at `store.test.ts:168` verifies.

- **NC7 Cron docs.** `worker.ts:17-34` adds an Apple+wrangler-secrets+kv checklist. Code still requires `SCHEDULED_JOBS_ENABLED='1'` and a real KV namespace id, but at least the steps are listed now. (Worker is still not deployed.)

- **NH2 Dashboard stats real.** `DashboardScreen.tsx:132-151` derives `dueToday` from `admin.tasks` (todays open due), `billsSoon` from `finance.upcoming.daysUntil <= 7`, `tracked` from sum of today's `work.focus_log.duration_ms`. The stats bar is no longer "0 / 0 / 0m" by default.

- **NM2 Sync DEFAULT_MODULES includes medication.** `sync/src/index.ts:75` — `'medication'` now in the list.

- **NH7 + NH8 Garden decay removed.** `GardenScreen.tsx:13-23` — `GardenStats` is now `{ elementCount: number }`. No water, no health, no "thirsty" union arm. No water button. No `onWater?.()`. No water bar. Bottom card says "elements on the tree · N · +M this month" — purely additive.

- **Cycle/Sleep/Work/Finance/Body orchestrator emits.** Each source event for the cross-module router now has at least one production emit site:
  - `cycle:luteal_phase_entered` — `cycle.ts:69` on phase transition.
  - `sleep:short_sleep_run_detected` — `sleep.ts:237` when ≥3 nights ≤5h.
  - `sleep:pacing_breach_detected` — `sleep.ts:250` when debt ≥ 4h (24h cooldown).
  - `work:hyperfocus_detected` — `work.ts:101` when a focus session ≥180min.
  - `finance:spending_spike_detected` — `finance.ts:308` per new anomaly card.
  - `body:hydration_drop_detected` — `body.ts:106` when projected today ≥ 30% below 7-day baseline.

- **ProtectiveCards renders in finance.** `FinanceModule.tsx:394, 1732` — `<ProtectiveCards />` mounts, reads `finance.protective_cards` + `finance.cycle_card_visible` (both router reflect targets). The sleep→finance chain is end-to-end live.

---

## PARTIAL-FIX

- **C2 Account-boot wired but no UI to sign in.** `account-boot.ts` is real and `main.tsx:10` calls `bootAccount()` at startup. `@ollie/auth`, `@ollie/sync`, `@ollie/research-stream` all instantiate. But: `attachSync()` only runs after `auth:signed_in` fires (`account-boot.ts:96`). `auth.signIn()` is never called from anywhere in `apps/web/src` — there's still no sign-in screen. Sync attaches only if a session was previously stored AND unlocked, which means the encryption key has to be in memory, which requires a prior signIn call in the same browser session, which never happens.
  - Net effect: sync still never starts. The "shipped packages now boot" claim is technically true; "the user gets multi-device sync" is not.

- **NC2 cross-module chains: 1 of 6 has UI sink.**
  - sleep:short_sleep_run_detected → finance.protective_cards → renders in FinanceModule (LIVE).
  - cycle:luteal_phase_entered → finance.cycle_card_visible → renders in FinanceModule (LIVE).
  - work:hyperfocus_detected → body.protective_cards → no reader in BodyModule.
  - sleep:pacing_breach_detected → shared.reduce_motion_today → no reader in the app shell.
  - finance:reminder_set → admin.reflected → no reader in AdminModule.
  - body:hydration_drop_detected → habits:surface_water_habit (no reflect, only event re-emit, no listener).
  - finance:spending_spike_detected → body:suggest_rest_check (event-only, no body listener).
  - **Confirmed by grep:** no `useStoreSlice<...>('body', 'protective_cards', ...)`, no `'shared', 'reduce_motion_today'`, no `'admin', 'reflected'` calls anywhere in `apps/web/src`.

- **NH3 Time tracker writes happen; schema split breaks WorkModule view.** Home `TimeTracker` (`HomeScreen.tsx:65-70`) writes `{ ts, duration_ms, source: 'home-timer' }` to `work.focus_log`. Dashboard reads with that schema. Work orch hyperfocus detector reads with that schema (`work.ts:90`). **But** WorkModule's own pomodoro timer at `WorkModule.tsx:322-325` writes `{ at, duration_min }`. WorkModule's `todaySessions` (`WorkModule.tsx:350-356`) filters by `l?.at` — so home-tracker entries appear nowhere in the work module. Half-fix. The dashboard "tracked today" works; the work module's "today's sessions" still ignores anything from the home tracker.

- **C5 Migration rollback silent.** `migrations.ts:130` sets `globalThis.__ollie_migration_failed = true` on failure. No code in `apps/web/src` reads it. The user-visible "alert" promise is unmet. Snapshot + rollback are correct; surface is missing.

- **NH6 Reminder button button works, chain broken.** `FinanceModule.tsx:327-345` — the "remind me to cancel" label is restored. Click emits `void:reminder:scheduled` to the bus. **Nothing listens for `void:reminder:scheduled` to call `createReminderScheduler.add()`** — confirmed by grep: zero hits for `events.on('void:reminder:scheduled'` in production code. The scheduler only fires for reminders added via `scheduler.add()`. The bus-emitted reminder vanishes. And: `void:toast` (which the scheduler would emit on fire) has zero listeners in `apps/web/src` — no toast UI exists.

- **NH9 droop primitive NOT removed.** Claim is "droop prop deleted." Actual: `BurhanTree.tsx:18` still declares `droop?: number`; `:108` defaults it to 0; `:129` derives `desat`; `:513` applies `saturate(${1 - desat * 0.4}) brightness(${1 - desat * 0.12})` to the canvas. No caller passes droop≠0, but the gun is still loaded. Constitutional foot-gun unchanged.

---

## NOT-FIXED

- **NH9 droop prop on BurhanTree.** See PARTIAL above. Claim explicitly says deleted; code still has it. This is the only outright false claim in the commit message.

- **OnboardingScreen.test.ts schema drift.** Test file at `apps/web/src/pages/OnboardingScreen.test.ts:37, 41, 267` re-defines `commitAll` inside the test using the OLD flat keys (`has_pets`, `consent_spending_research`) and then asserts on `consent_spending_research`. Tests are GREEN but they are testing a parallel implementation of `commitAll` with the wrong schema. If someone reverts `OnboardingScreen.tsx` back to flat keys, the test will not catch it. NC4 production code is fixed; the test that protects it is fake.

---

## NEW REGRESSIONS

- **Schema split in `work.focus_log`.** Two writers, two shapes, two readers each looking at only their own shape. See PARTIAL · NH3. If unfixed: WorkModule will appear broken to anyone who tracked time on the home screen. Today: only 2 writers + 2 readers, easy to align by picking one shape and migrating the other.

- **`void:toast` is registered but has no listener.** The events registry adds it (`registry.ts:66`); `scheduler.ts:44` emits it on reminder fire; no React component subscribes. Every toast event becomes a console-noise no-op. Not a regression in behavior (no toasts existed before either), but a regression in the registry contract — the credibility audit's NH10 pattern (registered events with no emit OR no listener) just gained another example.

- **Garden has dead decay primitives.** `WaterDroplets` component (`GardenScreen.tsx:399-429`), `dropletFall` keyframe (line 61), `treeGlow` keyframe (line 65) all still defined. Not rendered anywhere. The garden decay primitives are "removed from the user-visible surface" but the code is still there to be re-wired by accident.

---

## STILL-HANGING

Findings from the two prior audits that this commit explicitly didn't claim — flagged here so they're not forgotten.

- **NH1** Home weather still hardcoded `"ISTANBUL · 14° · CLEAR"` (`HomeScreen.tsx`). No fix.
- **NH4** Cycle orchestrator writes 6 derived keys that nobody reads. The orchestrator emits `cycle:period_logged` now (NC1 fix uses this), but `cycle.prediction`, `cycle.healthFlags`, etc. still go nowhere. Architectural drift unchanged.
- **NH5** 11 of 14 logic modules in `apps/web/src/modules/*` still run detectors inline in `useMemo`. The doctrine call (orchestrator-owns-derived vs UI-derives-locally) was not made.
- **NH10** 90+ events still in the registry with no production emit OR no production listener. `void:toast` is now a fresh example (see NEW REGRESSIONS).
- **NH11** Savings digest still scheduled on boot without permission UX. Web pushes still silently no-op.
- **NH12** Voice→dump E2E test still missing. No `useApplyBrainDump.voice.test.ts`.
- **NM1** `@ollie/logic/prompts` still unimported, still has the allowlisted "haven't logged bed" framing.
- **NM3** `_eventLineage` debug surface still not built. With 1 of 6 chains alive (NC2 partial), lineage would now have some real rows.
- **NM4** Two ChipFlyHost mounts in `App.tsx`.
- **NM5** ChipFly origin-rect still uses viewport center fallback.
- **NM6** Overcast video still never plays.
- **NM10** Composed-string scanner blind spot unfixed.
- **NM11** Two `createReminderScheduler` instances still split (`apps/web/src/store.ts:115` + `apps/web/src/hooks/useApplyBrainDump.ts:24`).
- **L1–L11** All audit-1 LOW items unaddressed.
- **NL1–NL7** All audit-2 LOW items unaddressed.

Also worth flagging from this audit:

- **Sign-in / sign-up UI.** Without it, C2 is plumbing-without-tap. The biggest single piece blocking the entire "Sprint 2 fully usable" story.
- **Body/Admin/Habits/Shared UI surfaces for cross-module reflect targets.** The detectors emit; the router reflects; nothing renders. Until those four UI surfaces are built, ~83% of the cross-module chain feature remains user-invisible.

---

## Bottom line

This was a more honest fix wave than the prior two sprints. 11 of the 16 claims are real end-to-end. 4 are half-real (chain breaks before reaching the user). 1 is straight false (droop prop). One small new regression (focus_log schema split). The pattern from the credibility audit — "data flows, the user can't see it" — is reduced but not eliminated: NH3, NH6, C5, NC2 all still have the user-invisibility gap on the last step.

To get this to fully credible, three small follow-on commits would do it: (1) delete the `droop` prop from `BurhanTree`, (2) align `work.focus_log` schema across home + work writers, (3) add a `void:toast` listener and a `void:reminder:scheduled` → `scheduler.add()` bridge. Each is ≤30 lines. Together they close every gap created or left by `8403ecd`.

The bigger structural items — sign-in UI, cross-module reflect target consumers, NH4/NH5 derivation doctrine — remain the real story. Until they're touched, "the cross-protective chains work" is true for one of six chains and "the multi-device sync works" is true for zero of one.
