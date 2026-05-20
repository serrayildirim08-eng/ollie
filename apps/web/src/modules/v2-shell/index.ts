/**
 * v2-shell · public entry
 *
 * The clean-slate v2 navigation host. `ShellApp` ties the 12 already-built
 * `*-v2` module apps into one navigable app — the capture deck (Throw ·
 * Caught · Noticed), the 4-modules view, the module homepages, and the
 * always-on Find / Safe — and mounts at the single `/preview/v2` route.
 *
 * It composes the existing module apps; it rebuilds none of them, and it
 * touches neither the live app nor the 12 individual `/preview/*` routes.
 */
export { ShellApp } from './ShellApp';
export type { ShellAppProps } from './ShellApp';
// the wide-viewport ("thin spine") alternative to ShellApp — same props,
// picked by router.tsx's ShellHostRoute at window.innerWidth >= 900.
export { DesktopShell } from './DesktopShell';
export type {
  DeckScreen,
  ModuleKey,
  SubmoduleKey,
  ShellFrame,
  ShellOverlay,
} from './types';
