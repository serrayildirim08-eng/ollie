# Ollie Money Module — Spec

Source of truth for tokens, type, motion, components, and state. Every value here is referenced by name from `money-design-prompt.md` and from `money-vibe-check.html`. All tokens already exist in `apps/web/src/design/tokens.css` — this spec selects which subset the module uses.

## Palette tokens (zero new tokens — selection only)

```css
/* surfaces */
--bone:       #FAFAF7;   /* page bg · the world */
--paper:      #F4F1E8;   /* not used in this module · reserved for callouts */
--paper-2:    #EFEBE0;   /* hero band fill · the one elevated surface */

/* ink */
--ink:        #14140F;   /* hero numeral, primary text, amounts */
--ink-soft:   #5A574E;   /* body, eyebrow, subtitle */
--ink-faint:  #9C9890;   /* meta, "due in 4d", paid-strike text */
--ink-ghost:  #C8C4BA;   /* "—" placeholders, masked-state ink */

/* accents */
--accent:     #2E5D43;   /* sage · italic word, CTA outline · ONE per spread */
--umber:      #8A4B2C;   /* ADHD tax line, pattern dot marker, returnable indicator */
--warn:       #C9974C;   /* amber · tight-week confidence pip ONLY */

/* hairlines */
--rule:       rgba(20,20,15,0.10);   /* section breaks, masthead under-rule */
--rule-soft:  rgba(20,20,15,0.05);   /* ledger row separators */

/* derived (define inline if not already present) */
--accent-soft: rgba(46, 93, 67, 0.14);   /* CTA glow rgba pair for box-shadow pulse */
```

## Typography scale

| Stop | Size (mobile / desktop) | Font | Weight | Letter-spacing | Line-height | Feature settings |
|---|---|---|---|---|---|---|
| hero-numeral | 72px / 96px | DM Serif Display | 400 | -0.025em | 1.02 | `tnum 1, lnum 1` |
| display | 32px / 42px | DM Serif Display | 400 | -0.018em | 1.10 | — |
| h2 | 22px | DM Serif Display | 400 | -0.012em | 1.20 | — |
| body | 17px | DM Sans | 400 | 0 | 1.55 | — |
| amount-list | 17px | DM Sans | 500 | 0 | 1.4 | `tnum 1, lnum 1` |
| caption | 13px | DM Sans | 400 | 0.01em | 1.45 | — |
| kicker | 11px caps | DM Mono | 500 | 0.16em | 1.30 | — |
| meta | 9px caps | DM Mono | 400 | 0.20em | 1.30 | — |

Numeric typography is first-class: **every dollar figure** in the module — hero, ledger, bills, subs, goals, ADHD tax — carries tabular-nums + lining-nums. DM Serif Display has the tabular form; DM Sans gets it via `font-variant-numeric: tabular-nums lining-nums`.

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

## Motion curves

| Name | Curve | Duration | Use |
|---|---|---|---|
| `--e-calm-out` | `cubic-bezier(0.18, 0, 0.22, 1)` | `--d-flick` 220ms | tap feedback, drawer open, row expand |
| `--e-calm-out` (long) | same | `--d-settle` 800ms | screen entrance, stagger children at 80ms |
| `--e-breathe` | `cubic-bezier(0.45, 0, 0.55, 1)` | `--d-breathe` 6000ms | hero numeral breathe, CTA glow pulse |
| `--e-lift-set` | `cubic-bezier(0.42, 0, 0.18, 1)` | `--d-flight` 600ms | hero numeral count-up reveal |
| `--e-step` | linear | 120ms | tap scale, paid-strike stroke draw |

Stagger choreography on mount (Framer Motion `staggerChildren: 0.08`):
1. masthead
2. eyebrow
3. hero band
4. ledger heading + first 3 rows
5. bills heading + first 3 rows
6. signals
7. patterns (collapsed)
8. goals
9. ADHD tax line
10. footer CTA

Reduced-motion: `--d-settle / flick / slide / flight / tap` collapse to 0ms (already wired in tokens). Breathe + drift loops do not run. Tap scale stays.

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
