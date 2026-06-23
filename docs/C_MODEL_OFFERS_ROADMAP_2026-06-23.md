# C-model watcher offers — roadmap (2026-06-23)

**Decision (Serra):** Layer-2 watchers follow **model C** — *notice + one-line OFFER + accept-to-act*. The watcher surfaces a pattern with a single calm offer; only on the user's **accept** does it touch other modules. Decision always stays with the user. (Not passive-only A, not silent-auto D. "Just teach" B is allowed for low-stakes patterns.)

## Existing framework (extend, don't rebuild)
- `packages/logic/src/brain/actions.ts` — `ActionKind` / `ActionPayload` / `NoticingAction` (serialisable descriptor: kind + localised `label` + payload). Today only `add_to_grocery_list`.
- `packages/logic/src/brain/copy.ts` — `CopyActionKind` + `ACTION_DESCRIPTION` phrase the offer ("want it back on the list?").
- `apps/native/src/modules/brain/actions.ts` — `executeAction(action)` dispatcher → real side effect (today: grocery `shopping.add`). Returns success so the noticing clears only on success.
- Selection/surfacing engine: `packages/logic/src/brain/{select,deferral,harm,learn,capacity}.ts` + native `modules/brain/noticings.ts` (`selectTodaysNoticings`) + `TodayNoticings.tsx` (renders, accept runs `executeAction`).

**To add an offer:** (1) new `ActionKind` + payload in pure actions.ts; (2) `ACTION_DESCRIPTION` phrasing in copy.ts; (3) the detector attaches the action to its noticing; (4) a `case` in native executeAction performing the real effect.

## First wave (4 — Serra-selected)
1. **sleep_debt → defer_tasks (C, cross-module, highest value).** Detector: `computeSleepDebt` (packages/logic/src/sleep/stats.ts). Offer: "3 hours of sleep debt has piled up — keep today lighter?" Accept → executeAction defers non-urgent work/admin tasks (move dueDate → tomorrow). Open: definition of "non-urgent" (use deferral.ts deferability + harm.ts).
2. **admin_renewal → add reminder/task (C).** Detector: renewal approaching (admin renewals repo). Offer: "passport expires in ~3 months — add it to your to-do?" Accept → create an admin task (admin tasks repo) so it surfaces in /todo.
3. **admin_pending_decision → surface (C).** Detector: a recurring_decision open > ~14 days. Offer: "the gym cancel/keep decision's been open 2 weeks — bring it to today?" Accept → bump/surface it in /todo.
4. **caffeine_cutoff → insight only (B).** Detector: `detectCaffeineCutoff` (packages/logic/src/sleep/patterns.ts, already exists). NO offer — just the insight line ("late caffeine delays your sleep ~30 min").

## Done-definition (each offer)
- Detector produces a noticing with the right offer (or just insight for #4).
- Native `executeAction` performs the real cross-module side effect; noticing clears on success.
- Copy is calm, one sentence, trilingual (EN/ES/TR) where the framework requires.
- `pnpm build` (tsc+vite) green + `pnpm test` green; no regressions.
- Verified on device: trigger the pattern → see offer → accept → the action really happened.

## Wave 2 — richer admin (Serra, 2026-06-23, AFTER wave 1 lands)
**Renewal = 3-tier escalation** (replaces wave-1 single offer). For each renewal with an expiry date:
- **~3 months out** → calm heads-up noticing (card only, no push). [A/B]
- **~1 month out** → a real **local notification** (the app-closed reminder system — objc2 UNUserNotificationCenter, see RELEASE/iphone-dev memories). New executeAction kind e.g. `schedule_reminder` (or auto-scheduled at this tier). [C/notify]
- **~1 week out** → **auto-add to /todo** (no offer — automatic, the one place we go D, because a 1-week-out legal/ID renewal is too important to wait on a tap). [D, with go-dark respect]

**3 new admin patterns (offers, model C):**
- **Paperwork piling:** ≥3 admin tasks untouched ~2 weeks → "3 admin things haven't moved in 2 weeks — bring them to today's focus?" → accept surfaces them in /todo (reuse surface logic).
- **Chronic deferral:** same admin task deferred ≥4× → "you've put this off 4 times — want to break it into a smaller first step?" → accept = break_down action (new kind; smallest-next-step, like goals AI step breakdown).
- **Renewal cluster:** 2+ renewals in the same month → "two renewals land next month — batch them one Saturday?" → accept schedules a batch block.

(Wave 2 reuses the wave-1 framework; adds action kinds: schedule_reminder, break_down_task, batch_block; needs the renewal escalation tiers + 3 detectors. Build as a second workflow after wave 1 verifies.)

## Open questions (decide during build)
- "non-urgent" task selection for defer (lean on deferral.ts/harm.ts, don't reinvent).
- reminder = admin task row vs scheduled local notification (start with task row → shows in /todo).
- where caffeine intake data comes from for #4 (confirm the detector's existing inputs).
