# Ollie Money Module — Design Brief

## One-line vision

opening money should feel like turning the pull-quote spread in an Apartamento — bone paper, one large serif number breathing on it, hairlines doing the structural work the borders used to do.

## Context

- Replaces the current dark-brown fintech treatment at `apps/web/src/modules/finance/FinanceModule.tsx` (1892 lines, `#14130F` bg, `#C8A26A` gold, DM Mono labels everywhere). That treatment was tokenized as "finance v0 · deprecated" in `apps/web/src/design/tokens.css` line 70 — the redesign is bringing the module home, not inventing a new system.
- Ships inside Capacitor iOS first; desktop is dogfood-only.
- The user lands here from the dashboard module grid. Just before: pets / habits / cycle (also editorial-cream / ceramic). The current jump from sage-cream-bone to black-gold breaks the "I'm in one product" feeling. After: usually the dump module or back to dashboard.
- All logic exists at `packages/logic/src/finance/*` — the redesign cannot demand new computed values. Three derived signals are computed today but never surfaced (stale subscriptions, post-payday spikes, month-over-month delta on recurring) — surface them.
- All copy is keyed through `apps/web/src/i18n/index.ts` (`getString(locale, path)`); strings live in `strings.en.json` / `strings.es.json`. Every visible English line needs a Spanish twin before merge.

## References — the exact feeling

- **Apartamento, "Library" issue, pull-quote spread** — one serif sentence floats inside three-column breathing room. Borrow: a single hero number set against negative space, hairline rule above it. Not: any of the photo treatment.
- **Lufthansa Magazin "Aktuelles" flight-schedule pages** — narrow tabular type with old-style figures, perfect vertical alignment of digits. Borrow: tabular-nums on every dollar figure, right-aligned numerics. Not: their three-color editorial palette.
- **Monocle Forecast, annual report tables** — section labels in 9px caps with hairline rule exactly as wide as the label text. Borrow: the discipline of label + rule + dense data, no chrome. Not: their gold-foil flourishes.
- **Linear, the Issue Detail right rail** — pure data list, no card backgrounds, hairline row separators only, generous row height (52px). Borrow: the ledger row structure. Not: the dark theme, the keyboard chips.
- **Aesop product detail page** — body 17px serif sentence, "10ml decant available" style microcopy that earns its space. Borrow: long sentences with no marketing voice. Not: the photography column.
- **Hinge "Date from home" prompt cards** — a serif prompt followed by a tiny one-line answer; the prompt is the structure, the answer is the data. Borrow: pattern cards in this shape. Not: any pink.
- **Copilot's "Recurring" view (the iOS one)** — vertical list of recurring charges with a thin sparkline. Borrow: the calm of one-charge-per-row, mom-trip-cost style. Not: the gradient avatars.
- **Lunchmoney "Cash flow" stripped view** — month-band as a horizontal hairline with a tick where today sits. Borrow: the "safe to spend this week" treatment as a horizontal band, not a donut. Not: the chart overload.
- **anti-reference · Mint / Rocket Money** — every shame trigger Ollie can't ship. Pie charts that brag, red-orange "you overspent!" callouts, percentage-of-income comparisons. Reference exists to name what we never do.
- **anti-reference · current `FinanceModule.tsx`** — gold-on-near-black, DM Mono everywhere, every metric in a `border: 1px solid rgba(255,255,255,0.08)` rectangle. The exact thing the redesign throws out.

## Palette

Pull from `tokens.css` — do not invent. Every color used in the redesign is one of the eight existing tokens.

```css
--bone:       #FAFAF7;   /* page background, the world */
--paper:      #F4F1E8;   /* pull-quote bleed under the hero band only */
--paper-2:    #EFEBE0;   /* the "this week" temporal band, full-bleed */

--ink:        #14140F;   /* hero numeral, primary text */
--ink-soft:   #5A574E;   /* secondary text, body, eyebrow */
--ink-faint:  #9C9890;   /* meta, "due in 4 days" timestamps */
--ink-ghost:  #C8C4BA;   /* decorative numerals (the page-number style "01" before a section) */

--accent:     #2E5D43;   /* sage · single accent · the italic word in the hero, the "log expense" CTA outline */
--umber:      #8A4B2C;   /* unaccounted spend marker, ADHD tax running total, pattern card dot */
--warn:       #C9974C;   /* amber · ONLY on the "tight week" confidence band, and only when buffer < 1.2× */
--rule:       rgba(20,20,15,0.10);   /* primary hairlines */
--rule-soft:  rgba(20,20,15,0.05);   /* row separators inside ledger */
```

**Banned in this module:**
- no red, anywhere (overspending uses amber + the word "tight")
- no green-as-money (positive numbers are just ink; the only sage is the italic word + the CTA outline)
- no gradient backgrounds
- no surface fill on cards — hairlines only

## Typography

```
--font-editor: 'DM Serif Display'   — headings, hero numeral, italic accent word
--font-system: 'DM Sans'            — body, ledger amounts, captions
--font-mono:   'DM Mono'            — labels, timestamps, "DUE IN 4D"
```

| Stop | Size | Font | Weight | Letter-spacing | Where |
|---|---|---|---|---|---|
| hero-numeral | 96px (72px mobile) | DM Serif Display | 400, **tabular-nums** | -0.025em | the one big number — "safe to spend this week" |
| display | 42px | DM Serif Display | 400 | -0.018em | section openers ("the ledger", "patterns") |
| h2 | 22px | DM Serif Display | 400 | -0.012em | sub-section heads, bill names in the upcoming list |
| body | 17px | DM Sans | 400 | 0 | descriptions, "rent is due in 3 days. just saying." |
| amount-list | 17px | DM Sans | 500, **tabular-nums** | 0 | every dollar figure in the ledger and bills list |
| caption | 13px | DM Sans | 400 | 0.01em | meta lines, "logged 2h ago" |
| kicker | 11px | DM Mono | 500 | 0.16em caps | section eyebrows ("§ this week"), CTA labels |
| meta | 9px | DM Mono | 400 | 0.20em caps | "MO QU YR" frequency tags, "DUE IN 4D" |

**Numeric typography is first-class.** Every dollar figure carries `font-variant-numeric: tabular-nums lining-nums`. The hero numeral uses DM Serif Display with `font-feature-settings: 'tnum' 1, 'lnum' 1` — DM Serif's tabular form is the reason it earns its 96px.

**Italic rule:** exactly one italic word per hero spread, sage. "safe to *spend* this week." Not the whole phrase. One word. If the line doesn't grammatically support an italic, the line is wrong.

## Layout & spacing

**Mobile-first (the only-first).** Render assumes 390×844 (iPhone 15 viewport inside Capacitor).

Vertical rhythm — page is a magazine column, no horizontal scroll, no side rails:

```
[masthead]         88px from top, 24px sides
[eyebrow]          § THIS WEEK · 14 may–20 may          (24px below masthead, mono caps, hairline rule under)
[hero band]        full bleed, --paper-2 background, 96px vertical pad
  [hero kicker]    9px mono caps · "safe to spend"
  [hero numeral]   96px DM Serif · $347 · tabular
  [hero subtext]   17px DM Sans · "before next paycheck. comfortable."
  [confidence pip] 10px sage dot · "high confidence · 4 weeks of data"
[exhale]           48px breathing
[section: ledger]  display 42px · "the ledger"
  [ledger row × N] 64px row height · hairline-soft separators
[exhale]           80px breathing
[section: bills]   display 42px · "next 14 days"
  [bill row × N]   same row template
[exhale]           80px
[section: signals] display 42px · "noticed"
  [signal card]    hairline border-top only, 32px vert pad, no rounded corners
[exhale]           80px
[section: patterns]  display 42px · "patterns"
  [pattern card]   drawer-style, collapsed by default — one line + chevron
[exhale]           80px
[section: goals]   display 42px · "saving for"
  [goal tile]      hairline-bordered tile, 88px tall, name + remaining + tiny range
[exhale]           80px
[ADHD tax total]   small, lone, bottom-of-page — umber text, "season total: $124"
[footer]           120px tall · log expense CTA stuck inside, sage outline
```

Spacing tokens from `tokens.css`: `--s-4` (16), `--s-6` (24), `--s-8` (32), `--s-14` (56), `--s-20` (80), `--s-30` (120). 8px grid throughout.

**Structural choice that breaks the current dense scroll:** the redesign uses a **temporal frame** — `this week / next 14 / season` — not categorical (bills / subs / goals). The user reads top-to-bottom in time order, not screen-load order. This is the explicit "structurally differ from the current dense scroll" call.

**Tablet+ (1024+):** ledger occupies left 60%, signals + patterns float in a right 40% rail. Mobile stacks them sequentially. Capacitor iPad target ships as the desktop layout.

## Motion grammar

Three named curves, taken from `tokens.css`:

| Name | Curve | Duration | Use |
|---|---|---|---|
| `--e-calm-out` | cubic-bezier(0.18, 0, 0.22, 1) | `--d-settle` 800ms (entrance) / `--d-flick` 220ms (taps) | default ui, screen entrance, row reveal |
| `--e-breathe` | cubic-bezier(0.45, 0, 0.55, 1) | `--d-breathe` 6s | hero numeral breathe, sage CTA pulse |
| `--e-lift-set` | cubic-bezier(0.42, 0, 0.18, 1) | `--d-flight` 600ms | money pill flight when a transaction lands |

**Entrance choreography** — Framer Motion variants on a parent container.

```jsx
const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.18, 0, 0.22, 1] } } };
```

Stagger order: eyebrow → hero kicker → hero numeral → hero subtext → confidence pip → section heads → first 3 rows of each section. 80ms between siblings.

**Hero numeral ambient breathe** — 6s loop, `transform: scale(1) ↔ scale(1.004)`. Killed under reduced-motion. Restarts when the safe-to-spend value changes (treat the next value as a layout transition via Framer Motion `<motion.span key={value}>` + initial/animate, 600ms count-up).

**Ledger row tap** — 120ms scale to 0.99, no spring, returns linear. Row expanded view slides down 220ms `--e-calm-out`.

**Bill "mark paid"** — the row's amount fades to ink-faint and a hairline strike-through draws across it, 320ms. The row stays in place; doesn't disappear.

**Pattern drawer** — chevron rotates 220ms, drawer expands height auto (Framer Motion `layout` + `AnimatePresence`), springs settle 30/360.

**CTA ambient** — the "log expense" footer CTA has a 3.6s sage-glow loop: `box-shadow: 0 0 0 0 var(--accent-soft)` → `0 0 0 8px var(--accent-soft)` → `0 0 0 0`. Reduced-motion strips this. Hover ramps to a steady 4px ring.

**Reduced-motion rule:** all ambient kills automatically via the `--d-breathe`/`--d-drift` carve-out already in `tokens.css` line 218. Functional feedback (tap scale, row fade) stays.

## Component inventory

| Component | Role | States |
|---|---|---|
| `MoneyMasthead` | Top of page. Eyebrow ("§ THIS WEEK · 14 may–20 may"), section name "money" in DM Serif 28px, privacy mask toggle on right. | rest, masked |
| `SafeToSpendHero` | The hero band. Kicker, 96px numeral, subtext, confidence pip. | calm (sage), tight (amber), unknown (ink-faint, "—") |
| `LedgerRow` | One transaction. Date dot + merchant + category eyebrow + amount, all on one line at 64px height. Expandable to show notes, returnable-until, tax flag. | rest, expanded, returnable (umber dot), tax-flagged (warn dot) |
| `BillRow` | Same template as LedgerRow. "rent · housing" + "DUE IN 4D" mono + "$1,400" tabular. Tap → expand to "mark paid" + payment history. | upcoming, due today, overdue (warn), paid (ink-faint + strike) |
| `SubscriptionRow` | Same template. "netflix" + "MO" + "$15.49" + a stale dot if `last_used > 30d`. | active, marked-for-cancel (umber strikethrough on amount), stale (umber dot) |
| `SignalCard` | Editorial card for the three derived signals (stale subs, post-payday spike, MoM delta on recurring). DM Serif 22px headline, DM Sans 17px sentence, one CTA. No box, hairline rule above. | rest, dismissed (`opacity: 0.4`, "noted") |
| `PatternDrawer` | Collapsed: one line "doom-buying pattern · 6 events this season ›". Expanded: editorial spread with the named pattern, the merchant frequency, and the "noticed, not prescribed" copy. | collapsed, expanded |
| `GoalTile` | 88px tile. Name + remaining-to-target + tiny range "approx 3 mo at this pace". `+10 / +50 / +100` chip row appears on tap-expand. | rest, expanded |
| `ADHDTaxLine` | Bottom-of-page lone line. "season total: $124" in umber, 13px. Tap → expand to monthly summary. | rest, expanded |
| `LogExpenseCTA` | Footer-fixed primary action. Sage outline, "log expense" 15px DM Sans 500, 56px tall, full width minus 24px sides. | rest (pulsing), pressed, focused |
| `PrivacyMaskToggle` | Top-right of masthead. Existing component from `PrivacyToggle.tsx` — restyled with hairline border + sage when active. | unmasked, masked |
| `ImpulsePauseModal` | Existing component. Restyle: bone bg, DM Serif 28px "$X at Y. 2am. want to sleep on it?" + two sage-outline ghost buttons "sleep on it" / "i need it". | rest, holding, released |

## Interaction contracts

- tap hero numeral → no action (display only)
- tap ledger row → expand inline (220ms, slide-down). Tap again or tap outside → collapse.
- swipe-left on bill row → reveal "mark paid" action button (Framer Motion drag x, snap at -88px). Mobile only.
- tap pattern drawer chevron → expand (no full-screen modal — pattern stays in the column)
- tap goal tile → expand to show +10/+50/+100 chips inline
- tap log expense CTA → open transaction form sheet, slide up 320ms, sage CTA continues pulsing
- scroll → no parallax, no sticky chrome beyond the masthead which sticks at 88px top with a hairline rule appearing under it once scrolled past 32px
- keyboard tab order: masthead → privacy toggle → ledger rows → bill rows → signal CTAs → goal tiles → log expense CTA

## State machine

- **first-run** (no records ever): hero shows "—" in ink-ghost, kicker says "safe to spend". Subtext: "log your first expense — the rest fills in." Single CTA: "log expense". No ledger, no bills, no signals. Empty state is the most-loved screen — generous 200px top padding, one sentence, one CTA, ambient sage glow on the CTA.
- **loading** (store hydrating): no spinner. Hero numeral shows the last cached value at `opacity: 0.4`, a hairline shimmer animates across it 1.2s.
- **empty-this-week** (records exist, but no events in past 7 days): hero shows "$0 spent · room is room", a different copy variant. Ledger section title becomes "the ledger · quiet week."
- **tight** (safeToSpend.confidence === 'low' OR buffer < 1.2×): hero numeral stays ink (never red), confidence pip switches to amber `--warn`, subtext changes to "tight week. {N} days, {M} bills to clear." Amber appears nowhere else.
- **full** (the dogfood case): everything described above renders.
- **error** (corrupt finance store): dry message — "the ledger couldn't load this time. it's safe. tap to retry." Umber on "retry."
- **offline** (Capacitor offline): no change. Module is local-first; FinanceRecord lives in `VOID.store`.
- **masked** (privacy toggle on): every dollar figure shows `$•••`, hero numeral becomes `$•••` in DM Serif at the same size. Reveal animation: 320ms blur-from-8px-to-0 on toggle off.

## Surface rules

- **No card backgrounds.** Sections separate via typography + 1px `--rule` hairlines + whitespace. The "this week" hero band is the only filled surface (`--paper-2`, full bleed).
- **No drop shadows except on the impulse-pause modal** (`--sh-md`). Footer CTA gets the sage glow box-shadow only.
- **No rounded corners except chips** (`--r-pill` 999px) and **the impulse modal** (`--r-md` 12px). Everything else is `border-radius: 0`. Sharp edges are the brand.
- **Hairlines:** primary `--rule` (10% opacity ink) between sections and on row tops; `--rule-soft` (5%) inside dense lists for row separators.
- **Frosted glass:** no. Ollie's pod-b finance lives without it — that's a home/dashboard pattern.

## Voice & microcopy

**Tone anchor:** dry, deadpan, lowercase, no exclamation marks, no moralizing, no comparisons to last month (invites shame). Every line is a sentence a tired adult would say to themselves at the kitchen table.

Sample lines (each gets a string key in `strings.en.json` and a Spanish twin in `strings.es.json`):

- `finance.hero.calm` — "safe to *spend* this week."
- `finance.hero.tight` — "tight week. {days} days, {bills} bills to clear."
- `finance.empty.first_run` — "log your first expense. the rest fills in."
- `finance.bill.upcoming` — "{name} is due in {days} days. just saying."
- `finance.signal.stale_sub` — "netflix hasn't been touched in 47 days. still $15.49/mo."
- `finance.signal.post_payday` — "the day after payday tends to be your biggest spend day. pattern, not judgment."
- `finance.signal.mom_delta` — "electricity went up $18 from last month. heads up."
- `finance.pattern.doom_buying` — "6 sephora visits between 11pm and 2am this season. naming, not prescribing."
- `finance.goal.eta` — "approx 3 months at this pace."
- `finance.adhd_tax.line` — "season total: ${amount}. logged, not judged."
- `finance.impulse.prompt` — "${amount} at {merchant}. {time}. sleep on it?"

**Banned phrases:** "you should", "great job", "amazing", "crushing it", "watch out", any "!", any "🥚" / "💰" / emoji, "this month vs last month", "you overspent", "warning", "alert", "low balance". The word "warning" is replaced with nothing — "tight week" is the only edge.

**Spanish twins** must follow the same lowercase-deadpan rule. e.g. "semana ajustada. {days} días, {bills} cuentas por pagar." Not "¡semana ajustada!".

## Game-tier polish details

Force at least 5 of these to ship. Each tied to a specific element.

1. **Hero numeral ambient breathe** — 6s, scale 1 ↔ 1.004, `--e-breathe`. Stops under reduced-motion. Re-keys when value changes to trigger a count-up reveal.
2. **Tabular old-style figures** — DM Serif's `tnum` + `lnum` feature on every dollar number. Vertical alignment of digits down a ledger column is the visual proof that someone cared.
3. **One italic word per spread** — "safe to *spend* this week", "next *14* days", "saving *for*". Always sage, always italic, never more than one per heading.
4. **Sage CTA glow pulse** — `box-shadow 0 0 0 0 → 0 0 0 8px var(--accent-soft) → 0` over 3.6s. Reduced-motion: steady 1px ring instead.
5. **Date-dot eyebrow on every row** — each ledger / bill row begins with a 4px circle in `--ink-faint` (or `--umber` if returnable / `--warn` if overdue). Functional dot, not decorative — it carries state.
6. **Section-label hairline-exactly-the-text-width** — like Monocle. The `§ THIS WEEK` label has a 1px `--rule` under it whose width is the rendered width of the text, not the column. Implement via inline-block + `border-bottom`.
7. **Strike-through on paid bills** — when "mark paid" fires, an SVG `path` draws a hairline strike across the row over 320ms, the amount tween-fades to `--ink-faint`. The row does not disappear — it remains as evidence.
8. **Privacy mask blur reveal** — when unmasking, every dollar figure unblurs from `filter: blur(8px) → 0` in 320ms with a 40ms stagger across rows. Tiny piece of theater that earns the masking.
9. **The lone ADHD tax line at the bottom of the page** — no card, no header, just one umber sentence sitting in the last 120px of the column. It's the deliberate sad-line, the only umber on the page outside markers. A confessional, in editorial form.
10. **Empty state more loved than full state** — first-run gets 200px top padding, "log your first expense. the rest fills in." set at display 42px, one sage-outline CTA pulsing. No skeleton screens, no "tip" cards. Generosity before data.

## Anti-patterns — do NOT

- no red. not for overdue, not for "you overspent". amber `--warn` is the strongest edge, used once on the tight-week confidence pip.
- no green-as-money. positive amounts are just ink. sage is reserved for the italic word and the CTA outline.
- no rounded card containers. no `border-radius` on rows or sections. chips and the impulse modal only.
- no DM Mono on amounts. DM Mono is for labels, timestamps, frequency tags. amounts are DM Sans 500 tabular.
- no monospace headlines. the gold-on-black v0 used DM Mono for section titles — the redesign uses DM Serif 42px.
- no pie chart, no donut chart, no stacked bar. the only chart is the "safe to spend" confidence band — a horizontal hairline with a tick at "today." That's it.
- no "this month vs last month" comparison framing in any copy. Month-over-month delta on recurring bills surfaces as a one-line signal ("electricity went up $18 from last month. heads up."), never as a percentage bar.
- no exclamation marks anywhere. ever. greppable rule.
- no card drop shadows beyond the impulse modal.
- no full-screen modals except the impulse-pause hold. Pattern drawers, goal expansions, signal CTAs all stay in the column.
- no streaks, no XP, no badges, no "you saved $X this month!" celebration screen.
- no comparisons to other users. no median. no benchmarks.
- no `border-radius > 12px` outside chips (`--r-pill`).
- no gradient backgrounds. no faux-3D. no shine.
- no Framer Motion springs on entrance children — ceramic-archetype call: editorial is heavy, not bouncy. Springs are allowed on the goal `+10/+50/+100` chip presses only (subtle, 0.98 → 1).

## Tech & constraints

- File: rewrite `apps/web/src/modules/finance/FinanceModule.tsx`. Split into 6 components under `apps/web/src/modules/finance/components/`: `MoneyMasthead.tsx`, `SafeToSpendHero.tsx`, `LedgerRow.tsx` (shared by bills/subs/transactions), `SignalCard.tsx`, `PatternDrawer.tsx`, `GoalTile.tsx`. Keep `ImpulsePauseModal.tsx` and `PrivacyToggle.tsx` as-is; restyle inline only.
- React 18 + TS. Framer Motion already on the project (`motion@11`). No new deps.
- All colors via `var(--token)` from `apps/web/src/design/tokens.css`. Zero raw hex values in `.tsx` files. Greppable: `grep -E "#[0-9a-f]{6}" apps/web/src/modules/finance/` must return zero hits after this lands.
- All visible copy via `getString(locale, 'finance.…')` from `apps/web/src/i18n/index.ts`. Add every new key to both `strings.en.json` and `strings.es.json` in the same commit.
- All logic via `@ollie/logic/finance` — no new computed values added in this sprint. If a signal needs a value not yet computed (e.g. BSAS scoring, 30-day forecast), it does not ship in this pass. Flagged below.
- Capacitor iOS first. Test on iPhone 15 simulator at 390×844. Tap targets ≥44×44 per WCAG.
- Reduced-motion behavior already wired via `tokens.css` line 218. Verify with `prefers-reduced-motion: reduce` in DevTools.
- Privacy mask must keep `aria-label` honest — screen readers should read "amount hidden" on masked figures, not "•••".

**Behind-engineering flags (do NOT ship in this pass):**
- BSAS at-risk scoring — logic exists at `packages/logic/src/finance/bsas.ts` but no orchestrator wire-up. Defer to a separate logic-wiring sprint.
- 30-day forecast — not computed. Defer.
- post-payday spike — `detectPostPaydaySpikes` runs in orchestrator but writes nowhere visible; this redesign surfaces it as a `SignalCard` and requires the orchestrator write the result to `void.state.finance.signals.post_payday_spike`. Coordinate with backend.
- stale-subscriptions — `detectSubscriptionStale` is wired; this redesign just surfaces it. No backend work needed.
- MoM delta on recurring — derived inline from existing `payments[]` history. No backend work needed.

## Success criteria

1. `grep -rE "#[0-9a-fA-F]{6}" apps/web/src/modules/finance/` returns 0 hits (all colors via tokens).
2. `grep -rE "!" apps/web/src/i18n/strings.{en,es}.json | grep -E "finance\\." ` returns 0 hits (no exclamation marks in finance copy).
3. Module renders inside Capacitor iOS at 390×844 without horizontal scroll, without any line of text being cut off.
4. Landing on the module from dashboard produces a discernible "I'm in the same product" feeling — the bone background is continuous with the dashboard, no dark-mode jump.
5. Hero numeral updates animate with the count-up reveal on every value change. Reduced-motion strips the animation but keeps the value update.
6. Empty state (zero records) renders as a one-sentence + one-CTA screen, not a skeleton.
7. Privacy mask covers every dollar figure including the hero numeral. Toggle reveals with the blur-from-8px animation.
8. Every visible string lives in `strings.en.json` and `strings.es.json`. No hard-coded English literals in `.tsx`.
9. Three previously-hidden signals (stale subs, post-payday spike, MoM delta on recurring) each render as a `SignalCard` when the underlying logic emits.
10. `node tools/notification_scope_tests.js` passes. No new push triggers added by this redesign.
