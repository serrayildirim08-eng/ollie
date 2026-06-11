# Ollie — Desktop Layout Direction

**"The Thin Spine"** · macOS desktop adaptation of the v2 iPhone design
Date: 2026-05-19 · Window: resizable, ~1280px and up (the Electron frame)

> **Mockups are fluid / responsive.** Every screen fills the whole browser
> window at any size and **scales up** on larger displays — it does not sit as
> a small fixed box in the middle. Sizing is `clamp()`-based and keyed to
> viewport units: the spine, type, measures, paddings and vertical rhythm all
> grow proportionally from ~1280px wide up to ~2560px, so the composition stays
> calm and sparse — bigger, never busier. This matters because the real
> Electron window is resizable; the design must read full and comfortable on a
> 1512px/1728px Mac display, not just at a hard-locked 1280×800.

This is a **layout** document, not a redesign. The visual identity — color,
type, edges, tone — is locked and preserved verbatim from the **real shipped
v2 tokens** (`money-v2/v2/tokens.ts`). Only the arrangement of space changes,
because a desktop window is not a phone.

---

## 0. What happened to v1 — and why this is a rebuild

The first desktop study ("the desk", same date) was **rejected by the product
owner as "too crowded and ugly."** It failed for three concrete reasons:

1. **A 240px left rail listed everything.** All twelve modules, plus `throw`
   and `noticed`, plus three room kickers, plus a pinned footer of `find` /
   `money` / `safe` — roughly twenty rows of text stacked down the left edge.
   That is a wall of text. The navigation was louder than the content.
2. **A permanent right "caught" column** made the home screen a three-pane
   layout. Three columns is three competing foci — the opposite of the
   one-focus-per-screen rule.
3. **Fussy micro-labels everywhere** — kickers and eyebrows like
   *"throw · the front of the notebook"* — added words to every screen for no
   real gain. They read as decoration, and decoration is noise.

It also used the wrong palette: a sage `--accent`, a `--pink`, DM Serif Display
headlines and three Google fonts — none of which match the real v2 module.

**What this rebuild changes:** the navigation collapses from a twenty-row text
rail to a **60px glyph-only spine**. The right column is **deleted** — caught
is no longer a permanent panel. Micro-labels are **removed** — most screens get
a single small eyebrow word or none. The palette is corrected to the **real v2
tokens**, and the serif is dropped for the system sans the app actually ships.
The acceptance test for every screen became one question: *can I remove
anything?*

---

## a. The problem (unchanged from v1 — still true)

The Electron desktop app is the iPhone web app, unchanged, rendered into a
1280×800 window: a ~390px phone column floating in dead space, with a
horizontal swipe deck and a four-dot indicator that have no mouse equivalent.
Find and Safe are thumb-sized corner circles. Nothing reads as a Mac app.

The instinct to "just widen the column" is wrong — Ollie's content is editorial
and has a *correct measure* (~520–660px) that gets worse when stretched. The
fix is to **give the page more margin**, not more column. v1 got that part
right. Where v1 went wrong was filling the new space with chrome.

## b. Feature inventory — what the app does

Ollie holds a scattered ADHD person's whole life. The core loop: you **dump**
the chaos in your head into one field; Ollie quietly **routes** each thought to
the right place across twelve life modules; later it surfaces gentle
cross-module **patterns** it noticed. You rarely file anything yourself.

- **Throw** — the capture field. One thought at a time.
- **Modules** — the twelve life modules, grouped into rooms.
- **Noticed** — cross-module patterns Ollie observed over time.
- **Find** — search the whole notebook (⌘K).
- **Safe** — a calm crisis surface, reachable from anywhere.
- **Settings** — account, notifications, app lock, language (EN/ES), data.

The twelve modules, in their rooms:
*body*: cycle · sleep · body · medication · habits ·
*home*: admin · pets · grocery · *work*: work · goals · partner ·
and *money* on its own.

Module content is small and concrete — money: spending · set-aside ·
subscriptions. Every module is a short read, never a dashboard.

## c. The user, the core job, the emotional state

The user has ADHD and a heavy life-load. Working memory leaks; open loops cause
anxiety; a busy or shouty interface is itself a stressor. They often open Ollie
*because* they feel scattered.

**The core job:** "get this out of my head and trust that it's handled."

**The emotional state to design for:** mild overwhelm, low executive bandwidth,
a need to feel calm and capable rather than behind. A magazine page is a place
you *rest your eyes*; a dashboard *demands* something of you. Every screen has
exactly one focus so the user is never asked to triage. The owner's standing
instruction is extreme minimalism — she would rather a screen feel **too empty
than too full**. That is the bar this rebuild is held to.

## d. Information architecture for desktop

The phone IA is three levels deep behind a horizontal deck and a push stack.
A desktop window can show navigation beside content, so the deck and the push
stack flatten. But — the lesson of v1 — flattening must not mean *listing
everything at once*.

```
Desktop IA — five destinations, reached from the spine
  throw      (home / default)
  modules    (the airy grid → a module)
  noticed
  find  ⌘K
  safe
```

`modules` is a real screen, not a rail list. It is where you go to choose a
module; the spine never enumerates the twelve. This keeps the always-visible
navigation down to **four glyphs plus safe** — small enough to read as
furniture, not as content.

What changed from the phone, and from v1:

- **The 4-panel swipe deck is gone** — throw / modules / noticed are three of
  the spine's four glyphs.
- **The rail's module wall is gone.** v1's twenty-row rail is replaced by a
  single `modules` glyph that opens a calm grid screen (`02-modules.html`).
- **The permanent "caught" column is gone.** Confirmation of where a thought
  landed is a brief inline moment on the throw screen, not a standing third
  pane. The home screen is now genuinely one focus.
- **Depth flattens to one click** — reaching money is one glyph + one grid tap.

## e. The navigation model — "the thin spine"

The window is a page with a hairline spine down its binding edge.

**1. The thin spine — ~60px, full height.** Background `tile` (`#F2EEDF`) with a
1px `line` right border. It is deliberately almost invisible furniture. It
holds, with generous vertical spacing:

- **top:** a tiny lowercase `o` wordmark (~20px, `ink`).
- **a centered stack of four glyph marks** — throw · modules · noticed · find.
  Each is an ~18px line-icon at 1.5px stroke (or a simple dot/ring). Inactive =
  `mute` (`#B6ADA0`); the active one = `accent` amber (`#C9923E`), filled.
  **There is never a text label in the spine.** A `title=""` tooltip on hover
  is the only text, and it is never drawn.
- **bottom:** a `safe` shield glyph and a tiny `⌘K` mono hint near the edge.

If the spine draws the eye, it has failed. It should read as the quiet edge of
the page.

**2. The canvas — everything else (~1220px).** Background `paper` (`#FAF6EF`).
It shows **one focus**, centered, held to a comfortable measure (~480–660px
depending on the screen), with large warm empty margins on every side. Every
screen is 35–50% empty paper. There is **no second column, ever** — no
permanent side panel, no master/detail split.

**3. ⌘K command palette = Find.** A centered overlay, ~560px wide, over a dim
ink scrim. It is the **only** element in the whole app allowed a 12px corner
radius and a soft shadow (`0 16px 38px rgba(42,38,34,.10)`). It is how you jump
anywhere fast — which is why the spine can afford to be so spare.

**What "the thin spine" deliberately rejects:**

- No phone swipe deck, no bottom dot indicator.
- No text navigation rail — glyphs only, no module list in the chrome.
- No permanent right column on any screen.
- No push/pop stack, no back button, no in-canvas tabs.
- No kicker/eyebrow micro-labels stacked on screens for decoration.
- No top toolbar, no widgets, no stat tiles, no greeting bar.
- No filling the desktop width with content. Width is margin.

## f. The visual DNA — corrected to the real v2 tokens

v1 used the wrong palette. This rebuild uses the **real shipped tokens** from
`apps/web/src/modules/money-v2/v2/tokens.ts` exactly:

| token  | value     | role                                            |
|--------|-----------|-------------------------------------------------|
| paper  | `#FAF6EF` | the canvas background                           |
| card   | `#FFFFFF` | a card / sheet surface — used sparingly         |
| tile   | `#F2EEDF` | the spine; soft glyph-tile fills                |
| ink    | `#2A2622` | primary text                                    |
| mute   | `#B6ADA0` | secondary text, inactive glyphs, hints          |
| line   | `#EAE2D4` | hairlines, borders                              |
| accent | `#C9923E` | warm amber — **the single accent**, active state|
| sage   | `#5B8C7E` | a calm secondary, used rarely (the safe screen) |
| umber  | `#A8703C` | severity ink (turns-soon, sign-out); never red  |

- **Type.** System sans only — `-apple-system,'Segoe UI',Roboto,sans-serif` —
  and the mono `ui-monospace,'SF Mono',Menlo,monospace`. **No serif, no Google
  fonts.** The DM Serif Display headlines from v1 are dropped. A large *light*
  (300) weight of the system sans carries display text and reads calm.
- **Edges.** Border-radius **0 almost everywhere** — sharp edges are the brand.
  The only exceptions: 12px on the ⌘K palette, 999px on tiny chips (the EN/ES
  language pill).
- **Shadows.** One soft level, only on the ⌘K palette. Cards and rows are
  defined by hairlines, not shadow.
- **Tone.** Lowercase, gentle, ADHD-safe copy. The app never raises its voice.

## g. The seven key screens

1. **`01-throw-home.html` — throw, the home.** Spine + canvas. The canvas holds
   *only* a light prompt "what's in your head?", a generous capture field, and
   a one-line `press ↵ to throw` hint. No caught list, no eyebrow, no cards.
   Wide empty margins all around.

2. **`02-modules.html` — modules.** Where the spine's `modules` glyph leads, and
   the replacement for v1's rail wall. The twelve modules as a calm three-up
   grid with generous gaps — each entry is just a lowercase name and a faint
   one-line hint, no boxed cards. Grouped under three quiet room words
   (body / home / work) with money on its own. Paper shows through everywhere.

3. **`03-module-money.html` — the money module.** The module layout rule. One
   primary thing — the month's spending figure (`$1,840 of $2,600`) in light
   64px, a one-line caption, a thin amber progress rule. Then exactly **two**
   quiet hairline rows below (set-aside, subscriptions). Not a dashboard.

4. **`04-noticed.html` — the patterns.** Three gentle cross-module observations
   as light 25px editorial lines with an amber emphasis fragment and a small
   mono module tag, ~54px of space between them. Lead: *"your spending climbs
   the week before your period."*

5. **`05-find-palette.html` — the ⌘K palette.** The home dimmed and blurred
   under an ink scrim; the 560px / 12px-radius palette centered. A query field
   with an amber caret, results under `thrown thoughts` and `where it lives`,
   a quiet `↑↓ · ↵ · esc` footer. The spine stays sharp above the scrim.

6. **`06-settings.html` — settings.** Five quiet hairline-separated rows in a
   narrow measure — account, notifications, app lock, language (a tiny EN/ES
   pill), data & consent. No boxes. Sign-out in umber.

7. **`07-safe.html` — the safe surface.** The calmest, emptiest screen. One
   light sentence "it's good that you came here.", a gentle two-line paragraph,
   and one quiet sage way to reach a person. No alarm, nothing red — sage and
   umber are the only non-neutral inks the screen may touch, and it barely does.

## h. Bets & open questions

**Bets we are making:**

- *A glyph-only spine is enough navigation.* Four marks plus ⌘K covers every
  destination because `modules` is a screen, not a list. If users can't tell
  the glyphs apart, the fallback is a hover tooltip — never drawn-in text.
- *Caught does not need a standing panel.* Routing confirmation is a brief
  inline moment on the throw screen. Seeing a permanent ledger every time you
  open the app was clutter, not reassurance.
- *Emptiness is the product.* We are betting the team holds the line and never
  fills the warm margins. If that slips, Ollie becomes the dashboard it exists
  not to be.

**Open questions for the build:**

1. **Glyph legibility.** Four small line-icons with no labels — do real users
   learn them, or is a one-time hover-label onboarding needed? Worth a quick
   test.
2. **Voice capture on desktop.** The phone throw has a prominent mic. These
   mockups are text-first. Does desktop keep a quiet mic affordance? Product
   call.
3. **The inline "caught" moment.** This study shows the throw screen at rest.
   The post-throw confirmation (the brief "→ money" beat) needs its own small
   motion/layout pass — it must appear and fade without becoming a panel.
4. **Module sub-screens.** Some `*-v2` modules have internal sub-screens
   (log-spend, subscription detail). This study covers the module *face*; the
   deeper screens need their own in-canvas layout pass.
5. **Window resizing.** Mockups are now fluid — they fill the window and scale
   up on larger displays (`clamp()` keyed to viewport units). The spine grows
   gently (`clamp(60px,4.6vw,92px)`), and the canvas margin absorbs the rest of
   the resize. A minimum width (~860px) is probably still needed before the
   measure has to compress; the lower clamp bounds set that floor.
