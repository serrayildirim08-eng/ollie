# Garden — Game Design Spec v1

Date: 2026-05-18
Branch: `garden-game-design`
Status: strategy locked, pre-build. No implementation yet.

> This doc is the canonical design reference for turning `/garden` from a
> passive 3D scene into a cozy, ADHD-safe game. It supersedes the *behaviour*
> described in `GARDEN_3D_SCENE.md` (that doc still describes the live 3D
> rendering infra, which we reuse).

---

## 0. The shift

Today `/garden` is a passive 3D scene: Burhan (a tree) grows by raw active-day
count, life events drop decorations on the canopy, a "water ollie" button
triggers a rain animation. The player only **looks and waters once**. That is a
screensaver, not a game.

This spec makes it a game — a **cozy, expanding garden** — without importing the
shame mechanics that make most "gamified" apps hostile to ADHD users.

---

## 1. Locked decisions

Settled across three strategising rounds with Serra (2026-05-17/18):

| # | Decision | Choice |
|---|---|---|
| 1 | Genre | Cozy idle **+** active tending — hybrid |
| 2 | Life bond | Mixed: real-life events generate resources **and** the player freely arranges |
| 3 | Scope | Expanding garden — each module unlocks its own **zone** |
| 4 | Economy | **Two resources**: `seed` (plant new) + `water` (grow existing) |
| 5 | Tending | **Slot-based** layout, with small in-slot freedom (plant type, colour) |
| 6 | Zone unlock | **Surprise** — a zone appears as a gift after the player uses a module |
| 7 | Pull/trigger | **Gentle invite** — a dismissible card after the player completes something |
| 8 | Burhan | Burhan **also** runs on the water economy — one consistent system |
| 9 | First-run | **Ready small garden** — Burhan sprout + one zone lightly pre-planted |
| 10 | ADHD-safety | No decay, no streak, no guilt, no badge counts. Garden is *always already pretty* |
| 11 | Consent gate | **Decided** — garden is consent-independent; un-gate from `consent.spending_research` (see §10) |

---

## 2. Core loop

```
   live your life
        │  (habits done, bills paid, appointments kept,
        │   cycle logged, focus sessions, etc.)
        ▼
   events become resources  ──►  seed + water accumulate (never expire)
        │
        ▼
   a gentle invite card appears  ("your garden has something new — peek?")
        │  optional · skippable · frequency-capped
        ▼
   open the garden
        │
        ├─ spend water  → grow Burhan + existing plants up a stage
        ├─ spend seed   → plant something new into an open slot
        └─ arrange      → pick plant type / colour within a slot
        ▼
   the garden visibly changes  ──►  quiet satisfaction  ──►  soft pull back
```

The loop is **forgiving by construction**: every step is optional, nothing is
lost by skipping, and the garden looks good at every point in the loop —
including before the player ever opens it.

---

## 3. Resource economy

Two resources. The split is deliberate and maps onto two kinds of real-life
behaviour:

| Resource | Earned from | Cadence | Spent on |
|---|---|---|---|
| `water` | **Showing up** — everyday repeated events: habit completed, bill paid on time, appointment kept, period logged, focus session finished | Frequent — trickles in daily | Growing Burhan and existing plants up a stage |
| `seed` | **Novelty** — first-time / milestone events: first use of a module, a milestone reached, a new habit type started | Occasional — arrives rarely | Planting a *new* thing into an open slot |

Why this split:

- **Water is always available** → the cozy idle base always has something to
  spend on. The player who just wants to show up and watch things grow never
  runs dry.
- **Seeds trickle** → expansion (new plants, filling zones) stays special and
  paced. Seeds are the "tend & decorate" layer; water is the "idle" layer.
- Both **bank indefinitely**. Disappear for two weeks → come back to a pleasant
  pile to spend, never a deficit.

Existing life-event → canopy-sprite mapping (`canopyPosition.ts`) stays; those
same events now *also* credit the resource ledger.

---

## 4. Zones — module = zone

The garden grows outward. Burhan stays at the centre; each module reveals its
own zone around him.

| Zone | Module | Flavour |
|---|---|---|
| **Burhan** (centre) | self / work / goals / focus | The hero tree — *you*. Everything you do feeds it indirectly |
| Herb & flower beds | habits | Many small plants — small repeated wins = small growing things |
| Orchard | finance | Fruit trees — a bill paid on time ripens fruit |
| Pond & flower bank | cycle / body | Water feature + soft blooms tied to the body module |
| Stone path & fences | admin | Structure — a kept appointment lays a stepping stone |
| Quiet corner / compost | dump (brain dump) | A still, low-pressure nook |

Each zone has a fixed **slot layout** (see §6). New zones **surprise-appear**:
after the player has used a module for a while, the zone quietly shows up next
visit — framed as a gift ("a new corner opened up"), never as a locked door the
player failed to open.

---

## 5. Burhan

Burhan keeps the five growth stages (`seedling → sapling → young → mature →
ancient`) and the existing stage GLBs. **What changes:** stage advancement is
now driven by **cumulative water poured into Burhan**, not raw active-day count.

- The existing `@ollie/garden` `stage.ts` thresholds get repurposed as
  *water-spent* thresholds (exact numbers tuned in build / balance phase).
- The current "water ollie" button becomes the real watering action, backed by
  the `water` balance.
- No decay: an un-watered Burhan simply waits at its current stage.

Decision #8 ("Burhan on the water economy") keeps the whole game on one
mechanic — no separate "active days" concept for the player to model.

---

## 6. Tending — slot-based with in-slot freedom

Decision #5. Each zone has a **fixed set of slots** at hand-placed positions
(guarantees the scene always composes well — no scattered, messy look, no
blank-canvas decision paralysis).

Within a slot the player gets **small, bounded freedom**:

- which plant goes there (from what their seeds afford),
- a colour / variant of that plant.

So the player gets real authorship and a garden that feels *theirs*, but cannot
produce an ugly or empty-looking result. Open slots glow softly when the player
has a seed to spend; they are an *invitation*, never a nag.

---

## 7. The gentle invite (loop trigger)

Decision #7. The garden does **not** push notifications and is **not** a daily
ritual. Instead:

- After the player completes a meaningful action in any module, **occasionally**
  (frequency-capped — not every time, that is nagging) a small, dismissible card
  appears: *"your garden has something new — peek?"*
- Tapping it opens the garden. Dismissing it costs nothing and is never held
  against the player.
- The card only appears when there is genuinely something new (resources to
  spend, a zone that just opened, a plant ready to grow) — never empty bait.

This is the only "pull". It respects the ADHD-safety rule: the garden invites,
it never demands.

---

## 8. First-run

Decision #9. A brand-new player opens the garden to a **ready small garden**:

- Burhan as a sprout, already standing.
- One zone (e.g. habits beds) already lightly pre-planted — 2–3 plants gifted.
- A small starting bank of `water` + `seed` so the very first visit has
  something to *do* immediately.

The first frame says *"this place is already nice, and it's yours"* — not
*"here is an empty plot, get to work."* Consistent with decision #10.

---

## 9. ADHD-safety guardrails (non-negotiable)

The single biggest failure mode for this feature is quietly becoming a **chore**
— "I have 40 seeds banked, 5 half-finished zones, I *should* go tend my garden."
That is the exact ADHD shame loop the whole product exists to avoid.

Hard rules, to be enforced in code review:

- **No decay.** Plants never wilt or die. Burhan never regresses.
- **No streaks.** No "days in a row", no reset-on-miss anything.
- **No guilt surfaces.** No "you haven't visited in X days", no red badge / count
  on the garden icon, no "X tasks waiting in your garden".
- **No deadlines / timers / urgency.** Nothing in the garden expires.
- **The garden is always already pretty.** Tending is icing, never debt. A
  half-filled zone reads as "room to grow", never as "unfinished".
- **Absence is rewarded, not punished.** Coming back after a gap = a pleasant
  bank of resources + a small "while you were away…" passive bloom, never a
  graveyard.
- **Every loop step is skippable** with zero penalty.

---

## 10. Decided — garden is consent-independent

A core game cannot live behind a research-consent wall.
**Decided (Serra, 2026-05-18): the garden is available to every user,
independent of research consent.**

Verified in code while building Phase 1: `/garden` is **already** auth-gated
only — the old `consent.spending_research` gate was removed in Sprint 6
(`App.tsx`: *"garden is now auth-gated only"*). `GARDEN_3D_SCENE.md` and the
2026-05-14 audit are stale on this point. No router change needed; the decision
is simply ratified — keep the garden un-gated.

---

## 11. Reuse vs. build-new

**Reuse as-is (rendering infra — see `GARDEN_3D_SCENE.md`):**
- `apps/web/src/garden/` 3D scene: `GardenCanvas`, `Ground`, `Sky`, `Lighting`,
  `Camera`, `Burhan`, and the decoration components.
- The 14 GLB assets already shipped under `public/models/garden/` +
  `public/assets/burhan/`.
- `@ollie/garden` package (`stage.ts`) — thresholds repurposed for water.
- Event bus → `burhan.events` → canopy sprites.

**Build new:**
- A **garden state model** (package): resource balances, zones, slots,
  plantings — persisted in the store.
- A **resource ledger** that listens to life events and credits `seed` / `water`.
- A **zone registry** + the surprise-unlock logic.
- The **slot system** + the tend/plant/grow interaction UI.
- The **gentle-invite card** + its frequency cap.
- First-run garden seeding.

The 3 currently-unused GLBs (`cypress`, `dry-stone-wall`, `hills`) become zone
scenery; new plant assets will be needed per zone (art pass, Phase 3).

---

## 12. Phased build plan

| Phase | Scope | Outcome | Status |
|---|---|---|---|
| **0 — Foundation** | Un-gate consent (§10). Garden state model + resource ledger wired to life events | Resources start accruing silently | ✅ done — consent already un-gated; `@ollie/garden` model + `garden-ledger.ts` shipped |
| **1 — Core loop** | Burhan on water. Earn + spend seed/water. One zone (habits) with slots, plant + grow interactions | The loop is playable end-to-end in one zone | ✅ done — placeholder build, see §13 |
| **2 — Expansion** | Surprise zone-unlock system. 2–3 more zones. First-run ready-garden seeding | The garden grows; new players land warm | first-run seeding done; zone-unlock + extra zones pending |
| **3 — Pull + polish** | Gentle-invite card + frequency cap. "While you were away" return moment. Art pass on new plant assets | The loop has its trigger; the garden feels alive | pending |
| **4 — Balance + safety** | Tune thresholds + earn rates. ADHD-safety audit against §9. Tests, perf pass | Ship-ready | pending |

---

## 13. Phase 0 + 1 build — what shipped (2026-05-18, branch `garden-game-design`)

Core loop is playable in the habits zone with **placeholder** plant art.

**`@ollie/garden` package — pure game model (31 tests passing):**
- `resources.ts` — `seed` + `water`, `creditForEvents()`, starting bank.
- `zones.ts` — `ZoneId`, slot layouts; `habits` zone has 6 wired slots, the
  other four zones are declared with empty slots for later.
- `state.ts` — `GardenState`, `Planting`, pure reducers (`plant`, `growPlant`,
  `waterBurhan`, `unlockZone`, `applyCredit`) + first-run `defaultGardenState()`.
- `stage.ts` — added `getStageFromWater()` for Burhan.

**`apps/web`:**
- `lib/garden-ledger.ts` — earns resources from `burhan.events`; booted in
  `store.ts`. Append-only + idempotent via `ledgerCount`.
- `garden/gardenStore.ts` — `useGarden()` hook + action functions.
- `garden/Plant.tsx` — **placeholder** procedural plant. Documented SWAP
  CONTRACT: when real GLBs land, replace only this component's body; props
  (`kind` / `variant` / `growth`) stay stable.
- `garden/HabitsZone.tsx` — 6 slots; empty slots show a ground-ring marker
  that brightens when a seed is affordable; filled slots show a `Plant`.
- `garden/GardenHud.tsx` — tiny seed/water readout + plant-picker bottom sheet.
- `Burhan.tsx` now reads `burhanWater`; `GardenScene` / `GardenCanvas` wired
  for slot + plant taps; "water ollie" pours 1 water into Burhan.

**Verified from code:** garden pkg 31/31 tests, web typecheck clean, web build
clean. **Needs Serra's eye (cannot verify without a browser):** slot/plant
placement, plant-tap raycasting, picker sheet, overall composition.

**Known follow-ups:** 3 pre-existing `CycleModule.ovulation.test.tsx` failures
(stale `getPlural` mock) — unrelated to the garden, present before this branch.

---

## Open questions for build kickoff

1. Which module's zone is the **first-run pre-planted** one — habits?
2. Do we want the resource balances visible as a small HUD, or surfaced only
   contextually when the player can spend them? (HUD risks looking like a
   scoreboard — leans toward contextual.)
3. Art: who produces the new per-zone plant GLBs, and when in Phase 3.

*Strategy session: Serra + Claude (Opus 4.7), 2026-05-17/18.*
