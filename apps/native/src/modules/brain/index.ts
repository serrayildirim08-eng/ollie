/**
 * apps/native · modules/brain  —  the silent-observer brain (native side).
 *
 * Pure computations live in @ollie/logic/brain; this module owns the native
 * persistence + store wiring:
 *   - harm.ts:     gather world-facts → detectHarm → persist brain_harm_events
 *   - capacity.ts: read store signals → computeCapacity → write shared.capacity
 *
 * `recomputeBrain` is the single entry point fired on boot + after each dump
 * (apps/native/src/store.ts + modules/dispatch.ts), AFTER runAllSyncs so the
 * mirrored store keys are fresh. Never throws.
 */

import type { Store } from '@ollie/store';
import { migrateBrain } from './migrate';
import { scanAndRecordHarm } from './harm';
import { recomputeCapacity } from './capacity';
import { recomputeLearnedMap } from './learn';

export { migrateBrain } from './migrate';
export { scanAndRecordHarm, countHarmEvents, listHarmEvents } from './harm';
export { recomputeCapacity } from './capacity';
export {
  selectTodaysNoticings,
  gatherCandidates,
  excludedIds,
  postponeNoticing,
  dismissNoticing,
  countDeferralEvents,
  POSTPONE_MS,
} from './noticings';
// Sprint 4 — the "learn YOU" loop: per-person procrastination map + pins.
export {
  recomputeLearnedMap,
  loadLearnedMap,
  makeDeferabilityResolver,
  setPin,
  bucketKeysFor,
  coarseBucketOf,
  tallyBuckets,
} from './learn';

/**
 * Recompute both brain signals from current state. Best-effort and isolated —
 * a failure in one half never starves the other, and the call resolves rather
 * than rejects so it is safe to fire-and-forget on boot / after a dump.
 */
export async function recomputeBrain(store: Store, now: number = Date.now()): Promise<void> {
  await migrateBrain().catch(() => { /* table create best-effort */ });
  await Promise.all([
    scanAndRecordHarm(store, now).catch((err) => {
      console.error('[brain] harm scan failed (non-fatal):', err);
    }),
    Promise.resolve().then(() => recomputeCapacity(store, now)).catch((err) => {
      console.error('[brain] capacity recompute failed (non-fatal):', err);
    }),
  ]);
  // Sprint 4 — recompute the LEARNED per-person map AFTER the harm scan, so the
  // freshest harm events feed the verdicts. Isolated + best-effort: with no
  // accumulated data the map is mostly 'unknown' → cold-start (correct; it
  // sharpens over weeks). Recomputed here on boot / after a dump, NOT per render.
  await recomputeLearnedMap(now).catch((err) => {
    console.error('[brain] learned-map recompute failed (non-fatal):', err);
  });
}
