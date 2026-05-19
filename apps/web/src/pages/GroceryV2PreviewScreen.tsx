/**
 * GroceryV2PreviewScreen — dev-only preview of the clean-slate v2 grocery module
 *
 * Mounted at `/preview/grocery` (hash route `index.html#/preview/grocery`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 grocery rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by typing/opening the
 * URL. The live `modules/grocery` module and the app's current navigation
 * are untouched.
 *
 * The v2 module reads + writes the SAME `grocery.*` store the live module
 * uses — so it shows Serra's real shopping list + pantry, and anything
 * added, checked off, dropped or taught here is real.
 */
import { GroceryApp } from '../modules/grocery-v2/GroceryApp';

export interface GroceryV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function GroceryV2PreviewScreen({
  onExit,
  onSafe,
}: GroceryV2PreviewScreenProps) {
  return <GroceryApp onExit={onExit} onSafe={onSafe} />;
}
