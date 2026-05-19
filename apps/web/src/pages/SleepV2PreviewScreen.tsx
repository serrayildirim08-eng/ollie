/**
 * SleepV2PreviewScreen — dev-only preview of the clean-slate v2 sleep module
 *
 * Mounted at `/preview/sleep` (hash route `index.html#/preview/sleep`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 sleep rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis`, `/preview/money`
 * and `/preview/cycle`) so it is reachable directly, and it does NOT
 * appear in any main-flow navigation — you only land here by typing/
 * opening the URL. The live `modules/sleep` module and the app's current
 * navigation are untouched.
 *
 * The v2 module reads + writes the SAME `sleep.*` store the live module
 * uses — so it shows Serra's real data, and anything logged here is real.
 */
import { SleepApp } from '../modules/sleep-v2/SleepApp';

export interface SleepV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function SleepV2PreviewScreen({ onExit, onSafe }: SleepV2PreviewScreenProps) {
  return <SleepApp onExit={onExit} onSafe={onSafe} />;
}
