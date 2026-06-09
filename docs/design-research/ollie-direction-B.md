# Direction B — "The Sketchbook"

**tone in one line:** ollie is a thoughtful notebook with the corners softened — paper, pencil marks, italic asides, a friend's handwriting in the margin.

## five design moves

1. **paper texture across all surfaces.** the `cream` token (#FAFAF7) gets a subtle SVG noise overlay (3% opacity, sub-pixel grain) applied at the `Layout.tsx` root. it should be invisible at first glance but obvious if you squint. ports the felt of Mela / Bear / Day One photo entries.

2. **dotted rules replace hairlines.** all `borderTop: 1px solid colors.hairline` instances (used heavily in `GroceryBox.tsx` shopping rows + section dividers) become `1px dashed colors.hairline` with the dash already in the empty-state `EmptyNote` component as the precedent. tiny move, huge feel-shift.

3. **italic asides as a first-class element.** add a new pattern: the "margin note" — a serif italic line in `inkSoft`, indented 24px from the right edge, used as the closing voice on each box. replaces the current `SageNote` (sage dot + body line) with a quieter typographic gesture. dot is dropped.

4. **hand-drawn-feeling glyphs.** the round tick circle in `TickCircle` (`GroceryBox.tsx`) becomes a hand-drawn-looking SVG (slightly off-axis, 2 small breaks in the stroke). same for the cycle ring marker dot in `CycleBox.tsx` — a hand-drawn circle, not a perfect SVG circle. all done in SVG, ~10 lines per glyph.

5. **personal-journal voice across copy.** rewrite all the SMCP kicker labels from `box · grocery` to `from the kitchen` / `from the body` / `from the desk`. these are emotional anchors not categories. the route stays `/box/grocery` but the on-screen meta becomes voiced. lowercase, italic where it earns it.

## treatment: the dump screen

```
        from the morning · tuesday
        ─ ─ ─ ─ ─ ─ ─
        
        What's in your head?
        
        ┌······································┐
        ┊  (textarea on paper texture,         ┊
        ┊   dashed border, italic placeholder) ┊
        └······································┘
        
        cmd + enter         okay, mm-hm
                                      (margin italic)
```

- hero is 72px DM Serif Display (smaller than direction A — the sketchbook doesn't shout).
- the kicker is now `from the morning · tuesday` in italic DM Sans 13px, not all-caps. softer.
- the textarea has a dashed paper-border (1px, `colors.hairline`), feels like a note in a notebook.
- the ack copy changes from `okay` → `okay, mm-hm` — a thinking sound, italic, right-margin.

## treatment: grocery box

- kicker: `from the kitchen` (italic, 13px, sentence case).
- title: `Grocery` at 72px DM Serif Display — small enough to feel like a heading inside a notebook, not a magazine cover.
- standfirst (italic): *"things to grab, things you have, nothing fancy."*
- the shopping list rules become 1px dashed instead of solid. tick circles become hand-drawn arcs.
- closing margin italic: *"check things off — i'll move them to the pantry."* — voiced AI as a friend, not a system message.

## treatment: cycle box

- kicker: `from the body` (italic, sentence case).
- title: `Cycle` at 72px DM Serif Display.
- standfirst (italic): *"day eight. soft, learning."*
- the ring stays SVG-perfect (cycle data deserves precision — the body is the body), but the umber marker gets a slight hand-drawn halo (a second slightly off-centred circle in `paper` at 30% opacity) — the only place the sketchbook gesture enters a precision element.
- "recent symptoms" / "pills" / "history" labels become `noticed lately` / `pills` / `period log`. quieter, more human.
- closing margin italic: *"i'll keep watching — you tell me what's true."*

## risks

1. **the paper texture cuts both ways.** on low-DPI screens it can look like a rendering bug. mitigation: serve a 2× SVG, only apply above-CSS-pixel density threshold via `@media (min-resolution: 2dppx)`.
2. **italic asides can feel twee at scale.** 11 modules × italic margin notes risks tipping into Etsy. mitigation: cap to one italic aside per box, never two. ban italics from interactive labels (buttons, mode switch) — only voice.
3. **the personal-voice kickers risk losing scannability.** `from the kitchen` is warmer but slower to parse than `BOX · GROCERY`. mitigation: A/B during dogfood — keep the system kicker as a fallback for power users via a setting.

## recommend if

- Serra wants the app to feel like a friend's voice more than a tool.
- ADHD-safe is being interpreted primarily as "low-shame, soft-tone" rather than "low-chrome, fast-scan."
- the audience is single-user solo journalers, not power-users routing 30 dumps a day.

**Recommend against if** the work module's "matters" surface (per `project_ollie_work_matters` memory) needs to feel professional — hand-drawn ticks under a project plan might undercut the secretary-briefing voice. consider scoping sketchbook only to body/cycle/dump/sleep/habits and leaving work/finance/admin in a neighbouring quieter sibling style.
