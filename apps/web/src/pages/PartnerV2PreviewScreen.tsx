/**
 * PartnerV2PreviewScreen — dev-only preview of the clean-slate v2 partner
 * feature
 *
 * Mounted at `/preview/partner` (hash route `index.html#/preview/partner`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 partner system on the iPhone WITHOUT changing the working
 * app. The full migration/ship is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other six
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by opening the URL.
 *
 * ── HONEST STUB NOTE ─────────────────────────────────────────────────────────
 * Unlike the other v2 previews, partner-v2 is a NEW feature: there is no
 * partner module and no partner-linking backend. So the 4 screens run over
 * an in-module LOCAL STUB (`usePartnerStore` + `selectors.ts`) seeded with
 * realistic placeholder data. That is expected and honest — when a real
 * backend exists, `usePartnerStore` is the single seam to re-point.
 */
import { PartnerApp } from '../modules/partner-v2/PartnerApp';

export interface PartnerV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function PartnerV2PreviewScreen({
  onExit,
  onSafe,
}: PartnerV2PreviewScreenProps) {
  return <PartnerApp onExit={onExit} onSafe={onSafe} />;
}
