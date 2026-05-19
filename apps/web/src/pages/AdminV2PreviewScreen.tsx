/**
 * AdminV2PreviewScreen — dev-only preview of the clean-slate v2 admin module
 *
 * Mounted at `/preview/admin` (hash route `index.html#/preview/admin`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 admin rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by typing/opening the
 * URL. The live `modules/admin` module and the app's current navigation are
 * untouched.
 *
 * The v2 module reads + writes the SAME `admin.tasks` store the live module
 * uses — so it shows Serra's real admin tasks, and anything added, marked
 * done, deferred or split here is real.
 */
import { AdminApp } from '../modules/admin-v2/AdminApp';

export interface AdminV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function AdminV2PreviewScreen({ onExit, onSafe }: AdminV2PreviewScreenProps) {
  return <AdminApp onExit={onExit} onSafe={onSafe} />;
}
