# competitive-scan.md

quiet editorial / journal / productivity apps worth stealing from for ollie's v2 face. 10 apps. each: what they get right + url for moodboard.

scope: minimalist editorial, not SaaS dashboard. axes called out per app: hero / typography / empty states / navigation / animation density.

---

## 1. Reflect (notes/journal, Mac+iOS)

what they get right: hero is one input + nothing else. the home view is a serif "what's on your mind?" and a cursor — almost no chrome. typography is Tiempos-style serif body + tight sans labels. empty notes have a single italic hint that fades on focus. navigation is a quiet left rail (collapsible) — the document is the surface. animation density: very low; soft fades on panel reveal, no bounce.
ref: https://reflect.app/

## 2. Stoic (journal/iOS)

what they get right: hero is a big calm prompt of the day, set in a wide serif, dropped onto soft paper. empty states are reframed as invitations ("today is unwritten"). navigation is a 4-tab bottom bar but each tab opens into editorial-style sections. animation density is medium — one slow ambient gradient + restrained card stagger on entry.
ref: https://apps.apple.com/us/app/stoic-journal-meditations/id1312926037

## 3. Things 3 (Cultured Code / iOS+Mac)

what they get right: empty states are the best in productivity, full stop — a single line of italic encouragement plus negative space at 60%+. hero treatment is restrained: a section title in regular weight + a subtle paper background. navigation is iconographic but never tabs-with-pills — items earn their place. animation density is medium-high but every motion has physics + purpose (the famous magic-plus + check ripple).
ref: https://culturedcode.com/things/

## 4. Bear (note-taking, Mac+iOS)

what they get right: typography first — the whole app is a typesetter's playground (Avenir, Charter, lots of weight contrast). hero is the document. empty states show a faded brand mark, never a generic "create your first note." navigation is a thin left spine with `#tag` hierarchy that doubles as labels. animation density: minimal, but the writing surface itself feels like paper under a glass — that's the personality.
ref: https://bear.app/

## 5. Day One (journal, Mac+iOS)

what they get right: hero treatment for "on this day" — a magazine spread vibe with image + serif headline + meta line. empty journal opens to a centred quote + a single CTA. navigation is a 3-pane (sources / list / detail) but the typography keeps it from feeling SaaS-y. animation density: low; one gentle parallax on photo entries.
ref: https://dayoneapp.com/

## 6. Mela (RSS / recipes, Mac+iOS by Silvio Rizzi)

what they get right: editorial typography across the whole app — recipes presented like a Kinfolk spread. hero is the recipe image full-bleed, headline in tall serif, ingredients in sans columns. empty state is a single italic line. navigation is a collapsing left rail. animation density: low + tasteful — the whole app feels handmade.
ref: https://mela.recipes/

## 7. Reeder 5 (rss reader, Silvio Rizzi)

what they get right: typography contrast as the entire UI — serif body + tiny smcp meta is its grammar. hero is the article itself, but the list view also reads like a magazine TOC (kicker + headline + standfirst). navigation is a thin spine that disappears in reading mode. animation density: minimal but elegant — the list scroll feels like flipping pages.
ref: https://reederapp.com/

## 8. NotePlan (calendar+notes, Mac+iOS)

what they get right: the day view is a single column of plain text — closest to "calm console" of any productivity app. headings are markdown-rendered with deliberate scale jumps. empty states are blank — confident in the format. navigation is collapsible left rail. animation density: near-zero — that's the brand.
ref: https://noteplan.co/

## 9. Heptabase (whiteboard/notes, Mac/web)

what they get right: each card has serious typographic care — a real headline + body, not a placeholder + chrome. hero is the whiteboard itself — quiet paper background, no grid by default. empty boards show one centred italic prompt. navigation is icon-light, content-heavy. animation density: medium with spring physics on card drag (this is the one place spring is earned in this space).
ref: https://heptabase.com/

## 10. Linear (project mgmt, web)

what they get right: this is the gold standard for "SaaS that doesn't look SaaS" — Inter Display + restraint. hero is a single H1 + breadcrumb. empty states are a single line + a faint illustration. navigation is a thin spine with sub-section disclosure. animation density: medium — every interaction has a calm spring (the famous cmd-k + transition curves). NOT a moodboard target for ollie because the chrome is too dense, but the empty-state and nav restraint are stealable.
ref: https://linear.app/

---

## bonus: 2 outside the app world but on the moodboard

**Kinfolk magazine** (print/web). 70% negative space, a single serif hero per spread, smcp kickers, one accent ink. this is the dna ollie's tokens are already chasing.
ref: https://www.kinfolk.com/

**Are.na's own product UI**. one of the few places on the web where the editorial gesture survives interaction. monospace meta + serif body + huge white. moodboard for "the quiet console" direction.
ref: https://www.are.na/

---

## quick read

- everyone in this peer set under-uses chrome and over-uses typography. ollie already does this in `theme/tokens.ts` (no shadow on cards, hairline rules only, DM Serif Display + DM Sans + DM Mono).
- empty states are universally the most loved screens — Things, Day One, Reflect.
- nobody in this set uses bottom tabs with icon-pills + active fills. ollie's current `navigation/TabBar.tsx` already follows this rule (text-only, hairline border-left for active).
- the differentiator across apps is **per-screen identity**. Day One's "on this day" reads nothing like its journal list. Bear's `#tag` view reads nothing like its editor. ollie's 11 module boxes currently all read the same — that's the weakest link.
