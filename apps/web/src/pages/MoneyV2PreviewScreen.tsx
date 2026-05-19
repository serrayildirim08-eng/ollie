/**
 * MoneyV2PreviewScreen — dev-only preview of the clean-slate v2 money module
 *
 * Mounted at `/preview/money` (hash route `index.html#/preview/money`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 money rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis`) so it is reachable
 * directly, and it does NOT appear in any main-flow navigation — you only
 * land here by typing/opening the URL. The live `modules/finance` module
 * and the app's current navigation are completely untouched.
 *
 * The v2 module reads + writes the SAME `finance.*` store the live module
 * uses — so it shows Serra's real data, and anything logged here is real.
 */
import { MoneyApp } from '../modules/money-v2';

export interface MoneyV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function MoneyV2PreviewScreen({ onExit, onSafe }: MoneyV2PreviewScreenProps) {
  return <MoneyApp onExit={onExit} onSafe={onSafe} />;
}
