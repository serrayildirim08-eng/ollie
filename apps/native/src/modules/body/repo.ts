/**
 * Body module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for body — handlers and screens call these
 * and stay query-agnostic.
 *
 * Conventions:
 *   - Every write is append-only (no upsert; the log is the truth).
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `data` is stored as JSON text and parsed on read.
 */

import { sql } from '../../storage/sqlite';
import {
  startOfTodayMs,
  type BodyEvent,
  type BodyEventKind,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface BodyEventRow {
  id: string;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

interface SumRow {
  total: number | null;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through — corrupted row, surface as empty payload
  }
  return {};
}

function rowToEvent(r: BodyEventRow): BodyEvent {
  return {
    id: r.id,
    kind: r.kind as BodyEventKind,
    data: safeParse(r.data),
    loggedAt: r.logged_at,
  };
}

export const events = {
  /** Most-recent-first list of every logged body event. */
  async list(): Promise<BodyEvent[]> {
    const rows = await sql.select<BodyEventRow>(
      `SELECT id, kind, data, logged_at
       FROM body_events
       ORDER BY logged_at DESC`,
    );
    return rows.map(rowToEvent);
  },

  /**
   * Append a new event row. `kind` is constrained to BodyEventKind; the
   * data payload is whatever the handler wants to persist for that kind.
   */
  async add(input: {
    kind: BodyEventKind;
    data?: Record<string, unknown>;
  }): Promise<BodyEvent> {
    const id = newId();
    const now = Date.now();
    const payload = input.data ?? {};
    await sql.execute(
      `INSERT INTO body_events (id, kind, data, logged_at)
       VALUES (?, ?, ?, ?)`,
      [id, input.kind, JSON.stringify(payload), now],
    );
    return { id, kind: input.kind, data: payload, loggedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM body_events WHERE id = ?`, [id]);
  },

  /**
   * Sum of `data.amountMl` for today's water rows. Done in SQL via
   * `json_extract` where the driver supports it; falls back to JS
   * aggregation when json1 isn't available (or the shim is in play).
   */
  async waterTotalToday(now: number = Date.now()): Promise<number> {
    const since = startOfTodayMs(now);
    // json_extract is shipped with sqlite by default in modern builds,
    // but we still guard against the shim returning [] silently.
    try {
      const rows = await sql.select<SumRow>(
        `SELECT COALESCE(SUM(CAST(json_extract(data, '$.amountMl') AS REAL)), 0) AS total
         FROM body_events
         WHERE kind = 'water' AND logged_at >= ?`,
        [since],
      );
      if (rows.length > 0 && typeof rows[0]!.total === 'number') {
        return Math.round(rows[0]!.total ?? 0);
      }
    } catch {
      // json_extract missing — fall through to JS aggregation
    }
    const rows = await sql.select<BodyEventRow>(
      `SELECT id, kind, data, logged_at
       FROM body_events
       WHERE kind = 'water' AND logged_at >= ?`,
      [since],
    );
    return rows.reduce((acc, r) => {
      const v = safeParse(r.data)['amountMl'];
      return typeof v === 'number' && Number.isFinite(v) ? acc + v : acc;
    }, 0);
  },

  /** Most recent movement event, if any (used for "today" surface). */
  async lastMovement(): Promise<BodyEvent | null> {
    const rows = await sql.select<BodyEventRow>(
      `SELECT id, kind, data, logged_at
       FROM body_events
       WHERE kind = 'movement'
       ORDER BY logged_at DESC
       LIMIT 1`,
    );
    return rows.length > 0 ? rowToEvent(rows[0]!) : null;
  },
};
