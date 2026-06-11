# SortedToast · visual spec v1

**Status**: locked for v1 build. Frontend-senior owns implementation.
**Source of truth for tokens**: `apps/web/src/design/tokens.css`. Do not invent values.
**Fonts**: DM Serif Display (item names), DM Sans (everything else), DM Mono (smcp labels, qty).
**Companion**: `preview.html` (this folder) renders all 9 fixtures.

---

## 1 · placement & shell

```
position:   fixed
bottom:     calc(env(safe-area-inset-bottom) + 16px)   /* iPhone PWA */
left:       16px
right:      16px
max-width:  520px
margin:     0 auto                                     /* desktop centering */
z-index:    var(--z-overlay)                           /* 10 */
```

The toast docks above the keyboard on iOS — the dump composer collapses while the toast is up; they never overlap. On desktop it floats bottom-center.

## 2 · palette (tokens only)

| role | token | hex | usage |
|---|---|---|---|
| surface | `--paper` | #F4F1E8 | toast background — warm card |
| edge | `--rule` | rgba(20,20,15,.10) | 1px hairline border around the toast |
| ink | `--ink` | #14140F | item names (serif) |
| ink-soft | `--ink-soft` | #5A574E | category, qty, smcp labels |
| ink-faint | `--ink-faint` | #9C9890 | dismiss hint, "via cache · 0ms" meta |
| sage tick | `--accent` | #2E5D43 | the shop-bound tick glyph |
| umber tick | `--umber` | #8A4B2C | the pantry-bound tick glyph |
| shimmer base | `--paper-2` | #EFEBE0 | PendingHair rail track |
| shimmer sweep | rgba(46,93,67,.22) | — | the sage gradient that travels across the rail |
| shadow | `--sh-md` | 0 4px 16px rgba(20,20,15,.06) | only one drop |

**No** red. **No** amber warn. **No** pink. Color never carries the success/failure signal here — typography and a tick mark do.

## 3 · typography

| element | family | size | weight | leading | tracking | case |
|---|---|---|---|---|---|---|
| item name (1–2 items) | DM Serif Display | 22px (`--t-h3`) | 400 | 1.30 | -0.012em | sentence |
| item name (3+ items) | DM Serif Display | 18px | 400 | 1.30 | -0.010em | sentence |
| recipe title (state 4/5) | DM Serif Display italic | 22px | 400 italic | 1.30 | -0.012em | sentence |
| section eyebrow ("the shop · 4", "the pantry · 2") | DM Mono | 11px (`--t-kicker`) | 500 | 1.30 | +0.16em (`--ls-caps`) | UPPER |
| qty + unit | DM Mono | 13px | 500 | 1.30 | +0.04em | lower |
| meta footer ("via cache · 0ms" / "via gemini · 410ms") | DM Mono | 9px (`--t-meta`) | 400 | 1.30 | +0.20em | UPPER |
| dismiss hint ("tap to undo · or swipe") | DM Sans | 11px | 400 italic | 1.30 | 0 | lower |
| error line | DM Sans | 13px | 500 | 1.40 | 0 | lower |

Microcopy is lowercase or sentence-case. No "Sorted!". No exclamation. No emoji.

## 4 · spacing

| zone | value | token |
|---|---|---|
| toast outer padding (x) | 20px | `--s-4 + --s-1` |
| toast outer padding (y) | 16px | `--s-4` |
| gap eyebrow → item row | 8px | `--s-2` |
| gap between two item rows | 6px | — |
| gap between shop block and pantry block (state 4) | 14px | `--s-3 + --s-1` |
| gap item-name → qty | 8px | `--s-2` |
| gap tick → item name | 10px | — |
| border radius | 4px (`--r-sm`) | sharp brand edges — no pills |
| hairline thickness | 1px | — |

The toast is **flat** — no card-within-card, no nested boxes. One paper plane.

## 5 · the tick glyph (the only icon)

- A 12 × 12 SVG, 1.5px stroke, sage (`--accent`) for shop-bound, umber (`--umber`) for pantry-bound, ink-faint (`--ink-faint`) for "AI didn't run" fallback.
- Position: leading the item name, baseline-aligned to the cap-height of the serif.
- Geometry: a single check mark, no circle around it, no fill. Use `stroke-linecap:round`, `stroke-linejoin:round`.
- For the error state (state 9), the glyph is a dash, not a check.

```html
<svg viewBox="0 0 12 12" width="12" height="12" fill="none"
     stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M2.5 6.5 L5 9 L10 3"/>
</svg>
```

## 6 · motion

| event | duration | easing | property |
|---|---|---|---|
| enter | 220ms (`--d-flick`) | `--e-calm-out` | `opacity 0→1`, `translateY 6px→0` |
| auto-dismiss | 200ms | `--e-calm-out` | `opacity 1→0`, `translateY 0→4px` |
| manual swipe-down | follows touch, snaps when |dy| > 40px | `--e-calm-out` | `translateY` |
| undo tap | 120ms (`--d-tap`) | `--e-calm-out` | row fade to ink-faint as the tick rotates 90° into a "—" |

**Auto-dismiss timing**: `3500ms` after enter completes. If a second toast queues, the first is dismissed in 150ms (no stacking — one toast at a time).

### PendingHair (cache-miss shimmer rail)

- 2px tall (not 6px — that's too SaaS-loud for this paper)
- Sits flush with the bottom hairline of the toast, inside the radius
- Background: `--paper-2`
- Sweep: a 30%-wide linear-gradient — `transparent → rgba(46,93,67,.22) → transparent`
- Animation: `translateX(-100%) → translateX(300%)` over 1400ms, `--e-calm-out`, infinite while the LLM call is in flight
- On resolve: the rail fades to opacity 0 over 200ms; item rows fade in (`receipt-fadein`)

```css
@keyframes pending-hair-sweep {
  from { transform: translateX(-100%); }
  to   { transform: translateX(300%);  }
}
.pending-hair-sweep {
  animation: pending-hair-sweep 1400ms var(--e-calm-out) infinite;
}
```

`@media (prefers-reduced-motion: reduce)` — kill the sweep, leave the rail static at 0.22 sage.

## 7 · anatomy (annotated)

```
┌──────────────────────────────────────────────────────────┐
│  THE SHOP · 2                                            │ ← eyebrow (mono, smcp)
│                                                          │
│  ✓  ketchup                                    1 bottle  │ ← serif name + mono qty
│  ✓  parsley                                    1 bunch   │
│                                                          │
│  ──────────────────────                                  │ ← hairline divider (only in split states)
│                                                          │
│  THE PANTRY · 1                                          │
│  ✓  olive oil                                  reserve   │
│                                                          │
│  tap to undo · or swipe              via cache · 0ms     │ ← hint left, meta right (both ink-faint)
└──────────────────────────────────────────────────────────┘
```

- The eyebrow + counter sits flush left.
- The tick is 10px from the left edge of the eyebrow column, baseline of the serif.
- The qty sits flush right of the toast inner box.
- The hint + meta footer is a single row with `justify-content: space-between`, 12px of top margin above it, sitting on a hairline `border-top: 1px solid var(--rule-soft)`.

## 8 · states (9 fixtures)

### state 1 — single item, cache hit
- one eyebrow: `THE SHOP · 1`
- one item row, sage tick
- footer: `tap to undo · or swipe` / `via cache · 0ms`
- enter, hold 3500ms, exit

### state 2 — two items, cache hit
- one eyebrow: `THE SHOP · 2`
- two item rows
- meta: `via cache · 2ms`

### state 3 — three or more items (overflow)
- one eyebrow: `THE SHOP · 6`
- first 3 items listed in serif
- a fourth row, in mono smcp ink-faint: `and 3 more · tap to review`
- name typography drops to 18px (the "long list" size)
- no horizontal scroll, no truncation of visible names

### state 4 — recipe expansion split, two-block default
- toast lede in serif italic, top of toast: `from "pasta with garlic, parsley, lemon"`
- eyebrow: `THE SHOP · 4` → 4 rows
- hairline divider
- eyebrow: `THE PANTRY · 2` → 2 rows with umber tick
- meta: `via gemini · 410ms`
- this is the "menu" case — the toast feels like a small receipt of a transaction, not a notification

### state 5 — recipe expansion, single-line variant
- same lede in serif italic
- one eyebrow: `SORTED · 6` (no shop/pantry split shown inline)
- single mono line: `4 to shop · 2 to pantry · tap to review`
- used when toast must stay short (e.g. when user has another toast queued, or when accessibility setting reduces density)
- frontend chooses between state 4 and 5 based on `toastDensity` setting (default: `roomy` → state 4)

### state 6 — cache miss, pending then resolves
- enters with eyebrow + lede (if recipe), no rows yet
- PendingHair shimmer rail active at bottom edge
- placeholder text under eyebrow (mono, ink-faint, italic): `understanding…`
- on resolve (~300–600ms typical): shimmer fades, rows fade in (`receipt-fadein` 220ms)
- meta: `via gemini · 410ms`

### state 7 — fallback keyword (AI didn't run)
- identical layout to state 1/2
- tick color: `--ink-faint` (not sage)
- meta: `via keywords` (no ms reading)
- this is the *quiet* state — the user never reads "AI off"; the muted tick is the only tell, only legible if you know to look

### state 8 — mixed pantry + shopping, non-recipe
- no lede (no recipe context)
- two eyebrows: `THE SHOP · 1` then `THE PANTRY · 1`
- example dump: "ran out of olive oil, also grab bread"
- same hairline split as state 4 but without the italic recipe lede

### state 9 — error / timeout
- enters with eyebrow: `COULD NOT SORT`
- single line in DM Sans 13px: `the dump is saved · sort it by hand from the inbox`
- tick replaced by a 12×12 dash glyph in `--ink-faint`
- footer hint replaced by a single underline link: `open the inbox`
- meta: `timed out · 8s` in mono
- hold time extends to 5000ms (errors deserve a beat)

## 9 · edge cases

### long item name
- the serif name wraps to a second line; qty stays on the first line, top-aligned
- max 2 lines per item; further truncation appends "…" in serif
- the row's vertical rhythm grows; the toast accepts up to 6 wrapped lines total before scrolling

### multi-language (TR + EN)
- DM Serif Display covers Latin Extended (Turkish diacritics OK — "Çıktım, biraz domates aldım" renders correctly)
- eyebrow labels remain English (Ollie ships EN + ES; TR is dogfood-only) — `THE SHOP`, `THE PANTRY`
- item names render in the language the user wrote them in; no auto-translate

### dark mode
- Ollie has a `[data-theme="dark"]` scope (see tokens.css line 226) but no module currently uses it as a full theme — it's reserved for the "focus committed" sage-ambient state
- **decision**: SortedToast inherits the live `:root` (bone/paper) and does NOT respond to `data-theme="dark"`
- if Ollie ever ships a true dark theme, this spec gets a v2 column; do not pre-emptively design it

### iPhone PWA
- safe-area inset on bottom — required (`env(safe-area-inset-bottom)`)
- swipe-down to dismiss — required; touch handler must cancel parent scroll
- keyboard up — the toast docks above the keyboard via `visualViewport` API; on web, listen for `visualViewport.height` changes and translate the toast accordingly
- tap target: the entire toast surface is the "undo" tap target except the right-aligned `via cache · 0ms` meta; minimum 44pt tall (we are 64pt minimum)

### reduced motion
- no shimmer sweep (static rail)
- enter / exit become instant cuts; no opacity flicker
- duration tokens are zeroed by the `@media` block already in `apps/web/src/design/tokens.css` line 232

## 10 · what frontend-senior needs

- a single React component `<SortedToast />` in `apps/web/src/modules/grocery-v2/components/SortedToast.tsx`
- props:
  ```ts
  type SortedToastProps = {
    state: 'pending' | 'sorted' | 'fallback' | 'error';
    recipeLede?: string;          // italic top line, when present triggers state 4/5 layout
    shop: Array<{ name: string; qty?: string }>;
    pantry: Array<{ name: string; qty?: string }>;
    density?: 'roomy' | 'tight';  // roomy = state 4, tight = state 5; default 'roomy'
    source: 'cache' | 'gemini' | 'keywords';
    latencyMs?: number;
    onUndo: () => void;
    onDismiss: () => void;
  };
  ```
- a tiny `<PendingHair />` sub-component is fine; do not extract it as a package
- the toast is rendered by the dump composer's success branch; **not** by a global toast provider — there is no global toast queue in Ollie and we are not introducing one for this

## 11 · open questions for serra

None blocking. Ship state 1–9 as specified. If a 10th state appears (e.g. partial recipe, only shop matched), it inherits state 8 layout.
