# Direction A — "The Magazine"

**tone in one line:** ollie is a monthly issue you open every day — each module is its own spread, with a cover.

## five design moves

1. **per-module cover treatment.** every `/box/<name>` opens with a full-width hero: a kicker line (smcp), an oversized DM Serif Display title (96–112px), one editorial standfirst paragraph in serif lede (22–28px), and a single sage-ink mark beneath. The list/content begins one full viewport scroll below the fold. This breaks the "every module reads the same" problem from `modules/*/Box.tsx`.

2. **kicker meta upgraded to "issue meta."** instead of `box · grocery`, the kicker becomes a 2-line meta block: `box · grocery` over `issue 14 · today, may 28`. ports the magazine TOC gesture from Reeder 5 + Mela.

3. **drop caps for first paragraphs.** the standfirst paragraph on each box uses a true drop cap (DM Serif Display, 3 lines tall, `inkGhost` colour). zero other places in the app get this. one moment of typographic gravity per spread.

4. **dump landing becomes a cover.** `dump/DumpScreen.tsx` rebuilt as a full-bleed cover: `WHAT'S IN YOUR HEAD?` at 112px DM Serif Display, set hard left at the 64px gutter, with the textarea inset 96px below as a continuation of the headline rather than a separate UI element. no `send` button — just `cmd + enter` and a quiet mono hint at the foot.

5. **`/modules` becomes a TOC.** the modules list becomes a magazine table-of-contents page: page numbers (mono small caps, `meta` size from tokens) + serif module name + a one-line editorial blurb. No icons. No card backgrounds. Just rules + type.

## treatment: the dump screen

```
        DUMP · ISSUE 14 · TUE MAY 28
        ──────────────
        
        What's
        in your
        head?
        
        ┌──────────────────────────────────────────┐
        │ (textarea, no border, paper background,  │
        │  serif lede italic placeholder)          │
        └──────────────────────────────────────────┘
        
        cmd + enter to send                  okay
```

- hero is 112px DM Serif Display, three lines, left-aligned, hard against the gutter at 64px from left edge.
- the textarea sits 96px below, on `paper` (#F4F1E8), no visible border, only a 1px sage hairline at the bottom edge — implying continuation of the headline.
- placeholder is italic DM Serif Display 22px, `inkGhost` colour, slowly fading on focus.
- the `okay` ack is unchanged from the current `Ack` component but moves to the bottom right corner at `meta` size mono — like a printer's mark.

## treatment: grocery box

- hero: kicker `BOX · GROCERY · 14 ITEMS ON THE LIST`, then `Grocery` at 96px display, then a serif standfirst: *"a list you talk to, a pantry that watches what you have."* drop cap on "a".
- the mode switch (`shop · pantry`) moves below the fold — feels like flipping to the next page.
- the torn-paper list stays exactly as in `modules/grocery/GroceryBox.tsx` — it earns its place. add page-number mono in the right margin: `p. 1 / shop`.

## treatment: cycle box

- hero: kicker `BOX · CYCLE · DAY 8`, then `Cycle` at 96px display, then a quiet standfirst in italic: *"day eight — quiet ground, learning your shape."*
- the phase ring stays as-is from `modules/cycle/CycleBox.tsx`, but moves below the fold as the first "figure" of the spread, with a figure caption beneath in mono `meta`: `fig. 1 · day eight, follicular`.
- recent symptoms / pills / history become a 2-column layout below the fold — like a sidebar in a print article.

## risks

1. **scroll-fatigue.** every screen now requires a vertical scroll past the cover before content is reachable — that hurts ADHD return-visit speed. mitigation: keyboard shortcut `j` or `enter` to jump past the cover; sticky mini-kicker once scrolled.
2. **whitespace tax on mobile.** 112px DM Serif Display + 64px gutters don't shrink gracefully. mitigation: clamp display to `clamp(56px, 12vw, 112px)` and gutter to `clamp(20px, 6vw, 64px)`.

## recommend if

- ollie wants to feel like a Kinfolk issue more than a productivity app.
- the user base over-indexes on people who already love magazines / journaling / "slow software."
- Serra is willing to pay a small return-visit speed cost for first-visit beauty.

**Recommend against if** the brain-dump frequency target is multiple times per day — covers are first-visit furniture, not commuter-train furniture.
