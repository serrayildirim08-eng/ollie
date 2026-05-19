/**
 * WorkV2PreviewScreen — dev-only preview of the clean-slate v2 work module
 * (the "matters" concept)
 *
 * Mounted at `/preview/work` (hash route `index.html#/preview/work`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 work / matters system on the iPhone WITHOUT changing the
 * working app. The full migration/ship is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the other
 * `/preview/*` routes) so it is reachable directly, and it does NOT appear
 * in any main-flow navigation — you only land here by opening the URL.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * The preview ships the work-v2 "matters" screens — the work card, the matter
 * list, one matter's view, and the auto-detect / confirm sheet. The route
 * mounts `WorkApp`.
 *
 * ── REAL BACKEND, NOT A STUB ─────────────────────────────────────────────────
 * work-v2 ships the "matters" concept (WORK-VISION.md). The matter container +
 * the deterministic dump→matter routing (Phases 1+2) are REAL and shipped
 * (`@ollie/logic/work` + the `matter-routing` orchestrator, committed as
 * 9ed51e5). `useWorkStore` reads the live `work` store namespace those write
 * into. Phase 3 (AI extraction + the synthesised secretary briefing) and
 * Phase 4 (recurring-shape learning) are not built yet — so the matter view
 * is Phase-1/2-honest: identity + routed raw notes, no synthesised briefing,
 * and deliberately no "missing" / deficit field anywhere.
 */
import { WorkApp } from '../modules/work-v2/WorkApp';

export interface WorkV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function WorkV2PreviewScreen({
  onExit,
  onSafe,
}: WorkV2PreviewScreenProps) {
  return <WorkApp onExit={onExit} onSafe={onSafe} />;
}
