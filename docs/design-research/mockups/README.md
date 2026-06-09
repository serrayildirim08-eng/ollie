# Ollie UI mockups (v1)

Static visual reference for Ollie's beta UI. **Mockup only — not wired into the real Tauri app.**

## What's here

- `index.html` — single self-contained file. Open directly in any modern browser (no build step, no local server).
- `README.md` — this file.

## What's inside `index.html`

A long vertical scroll-stack showing 18 screens, each rendered twice:

1. A simulated desktop browser frame (~1280px wide, with traffic-light dots and a fake address bar).
2. A simulated iPhone 15 Pro frame (portrait, with Dynamic Island and an iOS status bar).

Screens, in order:

1. Sign-in
2. Dump (home, resting state)
3. Dump (with "okay" toast)
4. Dump (with crisis banner replacing "okay")
5. Modules index (11 modules)
6. Grocery — pantry view
7. Grocery — shopping view
8. Pets (Tontin + Pinpon, with vitamin-C status dot)
9. Body (water tumbler 4/8, last movement, sections)
10. Work (focus minutes ring, tasks with strike-through)
11. Finance (multi-currency hero, bills, subs)
12. Sleep — populated **and** empty-state variant
13. Admin (renewals with overdue warning ink, runway hairline)
14. Habits (streak ring, weekly dots, identity notes)
15. Goals — populated **and** empty-state variant
16. Medication (dose ring, dose-dots row)
17. Cycle (28-day phase ring with traveling marker)
18. Settings

## Tech

- Vanilla HTML + CSS only. No JS framework.
- One small inline `<script>` provides textarea auto-grow on the sign-in/dump screens. Everything degrades cleanly without JS.
- External assets: FontAwesome (cdnjs) for icons, Google Fonts (Source Serif 4) for accent serif numerals. If both CDNs are blocked, system UI fonts and unicode glyphs fall back gracefully — structure stays intact.

## Design notes (load-bearing for next iteration)

- Palette is bone (`#ECEAE4`) page / warm white surfaces / one sage accent (`#7C9E87`) / one pastel-blue used only on the water tumbler / amber (`#B8894B`) as "warning ink, never red."
- Typography is system UI for body, Source Serif 4 *only* on the dump prompt, sleep hours, and goal "why" lines — three places, three different emotional jobs.
- Crisis banner uses a warm sand background (`#F4E8DC`), not red, so it never feels like an alarm.
- Empty states (Sleep and Goals) are rendered as a secondary cell directly below the populated version so reviewers can compare side by side.
- Touch targets ≥ 44px throughout. Focus rings use the sage accent at 2px / 2px offset.

## What it is **not**

- Not interactive — clicking a "module card" does nothing.
- Not connected to the real app's data, state, or routing.
- Not shipped — lives only in `docs/design-research/mockups/` for review.
