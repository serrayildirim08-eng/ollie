/**
 * Cycle module · repository.
 *
 * Thin typed wrapper over the SQLite layer. SQL strings only live here;
 * handlers + screens call these and stay query-agnostic.
 *
 * Conventions:
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - Symptom labels live JSON-encoded in `data` to keep the table
 *     single-shape across event kinds.
 *   - `current()` derives the current-cycle view at read time — there is
 *     no separate "cycle" row.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import { newId } from '../../storage/id';
import {
  normaliseSymptom,
  type BleedingIntensity,
  type CurrentCycle,
  type CycleEvent,
  type CycleEventKind,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface CycleEventRow {
  id: string;
  kind: string;
  data: string | null;
  occurred_at: number;
  [col: string]: unknown;
}

/** Heuristic: if a period_end lands within this window of a start, we
 *  treat the period as over. Outside it, we assume the end belongs to a
 *  different cycle and the user is still bleeding. */
const BLEEDING_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole calendar-days from `from` to `to` measured in LOCAL time.
 *
 * Dividing the absolute ms gap by 86_400_000 is off-by-one across a DST
 * transition (a 23h or 25h local day) — e.g. a period started "yesterday"
 * can read as 0 or 2 days ago. Snapping both ends to local midnight first
 * (via the existing `startOfLocalDay`) makes "day N" stable regardless of
 * clock shifts (#136). `Math.round` absorbs the ±1h DST jitter between the
 * two midnights so the quotient lands on a clean integer.
 */
function localDayDiff(from: number, to: number): number {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / DAY_MS);
}


function rowToEvent(r: CycleEventRow): CycleEvent {
  let symptom: string | null = null;
  let intensity: BleedingIntensity | null = null;
  if (r.data) {
    try {
      const parsed = JSON.parse(r.data) as {
        symptom?: string;
        intensity?: BleedingIntensity;
      };
      symptom = parsed.symptom ?? null;
      intensity = parsed.intensity ?? null;
    } catch {
      symptom = null;
      intensity = null;
    }
  }
  return {
    id: r.id,
    kind: r.kind as CycleEventKind,
    symptom,
    intensity,
    occurredAt: r.occurred_at,
  };
}

async function insert(
  kind: CycleEventKind,
  data: Record<string, unknown> | null,
): Promise<CycleEvent> {
  const id = newId('c_');
  const now = Date.now();
  const encoded = data ? JSON.stringify(data) : null;
  await sql.execute(
    `INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)`,
    [id, kind, encoded, now],
  );
  return {
    id,
    kind,
    symptom: (data?.symptom as string | undefined) ?? null,
    intensity: (data?.intensity as BleedingIntensity | undefined) ?? null,
    occurredAt: now,
  };
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const cycleRepo = {
  async logPeriodStart(): Promise<CycleEvent> {
    return insert('period_start', null);
  },

  async logPeriodEnd(): Promise<CycleEvent> {
    return insert('period_end', null);
  },

  async logSymptom(symptom: string): Promise<CycleEvent> {
    return insert('symptom', { symptom: normaliseSymptom(symptom) });
  },

  async logPill(): Promise<CycleEvent> {
    return insert('pill', null);
  },

  /**
   * Set the bleeding-intensity tag for a given local day (defaults to today).
   * One tag per day: any existing `bleeding` row inside that local day is
   * cleared first, so re-tapping a chip replaces rather than stacks. Returns
   * the freshly-written event.
   */
  async setBleeding(
    intensity: BleedingIntensity,
    at: number = Date.now(),
  ): Promise<CycleEvent> {
    const dayStart = startOfLocalDay(at);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    await sql.execute(
      `DELETE FROM cycle_events
       WHERE kind = 'bleeding' AND occurred_at >= ? AND occurred_at < ?`,
      [dayStart, dayEnd],
    );
    const id = newId('c_');
    await sql.execute(
      `INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, 'bleeding', ?, ?)`,
      [id, JSON.stringify({ intensity }), at],
    );
    return { id, kind: 'bleeding', symptom: null, intensity, occurredAt: at };
  },

  /** The bleeding-intensity tag logged for a local day, or null. */
  async bleedingForDay(at: number = Date.now()): Promise<BleedingIntensity | null> {
    const dayStart = startOfLocalDay(at);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const rows = await sql.select<CycleEventRow>(
      `SELECT id, kind, data, occurred_at FROM cycle_events
       WHERE kind = 'bleeding' AND occurred_at >= ? AND occurred_at < ?
       ORDER BY occurred_at DESC LIMIT 1`,
      [dayStart, dayEnd],
    );
    if (rows.length === 0) return null;
    return rowToEvent(rows[0]!).intensity;
  },

  async list(kind?: CycleEventKind, limit = 50): Promise<CycleEvent[]> {
    const rows = kind
      ? await sql.select<CycleEventRow>(
          `SELECT id, kind, data, occurred_at
           FROM cycle_events WHERE kind = ?
           ORDER BY occurred_at DESC LIMIT ?`,
          [kind, limit],
        )
      : await sql.select<CycleEventRow>(
          `SELECT id, kind, data, occurred_at
           FROM cycle_events
           ORDER BY occurred_at DESC LIMIT ?`,
          [limit],
        );
    return rows.map(rowToEvent);
  },

  /**
   * Derive the current cycle from the event stream.
   *
   * Algorithm:
   *   1. Find the most recent period_start.
   *   2. If a period_end exists between that start and start+8d, the
   *      period is over (still in the cycle, just not bleeding).
   *   3. Otherwise we assume the user is still bleeding.
   *
   * Returns `null` if no period_start is on record.
   */
  async current(): Promise<CurrentCycle | null> {
    const startRows = await sql.select<CycleEventRow>(
      `SELECT id, kind, data, occurred_at FROM cycle_events
       WHERE kind = 'period_start'
       ORDER BY occurred_at DESC LIMIT 1`,
    );
    if (startRows.length === 0) return null;
    const startedAt = startRows[0]!.occurred_at;

    const endRows = await sql.select<CycleEventRow>(
      `SELECT id, kind, data, occurred_at FROM cycle_events
       WHERE kind = 'period_end' AND occurred_at > ? AND occurred_at < ?
       ORDER BY occurred_at ASC LIMIT 1`,
      [startedAt, startedAt + BLEEDING_WINDOW_MS],
    );
    const bleeding = endRows.length === 0;

    const daysSinceStart = localDayDiff(startedAt, Date.now());
    return { startedAt, daysSinceStart, bleeding };
  },

  // ─── pregnancy pause ──────────────────────────────────────────────────────
  //
  // Modelled as two additive event kinds in the same stream — no separate
  // table, no pregnancy fields. `setPregnant` opens a pause; `endPregnancy`
  // closes it (resume); `isPregnant` derives "currently paused" by asking
  // whether the most-recent pregnancy marker at-or-before `asOf` is a start.

  /** Declare a pregnancy — pauses the cycle. Defaults to now. */
  async setPregnant(at: number = Date.now()): Promise<CycleEvent> {
    return insertAt('pregnancy_start', null, at);
  },

  /**
   * Mark the pregnancy ended — by ANY path (birth / miscarriage /
   * termination). This is the resume trigger; the next period after it
   * restarts the cycle. Defaults to now.
   */
  async endPregnancy(at: number = Date.now()): Promise<CycleEvent> {
    return insertAt('pregnancy_end', null, at);
  },

  /**
   * Currently pregnant as of `asOf` (default now)? True iff the most recent
   * pregnancy marker at-or-before `asOf` is a `pregnancy_start` (i.e. it has
   * no later `pregnancy_end`). Ordered by occurred_at then rowid so two
   * markers stamped in the same millisecond resolve in insert order.
   */
  async isPregnant(asOf: number = Date.now()): Promise<boolean> {
    const rows = await sql.select<CycleEventRow>(
      `SELECT id, kind, data, occurred_at FROM cycle_events
       WHERE (kind = 'pregnancy_start' OR kind = 'pregnancy_end')
         AND occurred_at <= ?
       ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
      [asOf],
    );
    return rows.length > 0 && rows[0]!.kind === 'pregnancy_start';
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM cycle_events WHERE id = ?`, [id]);
  },
};

/** Insert with an explicit occurredAt (pregnancy markers default to now but
 *  stay overridable for tests + back-dated capture). */
async function insertAt(
  kind: CycleEventKind,
  data: Record<string, unknown> | null,
  at: number,
): Promise<CycleEvent> {
  const id = newId('c_');
  const encoded = data ? JSON.stringify(data) : null;
  await sql.execute(
    `INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)`,
    [id, kind, encoded, at],
  );
  return {
    id,
    kind,
    symptom: (data?.symptom as string | undefined) ?? null,
    intensity: (data?.intensity as BleedingIntensity | undefined) ?? null,
    occurredAt: at,
  };
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// The cycle's natural cadence anchor is period-start → period-start. The
// `current()` derivation reads just the most recent start, but a full
// stream of starts gives us the user's median cycle length once enough
// rows accumulate.
//
// Per the box's tone: this surface stays calm — no predictions, no
// warnings, no risk scoring. The cadence line just observes what's
// happened. Silent until 'observed' confidence (≥ 2 starts on file).

export const cycleCadence = {
  /**
   * Cadence over every period-start event. Returns 'low-data' until at
   * least two starts are logged — silent rather than wrong.
   */
  async getPeriodCadence(): Promise<CadenceEstimate> {
    const rows = await sql.select<CycleEventRow>(
      `SELECT id, kind, data, occurred_at
       FROM cycle_events
       WHERE kind = 'period_start'
       ORDER BY occurred_at ASC`,
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.occurred_at, label: 'period_start' })),
    );
  },
};
