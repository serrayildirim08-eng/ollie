# Ollie — "Body" Cluster Feature Inventory

Exhaustive inventory of the 5 body-cluster submodules: **cycle, sleep, body, medication, habits**.
Source-scanned 2026-05-18 from `apps/web/src/modules/*`, `packages/logic/src/*`, `packages/orchestrator/src/*`.
Inventory only — no design, no app-code changes.

Each submodule lists three categories:
- **Actions** — distinct things the user can DO
- **Info / data** — facts the submodule holds and can show
- **Patterns / detections** — what the app COMPUTES or detects on its own

---

## 1. CYCLE

Menstrual-cycle tracking. Ceramic visual language. Scoped, quiet, no streaks.
Files: `modules/cycle/CycleModule.tsx`, `packages/logic/src/cycle/*`, `orchestrator/src/cycle.ts`, `logic/src/patterns/*`.

### Actions
- Record today: pick symptom tags (cramps, bloating, fatigue, headache, mood shift, bleeding day 1, bleeding, spotting, clear, energy)
- Record today: write a free-text note
- Log "bleeding day 1" → starts a new period (dedup-guarded: 12h window prevents double period-start)
- Log a birth-control pill for today (one-tap toggle)
- Back-date a pill on the 7-day strip (up to 3 days back)
- Accept the adherence banner ("it was just a long cycle") or "I missed logging a period" → inserts an estimated period-start
- Settings: toggle "tracking for fertility"
- Settings: toggle the moon-phase dial on/off
- Settings: toggle birth-control mode (authoritative in `shared.settings.birth_control_enabled`)
- Settings: pick pill type (combined / progestin-only / other)
- Settings: set a passphrase hint
- Ask-partner: pick what you need from a partner across 4 categories (material / touch / labor / emotional) — 16 options
- Brain-dump from home routes into cycle (period logged, symptoms) via the dump dispatcher

### Info / data
- Current cycle day number + phase name (menstrual / follicular / ovulation window / luteal / late-luteal-or-overdue)
- Cycle progress dial — current day vs mean cycle length, with ovulation day marked
- Moon-phase tile reflecting position in the cycle
- Next-period prediction: a confidence date range + plain-text explanation
- Prediction confidence tier (cold / warming / personalized / variable / shifting / warm / hot) + count of cycles logged
- Fertile window date range (only when fertility tracking is on) + a detail line
- Predicted ovulation date + confidence (a low-confidence variant of the caption)
- Recent cycle history — last 5 closed cycles as day-length tiles
- Mean cycle length; irregular flag
- Last period start timestamp
- Pill log: today logged/unlogged state; 7-day pill dot strip; retroactive "yesterday missed" hint
- Partner-ask summary count

### Patterns / detections
- **Boundary detection** (`detectBoundaries`) — segments raw logs into discrete cycles with start/length/bleed-length.
- **Cycle stats** (`deriveCycleStats`) — mean length, last-period start, irregular flag.
- **Next-period prediction** (`predictNextPeriod`) — Bayesian posterior cycle length → date range + confidence tier; tells you roughly when your next period lands.
- **Ovulation prediction** (`predictOvulation`) — estimates ovulation day + confidence within the current cycle.
- **Fertile window** (`fertileWindow`) — derives the conception-likely date range.
- **Adherence-issue detection** (`detectAdherenceIssue`) — flags a suspiciously long cycle as a probable missed period-log, offers a corrective split.
- **Change-point detection** (`detectChangePoint`) — spots when cycle length structurally shifts (your baseline changed).
- **Symptom-cluster correlations** (`findCorrelations`) — for each symptom bucket, the mean cycle-day it tends to land on, across ≥3 unique cycles ("cramps cluster around day ~3").
- **Clinician health flags** (`detectHealthFlags`) — surfaces ACOG-referenced flags with sources:
  - long-cycles — 3+ consecutive cycles ≥35 days (oligomenorrhea)
  - short-cycles — 3+ consecutive cycles <21 days
  - long-bleed — 3+ periods lasting >8 days (prolonged menstruation)
  - amenorrhea — 90+ days since last period
  - dysmenorrhea — severe cramps logged in 3+ consecutive cycles
- **Syndrome-pattern detection** (`detectSyndromePatterns`) — softer, watch/discuss-severity patterns: missed-period (45+ day gap), irregular (high variance), pcos-pattern, endo-pattern, pmdd-pattern, unusual-bleeding.
- **Symptom-clustering** (`symptom-clustering`) — buckets free-text symptoms into 11 canonical categories (cramps, headaches, bloating, acne, fatigue, nausea, cravings, breast tenderness, back pain, mood swings, brain fog).
- **Luteal-phase entry** (orchestrator) — emits `cycle:luteal_phase_entered` when the cycle crosses into luteal.
- **Pill-missed detection** (orchestrator `emitPillMissed`) — detects a skipped birth-control dose, emits `cycle:pill_missed`.
- **Period-logged event** (orchestrator) — emits `cycle:period_logged` feeding cross-module detectors.

---

## 2. SLEEP

Sleep tracking, chronotype, sleep debt. Paper/ink editorial language ("issue n° 218").
Files: `modules/sleep/SleepModule.tsx`, `WindDownChecklist.tsx`, `InsomniaSurvey.tsx`, `EpworthSurvey.tsx`, `packages/logic/src/sleep/*`, `orchestrator/src/sleep.ts`.

### Actions
- Log how last night felt — 4-button quick log (solid / ok / rough / bad)
- "Say more, parse it for me" — free-text night description ("bed 23:48, woke 6:30, took an hour to drop, two coffees") parsed into a structured record
- Brain-dump "slept 8 hours" from home — routes into sleep via dispatcher
- Take the Insomnia Check survey (7 questions, ~2 min) — retakeable
- Take the Daytime Sleepiness / Epworth survey (8 questions, ~1 min) — retakeable
- Wind-down checklist — tap through a sequential 6-item bedtime ritual (phone away, drink water, supplement, lights low, breath/journal, into bed); supplement step auto-skips if no supplements
- Play a sleep sound (SleepSoundPlayer / brown-noise style player)
- Settings: toggle which cross-module patterns to surface (sleep×cycle, sleep×focus, sleep×dump-mood)
- Open the "see the rest" drawer — full pattern + history view

### Info / data
- Last night's total sleep time (big Hh Mm number)
- This-week sleep debt — "X min short / X min over / on target"
- Tonight's sleep forecast — likely hours + 95% CI, with a confidence tier (early-read vs settled), nights counted
- Chronotype card — category, mid-sleep time (MSFsc), MCTQ-style; avg duration; 14-day debt
- Last-14-nights bar chart — color-coded weekday/weekend/rough/bad, last night marked
- Count of nights logged / nights of data
- Last Insomnia survey score (X/28) and last Epworth score (X/24)
- Per-night record fields: bedtime, wake time, onset latency, wakings, efficiency, quality, notes

### Patterns / detections
- **Sleep stats** (`deriveSleepStats`) — rolling 14-day mean TST and variability.
- **Sleep debt** (`computeSleepDebt`) — cumulative deficit/surplus vs target over 14 days.
- **Tonight forecast** (`forecastTonightHeuristic` / `forecastTonightTST`) — predicts tonight's likely sleep duration + CI.
- **Bedtime drift** (`detectBedtimeDrift`, ≥5 nights) — bedtime trending later/earlier (r² fit); "bedtime is drifting later."
- **Chronotype estimation** (`estimateChronotype`, ≥7 nights) — assigns a chronotype band from mid-sleep on free days.
- **Social jetlag** (`computeSocialJetlag`, ≥7 nights) — weekday vs weekend mid-sleep gap; "weekend mid-sleep is Xh later."
- **DSPS pattern** (`detectDSPSPattern`, ≥14 nights) — sustained late-bedtime run for 2+ weeks; "pattern, not diagnosis."
- **Short-sleep run** (`detectShortSleepRun`, ≥3 nights) — consecutive nights of short sleep; mean duration.
- **Revenge bedtime** (`detectRevengeBedtime`) — post-target-bedtime activity nights; "I don't want today to be over."
- **Caffeine cutoff** (`detectCaffeineCutoff`) — median caffeine-to-bedtime gap vs the 6h floor.
- **Caffeine→sleep correlator** (`correlateCaffeineAndSleep`, Drake 2013 6h half-life, ≥14 samples) — dynamically replaces the static caffeine blurb with measured caffeine→onset effect.
- **Sleep-onset gap** (`detectSleepOnsetGap`) — minutes in bed before you drop + sleep efficiency %.
- **Weekend recovery illusion** (`detectWeekendRecoveryIllusion`) — weekday vs weekend hours; "doesn't pay back the debt."
- **Bedtime mind-racing** (`detectBedtimeMindRacing`) — ruminative-language density in bedtime brain dumps.
- **Wind-down friction** (`detectWindDownFriction`) — total wind-down minutes + the "stuck step" you stall on.
- **Medication timing drift** (`detectMedicationTimingDrift`) — your med-to-bed gap drifting over weeks; "a pattern your doctor might want to see."
- **Chronotherapy progress** (`detectChronotherapyProgress`) — first-7 vs last-7-night median bedtime, direction; "no streaks."
- **Sleep × cycle phase shift** (`detectSleepCyclePattern`) — bedtime shifts +X min later in luteal phase.
- **Sleep × focus shift** (`detectSleepFocusPattern`) — after <5h nights, deep-focus peak hour shifts.
- **Sleep × dump-mood shift** (`detectSleepDumpMoodPattern`) — after poor-sleep nights, next-day overwhelm density × baseline.
- **Cycle-phase sleep coupling** (`detectCyclePhaseSleepCoupling`) — in luteal phase, onset takes ~X more minutes than rest of cycle.
- **Stimulant sleep debt** (`detectStimulantSleepDebt`) — nights after stimulant-mention days take ~X more minutes to onset.
- **Insomnia survey scoring** (`scoreInsomniaSurvey` + `insomniaSeverityBand`) — scores the 7-item survey into a severity band.
- **Epworth scoring** (`scoreEpworth` + `epworthSleepinessBand`) — scores the 8-item daytime-sleepiness scale into a band.
- **Debt-accumulated / short-sleep-run / wind-down-window / pacing-breach events** (orchestrator) — emits cross-module signals for cue scheduling.

---

## 3. BODY

Hydration, supplements, symptom episodes, chronic conditions, treatment plans, posture. "Never mentions calories."
Files: `modules/body/BodyModule.tsx`, `packages/logic/src/body/*`, `orchestrator/src/body.ts`, `body-signals.ts`, `body-weekly.ts`, `body-correlations.ts`.

### Actions
- Add a glass of water (one-tap)
- Remove the last glass
- Toggle a supplement as taken today (mirrors into `checked_dates` for the reminder)
- Add a supplement (name + optional dose)
- Remove a supplement
- Start a symptom episode — give it a label and pick a kind (acute / chronic / mental / mixed; kind auto-suggests "chronic" if label matches a tracked condition)
- Log severity (1–5) on the active episode, with an optional note
- Log a med taken during the active episode (name + optional dose)
- Close / resolve an episode (shows a calm recap before confirming)
- Preview the doctor summary (tldr + severity arc + meds + 7-day context)
- Copy doctor summary as markdown / download as .md file
- Add / remove a chronic condition (auto-tags matching episodes as chronic)
- Add a treatment plan (label, cycle length, total cycles) — e.g. chemo / IVF / allergy course
- Advance a treatment plan to its next cycle
- Remove a treatment plan
- Toggle the posture reminder on/off (hourly nudge during a work-hour window, off by default)
- Dismiss a "be gentle today" protective card
- Dismiss a cross-module signal
- Brain-dump body mentions from home — routed into body via dispatcher

### Info / data
- Today's water count vs target (target age-defaulted: 6/7/8 glasses by age band, 1–16 clamp)
- Whether all supplements are taken today
- Per-supplement: name, dose, today's checked state, reminder time
- Active episode: label, kind, day-N counter, last logged severity, recent meds taken
- Episode close recap: days tracked, check-in count, peak severity, meds logged
- Doctor summary: a copy/download-ready markdown brief incl. a severity-arc sparkline
- Chronic conditions list (count tracked)
- Treatment plans: label + "cycle N of M, day D post-event" position
- Posture reminder on/off + the active work-hour window
- "be gentle today" protective cards (reasons written by cross-module router)
- "across your modules" cross-module signals — ≥2-module connections with sources
- "— noticed" body patterns panel — copy, confidence, r-value, days of data, source link

### Patterns / detections
Single-module body pattern detectors (`logic/src/body/patterns.ts`, surfaced in "— noticed"):
- **Headache–hydration** (`detectHeadacheHydration`) — on low-water mornings you flag a headache N of M times (correlation r).
- **Interoception drift** (`detectInteroceptionDrift`) — your water-drinking interval swings widely; your body may not be signaling thirst on time.
- **Hyperfocus dehydration** (`detectHyperfocusDehydration`) — fewer glasses/hour inside focus sessions than between them; flow numbs you to thirst.
- **Afternoon crash window** (`detectAfternoonCrashWindow`) — "tired/drained" dumps cluster in a specific afternoon time block.
- **Supplement drift** (`detectSupplementDrift`) — last-14-day supplement-logging rate vs prior 14 days; routine drifting.
- **Multi-symptom recurrence** (`detectMultiSymptomRecurrence`) — a cluster of symptoms recurring together.
- **Hunger–thirst confusion** (`detectHungerThirstConfusion`) — you write "hungry" within 30 min of drinking water; interoceptive signals crossing.
- **Caffeine–water tradeoff** (`detectCaffeineWaterTradeoff`) — high-caffeine days run low on water (Spearman ρ).
- **Meal-skip pattern** (`detectMealSkipPattern`) — N/M days with no food logged before 14:00; breakfast skipping.
- **GI symptom × cycle phase** (`detectGISymptomCyclePhase`) — gut complaints concentrate in one cycle phase.
- **Movement gap** (`detectMovementGap`) — few days with movement logged; "not laziness — ADHD needs an extra planning step."
- **Vasomotor pattern** (`detectVasomotorPattern`) — hot-flash / night-sweat mentions; peri/post-menopausal vasomotor signal.
- **Symptom × phase coupling** (`detectSymptomPhaseCoupling`) — body symptoms cluster in luteal phase (% luteal days vs other days, lift).
- **Sleep-debt symptom lag** (`detectSleepDebtSymptomLag`) — days after short nights, body-symptom mentions spike vs baseline.
- **Envelope copy** (`envelopeCopy`) — reframes select detections into an energy-envelope / pacing framing.

Episode-level detectors (`logic/src/body/episodes.ts`):
- **Duration distribution** (`detectDurationDistribution`) — how long this episode kind typically lasts for you.
- **Trigger correlation** (`detectTriggerCorrelation`) — candidate triggers that precede episodes.
- **Recurrence rhythm** (`detectRecurrenceRhythm`) — whether episodes recur on a rhythm/interval.
- **Medication adherence** (`detectMedicationAdherence`) — adherence pattern within episodes.
- **Mental-episode pattern** (`detectMentalEpisodePattern`) — recurrence pattern across mental-kind episodes.
- **Chronic-condition match** (`matchChronicCondition` / `suggestEpisodeKind`) — matches an episode label to a tracked chronic condition.

Pacing / treatment detectors:
- **Breach session detection** (`detectBreachSession`, pacing.ts) — detects an energy-envelope breach (overexertion), opens a breach episode, auto-closes after recovery hours.
- **Side-effect pattern** (`detectSideEffectPattern`, treatments.ts) — side-effects tracking against treatment cycles.

Cross-module body signals (`body-signals.ts`, surfaced in "across your modules"):
- **Sleep-debt → focus quality** (`detectSleepDebtFocusQuality`) — short nights bleeding into next-day focus quality.
- **Cycle-phase → energy** (`detectCyclePhaseEnergy`) — focus/energy shifting with cycle phase.

Body correlation registry (`body/correlations/`, run by `runBodyCorrelationPass`):
- **Luteal × spending** (`correlateLutealAndSpending`) — spending rises in luteal phase.
- **Workout-skip × mood** (`correlateWorkoutSkipAndMood`) — skipped workouts coincide with mood dips.
- **Water × focus** (`correlateWaterAndFocus`) — hydration vs focus quality.
- **Sleep-debt × habits** (`correlateSleepDebtAndHabits`) — sleep debt vs habit completion.
- **Evening-matcha × sleep** (`correlateEveningMatchaAndSleep`) — evening caffeine vs sleep.

Orchestrator-emitted detections:
- **Supplement due** (`emitSupplementDue`) — fires `body:supplement_due` reminder when a supplement is unchecked at its reminder time.
- **Posture nudge** (`emitPostureNudge`) — hourly `body:posture_nudge` during the work-hour window when opted-in.
- **Hydration-drop detection** — emits `body:hydration_drop_detected` (feeds the habits water prompt).
- **Weekly review** (`computeWeeklyReview` / `emitWeeklyReview`) — Sunday-evening recap of the week's water + supplements + habits.

---

## 4. MEDICATION

Plain medication / vitamin / supplement adherence tracker. Dry, factual voice ("noted." not "great job!").
Files: `modules/medication/MedicationModule.tsx`, `packages/logic/src/medication/index.ts`, `orchestrator/src/medication.ts`.

### Actions
- Add a medication — name, optional dose, kind (vitamin / supplement / prescription / otc), schedule (comma-separated HH:MM times, or blank for manual)
- Log a dose taken (one-tap; stamps date + time)
- Log another dose (when today's scheduled doses are already done)
- Archive a medication

### Info / data
- List of medications — name, kind, dose, schedule (or "manual log only")
- Per-medication color dot
- Today's status per item: doses logged count; doses remaining (vs schedule)
- Whether the item was taken today
- Adherence report per item — "logged X of Y this fortnight" copy
- Count of active (non-archived) items

### Patterns / detections
- **Taken-today / count-today / doses-remaining** (`takenToday`, `takenCountToday`, `dosesRemainingToday`) — derives today's dose state against the schedule.
- **Due-slots computation** (`dueSlotsToday`) — which scheduled times are still due today.
- **Adherence report** (`adherenceReport`) — 14-day logged-vs-expected ratio; sets a `drift` flag and a plain copy line ("pattern, not medical").
- **Overdue detection** (orchestrator) — emits `medication:overdue_detected` when a scheduled dose passes unlogged.
- **Adherence drift** (orchestrator) — emits `medication:adherence_drift` when the fortnight ratio degrades.
- **Logged event** — emits `medication:logged` on every dose, feeding habits/body cross-module coupling detectors.

---

## 5. HABITS

ADHD-aware habit tracker. "No streaks · no shame · just today." Ledger / volume-01 editorial.
Files: `modules/habits/HabitsModule.tsx`, `packages/logic/src/habits/*`, `orchestrator/src/habits.ts`.

### Actions
- Check / uncheck a habit for today (toggle; completions older than 90 days pruned)
- Add a habit — name + cue (cue is REQUIRED; "a habit without a cue is wishful thinking") + cue-time section (morning / anytime / evening)
- Remove a habit
- (Seeds 6 default habits: brush teeth, drink water, vitamin d, move, evening meds, wind down)
- Dismiss a water prompt surfaced from the body module
- Brain-dump habit completions from home — routed via dispatcher

### Info / data
- Today's count: "done / total marked" (e.g. 03 / 06)
- Per-habit: name, cue text ("when · after coffee"), cue-time section badge (MOR/ANY/EVE)
- Per-habit checked state today; "done · HH:MM" timestamp when checked
- Per-habit "last · {today / yesterday / N days ago / N weeks ago / never}"
- Habits ordered morning → anytime → evening
- Total "rites on file" count
- Day-of-year, calendar date in the masthead
- "noticed" panel — surfaced pattern copy, confidence, sample size, source citation link
- Water prompt from body ("water — {reason}", "from body · gentle reminder")

### Patterns / detections
Tier-0 private-shape detectors (`detectors-tier0.ts`):
- **Externalization gap** (`detectExternalizationGap`) — habits with external cues stick; un-cued ones don't.
- **Luteal collapse (legacy)** (`detectLutealCollapseLegacy`) — completion drops in luteal phase.
- **Stress collapse (legacy)** (`detectStressCollapseLegacy`) — completion drops under stress signals.
- **Sensory flag** (`detectSensoryFlag`) — skip days clustering with sensory-discomfort mentions.
- **Interest hijack (legacy)** (`detectInterestHijackLegacy`) — multiple habits paused together when a new interest captures attention.
- **Fresh-start crash (legacy)** (`detectFreshStartCrashLegacy`) — habits created on landmark dates then go quiet.
- **Identity/trait framing (legacy)** (`detectIdentityTraitFramingLegacy`) — self-described as "not a [thing]".
- **Body vs cognitive (legacy)** (`detectBodyVsCognitiveLegacy`) — body habits land better than cognitive ones.
- **Habit drift (legacy)** (`detectHabitDriftLegacy`) — completion rate changing over recent fortnights.
- **Friction signature (legacy)** (`detectFrictionSignatureLegacy`) — a specific weekday where a habit stalls.
- **Sleep–habit coupling (legacy)** (`detectSleepHabitCouplingLegacy`) — short nights → lower completion.
- **Habit rebirth (legacy)** (`detectHabitRebirthLegacy`) — habits restarted after long pauses; "cyclical, not broken."
- **Self-talk coupling (legacy)** (`detectSelfTalkCouplingLegacy`) — harsh self-talk → completion drop afterward.

Tier-1 public-signal detectors (`detectors-tier1.ts`, surfaced in "noticed"):
- **Externalization requirement** (`detectExternalizationRequirement`) — cued habits at X% vs uncued at Y%; "cue your habits."
- **Luteal collapse** (`detectLutealCollapse`) — "your brain is different this week — completion drops ~X% in luteal phase. scaling expectations, not standards."
- **Sensory preflight** (`detectSensoryPreflight`) — "before prescribing the habit, prescribe the conditions" — N skip days clustered with sensory mentions.
- **Interest hijack** (`detectInterestHijack`) — interest capture detected, N habits paused together; offers to pause them officially.
- **Stress collapse** (`detectStressCollapse`) — deadline mentions + low sleep + completion drop; offers a "stress mode (somatic only)."

Phase-2 detectors (`detectors-phase2.ts`):
- **Fresh-start crash** (`detectFreshStartCrash`) — landmark-dependency in habit creation; restart re-entry is the leverage point.
- **Identity framing** (`detectIdentityFraming`) — you talked about not being a [thing] more than doing it.
- **Body vs cognitive** (`detectBodyVsCognitive`) — body habits land at X% / cognitive at Y%; body is the anchor.
- **Habit drift** (`detectHabitDrift`) — completing at X% this fortnight, was Y% the two before; "data point, not data trend."
- **Friction signature** (`detectFrictionSignature`) — habit "sticks on {weekday}s — completion drops X%→Y%; friction has a shape."
- **Sleep–habit coupling** (`detectSleepHabitCoupling`) — after <6h nights, completion drops to X%; "prosthetic environment beats willpower."
- **Habit rebirth** (`detectHabitRebirth`) — N habits restarted after long pauses; "habits don't die for you — they cycle."
- **Self-talk habit** (`detectSelfTalkHabit`) — after harsh self-talk, completion drops ~X% for ~N days.

Cross-module detectors (`detectors-cross-module.ts`):
- **Hyperfocus spillover** (`detectHyperfocusSpillover`) — long-focus days cost ~X% of next-day habit completion across N crashes; "crash and recovery, not failure."
- **Keystone anchor** (`detectKeystoneAnchor`) — on days habit A happens, habit B happens X% more often; the anchor habit.
- **Med-adherence coupling** (`detectMedAdherenceCoupling`) — on days you mention meds, habit completion runs X% above baseline.

Orchestrator-emitted:
- **Completion scan** (`scanCompletions`) — emits `habits:completed` per checked habit (with inferred category from cue-time).
- **Pattern recompute** (`recomputePatterns`) — runs the detector batch, emits `habits:pattern_detected`.
- **Morning check** (`emitMorningCheck`) — emits `habits:morning_check` at 9am.

---

## CROSS-SUBMODULE PATTERNS

Detections that deliberately span ≥2 body-cluster submodules. These are the connections "no single module could see on its own" and are surfaced in body's "across your modules" panel or each module's pattern feed.

### Cycle ↔ Body
- **Symptom × phase coupling** — body symptoms cluster in luteal phase (`detectSymptomPhaseCoupling`).
- **GI symptom × cycle phase** — gut complaints concentrate in one cycle phase (`detectGISymptomCyclePhase`).
- **Cycle-phase → energy** — focus/energy shifts with cycle phase (`detectCyclePhaseEnergy`).
- **Luteal × spending** — body correlation: spending rises in luteal phase (also touches finance).
- **`symptom_in_phase`** (`logic/patterns`) — a symptom tag clustering >60% in one phase across 3+ cycles.

### Cycle ↔ Sleep
- **Sleep × cycle phase shift** — bedtime shifts later in luteal phase (`detectSleepCyclePattern`).
- **Cycle-phase sleep coupling** — onset takes longer in luteal phase (`detectCyclePhaseSleepCoupling`).
- **`sleep_cycle_lag`** (`logic/patterns`) — TST drops ≥30 min in the days before each period across 3+ cycles.

### Cycle ↔ Habits
- **Luteal collapse** — habit completion drops ~X% in luteal phase (`detectLutealCollapse` / legacy).

### Sleep ↔ Body
- **Sleep-debt → focus quality** — short nights bleed into next-day focus (`detectSleepDebtFocusQuality`).
- **Sleep-debt symptom lag** — body-symptom mentions spike the day after short nights (`detectSleepDebtSymptomLag`).
- **Medication timing drift** (sleep) — med-to-bed gap drifting (also touches medication).

### Sleep ↔ Habits
- **Sleep–habit coupling** — after <6h nights, habit completion drops (`detectSleepHabitCoupling` / legacy).

### Sleep ↔ Medication / Body (caffeine + stimulants)
- **Caffeine→sleep correlator** — caffeine inferred from grocery/finance transactions correlated to sleep onset (`correlateCaffeineAndSleep`, `inferCaffeineFromTransactions`).
- **Caffeine cutoff** — caffeine-to-bedtime gap vs the 6h floor.
- **Stimulant sleep debt** — nights after stimulant-mention days take longer to onset.
- **Evening-matcha × sleep** — body correlation linking evening caffeine to sleep.

### Habits ↔ Medication
- **Med-adherence coupling** — habit completion runs higher on days meds are mentioned.

### Body ↔ Habits (water)
- **Hydration-drop → water habit** — body's `hydration_drop_detected` surfaces a gentle water prompt inside habits.

### Habits ↔ Work / Focus
- **Hyperfocus spillover** — long-focus days cost next-day habit completion.
- **Sleep × focus shift** — after short nights the deep-focus peak hour shifts (sleep pattern, work-facing).
- **Work-hyperfocus → body** — work's `hyperfocus_detected` writes "be gentle today" protective cards into body.

### Whole-cluster
- **Weekly review** (`computeWeeklyReview`) — a Sunday recap spanning water + supplements + habits completion.
- **Cross-module signal contract** (`shared.signals`) — only signals bridging ≥2 modules are surfaced; single-module observations are filtered out and live in each module's own "noticed" panel.
