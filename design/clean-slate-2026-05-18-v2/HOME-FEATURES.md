# HOME CLUSTER — FEATURE INVENTORY

Ollie's "home" cluster = the life-logistics modules. Three submodules: **admin**,
**pets**, **grocery**. Behavior-only inventory (no design). For each: Actions
(what the user can DO), Info/data (what facts it holds & shows), Patterns
(what the app computes/detects on its own).

Sources scanned: `apps/web/src/modules/{admin,pets,grocery}/`,
`packages/logic/src/{admin,pets,grocery}/`, `packages/orchestrator/src/{admin,pets,grocery}.ts`.

---

## 1 · ADMIN — "the stuff you forget about. passport, lease, taxes, dentist."

A task tracker for bureaucratic / renewal / appointment work, instrumented with
ADHD executive-function detectors.

### Actions

- Add a task — title, category (renewal / appointment / maintenance / financial / other), kind (task / renewal).
- Add a renewal — with an expiry date; sets `expiry_ts` so renewal cues fire.
- Add a waiting/ball task — set `ball_state` (MINE / THEIRS / WAITING) + ETA date.
- Set a task duration in minutes — feeds the 2-minute detector.
- Set a recurrence — monthly / quarterly / yearly / 2-yr / 5-yr / 10-yr.
- Add a free-text note to a task.
- Mark a task done (recurring tasks auto-roll the due date to the next cycle).
- Close the loop on a done task (separate from "done" — closes the open loop).
- Defer a task — increments `defer_count`, pushes due/expiry/ETA out 7 days.
- Delete a task.
- Filter the list — active / done / all (with live counts).
- Accept a detected phone task — turns the dump into a `phone_assist` task; ask for a call script.
- Split a paperwork task into GATHER + FILL subtasks (from a dump banner or an existing task).
- Accept a firehose dump — tick/untick candidate items, batch-add the selected ones as tasks.
- Resolve a defer-chain — route the stuck task to "phone", "form", or "confrontation" handling.
- Start a 2-minute burst session — steps through all sub-2-min tasks one at a time, marking each done.
- Accept / skip a recurring-annual cue — pre-fills the add form with the predicted renewal, or skips for the year.
- Dismiss any "noticed" pattern card (persisted to `patterns_dismissed`).
- Dismiss a reflected-from-elsewhere reminder; dismiss the open-loop banner.
- Attach a document reference (label + link) to a task — A14 cognitive-offload (logic-level).

### Info / data

- Task list — title, category, kind, state (active / done / closed / waiting), days-left countdown.
- Per-task ball state — MINE / THEIRS / WAITING and last-transition timestamp.
- Renewal expiry date + computed days-to-expiry.
- Defer count per task; duration in minutes; recurrence cadence.
- Done-at / closed-at / scheduled-at timestamps.
- "Due soon" banner — count of things due within 14 days.
- "Calls to make" cluster — all open `phone_assist` tasks, oldest-waiting first, capped at 50.
- "Reflected here" list — reminders forwarded from other modules (e.g. finance:reminder_set), due-sorted.
- Per-task document references (label + link).
- Stored decision rules (topic_key + chosen option) for the decision-recall feature.
- Scheduled-vs-done log (per category) backing the schedule-drift detector.
- Cost-of-delay text stored on a task.
- Research-citation sources attached to every pattern card (Masicampo, Barkley, Gollwitzer, Allen, etc.).

### Patterns / detections (A1–A15)

- **A1 open-loop-missing** — "you said 'I should…' but gave no when/where" → an unplanned intention is still costing working memory.
- **A2 phone-task detected** — dump mentions a call → "phone bundles every ADHD-aversive feature; want a script?"
- **A3 renewal cue** — staged cues at 90 / 30 / 7 / 0 days before an expiry → "X — N days, do this now/this week/today/overdue."
- **A4 paperwork-split** — a dump or task looks like paperwork → "split into GATHER + FILL stages."
- **A5 firehose dump** — one short high-entropy unload → "N candidate admin items, split into separate tasks?"
- **A6 defer-chain** — a task deferred ≥5 times → "deferred N×, phone? form? confrontation? — root, not laziness."
- **A8 two-minute tasks** — active tasks ≤2 min; ≥5 of them → "burst session?" / "do it now beats deferring."
- **A9 stale ball** — a THEIRS task untouched >14 days, or a WAITING task past ETA+3 days → "they've had it N days, nudge?"
- **A10 recurring-annual pattern** — ≥2 closures of a category spanning ≥10 months → "last year you did X this month, ready?"
- **A11 activation-cost / EF-tier** — tags each task tier 1–5 (1-click → phone) and matches it to the user's crash/flow/peak state → "good match" or "wrong task for now, try tier-N."
- **A12 last-5-percent** — task is `done` but never `closed` for >5 days → "form filled — but did you mail it?"
- **A13 recurring-decision recall** — a dump overlaps a stored decision rule on a decision-topic → "last time you went with X — same call?"
- **A15 schedule-drift** — a category scheduled ≥3× in a row but never done → "scheduling and doing are not the same thing."
- **appointment-completed transition** — a doctor/clinic/appointment task flips to done → emits a life-event signal (cross-module, feeds burhan/garden).

---

## 2 · PETS — "keeper's notebook"

A species-adaptive pet-care logbook for 10 species (guinea pig, rabbit, cat, dog,
hamster, rat, bearded dragon, leopard gecko, parakeet, betta fish), each with its
own care-task cadences, bonding profile, health-flag rules and vocabulary.

### Actions

- Add a pet — name, species (10-species picker), nickname, free-text notes.
- Archive a pet — stays in the log, reminders stop.
- Log a care task manually — per-species quick-pick buttons (hay refill, cage clean, vet checkup, feed, walk, UVB bulb check, water test, etc.); same pet+task within 60s acts as toggle-undo.
- Record an observation — weight (kg), free-text "what you noticed", species-specific behaviour quick-tags; the note text is what the health-flag engine scans.
- Mark a health flag as reviewed; dismiss a health flag.
- Review old pending flags from the >7-day drawer (mark reviewed / dismiss).
- Toggle Away mode — pauses all care reminders for ~3 days.
- Dismiss a behavioural "noticed" pattern card (persisted to `patterns_dismissed`).
- (Cross-module / dump-driven, logic-level) log care via brain-dump pet mention; declare an away trip ("away for N days"); start/close a hangout session with a pet.

### Info / data

- Pet roster — name, species display name, nickname, "solo" / "bonded pair" status, adoption date.
- Adoptversary line — "N years together" when today matches the adoption date.
- 30-day care strip — a row of filled/empty dots, one per day, filled = any care logged.
- "Due now" list — every overdue care task with days-since, the cadence interval, and a severity tag.
- Today forecast per pet — one line: "TONTIN TODAY — HAY REFILL, FLOOR TIME · 20 MIN FLOOR TIME".
- Recent observations (last 3) with relative timestamp and behaviour tags.
- Bonding guidance — build-rate (slow/fast/variable), min daily minutes, forget-window days.
- Health panel — flag name, days observed, species welfare note, citation source link.
- Milestones — first time a behaviour/observation tag was recorded for the pet.
- Weekly rotating editorial preface; weekly rotating species vocab term + gloss.
- Resident count + date in header; away-until date when away mode is on.
- Anti-guilt copy per overdue task — escalates nudge → soft → firm → concerned in deadpan voice.
- Species reference data (read-only): care-task cadences/critical days, social taxonomy, welfare flags (must-pair, solo-max-hours, min cage area), trust stages.

### Patterns / detections

- **care gaps** — per (pet × task), days-since-last vs cadence → severity ladder ok / nudge / soft / firm / concerned; cold-start (first 14 days) downgrades one notch.
- **guilt-trip copy** — generates the matching deadpan reminder line for each escalated gap.
- **today forecast** — rolls a pet's open gaps into one daily action line.
- **health flags** — observation text matched against species symptom signals on ≥3 distinct calendar days → "X observed across N days, consider a vet visit"; severity urgent / vet_soon / watch.
- **adoptversary** — detects the adoption anniversary.
- **milestone detection** — a new known observation tag never seen before for this pet → records a first-recorded milestone.
- **weather alerts** — outdoor temp vs species thresholds → small mammals can't thermoregulate >26°C; dog walks short outside −5…32°C.
- **P1 vet-cue schedule** — builds 14d / 3d / 0d booking cues anchored to an existing daily event.
- **P1 vet-adherence-delay** — a vet visit ≥1.5 cadences overdue → "yours runs on event-cued reminders, not avoidance — anchor a 60-sec call to a daily event."
- **P2 pet-as-co-regulator** — calm dumps land near the pet ≥1.3× more than without → "regulation outside the body costs less."
- **P3 care-activation-barrier** — ≥2 missed cycles of a task with no micro-step → "starting is the most expensive minute — name the 30-second first move."
- **P4 crash-context misses** — recent care misses cluster on flagged crash / sleep-debt / luteal days → "pet care breaks first because it's the most goal-directed task in the day."
- **P5 anthropomorphic projection** — "she's mad at me / holding a grudge" language, single dump or ≥4× a month → "pets run on present cues, not grudges — a sensitivity, not a flaw."

---

## 3 · GROCERY — pantry · shopping · recipes

A three-mode grocery tool: a shelf-life-aware pantry, a shopping list with
natural-language entry, and a recipe matcher.

### Actions

- Add an item by typing natural language — parser detects intent (ADD / BOUGHT / REMOVE), quantity, unit (EN + TR verbs).
- "Teach me this item" — when an unknown item is typed, pick its canonical from 12 staples; the override is remembered.
- Check off a shopping-list item — moves it into the pantry with a computed shelf life.
- Remove a shopping-list item.
- "Got everything" / sweep-all — bulk-moves every open list item into the pantry.
- Add missing recipe ingredients to the shopping list (one click from a recipe card).
- Search a recipe by name — Turkish + English dish aliases (mercimek çorbası, shakshuka, pasta…).
- Filter recipes by diet — all / vegetarian / vegan / mediterranean / turkish.
- Expand / collapse the "stocked" pantry shelf.
- Switch modes — pantry / shopping / recipes.
- (Cross-module, automatic) period-products auto-added to the list when a cycle period is logged, with a 5-min undo window.

### Info / data

- Shopping list — open items with name, category, added timestamp.
- "Recently bought" — last 6 pantry additions.
- Pantry, segmented into 3 shelves by remaining shelf life: **critical** (≤2 days), **watching** (≤7 days), **stocked** (>7 days).
- Per-pantry-item — name, category, bought timestamp, shelf-life days, an SVG fill-bar showing % shelf life left, and a "N days / today" label.
- Item categories — dairy, meat, deli, produce, drinks, pantry, cleaning, frozen, snacks, supplements, period_products, other.
- Canonical alias table — many spellings/languages → one canonical name + category + shelf-life default.
- Recipe table — dish → cuisine + ingredient list.
- Learned alias overrides from "teach me."
- Known-store list (logic-level) — lat/lng + visit count + last-seen, learned from GPS visits.
- Citation sources on each pattern (Altgassen, Barkley & Murphy, Wood & Neal, Kasper et al.).

### Patterns / detections

- **duplicate-buy** — a just-bought item is already in the pantry within its shelf life → "you got X N days ago, heads up."
- **expiration-drift** — pantry items within ~3 days of (or just past) expiry → "X turns soon — one breakfast away, or compost."
- **stockout-cascade** — same item rebought ≥3× in 60 days → "you keep buying X — promote to staple?"
- **interest-capture (E8)** — ≥3 *distinct* names in the same *non-consumable* category in 21 days → novelty/interest pattern (e.g. 3 keyboards), distinct from a consumable cascade → "N weeks of X — pattern, not medical."
- **stale-shopping-list** — ≥3 unbought items sitting on the list ≥14 days → "wishlist drift — clear what you don't actually want."
- **shopping-cadence** — ≥6 buy events / ≥3 trip-days in 90 days → "~N days between grocery trips on average."
- **recipe inference** — best-match recipe from pantry coverage (≥50% of ingredients), boosted by ingredients about to expire → "X? uses N items that turn soon" / "X? you have 4/6."
- **named-recipe lookup** — a typed dish name → cuisine + have/missing ingredient split.
- **known-store learning** — a GPS visit within 80m of a known store increments its visit count; otherwise registers a new store.

---

## Cross-submodule patterns

- **Shared "— noticed" pattern surface.** All three modules render a dismissable
  card list of computed pattern signals, keyed by a stable signal id and
  persisted to a `patterns_dismissed` map. Same idiom, three namespaces.
- **Orchestrator-computed, store-read, never-in-render.** Each module has an
  orchestrator (`admin.ts` / `pets.ts` / `grocery.ts`) that is the *only* caller
  of the pure logic detectors; it debounces on store changes (~500ms) and writes
  derived keys (`patterns`, `care_gaps`, `daily_forecast`, etc.). UI components
  read those keys and re-run logic only inside `useMemo` for cold-render fallback.
- **Brain-dump is a shared input pipe.** A free-text dump (`void:braindump:submitted`)
  fans out to all three: admin classifies open loops / phone tasks / paperwork /
  firehose, pets parses pet+care mentions and projection language, grocery parses
  add/bought/remove item intents.
- **Cross-module reminder reflection.** Reminders and life-events route between
  modules — finance reminders surface in admin's "reflected here" list; a logged
  cycle period auto-adds period products to the grocery list; admin's
  appointment-completed and pets' health flags emit life-event signals consumed
  by burhan/garden and the notification layer.
- **Time-based vs event-based cueing is the shared thesis.** Admin renewal cues,
  pet vet cues, and grocery expiration/cadence detectors all reframe time-blind
  ADHD failure modes as routing problems — anchoring time-due tasks to existing
  daily events rather than dates.
- **Anti-shame, research-cited voice.** Every pattern card carries a primary
  citation; copy is deadpan and explicitly frames misses as neurology, not
  laziness (admin defer-chain, pets P3/P4/P5, grocery interest-capture).
- **Severity / staging ladders.** Each module escalates by tiers rather than
  binary alarms — admin renewal stages (early/mid/urgent/overdue) + EF tiers 1-5,
  pets care-gap severity (ok→nudge→soft→firm→concerned), grocery pantry shelves
  (critical/watching/stocked).
