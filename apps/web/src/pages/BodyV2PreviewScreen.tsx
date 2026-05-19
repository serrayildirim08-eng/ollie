/**
 * BodyV2PreviewScreen — dev-only preview of the clean-slate v2 body module
 *
 * Mounted at `/preview/body` (hash route `index.html#/preview/body`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 body rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis`, `/preview/money`,
 * `/preview/cycle` and `/preview/sleep`) so it is reachable directly, and
 * it does NOT appear in any main-flow navigation — you only land here by
 * typing/opening the URL. The live `modules/body` module and the app's
 * current navigation are untouched.
 *
 * The v2 module reads + writes the SAME `body.*` store the live module
 * uses — so it shows Serra's real data, and anything logged here is real.
 */
import { BodyApp } from '../modules/body-v2/BodyApp';

export interface BodyV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function BodyV2PreviewScreen({ onExit, onSafe }: BodyV2PreviewScreenProps) {
  return <BodyApp onExit={onExit} onSafe={onSafe} />;
}
