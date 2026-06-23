/**
 * Chores module · domain types.
 *
 * A chore is a household / cleaning task. Two shapes share one registry table:
 *   - `one_off`   — a single thing to do once ("clean the bathroom"). Checkable;
 *                   marking it done removes it from the active list.
 *   - `recurring` — a chore with a cadence ("vacuum every 7 days"). Marking it
 *                   done resets its clock (`lastDoneAt`) so the cadence layer can
 *                   surface it again once ~`cadenceDays` have elapsed.
 *
 * `name` is normalised (lowercase, collapsed whitespace) so "Vacuum" and
 * "vacuum" dedupe to one registry row — the same canonicalisation grocery uses.
 */

export type ChoreKind = 'one_off' | 'recurring';

/** One row in the chores registry. */
export interface Chore {
  id: string;
  /** Normalised display name (e.g. "vacuum", "clean the kitchen"). */
  name: string;
  kind: ChoreKind;
  /** Cadence in days for recurring chores; null for one-offs. */
  cadenceDays: number | null;
  /** ms-since-epoch of the most recent completion; null until first done. */
  lastDoneAt: number | null;
  /** For one-off chores: true once checked off. Recurring chores stay false
   *  (they're never "done" — they just reset their clock). */
  done: boolean;
  createdAt: number;
}

/** One append-only completion event — the cadence source of truth ("how often
 *  do I actually do this chore"). Mirrors grocery_purchase_log. */
export interface ChoreCompletion {
  id: string;
  /** Normalised chore name, matching Chore.name. */
  name: string;
  completedAt: number;
}

/** Normalise a chore name the same way grocery normalises item names. */
export function normaliseChoreName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
