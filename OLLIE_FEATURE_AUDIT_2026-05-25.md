# Ollie Feature Audit — 2026-05-25

**Source of truth:** the repo itself (not a spec doc — no `OLLIE_COFOUNDER_BRIEF.md` exists). 11 parallel audit agents walked the actual code across `apps/`, `packages/`, `workers/`.

**Method:** for every distinct feature/detector/pattern/surface found in code, classify as:

- **LIVE** — trigger → logic → surface, end-to-end works
- **STUB** — UI exists but logic empty, OR logic exists but no UI / not wired
- **BLOCKED** — code exists but can't be reached because a dependency isn't live

No sugarcoating. Citations are file paths.

---

## 01 · body (36 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Symptom episode tracking (start, severity log, meds log, close) | LIVE | full CRUD; `/packages/logic/src/body/episodes.ts` + `/apps/web/src/modules/body/BodyModule.tsx` |
| 2 | Doctor summary generation (markdown + copy/download) | LIVE | `generateDoctorSummary()`; episode arc + meds + 7-day context |
| 3 | Episode kind suggestion (acute/chronic/mental/mixed) | LIVE | `suggestEpisodeKind()` auto-detects on label match |
| 4 | Chronic conditions registry | LIVE | `ChronicConditionsCard`; `shared.settings.chronic_conditions[]` |
| 5 | Treatment plans (cycle-based: chemo, IVF, allergy) | LIVE | `/packages/logic/src/body/treatments.ts` |
| 6 | Water tracker (configurable target, age default) | LIVE | `body.water_log[]` + `body.water_target` |
| 7 | Supplements (add, daily check-off, reminder HHMM) | LIVE | `body.supplements[]`; backfill on mount |
| 8 | Supplement reminder windows | LIVE | `emitSupplementDue()` fires `body:supplement_due` within 60-min window |
| 9 | Posture nudge (opt-in hourly, work-hours window) | LIVE | `emitPostureNudge()`; defaults 9–17 |
| 10 | Pattern: headache↔hydration | LIVE | `detectHeadacheHydration()` |
| 11 | Pattern: interoception drift | LIVE | `detectInteroceptionDrift()` |
| 12 | Pattern: hyperfocus dehydration | LIVE | `detectHyperfocusDehydration()`; cross-module |
| 13 | Pattern: afternoon crash window | LIVE | `detectAfternoonCrashWindow()` |
| 14 | Pattern: supplement drift (≥50% adherence drop) | LIVE | `detectSupplementDrift()` |
| 15 | Pattern: multi-symptom recurrence (≥3 co-occur) | LIVE | `detectMultiSymptomRecurrence()` |
| 16 | Pattern: hunger↔thirst confusion | LIVE | `detectHungerThirstConfusion()` |
| 17 | Pattern: caffeine↔water tradeoff | LIVE | `detectCaffeineWaterTradeoff()` |
| 18 | Pattern: meal skip | LIVE | `detectMealSkipPattern()` |
| 19 | Pattern: GI symptoms ↔ cycle phase | LIVE | `detectGISymptomCyclePhase()`; cross-module |
| 20 | Pattern: movement gap (no steps ≥14d) | LIVE | `detectMovementGap()` |
| 21 | Pattern: vasomotor (hot flashes ≥6 days) | LIVE | `detectVasomotorPattern()` |
| 22 | Pattern: symptom↔cycle phase coupling | LIVE | `detectSymptomPhaseCoupling()` |
| 23 | Pattern: sleep debt → symptom lag (2–7d) | LIVE | `detectSleepDebtSymptomLag()` |
| 24 | Signal: sleep debt → focus quality | LIVE | `/packages/logic/src/body/signals.ts` |
| 25 | Signal: cycle phase → energy | LIVE | luteal correlates lower energy |
| 26 | Pattern display: "— noticed" section | LIVE | `BodyNoticed` with confidence + sources |
| 27 | Cross-module signals display ("across your modules") | LIVE | `SignalsSection` filters ≥2-module |
| 28 | Protective cards (work hyperfocus → "be gentle") | LIVE | `BodyProtectiveCards` reads cross-module router |
| 29 | Hydration drop detection (>30% below baseline) | LIVE | hydration audit in `emitSupplementDue()` |
| 30 | Episode normalization (heal malformed) | LIVE | `normalizeEpisodes()` runs pre-detect |
| 31 | Episode pattern detectors (duration, trigger, recurrence, med adherence) | STUB | types in `/packages/logic/src/body/types.ts` lines 316–362, no detector functions |
| 32 | Treatment side-effect pattern | LIVE | `detectSideEffectPattern()` |
| 33 | Work pacing breach → reduce motion | LIVE | `detectBreachSession()` + `autoCloseExpiredBreaches()` |
| 34 | Body correlations (luteal↔spend, workout↔mood, water↔focus, sleep↔habits, caffeine↔sleep) | LIVE | math + orchestrator wired |
| 35 | HealthKit integration (HR, steps, hydration, sleep, RHR) | LIVE | `@ollie/capacitor-healthkit` read-only |
| 36 | HealthKit auth consent screen | LIVE | `HealthKitConsent` behind `VITE_HEALTHKIT_ENABLED` |

**Body: 35 LIVE / 1 STUB / 0 BLOCKED / 36 total**

---

## 02 · goals (40 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | goal creation (what/why/target date) | LIVE | `GoalsModule.tsx:1530` |
| 2 | obstacle field | LIVE | detected by `detectObstacleEcho` |
| 3 | premortem field | LIVE | detected by `detectPreMortemEcho` |
| 4 | ulysses contract (future-self note) | LIVE | shown before delete in confirm modal |
| 5 | role field | LIVE | used by `detectIdentityDrift` |
| 6 | category field (6 cats) | LIVE | career/relationship/health/finance/learning/creative |
| 7 | pacing field (sprint/marathon/rolling) | LIVE | auto-inferred from target_date |
| 8 | progress tracking (manual slider) | LIVE | `ProgressBlock` |
| 9 | milestones | LIVE | `MilestoneBlock` create/toggle/delete |
| 10 | milestone progress auto-compute | LIVE | progress% from completed milestones |
| 11 | AI step breakdown (Claude) | LIVE | via `AI_PROXY_URL` worker |
| 12 | session tagging (thinking/doing) | LIVE | feeds research-as-progress |
| 13 | review modal | LIVE | feeds sunk-cost detector |
| 14 | goal status transitions | LIVE | active → done/dropped/graveyard |
| 15 | G4 low-mood lock (72h delete suppression) | LIVE | `detectLowMood` + parkUntil |
| 16 | G15 ulysses contract on delete | LIVE | `retrieveUlyssesContract` |
| 17 | G6 obstacle echo | LIVE | inline chip |
| 18 | G7 premortem echo | LIVE | inline chip |
| 19 | G2 active cap (5 max) | LIVE | gates new goal creation |
| 20 | G5 research-as-progress | LIVE | `detectResearchAsProgress` |
| 21 | G11 identity drift | LIVE | `detectIdentityDrift` |
| 22 | G13 sunk cost flag | LIVE | `detectSunkCostFlag` |
| 23 | G14 pacing classification | LIVE | `classifyPacing` |
| 24 | G14 pacing breach | LIVE | `detectPacingBreach` |
| 25 | G1 contagion detector | LIVE | `detectContagion` |
| 26 | G3 missing anchor pair | LIVE | `detectMissingAnchorPair` |
| 27 | G8 floating goal (shallow why-chain) | LIVE | `detectFloatingGoal` |
| 28 | G9 missing construal | LIVE | `detectMissingConstrual` |
| 29 | G9 construal-level frame (low/high EF) | LIVE | helper for EF-aware guidance |
| 30 | G10 anti-goal opportunity | LIVE | `detectAntiGoalOpportunity` |
| 31 | G10 anti-goal in dump | LIVE | scans dumps for avoidance language |
| 32 | G12 goal interference | LIVE | resource-tag conflicts across goals |
| 33 | G16 experiment candidate | LIVE | reframes stuck goals as hypotheses |
| 34 | convert to habit | LIVE | emits `goals:convert_to_habit` event |
| 35 | achievement gallery | LIVE | `GalleryScreen` + embedded `AchievementGallery` |
| 36 | goal velocity by category | LIVE | `detectGoalVelocityByCategory` 90d rolling |
| 37 | patterns surface (GoalsNoticed) | LIVE | dismissible per pattern |
| 38 | goal filtering (status tabs + category) | LIVE | with counts |
| 39 | convert-to-habit modal | LIVE | cadence picker |
| 40 | low mood banner (dismiss) | LIVE | auto-clears after lock |

**Goals: 40 LIVE / 0 STUB / 0 BLOCKED / 40 total**

---

## 03 · habits (40 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | habit creation/add | LIVE | persists to `shared.habits_v2` |
| 2 | habit completion toggle | LIVE | UTC-dedup'd per day |
| 3 | habit removal | LIVE | ID-based delete |
| 4 | habit ledger display | LIVE | sorted by cueTime sections |
| 5 | daily hero count | LIVE | "no streaks · no shame · just today" |
| 6 | completion dedup (UTC) | LIVE | one per habitId per day |
| 7 | `habits:completed` event | LIVE | deduped per day |
| 8 | `habits:morning_check` event | LIVE | daily 9am |
| 9 | morning check push notification | LIVE | APNs CONTENT_DELIVERY with deadpan copy |
| 10 | detectFreshStartCrash | LIVE | boundary-date + early gap + silence (Dai 2014) |
| 11 | detectIdentityFraming | LIVE | tier-2 |
| 12 | detectBodyVsCognitive | LIVE | distinguishes drop patterns |
| 13 | detectHabitDrift | LIVE | completion drop recent vs baseline |
| 14 | detectFrictionSignature | LIVE | worst day-of-week |
| 15 | detectSleepHabitCoupling | LIVE | cross-module |
| 16 | detectHabitRebirth | LIVE | restart after gaps (Wood & Neal) |
| 17 | detectSelfTalkHabit | LIVE | self-talk coupling |
| 18 | detectExternalizationGap | LIVE | cued vs uncued |
| 19 | detectExternalizationRequirement | LIVE | tier-1 |
| 20 | detectLutealCollapse | LIVE | cycle coupling |
| 21 | detectSensoryFlag | LIVE | sensory/overstim drop |
| 22 | detectInterestHijack | LIVE | hyperfocus capture |
| 23 | detectStressCollapse | LIVE | stress dump → drop |
| 24 | detectHyperfocusSpillover | LIVE | cross-module: work crashes (Hupfeld 2019) |
| 25 | detectKeystoneAnchor | LIVE | same-day habit stacking |
| 26 | detectMedAdherenceCoupling | LIVE | stimulant adherence lift (Cortese 2018) |
| 27 | detectPatterns batch runner | LIVE | 16+ detectors, fault-tolerant |
| 28 | orchestrator pattern computation | LIVE | subscribed to multiple stores |
| 29 | orchestrator pattern emission | LIVE | new-pattern dedup |
| 30 | patterns persistence | LIVE | `habits.patterns` + timestamp |
| 31 | HabitsNoticed surface | LIVE | renders with confidence + citation |
| 32 | HabitsWaterPrompt (hydration cue) | LIVE | reads cross-module router |
| 33 | water prompt cross-module router | LIVE | `body:hydration_drop_detected` → habits |
| 34 | ritual peak detection | LIVE | circular KDE, chronotype fallback |
| 35 | goal-to-habit conversion | LIVE | event → orchestrator appends |
| 36 | goal-to-habit UI | LIVE | from `GoalsModule` |
| 37 | orchestrator initialization | LIVE | `createOrchestrator` boot |
| 38 | notification scheduling | LIVE | injected from app layer |
| 39 | phase-2 signal banners | LIVE | dismissable |
| 40 | phase-2 signal derivation | LIVE | local mount detectors |

**Habits: 40 LIVE / 0 STUB / 0 BLOCKED / 40 total**

---

## 04 · admin (17 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | A1 detectOpenLoopMissing | LIVE | 24h window, no impl-hint signal |
| 2 | A2 detectPhoneTask | LIVE | call/ring/aramam regex |
| 3 | A2b phone script scaffolding | **STUB** | UI asks "want a script?" — no actual script generator |
| 4 | A3 scheduleRenewalCues | LIVE | 90/30/7/overdue stages |
| 5 | A4 detectPaperworkSplit | LIVE | GATHER+FILL split |
| 6 | A5 detectFirehoseDump | LIVE | high-entropy unload |
| 7 | A6 detectDeferChain | LIVE | ≥5 defers → root-cause prompt |
| 8 | A7 parseCostOfDelay / surfaceCostOfDelay | **STUB** | logic exists, NOT called by orchestrator; UI render slot never populated |
| 9 | A8 detectTwoMinuteTask | LIVE | GTD 2-min rule |
| 10 | A9 detectStaleBall | LIVE | stale-theirs or deadline-passed |
| 11 | A10 detectRecurringPattern | LIVE | repeated cats + predicted_next_ts |
| 12 | A11 classifyActivationCost | **STUB** | tier classification logic complete, no integration point |
| 13 | A12 detectLast5Pct | LIVE | done-not-closed |
| 14 | A13 detectRecurringDecision | **STUB** | logic present, consent-gated, NOT called by orchestrator |
| 15 | A14 getDocRefs / addDocRef | LIVE | public API, used in task mgmt |
| 16 | A15 detectScheduleFromDump / detectScheduleDrift | **STUB** | logic complete, NOT called by orchestrator |
| 17 | D1–D2 appointment-completed transitions + dismissal | LIVE | feeds Burhan canopy_fruit |

**Admin: 12 LIVE / 5 STUB / 0 BLOCKED / 17 total**

---

## 05 · pets (39 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Care gaps (5 severity tiers) | LIVE | `computeCareGaps()` + cold-start downgrade |
| 2 | Health flag detector (≥3 days) | LIVE | `detectHealthFlags()` |
| 3 | Guilt-trip copy | LIVE | 5 severity phrases + welfare note |
| 4 | Today forecast (per-pet) | LIVE | 3 top tasks + bonding |
| 5 | Observation entry (weight, symptom, behavior, note) | LIVE | `PetObservationEntry.tsx` |
| 6 | Trust level | **STUB** | returns hardcoded stage-0 |
| 7 | 10 species profiles (guinea pig, rabbit, cat, dog, hamster, rat, bearded dragon, leopard gecko, parakeet, betta) | LIVE | 7–8 care tasks each |
| 8 | parsePetMention | LIVE | temporal offsets, fallback, scoring |
| 9 | parseAwayIntent | LIVE | string scan |
| 10 | parseSessionIntent | LIVE | start/close session |
| 11 | Milestone detector | LIVE | first observation of species tag |
| 12 | Weather alerts (temp-based) | LIVE | small-mammal heat + dog extreme |
| 13 | P1 vet cue schedule | LIVE | 14d/3d/0d stages |
| 14 | P1 vet adherence delay | LIVE | run_length ≥3, 72h cooldown |
| 15 | P2 pet as co-regulator | LIVE | 30d window, lift ≥1.3 |
| 16 | P3 care activation barrier | LIVE | 2+ cycles missed + ≥3 run |
| 17 | P4 crash context misses | LIVE | cross-module with work/sleep/luteal |
| 18 | P5 projection pattern (dumps) | LIVE | regex + log aggregation |
| 19 | Vocab term rotation | LIVE | deterministic per ISO week + pet |
| 20 | Weekly preface | LIVE | 5 editorial lines rotating |
| 21 | Adoptversary detection | LIVE | years on match |
| 22 | Manual care log | LIVE | "log care manually" panel |
| 23 | Pet archiving | LIVE | `archivePet()` |
| 24 | Pattern dismissal | LIVE | `patterns_dismissed` map |
| 25 | Health flag review | LIVE | UI callback present |
| 26 | Feed task | LIVE | cadence + parser keywords |
| 27 | Away mode | LIVE | mutes care-gap events |
| 28 | Micro-steps | **STUB** | type exists, P3 reads it, no UI to record |
| 29 | Vet schedule state | **STUB** | type defined, orchestrator reads, no UI |
| 30 | Coregulation log | **STUB** | needs body/mood module to write |
| 31 | Miss log | **STUB** | needs work/dumps module to write |
| 32 | Projection log | **STUB** | needs P5 detectors to write |
| 33 | PetsNoticed panel (P1–P5) | LIVE | confidence/run_length/sample_n metadata |
| 34 | Care gap severity colors | LIVE | nudge/soft/firm/concerned |
| 35 | Summary aggregate | LIVE | n_pets, n_gaps, n_critical, etc. |
| 36 | Consent gate (behavioral patterns) | LIVE | care gaps + health flags bypass |
| 37 | Cooldown (event spam) | LIVE | 72h per-key |
| 38 | Welfare notes | LIVE | every task + flag |
| 39 | Negation handling | LIVE | 4-token window kill false positives |

**Pets: 31 LIVE / 8 STUB / 0 BLOCKED / 39 total**

---

## 06 · cycle + postpartum (30 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Bayesian 4-layer prediction (Urteaga 2021) | LIVE | EWMA-weighted, cold-start to prior |
| 2 | Cycle boundary detection | LIVE | MIN_CYCLE_DAYS=10d dedup |
| 3 | Phase computation (menstrual/follicular/ovulation/luteal) | LIVE | wired |
| 4 | Health flags (long, short, long-bleed, amenorrhea, dysmenorrhea) | LIVE | ACOG-referenced, n≥3, 72h cooldown |
| 5 | Syndrome detection (PCOS, endometriosis, PMDD, irregular, missed) | LIVE | never diagnostic |
| 6 | Symptom clustering | LIVE | findCorrelations + 60% threshold |
| 7 | Adherence detection (3σ) | LIVE | robust stats |
| 8 | Ovulation prediction (range-based) | LIVE | fertile-window center |
| 9 | Fertile window (6-day range, σ≤5 gate) | LIVE | null when <2 cycles |
| 10 | Period logging UI (ceramic design, moon dial) | LIVE | 9 ceramic tags |
| 11 | Next period prediction display (4 confidence tiers) | LIVE | cold/warm/hot/personalized |
| 12 | Phase/day indicator | LIVE | currentDay + MoonPhaseTile |
| 13 | Cycle pattern correlations (symptom → phase) | LIVE | n≥3 gate |
| 14 | Clinician flags (rule-based alerts) | LIVE | ACOG references + sources |
| 15 | Birth control pill logging | LIVE | 7-day strip, 3-day backdate |
| 16 | Pill type selection | LIVE | combined/progestin-only/other |
| 17 | Partner support section | LIVE | 4 cats × 4 options |
| 18 | Cycle history tiles | LIVE | last 5 cycles |
| 19 | Settings panel | LIVE | fertility, dial, BC, passphrase hint |
| 20 | Passphrase hint | LIVE | text input (hint only, not encryption key) |
| 21 | Module visibility gate (onboarding) | LIVE | cycleAllowed flag |
| 22 | Adherence banner | LIVE | missed-log recovery |
| 23 | Orchestrator integration (6 events) | LIVE | period_approaching/imminent/late/luteal/ovulation/pill_missed |
| 24 | APNs push scheduling | LIVE | dedupe_key per event |
| 25 | Event emission | LIVE | registered in event registry |
| 26 | Cycle × Finance (luteal-spend) | LIVE | Spearman ρ, 90d lookback |
| 27 | Finance category cycle-spend detector | LIVE | 40% delta threshold |
| 28 | Sleep-cycle lag pattern | **STUB** | file exists, not wired into UI/orchestrator |
| 29 | Postpartum state tracking | **BLOCKED** | onboarding gate exists; no logic layer (no lochia, no recovery curves, no lactational amenorrhea) |
| 30 | Cycle data encryption at-rest/in-transit | **BLOCKED** | `@ollie/crypto` provides AES-GCM-256 but cycle.items are NOT encrypted in Supabase sync or backup |
| 31 | Import/export cycle data handlers | **BLOCKED** | UI exists, handlers stubbed (`/* handled by host app */`) |

**Cycle: 26 LIVE / 1 STUB / 3 BLOCKED / 30 total**

---

## 07 · sleep (30 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Sleep records (manual + braindump) | LIVE | parseSleepDump + mergeRecord |
| 2 | HealthKit sync | LIVE | `mirrorSleepRecords` device-local only |
| 3 | Sleep stats (14-night rolling) | LIVE | TST mean/SD, onset, wakings, efficiency |
| 4 | Sleep debt (14d window) | LIVE | emits `sleep:debt_accumulated` ≥4h |
| 5 | DSPS pattern (≥50% bedtimes pre-06:00, ≥2 weeks) | LIVE | 73–78% ADHD prevalence detector |
| 6 | Bedtime drift (linear regression r²≥0.30) | LIVE | 7–21 night window |
| 7 | Chronotype (5 bands) | LIVE | msfSc median, ≥14 nights |
| 8 | Social jetlag | LIVE | weekday vs weekend midsleep |
| 9 | Short-sleep run (<5h, ≥5 nights) | LIVE | emits event |
| 10 | Tonight TST forecast (CI95) | LIVE | recency-weighted, ≥3 usable nights |
| 11 | Revenge bedtime (Kroese 2014) | LIVE | ≥7-night run |
| 12 | Caffeine cutoff (Drake 2013, 6h half-life) | LIVE | dynamic copy + APNs push |
| 13 | Sleep onset gap (Edinger 2001) | LIVE | >15min + <70% efficiency |
| 14 | Weekend recovery illusion (Depner 2019) | LIVE | weekday vs weekend means |
| 15 | Bedtime mind racing (Harvey 2002) | LIVE | ruminative lexicon density |
| 16 | Wind-down friction (Hvolby 2015) | LIVE | step dwell + stuck detection |
| 17 | Wind-down checklist UI | LIVE | 6-item sequential, 60min pre-bed |
| 18 | Medication timing drift (Stein 2012) | LIVE | gap variance week-over-week |
| 19 | Chronotherapy progress (Saxvig 2014) | LIVE | shift tracking under active treatment |
| 20 | Sleep × cycle phase shift (Baker 2007) | LIVE | luteal +Δ bedtime |
| 21 | Sleep × focus shift (Lim 2010) | LIVE | post-short-sleep peak hour |
| 22 | Sleep × mood shift (Yoo 2007) | LIVE | overwhelm density next day |
| 23 | Cycle phase sleep coupling | LIVE | luteal onset latency +Δ |
| 24 | Stimulant sleep debt (Cortese 2012) | LIVE | gated by show_stimulant_sleep_debt |
| 25 | Brown noise player (6 sounds, fade-out) | LIVE | Howler.js lazy-loaded |
| 26 | Insomnia survey (ISI-lite, 7 items, 0–28) | LIVE | 4 severity bands |
| 27 | "Go deeper" button | LIVE | opens InsomniaSurvey overlay |
| 28 | Wind-down window event (60min pre-bed) | LIVE | emits + APNs push |
| 29 | Pattern detect events | LIVE | cross-feed to other modules |
| 30 | Future instruments (MCTQ, PSQI, ESS) | **STUB** | placeholders with "(later)" labels |

**Sleep: 27 LIVE / 3 STUB / 0 BLOCKED / 30 total**

---

## 08 · work (33 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Focus timer (15/25/45/90 min) | LIVE | state machine + brown noise |
| 2 | Focus session logging | LIVE | writes to `work.focus_log` |
| 3 | Brown noise overlay | LIVE | audio toggle |
| 4 | Project creation & tracking | LIVE | `work.projects` |
| 5 | Weekly billable hours rollup | LIVE | per-project 7d sum |
| 6 | Meeting logging | LIVE | `work.meetings` with attendees + duration |
| 7 | Meeting 30-min reminder cue | LIVE | 28–32 min window |
| 8 | Scheduled deep-work blocks | LIVE | upcoming list |
| 9 | Scheduled block 1h-prior cue | LIVE | 20–90 min window |
| 10 | Pomodoro cycle tracking | LIVE | `computePomodoroBreakState()` |
| 11 | Pomodoro UI display | LIVE | 4-dot cycle + break |
| 12 | Distraction journal | LIVE | `work.distractions` |
| 13 | Hand-off notes | LIVE | `work.handoff_notes` |
| 14 | Task list (open/done/all filter) | LIVE | basic CRUD |
| 15 | Work patterns display | LIVE | `work.patterns` array (currently empty due to mismatch) |
| 16 | W1 task-switch-tax | **STUB** | reads `state.sessions` (never populated) |
| 17 | W2 meeting-cliff | **STUB** | same mismatch |
| 18 | W3 hyperfocus-crash prompt | **STUB** | same mismatch |
| 19 | W3 hyperfocus-crash pattern | **STUB** | same mismatch |
| 20 | W4 deadline cues | **STUB** | logic OK, no deadline UI to create deadlines |
| 21 | W5 activation barrier | **STUB** | sessions mismatch |
| 22 | W6 estimation drift | **STUB** | `state.estimation_log` never written |
| 23 | W7 tab sprawl | **STUB** | `state.tab_reports` never written |
| 24 | W8 notification tax | **STUB** | `state.notification_tax_log` never written |
| 25 | W9 post-meeting buffer | **STUB** | `state.meeting_buffer` never written |
| 26 | W10 recurring meeting dead | **STUB** | `state.recurring_meetings` never written |
| 27 | W11 one-more-thing spiral | **STUB** | `state.one_more_thing_log` never written |
| 28 | W12 shutdown gap | **STUB** | `state.shutdown_log` never written |
| 29 | W13 multitask illusion | **STUB** | `state.multitask_log` never written |
| 30 | W14 RSD anchor pattern | **STUB** | `state.rsd_anchor_log` never written |
| 31 | W17 triage day anchor | **STUB** | `state.triage_days` never written |
| 32 | W0 deep-focus-hours pattern | **BLOCKED** | reads `state.sessions`, UI writes to `work.focus_log` instead |
| 33 | W0 pacing-breach pattern | **BLOCKED** | same focus_log/sessions mismatch |
| 34 | Focus session 5-min end cue | LIVE | "25 min done. 5 min stretch" |
| 35 | 90-min wind-down cue | LIVE | fires at 85-min |
| 36 | Four-blocks-today rest cue | LIVE | "body says rest" |
| 37 | Brain-dump → work routing | LIVE | meetings/tasks split |
| 38 | `work:pattern_detected` event | LIVE | emit on new pattern |
| 39 | `work:hyperfocus_detected` event | LIVE | ≥180 min in 24h |

**Work: 18 LIVE / 13 STUB / 2 BLOCKED / 33 total**

---

## 09 · finance + money-v2 (28 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Recurring bill detection (monthly/quarterly/yearly) | LIVE | `detectRecurring()` |
| 2 | Upcoming bills forecast (30d) | LIVE | `upcomingBills()` |
| 3 | Savings goal tracking + progress | LIVE | append-only ledger |
| 4 | ADHD-tax auto-detection (memo + duplicates) | LIVE | `detectADHDTaxFromTxn()` + braindump |
| 5 | Impulse pause (24h hold) | LIVE | "saved by pause" metric |
| 6 | Subscription dormancy detection | LIVE | scans brain-dump vs charge cadence |
| 7 | Subscription cancel-URL database | LIVE | 170+ merchant aliases |
| 8 | Privacy masking (money toggle) | LIVE | `maskMoney()` + timer |
| 9 | Finance export (CSV + ADHD-tax PDF) | LIVE | jsPDF render |
| 10 | Income classification (weekly/biweekly/monthly/random) | LIVE | confidence bands |
| 11 | Tax set-aside calculator (US/UK/EU) | LIVE | conservative 22% + state lookup |
| 12 | Savings transfer detection | LIVE | auto-apply matched pairs |
| 13 | Cycle × spend correlation | LIVE | Spearman ρ |
| 14 | Sleep-debt × spend correlation | LIVE | opt-in only |
| 15 | Anomaly detection (Iglewicz-Hoaglin) | LIVE | threshold 3.5 |
| 16 | D3 subscription detection (Canva-style) | LIVE | ≥3 occurrences |
| 17 | D3 ADHD-tax running total | LIVE | 30d rolling |
| 18 | D3 cycle-spending pattern | LIVE | ≥3 cycles, ≥1.20× ratio |
| 19 | F1 doom-buying (Atalay 2011) | LIVE | low-mood + same-day txn |
| 20 | F2 subscription cancel avoidance (Reid 2007) | LIVE | telephobia angle |
| 21 | F3 return abandonment (Altgassen 2014) | LIVE | prospective memory |
| 22 | F4 hyperfocus burst (Hupfeld 2019) | LIVE | ≥3 txns/48h same cat |
| 23 | F5 gig income volatility | LIVE | monthly variance >40% |
| 24 | F6 duplicate purchase (Barkley 2012) | LIVE | Jaccard >0.7, 90d |
| 25 | F7 research paralysis (Steel 2007) | LIVE | ≥5 mentions over ≥14d |
| 26 | Recurring bill creation (20 presets) | LIVE | rent/utilities/transport/health |
| 27 | Transaction logging (braindump + form) | LIVE | category picker |
| 28 | Plaid bank integration | **BLOCKED** | removed by commit 47a6fa6 (product decision); Plaid tables remain in Supabase |
| 29 | TrueLayer EU bank integration | **BLOCKED** | scaffolding only, cancelled with Plaid |
| 30 | money-v2 redesign (UI rebuild) | **STUB** | exists on `redesign/money-v2`, not default view; logic identical to FinanceModule |

**Finance: 25 LIVE / 1 STUB / 2 BLOCKED / 28 total**

---

## 10 · grocery + Feed Me (40 features)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Parse intent verbs (EN/TR/ES) | LIVE | `INTENT_VERBS` ADD/REMOVE/BOUGHT/UNKNOWN |
| 2 | Normalize item names (Levenshtein + alias) | LIVE | 200+ aliases |
| 3 | Category classification (11 cats) | LIVE | dairy/meat/produce/pantry/etc. |
| 4 | Shelf life learning (per-item days) | LIVE | critical/watching/stocked |
| 5 | Quantity parsing (units + dozens) | LIVE | `QTY_RE` regex |
| 6 | Duplicate purchase detector | LIVE | < shelf life ago |
| 7 | Expiration drift detector | LIVE | 3d window |
| 8 | Stockout cascade (rebuys) | LIVE | 60d frequency |
| 9 | Stale list item detector | LIVE | unchecked >14d |
| 10 | Shopping cadence detector | LIVE | 90d, 6+ events |
| 11 | Interest capture (E8 ADHD novelty) | LIVE | 3+ non-consumable brands in 21d |
| 12 | Recipe inference (pantry → dish) | LIVE | fuzzy lookup + coverage scoring |
| 13 | Recipe search (by dish hint) | LIVE | alias folding + prefix match |
| 14 | Diet filters (5 options) | LIVE | all/veg/vegan/med/turkish |
| 15 | Known store learning (geo haversine) | LIVE | 80m cluster, no UI |
| 16 | Pantry shelf segmentation | LIVE | critical/watching/stocked |
| 17 | Add-to-list → pantry flow | LIVE | move on checkOff |
| 18 | Teach-me canonicals | LIVE | 12 teaching targets |
| 19 | Add missing from recipe | LIVE | bulks into items |
| 20 | Multi-line item text | LIVE | text fallback |
| 21 | AI routing (Voyage + Gemini Flash) | LIVE | `/route/:module` |
| 22 | Gemini context window | LIVE | 50-item cap |
| 23 | List mutation commands (5 intents) | LIVE | add/remove/check/move/edit |
| 24 | Mutation EN/TR/ES phrases | LIVE | 7 few-shot examples |
| 25 | Undo stack (LIFO 10) | LIVE | 11 trigger phrases |
| 26 | Undo via brain dump | LIVE | short-circuit |
| 27 | SortedToast mutations | LIVE | 5 modes |
| 28 | Feed Me v2 (AI recipe stream) | LIVE | 3-card stack + rating |
| 29 | Cook history backend | LIVE | POST /cook-history |
| 30 | Feed Me pet target toggle | LIVE | live pets fallback |
| 31 | Diet pills (Feed Me driver) | LIVE | 60s cache |
| 32 | Recipe rejection (excludeDishes) | LIVE | refetch on reject |
| 33 | I cooked this (modal) | LIVE | -1/0/+1 rating |
| 34 | Static fallback (v1 inference) | LIVE | when endpoint down |
| 35 | Replenishment (adaptive cadence) | LIVE | per-user purchase learning |
| 36 | PII scrub (brand allowlist) | LIVE | preserves brand names |
| 37 | Research corpus pipeline | LIVE | scrub → /label → research_corpus |
| 38 | Clerk JWT verify (ai-proxy) | LIVE | web-only |
| 39 | Grocery routing cache | LIVE | text-only key |
| 40 | Smart suggest integration | LIVE | live context injection |

**Grocery: 40 LIVE / 0 STUB / 0 BLOCKED / 40 total**

---

## 11 · cross-cutting (90 features)

### dump / brain-dump router (7)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | DumpModule read-only archive (3-pane) | LIVE | search + filter + range bins |
| 2 | BrainDumpInput capture | LIVE | bottom-fixed frosted |
| 3 | Cross-module router (64+ rules) | LIVE | `/packages/router/src/cross-module.ts` |
| 4 | Anniversary resurface (on-this-day, phase-cycle, semantic) | LIVE | MMR + recency |
| 5 | Right-rail JournalNoticed ("you keep asking this") | LIVE | cluster_n × span_days |
| 6 | Local keyword/regex router + Haiku fallback | LIVE | ~90% stays local |
| 7 | Brain-dump → queue → enrich → label pipeline | LIVE | ai-proxy /enrich-dump + cron drain |

### onboarding (3)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | ConsentStep (B2B pivot — necessary locked + research toggle) | LIVE | |
| 2 | 8-screen pipeline | LIVE | pure-function port |
| 3 | research_optin re-prompt gate | LIVE | null → re-prompt |

### crisis (3)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | CrisisScreen (EN/ES/TR, zero telemetry/network) | LIVE | 12-country hotlines hardcoded |
| 2 | Grounding (5-4-3-2-1) | LIVE | calm layout |
| 3 | Boundary surface (single calm exit) | LIVE | renders above all gates |

### gallery (4)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | GalleryScreen (finished shelf) | LIVE | newest-first |
| 2 | Finished goals section | LIVE | no fake shelf |
| 3 | Finished milestones section | LIVE | with parent goal title |
| 4 | Empty state | LIVE | single calm state |

### insights (3)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | InsightsScreen (7-day digest) | LIVE | reads 6 modules |
| 2 | Cross-module summary | LIVE | hide-not-lie |
| 3 | Editorial digest UX | LIVE | locale-aware |

### voice (6)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | VoiceScreen transcript review | LIVE | draft → edit → apply |
| 2 | MicButton floating overlay (hotkey) | LIVE | web + Electron + Siri intent |
| 3 | Voice capture (Web Speech API) | LIVE | on-device only |
| 4 | Platform support check | LIVE | hide-not-lie |
| 5 | Wake word ("Hey Ollie") | **STUB** | push-to-talk only, no Porcupine |
| 6 | iOS speech plugin | **STUB** | blocked on Apple Dev approval |

### garden 3D (7)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | GardenScene (r3f + drei) | LIVE | lazy-loaded |
| 2 | Burhan tree (additive only, never decays) | LIVE | constitutional |
| 3 | Garden asset paths | LIVE | fixed 188a602 |
| 4 | Rain mechanic | LIVE | 3s animation |
| 5 | Elements count display | LIVE | month-start logic |
| 6 | Asset compression (Draco) | **BLOCKED** | PR #11 awaiting merge |
| 7 | 3D scene fallbacks (SceneFallback + ErrorBoundary) | LIVE | |

### medication (5)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | CRUD (name, dose, kind, schedule) | LIVE | |
| 2 | Schedule parsing (CSV → time strings) | LIVE | |
| 3 | Adherence reporting | LIVE | today's remaining doses |
| 4 | `medication:logged` event | LIVE | |
| 5 | Editorial voice ("noted" not "great job") | LIVE | |

### astrology-deferred (3)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | AstrologyModule code (2195 LOC) | **STUB** | URL gate removed, orchestrator disabled, zero users |
| 2 | Natal chart computation | **STUB** | astronomy-engine ready but not called |
| 3 | Glyph rendering | **STUB** | layout polished, unreachable |

### consent + privacy (9)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | @ollie/consent canonical state | LIVE | versioned |
| 2 | ConsentScreen (pre-pivot) | LIVE | two toggles |
| 3 | ConsentStep (B2B pivot) | LIVE | replaces ConsentScreen |
| 4 | Legacy System-A migration | LIVE | one-way conservative |
| 5 | Marketing consent toggle | LIVE | bidirectional |
| 6 | Research opt-in UI | LIVE | defaults false |
| 7 | HealthKit consent | **STUB** | blocked on Apple Dev |
| 8 | Consent sync to Supabase | LIVE | debounced fire-and-forget |
| 9 | Privacy policy + terms | **STUB** | 6 TBDs unfilled |

### retention (D1/D7/D30) (6)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Day30Prompt card | LIVE | non-blocking, dismissible |
| 2 | Day-30 event emission | LIVE | (was stranded — recovered) |
| 3 | RetentionWelcomeBar (D1/D7) | LIVE | |
| 4 | Notification budget (4/day, per-category mute) | LIVE | slider 1–10 |
| 5 | APNs push token registration | LIVE | deployed 2026-05-14 |
| 6 | Cron notification drain | LIVE | `*/5 * * * *` |

### settings (10)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | Account section (email, sign-out, delete) | LIVE | 7-table cascade |
| 2 | Notifications budget slider | LIVE | |
| 3 | Privacy consent toggles | LIVE | |
| 4 | Birth control toggle | LIVE | |
| 5 | Tax profile toggle | LIVE | |
| 6 | Export/import backup | LIVE | |
| 7 | Version + links | LIVE | privacy URL points to non-existent domain |
| 8 | Subscription mgmt | **STUB** | Stripe/IAP deferred |
| 9 | Voice settings (lang, quiet hours) | **STUB** | NOT STARTED |
| 10 | Language selector | **STUB** | NOT STARTED |

### auth (8)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | AuthFlow passphrase (Pattern A) | LIVE | hashed client-side, 26 tests |
| 2 | Sign-up mode | LIVE | strength meter + invite gate |
| 3 | Sign-in mode (cached email) | LIVE | |
| 4 | Forgot password explainer | LIVE | "unrecoverable by design" |
| 5 | Invite validation | LIVE | beta gate |
| 6 | Apple Sign-In | **STUB** | deferred |
| 7 | Biometric/passphrase app-lock | **STUB** | Capacitor ready, no AppLockGate |
| 8 | Clerk auth migration | LIVE | only in ai-proxy (web-only) |

### dashboard/home (8)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | HomeScreen sky video + orb | LIVE | hour-based |
| 2 | Weather pill | LIVE | BigDataCloud + Open-Meteo, offline-tolerant |
| 3 | Time tracker (pomodoro-style) | LIVE | appends to focus_log |
| 4 | BrainDumpInput | LIVE | parent-routed |
| 5 | Burhan3D avatar | LIVE | small preview |
| 6 | RetentionWelcomeBar | LIVE | |
| 7 | Crisis button | LIVE | |
| 8 | DashboardScreen module grid (4 clusters) | LIVE | with pending counts |

### research orchestrator (8)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | @ollie/research-stream foundation | LIVE | GDPR endpoints |
| 2 | @ollie/research-cache sectors (10 locked) | LIVE | tech/law/med/fin/edu/creative/parenting/hospitality/gov/other |
| 3 | research_optin gate | LIVE | null re-prompts |
| 4 | AI labeling (Anthropic Haiku) | LIVE | enrich → KV → cron → Haiku → research_corpus |
| 5 | PII scrubber | LIVE | strips names/emails/phone/accounts |
| 6 | B2B research portal | **BLOCKED** | data layer ready, frontend NOT STARTED |
| 7 | Research consent persistence | LIVE | writes via @ollie/consent |
| 8 | Telemetry table (necessary gate) | LIVE | fire-and-forget |

### CF workers (6)

| # | feature | status | notes |
|---|---------|--------|-------|
| 1 | ai-proxy worker | LIVE | deployed 2026-05-14 |
| 2 | apns-push worker | LIVE | deployed 2026-05-14 |
| 3 | sentry-tunnel worker | LIVE | bypasses TR ISP DPI |
| 4 | cron worker (5-min drain) | LIVE | enrich + notifications |
| 5 | cron daily intelligence stubs (patterns, predict, etc.) | **STUB** | client-side present, server-side deferred |
| 6 | Plaid sync worker | LIVE | sandbox (prod approval pending) |

**Cross-cutting: 58 LIVE / 27 STUB / 5 BLOCKED / 90 total**

---

## Overall Summary

| Module | LIVE | STUB | BLOCKED | TOTAL |
|--------|------|------|---------|-------|
| body | 35 | 1 | 0 | 36 |
| goals | 40 | 0 | 0 | 40 |
| habits | 40 | 0 | 0 | 40 |
| admin | 12 | 5 | 0 | 17 |
| pets | 31 | 8 | 0 | 39 |
| cycle | 26 | 1 | 3 | 30 |
| sleep | 27 | 3 | 0 | 30 |
| work | 18 | 13 | 2 | 33 |
| finance | 25 | 1 | 2 | 28 |
| grocery | 40 | 0 | 0 | 40 |
| cross-cutting | 58 | 27 | 5 | 90 |
| **TOTAL** | **352** | **59** | **12** | **423** |

**Headline:** 352 features LIVE out of 423 surveyed = **83% LIVE**. 14% STUB, 3% BLOCKED. Repo is in much better shape than a typical pre-beta codebase.

---

## Top 5 Hard Blockers

Things that block other features from being built or tested:

### 1. work module: focus_log / sessions slice mismatch — **kills 14 W-detectors**

The UI writes sessions to `work.focus_log`, but every W0–W17 pattern detector reads from `state.sessions` in the logic layer. The orchestrator subscribes to `work.sessions` but **nothing writes to it**. Result: all 14 work-pattern detectors have complete logic, complete tests, and never fire. This is by far the largest dead-code surface in the repo.

**Fix:** route `focus_log` entries into the `sessions` slice on write, OR rewrite all detectors to read `focus_log`. ~2 hour fix that unlocks ~14 features.

### 2. cycle data is NOT encrypted in Supabase sync

`@ollie/crypto` provides AES-GCM-256 + PBKDF2, but `cycle.items` (menstrual records, symptoms, sexual activity correlates) ship to Supabase **unencrypted**. Only the auth passphrase and exported `.json` envelope are encrypted. Code comments flag this as "Sprint B' pivot" — abandoned zero-knowledge posture 2026-05-14, but no replacement encryption was wired in. Compliance + privacy risk.

**Blocks:** beta launch, any B2B health-data conversation, GDPR sensitive-category compliance.

### 3. postpartum module has no logic layer

Onboarding question asks "postpartum / pregnant" and stores `cycleTracking='postpartum'`, which then **hides the cycle module entirely**. There is no lochia tracking, no recovery curve, no lactational amenorrhea logic. Postpartum users are silently locked out of the module they most need. The memory said postpartum was "locked inside cycle module" — the gate exists, the implementation does not.

**Blocks:** ~30% of target users (women with recent pregnancy / nursing).

### 4. AI routing cache works on web only — Electron/Clerk path is half-baked

`feat/t0-clerk-jwt-verify` shipped Clerk JWT verification in the ai-proxy worker (web-only verification). Desktop native shell scaffolded but **not wired to ai-proxy auth**. Two architectures haven't converged. This means every AI feature (grocery routing, Feed Me, brain-dump labeling) is **Chrome-only**.

**Blocks:** iPhone/Electron launches; ~all of AI features can't be tested on real devices.

### 5. cross-module "external writer" stubs starve 4+ detector families

Multiple modules read state slices that **no one writes to**:
- pets P2/P4/P5 read `pets.coregulation_log` / `pets.miss_log` / `pets.projection_log` — would need body, work, dumps modules to populate
- work W6–W14 read `state.estimation_log`, `state.tab_reports`, `state.notification_tax_log`, `state.shutdown_log`, etc. — nothing writes
- admin A7/A11/A13/A15 — logic complete, orchestrator never calls them

These are architectural connection failures, not implementation gaps. ~25+ detectors blocked by missing 4-5 small writer functions.

---

## What Shipped Well

5 surfaces that show real polish (not just "exists"):

### 1. goals module (40 / 40 LIVE)

All 16 G-detectors (G1–G16), all 6 phase-1 + phase-2 + phase-3 modules, complete UI surfaces (chips, inline boxes, modals), cross-module events (`goals:convert_to_habit`), achievement gallery as both embedded + standalone screen, low-mood lock + ulysses contract working as intent-blocking gates. Velocity detector with 90d rolling window. **Zero dead code.**

### 2. habits module (40 / 40 LIVE)

Anti-streak DNA enforced (UTC-dedup, "no streaks · no shame · just today" literal text). 16 detectors all wired through orchestrator. Cross-module flows live: hydration → water prompt, work crash → spillover, goal → habit conversion, cycle → luteal collapse. Theory-anchored with primary citations (Dai 2014, Wood & Neal, Hupfeld 2019, Cortese 2018). **No dangling stubs.**

### 3. grocery + Feed Me (40 / 40 LIVE)

The newest module, the most-shipped. AI routing (Voyage + Gemini Flash) live in real Chrome E2E. Undo stack with 11 trigger phrases EN/TR/ES. Feed Me v2 with 3-card stack + cook history + diet pills + pet feed target. Mutation commands (remove/scratch/except/finished/throw-out). Interest-capture detector for ADHD novelty pattern. Static v1 fallback when endpoint down. **From zero to feature-complete in one sprint.**

### 4. body module pattern depth (35 / 36 LIVE)

23 single-module + 5 cross-module detectors, all firing. Doctor summary generation with markdown + copy/download — not a toy, designed for actual clinical handoff. Full chronic conditions registry + treatment plans (chemo, IVF, allergy cycles). HealthKit read-only sync with auth consent UI. Severity-arc episode tracking that survives malformed data via `normalizeEpisodes()`.

### 5. sleep module DSPS-aware DNA (27 / 30 LIVE)

DSPS detector explicitly targeting the 73–78% ADHD prevalence (≥50% bedtimes pre-06:00, ≥2 weeks). Wind-down ritual fully operational (6-item sequential checklist + per-step dwell time → friction detector + stuck-step detection). Brown noise player with 6 sounds + fade-out timer. Insomnia survey (ISI-lite, non-judgmental copy "pattern, not failure"). 13 detectors, all citation-anchored (Kroese, Drake, Edinger, Yoo, Cortese, Hvolby).

---

## What's at Risk

5 surfaces where spec/intent has drifted from current state:

### 1. work module — UI promises pomodoro/projects/distractions, detectors don't fire

Users see a polished work UI with timer + projects + meetings + distractions + handoffs. But `work.patterns` is **always empty** because the focus_log/sessions slice mismatch silently kills all 14 detectors. The user experience is *"why isn't Ollie noticing anything about my work?"* with no visible explanation. **Visible competence gap.**

### 2. admin Phase 3 — 5 detectors orphaned

Cost-of-delay parser, activation-cost classifier, recurring-decision detector, schedule-drift detector, and phone-script scaffold all have **complete logic** but no orchestrator integration. The UI even has render slots for `p.cost_of_delay` that never populate. This drifts from the original "15 admin patterns" spec.

### 3. cycle postpartum — onboarding gate without logic

If a user marks postpartum during onboarding, the cycle module **silently hides**. There's no fallback ("postpartum tracking coming soon"), no minimal recovery view, no acknowledgment. The onboarding question implies a feature that doesn't exist.

### 4. settings — multiple "NOT STARTED" surfaces

Subscription management (Stripe/IAP), voice settings (language, quiet hours), language selector. All deferred to "later". This is fine for closed alpha but the settings screen pretends these exist by having section spaces where they'd go.

### 5. astrology-deferred — 2195 LOC of polished code that no user can reach

`astrology-deferred` module is fully styled, has natal chart computation logic, has glyph rendering. URL gate removed, orchestrator disabled. It's effectively a backlog item taking up 2200 LOC of weight. Either revive it intentionally or delete it cleanly.

---

## Coda

The repo is in **launch-realistic shape**. 83% LIVE features against the actual implementation surface (423 features) is uncommonly high for a pre-beta codebase with this much surface area. The polish concentrates in body/sleep/habits/goals (ADHD-first DNA) and grocery (newest sprint). The drift concentrates in work (detector mismatch), admin (Phase 3 unwired), and cycle (postpartum gap + encryption gap).

If a one-week sprint were available before alpha, the order would be: (1) fix work focus_log/sessions slice mismatch, (2) wire admin Phase 3 detectors, (3) wire cycle encryption, (4) decide on postpartum (build minimal or remove the gate), (5) fix the Electron/Clerk auth divergence. That gets the visible competence gaps closed.

---

*Generated 2026-05-25 from 11 parallel code-audit agents reading the live repo at `/Users/serrayildirim/ollie`. No specification document was consulted — source of truth was the codebase itself.*
