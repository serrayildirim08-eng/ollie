# Ollie Money Module — Design Brief (v2)

## One-line vision

opening money should feel like opening a 1968 Olivetti annual report bought at an estate sale — paper you can feel through your screen, a single ink-black thumbprint anchoring the page, one big serif numeral that looks pressed into the stock rather than rendered onto it.

v2 redirect: v1 read as Aesop-cosplay beige-on-beige. Same bones, same temporal frame, same hidden signals — but now: visible paper texture, one solid ink block per scroll, mixed type families, asymmetric margins, one printer's-mark gesture per section. **Calm with tension, not calm with sleep.**

## What survives from v1 (do not rewrite)

- temporal frame (this week → next 14 → patterns → goals → tax line) — keep.
- three surfaced signals (stale subs, post-payday spike, MoM delta) — keep, restyle.
- ledger row template, bill row template, pattern drawer collapsed-by-default, goal tile, ADHD tax lone-line, footer CTA — keep, restyle.
- numeric typography first-class (tabular + lining figures) — keep, harden.
- EN+ES lexicon discipline — keep, all string keys unchanged.
- Capacitor iOS as the only-first target — keep.
- deferred features (BSAS, 30-day forecast) — keep deferred.

## What changes (the v2 contract)

1. **Cream is now a substrate, not a color.** Add a paper-fiber texture via inline SVG noise filter at low opacity. The cream still reads as cream; the texture only shows up when the eye actually rests on a surface. Implemented once at the body level, sampled into the hero band at slightly higher opacity to feel like ink soaked into the stock.
2. **One solid ink-block per scroll.** A thumbprint-sized `--ink` rectangle in the masthead containing a single sage numeral (the week number `§ 20`). A second small ink block in the patterns section masthead. These are the page's anchors — 95% cream, 5% true ink, zero in-between.
3. **Mixed type, not monocultured.** Display swaps from DM Serif Display to **PP Editorial Old (Italic Regular for accent words, Roman for headlines)** with **Söhne** in body weight 400/500 and **JetBrains Mono** for the few mono moments. CDN-free alternates listed below. The italic is now a real italic with a writer's hand, not a synthetic slant.
4. **Asymmetric margins.** Hero band sits column-left (24px left, 56px right). The "noticed" section sits column-right (56px left, 24px right). The ADHD tax line sits 88px from the left edge with the rest of the column flush. Wabi-sabi means margins that breathe like a hand-set page, not like a CSS reset.
5. **One small graphic gesture per section.** Not charts. Marks:
   - masthead: a hand-drawn dotted rule under the eyebrow (SVG `stroke-dasharray: 2 4`), printed at 60% opacity.
   - hero: a tiny printer's mark (`‡`) at 11px in `--umber` sitting in the bottom-right corner of the ink block.
   - ledger: a § glyph at 24px ink-ghost sitting outside the column to the left, the way a marginalia note would.
   - signals: a hairline crosshatch ornament (`/ / / /` three diagonal hairlines) between the headline and body.
   - patterns: a `¶` glyph at 24px ink-ghost sitting outside the column to the right.
   - goals: a hand-drawn dotted underline beneath the dollar amount.
6. **One section sits at column-right.** The "noticed" signals section breaks the column with a hard 56px left indent — feels like a marginalia callout in a printed book.

## Context

(Unchanged from v1.) Replaces `apps/web/src/modules/finance/FinanceModule.tsx`. Capacitor iOS first. All copy keyed through `getString(locale, 'finance.…')`. All logic from `@ollie/logic/finance`. No new push triggers.

The redesign is bringing the module home, not inventing a new system. v2 differs from v1 only in skin and texture.

## References — the exact feeling

(See `money-moodboard.md` for full annotated list. Compressed here.)

- **Pirelli Calendar 1972 (Hans Feurer issue)** for masthead-as-typography moment.
- **Aperture Magazine #243** for column-right asymmetric callouts and small-mark ornaments.
- **Daido Moriyama's "Provoke 3" book binding** for the solid black-block-as-anchor on cream stock.
- **Tadeusz Trepkowski's "1944 Nie" poster** for one tiny dark mass against a vast pale field.
- **Tanaka Ikko's Nihon Buyō poster (1981)** for ink-block + small color accent moves.
- **Rapha 100 Years catalogue** for italic-Roman type pairing as restraint.
- **Drake's London "Hand-Rolled" capsule lookbook** for type-as-fabric mixing.
- **Mast Brothers — Madagascar bar wrapper** for the printer's-mark + dotted-rule + typographic ornament vocabulary.
- **MoMA "Items: Is Fashion Modern?" exhibition catalog** as the wild card — for paper texture as the message.

## Palette

Same tokens as v1, plus two new derived tokens for texture work. **Constraint relaxed** per redirect.

```css
/* surfaces — same as v1 */
--bone:       #FAFAF7;
--paper:      #F4F1E8;
--paper-2:    #EFEBE0;

/* ink — same */
--ink:        #14140F;
--ink-soft:   #5A574E;
--ink-faint:  #9C9890;
--ink-ghost:  #C8C4BA;

/* accents — same */
--accent:     #2E5D43;
--umber:      #8A4B2C;
--warn:       #C9974C;

/* hairlines — same */
--rule:       rgba(20,20,15,0.10);
--rule-soft:  rgba(20,20,15,0.05);

/* NEW v2 — paper texture pair */
--paper-grain:    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.055 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
--paper-grain-hero: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.085 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");

/* derived */
--accent-soft: rgba(46, 93, 67, 0.14);
```

**Where each color goes:**
- `--bone` page substrate + `--paper-grain` overlay at body level.
- `--paper-2` hero band + `--paper-grain-hero` (slightly denser noise) overlay — the band reads as "ink soaked deeper into this part of the stock."
- `--ink` solid block in masthead (44×44px containing `20` in sage), patterns section anchor (32×32px), printer's-mark glyphs. Never as a card background; always as a *mark*.
- `--accent` italic display words ("safe to *spend*", "next *14* days", "saving *for*") + CTA outline + the numeral inside the masthead ink block.
- `--umber` ADHD tax line, returnable dot, pattern dot, the small `‡` mark.
- `--warn` tight-week confidence pip only — same as v1.

**Banned in this module:**
- no red.
- no green-as-money.
- no gradient backgrounds (except the texture overlay, which is noise, not a gradient).
- no card fills outside the hero band and the two ink anchor blocks.
- no rounded corners on the ink blocks — they're inkwell-square.

## Typography

```
--font-editor:    'PP Editorial Old', 'EB Garamond', Georgia, serif
--font-editor-it: 'PP Editorial Old Italic', 'EB Garamond Italic', Georgia, serif
--font-system:    'Söhne', 'Inter', system-ui, sans-serif
--font-mono:      'JetBrains Mono', 'DM Mono', Menlo, monospace
```

CDN fallback chain for the vibe-check (PP Editorial Old is licensed; we use **EB Garamond + Cormorant Garamond Italic** as the public substitute that ships the same hand. Söhne → Inter Tight 400/500 as a close-enough public fallback). The production app uses whatever the design system actually licenses; this brief commits to the *shapes*: a transitional serif with a pronounced italic, a humanist sans with personality, a mono with visible drawing.

| Stop | Size (mobile / desktop) | Font | Weight | Letter-spacing | Where |
|---|---|---|---|---|---|
| hero-numeral | 76px / 100px | Editor (Roman) | 400, **tabular-nums** | -0.022em | the one big number |
| hero-italic-word | 22px / 26px | Editor (Italic) | 400 | -0.008em | "safe to *spend* this week." |
| display | 36px / 46px | Editor (Roman) | 400 | -0.016em | section opener heads |
| display-italic | 36px / 46px | Editor (Italic) | 400 | -0.012em | one section opener — "saving *for*" — uses italic on the whole heading word |
| h2 | 22px | Editor (Roman) | 400 | -0.010em | signal headlines, bill names |
| body | 16px | System | 400 | 0 | body sentences, ledger names |
| amount-list | 17px | System | 500, **tabular-nums** | -0.005em | every dollar figure in lists |
| caption | 13px | System | 400 | 0.005em | meta, "logged 2h ago" |
| kicker | 11px caps | Mono | 500 | 0.14em | section eyebrows |
| meta | 9px caps | Mono | 400 | 0.18em | "DUE IN 4D" tags |
| marginalia | 24px | Editor (Roman) | 400 | 0 | the § ¶ ‡ glyphs in margins |

**Italic earns its spot.** Exactly three italic moments per page:
1. one italic word in the hero subtitle ("safe to *spend* this week.")
2. one full italic heading in the goals section ("saving *for*")
3. one italic word in the next-14 heading ("next *14* days")

That's the hand of the page. No incidental italics elsewhere.

**Tabular old-style figures stay first-class.** Every dollar figure carries `font-variant-numeric: tabular-nums lining-nums`. The hero numeral, plus every amount-list row, plus the masthead's "20" sage numeral inside the ink block.

## Layout & spacing

Mobile-first. iPhone 15 viewport (390×844). Capacitor only.

```
[masthead]            64px top pad · 24px right · 24px left
  ├─ "money" — 28px Editor Roman, column-left
  └─ ink-block 44×44 — sage "20" inside, column-right
                       (under it, "§ THIS WEEK · 14 MAY", 9px mono, ink-faint)
[dotted hand-rule]    SVG stroke-dasharray '2 4', 60% opacity, 24px left, 200px wide, sits 16px under masthead

[hero band]           full bleed but inner content 24px left / 56px right
                      96px vertical pad
                      background: var(--paper-2) + var(--paper-grain-hero)
  [hero kicker]       9px mono caps · "SAFE TO SPEND"
  [hero numeral]      96px Editor Roman · $347 · tabular
  [‡ printer's mark]  11px umber · bottom-right corner of the band, 24px from edges
  [hero italic line]  22px Editor — "safe to *spend* this week." · italic word sage
  [confidence pip]    9px mono caps · "HIGH CONFIDENCE · 4 WEEKS OF DATA" with a sage dot before

[breath]              56px

[section: ledger]
  ├─ § marginalia     24px Editor Roman ink-ghost, sits 8px outside column-left
  ├─ display          "the ledger" · 36px Editor Roman
  └─ rows             64px each, hairline-soft separators, column-left flush

[breath]              80px

[section: next 14]
  ├─ display-italic   "next *14* days" · italic word sage
  └─ rows             same template

[breath]              80px

[section: noticed]    asymmetric — content sits at column-RIGHT
                      (56px left indent, 24px right)
  ├─ display          "noticed" · 36px Editor Roman
  ├─ crosshatch mark  / / / / SVG between headline and body, ink-soft, 60% opacity
  └─ signal card      hairline top only, no card fill

[breath]              80px

[section: patterns]
  ├─ second ink-block 32×32 sage numeral "6" (count of named patterns), column-right
  ├─ ¶ marginalia     24px ink-ghost, 8px outside column-right
  ├─ display          "patterns" · 36px Editor Roman, column-left
  └─ drawer rows      collapsed by default

[breath]              80px

[section: goals]
  ├─ display-italic   "saving *for*" · italic full word sage
  ├─ goal tile        hairline-bordered, 88px tall
  └─ dotted underline under each remaining-to-target figure (SVG, 1px ink-faint)

[breath]              112px

[ADHD tax line]       sits 88px from LEFT (not centered, not flush) — wabi-sabi off-axis
                      umber, 13px System, "season total: $124. logged, not judged."

[footer CTA]          fixed bottom, sage outline, full width minus 24px sides
```

8px grid. Spacing tokens from `tokens.css` unchanged: `--s-2`(8) `--s-3`(12) `--s-4`(16) `--s-6`(24) `--s-8`(32) `--s-14`(56) `--s-20`(80) `--s-30`(120).

**The asymmetry is intentional.** The "noticed" section breaks the column to the right. The ADHD tax line breaks left. The eye registers this as *care*, not as a bug.

**Tablet+ (1024+):** ledger + bills column-left at 60%, signals + patterns + goals column-right at 40%. The asymmetry on mobile becomes a *real* two-column layout on desktop. iPad ships desktop layout.

## Motion grammar

Three named curves, taken from `tokens.css` — identical to v1.

| Name | Curve | Duration | Use |
|---|---|---|---|
| `--e-calm-out` | cubic-bezier(0.18, 0, 0.22, 1) | `--d-flick` 220ms entrance taps · `--d-settle` 800ms screen | row reveal, drawer, entrance |
| `--e-breathe` | cubic-bezier(0.45, 0, 0.55, 1) | `--d-breathe` 6s | hero numeral breathe, CTA pulse |
| `--e-lift-set` | cubic-bezier(0.42, 0, 0.18, 1) | `--d-flight` 600ms | hero count-up reveal |

**New v2 motion: the texture stays still.** The paper-grain noise overlay does not animate. Everything else can breathe; the substrate doesn't. This is a contract — animating noise reads as "TV static," which kills the print metaphor instantly.

**Entrance choreography** (Framer Motion variants on parent):
```jsx
const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.12 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.18, 0, 0.22, 1] } } };
```

Stagger order: masthead → ink block → hand-rule → eyebrow → hero kicker → hero numeral → ‡ mark → italic line → confidence pip → § marginalia → display heads (one at a time per section) → first 3 rows of each section. 80ms between siblings. The ink blocks and marginalia glyphs come *before* the heading they anchor — the marks are revealed first, then the text settles into them.

**Hero numeral ambient breathe** — 6s loop, `scale 1 ↔ 1.004`. Stops under reduced-motion. Re-keys on value change via Framer Motion `<motion.span key={value}>` + count-up reveal 600ms.

**Hand-rule "draw on" once** — the SVG dotted rule under the masthead draws left-to-right over 800ms on first mount only. Uses `stroke-dasharray` + `stroke-dashoffset` animation. Stops being touched after mount.

**Crosshatch mark in signals** — appears with the section, no motion of its own. Static.

**Ledger row tap** — 120ms scale to 0.99, linear, returns linear.

**Bill "mark paid"** — same as v1: amount fades to ink-faint, hairline strike-through draws across 320ms. Row stays.

**Pattern drawer** — chevron rotates 220ms, drawer expands via Framer Motion `layout` + `AnimatePresence`, no spring.

**CTA ambient** — sage glow pulse, 3.6s loop, identical to v1.

**Reduced-motion rule:** all ambient kills automatically. Tap feedback + state fades stay. The hand-rule "draw on" is replaced by a static fully-drawn rule.

## Component inventory

| Component | Role | States | New in v2 |
|---|---|---|---|
| `MoneyMasthead` | "money" + 44×44 ink block with sage week-number + dotted hand-rule under it. | rest, masked | NEW: ink block + hand-rule SVG |
| `SafeToSpendHero` | Hero band — kicker, 96px numeral, ‡ mark, italic line, confidence pip. | calm (sage), tight (amber), unknown (ink-ghost "—") | NEW: textured background, ‡ mark, asymmetric inner margins |
| `MarginaliaGlyph` | The `§ ¶ ‡` printer marks sitting outside the column. | rest only | NEW component |
| `LedgerRow` | Same as v1 — date dot + name + eyebrow + amount, 64px row. | rest, expanded, returnable, paid, stale | unchanged |
| `BillRow` | Same shape, "DUE IN 4D" meta. | upcoming, due-today, overdue, paid | unchanged |
| `SubscriptionRow` | Same shape, stale dot. | active, marked, stale | unchanged |
| `SignalCard` | Editorial card, asymmetric — sits at column-right indent. Crosshatch mark inside. | rest, dismissed | NEW: column-right indent, crosshatch ornament |
| `PatternDrawer` | Collapsed one-liner with ¶ marginalia outside the column. | collapsed, expanded | NEW: ¶ glyph outside column-right |
| `GoalTile` | 88px tile + dotted underline under the remaining figure. | rest, expanded | NEW: dotted SVG underline |
| `ADHDTaxLine` | Lone line, sits 88px from left edge, umber. | rest, expanded | NEW: off-axis positioning |
| `LogExpenseCTA` | Footer CTA, sage outline, pulse. | rest (pulsing), pressed, focused | unchanged |
| `PrivacyMaskToggle` | Masthead top-right. | unmasked, masked | unchanged |
| `ImpulsePauseModal` | Existing, restyled inline. | rest, holding | unchanged |

## Interaction contracts

Same as v1. The asymmetry doesn't change taps. Every tappable target is still ≥44×44.

- tap hero numeral → no action (display only).
- tap ledger row → expand inline 220ms.
- swipe-left on bill row → reveal "mark paid" at -88px. Mobile only.
- tap pattern drawer → expand inline (¶ marginalia stays put).
- tap goal tile → +10/+50/+100 chips appear inline.
- tap log expense CTA → transaction form sheet, 320ms slide-up.
- scroll → masthead sticks at 56px top with a hairline rule appearing under it once scrolled past 32px. The ink block stays in the sticky masthead.

## State machine

Same as v1. v2 additions:

- **first-run:** the ink block in the masthead reads `01` in sage (week 1). No § glyph. No printer marks except the ‡. Empty state still gets the 200px top pad + one CTA.
- **loading:** texture stays visible; hero numeral at 0.4 opacity over the textured band; no shimmer (the texture *is* the shimmer).
- **masked:** every dollar figure → `$•••`. The masthead ink block stays — the week number isn't private. The hero numeral blurs to 0 over 320ms when toggled off.

All other states (tight, full, error, offline, empty-this-week) identical to v1.

## Surface rules

- **Two filled surfaces only:** the hero band (`--paper-2` + `--paper-grain-hero`) and the two ink anchor blocks (`--ink`). Nothing else has a fill. Hairlines do the structural work, texture does the substrate work, ink blocks do the anchoring.
- **Texture lives at the body level** as a background-image — never animated, never per-component. The hero band gets a second layer of noise at slightly higher opacity to feel like a denser patch of stock.
- **No drop shadows except on the impulse modal.** Footer CTA gets the sage glow box-shadow ring only.
- **No rounded corners** except chips (`--r-pill` 999px) and the impulse modal (`--r-md` 12px). Everything else is `border-radius: 0`. The ink blocks are sharply rectangular.
- **Hairlines** carry separation: `--rule` (10%) between sections, `--rule-soft` (5%) inside dense lists.
- **Frosted glass:** no.

## Voice & microcopy

Identical to v1. Tone anchor stays: dry, deadpan, lowercase, no exclamation marks. Every string key from v1 stays in `strings.en.json` and `strings.es.json` — no new keys in v2.

The voice is already the most alive part of v1. The vibe was dying in the *look*, not the words.

## Game-tier polish details

Force at least 5 of these to ship. v2 reshuffles v1's list — five v1 polish moves survive; five v2 polish moves are new.

**Surviving from v1:**
1. **Hero numeral ambient breathe** — 6s, scale 1 ↔ 1.004. Stops under reduced-motion. Re-keys on value change with count-up.
2. **Tabular old-style figures** — every dollar figure carries `tnum` + `lnum`. Visual proof.
3. **One italic word per spread** — sage, three places total per scroll.
4. **Strike-through on paid bills** — SVG path draws over 320ms when "mark paid" fires.
5. **Privacy mask blur reveal** — 320ms blur(8px → 0) with 40ms stagger across rows.

**New in v2:**
6. **Paper-grain texture overlay** — SVG noise at body level + denser pass on the hero band. Static. Never animates. Becomes visible the moment the eye rests. Disappears in screenshots taken at <1× DPR — *that's the point*.
7. **Solid ink anchor blocks** — 44×44 in masthead (sage "20") and 32×32 in patterns (sage count). 5% of the page is true `--ink`. The eye lands here first on every scroll.
8. **Marginalia glyphs** — `§` outside the ledger column, `¶` outside the patterns column, `‡` inside the hero band's bottom-right corner. Set in `--ink-ghost` and `--umber`. Each one says "a typographer was here."
9. **Hand-drawn dotted rule** — SVG `stroke-dasharray: 2 4` rule under the masthead. Draws left-to-right over 800ms once on first mount. Sits at 60% opacity. Reads as a printer's guide, not a divider.
10. **Asymmetric section margins** — "noticed" sits column-right (56px left indent). ADHD tax line sits 88px from the left, not flush. The page has a hand.

## Anti-patterns — do NOT

- no red. ever. amber for the tight pip; that's the edge.
- no green-as-money. positive = ink. sage = italic + CTA + masthead numeral.
- no rounded card containers.
- no DM Mono on amounts.
- no monospace headlines.
- no charts of any kind.
- no "this month vs last" comparison framing in any copy.
- no exclamation marks anywhere.
- no card drop shadows beyond the impulse modal.
- no full-screen modals except impulse-pause.
- no streaks, no XP, no badges.
- no comparisons to other users.
- no gradients (the texture is noise, not a gradient).
- **v2-specific:** no animated texture. The noise is static. Animating the substrate breaks the print metaphor.
- **v2-specific:** no second sage moment per section beyond the contracted three. If a fourth sage thing wants in, kill one of the existing three.
- **v2-specific:** no dark mode toggle, no "more contrast" version of the page. Mass is via small ink blocks; the page never inverts.
- **v2-specific:** no decorative ink-block. The two anchor blocks contain a real piece of data (week number, count of patterns). Empty ink blocks read as design-school.
- **v2-specific:** no Framer Motion springs on entrance children. Editorial archetype is heavy. Springs only on goal-bump chip presses.

## Tech & constraints

- File: `apps/web/src/modules/finance/FinanceModule.tsx` rewrite + components under `apps/web/src/modules/finance/components/`: `MoneyMasthead.tsx`, `SafeToSpendHero.tsx`, `MarginaliaGlyph.tsx` (new), `LedgerRow.tsx`, `SignalCard.tsx`, `PatternDrawer.tsx`, `GoalTile.tsx`.
- React 18 + TS strict. Framer Motion 11. No new runtime deps.
- All colors via `var(--token)` from `tokens.css`. Greppable: `grep -E "#[0-9a-f]{6}" apps/web/src/modules/finance/` must return 0 hits.
- Two new CSS custom properties (`--paper-grain`, `--paper-grain-hero`) added to `tokens.css` in the same PR. They carry inline SVG data URLs and live alongside the existing surface tokens.
- Font loading: PP Editorial Old is a licensed face. Production: use whatever the design system licenses. Vibe-check: use EB Garamond + Cormorant Garamond Italic from Google Fonts (free) as the public-facing substitute. Söhne → Inter Tight as the system fallback. JetBrains Mono → DM Mono fallback chain.
- All copy via `getString(locale, 'finance.…')`. Spanish twins required.
- Capacitor iOS first. Test at 390×844. Tap targets ≥44×44.
- Reduced-motion behavior wired via `tokens.css` line 218. Texture stays visible under reduced-motion (it doesn't animate anyway).
- Privacy mask: `aria-label="amount hidden"` on every masked figure.
- The SVG-noise data URLs are ~700 chars each — under 1.5KB total added to the bundle. No performance hit.

**Behind-engineering flags (do NOT ship in this pass):**
- BSAS at-risk scoring, 30-day forecast, sleep-debt × spend correlation — same as v1, deferred.

## Success criteria

1. `grep -rE "#[0-9a-fA-F]{6}" apps/web/src/modules/finance/` returns 0 hits.
2. `grep -rE "!" apps/web/src/i18n/strings.{en,es}.json | grep -E "finance\."` returns 0 hits.
3. Module renders on Capacitor iOS at 390×844 with no horizontal scroll.
4. Paper-grain texture is *visible* when the user rests their eye on a still area (especially the hero band). Test: a screenshot of an empty area of the page does not look like solid `--bone` — it has fiber.
5. Two ink anchor blocks render (masthead 44×44, patterns 32×32), each with a sage tabular numeral inside.
6. Three marginalia glyphs (§ ¶ ‡) render, each sitting outside its parent column by 8px, never inside the reading column.
7. One full italic display heading ("saving *for*") and two italic-word headings ("safe to *spend* this week", "next *14* days") — exactly three italic moments per page, no more.
8. "noticed" section sits at column-right with a hard 56px left indent. ADHD tax line sits 88px from left, not flush.
9. Hero numeral updates animate with count-up reveal; texture does NOT animate.
10. Every previously-hidden signal (stale subs, post-payday spike, MoM delta) still renders as a `SignalCard` when the underlying logic emits.
11. `node tools/notification_scope_tests.js` passes. No new push triggers.
12. Side-by-side with v1 `money-vibe-check.v1.html`, the v2 page reads as a designed page rather than a layout-engine output. If a designer friend can't tell at a glance that someone *placed* every element, v2 has failed.
