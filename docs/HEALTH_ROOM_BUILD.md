# Health Room — Build Roadmap

Room 2 of the rooms redesign (Household shipped). Design fully signed off by Serra
2026-06-24. This doc is the single source of truth for the build; the workflow
fans out subagents against the three disjoint tracks below.

## PRD
- **Problem:** Health is 5 scattered modules (body, mood, sleep, medication, cycle).
  Merge them into one calm "health" room, fix the dead mood log, and give cycle +
  medication the surfaces their patterns deserve.
- **User:** Serra (ADHD, dogfooding on iPhone).
- **Main flow:** rooms tab → Health room → glance tile → drill into a sub-area →
  dump to update.
- **Where state lives:** existing per-module SQLite (sleep/cycle/body/medication/
  mood) + a NEW medication cabinet inventory table + intake log.
- **3 success criteria:** (1) a chore-free, calm health glance reads live; (2) cycle
  is a living olive tree; (3) medication has today(schedule) ↔ cabinet(stock).
- **NOT in v1:** no HealthKit, no step counting, no streaks, no movement cadence,
  no clinical cycle predictions/warnings, no separate mood screen, no postpartum
  detail beyond the existing pause toggle.

## Locked design decisions (from memory project_ollie_rooms_redesign)
- **mood → energy:** fold mood into the glance as ONE read-only "energy" tile.
  No separate mood screen. Mood gets a real consumer (the health glance).
- **medication:** existing SCHEDULE stays = the "today" tab (morning/evening doses,
  tick = taken). NEW "cabinet" tab = stock grouped BY PURPOSE (sleep · mood · pain ·
  digestion · vitamins · other) via a med/supplement→purpose map; amber "running low".
  As-needed meds do NOT pre-list on today (logged via dump). Low-stock = BOTH auto
  pill count-down (when qty + schedule known) AND a manual flag that overrides;
  degrade to manual-only when no qty entered.
- **cycle = a living olive tree** (DESIGN-LOCKED, port the mock exactly):
  grows a little each (other) day, fills with leaves, fullest around ovulation
  (bold olives appear), SHEDS leaves on the period, restarts as a sprout in the new
  cycle. Crown sits LOW on the branches (~190 leaves, small 3-tone), olives scattered
  via phyllotaxis (golden-angle + sqrt-radius, never a ring/clump), rooted in a SOIL
  MOUND with root-flare. Day number + phase BELOW the tree (not overlaid). Gentle
  canopy sway + leaf drift on period; honor prefers-reduced-motion. Keep flow chips +
  recent symptoms + cadence hint + pregnancy pause. No predictions/alarms (sensitive).
- **body tile:** glance shows water ("3 of 8") + movement/symptom presence; drills to
  existing BodyBox. Movement = activity + duration (NOT steps), no cadence/streak.

## Design references (READ before building)
- Tree (LOCKED): `~/Documents/ollie-cycle-tree.html` — port its `tree()` SVG logic +
  sway/drift CSS faithfully to React.
- Full health walkthrough: `~/Documents/ollie-health-walkthrough.html` — room glance,
  today, cabinet, sleep, body shapes.
- Cabinet (today + by-purpose): `~/Documents/ollie-medcabinet.html`.
- Room template to copy: `apps/native/src/rooms/HouseholdRoom.tsx`.
- Accordion/low-flag template: `apps/native/src/modules/grocery/aisles.ts` +
  `AisleAccordion`/`PantryList` in `GroceryBox.tsx`.
- Weekday-recurrence + purpose-map pattern: `apps/native/src/modules/chores/*`.

## Three disjoint build tracks (safe to run in parallel)
### Track A — Cycle olive tree  (owns: `apps/native/src/modules/cycle/*`)
- NEW `cycleTree.ts`: pure `cycleVisual(day, phase, bleeding) → {growth:0..1, shedding}`
  + tests. Growth ramps day1≈0.06 → ovulation peak ≈0.9 → luteal full → drops on period.
- NEW `CycleTree.tsx`: animated SVG component (port the mock; props growth/shedding/scale).
- EDIT `CycleBox.tsx`: replace the phase ring with `<CycleTree/>`; keep NowLine,
  CadenceHint, flow chips, recent symptoms, history, pregnancy pause.

### Track B — Medication cabinet  (owns: `apps/native/src/modules/medication/*`,
   `apps/native/src/router/schema.ts`, `workers/ai-proxy/src/router/dump-classify.ts`,
   `workers/ai-proxy/src/router/dump-schema.ts`)
- READ the existing medication module first (schedule = the "today" tab; keep it).
- NEW cabinet inventory: table `medication_cabinet` {id, name, purpose, doseLabel,
  qty?, lowFlag, createdAt} + intake log (timestamped "taken" events) if not present.
- purpose map (melatonin→sleep, ibuprofen→pain, vitamin d→vitamins, magnesium→sleep,
  sertraline→mood, omeprazole→digestion…), unknown→other.
- low-stock = BOTH (auto count-down + manual override; manual-only when no qty).
- handler actions (dump-driven): add to cabinet, set low/have, mark taken, started-X.
- router schema + worker dump-classify: route "took my magnesium" / "running low on
  vitamin d" / "started magnesium 400mg at night" to medication.
- UI: today ↔ cabinet two-tab screen (today = scheduled morning/evening, tick=taken,
  NO as-needed pre-list; cabinet = purpose accordions + amber low + dump bar).

### Track C — Health room + nav + mood bridge  (owns: `apps/native/src/rooms/*`,
   `apps/native/src/navigation/*`, `apps/native/src/modules/mood/*`)
- NEW `HealthRoom.tsx` at `/room/health` (copy HouseholdRoom pattern): glance tiles
  sleep · energy(read-only, mood-fed, NO drill) · cycle · body · medication, each with
  live values from existing repos + drill-in; offer = PatternCards (sleep/cycle/body/
  medication); per-room dump bar (2nd door → home `/`).
- nav: add Health room card to ModulesIndex (rooms), lift sleep/cycle/body/medication/
  mood out of the flat module list (like grocery/chores).
- mood bridge: read mood's latest energy into the glance energy tile (gives the dead
  mood log a real consumer). Read-only — no mood screen.

## Done-definition (clickable/testable)
1. Dump "i take magnesium 400mg at night for sleep" → cabinet shows it under "sleep" +
   evening schedule.
2. Dump "running low on vitamin d" → vitamin d flagged amber in cabinet.
3. Medication screen: today (scheduled, tick=taken, no as-needed pre-list) ↔ cabinet
   (purpose accordions).
4. Cycle screen = animated olive tree (grows by day, sheds on period), day+phase below,
   flow chips + symptoms intact; matches `ollie-cycle-tree.html`.
5. /room/health glance reads live, drills into each tile (energy read-only), offer +
   dump bar; reachable from rooms index; the 5 modules lifted out of the flat list.
6. All packages typecheck + all tests green; new tests for cycle growth-helper +
   medication purpose-map + low-stock.

## Guardrails
- Brain/body split: timing/state/reminders deterministic; LLM only interprets dumps +
  categorises purpose. Idempotent handlers (same dump twice → once).
- No fabrication: reflect real module behaviour; no invented metrics (no steps/streaks).
- Security: no leaked tokens, validate inputs, no unapproved irreversible actions.
- Build agents: run only your own focused module tests; do NOT run full `tsc` (sibling
  in-progress files cause false errors) — full verify happens in Integrate. Do NOT commit.
