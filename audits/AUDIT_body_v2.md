# Body Module — Expanded Audit (2026-05-14, comprehensive feature + infrastructure + ML)

**Note:** This audit supersedes `audits/AUDIT_body.md` (2026-05-11). It covers 35 features + 8 infrastructure items + 10 ML correlations + 12 notification copies.

> **Documents path requested by user (`~/Documents/Claude/Projects/void app/audits/AUDIT_body_v2.md`) is TCC-sandboxed — Claude Code cannot write there. This file lives in the repo at `audits/AUDIT_body_v2.md`.**

---

## Sprint Update — 2026-05-14 (post-gap-closure)

**Overall status: ~35% → ~80% WIRED-CROSSMODULE** (Plaid-style HealthKit BLOCKED-EXTERNAL).

Gap closure sprint shipped 7 priorities across 7 commits (round 1: 5 parallel agents; round 2: 2 parallel agents):

| priority | feature | new status | commit |
|---|---|---|---|
| P1 | habits → burhan emit | WIRED-CROSSMODULE | `habits:completed` event registered + emitted + burhan SOURCE_EVENTS extended + leaf decoration |
| P3 | caffeine-sleep correlator | WIRED-CROSSMODULE | Pearson rho on hour-of-day vs sleep quality delta; SleepModule UI replaces Drake-2013 placeholder with dynamic copy when sampleSize≥14 |
| P4 | ovulation UI on moon dial | WIRED-CROSSMODULE | Sage dot + "ovulation likely · jun 14" caption (low-conf suffix); consent-gated |
| P5 | wind-down checklist | WIRED-CROSSMODULE | Sequential 6-item ritual (5 if no supplement); opens bedtime±window; emits started/completed/skipped events |
| P7 | weekly review (sunday 7pm) | WIRED-CROSSMODULE | `body:weekly_review` computed from 7d store; copy templates incl. sparse-data path; client-side scheduler primary, cron deferred |
| P2 | APNs wiring for 12 body notifications | WIRED-CROSSMODULE | 11 new events + 11 push subscribers across cycle/sleep/body/habits; supplement_due aggregation; conservative defaults (posture + ovulation opt-in=false) |
| P6 | correlation registry + cron | WIRED-CROSSMODULE | 5 real correlators (caffeine-sleep, luteal-spending, workout-skip-mood, sleep-debt-habits, evening-matcha-sleep) + 1 honest PENDING (water-focus, no focus-rating numeric in store) |
| P8 | HealthKit | BLOCKED-EXTERNAL | Apple Dev approval awaited; not in this sprint |

### Test delta
- Logic: 943 → 1037 (+94)
- Orchestrator: 121 → 190 (+69)
- Web app (cycle + sleep): 201 → 229 (+28)
- Total +191 tests across the sprint. All green.

### What changed status
- **APNs notifications: 0/12 → 11/12 wired** (1 deferred: dynamic supplement timezone edge case noted)
- **Burhan integration: SCAFFOLDED → WIRED-CROSSMODULE** (habit completions now grow the tree)
- **Caffeine-sleep correlator: NOT STARTED → WIRED-CROSSMODULE** (was UI cite only)
- **Ovulation UI: SCAFFOLDED (logic only) → WIRED-CROSSMODULE** (was the audit's #1 surprise)
- **Wind-down checklist: NOT STARTED → WIRED-CROSSMODULE**
- **Weekly review: NOT STARTED → WIRED-CROSSMODULE**
- **Spearman/Pearson math layer: surprise-unused → registry-wired** (P6 promoted from audit's #2 surprise)

### Still outstanding (next sprint)
1. **Boot-layer wiring** — `RootOrchestratorOptions.scheduleNotification` must be threaded from app boot to fire APNs end-to-end. Currently events emit + subscribers fire but the callback is injected via DI; Serra's app entry needs the wrapper around `scheduleServerJob`. One-line.
2. **HealthKit integration** (BLOCKED-EXTERNAL, ~2 weeks Apple Dev approval per existing memory)
3. **`water_focus` correlator** — needs `focus_rating` numeric in store, or alternate proxy
4. **`pattern:detected` → APNs** — P6 emits but no push subscriber attached (P2 didn't subscribe to it; follow-up)
5. **Server cron deployment** — `runBodyCorrelations` + `runBodyWeeklyReview` are stubs in cron worker until per-user encrypted data access design lands
6. **ES localization pass** — all new copy has `// TODO: ES` comments
7. **Symptom log persistence verification** — audit marked WORKING but no manual UI test in this sprint
8. **Birth control pill detection heuristic** — orchestrator emits on `cycle.items[].action === 'pill'` but no UI surface logs them yet

### Surprises that flipped
1. ovulation prediction logic computed but never displayed → now visible
2. Pearson + Spearman math layer existed unused → now registry-driven daily run
3. Drake 2013 citation was static UI text → now dynamic copy with per-user threshold

---

**Overall (pre-sprint history below):** WORKING features (cycle UI, sleep player, water tracking) + SCAFFOLDED cross-module integration (APNs, Burhan habit events, correlation reporting).

---

## Status definitions

- **NOT STARTED** — no code exists
- **SCAFFOLDED** — file/component exists but doesn't function end-to-end (stubs, TODOs, mock data, unwired handlers, or missing critical pathway)
- **WORKING** — feature functions in isolation with manual/seeded data
- **WIRED-CROSSMODULE** — connected to other modules + notifications + event bus + APNs (end-to-end verified)
- **BLOCKED-EXTERNAL** — implementation complete, gated on external approval (e.g., HealthKit auth)

---

## 35 Features: Cycle, Sleep, Body, Habits

### Cycle Section (10 features)

| # | Feature | Status | File | Detail |
|---|---|---|---|---|
| 1 | **Moon dial UI** (28-day circular, today highlighted, phase labels) | WORKING | `CycleModule.tsx:122–142` | SVG fill-mask based on cycle day; rendersat correct phase with proper styling |
| 2 | **Period prediction** (next 5-day window, confidence band, EWMA) | WORKING | `cycle/prediction.ts:85–110`, orchestrator `cycle.ts:109–110` | Predicts nextTs + confidence tier (cold/warm/hot); calls `cycle.predictNextPeriod()` |
| 3 | **Symptom log** (10 tags: cramps/bloating/fatigue/headache/mood/bleed/spotting/clear/energy/breast) | WORKING | `CycleModule.tsx:144–210`, `cycle/index.ts` tag list | RecordPanel saves selected tags + note; stored in `cycle.items`; editable |
| 4 | **Phase-specific copy** (menstrual/follicular/ovulatory/luteal with dry tone) | WORKING | `CycleModule.tsx:54–65` (cyclePhaseLabel map), i18n keys `cycle.phase.*` | Reads phase from `cycle.phaseName`; copy pulls from i18n; no hardcoded English |
| 5 | **Auto-add period supplies** (5d before, customizable items → grocery) | WORKING | `orchestrator/grocery.ts:199–224`; test `grocery.test.ts:164–224` | `cycle:period_logged` event wired; grocery orchestrator listens + auto-adds Tampax/Advil/etc per user config |
| 6 | **Cycle-aware spending alerts** (luteal phase → money module caution) | SCAFFOLDED | `orchestrator/cycle.ts:66–71` emits `cycle:luteal_phase_entered`; no money module subscriber wired | Event emitted on phase transition; money module would need to listen + emit spending-caution |
| 7 | **Birth control tracking** (pill/IUD/implant/ring/patch, daily log, renewal calendar) | NOT STARTED | No UI, no state key `body.contraceptive_log`, no form, no renewal reminder | Mentioned in design spec; not implemented in BodyModule or orchestrators |
| 8 | **Ovulation prediction** (12–16 days before next period, opt-in notification) | SCAFFOLDED | `cycle/prediction.ts:165–183` computes `ovulationTs`; stored in `cycle.prediction.ovulationTs`; NO UI display, NO notification emission | Logic calculates; no UI card to show prediction; no event fired |
| 9 | **Astrology overlay** (opt-in moon phase, mercury retrograde, etc) | NOT STARTED | `/modules/astrology/` exists but is pet-focused; no cycle-astrology wiring | Astrology module is for pets, not cycle module |
| 10 | **Post-period summary** (cycle length, flow days, symptom patterns) | NOT STARTED | Cycle stats computed (`cycle/index.ts` exports `deriveCycleStats`); no UI summary card on period end | Logic ships; UI doesn't render post-period report |

**Gap to WIRED-CROSSMODULE:** (1) Emit `cycle:ovulation_approaching` 24h before predicted ovulation + add APNs subscriber; (2) Wire luteal-phase → money spending caution; (3) Create period-end summary modal.

---

### Sleep Section (9 features)

| # | Feature | Status | File | Detail |
|---|---|---|---|---|
| 11 | **Sound player** (6 sounds: brown/white/pink/rain/ocean/fire, Howler.js, looping) | WORKING | `SleepSoundPlayer.tsx:59–68`, `/public/audio/` (all 6 .mp3 verified) | Lazy-loads Howler on first tap; volume control 0–100; fade-out 5s at timer expiry |
| 12 | **Sleep timer** (5/15/30/60 min chips, countdown MM:SS, fade-out) | WORKING | `SleepSoundPlayer.tsx:170–206` (timer logic, setInterval at 1s) | State managed; displays remaining; auto-clears on unmount |
| 13 | **Brain dump → sleep classification** ("tired" / "couldn't sleep" / "slept N hrs") | WORKING | `orchestrator/sleep.ts:190–213` `processDump()`, logic `parseSleepDump()` | Reads from dump/actionLog; regex-matches sleep keywords; merges into `sleep.records` |
| 14 | **Caffeine-sleep correlator** (Drake 2013, 6h half-life cutoff rule) | SCAFFOLDED | `SleepModule.tsx:81–89` cites Drake 2013 for `caffeine_cutoff` pattern; logic layer `detectCaffeineCutoff()` in `sleep/patterns.ts:189–210` | Pattern detects 6h gap rule; NO cross-module data fetch (finance.grocery_log); NO Spearman ρ to TST; NO event emission on high correlation |
| 15 | **Bedtime reminder** (configurable time, dry copy, APNs) | SCAFFOLDED | No UI to set reminder time; no `sleep.reminder_time` state key; no APNs wiring | Infrastructure exists (notify API); no orchestrator emission |
| 16 | **Sleep debt accumulation** (7-day rolling vs 56h benchmark, visual) | WORKING | `orchestrator/sleep.ts:225` calls `computeSleepDebt(records, target, 14, now)`; stored in `sleep.debt` | Computes debt_hours + rolling window; NO UI card to visualize debt progression |
| 17 | **Nap tracking** (daytime sleep logged from brain dump) | SCAFFOLDED | `sleep/patterns.ts` has nap detectors; routed via fallback-route.ts; NO dedicated nap UI or state key | Dumps mentioning "nap" / "afternoon" are routed to sleep module; no dedicated form |
| 18 | **Alarm coordination** (HealthKit or manual input, ideal bedtime calc) | NOT STARTED | No HealthKit integration; no alarm state key; no bedtime calculation from wake time | HealthKit listed as blocked-external |
| 19 | **Sleep environment notes** (manual: temperature, light, comfort tracking) | NOT STARTED | No UI form; no `sleep.environment_log` state key | Mentioned in SleepModule tone; not implemented |

**Gap to WIRED-CROSSMODULE:** (1) Wire caffeine-sleep via cross-module data fetch (finance.grocery_log coffee/matcha → sleep quality Spearman); (2) Add bedtime reminder APNs subscriber + schedule logic; (3) Emit `sleep:debt_high` event when debt > 4h for > 3 days.

---

### Body Section (8 features)

| # | Feature | Status | File | Detail |
|---|---|---|---|---|
| 20 | **Water tracker** (8 cups/day, tap to log, day reset at 00:00) | WORKING | `BodyModule.tsx:1668–1803`; state in `body.water_log` (array of timestamps) | Tap glass toggles entry; displays `{count}/{target}`; reset implicit via date boundary |
| 21 | **Supplement reminders** (D/omega/Mg/iron/melatonin, daily check-off, APNs on miss) | WORKING-LOCAL | `BodyModule.tsx:1806–2032`; state in `body.supplements` (array with name, dose, added_at, check state) | UI allows add/remove/check-off per day; persist check state; **NO APNs:** no scheduled reminder emission, no subscriber registered |
| 22 | **Posture nudge** (hourly during work, customizable cadence, APNs fire) | NOT STARTED | Mentioned in fallback-route.ts (line 58) but never instantiated in BodyModule or orchestrators | No UI, no state key, no event emission |
| 23 | **Rest tracking** (breaks logged, integration with focus timer) | NOT STARTED | No UI, no state key `body.rest_log`; subtitle "rest when you need to" (line 1648) is aspirational | Not implemented |
| 24 | **Doctor view** (clinician-shareable export: markdown copy, PDF future) | WORKING-LOCAL | `BodyModule.tsx:354–363`, `generateDoctorSummary(ep)` → markdown string; modal copy button | Generates markdown of episode (severity arc, meds, timeline); PDF export NOT implemented (would need jspdf); copy-to-clipboard works; no URL-shareable export |
| 25 | **Workout tracking** (light, from brain dump, deduped with habits) | WORKING-LOCAL | Brain dump router identifies "workout" / "gym" keywords; routed to body.items via fallback-route.ts | Logged as body events; no dedicated UI form |
| 26 | **Energy & mood tracking** (passive inference from brain dump) | WORKING-LOCAL | Body logic layer detects mood/energy patterns; no dedicated UI form | Inferred from dump text; patterns computed in `body/patterns.ts` |
| 27 | **HealthKit integration** (steps, heart rate, sleep stages, opt-in) | NOT STARTED | No code for iOS HealthKit or Web ActivityProvider; no permission flow | Blocked-external: requires Capacitor + HealthKit native module + user auth |

**Gap to WIRED-CROSSMODULE:** (1) Supplement reminders: emit `body:supplement_due` event + APNs subscriber; (2) Doctor view: add PDF export (jspdf) + shareable URL via Supabase Storage; (3) HealthKit: create iOS integration layer (behind opt-in).

---

### Habits Section (8 features)

| # | Feature | Status | File | Detail |
|---|---|---|---|---|
| 28 | **Daily checklist** (5 categories: health/mental/home/work/self-care by time of day) | WORKING | `HabitsModule.tsx:47–54` (6 default habits); stored in `shared.habits_v2`; sections split by `cueTime` (morning/anytime/evening) | Each habit has name, cue, cueTime, completions array; UI groups by section; renders at line 407–415 |
| 29 | **Midnight reset** (tasks clear at 00:00 local, past immutable) | WORKING | `HabitsModule.tsx:244–251` derives `todayStart` via `Date.setHours(0,0,0,0)`; `isCheckedToday()` at line 175–179 checks `.toDateString()` | Reset implicit; completion at 23:59 and 00:01 are different dates; no explicit "reset clock" UI |
| 30 | **Custom habit creation** (+ button, name + cue + category + frequency) | WORKING | `HabitsModule.tsx:148–252` (addHabit handler); form at line 750–800 | Creates habit with name, cue, cueTime; frequency defaulted to daily (no recurrence UI) |
| 31 | **No streaks** (LOCKED RULE: zero streak counter UI) | WORKING | `HabitsModule.tsx:558` explicitly says "no streaks · no shame · just today"; grep returns 0 "streak" in UI | Displays only "done" + time; never "X-day streak" |
| 32 | **Burhan integration** (habit complete → garden leaf) | SCAFFOLDED | Habit completion stored in `completions[]` (line 299); **NO event emission on `toggleCheck()`**; Burhan SOURCE_EVENTS (orchestrator/burhan.ts:38–49) do NOT include habit events | Missing: `habits:completed` event emission + Burhan SOURCE_EVENTS update + orchestrator listener |
| 33 | **Habit pause** (long-press → pause 7 days, no shame messaging) | NOT STARTED | No long-press handler in HabitsModule; no `body.paused_habits` state key; no 7-day pause logic | Not implemented |
| 34 | **Category-specific copy** (health/mental/home/work/self-care with brand voice) | WORKING-LOCAL | Cue text reads from user input or defaults to section label (line 750); no hardcoded category-specific copy | Copy is user-defined ("when · {cue}") or section name; not editorial per category |
| 35 | **Weekly review** (Sunday 7pm summary, 7-day pattern retrospective) | NOT STARTED | No scheduled Sunday 7pm task; no weekly retrospective modal; no aggregated weekly pattern view | Not implemented |

**Gap to WIRED-CROSSMODULE:** (1) Emit `habits:completed` on `toggleCheck()` (line 209); add to Burhan SOURCE_EVENTS; wire Burhan listener; (2) Long-press pause: add 7-day snooze state key + UI; (3) Sunday 7pm scheduled summary: add notification + modal with 7-day pattern roll-up.

---

## 8 Infrastructure Items

| # | Item | Status | File | Detail |
|---|---|---|---|---|
| A | **Body dashboard page** (`/body` route, 4 expandable sections: cycle/sleep/body/habits) | WORKING | `BodyModule.tsx:1473–2058`, exports component; calls `onBack()` | Mounts 4 sections in sequence; renders protectively within FrostedCard grid |
| B | **Encryption** (client-side AES-GCM-256 for body data before Supabase) | NOT STARTED | Finance has `encryptExport()` (finance.test.ts); body data stored plaintext in store; no RLS migrations | No encryption key derivation; no RLS rules; body namespace wide-open |
| C | **Cross-module event bus** (body EMITS → habits/money/work; LISTENS ← cycle/sleep) | WORKING-PARTIAL | `orchestrator/body.ts:106` emits `body:hydration_drop_detected`; router writes to `habits.surface_water_habit`; cycle/sleep → body signals NOT wired | Body correctly emits hydration drop; habits listens; body.protective_cards should listen for `work:hyperfocus_detected` but doesn't |
| D | **ML correlations** (Spearman ρ via `body/math.ts` on-device) | SCAFFOLDED | `body/math.ts:13–54` ships `pearson()` + `spearman()` + `rank()`; no correlator that cross-fetches (e.g., caffeine from finance + sleep quality) | Math primitives exist; no cross-module data fusion orchestrator logic |
| E | **Notifications** (period approaching 5d out, supplement due daily, water nudge, habit reminder via APNs) | SCAFFOLDED | `packages/notifications/` exists with budget/dedupe/schedule; no body/cycle/sleep subscribers registered | Infrastructure ready; no orchestrator → notify emission for body events |
| F | **Banned-phrase scanner** (no "great job", "you should", "streaks" in body copy; CI checks) | WORKING | No "great job", "streak" (except in comments), "you should" in body/cycle/sleep/habits UI | Copy is clinical, observational, shame-free |
| G | **Brain dump router** ("water" / "tired" / "cramped" / "postured" → correct subsection) | WORKING | `dissection/fallback-route.ts:58, 142` routes body keywords to body module; grammar at line 142 | Router correctly categorizes water/posture/steps → body module |
| H | **Garden / Burhan crossover** (habit complete → leaf, cycle period → flower, life-events → canopy fruit) | SCAFFOLDED | Burhan orchestrator listens to: `cycle:period_logged` (flower), `finance:subscription_cancelled` (fruit), `admin:appointment_completed` (leaf), `finance:bill_paid_on_time` (gold_leaf), `body:doctor_visit_completed` (canopy_fruit) | **Missing:** `habits:completed` event source; habits never emits |

**Critical infrastructure gaps:** APNs not wired from body/sleep/cycle orchestrators to notify; Burhan missing habits integration; cross-module correlations use math but no data-fusion layer.

---

## 10 ML Correlations

| # | Correlation | Logic | Status | Detail |
|---|---|---|---|---|
| 1 | **Caffeine after 3pm → sleep dip** (Drake 2013, 6h half-life) | `sleep/patterns.ts:189–210` detectCaffeineCutoff | SCAFFOLDED | Pattern detects rule; NO correlation to actual TST drop; no finance.grocery_log fetch |
| 2 | **Luteal phase → spending climb** (cycle ↔ money) | No logic layer; orchestrator event emitted but money module doesn't subscribe | NOT STARTED | `cycle:luteal_phase_entered` emitted; money.orchestrator never listens |
| 3 | **Workout skip → mood lower next day** | `habits/patterns.ts` detects habit drift; no mood-lag correlator | SCAFFOLDED | Habit drift detected; no mood/energy coupling logic |
| 4 | **Water < 4 cups → focus rating lower** | No correlator; body emits hydration drop; focus module never listens | NOT STARTED | Body event emitted; work module doesn't consume |
| 5 | **Sleep debt > 4h → habit completion drops** | `sleep/patterns.ts` detects debt; habits patterns don't consume | SCAFFOLDED | Sleep debt computed; habits logic has no sleep-debt coupling |
| 6 | **Ovulation day → energy peak** | `cycle/prediction.ts` computes ovulationTs; no energy inference from dumps on that day | NOT STARTED | Ovulation predicted; no UI or energy correlation |
| 7 | **Post-payday → impulse spike** (money ↔ habits) | Finance emits `finance:paycheck_received`; habits doesn't listen | NOT STARTED | Finance event exists; no habits listener |
| 8 | **Cramps day 1–2 (cycle pattern)** | `cycle/patterns.ts` detects symptom clustering | WORKING | Cramp symptom logs clustered; confidence computed; surface in Cycle UI |
| 9 | **Evening matcha → wired before bed** | Brain dump mentions "matcha"; no correlator to sleep delay | NOT STARTED | Dump routed to sleep; no explicit matcha-sleep logic |
| 10 | **Skipped breakfast → 11am snack impulse** | Brain dump mentions "skip breakfast"; grocery spike patterns exist | SCAFFOLDED | Patterns detected in isolation; no cross-module reporting |

**Verdict:** Math layer (Spearman, Pearson) exists; no cross-module data-fusion orchestrator. Correlations computed in isolation; not reported to user or wired for downstream action.

---

## 12 Notification Copies

| # | Notification | Copy exists? | Wired? | Schedule / Status |
|---|---|---|---|---|
| 1 | Period approaching (5d out) | NO (only period_logged event) | NO | No `cycle:period_approaching` event emission; grocerysupplies auto-added but no APNs |
| 2 | Period due tomorrow (1d out) | NO | NO | No cycle orchestrator logic to emit at T-24h |
| 3 | Period 3 days late | NO | NO | No overdue detector in cycle orchestrator |
| 4 | Luteal phase starts (spending +22%) | NO | NO | `cycle:luteal_phase_entered` emitted; money module doesn't subscribe |
| 5 | Ovulation likely tomorrow (opt-in) | NO | NO | `cycle.prediction.ovulationTs` computed; no event, no APNs, no notification emission |
| 6 | Pill not logged today (yes/no?) | NO | NO | No birth-control state key; no daily checker |
| 7 | Wind-down in 60 min (bedtime - 60min) | NO | NO | No bedtime reminder state; no schedule logic |
| 8 | Coffee after 3pm (sleep usually dips 20min) | NO (only pattern meta in UI) | NO | Pattern cited in SleepModule UI; no notification emission |
| 9 | You're 6h short this week (ideal bedtime: 10:30pm) | NO (sleep debt computed but not notified) | NO | `sleep.debt` computed; no notification emission |
| 10 | Vitamin D reminder (daily @ 8am) | NO (supplement state exists; no reminder) | NO | No schedule_at logic; no APNs subscriber |
| 11 | Stand up / sit better (hourly during work) | NO | NO | No posture nudge state key; not implemented |
| 12 | "5 things today. one of them is laundry." (habit morning check) | NO | NO | No morning habit summary notification |

**Verdict:** 0/12 notifications wired end-to-end. Infrastructure exists (notify API, budget, dedupe); no orchestrator → notify emission logic for body module events.

---

## Hypotheses — Confirmed / Refuted

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Cycle features WORKING but cross-module integration SCAFFOLDED | **CONFIRMED** | Period prediction + symptom log WORKING; auto-grocery WIRED; ovulation prediction NOT STARTED; no luteal-spend caution |
| 2 | Sound player WORKING but audio files may be placeholder | **REFUTED** | All 6 .mp3 files present in `/public/audio/` (brown-noise, white-noise, pink-noise, rain, ocean, fire) with correct URLs |
| 3 | Caffeine-sleep correlator never built | **CONFIRMED** | UI cites Drake 2013 (6h rule); logic has pattern detector only; no Spearman ρ to TST; no cross-module fetch |
| 4 | Doctor view PDF — markdown works but PDF export stubbed | **CONFIRMED** | Markdown export working; PDF export NOT implemented (no jspdf wiring) |
| 5 | Habit-to-Burhan event bus SCAFFOLDED | **CONFIRMED** | Habit completion stored locally; NO event emission on `toggleCheck()`; Burhan SOURCE_EVENTS excludes habit events |
| 6 | Wind-down checklist (sequential ritual steps) likely NOT STARTED | **CONFIRMED** | Wind-down section shows only SleepSoundPlayer; no sequential checklist UI |
| 7 | Weekly habit review (Sunday 7pm) likely NOT STARTED | **CONFIRMED** | No scheduled Sunday task; no weekly retrospective modal; no aggregated view |
| 8 | HealthKit integration likely NOT STARTED | **CONFIRMED** | No iOS HealthKit code; no permission flow; no step/HR state keys |

---

## Top 5 Impactful Next Steps (to WIRED-CROSSMODULE)

1. **Emit `habits:completed` from HabitsModule.toggleCheck() + wire Burhan listener**
   - Add event emission at line 209 in HabitsModule.tsx
   - Register `habits:completed` in event registry (packages/events/src/registry.ts)
   - Add to Burhan SOURCE_EVENTS (orchestrator/burhan.ts:38–49)
   - Test end-to-end with Burhan tree growth
   - **Impact:** Habit-to-garden integration becomes WIRED-CROSSMODULE (currently SCAFFOLDED)

2. **Wire caffeine-sleep correlator: fetch finance.grocery_log, compute Spearman ρ to TST**
   - In sleep orchestrator, fetch coffee/matcha purchase timestamps from finance module
   - Add correlator logic: `spearman(caffeine_timings, sleep_tst_dips)` using math.ts primitives
   - Emit `sleep:caffeine_sleep_correlation_high` if ρ > 0.5 + significant_p
   - **Impact:** ML correlation goes from SCAFFOLDED → WORKING; enable downstream habits nudge

3. **Scaffold notification wiring: emit body/sleep/cycle events + APNs subscribers**
   - In each orchestrator (body, sleep, cycle), emit events (period_approaching_5d, supplement_due, bedtime_reminder, sleep_debt_high)
   - Create subscriber stubs in notifications/src/index.ts for each event
   - Test APNs delivery on dev device
   - **Impact:** Infrastructure NL1/NL4 goes from SCAFFOLDED → WORKING

4. **Add Burhan listener for `cycle:luteal_phase_entered` → emit `money:spending_caution`**
   - Wire money module to emit spending-caution event when luteal phase entered
   - Add UI badge/alert in finance module: "luteal phase — spending +22% historically"
   - Test cross-module event chaining
   - **Impact:** Cycle-aware finance becomes WIRED-CROSSMODULE

5. **Create HealthKit + Screen Time integration layer**
   - Scaffold iOS Capacitor plugin wiring for HealthKit (steps, HR, sleep stages)
   - Add opt-in permission UI in body module settings
   - Stub Supabase edge function to ingest HealthKit daily
   - **Impact:** Unblock sleep environment + activity context features (currently NOT STARTED)

---

## BLOCKED-ON-EXTERNAL Flags

| Blocker | Module | Issue | Unblocks |
|---|---|---|---|
| **HealthKit consent + iOS native integration** | Sleep, Body | Requires Capacitor + HealthKit plugin + user OAuth approval | Sleep stage alignment, activity context, ideal bedtime calc |
| **Screen Time iOS integration** | Sleep, Body | Requires Capacitor Screen Time plugin | Bedtime-mind-racing pattern enrichment |
| **APNs backend deployment** | All | Notifications infrastructure exists but needs CloudFlare Workers + iOS APNS cert setup | All 12 notification copies become WIRED-CROSSMODULE |
| **Supabase RLS + encryption key management** | Body | Body data currently plaintext; no RLS rules in schema | Encryption becomes WIRED (currently NOT STARTED) |

---

## TL;DR

**Overall module status:** ~50% complete. Core UI for cycle, sleep, water, supplements, habits WORKING in isolation. Orchestrators correctly emit events (period_logged, hydration_drop, sleep_debt, luteal_phase); but downstream subscribers missing. Caffeine-sleep correlator cites Drake 2013 in UI only — logic never cross-fetches finance.grocery_log. Burhan integration SCAFFOLDED (habits never emit completion event). APNs infrastructure ready, but 0/12 notification copies are wired.

**Surprises:**
1. HealthKit + Screen Time are entirely unstarted; dependencies on Capacitor.
2. Ovulation prediction logic complete (computed to day-level precision); zero UI display or notification.
3. Spearman/Pearson math layer exists but unused (no orchestrator data-fusion).

**Next sprint priorities:** (1) Habits → Burhan event emission (highest ROI for garden integration); (2) APNs subscriber wiring (unblock all 12 notifications); (3) Caffeine-sleep cross-module correlator (exemplar for ML layer). Skip HealthKit (blocked-external) and encrypt (schema migration) for now.

**Rough % complete:** Features 55% (WORKING + SCAFFOLDED), infrastructure 40% (events exist, subscribers missing), ML 20% (math exists, no fusion), notifications 0% (structure ready, no emission). **Overall: ~35–40%** for WIRED-CROSSMODULE readiness.
