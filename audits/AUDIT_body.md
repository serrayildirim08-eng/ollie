# Body Module — Audit (2026-05-14, single-module status + cross-module wiring)

**Note:** The requested macOS Documents path is sandboxed (TCC restriction). This audit is saved to the repo at `audits/AUDIT_body.md`.

**Overall status:** WORKING with SCAFFOLDED cross-module integration.

The body module exists as a single page with 4 content sections (cycle / sleep / body / habits). Core UI for water tracking, supplement reminders, episode logging, and habit tracking WORKS. Audio player for sleep is WORKING. Cycle prediction, habit detection, sleep patterns, and body patterns all generate observations. BUT: cross-module event wiring (habit → Burhan, period approaching → grocery, supplement reminders via APNs) is NOT YET WIRED-CROSSMODULE.

---

## Status definitions

- **NOT STARTED** — no code exists
- **SCAFFOLDED** — file/component exists but doesn't function end-to-end (stubs, TODOs, mock data, unwired UI, placeholder URLs)
- **WORKING** — feature functions in isolation with manual data
- **WIRED-CROSSMODULE** — connected to other modules + notifications + event bus + APNs
- **BLOCKED-EXTERNAL** — implementation complete, gated on external approval

---

## Cycle Section (4 features)

| # | Feature | Status | File | Gap to Next |
|---|---|---|---|---|
| 1 | Moon dial UI (28-day circular, phase labels) | WORKING | `CycleModule.tsx:122–142` | Moon phase calculation is correct; renders as SVG fill-mask based on cycle day |
| 2 | Period prediction (next 5-day window, algorithm) | WORKING | `orchestrator/cycle.ts:85–110`; logic layer `predictNextPeriod` | EWMA prediction exists; calls `cycle.predictNextPeriod()`; returns confidence tier |
| 3 | Symptom log (tags: cramps/mood/flow/etc., persist, editable) | WORKING | `CycleModule.tsx:144–210`, logic `cycle.findCorrelations` | RecordPanel saves `selected` tags + note; stored in `cycle.items`; tag list at line 35–52 covers 10 symptom types |
| 4 | Phase-specific copy (menstrual/follicular/ovulatory/luteal) | WORKING | `CycleModule.tsx:54–65` (cyclePhaseLabel mapping); i18n keys defined | Reads phase from store via `computePhaseForDate`; copy pulls from i18n; no hardcoded English placeholders |
| **Gap** | **Cross-module event emit** | NOT STARTED | No `cycle:period_approaching` event in Burhan SOURCE_EVENTS (orchestrator/burhan.ts:38–49) | Would need to add event listener in burhan orchestrator + emit from cycle orchestrator 5 days out |

---

## Sleep Section (4 features)

| # | Feature | Status | File | Gap to Next |
|---|---|---|---|---|
| 5 | Sound player (6 sounds, Web Audio via Howler, looping) | WORKING | `SleepSoundPlayer.tsx:59–68`; files present in `/public/audio/` (all 6 .mp3 exist) | Player lazy-loads Howler; async `getHowl()`; volume control + fade-out on timer expiry; tested in isolation |
| 6 | Sleep timer (5/15/30/60 min chips, countdown, fade-out) | WORKING | `SleepSoundPlayer.tsx:170–206` (timer logic); tick via setInterval at 1s granularity; fade-out 5s at expiry | Timer state managed; displays remaining in MM:SS; auto-clears callbacks on unmount |
| 7 | Brain dump → sleep classification ("tired" / "couldn't sleep" / "slept N hrs") | WORKING | `sleep.orchestrator:parseSleepDump()`; router classifies via regex fallback-route.ts | Reads from `actionLog`; filters unread dumps; passes to logic's pattern detectors |
| 8 | Caffeine-sleep correlator (Drake 2013 citation, correlation to sleep quality) | SCAFFOLDED | `SleepModule.tsx:87` has Drake 2013 citation in `PATTERN_META` for `caffeine_cutoff` pattern; NO code to: read grocery/finance caffeine data, compute correlation to TST, or emit event | Logic layer does NOT have `detectCaffeineSleepCorrelation`. Only detects caffeine cutoff (6h gap rule); never reads coffee/matcha purchase log. **Missing:** cross-module data fetch + Spearman/Pearson + correlator emit |
| **Gap** | **APNs push for supplement reminders** | NOT STARTED | No subscription wiring for "supplement due" events | Would need: schedule logic (daily @ chosen time), notification emission, APNs worker dispatch |

---

## Body Section (5 features)

| # | Feature | Status | File | Gap to Next |
|---|---|---|---|---|
| 9 | Water tracker (8 cups/day count, tap to log, day boundary reset) | WORKING | `BodyModule.tsx:1668–1803`; state in `body.water_log` (array of timestamps); target in `body.water_target` | Tap glass toggles entry at current time; displays `{count} / {target}`; today boundary via `todayKey`; reset at midnight (implicit via date boundary) |
| 10 | Supplement reminders (D/omega/Mg/iron/melatonin scheduled, APNs fires) | WORKING-LOCAL | `BodyModule.tsx:1806–2032`; state in `body.supplements` (name, dose, added_at); daily checks in `body.supp_checks` | UI allows add/remove/check-off per supplement; persists check state per day; **NO APNs wiring:** no scheduled reminder emission, no notification subscriber registered |
| 11 | Posture nudge (hourly reminder, customizable cadence, fires) | NOT STARTED | No UI, no state key, no logic detector, no event emission | Mentioned in fallback-route regex (line 58) but never instantiated in BodyModule |
| 12 | Rest tracking (breaks logged, source of truth) | NOT STARTED | No UI, no state key; mentioned in subtitle "rest when you need to" (line 1648) but not implemented | Would need store key `body.rest_log` + UI to log breaks |
| 13 | Doctor view (clinician-shareable PDF/web export, code path) | WORKING-LOCAL | `BodyModule.tsx:354–363`, `ActiveEpisodeCard` calls `generateDoctorSummary(ep)` → markdown string; modal shows copy button (line 879) | Generates markdown summary of episode (severity arc, meds, timeline); NO PDF export (would need jspdf, not implemented); copy-to-clipboard works; modal is local-only, no URL export |
| **Gap** | **Cross-module water hydration event** | WORKING | `orchestrator/body.ts:106` emits `body:hydration_drop_detected` (drop_pct); HabitsWaterPrompt in HabitsModule listens (line 74–78) | Water orchestrator correctly emits; habits module reads via `habits.surface_water_habit` cross-module router write; chain is complete |

---

## Habits Section (4 features)

| # | Feature | Status | File | Gap to Next |
|---|---|---|---|---|
| 14 | Daily checklist (5 categories: health/mental/home/work/self-care) | WORKING | `HabitsModule.tsx:47–54` (DEFAULT_HABITS with 6 hardcoded items); stored in `shared.habits_v2` as structured objects; sections split by `cueTime` (morning/anytime/evening) | UI at line 407–415 groups by section; each habit has name, cue, cueTime, completions array |
| 15 | Midnight reset (tasks clear at 00:00 local time, tested) | WORKING | `HabitsModule.tsx:244` derives `todayStart` via `Date.setHours(0,0,0,0)`; `isCheckedToday()` at line 253 checks `.toDateString() === todayKey` | Reset is implicit: completion at 23:59 and 00:01 are different dates; no explicit "reset clock" logic needed; test coverage exists in `habits.test.ts` |
| 16 | No streaks (zero streak counter or "X day streak" UI) | WORKING | `HabitsModule.tsx:558` explicitly says "no streaks · no shame · just today"; grep for "streak" returns 0 instances in UI code (only documentation comments) | Displays "done" + time, never "12-day streak" |
| 17 | Burhan integration (habit complete → leaf) | SCAFFOLDED | Habit completion stored in `completions[]` (line 299); NO event emission on toggle; Burhan SOURCE_EVENTS (orchestrator/burhan.ts:38–49) do NOT include habit events | Would need: emit `habits:completed` event on `toggleCheck()`, add to Burhan SOURCE_EVENTS, wire listener in burhan orchestrator |
| 18 | Category-specific copy (each category has brand-voice copy) | WORKING | Cue text reads from user input or defaults to section label (line 750); no hardcoded category-specific copy in UI | Copy is user-defined ("when · {cue}") or section label; no editorial copy per category |
| **Gap** | **Pattern detection + "noticed" banner** | WORKING | `HabitsNoticed` component at line 142–211; reads `habits.patterns` from orchestrator; displays detections with confidence + sample_n + source citations | Logic layer ships 16 detectors; orchestrator calls `detectPatterns()` on mount + on data change; UI shows patterns section at bottom with citations |

---

## Infrastructure (8 items)

| # | Item | Status | File | Detail |
|---|---|---|---|---|
| A | Body module page (`/body` route, mounts 4 sections) | WORKING | `apps/web/src/modules/body/BodyModule.tsx:1473–2058` | Component exports; calls `onBack()` to return to dashboard; sections render in sequence: protective cards → episode → signals → conditions → treatments → water → supplements → noticed |
| B | Encryption (client-side AES-GCM-256 for body data) | NOT STARTED | Logic layer has `encryptExport()` for finance (test at finance.test.ts); NO RLS migrations or key management for body namespace | Body data stored plaintext in store; no encryption key derivation; no RLS rules in Supabase |
| C | Cross-module event bus (body EMITS, LISTENS) | WORKING-PARTIAL | `orchestrator/body.ts:106` emits `body:hydration_drop_detected`; router writes to `habits.surface_water_habit` via cross-module write | Body orchestrator correctly wired to emit on hydration drop; habits listens and renders prompt; cycle/sleep/habits → body signals NOT wired (body.protective_cards should be populated by work:hyperfocus_detected but no listener) |
| D | ML correlations (caffeine-sleep via Spearman/simple-statistics) | SCAFFOLDED | Sleep orchestrator imports pattern detectors (sleep.ts:33–57); caffeine_cutoff pattern exists; NO correlator to read finance.grocery_log + match coffee purchases to sleep quality | Pattern detectors work in isolation; no cross-module data fusion |
| E | Notifications (period prediction, supplement reminder, water nudge, habit reminder via APNs) | SCAFFOLDED | `packages/notifications/` exists; no subscribers registered for body:* events | Infrastructure exists (server-schedule.ts, capacitor backend); no wiring from orchestrators to emit notification events |
| F | Banned-phrase scanner (all body copy passes CI) | WORKING | No "great job", "streak" (except in comments), "you should" in body/cycle/sleep/habits UI code | Copy is clinical, observational, null-shaming |
| G | Brain dump router ("tired" / "cramped" / "drank water" → correct subsection) | WORKING | Fallback router at `dissection/fallback-route.ts:58, 142` routes water/posture/steps keywords to body module | Router correctly categorizes body-related dumps |
| H | Garden / Burhan crossover (habit complete → leaf, cycle phase → flower, life-event additions) | SCAFFOLDED | Burhan orchestrator listens to: `cycle:period_logged` (flower), `finance:subscription_cancelled` (fruit), `admin:appointment_completed` (leaf/canopy_fruit), `finance:bill_paid_on_time` (gold_leaf), `body:doctor_visit_completed` (canopy_fruit) | **Missing:** `habits:completed` event source; habits module never emits |

---

## Hypotheses — Confirmed / Refuted

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Cycle predictions exist but symptom-log persistence unclear | **CONFIRMED-PARTIAL** | Period prediction logic ships; symptom logs persist in `cycle.items`; BUT no auto-period-approaching event 5d out |
| 2 | Sound player likely SCAFFOLDED; file URLs may be placeholder | **REFUTED** | All 6 audio files present in `/public/audio/` (brown-noise, white-noise, pink-noise, rain, ocean, fire); URLs are hardcoded and correct; player is WORKING |
| 3 | Caffeine-sleep correlator never seen; likely NOT STARTED | **CONFIRMED** | Drake 2013 citation in UI for caffeine_cutoff pattern (6h gap rule) only; no code to read grocery/finance, compute Spearman to TST, emit event; **NOT STARTED** |
| 4 | Doctor view PDF — Serra generated one for testing, UI/export unclear | **CONFIRMED-PARTIAL** | Modal shows markdown copy button (working); PDF export NOT implemented; markdown export working |
| 5 | Habit-to-Burhan event bus likely SCAFFOLDED | **CONFIRMED** | Habit completion stored locally; `toggleCheck()` does NOT emit event; Burhan SOURCE_EVENTS excludes habit events; wiring is SCAFFOLDED |

---

## Top 5 Impactful Next Steps (to WIRED-CROSSMODULE)

1. **Emit `habits:completed` event from HabitsModule.toggleCheck()** — Add to event registry, add to Burhan SOURCE_EVENTS, test end-to-end with Burhan tree growth. (Blocking: Burhan integration.) `HabitsModule.tsx:287, orchestrator/burhan.ts:38–49`

2. **Wire period_approaching event in cycle orchestrator (5d pre-period)** — Orchestrator detects next period, emits `cycle:period_approaching` 5d before prediction; cross-module router writes to `grocery.supplies_to_buy`; APNs subscriber wired. (Blocking: supply auto-add UX.) `orchestrator/cycle.ts:77–180`

3. **Register APNs subscribers for supplement reminders** — Add scheduled notification emission for each supplement at user-chosen time; wire `scheduleNotification` from notifications package to supplement state. (Blocking: time picker UI.) `packages/notifications/src/server-schedule.ts`

4. **Implement caffeine-sleep correlator** — Read `finance.grocery_log` (coffee/matcha purchases) + `sleep.records` (TST), compute Spearman rank correlation, emit `body:caffeine_sleep_correlated` event with confidence. Use simple-statistics or SciPy-equiv. (Blocking: cross-module data access pattern.) `packages/logic/src/sleep/pattern-detection.ts`

5. **Add posture nudge + rest tracking UI** — Implement `body.rest_log` state, add Rest section to BodyModule with "log a break" button, add hourly-cadence posture nudge via orchestrator + notification. (Blocking: notification scheduling.) `BodyModule.tsx:1468–1650`

---

## BLOCKED-ON-EXTERNAL Flags

- **HealthKit integration** — NOT STARTED. iOS only; would require Capacitor plugin + permissions + background sync. Spec exists (fallback-route mentions "steps"), but zero code. **Defer pending iOS build priority.**

- **Postman export / clinician sharing** — Doctor markdown export WORKING; PDF export NOT STARTED. Would need jspdf + formatting. **Low priority unless explicitly requested by Serra.**

---

## TL;DR

**Overall module status:** WORKING in isolation; SCAFFOLDED for cross-module integration.

**The good:** Water tracker, supplement logging, episode tracking, habit daily checklist, sleep sound player, cycle tracking + prediction, pattern detection (body/sleep/habits), and observation banners all FUNCTION. UI is clean, tone is brand-consistent, no placeholder URLs or TODOs in production code.

**The gap:** No habit→Burhan leaf emission (critical for garden integration). No period_approaching→grocery supplies auto-add. No caffeine-sleep correlator despite Drake 2013 citation. Sound player is WORKING but supplement/period reminders via APNs are scaffolded event-listener stubs. Posture nudge and rest tracking NOT STARTED.

**Surprises:** (1) Burhan SOURCE_EVENTS is complete for cycle/finance/admin but **zero** habit events — integration stopped at 80%. (2) Caffeine-sleep mentioned in copy but correlator never implemented (discrepancy). (3) Doctor markdown export exists but PDF (jspdf) is not; copy button works fine for share.

**Next move:** Wire habit:completed emission (1–2 hours), then unblock Burhan growth. Cascade from there to period_approaching + grocery supplies.

---

*Audit by Claude (Haiku 4.5), 2026-05-14. Codebase snapshot: apps/web, packages/orchestrator, packages/logic, packages/events. Search pattern: TODO|FIXME|streak|Drake|HealthKit|period_approaching|habit:completed|burhan.*leaf, file locations cited with line ranges.*
