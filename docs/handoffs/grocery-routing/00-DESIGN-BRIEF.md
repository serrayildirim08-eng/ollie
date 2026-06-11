# SortedToast · design brief

**Surface**: Grocery AI dispatch confirmation popup.
**Replaces**: existing inline routing chip pinned to bottom of brain-dump composer.
**Trigger**: a brain-dump entry was classified by the grocery routing AI (cache hit, cache miss, or keyword fallback) and items were sorted into shop / pantry / recipe.
**Lifetime**: 3.5s auto-dismiss; manual dismiss via tap or swipe.

## intent

The user threw a sentence into the dump ("got myself some ketchup", "tonight: pasta with garlic, parsley, lemon"). The router decided. We tell the user **what was understood and where it went**, without breaking flow.

Not a notification. A **receipt**. The way a small letterpress card slides under a coffee saucer.

## tone

- editorial restraint, not SaaS confirmation
- one sentence of serif, the rest in small caps + sans
- never exclamatory. never "Success!". never green checkmark.
- pantry vs shop distinction is carried by **typography position + a quiet sage/umber tick**, not by colored badges
- a recipe expansion (one dump → many items, split across shelves) is the most interesting case; the toast must read like a *menu* not a *list*

## anti-references

- Linear toast
- Vercel toast (the tilted card with confetti)
- iOS native banner
- Material snackbar
- anything with a progress ring counting down
- anything with an undo button styled as a CTA pill (we will support undo, but as a small caps text link, not a button)

## references (anchors)

- Aesop receipt cards
- *Cabana* magazine bylines
- Bluebook citation footers
- Apartamento captions
- the existing brain-dump receipt (`receipt-fadein` keyframe, `apps/web/src/design/animations.css` line 149)

## what the spec must answer

- exact palette tokens (must come from `apps/web/src/design/tokens.css` — no new colors)
- which font carries the item name (Serif), which carries category/qty (Sans/Mono)
- spacing — page-edge inset, internal padding, gap between item rows
- motion — enter, dismiss (auto + manual), shimmer for the cache-miss pending state
- 9 fixture states
- edge cases — long names, TR/EN mixed, dark mode, iPhone safe-area + touch dismiss

## scope boundaries

- IN: the toast itself, its states, its motion, its placement
- OUT: the dump composer layout, the grocery shelf detail view, the undo mutation logic
- OUT: telemetry / event shape (lives in `packages/events/`)
