# Feed Me v2 — Moodboard

6 anchor references and 5 anti-references. Each with explicit *borrow this /
don't borrow that* notes. Bring this to design review.

---

## Anchor references — borrow

### 1. Aesop — product detail pages
**URL pattern:** aesop.com/uk/p/skin/treat/...

- **Borrow:** serif headline on a cream background; a paragraph of editorial
  copy where most brands would put a "buy now" button; vertical rhythm that
  treats type as the primary structure; full-width single-column layout even
  at desktop.
- **Borrow specifically:** the hairline that separates ingredient blocks
  ("Key Ingredients" lists) — that's our `--rule` and our ingredient-list
  pattern.
- **Don't borrow:** the muted product photography. Feed Me v1 has no images;
  we hold the type-only line.

### 2. Kinfolk — recipe spread layouts
**Issue references:** Kinfolk issue 31 (food spread); issue 42.

- **Borrow:** the editorial framing of a recipe as a story — a *reason*
  attached to a dish ("the calm reason to cook this one tonight" in our
  copy is a direct lift of Kinfolk-style standfirst-before-instructions).
- **Borrow specifically:** the kicker-above-headline pattern. Their dishes
  carry a 9–11px caps tracking line above the serif dish name. We do this
  with cuisine kicker.
- **Don't borrow:** the photography. Same reason as Aesop.

### 3. Apartamento — interview layouts
**Issue references:** any recent issue's mid-feature layouts.

- **Borrow:** the calmness of a page with a lot of paper showing; the
  asymmetric placement of small caps metadata against large serif headlines;
  the willingness to leave the right half of the page empty when the type
  is doing enough.
- **Borrow specifically:** their handling of multiple-item lists (Q&A style)
  with hairline separators and no bullet points — that's our ingredient list.
- **Don't borrow:** the rough texture / paper-grain backgrounds. Our `--paper`
  is a flat color, not a noise texture. Texture is a 2010s editorial-web
  mistake we're not repeating.

### 4. Cabana magazine — table-setting features
**Issue references:** issues 12–15 (most recent food spreads).

- **Borrow:** the tightly-set serif headlines (we use `-0.025em` tracking on
  the dish name, which matches Cabana's display setting); the use of warm
  cream paper as a luxury signal; the willingness to leave a single small
  caps line of metadata as the only annotation.
- **Borrow specifically:** the editorial habit of naming a dish without
  apology — "Shakshuka," not "Easy 20-Minute Shakshuka Recipe."
- **Don't borrow:** the maximalist color photography and gold-foil headers.
  We're luxury-editorial *restrained*, not luxury-editorial *baroque*.

### 5. Monocle — café review column
**Issue references:** Monocle quarterly "Eating Out" feature.

- **Borrow:** the way they pack a lot of structured information (cuisine,
  city, price band, what to order) into a small, type-only block without
  ever feeling like a database printout. Our card achieves the same with
  cuisine kicker + coverage pip row + reason line.
- **Borrow specifically:** the use of small-caps metadata at the column foot
  ("photography by ..."). That's the editorial register our 9px mono source
  indicator is reaching for.
- **Don't borrow:** the rigid grid and the editorial logo treatment. The
  Feed Me cards aren't issued; they're suggested.

### 6. NYT Cooking — old editorial layouts (pre-2023 redesign)
**Reference:** NYT Cooking recipe pages circa 2018–2022 (Internet Archive).

- **Borrow:** the serif headline at the top with a single editorial sentence
  below it; the willingness to put the recipe story above the ingredient list
  (rather than burying it under a jump link).
- **Borrow specifically:** their pre-2023 "By NYT Cooking" byline pattern in
  small caps — that's the register of our AI-source indicator.
- **Don't borrow:** their post-2023 redesign with the floating star rating,
  the recipe-tile carousel, and the "save to recipe box" button. That's the
  direction we're explicitly running from.

---

## Anti-references — don't borrow

### A. HelloFresh — recipe card grid
**URL pattern:** hellofresh.com/recipes

- **Why not:** the entire visual vocabulary of meal-kit. Square photo tiles
  in a grid, calorie counts under every name, prep time as a colored chip,
  CTA buttons that say "Add to Plan." Feed Me is the opposite of this:
  no photos, no calorie chips, no plan-builder. Recipes are *suggestions*,
  not products.
- **Specifically avoid:** the orange/teal accent palette. We do not own a
  brand orange; `--warn` (amber) is for missing-ingredient flags only, never
  decorative.

### B. Tasty / BuzzFeed Food — short-form video tiles
- **Why not:** the entire aesthetic of "tap-to-see-quick-video" recipes. Tasty
  is engineered for impulse and parasocial loop; Feed Me is engineered for
  considered, low-stakes evening decisions. The visual cues are inverted.
- **Specifically avoid:** giant filled buttons, emoji in dish names ("🍳 quick
  shakshuka"), saturated yellow backgrounds, "trending" sash badges.

### C. Allrecipes / Food Network — community recipe sites
- **Why not:** ad-dense layouts, star ratings as primary content, comment
  thumbnails, "Jump to Recipe" buttons that confess the layout is broken.
  Even at their cleanest, these sites are designed around scrolling past
  three ads to find the ingredient list.
- **Specifically avoid:** the 4.7★ rating widget. We chose 3-option rating
  in a modal precisely to dodge this idiom.

### D. Notion / Linear-style "task card" patterns
- **Why not:** the SaaS productivity card — rounded 8px corners, drop shadow,
  hover lift with elevation change, three-dot menu top-right. This is the
  default everyone in 2025 reaches for; Atelier's brief specifically forbids
  it ("cards-on-grid SaaS dashboard" is in the forbidden zone). Feed Me cards
  use 0px radius, no shadow, hairline borders only.
- **Specifically avoid:** the avatar/owner chip top-right. The top-right is
  reserved for our AI-source indicator and (when cooked) the timestamp —
  editorial metadata, not collaboration UI.

### E. Apple News+ / Flipboard — "magazine app" layouts
- **Why not:** these look editorial at first glance but on close inspection
  they're shopping malls of content tiles with fake serif headlines wedged
  into glassmorphic cards. We're targeting actual print-magazine restraint,
  not "magazine vibes for the app store screenshot."
- **Specifically avoid:** translucent card surfaces, drop shadows on type,
  serif fonts at < 18px (Apple News loves to put serif into 14px metadata,
  which is exactly when serif goes to mush). Our serif is locked to dish
  name and modal title only.

---

## Single-image reference index

If we ever build a moodboard PDF, these are the spreads to scan in (in order):

1. Aesop product page — "Resurrection Aromatique Hand Wash" (any market)
2. Kinfolk #42 — Mediterranean breakfast feature, opening spread
3. Apartamento #29 — interview layout, hairline-separated Q&A
4. Cabana #14 — dinner-table feature opening spread
5. Monocle Forecast 2024 — eating-out column
6. NYT Cooking — Melissa Clark shakshuka recipe page (archive.org snapshot,
   pre-2023)

The first three define our type voice. The fourth defines our color warmth.
The fifth defines our metadata register. The sixth defines our recipe-card
structure.
