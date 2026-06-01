# Grocery — clean-slate design direction · 2026-05-31

Designed from behavior only. I did **not** look at the current screens, CSS,
tokens, or palette. What follows owes nothing to the existing UI on purpose —
the value is the contrast.

---

## 1. Feature inventory (raw capabilities, not screens)

How things get **in**
- Talk to it: a brain dump (typed, voice, or photo) is the only entry point —
  no manual add forms. "bought 12 eggs", "out of lemons", "spent the milk".
- Voice dump: speak, it auto-stops on silence, transcribes, routes itself.

What it lets you **do**
- Record something you now have → pantry (name, optional quantity + unit).
- Mark something used up → leaves the pantry.
- Say you're **out** of something → leaves the pantry **and** lands on the list.
- Flag something running low → a quiet hint, never a blocker.
- Put something on the shopping list directly.
- Check a list item off → it moves into the pantry (you bought it).
- Remove anything from either list.
- Ask what to cook → AI proposes dishes from what you have.
- Open a dish → full ingredients (have vs. need) + numbered steps.
- Tap "cooked it" → logged; future suggestions learn from it.
- Tap a missing ingredient in a recipe → it jumps onto the list.

What it does **on its own** (no screen, ambient)
- Ages pantry items by shelf life: fresh → faded → "still here?" → auto-archive.
- Predicts when a recurring item will run out (cadence) → a soft "likely needed".
- Pushes a reminder for *critical* items only (meds, tampons, formula, pet meds).
- Learns cook history to weight recipe suggestions.

Data it holds
- Pantry items (qty, unit, an age clock, low flag, predicted-out time, archive).
- Shopping items (qty, unit).
- Recipe suggestions + cook history.

---

## 2. The user & the core job

**Who:** an ADHD adult running a household's food supply. Often opens the app
mid-stride — in the kitchen with the fridge open, in line at the store, or at
9pm staring into "what can I even eat."

**Emotional state on open:** depleted executive function. They do **not** want
to file data into a system. They want an answer to one of three live questions:

1. *What do I need to buy?* (at / before the store)
2. *Do I already have this / what's about to spoil?* (at home)
3. *What can I make right now?* (hungry, decision-fatigued)

**Core job-to-be-done:** *keep the kitchen running without having to think.*

**Highest-frequency actions:** (1) glance the list, (2) dump a thing as it
happens, (3) ask "what can I cook," (4) check an item off at the store.

This is a **glance-and-go** product, not a management dashboard. Every screen
must be answerable in ~2 seconds and forgivable if ignored for a week.

---

## 3. Information architecture, from zero

The current app is filed as three peer lists (shop · pantry · feed-me) behind a
tab switch. That's the *engineer's* filing, not the user's mental model. The
user never thinks "open the pantry tab" — they think "I'm hungry" or "I'm going
shopping" or "I just ran out."

Clean-slate IA, by frequency and mental model:

- **NOW** *(primary, the landing surface)* — a single calm answer to "what's
  worth knowing right now": the 1–3 things likely needed, the 1 thing aging out,
  and a one-line "dinner is solvable" nudge. Plus the dump bar. Most opens end
  here without a tap.
- **LIST** *(need)* — the shopping list, with predicted "likely needed" rows
  woven in, not in a separate place. The store surface.
- **KITCHEN** *(have)* — the pantry as a quiet inventory; aging shown by how
  *faded* the text is, not by alarms. "Still here?" lives inline.
- **COOK** *(eat)* — recipe ideas → one expands to a full recipe.

Demoted to **ambient, no screen**: aging math, predicted-out, push reminders,
cook-learning. They surface as at most one quiet line on NOW; they never get a
tab, a badge count, or a settings maze.

Archive is a one-line collapsed footer under KITCHEN — recoverable, never in
the way.

**This is 4 surfaces, but only one you ever *have* to look at (NOW).** The other
three are pulled, not pushed.

---

## 4. Navigation model

**A single vertical canvas with a quiet "spine" switch + an always-present dump
bar pinned to the bottom.**

- The dump bar is the home base — text, mic, camera — reachable from every
  surface. Input is the verb of the whole app, so it's never more than a thumb
  away. (Command-first, not menu-first.)
- Movement between NOW / LIST / KITCHEN / COOK is a thin, type-only segmented
  control near the top — no icon tab bar, no chrome, no shadows. Active = ink +
  a 2px sage underline; the rest is faint.
- No nested navigation, no modals for the core loop. A recipe "expands" in
  place into a full screen and a back-swipe collapses it.

**Rejects:** a bottom icon tab bar (too SaaS, too loud for a glance product),
hamburger menus, FABs, number badges, and any persistent counter.

---

## 5. Visual direction (motivated, not inherited)

The user is frazzled; the screen should feel like a **clean sheet of good paper
on a quiet morning** — the opposite of a busy grocery app. Editorial calm
(Kinfolk / Apartamento / Cereal), not utility software.

- **Palette** — warm paper `#FAF8F3`, ink `#23211C`, soft ink `#6B675E`, faint
  `#A8A29A`, hairline `#EAE5DB`. A single restrained accent: muted sage
  `#7C8C6F`, used only for "you / done / active". Aging = literal **opacity
  fade** of the item's own ink — no reds, no yellows, no traffic lights.
- **Type** — a serif display (DM Serif Display / Georgia) for the *one* big
  thing per screen (a title, a count, a dish name) + a humanist sans (DM Sans /
  system) for everything else. Micro-labels in **small-caps, tracked**. Type
  *is* the UI; it does the work cards usually do.
- **Space & density** — luxurious. 28px side gutters, big top breathing room,
  one idea per band separated by hairlines, never boxes. Low density on purpose:
  a short list should look intentionally short, not empty.
- **Motion** — almost none. A soft fade-in on route, the voice "breathing"
  circle, a gentle strike-through on check-off. No bouncing, no confetti.
- **Tone of copy** — plain, warm, lower-case, short. "out of lemons — added to
  your list." Never gamified, never "Great job!", never a streak.

ADHD-safety is structural, not decorative: one focus per screen, no counts to
maintain, no shame states, aging that *recedes* (fades) instead of *shouts*.

---

## 6. The key screens

1. **NOW** — serif "morning" greeting, then at most three quiet lines: "likely
   needed soon: coffee, dish soap", "the spinach is getting old — still here?",
   "you can make 3 dinners tonight →". Dump bar pinned below. The whole point:
   answer "what now" before any tap.
2. **LIST (need)** — a torn-paper list of what to buy, each row a circle you tap
   to check (→ moves to kitchen). Predicted "≈ likely needed" rows sit at the
   bottom in faint ink with a one-tap "add". No headers shouting counts.
3. **KITCHEN (have)** — inventory as a calm column; each item's ink opacity *is*
   its freshness. Old items literally fade; the oldest shows an inline "still
   here?" with yes / gone. Archive is a collapsed one-liner at the very bottom.
4. **COOK (eat)** — "3 ideas" in a serif stack: dish name + time + the
   have-ingredients. Tap one to expand.
5. **RECIPE (expanded)** — full screen: ingredients split into *have* (ink) and
   *need* (tap any to add to list), then numbered steps in generous leading, and
   a single quiet "cooked it" at the foot.
6. **LISTENING (voice)** — the whole screen goes a calm sage wash with one
   breathing circle and "listening… just pause when you're done." It hears you,
   stops itself, and routes — no buttons.

---

## 7. What this differs from the current app — bets & blind spots

- **Bet: NOW replaces "pantry as default tab."** The current app drops you into
  a list to manage. The redesign drops you into an *answer*. Risk: if the
  ambient signals (predicted-out, aging) are thin for a new user, NOW can feel
  empty — mitigated by the "what can I cook" nudge always having something to
  say once the pantry has a few items.
- **Bet: lists are pulled, not the home.** Heavy list-users may miss landing on
  their list. Counter: LIST is one tap and the dump bar is everywhere.
- **Bet: aging as opacity, not alerts.** Calmer and ADHD-safer, but less
  "urgent" — intentional. Critical items keep their (opt-in) push; everything
  else is allowed to be quietly ignored.
- **Bet: no tab bar / no badges.** Cleaner, but discoverability of KITCHEN/COOK
  rests on the thin spine. If usage shows people can't find COOK, the NOW
  "3 dinners →" nudge is the safety route in.
- **Blind spot:** I designed from data + behavior, not from real usage logs. I
  don't know the true split between shopping-list use vs. cooking use; if the app
  is 90% "just a list," NOW is over-built and LIST should be the home. Worth
  checking before building.
- **Deliberately dropped:** unit pickers, quantity steppers, multi-currency
  chrome, any "add item" form — all of it is the dump bar's job now.
