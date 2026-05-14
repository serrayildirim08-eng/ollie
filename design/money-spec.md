# Ollie Money Module — Spec (v2)

Source of truth for tokens, type, motion, components, and state. v2 — texture, contrast, mixed type. v1 frozen alongside as `money-spec.v1.md`. Components / state / strings / a11y / tech sections unchanged from v1.

## Palette tokens (v2 — adds two texture tokens)

```css
/* surfaces — same as v1 */
--bone:       #FAFAF7;   /* page bg · substrate */
--paper:      #F4F1E8;   /* reserved for callouts */
--paper-2:    #EFEBE0;   /* hero band fill */

/* ink — same as v1 */
--ink:        #14140F;   /* hero numeral, anchor blocks, primary text */
--ink-soft:   #5A574E;   /* body, eyebrow */
--ink-faint:  #9C9890;   /* meta, paid-strike */
--ink-ghost:  #C8C4BA;   /* marginalia glyphs §¶, "—" placeholders */

/* accents — same as v1 */
--accent:     #2E5D43;   /* sage · italic word, CTA outline, anchor-block numeral · 3 places */
--umber:      #8A4B2C;   /* ADHD line, pattern dot, returnable, ‡ printer's mark */
--warn:       #C9974C;   /* tight-week pip ONLY */

/* hairlines — same as v1 */
--rule:       rgba(20,20,15,0.10);
--rule-soft:  rgba(20,20,15,0.05);

/* NEW in v2 — paper texture pair */
--paper-grain:      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.055 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
--paper-grain-hero: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.085 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");

/* derived */
--accent-soft: rgba(46, 93, 67, 0.14);
```

**Texture usage rule:**
- `--paper-grain` applied at `body` level via `background-image`, sits over `--bone`. Tile 160×160. Static. No animation.
- `--paper-grain-hero` applied to the hero band only, denser noise (opacity 0.085 vs 0.055). Reads as a patch of paper that absorbed more ink.
- Texture is never per-component, never per-card, never animated. The substrate is still.

**Solid `--ink` lives in two places only:**
- masthead anchor block (44×44, contains sage week-number).
- patterns section anchor block (32×32, contains sage pattern-count).

Nowhere else does the page show a solid ink fill. The marks (§ ¶ ‡) are not fills — they're glyphs.

## Typography scale (v2 — mixed families, italic earns its spot)

```
--font-editor:     'PP Editorial Old', 'EB Garamond', Georgia, serif    /* transitional serif, headlines + numerals */
--font-editor-it:  'PP Editorial Old Italic', 'Cormorant Garamond Italic', Georgia, serif  /* writer's-hand italic */
--font-system:     'Söhne', 'Inter Tight', system-ui, sans-serif        /* body + amounts */
--font-mono:       'JetBrains Mono', 'DM Mono', Menlo, monospace        /* labels + meta */
```

Vibe-check public fallbacks (Google Fonts only): **EB Garamond + Cormorant Garamond Italic + Inter Tight + JetBrains Mono**. Production uses whatever the design system licenses; the brief commits to the *shapes* — transitional serif with a real italic, humanist sans with personality, mono with visible drawing.

| Stop | Size (mobile / desktop) | Font | Weight | Letter-spacing | Line-height | Feature settings |
|---|---|---|---|---|---|---|
| hero-numeral | 76px / 100px | Editor (Roman) | 400 | -0.022em | 1.00 | `tnum 1, lnum 1` |
| hero-italic-line | 22px / 26px | Editor (mix Roman+Italic) | 400 | -0.008em | 1.30 | — |
| display | 36px / 46px | Editor (Roman) | 400 | -0.016em | 1.10 | — |
| display-italic | 36px / 46px | Editor (Italic, full word) | 400 | -0.012em | 1.10 | — |
| h2 | 22px | Editor (Roman) | 400 | -0.010em | 1.20 | — |
| body | 16px | System | 400 | 0 | 1.55 | — |
| amount-list | 17px | System | 500 | -0.005em | 1.40 | `tnum 1, lnum 1` |
| caption | 13px | System | 400 | 0.005em | 1.45 | — |
| kicker | 11px caps | Mono | 500 | 0.14em | 1.30 | — |
| meta | 9px caps | Mono | 400 | 0.18em | 1.30 | — |
| marginalia | 24px | Editor (Roman) | 400 | 0 | 1.00 | — |
| anchor-numeral | 18px | Editor (Roman) | 400 | -0.020em | 1.00 | `tnum 1, lnum 1` |

**Italic contract — exactly three italic moments per page:**
1. one italic word in the hero subtitle: "safe to *spend* this week."
2. one italic word in the next-14-days display heading: "next *14* days"
3. one full italic word in the goals display heading: "saving *for*"

No incidental italics elsewhere. The italic is the page's hand; it should be findable on three fingers.

**Tabular old-style figures stay first-class.** Hero numeral, every amount-list row, the sage anchor-block numerals — all carry `font-variant-numeric: tabular-nums lining-nums`. The eye sweeping down the ledger column finds digit-spines aligned.

## Spacing scale

8px grid. Use tokens from `tokens.css`:

```
--s-1: 4  --s-2: 8  --s-3: 12  --s-4: 16  --s-6: 24
--s-8: 32  --s-10: 40  --s-14: 56  --s-20: 80  --s-30: 120
```

**Section rhythm:** between major sections — 80px (`--s-20`). Inside section, between heading and first row — 24px (`--s-6`). Between rows — 0 (separator-hairline does the work). Hero band — 96px vertical pad. Footer CTA gap above — 120px (`--s-30`).

## Breakpoints

| Token | Min width | Layout |
|---|---|---|
| mobile | 0 | single column, 24px sides, footer CTA fixed |
| tablet | 768 | single column, 48px sides, footer CTA fixed |
| desktop | 1024 | 60/40 split — ledger + bills left, signals + patterns + goals right |
| desktop-wide | 1440 | content max 1200px, centered |

Capacitor iOS runs at mobile breakpoint. Capacitor iPadOS hits tablet. Desktop is dogfood.

## Motion curves (v2 — texture is static; everything else can breathe)

| Name | Curve | Duration | Use |
|---|---|---|---|
| `--e-calm-out` | `cubic-bezier(0.18, 0, 0.22, 1)` | `--d-flick` 220ms | tap feedback, drawer open, row expand |
| `--e-calm-out` (long) | same | `--d-settle` 800ms | screen entrance, stagger children at 80ms |
| `--e-breathe` | `cubic-bezier(0.45, 0, 0.55, 1)` | `--d-breathe` 6000ms | hero numeral breathe, CTA glow pulse |
| `--e-lift-set` | `cubic-bezier(0.42, 0, 0.18, 1)` | `--d-flight` 600ms | hero numeral count-up reveal |
| `--e-rule-draw` | `cubic-bezier(0.55, 0, 0.18, 1)` | 800ms once | hand-drawn dotted rule draw-on under masthead |
| `--e-step` | linear | 120ms | tap scale, paid-strike stroke draw |

**Texture motion contract:** paper-grain noise overlay does **not** animate. Static at all times. Animating noise reads as TV static — kills the print metaphor on contact.

**Hand-rule draw-on:** the SVG dotted line under the masthead draws left-to-right exactly once on first mount via `stroke-dasharray` + `stroke-dashoffset` animation. Duration 800ms, `--e-rule-draw` curve. Stops being touched after mount. Under reduced-motion, it renders fully drawn from t=0.

Stagger choreography on mount (Framer Motion `staggerChildren: 0.08`, `delayChildren: 0.12`):
1. masthead frame
2. masthead ink-block (44×44 anchor)
3. hand-rule (draws on)
4. eyebrow "§ THIS WEEK · 14 MAY"
5. hero kicker
6. hero numeral
7. ‡ printer's mark in hero
8. hero italic line
9. confidence pip
10. § marginalia + ledger heading + first 3 ledger rows
11. next-14 heading + first 3 bill rows
12. crosshatch ornament + noticed heading + first signal
13. ¶ marginalia + patterns ink-block + patterns heading
14. goals heading + first goal tile
15. ADHD tax line
16. footer CTA

Marginalia glyphs and anchor blocks come *before* their headings in stagger order — marks revealed first, type settles into them.

Reduced-motion: `--d-settle / flick / slide / flight / tap` collapse to 0ms (already wired in tokens). Breathe loops + glow pulse + hand-rule draw-on do not run. Tap scale stays. Texture stays (it doesn't animate anyway).

## Component inventory (TS interfaces sketch)

```ts
// MoneyMasthead
interface MoneyMastheadProps { week: { from: Date; to: Date }; masked: boolean; onToggleMask(): void }

// SafeToSpendHero
interface SafeToSpendHeroProps {
  amount: number | null;
  confidence: 'high' | 'med' | 'low' | 'unknown';
  daysRemaining: number;
  billsToClear: number;
  masked: boolean;
}

// LedgerRow (shared shape)
interface LedgerRowProps {
  id: string;
  dot: 'neutral' | 'returnable' | 'overdue' | 'paid' | 'stale';
  primary: string;       // "rent" or "blue bottle"
  eyebrow: string;       // "housing" or "coffee"
  meta?: string;         // "DUE IN 4D" or "1H AGO" — DM Mono caps
  amount: number;
  amountState: 'live' | 'paid-strike' | 'cancel-strike';
  masked: boolean;
  onExpand?(): void;
  expanded?: boolean;
  children?: React.ReactNode;  // expanded content
}

// SignalCard
interface SignalCardProps {
  kind: 'stale_sub' | 'post_payday' | 'mom_delta';
  headline: string;     // DM Serif 22px
  body: string;         // DM Sans 17px
  cta?: { label: string; onClick(): void };
  onDismiss(): void;
}

// PatternDrawer
interface PatternDrawerProps {
  patternKey: string;   // doom_buying | hyperfocus_burst | duplicate | sub_cancel_avoid | return_abandon | research_paralysis
  oneLiner: string;
  detail: React.ReactNode;
  count: number;
}

// GoalTile
interface GoalTileProps {
  id: string;
  name: string;
  saved: number;
  target: number;
  etaCopy: string;       // "approx 3 mo at this pace"
  onBump(amount: 10 | 50 | 100): void;
}

// ADHDTaxLine
interface ADHDTaxLineProps { total90d: number; onExpand(): void }

// LogExpenseCTA
interface LogExpenseCTAProps { onTap(): void; disabled?: boolean }
```

## State machine

| State | Trigger | Visual |
|---|---|---|
| first-run | `records.length === 0 && bills.length === 0` | hero "—", subtext "log your first expense. the rest fills in." Single CTA. No sections. 200px top pad. |
| loading | `store.hydrated === false` | last cached hero at 0.4 opacity, hairline shimmer 1.2s, sections skeleton-free (just empty space). |
| empty-this-week | records exist but `safeToSpend === null || weekEvents.length === 0` | hero "$0 spent · room is room", ledger title "the ledger · quiet week." |
| tight | `safeToSpend.confidence === 'low' \|\| buffer < 1.2` | confidence pip switches to amber. Subtext "tight week. {days}, {bills}". Hero stays ink. |
| full | default dogfood case | all sections render. |
| error | store load throws | "the ledger couldn't load this time. it's safe. tap to *retry*." Umber on "retry". |
| offline | navigator offline | no change — module is local-first. |
| masked | privacy toggle on | every dollar figure → `$•••`, screen-reader text "amount hidden". Reveal: 320ms blur(8px → 0). |

## Voice — banned phrases

`!` (literal exclamation mark), `you should`, `great`, `amazing`, `crushing`, `watch out`, `warning`, `alert`, `low balance`, `overspent`, `this month vs last`, `vs last month`, `you saved`, `you spent`, emoji codepoints in money copy. Greppable.

## Voice — required string keys (English; Spanish twin required)

```
finance.hero.kicker          "safe to spend"
finance.hero.calm_main       "safe to *spend* this week."
finance.hero.tight_main      "tight week."
finance.hero.tight_sub       "{days} days, {bills} bills to clear."
finance.hero.empty_main      "$0 spent."
finance.hero.empty_sub       "room is room."
finance.hero.first_run_main  "log your first expense."
finance.hero.first_run_sub   "the rest fills in."
finance.hero.confidence_high "{weeks} weeks of data."
finance.hero.confidence_low  "still learning your pattern."
finance.eyebrow.this_week    "§ this week"
finance.section.ledger       "the ledger"
finance.section.bills        "next *14* days"
finance.section.signals      "noticed"
finance.section.patterns     "patterns"
finance.section.goals        "saving *for*"
finance.bill.due_in          "due in {n}d"
finance.bill.due_today       "today"
finance.bill.overdue         "{n}d late"
finance.bill.mark_paid       "mark paid"
finance.bill.paid_at         "paid {when}"
finance.sub.stale_dot        "untouched {n}d"
finance.sub.mark_cancel      "mark for cancel"
finance.signal.stale_sub     "{name} hasn't been touched in {days} days. still ${amount}/mo."
finance.signal.post_payday   "the day after payday tends to be your biggest spend day. pattern, not judgment."
finance.signal.mom_delta     "{name} went up ${delta} from last month. heads up."
finance.signal.cta_review    "review"
finance.signal.cta_dismiss   "noted"
finance.pattern.doom_buying  "doom-buying · {n} late-night events this season"
finance.pattern.hyperfocus   "hyperfocus burst · {n} purchases in one window"
finance.pattern.duplicate    "duplicate purchase · {n} items, {amount}"
finance.pattern.sub_avoid    "subscription-cancel avoidance · {n} marked, none cancelled"
finance.pattern.return_aband "return abandoned · {n} eligible, {amount}"
finance.pattern.research     "research paralysis · {n} sessions, no purchase"
finance.goal.eta             "approx {n} {unit} at this pace"
finance.goal.bump_10         "+$10"
finance.goal.bump_50         "+$50"
finance.goal.bump_100        "+$100"
finance.adhd_tax.line        "season total: ${amount}. logged, not judged."
finance.cta.log_expense      "log expense"
finance.cta.privacy_on       "hide amounts"
finance.cta.privacy_off      "show amounts"
finance.impulse.prompt       "${amount} at {merchant}. {time}. sleep on it?"
finance.impulse.sleep        "sleep on it"
finance.impulse.need         "i need it"
finance.error.load           "the ledger couldn't load this time. it's safe. tap to *retry*."
```

## Accessibility

- WCAG AA contrast — ink `#14140F` on bone `#FAFAF7` = ~17:1, AAA easily.
- All tap targets ≥ 44×44 (iOS HIG). Row tappable area extends full row height (64px) including the row's horizontal padding.
- `font-variant-numeric: tabular-nums lining-nums` on amounts — screen readers receive the underlying number, not `$•••` even when masked. Mask the visual; provide `aria-label="amount hidden"` on the masked element so SR users get the masked state too.
- `prefers-reduced-motion: reduce` → ambient breathe + glow pulse stop. Tap scale + state-transition fade-ins remain.
- Focus rings: 2px solid `--accent` at 2px offset on all interactive elements. Visible in keyboard nav.
- Italic sage word also bears `font-weight: 400` (DM Serif italic is heavy enough). Do not bold for emphasis — italic is the contract.
- Color is never the only carrier of state: tight-week pip is amber **and** the subtext word changes; overdue bill is amber dot **and** the meta line reads "{n}d late".

## Tech constraints

- File: `apps/web/src/modules/finance/FinanceModule.tsx` rewrite + new `apps/web/src/modules/finance/components/*.tsx` siblings.
- React 18, TS strict, Framer Motion 11. No new deps.
- All color references via `var(--token)` (already exists in `tokens.css`). Greppable rule: zero hex literals in `apps/web/src/modules/finance/**/*.tsx` after merge.
- All visible copy via `getString(locale, 'finance.…')`. Spanish twins required in same PR.
- All logic via `@ollie/logic/finance` exports. No new computed values; orchestrator-only emits.
- Capacitor iOS first; verify on iPhone 15 simulator + iPad Pro 11" simulator.
- `tools/notification_scope_tests.js` must pass — this redesign adds no push notifications.

## Deferred (behind logic-wiring tasks, NOT shipped in this pass)

- BSAS at-risk scoring → `packages/logic/src/finance/bsas.ts` is built but not orchestrated.
- 30-day forecast → not computed anywhere.
- Sleep-debt × spend correlation panel — exists in code as `ProtectiveCards`; flag in this redesign as ship-or-cut decision for Serra. Default: cut from v1, revisit in v2.
