/**
 * GoalsV2PreviewScreen — dev-only preview of the clean-slate v2 goals module
 *
 * Mounted at `/preview/goals` (hash route `index.html#/preview/goals`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 goals rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by typing/opening the
 * URL. The live `modules/goals` module and the app's current navigation
 * are untouched.
 *
 * The v2 module reads + writes the SAME `goals.*` store the live module
 * uses — so it shows Serra's real goals, milestones and check-ins, and
 * anything added, ticked, parked or dropped here is real.
 */
import { GoalsApp } from '../modules/goals-v2/GoalsApp';

export interface GoalsV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function GoalsV2PreviewScreen({ onExit, onSafe }: GoalsV2PreviewScreenProps) {
  return <GoalsApp onExit={onExit} onSafe={onSafe} />;
}
