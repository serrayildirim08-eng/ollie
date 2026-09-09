# Feed Me v2 — Design Rationale

One page on *why* the design is what it is. Bring this when defending choices
in review.

---

## Why 3 cards, not a grid

The spec asks for "multiple suggestions" — the obvious move is a 2×N grid of
recipe tiles like every meal-kit app since 2014. We refused. Three reasons:

1. **Cognitive load.** A grid forces parallel comparison: the user scans all
   tiles, weighs them against each other, often picks none. A vertical stack
   asks the user to consider one suggestion fully before moving on. Decision
   fatigue drops; commitment rises. Atelier already favors "one focus per
   screen" (Serra's minimal-UI memory) — a stack of three is the smallest
   plural that doesn't collapse to a single choice.
2. **ADHD-safe pacing.** A grid is a "wall." A stack is a "page." Ollie's
   research atlas (see Section J of the ADHD primary-sources atlas) makes
   the case that working-memory-limited users do better with serial than
   parallel decision surfaces. The recipe view is exactly the kind of
   low-stakes decision where this matters most.
3. **Each card carries editorial weight.** Three cards at full width means
   each gets the serif dish name at 28px, the full ingredient split, the
   reason line, the action row. A grid would force shrinking the type
   scale to fit — turning recipes into thumbnails. We don't do thumbnails.

---

## Why the pet toggle is inline, not a separate tab

The spec offered two paths: a `for tontin` / `for the pigs` chip row inline
with the diet pills, or a top-level tab switch ("for you" | "for pets"). We
chose inline. One reason:

**The minimal-UI memory.** Serra has stated repeatedly: no busy designs, one
focus per screen, few words. A tab switch above the FeedMeView would add a
permanent UI element that's empty 95% of the time — most users have either
0 pets or 1 pet, and most sessions don't switch context. An inline chip row
is dormant when not needed and present when it is.

There's a secondary editorial reason: tabs are *modes*; chips are *filters*.
Pet feeding isn't a different mode of the app, it's the same recipe-suggestion
engine pointed at a different mouth. Treating it as a filter — the same shape
as diet — honors that architectural truth.

The kicker label "for" reframes the chip row as editorial caption rather than
a UI control. This is the single most important micro-decision in the screen
and it cost zero pixels.

---

## Why the AI-source indicator is always visible

We could have hidden the AI-source dot and only surfaced it in a debug build
or on long-press. We chose to make it a first-class visual element.

Post-B2B-pivot (2026-05-14), ollie is no longer zero-knowledge. The product
opted into a transparent posture: opt-in research consent, telemetry, and
now AI suggestions running over an external Gemini call. The user's trust
budget for that posture depends on the app *showing* them when the model
spoke and when it didn't.

The dot answers three questions at a glance:

- **sage** — the model just spoke; this is fresh.
- **blue** — your kitchen spoke; this came from cache (your patterns + local).
- **faded** — the network's down; this is the safety net.

This is the same transparency move that legal-tech earned in the Atelier
brief — when AI is on, the user must know. We just translated it from
"engagement letter HITL" to "recipe card chrome." Same DNA.

It also costs almost nothing visually: 6px dot + 9px mono caps in a top-right
corner is below the threshold of visual noise. It registers as metadata, not
content.

---

## Why the rating modal is 3 options, not 5 stars

The original product instinct was a 5-star rating, the universal e-commerce
default. We argued against it and won.

Three reasons:

1. **Signal-to-noise.** A 5-star scale collects fake precision. Users tap 4
   when they mean "fine" and 5 when they mean "fine, but I want to remember
   I liked it." The adaptive-scoring backend doesn't need that resolution —
   it needs `loved | neutral | disliked` to weight future suggestions
   correctly. Three buckets are the minimum that lets the model learn.
2. **The neutral bucket is essential.** Most cooks aren't loved or disliked,
   they're just *cooked.* Logging "cooked it" (rating 0) is the most common
   case and the most important data point: it tells the model the user
   actually engaged with the suggestion. A binary thumbs-up/down loses this.
3. **Editorial restraint.** A 5-star widget is recipe-app cliché. A 3-row
   text list with a hairline between each row reads as a small editorial
   decision panel — closer to a Kinfolk reader survey than a HelloFresh
   review prompt. Same data captured, none of the cheapness.

Default focus on "cooked it" (the middle option) means the modal is dismissible
with Enter for the most common case. The user who loved it or hated it has to
say so deliberately.

---

## What we explicitly chose not to do

- **No recipe images.** The spec defers media to v2. The view holds up on
  type alone — Aesop-style discipline. Add images only if cooking conversion
  drops measurably; otherwise images are noise that pulls toward HelloFresh.
- **No ratings on the cards themselves.** Rating happens in the modal,
  triggered by "i cooked this." A persistent thumbs-up/down per card invites
  reflexive tapping; a deliberate modal invites considered logging.
- **No emoji.** Anywhere. Including the cooked badge — that's the `IconCheck`
  Phosphor glyph in sage, not a green checkmark emoji. Same payload, none of
  the system-font drift.
- **No red.** Pass / reject is text, not a destructive button. Feed Me is not
  a stop-point; the rubric red is reserved for the 11 HITL exceptions in
  Atelier's DNA. Borrowed restraint here too.
- **No "share this recipe."** Out of scope. Probably permanently out of scope.
  Ollie isn't a recipe social network.

The Feed Me view earns its luxury-editorial class by saying no, often. This
spec is the record of those refusals.
