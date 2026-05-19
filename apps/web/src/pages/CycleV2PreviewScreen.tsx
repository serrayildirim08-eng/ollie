/**
 * CycleV2PreviewScreen — dev-only preview of the clean-slate v2 cycle module
 *
 * Mounted at `/preview/cycle` (hash route `index.html#/preview/cycle`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 cycle rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and `/preview/money`)
 * so it is reachable directly, and it does NOT appear in any main-flow
 * navigation — you only land here by typing/opening the URL. The live
 * `modules/cycle` module and the app's current navigation are untouched.
 *
 * The v2 module reads + writes the SAME `cycle.*` store the live module
 * uses — so it shows Serra's real data, and anything logged here is real.
 */
import { CycleApp } from '../modules/cycle-v2/CycleApp';

export interface CycleV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function CycleV2PreviewScreen({ onExit, onSafe }: CycleV2PreviewScreenProps) {
  return <CycleApp onExit={onExit} onSafe={onSafe} />;
}
