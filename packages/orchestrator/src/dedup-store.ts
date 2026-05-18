/**
 * @ollie/orchestrator · dedup-store
 *
 * Shared helper for the store-persisted "emitted ids" / "emitted keys"
 * arrays that orchestrators keep so a once-per-event signal is not
 * re-emitted on every recompute (e.g. `cycle._predictionEmittedKeys`,
 * `work._hyperfocusEmittedIds`, `finance._anomalyEmittedIds`).
 *
 * Audit item #8: these arrays were appended to forever and never pruned,
 * so the store slice grew unbounded — every recompute serialized an
 * ever-larger JSON blob. `appendCapped` keeps only the most recent
 * `cap` entries (newest = end of array), which is safe because dedup
 * keys embed a timestamp or a record id: an evicted old key cannot
 * collide with a future emit, and if it somehow re-fires the cost is one
 * duplicate signal, not a crash.
 */

/** Default retention — last N dedup keys per array. */
export const DEFAULT_DEDUP_CAP = 200;

/**
 * Merge `fresh` keys onto `existing` and return at most `cap` entries,
 * keeping the most recent (fresh keys are appended last, so they win).
 * De-duplicates so a key already present is not stored twice.
 */
export function appendCapped(
  existing: readonly string[],
  fresh: readonly string[],
  cap: number = DEFAULT_DEDUP_CAP,
): string[] {
  if (fresh.length === 0) return existing.slice(-cap);
  const seen = new Set(existing);
  const merged = existing.slice();
  for (const k of fresh) {
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(k);
  }
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}
