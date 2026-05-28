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

import { sql } from '../../storage';
import {
  normaliseSymptom,
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

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToEvent(r: CycleEventRow): CycleEvent {
  let symptom: string | null = null;
  if (r.data) {
    try {
      const parsed = JSON.parse(r.data) as { symptom?: string };
      symptom = parsed.symptom ?? null;
    } catch {
      symptom = null;
    }
  }
  return {
    id: r.id,
    kind: r.kind as CycleEventKind,
    symptom,
    occurredAt: r.occurred_at,
  };
}

async function insert(
  kind: CycleEventKind,
  data: Record<string, unknown> | null,
): Promise<CycleEvent> {
  const id = newId();
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
    occurredAt: now,
  };
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

    const daysSinceStart = Math.floor((Date.now() - startedAt) / (24 * 60 * 60 * 1000));
    return { startedAt, daysSinceStart, bleeding };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM cycle_events WHERE id = ?`, [id]);
  },
};
