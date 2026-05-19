/**
 * v2-shell · navigation types
 *
 * The shell is the navigation HOST for the clean-slate v2 redesign. It ties
 * the 12 already-built `*-v2` module apps into one navigable app behind a
 * single `/preview/v2` route (DIRECTION.md — "the SHELL that makes them one
 * app").
 *
 * The IA, verbatim from DIRECTION.md, is exactly three levels:
 *
 *   Capture (the front)  — Throw · Caught · Noticed, three swipeable screens
 *                          + the 4-modules view = a 4-dot horizontal deck.
 *   Level 1 — modules    — money · body · home · work, four calm rooms.
 *   Level 2 — a module   — a module homepage pushes on top of the deck.
 *   Level 3 — a submodule— the real `*-v2` app mounts/pushes on top.
 *
 * Find (top-left) and Safe (top-right) are reachable from every screen.
 *
 * This file is the single source of truth for the shell's route grammar;
 * the `*-v2` apps keep their own internal route enums untouched.
 */

/** the four horizontally-swipeable capture-deck screens (4 dots) */
export type DeckScreen = 'throw' | 'caught' | 'noticed' | 'modules';

/** the four Level-1 rooms */
export type ModuleKey = 'money' | 'body' | 'home' | 'work';

/**
 * the twelve real `*-v2` submodule apps the shell mounts. `money` is special
 * — DIRECTION.md: "money has one submodule", so its module homepage IS the
 * money-v2 face, mounted directly. The other eleven are reached via a module
 * homepage (body / home / work).
 */
export type SubmoduleKey =
  | 'money'
  | 'cycle'
  | 'sleep'
  | 'body'
  | 'medication'
  | 'habits'
  | 'admin'
  | 'pets'
  | 'grocery'
  | 'work'
  | 'goals'
  | 'partner';

/**
 * a single frame on the shell's push stack. The deck is always the floor
 * (`kind: 'deck'`); a module homepage and a mounted submodule app push on
 * top of it. Back pops one frame; popping the floor is a no-op (the deck
 * cannot be left — it is the app's front).
 */
export type ShellFrame =
  | { kind: 'deck' }
  | { kind: 'module'; module: ModuleKey }
  | { kind: 'submodule'; submodule: SubmoduleKey };

/**
 * which always-on overlay is open, if any. Find is an in-shell overlay;
 * Safe routes out to the app's crisis surface, so it is not a shell state.
 */
export type ShellOverlay = 'none' | 'find';
