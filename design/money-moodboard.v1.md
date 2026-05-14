# Ollie Money Module — Moodboard

8 references, grouped by what they teach the redesign. Every entry names a specific pattern, what to borrow, and what NOT to borrow. Mixed print + digital + product so the prompt isn't accidentally a re-skin of one source.

| # | Reference | Type | Why |
|---|---|---|---|
| 1 | **Apartamento — "Library" issue, pull-quote spreads** | print magazine | A single serif sentence floats in three-column negative space, hairline rule above. Borrow: hero numeral set against generous emptiness, one editorial sentence under it. NOT: any photographic treatment, the column rules — Ollie stays single-column. |
| 2 | **Lufthansa Magazin — "Aktuelles" flight-schedule pages** | print magazine | Old-style figures aligned in tabular columns down a 5-row schedule. The number column is the proof someone designed the page. Borrow: tabular-nums + lining-nums on every dollar figure, right-aligned amount column the eye can sweep down. NOT: their three-color flourishes or destination-photo headers. |
| 3 | **Monocle Forecast — annual report tables** | print magazine | Section labels are 9px caps with a 1px hairline rule under them that is *exactly* the width of the label text. The rule labels the label. Borrow: this exact treatment for the `§ THIS WEEK`, `§ THE LEDGER`, `§ PATTERNS` eyebrows. NOT: the gold-foil deluxe issue flourishes. |
| 4 | **Linear — Issue Detail right rail** | web app | A vertical stack of metadata rows with no card backgrounds, just `border-bottom: 1px solid` hairlines. 52px row height. Each row is one fact. Borrow: ledger / bills / subs row template — same 64px stripe, hairline-soft between rows, no boxes. NOT: the dark theme, the keyboard chips, the dense `cmd-k` chrome. |
| 5 | **Aesop — product detail page** | e-commerce | Body sentences at 17px serif do unhurried real work. "Antioxidant-rich rosewater for skin that feels parched." That's the whole product description. Borrow: the discipline of long-sentence microcopy that earns its space, the unhurried voice. NOT: the photography column, the gold "add to cart" CTA. |
| 6 | **Hinge — date-from-home prompt cards** | iOS app | Each prompt card is a serif question followed by a hand-written short answer. The prompt is the structure; the answer is the data. Borrow: pattern drawer cards in this exact shape — pattern name in DM Serif 22px, "noticed, not prescribed" detail in DM Sans 17px. NOT: any pink, any heart, any swipe affordance. |
| 7 | **Copilot (iOS) — "Recurring" view** | iOS app | One-row-per-charge, name + frequency tag + tabular amount, with a 32-week mini-sparkline at the right edge. The whole list scans as a single rhythm. Borrow: the calm of one-charge-per-row, the mom trip-cost feel. NOT: the gradient brand avatars, the colored category icons. |
| 8 | **Lunchmoney — "Cash flow" simplified view** | web app | A horizontal month band with one tick where "today" sits. No bars, no axes, no labels. Just a line and a tick. Borrow: the "safe to spend this week" confidence pip — single horizontal hairline with the tick. NOT: the multi-account dropdowns or the dense table elsewhere on the page. |

## Voice anchors (separate from visual)

- **Apartamento captions** — "Adam likes the chair because his grandmother had one." Conversational, factual, no marketing. Tone we're shipping in `finance.signal.*`.
- **Aesop product copy** — "Use sparingly." Three words that do the job. Tone for empty states and the ADHD tax line.
- **VOID's own pod-b voice library** (`design-pitches/voice-library.html`) — Ollie's existing voice doc. Tone is already pinned here; the redesign just needs to apply it. The banned-phrase list is canonical.

## Anti-references — what we explicitly are not doing

- **Mint / Rocket Money** — every shame-trigger pattern this redesign refuses to ship. The "you overspent in groceries by 18%!" red callout, the pie chart that brags, the percentage-of-income comparison. Reference exists so the engineer knows the line.
- **YNAB classic** — over-categorization. The redesign deliberately does not ask the user to bucket every dollar. Pre-set categories exist on bills only; transactions get one free-text category field and that's it.
- **Stripe Dashboard** — every dense-grid SaaS habit Ollie isn't here for. No data-density-as-virtue. No "+12.4% MoM" badges. No green-up / red-down arrows.
- **Current `FinanceModule.tsx` (v0)** — gold-on-near-black, DM Mono on amounts, every metric inside a `border: 1px solid rgba(255,255,255,0.08)` rectangle. The exact treatment the redesign discards. Keep it open in another tab while building so the contrast is visible.
- **Apple Wallet** — the gradient card stack. Ollie isn't a wallet, isn't a card. No gradient surfaces, no card-as-physical-object metaphor.

## Palette anchors

- **Apartamento paper stock** — uncoated cream, slightly warm. Exactly `--bone #FAFAF7` + `--paper-2 #EFEBE0` already in `tokens.css`.
- **Monocle ink** — never-quite-black, slightly warm. `--ink #14140F` is the same instinct.
- **Lufthansa Magazin "Recommended" callouts** — single amber accent on otherwise-cream pages, used once per spread. Maps exactly to `--warn #C9974C` used only on the tight-week pip.
- **Aesop's sage green on Tasmanian Lavender bottles** — restrained, herbal, single-use. Maps to `--accent #2E5D43` used once per spread (the italic word + CTA outline).

## Typography anchors

- **DM Serif Display** — already in the project. Closest editorial substitute for Tiempos / Lyon / Canela. Has true tabular form (`tnum`) and lining-figures (`lnum`) — the reason it can carry the hero numeral.
- **DM Sans 500** — chosen specifically for amounts. 500 weight (not 400) gives the dollar figures the slight visual weight they need to be readable at 17px in a row sweep.
- **DM Mono** — for labels and timestamps only. The redesign explicitly bans DM Mono from amounts (the v0 mistake).

## Motion anchors

- **Hinge profile reveal** — when a profile loads, the prompts settle in vertically with an 80ms stagger, no spring. Borrow: entrance choreography. The settle curve `cubic-bezier(0.18, 0, 0.22, 1)` matches Ollie's `--e-calm-out` exactly.
- **Copilot's number count-up on month-change** — the total tweens over ~600ms with a clean ease-out. Borrow for `SafeToSpendHero` value transitions.
- **Linear's tap feedback** — 80–120ms scale to 0.99, no spring back. Heavy material, not bouncy. Borrow exactly. Springs are reserved for the goal-bump chips.
