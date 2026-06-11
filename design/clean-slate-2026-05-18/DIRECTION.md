# Ollie — Clean-Slate Design Direction

**Date:** 2026-05-18
**Method:** designed from a blindfold. The codebase was read for *behavior only* —
routes, modules, logic detectors, orchestrators, event registry, notification
constitution, data types. No stylesheet, token file, component layout, color,
font, or "design DNA" was looked at. If anything here resembles the shipping
app, that is coincidence, not inheritance.

---

## 1. Feature inventory (capabilities, raw — not screens)

Read from `router.tsx`, `modules/*`, `packages/logic/*`, `packages/orchestrator/*`,
`packages/notifications/*`, `packages/events/registry.ts`.

### Things the user can DO

**Capture (get stuff out of the head)**
- Type a raw, unstructured "brain dump" — any sentence, any domain, mixed.
- Speak a brain dump — voice transcription, same routing path.
- The dump is auto-classified into one or more life domains, and structured
  rows are written to the right place (`braindump-dispatch.ts`: finance gets
  sub-classified into records/bills/subscriptions/goals/adhd_tax).
- A "receipt" is produced — proof of *where* the thought landed.

**Domain logging (12 domains)**
- Finance: log spend/income, bills, subscriptions, savings goals, "ADHD tax"
  events (late fees, replacements, unused, duplicate buys), tax set-aside.
- Body: water log, supplements, symptom episodes (open/close/severity), treatment plans.
- Sleep: log a night, wind-down checklist (6-step bedtime ritual), Epworth/insomnia surveys, sounds.
- Medication: doses, adherence.
- Cycle: log period/symptoms, ovulation, pill tracking, predicted next period.
- Work: tasks, focus sessions (15/25/45/90 min), deadlines, meetings, shutdown ritual.
- Goals: long-term goals, milestones, sessions, reviews, convert-goal-to-habit.
- Habits: daily/weekly habits, completion, resets at midnight.
- Admin: renewals, appointments, phone-call tasks ("the dreaded call").
- Pets: care tasks, meds, vet, observations, milestones, away-mode.
- Grocery: pantry, lists, recipes, duplicate-buy detection.
- Dump/Journal: free-text journaling, entry archive, resurfacing.

**Review what the app noticed**
- Insights screen: cross-module pattern cards (caffeine→sleep lag, luteal
  collapse, post-payday spend spike, sleep→mood lag, etc.).
- Gallery: a visual archive (observations, photos, milestones).
- Garden: a gamified growth surface — a thing that visibly grows as you use the app.

**Survive a bad moment**
- Crisis screen: reachable from *any* app state (mounted above all gates),
  shows hotlines localized to the user's country, calm copy. No data entry asked.

**Settings & trust**
- Onboarding (7 skippable questions: name, age range, country, locale…).
- Consent (necessary + research opt-in + marketing — explicit, granular).
- Face ID / biometric app-lock (a privacy curtain, opt-in).
- Notification permission priming (asked once, deliberately, after onboarding).

### Data it holds & relationships
- ~14 store slices, one per domain, plus a `shared` slice (signals, patterns,
  action-log, settings). All local-first (localStorage), optional cloud sync.
- Cross-domain links are real: cycle ↔ finance (luteal spend), cycle ↔ sleep,
  sleep ↔ mood, caffeine ↔ sleep, meds ↔ habits. The *connections between
  domains are the product*, not the domains themselves.

### Entry points (how content gets in)
1. Typed brain dump (primary).
2. Voice capture (primary, hands-free).
3. Per-domain structured forms (secondary).
4. Sensors / HealthKit adapter (`capacitor-healthkit` package exists).
5. Notifications tapped → deep link into a domain.

### Automations (what the app does on its own)
- A notification engine with a hard *constitution*: only 3 categories are even
  *typable* — `REMINDER`, `PATTERN_ALERT`, `CONTENT_DELIVERY`. Re-engagement,
  streak-guilt, "you haven't…" pushes are **structurally banned** — there is
  no category for them. This is the soul of the product.
- ~100+ pattern detectors run silently across modules (habits alone has ~30).
- A cue/prompt engine (`logic/prompts`) that surfaces *one* relevant in-app
  prompt when a domain is stale enough to matter — JITAI-grounded, rate-limited
  6h, never repeats the last 20.
- Orchestrators recompute predictions, care-gaps, anomalies on store changes.
- Notification budget + per-category mute + dedupe + quiet-hours suppression.
- Guilt-copy generator for pets is *deliberately* tuned to be gentle, not punishing.

---

## 2. The user & the core job

**Who:** an adult with ADHD. Time-blind, low executive function on a bad day,
prone to overwhelm, working memory that drops things. Has likely been failed
by every "productivity app" — they all assume a brain that can plan, sustain,
and feel guilt productively. This one cannot, and that is not a defect to fix.

**Emotional state when opening the app:** *mid-spiral.* Something just occurred
to them — a bill, a worry, a task, a symptom — and it will be **gone in 8
seconds** if it is not caught NOW. They are not arriving to "plan their day."
They are arriving to *put something down before they lose it.*

**The single core job:**
> **"Catch the thing in my head before it's gone, and trust the app to put it
> where it belongs so I never have to hold it again."**

This is an **externalization** product. The brain is the unreliable narrator;
the app is the reliable memory. Twelve domains are just *drawers* — the user
should almost never have to *choose* a drawer. They should be able to throw.

**Highest-frequency actions (in order):**
1. Capture a raw thought (type or speak) — many times a day.
2. Glance at "what did I capture / what's coming" — quick reassurance.
3. Tick off / log a known thing (took meds, drank water, paid bill).
4. Read one pattern the app noticed — occasional, dopamine.
5. Reach safety in a crisis — rare, must be instant.

---

## 3. Information architecture, from zero

The current build files things by *engineering module* — 12 equal tiles on a
dashboard grid, each domain a peer. That is a **filing-cabinet IA**. It makes
the user *choose a drawer* before they can put a thought down. For a brain
that is mid-spiral, the drawer-choice is the moment the thought is lost.

This redesign inverts it. The IA has **three layers**:

### Layer 0 — The Catch (always present, zero taps, never a "screen")
A persistent capture surface lives at the bottom of *every* screen — a single
input that takes text or voice and does not ask which domain. It is the home
base. Capture is not a destination you navigate to; it is the floor you stand on.

### Layer 1 — Primary (one tap, the only three things in the nav)
- **Now** — the landing surface. *What just got caught, what is coming up
  today, what the app wants to gently tell you.* A single chronological-ish
  stream, not a grid. This is "review what I captured + what's next."
- **Catch** — the full-screen capture mode (text + big voice button). Reachable
  by tapping the always-present mini-bar. Exists as a real screen because voice
  capture deserves a calm, full-bleed surface with nothing else on it.
- **Noticed** — everything the app figured out on its own: patterns, insights,
  the garden's growth. The reward layer. Merges today's *Insights* + *Garden*.

### Layer 2 — Secondary (two taps — reached *from* a thing, not from a nav)
- **Domains** — the 12 life areas. NOT a top-level destination. You land in a
  domain because you tapped a caught item, a cue, or a pattern that belongs to
  it — or via a search/jump sheet. The domain detail is where structured forms,
  history, and per-domain logic live.
- **Settings, consent, app-lock, onboarding** — accessed from a profile affordance.

### Layer 3 — Ambient (NO screen at all)
- Pattern detection, the notification engine, cue scheduling, orchestrator
  recomputation, the research pipeline. The user never "visits" these. They
  only ever see their *output* — a card in *Noticed*, a cue in *Now*, a
  (rare, factual) push. Correct: these are infrastructure, not navigation.

**What this IA deliberately demotes:**
- The 12-tile dashboard grid → gone as a top-level screen. Domains are a
  drill-down, not a home. *The product is not 12 trackers; it is one catcher.*
- "Astrology" → it is `astrology-deferred` in the code. Not in primary IA.
- Garden → folded into *Noticed* as the emotional/growth payoff, not a sibling
  utility screen competing with real domains.

**What this IA promotes:**
- Capture from a buried text field → to the literal floor of the whole app.
- Crisis from a hidden route → to a permanent, calm, single-tap affordance in
  the nav region, present even pre-onboarding.

---

## 4. Navigation model

**Chosen: a 3-tab bar + a persistent capture dock + an escape hatch.**

```
┌─────────────────────────────────────┐
│                                     │
│            screen content           │
│                                     │
├─────────────────────────────────────┤
│  ⌁ "throw a thought here…"   ◉ ⏺   │  ← capture dock (always)
├─────────────────────────────────────┤
│   ● Now      ◇ Noticed    ⛉ Safe   │  ← 3 tabs + crisis
└─────────────────────────────────────┘
```

- **Tab bar (3 items only)** — *Now*, *Noticed*, *Safe*. Three is chosen
  deliberately: an overwhelmed brain cannot scan five. Each tab maps to a
  verb the core job needs (*review*, *be rewarded*, *be safe*). Domains are
  pointedly absent — they are not a peer of "review my life."
- **Capture dock** — sits *above* the tab bar on every screen. Tapping the
  text region opens full *Catch* mode; the ⏺ starts voice immediately. This
  is the navigation model's thesis: **the most frequent action is not a tab,
  it is the ground.** Putting capture in a tab would cost it a tap and a
  context switch — unacceptable for the #1 action.
- **Escape hatch** — *Safe* is a tab, not a hidden link, because a crisis
  cannot require discovery. It is calm-styled so it does not read as alarming
  in normal use, but it is *always one tap away* and reachable even before
  onboarding completes.
- **Drill-down stack** — tapping any caught item, cue, or pattern pushes a
  domain-detail screen onto a stack. Back is real (the code already wired
  hardware back). Domains are reached *through their content*, never chosen
  cold from a menu.

**Rejected paradigms & why:**
- *12-tile grid dashboard* — forces drawer-choice before capture. The exact
  failure mode for a mid-spiral ADHD user.
- *5-tab bar* — too many targets to scan under load; dilutes the core job.
- *Command-palette-first* — powerful but cold; assumes the user can name what
  they want. They often can't — they just have a *blob* to offload.
- *Pure single-canvas / feed* — loses the safety hatch and the reward layer
  as first-class, and buries structured per-domain logging.

---

## 5. Visual direction — motivated, not inherited

Every choice below is derived from the user's emotional state (mid-spiral,
overwhelmed, time-blind, ADHD) and the core job (catch fast, trust deeply).

### Design thesis
> **"A calm, generous notebook that catches faster than your brain can drop."**
Not a dashboard. Not a productivity cockpit. A *receiving surface* — soft,
unhurried, forgiving — that makes putting something down feel like *relief*,
and getting something back feel like being *quietly understood*.

### Color — "warm paper at dusk"
ADHD brains are over-stimulated; high-contrast, saturated SaaS palettes add
load. The app should feel like a lamp-lit room, not a screen.
- **Ground:** `#FBF7F0` — warm off-white paper. Not stark white (glare),
  not grey (clinical).
- **Ink:** `#2A2622` — soft near-black, warm, never `#000`.
- **Muted ink:** `#7C736B` — secondary text, timestamps.
- **One signal accent:** `#E8732C` — a warm amber-orange. Used *only* for the
  live capture state and "the app caught it" confirmations. The color of a
  thing safely landing. Never decorative.
- **Calm accent:** `#5B8C7E` — muted sage-green. Used for *Noticed* / patterns
  / growth — the "you're doing okay" register.
- **Domain tints:** each of the 12 domains gets ONE desaturated tint (a 12%
  wash), used as a thin left-edge or chip — enough to recognize a drawer at a
  glance, never enough to shout. Domains are quiet by design.
- No pure-black, no neon, no gradients-as-decoration. Two accents, used with
  restraint. (Crisis screen: even softer — a deep dim slate `#21262B`, so it
  reads as *held*, not *emergency-red*. Red panics; this is the opposite of
  what a crisis surface should do.)

### Typography — "humane, two voices"
- **Display / structural voice:** a warm humanist serif — **Newsreader** or
  **Source Serif 4** — for screen titles, the time-of-day greeting, pattern
  headlines. A serif does emotional work here: it says *journal*, *letter*,
  *someone wrote this to you* — not *enterprise tool*. Used at 26–32px,
  weight 400, generous line-height.
- **Body / functional voice:** **Inter** — captured items, lists, labels,
  numbers. Neutral, legible at small sizes, never competes with the serif.
- Type scale, 5 stops: 13 / 15 / 17 / 22 / 30. Body text 17px minimum —
  ADHD reading fatigue is real, do not go small to look "refined."
- **Sentence case everywhere. Lowercase for the app's own voice** (cues,
  confirmations) — it lowers the temperature, reads as a calm friend, not a
  system. The notification constitution already speaks lowercase; the UI matches.
- Numbers (money, counts, durations) are *tabular* so glances don't jitter.

### Spacing & density — "one thing at a time"
- Generous. 24px screen gutters, 16–20px between cards. A screen should never
  feel like a wall. The *Now* stream shows ~4–6 items above the fold, not 12.
- Big tap targets — 52px minimum row height. Mid-spiral motor control is not
  precise; tiny targets cause rage.
- One primary action per screen, visually obvious. No screen makes the user
  rank five things.
- Cards have soft 18px radii and a barely-there shadow — they read as *paper
  resting on paper*, things you could pick up, not framed UI panels.

### Motion — "settle, don't bounce"
- A captured item performs a **single settle**: it arrives at the top of the
  *Now* stream with a soft 320ms `cubic-bezier(0.22, 1, 0.36, 1)` ease, a
  brief amber underglow that fades over 600ms, then stillness. That glow is
  the entire reward: *the app caught it, it's safe now.* No confetti, no badge.
- The voice-capture screen has one piece of **ambient idle motion**: a slow
  concentric breathing ring behind the mic, 4s in / 4s out — it paces the
  user's breath and signals "listening, take your time," the opposite of a
  spinner's anxiety.
- Tab changes cross-fade (160ms). No slide, no parallax — spatial motion adds
  cognitive load for a time-blind brain.
- Springs are reserved for the capture-confirm and the voice button press —
  the two moments that *should* feel physical and alive. Everything else is
  a quiet ease. Reduced-motion: glow becomes a static 1s hold, ring freezes.

### Tone & microcopy
- The app speaks like a **steady friend who is good in a crisis**: short,
  lowercase, factual, never chirpy, never guilt-tripping. "got it — that's in
  finance now." not "Great job! 🎉". "haven't logged sleep in a while. anything
  to say?" not "You're falling behind!"
- Empty states are *loved*, not blank: the empty *Now* says "nothing caught
  yet. throw the first thing — even half a thought counts." Empty *Noticed*:
  "i haven't noticed anything yet. that's fine — i need a few days of you."
- Confirmations always show the *receipt*: which drawer it went to, tappable
  to verify. Trust is built by being *checkable*, not by being told to trust.

---

## 6. The key screens (the 5–7 that carry the app)

Mocked as standalone HTML at iPhone size (390×844, `viewport-fit=cover`).

1. **`now.html` — Now.** The landing surface. Time-of-day serif greeting; a
   single gentle cue card (from the prompt engine); a chronological stream of
   recently caught items each showing its domain tint + receipt; an "ahead of
   you" strip for today's reminders. The persistent capture dock at the bottom.

2. **`catch.html` — Catch (full capture).** Full-bleed warm-paper surface,
   nothing else on it. Big text field with a forgiving placeholder. A large
   voice button with the breathing ring. After capture: the amber settle +
   a receipt line ("→ finance · bill"). Designed so capture is *the* calm room.

3. **`noticed.html` — Noticed.** The reward layer. Pattern cards in the sage
   register ("you spend ~40% more in the week before your period — 3 cycles
   seen"), each with a confidence and a sample size; the garden growth visual
   folded in at the top as a quiet "you've been showing up" emblem.

4. **`domain.html` — Domain detail (Finance shown).** The drill-down. Reached
   by tapping a caught item. Domain tint as a thin header wash; structured
   summary (bills due, subscriptions, ADHD-tax total); recent entries; one
   primary log action. Proof that domains are *deep* but *not* the front door.

5. **`safe.html` — Safe (crisis).** The escape hatch. Deep-dim calm slate,
   not red. One warm opening line, the user's localized hotline(s) as large
   one-tap call rows, a "someone on your list" contact row. No data entry,
   no metrics, no nav clutter. Reachable from anywhere.

6. **`capture-confirm.html` — Capture receipt (the settle moment).** A focused
   view of the single most important micro-interaction: a just-thrown thought
   landing in *Now* with the amber underglow and its routed receipt — the
   moment the whole product earns trust. Shown as its own mock to make the
   motion and copy explicit.

7. **`onboarding.html` — First-run welcome.** The 7-question intro, shown one
   question per screen, all skippable, in the calm two-voice type system —
   establishing tone before the user has thrown a single thought.

---

## 7. What this differs from the current app (honest)

This section names the blind spots and the bets — per the brief, no hedging.

**The biggest bet — capture is the floor, not a feature.**
The clean-slate IA moves capture out of a screen and into a persistent dock on
*every* screen, and makes the home screen a *review stream* instead of a
domain grid. The bet: for a mid-spiral ADHD user, the cost of choosing a drawer
*is* the thing that loses the thought. If the current app puts capture behind
a tap or behind a domain choice, it is optimizing the wrong moment.

**12 equal tiles → demoted to a drill-down.**
A 12-item grid treats "log a vet appointment" and "review my whole life" as
peers, and forces a scan-and-choose under load. This redesign says the 12
domains are *drawers*, not *destinations* — you should land in one because you
tapped a thought, not because you navigated a menu. If the current app's home
is a domain grid, that is the single thing this exploration most disagrees with.

**5+ navigation targets → 3 tabs.**
An overwhelmed brain cannot triage five tabs. The redesign hard-caps the nav at
*Now / Noticed / Safe*, each tied to a real verb in the core job. Anything that
isn't review, reward, or safety is demoted to a drill-down or made ambient.

**Crisis: hidden route → permanent tab.**
The current app mounts crisis above the gates so it's *reachable*, but a route
you can't *see* is one you won't find mid-crisis. This redesign makes *Safe* a
visible, always-present tab — calm-styled so it doesn't alarm in daily use.

**The "Noticed" layer is given a real home.**
~100+ detectors run silently and a cue engine exists, but pattern output and
the garden are easy to bury. This redesign gives the app's intelligence a
first-class tab — because being *quietly understood* is the emotional payoff
that makes an ADHD user come back, and it should not be a sub-tab of a grid.

**Visual register: utility → humane notebook.**
The redesign commits to warm paper, a humanist serif for the app's voice,
lowercase calm copy, two restrained accents, generous space, and "settle"
motion over "bounce." The bet: ADHD users are over-stimulated, and a calm,
journal-like, low-temperature surface lowers the activation energy to *open
the app at all*. A bright productivity-cockpit aesthetic, however polished,
fights the user's nervous system.

**What this exploration is NOT claiming:** the current app may already do much
of the domain logic beautifully — the 100+ detectors, the notification
constitution, the gentle guilt-copy are clearly strong and are *kept wholesale*
here. The disagreement is purely **IA, navigation, and emotional register**:
*what is front and center, what is buried, and how the surface makes the user
feel.* This is a contrast piece, not a migration plan.
