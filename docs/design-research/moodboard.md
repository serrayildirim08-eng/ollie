# moodboard.md

16 references organised by theme. each entry: 1 line on what to borrow, what NOT to borrow, url.

prefers stable URLs (App Store product pages, magazine homepages, designer portfolios, Are.na boards). twitter/dribbble used sparingly because of 404 risk.

---

## typography

### 1. Kinfolk magazine homepage

borrow: the SMCP kicker / serif headline / italic standfirst stack. exactly the rhythm ollie's `BoxHero` should chase.
don't borrow: the print-CMYK photo aesthetic — ollie is not photography-led.
ref: https://www.kinfolk.com/

### 2. The Browser Company / Arc release notes

borrow: oversized DM Serif Display + Sans body. the rhythm of "release issue" pages is exactly the magazine cover gesture.
don't borrow: the colour gradients in the page background.
ref: https://arc.net/release-notes

### 3. Frank Chimero's website

borrow: long-form serif body + restrained kicker meta + zero chrome. this is the closest one-person editorial site to ollie's spec.
don't borrow: the navigation hover micro-animations — too writerly for an app.
ref: https://frankchimero.com/

### 4. Things 3 — App Store screenshots (the typography)

borrow: empty states with italic encouragement + 60% negative space. ollie's empty states should crib the proportions exactly.
don't borrow: the blue accent — ollie's sage holds the role.
ref: https://apps.apple.com/us/app/things-3/id904237743

---

## empty states

### 5. Reflect — "what's on your mind?" prompt

borrow: a single serif prompt + a cursor + nothing else. ollie's dump screen already approximates this; the magazine direction is the upgrade path.
don't borrow: the dark default mode — ollie is cream-first.
ref: https://reflect.app/

### 6. Day One — "On This Day" empty surface

borrow: a quote-style hero + one CTA. great pattern for /modules TOC empty state if a user has nothing routed yet.
don't borrow: the photo backgrounds.
ref: https://dayoneapp.com/

### 7. Mela — empty recipe state

borrow: the centred italic single line + faded brand glyph. quietest empty state in the consumer space.
don't borrow: the photo-led recipe cards (not the empty surface — those land elsewhere).
ref: https://mela.recipes/

---

## navigation

### 8. NotePlan — sidebar + day view

borrow: the collapsible left spine + content-takes-everything layout. closest match to what ollie's `Layout.tsx` already does.
don't borrow: the heavy markdown chrome in the editor.
ref: https://noteplan.co/

### 9. Linear — sidebar + breadcrumb bar

borrow: the breadcrumb / page meta bar above the H1. magazine direction's "issue 14 · tue may 28" line lives here.
don't borrow: the cmd-k modal density — ollie doesn't need a command palette in v2.
ref: https://linear.app/

### 10. Reeder 5 — folder list typography

borrow: the SMCP folder labels + serif article titles in the same column. exactly the gesture ollie's `/modules` TOC should use.
don't borrow: the iOS chrome (toolbars, segmented controls).
ref: https://reederapp.com/

---

## hero moments

### 11. Heptabase — whiteboard zero-state

borrow: a centred single italic prompt on the empty canvas. ollie's dump screen v2 could approach this — see direction A.
don't borrow: the whiteboard interaction model.
ref: https://heptabase.com/

### 12. Stoic — daily prompt hero

borrow: a single wide serif prompt + soft paper background. precedent for the cover treatment.
don't borrow: the spiritual-app emoji icons in the tabbar.
ref: https://apps.apple.com/us/app/stoic-journal-meditations/id1312926037

### 13. Are.na — channel hero

borrow: the mono meta + serif body + huge white margin. precedent for the optional quiet-console direction.
don't borrow: the grid of channel covers — ollie's modules aren't visual.
ref: https://www.are.na/

---

## animation

### 14. Things 3 — magic plus + check ripple

borrow: physics + purpose. when motion shows up in ollie, it earns its place — the check tap should be a spring with a soft pulse out, not a fade.
don't borrow: density. one motion per interaction, never two.
ref: https://culturedcode.com/things/

### 15. Mela — page transitions

borrow: the calm slide + the magazine-page-turn feel between recipe and ingredient view. ollie's `/box/<name>` could borrow this for box → settings.
don't borrow: the haptic feedback (Tauri desktop doesn't have it).
ref: https://mela.recipes/

---

## palette / texture

### 16. Aesop product pages (e.g. Resurrection Hand Wash)

borrow: cream + ink + a single sage accent + ample white. ollie's palette in `tokens.ts` is already there — Aesop validates the proportions.
don't borrow: the photographic still-life. ollie has no images.
ref: https://www.aesop.com/us/p/body/hand/resurrection-aromatique-hand-wash/

### 17. Kinfolk shop product page

borrow: the standfirst-as-product-description rhythm. exactly the lede ollie's `GroceryBox` standfirst should chase.
don't borrow: the photographic hero.
ref: https://www.kinfolk.com/products/

### 18. Pip Decks / Studio Wallpaper printed Are.na board

borrow: the cream + ink + dotted-rule palette. precedent for the sketchbook direction's dashed dividers if that direction is ever revisited.
don't borrow: the print-only colour gamut.
ref: https://www.are.na/explore (search "kinfolk" or "editorial print")

---

## quick read

- typography references all point the same way: serif headline + sans body + mono meta + restrained kicker. ollie's `tokens.ts` already encodes this.
- empty-state references converge on "one centred line + 60% whitespace." ollie's current `ColdShop` / `ColdPantry` are close but graphic-heavy — the redesign can simplify.
- nav references converge on "thin spine + content takes the canvas." ollie's `Layout.tsx` + `TabBar.tsx` are already there structurally.
- the gap ollie still has vs. these references: **per-screen identity**. all 16 references give each surface a distinct typographic + spatial signature. ollie's 11 module boxes currently share one template. magazine direction (A) is the most direct path to closing this gap.
