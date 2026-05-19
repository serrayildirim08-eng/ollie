/**
 * PetsV2PreviewScreen — dev-only preview of the clean-slate v2 pets module
 *
 * Mounted at `/preview/pets` (hash route `index.html#/preview/pets`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 pets rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by typing/opening the
 * URL. The live `modules/pets` module and the app's current navigation are
 * untouched.
 *
 * The v2 module reads + writes the SAME `pets.*` store slices the live
 * module uses — so it shows Serra's real pets, care log, observations and
 * health flags, and anything added or logged here is real.
 */
import { PetsApp } from '../modules/pets-v2/PetsApp';

export interface PetsV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function PetsV2PreviewScreen({ onExit, onSafe }: PetsV2PreviewScreenProps) {
  return <PetsApp onExit={onExit} onSafe={onSafe} />;
}
