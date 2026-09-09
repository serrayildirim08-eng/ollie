/**
 * doseState — which state a scheduled dose slot is in today.
 *
 * A med can have several slots (e.g. 09:00 + 21:00) and today it may have some
 * doses taken, some set aside for later, some skipped. We track counts per med
 * (not per specific slot), then assign the slots in a stable priority so the
 * counts map onto concrete rows: taken first, then skipped, then later, and the
 * rest are still due. Pure + tested; the box renders each state.
 */

export type DoseState = 'taken' | 'skipped' | 'later' | 'due';

export function doseStateForIndex(
  index: number,
  counts: { taken: number; skipped: number; later: number },
): DoseState {
  const { taken, skipped, later } = counts;
  if (index < taken) return 'taken';
  if (index < taken + skipped) return 'skipped';
  if (index < taken + skipped + later) return 'later';
  return 'due';
}
