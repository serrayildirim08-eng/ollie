# Direction C — "The Quiet Console"

**tone in one line:** ollie is a terminal that learned manners — single-line entry, mono meta, almost no display type, generous breathing room.

## five design moves

1. **mono takes the meta workload.** all kicker labels, day numbers, page meta, counts, "low" flags, "today/yesterday/3d ago" timestamps — everything that currently uses smcp DM Sans (`fontVariantCaps: 'all-small-caps'`) moves to DM Mono at the same size. mono is already in `tokens.fonts.mono`. this is a one-token swap across ~30 components.

2. **demote DM Serif Display.** keep it in tokens but use it only on `/` (dump) and the cycle ring's day number. every box title shifts to DM Sans light 32px (the `h2` size, weight 300). this turns each box's hero from a magazine cover into a typed-out file path: `cycle.` `grocery.` `body.`. trailing period included — it's the literal grammar shift.

3. **single-line entry points everywhere.** the brain-dump becomes a single-line input by default, expanding only when content overflows (auto-grow textarea, starts at 1 row). pulls the Reeder 5 / Reflect / NotePlan gesture — the surface defers until you ask. cmd+enter still sends.

4. **prompt-style empty states.** rewrite empty-state copy as if printed by a terminal that's been polite once before. `ColdShop` becomes:
   ```
   list.empty
   try: "need pasta"
   ```
   no decorative `EmptyNote` graphic with stub-rules. just text + the literal example dump. zero illustration. less to render, more to read.

5. **navigation collapses to a single sticky strip.** replace the `TabBar.tsx` left rail with a top thin strip — like NotePlan / Linear's breadcrumb bar. items: `dump · cycle · grocery · body · work · ⋯` separated by `·`. active item is bold ink, the rest are `inkFaint`. on hover, a one-line preview of that module's state slides down from the strip (current cycle day / shopping count / etc). no sidebar. content gets the full canvas.

## treatment: the dump screen

```
        dump · grocery · cycle · body · work · ⋯       1:42 pm
        ──────────────────────────────────────────────────
        
        
        > _____________________________________________  ↵
        
        cmd+enter sends · esc clears
```

- the input is a single-line text field with a `>` mono prompt prefix, 60ch wide, DM Mono 17px.
- on overflow it auto-grows downward, still inside the same surface.
- there's no title at the top. the navigation strip is the title. zero chrome.
- the ack changes from `okay` to a one-line mono: `ok. routed: grocery, body.` — that's the only place ollie ever names which modules it touched in the dump UX. system telemetry, but voiced.

## treatment: grocery box

- top: `grocery.` in DM Sans 32px weight 300, no kicker above (the nav strip is the kicker now).
- below, a single mono meta line: `14 on list · 3 low in pantry · last shop 2d ago`.
- shop / pantry switch becomes `[shop] pantry` — square brackets for active state, like a vim modeline. all mono.
- shopping list rows: still hairline-ruled, but the row layout is `[ ] pasta                              500g    2d`. tick + name + qty + age-since-added, all aligned in a mono-friendly column grid.
- empty state: `list.empty / try: "need pasta"` — see move 4.

## treatment: cycle box

- top: `cycle.` in DM Sans 32px weight 300.
- below, a single mono meta line: `day 8 · follicular · 22 days avg`.
- the ring stays SVG (move 2 keeps DM Serif Display for the day number inside the ring — that's the one DM Serif Display moment per cycle box). it's the typographic anchor; everything else around it is mono.
- recent symptoms / pills / history become 3 mono tables: `2026-05-26  cramps` aligned columns, no smcp labels. tables have a single-letter h-key: `s` for symptoms, `p` for pills, `h` for history. terminal-y but legible.
- closing line in mono italic: `ollie is still learning your shape.`

## risks

1. **the warmth evaporates.** mono + low-chrome + prompt-style copy reads as developer-leaning, which is the opposite of ADHD-safe / soft-tone. Serra has rejected text-heavy/busy designs but the console direction can land as cold. mitigation: keep the cream palette + sage accent untouched; warmth lives in colour even when type goes mono.
2. **dump as a single-line input weakens the "presence" moment.** the current `DumpScreen.tsx` already has only one input — making it smaller could under-invite. mitigation: large empty space above the input + cursor blink animation + a serif placeholder *"what's in your head?"* italic — the input is small but the room is large.
3. **navigation strip on mobile.** 11 modules don't fit in a single top strip even at iPhone Pro width. mitigation: collapse to top 3 + `⋯` overflow menu on small viewports. drop bottom tabbar entirely — the strip is universal.

## recommend if

- Serra wants the app to disappear when not in use.
- the modules are visited frequently and quick scan is the dominant pattern.
- the audience overlaps power-users / engineers / "Linear-lovers."
- the desktop Tauri build is the primary surface and mobile is secondary.

**Recommend against if** the next 6-month focus is consumer-facing onboarding / cofounder demos / app-store screenshots — the console direction shoots terrible app-store screenshots compared to the magazine direction.
