# Feed Me v2 — Visual Spec

**Owner:** UI Designer · **Reviewer:** frontend-senior · **Status:** ship-ready
**Date:** 2026-05-22 · **Companion:** `preview.html` (open in browser)

The visual contract for the AI-suggestion FeedMeView. Frontend codes against
this; do not improvise. Everything not specified here defaults to the existing
`tokens.css` values — never hardcode.

---

## 1. Palette (concrete hex from tokens.css)

Only these tokens. No new colors.

| Role                          | Token         | Hex      | Where it appears                           |
| ----------------------------- | ------------- | -------- | ------------------------------------------ |
| Page background               | `--bone`      | `#FAFAF7`| view background                            |
| Card surface                  | `--paper`     | `#F4F1E8`| each suggestion card                       |
| Modal / loading surface       | `--paper-2`   | `#EFEBE0`| cook rating modal, skeleton bg shimmer top |
| Primary text                  | `--ink`       | `#14140F`| dish name, ingredient names                |
| Secondary text                | `--ink-soft`  | `#5A574E`| cuisine, reason, step previews             |
| Meta / kicker                 | `--ink-faint` | `#9C9890`| timestamps, "ai suggestion" label          |
| Cooked tint                   | `--accent`    | `#2E5D43`| sage check, "cooked" badge bg @ 12% alpha  |
| AI-source dot (live)          | `--accent`    | `#2E5D43`| 6px dot, top-right                         |
| AI-source dot (cache hit)     | `--water`     | `#5B8FB5`| 6px dot, top-right                         |
| AI-source dot (offline)       | `--ink-faint` | `#9C9890`| 6px dot, top-right                         |
| Missing ingredient flag       | `--warn`      | `#C9974C`| "add missing" amber action only            |
| Reject button border / hover  | `--rule`      | rgba 10% | hairline only — never filled red           |
| Hairlines between cards       | `--rule`      | rgba 10% | 1px top/bottom                             |

**Forbidden in this view:** `--pink` (crisis only), pure white, any drop shadow
heavier than `--sh-md`, gradients, neon, glassmorphism. No rubric red — Feed Me
is not a HITL stop-point.

---

## 2. Typography

| Element              | Family               | Size  | Weight | Tracking      | Leading |
| -------------------- | -------------------- | ----- | ------ | ------------- | ------- |
| Dish name            | DM Serif Display     | 28px  | 400    | `-0.025em`    | 1.10    |
| Cuisine kicker       | DM Sans              | 13px  | 500    | `+0.02em`     | 1.30    |
| Reason ("…turning soon") | DM Sans          | 13px  | 500    | `-0.01em`     | 1.50    |
| Ingredient row       | DM Sans              | 14px  | 500    | `-0.01em`     | 1.40    |
| Coverage count       | DM Sans              | 13px  | 600    | `-0.01em`     | 1.30    |
| Section label (in pantry / you'd need) | DM Sans | 11px | 600 | `+0.08em` UPPER | 1.30 |
| AI-source label      | DM Mono              |  9px  | 500    | `+0.20em` UPPER | 1.30  |
| "cooked" timestamp   | DM Mono              |  9px  | 400    | `+0.20em` UPPER | 1.30  |
| Modal title          | DM Serif Display     | 22px  | 400    | `-0.018em`    | 1.20    |
| Modal option label   | DM Sans              | 15px  | 500    | `-0.01em`     | 1.40    |
| Pet/diet chip        | DM Sans              | 13px  | 500/600| `-0.01em`     | 1.30    |
| Empty state lede     | DM Serif Display     | 22px  | 400    | `-0.02em`     | 1.30    |

Mono **only** for meta (source label, cooked timestamp). Serif **only** for
dish name and modal title. Nowhere else.

---

## 3. Spacing

Base unit 4px. Compose from `--s-*` tokens. No raw px outside this table.

| Region                              | Value           | Token            |
| ----------------------------------- | --------------- | ---------------- |
| View top padding                    | 24px            | `--s-6`          |
| Search bar → diet pill row          | 16px            | `--s-4`          |
| Diet pill row → pet chip row        | 12px            | `--s-3`          |
| Pet chip row → card stack          | 30px            | `--s-8` − 2      |
| Card interior padding (mobile)      | 24px / 22px / 24px / 22px | `--s-6`/`--s-6 − 2` |
| Card interior padding (desktop)     | 30px / 28px     | `--s-8` − 2      |
| Between cards in stack              | 16px            | `--s-4`          |
| Card header → dish name             | 14px            | `--s-4` − 2      |
| Dish name → cuisine                 | 6px             | `--s-2` − 2      |
| Cuisine → coverage pip row          | 18px            | `--s-6` − 6      |
| Coverage → reason line              | 14px            | `--s-4` − 2      |
| Reason → ingredient lists           | 18px            | `--s-6` − 6      |
| Between have/missing lists          | 16px            | `--s-4`          |
| Ingredient list → action row        | 22px            | `--s-6` − 2      |
| Action row gap (cook / reject)      | 12px            | `--s-3`          |
| Diet pill chip gap                  | 8px             | `--s-2`          |
| Modal interior padding              | 28px            | `--s-8` − 4      |
| Modal option vertical gap           | 4px             | `--s-1`          |

**Rule:** when in doubt, add padding. Whitespace is the design. Never compress
a card below 22px interior padding.

---

## 4. Motion

All durations and easings from `tokens.css`. `prefers-reduced-motion` falls
back to static state automatically (tokens already gate this).

| Movement                            | Duration       | Easing             |
| ----------------------------------- | -------------- | ------------------ |
| Card enter (stagger 60ms per index) | 280ms          | `--e-calm-out`     |
| Card hover lift (translateY −1px)   | 120ms          | `--e-calm-out`     |
| Card cooked → sage tint             | 220ms          | `--e-step` (linear)|
| Card reject fade-out + slide-left   | 280ms          | `--e-calm-out`     |
| Modal backdrop fade-in              | 220ms          | `--e-calm-out`     |
| Modal panel translateY 6px → 0      | 280ms          | `--e-calm-out`     |
| Source-indicator dot crossfade      | 220ms          | `--e-step`         |
| Diet pill press                     | 120ms          | `--e-calm-out`     |
| Skeleton shimmer (PendingHair)      | 1600ms loop    | `--e-breathe`      |

**Forbidden:** bounce, spring, scale > 1.04, parallax, anything > 600ms outside
ambient loops.

**Reduced-motion fallback:** card enter = instant opacity 0→1 with no transform;
reject = instant removal; modal = instant; shimmer = static `--paper-2` block.

---

## 5. Layout — 3-card vertical stack

**Container:** single column, max-width 420px, centered. Mobile-first (375px).
NEVER a grid. NEVER side-by-side cards. Each suggestion gets full width.

```
┌─────────────────────────────────┐  ← 375px viewport
│  [search]                       │  24px top
│  ─────────────────────          │
│                                 │  16px
│  [all] [veg] [vegan] [med] [tr] │  diet row, wraps to 2 lines
│                                 │  12px
│  for me · tontin · pinpon ·     │  pet toggle row, segmented
│  the pigs                       │
│                                 │  30px
│  ┌───────────────────────────┐  │  card 1
│  │ ai suggestion       ·     │  │  source dot top-right
│  │                           │  │
│  │ Shakshuka                 │  │  serif 28px
│  │ levantine breakfast       │  │  kicker
│  │                           │  │
│  │ ● ● ● ● ○ ○   4 of 6      │  │  pip row
│  │                           │  │
│  │ tomatoes turning soon —   │  │
│  │ the calm reason tonight.  │  │
│  │                           │  │
│  │ IN YOUR PANTRY            │  │
│  │ ── tomato        ✓        │  │
│  │ ── onion         ✓        │  │
│  │ ── egg           ✓        │  │
│  │ ── paprika       ✓        │  │
│  │                           │  │
│  │ YOU'D NEED                │  │
│  │ ── cumin                  │  │
│  │ ── parsley                │  │
│  │                           │  │
│  │ [add the 2 missing]       │  │  amber, 50h
│  │                           │  │
│  │ i cooked this   ·   pass  │  │  action row, text buttons
│  └───────────────────────────┘  │
│   16px gap                       │
│  ┌───────────────────────────┐  │  card 2
│  ...
```

Card 2 and 3 identical structure. No "compact" variant.

**Card surface:** `background: var(--paper)`, `border-radius: 0`, no shadow.
**Card hairlines:** 1px `var(--rule)` top & bottom. No side borders.
**Card width:** 100% of column.

---

## 6. Card states

### Default
- bg `--paper`, hairlines `--rule` top + bottom.
- source dot top-right: 6px circle in `--accent`, label "ai suggestion" in mono.

### Hover (desktop only)
- translateY(−1px), 120ms.
- hairline bumps `--rule` → `--rule` at 14% (subtle).
- NO shadow loud. No background change.
- Cursor: default (the card itself isn't clickable; the buttons are).

### Cooked (after rating submit)
- bg shifts to `rgba(46, 93, 67, 0.06)` — sage at 6% over paper.
- top-right replaces source dot with: `IconCheck` 12px sage + mono caps text
  "COOKED · 6:42 PM" in `--ink-faint`.
- "i cooked this" and "pass" buttons hide; replaced by quiet text "thanks,
  ollie remembered." in `--ink-soft` 13px.
- Card stays in stack for the session; doesn't auto-remove.

### Rejected (after "pass" tap)
- 280ms: opacity 1 → 0, translateX 0 → −24px.
- After animation: removed from stack; backend refetches with the dish added
  to session `excludeDishes`.
- A new card animates in at the bottom of the stack with 280ms enter.

### Loading (per-card replacement, e.g. after diet switch)
- Card content replaced by 3 skeleton blocks for 240ms minimum (avoid flicker):
  - 60% width name block (serif placeholder, 24px tall)
  - 30% width kicker block (12px tall)
  - 100% width 3-row ingredient placeholder
- Skeleton bg `--paper-2`, shimmer `linear-gradient` PendingHair 6px sage stripe
  drifting left-to-right at 1600ms loop.

### Empty stack (zero suggestions, fallback exhausted)
- See section 12 (Empty state).

---

## 7. Diet pill row

Evolution of the existing FeedMeView pills. Same shape, three changes:

1. **Wraps to two lines** when 5+ chips overflow at 375px width (use
   `flex-wrap: wrap; row-gap: 8px`).
2. **Active pill** uses `--accent` bg + `#fff` text (unchanged from current).
3. **On change**, the whole card stack does a fade-out 120ms → refetch → fade-in
   280ms with stagger. Skeleton appears only if response > 240ms.

Chip dimensions:
- height 30px, padding 7px 13px
- border-radius `--r-pill` (999px — soft pill, this is the only place we go
  pill, justified because diet is a soft semantic filter not a structural one)
- 13px DM Sans, weight 500 inactive / 600 active
- border 1px `--rule` inactive, 1px `--accent` active

---

## 8. Pet toggle chip row

Sits **below** the diet row, on its own line. Segmented-control-feel but
Atelier-restrained: no boxed segments, no shared border. Each chip is a
freestanding pill identical to the diet pill in shape — the only difference
is the row is **single-select** and visually grouped by a leading kicker label.

```
   for                [me]   [tontin]   [pinpon]   [the pigs]
   ↑ kicker              ↑ active chip uses --accent fill
```

- Kicker "for" — 11px DM Sans, 600, `+0.08em` UPPER, `--ink-faint`.
- Gap between kicker and first chip: 12px.
- Gap between chips: 8px.
- Active chip identical to active diet pill (sage fill, white text).
- Switching pet triggers full stack refetch with `feedTarget=pet`,
  `petName='tontin'` etc. Loading state same as diet switch.
- When `feedTarget=pet`, the diet pill row hides (pet feed has its own implicit
  diet — species-aware). Replaced by a quiet line:
  `feeding tontin — species-aware suggestions` (13px `--ink-soft`).
- When `feedTarget=user`, pet kicker reads "for me · or"; tap any pet to switch.

This is the Atelier interpretation of a segmented control: same chip vocabulary
as elsewhere in the app, plus a kicker that reads as editorial caption rather
than a UI label.

---

## 9. Cook rating modal

**Triggered by:** tap on "i cooked this" text button at bottom of a card.
**Dismissed by:** Esc, backdrop click, or selecting an option.

### Layout

Center sheet, NOT bottom drawer (this is a 3-option decision, not a multi-step
flow). 320px wide, auto height.

```
┌──────────────────────────────────────┐
│                                      │  28px padding
│   Shakshuka                          │  serif 22px
│   how was it?                        │  ink-soft 13px
│                                      │  18px
│   ─────────────────────              │  hairline rule
│                                      │  4px
│   didn't love it                     │  sans 15px, hover row
│   ─────────────────────              │  hairline
│   cooked it                          │
│   ─────────────────────              │
│   loved it                           │
│   ─────────────────────              │
│                                      │  18px
│                       cancel         │  text button right
│                                      │
└──────────────────────────────────────┘
```

**No emoji.** No thumbs-up. No 5-star. Three plain text rows + cancel.

### Mapping
- "didn't love it" → `rating: -1`
- "cooked it"      → `rating: 0` (neutral / "just cooked")
- "loved it"       → `rating: 1`

### Visual details
- Backdrop: `rgba(20, 20, 15, 0.40)`, 220ms fade-in.
- Modal bg: `--paper-2` (the warmer cream), no border, no radius.
- Each option row: full-width, 48px tall, left-padded 0, sans 15px `--ink`,
  hairline `--rule` between rows.
- Hover: bg shifts to `rgba(46, 93, 67, 0.06)` (sage 6% — same as cooked card).
- Active/pressed: bg `--accent`, text `#fff`, 120ms.
- Cancel: bottom-right text button, 13px `--ink-soft`, no border.

### Motion
- Backdrop fade 220ms.
- Panel translateY(6px) → 0, opacity 0 → 1, 280ms `--e-calm-out`, 40ms delay
  after backdrop.
- Selecting an option: that row flashes `--accent` for 120ms, then modal
  exits 220ms (reverse of enter).

### Accessibility
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the dish name.
- Focus trap: Tab cycles among the 3 options + cancel.
- Esc closes (writes nothing to cook_history).
- First focusable: the middle option ("cooked it"), so neutral is the default
  if the user hits Enter immediately.

---

## 10. AI-source indicator

A 6px dot + 9px mono caps label in the top-right corner of each card. Always
visible — transparency about whether AI is on.

| State                    | Dot color       | Label             |
| ------------------------ | --------------- | ----------------- |
| `source: 'gemini'`       | `--accent`      | `AI SUGGESTION`   |
| `source: 'cache_hit'`    | `--water`       | `FROM YOUR KITCHEN` |
| `source: 'static_fallback'` | `--ink-faint`| `OFFLINE`         |

**Position:** top: `--s-6` (24px), right: `--s-6` (24px), inside card.
**Dot-to-label gap:** 8px.
**Dot:** 6px diameter, perfect circle, no border.
**Label:** DM Mono 9px, weight 500, `+0.20em` tracking, uppercase, color
`--ink-faint` regardless of dot color (the dot carries the state, the label
just names it).

**Crossfade between states:** When the response source flips (e.g. cache hit on
re-render after a stale cache miss), the dot crossfades 220ms `--e-step`.

**Why visible always:** post-B2B-pivot transparency about AI being on. The user
should know at a glance whether ollie reached out for a fresh suggestion or
served from local memory.

---

## 11. Loading skeleton

3 stacked skeleton cards, identical to real cards in dimension (no layout shift
when real content arrives).

Each skeleton card contains:
- top-right: 6px dot in `--ink-ghost`, no label (don't fake a source).
- a 60% width × 32px tall block where the dish name goes (serif placeholder).
- a 30% width × 14px tall block where the cuisine kicker goes.
- a 6-pip row placeholder (6 circles, all `--ink-ghost` outline).
- 5 stacked 100% width × 18px ingredient row placeholders, separated by hairlines.

All blocks: bg `--paper-2`, no border, no radius.

**PendingHair shimmer:** a 6px-tall sage stripe at 20% alpha drifts left → right
across each block on a 1600ms `--e-breathe` loop. Cards stagger 200ms each so
the shimmer feels alive but not synchronized.

`prefers-reduced-motion`: no shimmer, static `--paper-2` blocks.

**Minimum duration:** 240ms even on instant cache hits, to prevent flicker.

---

## 12. Empty state

Triggered when:
- pantry too sparse (cold start), OR
- all 3 Gemini calls failed AND static fallback table returns nothing, OR
- user rejected every suggestion this session.

Layout: no cards, just a single column of editorial copy.

```
   ollie is quiet right now.            ← serif 22px
   
   ── add a few things to your shopping
      list — a meal will surface here
      on its own.                       ← ink-soft 13px, hairline left
```

- Title: DM Serif Display 22px, weight 400, `--ink`, `-0.02em` tracking,
  max-width 280px.
- Hint: DM Sans 13px, `--ink-soft`, with a 12px-tall vertical hairline
  `--rule` to its left, indent 12px (the marginalia rail pattern).
- Top margin from chips: 80px (this state should feel like an empty page,
  not a UI failure).
- No call-to-action button. The empty state is honest.

**Offline variant** (network gone, static fallback also empty):
- Title: `ollie can't reach the kitchen.`
- Hint: `try again in a moment — your pantry is still here.`
- Source dot at top of the (absent) stack region: `--ink-faint` 6px + label
  `OFFLINE`, so the user knows it's a network state not a content state.

---

## 13. Reject animation (mid-flight)

When user taps "pass":

1. Card immediately receives `pointer-events: none`.
2. 0ms → 120ms: opacity 1 → 0.5, translateX 0 → −8px (subtle commit).
3. 120ms → 280ms: opacity 0.5 → 0, translateX −8px → −24px.
4. 280ms: card removed from DOM, stack reflows (other cards translateY up to
   fill the gap, 220ms `--e-calm-out`).
5. Background refetch fires at step 1; new card appears at stack bottom with
   standard card-enter 280ms once response arrives.

**Reduced-motion:** card removed instantly, stack reflow instant, new card
fades in over 120ms.

---

## 14. Long dish name overflow

Real Gemini output may produce dish names like
*"slow-braised lamb shank with preserved lemon and white beans"*.

Behavior:
- Serif name wraps to **2 lines max** at the card's width.
- Line-height 1.10 ensures wrap is tight (no awkward ladder).
- If text overflows 2 lines, truncate with `text-overflow: ellipsis` (apply
  `-webkit-line-clamp: 2`).
- Cuisine kicker still appears below, on its own single line, ellipsis if needed.
- Card height grows; never crops the recipe content. Coverage row and below
  pushes down naturally.

No 3rd line, no "read more" toggle. If the model produces a paragraph as a
name, we cut it — that's a backend prompt bug to fix, not a UI affordance.

---

## 15. Action row (per card)

Below the amber "add missing" button (or directly below the ingredient lists if
nothing is missing).

```
   i cooked this           ·           pass
```

- Left: "i cooked this" — DM Sans 14px, weight 500, `--ink`. No border, no
  background. Tappable area 44×44 minimum (padding 12px around text).
- Center separator: `·` middle dot in `--ink-ghost`, 14px.
- Right: "pass" — DM Sans 14px, weight 500, `--ink-soft`. Hover: `--ink`.
- 12px gap between the dot and each label.
- Row align: space-between if amber button absent, justify-start if amber
  button present (the amber button takes top priority).

**Why text buttons, not icons:** preserves the editorial restraint. Icons here
would push toward recipe-app cliché.

---

## 16. Reduced-motion full inventory

All motion gracefully degrades. Confirmed fallbacks:

| Effect              | Reduced-motion behavior |
| ------------------- | ----------------------- |
| Card stagger enter  | All cards visible immediately, opacity-only fade 120ms |
| Card hover lift     | No transform; only hairline color change |
| Reject animation    | Instant removal + reflow |
| Modal enter/exit    | Instant show/hide of backdrop and panel |
| Source dot crossfade| Instant swap |
| Skeleton shimmer    | No shimmer; static `--paper-2` blocks |
| Diet pill press     | Instant background swap |

Tokens.css already nulls the duration vars, so most of this is automatic; only
shimmer needs an explicit `@media (prefers-reduced-motion: reduce)` guard.

---

## 17. Hand-off checklist for frontend-senior

- [ ] No new color tokens introduced — all values from `tokens.css`
- [ ] All durations from `--d-*`, all easings from `--e-*`
- [ ] Serif used **only** for dish name and modal title
- [ ] Mono used **only** for source label and cooked timestamp
- [ ] No emoji anywhere; cooked check is the `IconCheck` Phosphor glyph
- [ ] Reject and pass do not use red — Feed Me is not a HITL stop-point
- [ ] Reduced-motion fallback for shimmer (explicit `@media` block)
- [ ] AI-source dot present on every card, every state, including loading
- [ ] Empty state has no CTA button — honest stillness
- [ ] Cook rating modal traps focus + closes on Esc

If any one of these can't be met, raise it before coding — don't ship a drift.
