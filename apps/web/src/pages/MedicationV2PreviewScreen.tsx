/**
 * MedicationV2PreviewScreen — dev-only preview of the clean-slate v2
 * medication submodule
 *
 * Mounted at `/preview/medication` (hash route
 * `index.html#/preview/medication`). This is a DEV PREVIEW: it lets Serra
 * open and click through the real, runnable v2 medication rebuild on the
 * iPhone WITHOUT replacing the working app. The full migration/swap is a
 * later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis`, `/preview/money`,
 * `/preview/cycle`, `/preview/sleep` and `/preview/body`) so it is
 * reachable directly, and it does NOT appear in any main-flow navigation —
 * you only land here by typing/opening the URL. The live
 * `modules/medication` module and the app's current navigation are
 * untouched.
 *
 * The v2 module reads + writes the SAME `medication.*` store the live
 * module uses — so it shows Serra's real data, and anything logged here is
 * real.
 */
import { MedicationApp } from '../modules/medication-v2/MedicationApp';

export interface MedicationV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function MedicationV2PreviewScreen({
  onExit,
  onSafe,
}: MedicationV2PreviewScreenProps) {
  return <MedicationApp onExit={onExit} onSafe={onSafe} />;
}
