# recommendation.md

## pick: **Direction A — "The Magazine"** with one borrowed move from B.

Serra's stated preferences (ADHD-safe, minimalist, editorial-leaning, English copy, rejects text-heavy/busy) line up cleanest with the magazine direction — it is the only one that gives each of the 11 modules its own emotional address while keeping the chrome at near-zero. The sketchbook (B) risks tipping twee at 11-module scale and the console (C) loses the warmth that makes ollie ADHD-safe.

The one move to borrow from B: the **italic margin-aside closing line** on each box. Replace the current `SageNote` (sage dot + sans body) in `GroceryBox.tsx` with a serif italic margin note. It costs nothing, adds the friend-voice ollie needs alongside the editorial gravity, and prevents A from feeling cold like Monocle.

## why not B

The sketchbook tone is beautiful in 1–3 module systems (Bear, Mela). At 11 modules and with `work` reframed around "matters" (per `WORK-VISION.md`), the hand-drawn ticks and personal-voice kickers will fight the secretary-briefing surface and the finance/admin modules. The sketchbook's italic-everywhere voice is also harder to localise cleanly to Spanish — italic feels different in Romance languages.

## why not C

The quiet console kills two ollie strengths. First, it demotes DM Serif Display — the typographic anchor Serra ported in `theme/tokens.ts`. Second, mono everywhere reads as developer-leaning and the cofounder PDF + dogfood phase (per `project_ollie_dogfood_phase0_2026_05_25`) needs screenshots that look soft. Save C for a future power-user "compact" mode toggle.

## the 3 next code changes to start pulling toward A

These are concrete, low-risk, and unlock the rest of the direction without committing to it irreversibly. Each is ~30–90 minutes of work.

1. **Add a `BoxHero` primitive in `apps/native/src/layout/`** that takes `kicker / title / standfirst` and renders the magazine cover treatment: kicker at `caption` size smcp, title at 96px DM Serif Display with `letterSpacing: -0.025em`, standfirst at `h3` size DM Serif italic with a drop cap on the first letter. Then refactor `GroceryBox.tsx` and `CycleBox.tsx` to use it — they already have all three values inline at the top of each component. Net effect: every module gets a cover for free, without changing route or data shape.

2. **Rebuild `dump/DumpScreen.tsx` hero into a cover.** Move the title from `scale="display"` (64px) to a custom inline 112px DM Serif Display, hard-left, three-line break: `What's / in your / head?`. Move the textarea 96px below as a continuation. Drop the `cmd + enter to send` line into the bottom-right at `meta` size DM Mono, like a printer's mark. This single screen change is the biggest emotional payoff in the whole redesign.

3. **Replace the `SageNote` component everywhere it appears with a `MarginNote` component** — serif italic, `inkSoft`, indented 24px from right edge, no leading dot. This is the move borrowed from B. Audit: `GroceryBox.tsx` uses it 3×, `CycleBox.tsx` uses it 0× currently, the other 9 module boxes likely each have 1–2 usages. Single replace_all across `modules/*/*.tsx`. Net effect: the friend-voice lands without going twee.

## what NOT to change in the first pass

- Do **not** touch `theme/tokens.ts`. Every token there still serves direction A. The palette is right.
- Do **not** rebuild `navigation/TabBar.tsx` yet. The left rail + bottom tab pattern works for A. Touch only after the box covers land — the nav inherits its rhythm from the content.
- Do **not** add an animation pass yet. Magazine direction's "ambient motion in idle" can wait for v2.1 — it is the lowest-risk axis to add later and the highest risk to over-do early.

## next-issue iteration axes (v2.1)

Once the magazine direction lands and Serra has lived with it for a week, push on:
- per-module accent inks (cycle gets umber, finance gets a deep amber, sleep gets a near-black) — drawn from the existing `tokens.ts` colour wells, no new tokens needed.
- a single "issue meta" string at the top of every page tying the day together (`issue 14 · tue may 28`) so the cover gesture extends across the whole shell, not just per-module.
- one tiny ambient motion: the dump-screen cursor blink at 0.85s `breathe` cadence (already in `tokens.durations.breathe = '6s'` — divide once and reuse).
