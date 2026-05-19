# Ollie — Clean-Slate v2 (revised): a calm notebook, not a blank page

**Date:** 2026-05-18 · revises the first v2 (calm aesthetic kept, "empty" fixed).

## The one-line bet

> The app is a **catcher** *and* a **notebook**. Calm and full of air — but
> every element on screen is concrete and useful. Opening it and looking is
> the reward; you should never have to wait for a notification, and you should
> always be able to **find** what you're looking for.

## What changed, and why

The first v2 nailed the calm/minimal aesthetic — but "empty" went too far:
module pages were a list of glyph + word, no information, so the app only
came alive through notifications. Fixed:

- **Minimal aesthetic ≠ empty of information.** Think a beautiful paper
  notebook, or Things 3 — generous whitespace, but every line is concrete.
- A submodule card now carries **a line or two of real data**. That is
  correct, not clutter.
- Added **Find** — so the app is searchable, not only notification-driven.

## User & core job

An adult with ADHD. Two jobs, not one: *throw a thought down before it's
lost* (capture) — and *open the app, look, and instantly know where things
stand* (the notebook). Both must work without a notification firing first.

## IA — 3 levels, exactly

The app is **4 modules**, each one page, with **submodules** inside.

| Module (1 page) | Submodules |
|---|---|
| **money** | finance |
| **body**  | cycle · sleep · body · medication · habits |
| **home**  | admin · pets · grocery |
| **work**  | work · goals |

- **Capture (the front).** Throw · Caught · Noticed — three swipeable screens,
  three dots. The app opens on Throw. One thing per screen — unchanged.
- **Level 1 — the 4 modules.** One swipe past capture: money · body · home ·
  work as four calm rooms, one word each.
- **Level 2 — a module page.** Tap a room → its page pushes on top. Its
  submodules are **expandable info-cards** (see below).
- **Level 3 — the detail page.** Tap an expanded card → the deeper page pushes
  on top: one focus object in lots of air. The 5 mocked (finance · sleep ·
  habits · grocery · cycle) are these.
- **money is special.** One submodule — so `module-money` isn't a list of one.
  The money page *is* a single rich finance card (safe-to-spend + next bill +
  spent today); tap → full finance detail page.
- **Always-on — Find & Safe.** Two dots, fixed corners, every screen. Find
  (top-left) → search. Safe (top-right) → crisis screen.
- **Ambient — no screen.** Detectors, notification engine. Notifications are
  now a bonus, not the only way info reaches the user.

## The expandable info-card (the core of this revision)

Every submodule on a module page is one card with three states:

1. **Collapsed** — glyph + submodule name + **one glanceable line of real,
   concrete data** + a chevron. Examples (real data from the modules):
   finance → `safe to spend $312 · next bill Fri`; sleep → `last night 7h 20m`;
   cycle → `day 14 · luteal · period in 12 days`; habits → `3 waiting today`;
   medication → `next dose 2:00pm · 1 of 2 taken`; admin → `2 due this week`;
   pets → `next: flea drops for Mango`; grocery → `4 on the list`;
   work → `50m focused today`; goals → `learn Spanish · 40%`.
2. **Expanded inline** — tap the card: it opens in place to show **a bit
   more** (2–4 quiet key/value lines, or a peek of the list), plus an
   `open … →` cue. No navigation yet. One card open at a time.
3. **Detail page** — tap again (or `open …`) → the level-3 detail page pushes
   on. The full focus object, room to act.

So: **glance → expand → detail.** A spiraling brain gets exactly as much as it
asks for, and the first tier costs zero taps — it's just visible.

## Findability — the Find dot

The first v2 surfaced things *only* via notifications. **Find** fixes that:

- A calm search dot, **top-left at every level** (mirrors Safe top-right).
- Tapping opens `find.html`: one search field, swipe-down to dismiss.
- It reaches the **whole notebook** — thrown thoughts, any submodule's live
  data, grocery lines, goals, or a submodule itself jumped to by name.
- Each result shows **its path** (`home › admin`, `caught · 3 days ago`) so
  the user learns where things live and can find them again.
- Results wear the same info-card grammar as the module pages.

## Navigation

Capture = three horizontal screens + the 4-modules view (four dots). Module
and detail pages **push a stack**. Back / go to the previous screen has TWO
gestures, both always available:
- **swipe right** from the left edge — the iOS-standard back reflex; pops the
  stack one level. (Swipe left does nothing — there is no forward stack.)
- **swipe down on the handle** — the explicit visible affordance.
A pushed screen pops with either; a sheet/modal dismisses with swipe-down.
Find and Safe are the only fixed chrome — Find left, Safe right.

Rejected: bottom tab bar, a jammed dashboard grid, search buried in a menu.

## The screens

**Capture** — throw · listening · caught · noticed (unchanged).
**Level 1** — modules.html: the 4 rooms.
**Level 2** — module-money / -body / -home / -work: expandable info-cards.
Each mockup shows cards collapsed **and at least one expanded**.
**Level 3** — module-finance / -sleep / -habits / -grocery / -cycle: the
detail pages. Find dot added so it's reachable from the leaf too.
**Always-on** — find.html (search), safe.html (crisis), onboarding.html.

## The rule, restated

Calm in style. Concrete in substance. Every screen has air *and* information.
If a card "needs" six numbers, show one glanceable line, two more on expand,
the rest on the detail page. Empty was never the goal — **findable calm** is.
