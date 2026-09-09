/**
 * Chores module · domain types.
 *
 * A chore is a household / cleaning task. Two shapes share one registry table:
 *   - `one_off`   — a single thing to do once ("clean the bathroom"). Checkable;
 *                   marking it done removes it from the active list.
 *   - `recurring` — a chore that comes back. A recurring chore recurs in ONE of
 *                   two ways:
 *                     · WEEKDAY-anchored ("laundry on wednesdays") — `weekdays`
 *                       holds the local days [0=Sun..6=Sat] it's due. On a
 *                       matching weekday it AUTO-appears on today's list (silent,
 *                       tagged ↻); marking it done stamps `lastDoneAt` so it
 *                       drops off until the next matching day.
 *                     · INTERVAL ("vacuum every 7 days") — `cadenceDays` holds
 *                       the rhythm; it falls due once ~that many days have
 *                       elapsed since `lastDoneAt`.
 *                   A chore uses weekdays when set, else cadenceDays.
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
  /** Interval cadence in days for interval-recurring chores; null otherwise. */
  cadenceDays: number | null;
  /** Local weekdays [0=Sun..6=Sat] for weekday-anchored recurring chores
   *  ("laundry on wednesdays" → [3]); null for one-offs + interval chores. */
  weekdays: number[] | null;
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

/** Local weekday [0=Sun..6=Sat] for a ms timestamp. Local, not UTC — "do
 *  laundry on wednesdays" means the user's Wednesday, wherever they are. */
export function localWeekday(ts: number): number {
  return new Date(ts).getDay();
}

/** True when two ms timestamps fall on the same LOCAL calendar day. Used so a
 *  weekday chore done earlier today doesn't re-appear later the same day. */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Sanitise a weekdays array off the wire: ints in 0..6, deduped, sorted, or
 *  null when nothing usable. Defends the repo + handler against junk payloads. */
export function normaliseWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set<number>();
  for (const v of raw) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  if (set.size === 0) return null;
  return Array.from(set).sort((a, b) => a - b);
}

const WEEKDAY_PLURAL = [
  'sundays',
  'mondays',
  'tuesdays',
  'wednesdays',
  'thursdays',
  'fridays',
  'saturdays',
];

/** Human label for a weekday set: [3]→"wednesdays", [1,4]→"mondays & thursdays",
 *  [1,2,3,4,5]→"weekdays". Lowercase, for the calm "you do this …" sub-line. */
export function formatWeekdays(weekdays: number[]): string {
  const days = normaliseWeekdays(weekdays) ?? [];
  if (days.length === 0) return '';
  if (days.length === 7) return 'every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    return 'weekdays';
  }
  const labels = days.map((d) => WEEKDAY_PLURAL[d]!);
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}
