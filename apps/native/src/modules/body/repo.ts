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

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage/sqlite';
import { newId } from '../../storage/id';
import {
  normaliseLabel,
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
    const id = newId('b_');
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

// ─── profile ────────────────────────────────────────────────────────────────
//
// A single pinned row (`body_profile` id='me') holding one-time profile
// facts. Today that's just `age` (years), used to size the daily water
// target. Nullable throughout — the app works with no row at all.

interface BodyProfileRow {
  id: string;
  age: number | null;
  updated_at: number;
  [col: string]: unknown;
}

const PROFILE_ID = 'me';

export const profile = {
  /** The stored age in years, or null when never set. */
  async getAge(): Promise<number | null> {
    const rows = await sql.select<BodyProfileRow>(
      `SELECT id, age, updated_at FROM body_profile WHERE id = ? LIMIT 1`,
      [PROFILE_ID],
    );
    if (rows.length === 0) return null;
    const a = rows[0]!.age;
    return typeof a === 'number' && Number.isFinite(a) ? a : null;
  },

  /**
   * Set (or clear, with null) the user's age. Upserts the single profile
   * row so repeated edits never accumulate rows.
   */
  async setAge(age: number | null): Promise<void> {
    const clean =
      typeof age === 'number' && Number.isFinite(age) && age > 0
        ? Math.round(age)
        : null;
    await sql.execute(
      `INSERT INTO body_profile (id, age, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET age = excluded.age, updated_at = excluded.updated_at`,
      [PROFILE_ID, clean, Date.now()],
    );
  },
};

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Body events are append-only with `logged_at` timestamps, so cadence
// reads directly off the events log — no separate history table needed.
//
// Movement events carry a free-text activity in `data.label` ("yoga",
// "walk", "run", …). We filter by the normalised label so "Yoga" and
// "yoga " collapse into the same series. Other kinds (water, supplement,
// posture, hunger) are cadenced across all rows of that kind.

export const cadence = {
  /**
   * Cadence for one movement activity (e.g. "yoga", "walk"). Filters
   * `body_events` rows where `kind = 'movement'` and the normalised
   * `data.label` matches.
   */
  async getMovementCadenceFor(activity: string): Promise<CadenceEstimate> {
    const want = normaliseLabel(activity);
    if (!want) return computeCadence([]);
    const rows = await sql.select<BodyEventRow>(
      `SELECT id, kind, data, logged_at
       FROM body_events
       WHERE kind = 'movement'
       ORDER BY logged_at ASC`,
    );
    const series = rows
      .map((r) => {
        const label = normaliseLabel(extractLabel(r.data));
        return label === want ? { ts: r.logged_at, label } : null;
      })
      .filter((x): x is { ts: number; label: string } => x !== null);
    return computeCadence(series);
  },

  /** Cadence over every water row (each row = one glass-ish moment). */
  async getWaterCadence(): Promise<CadenceEstimate> {
    return cadenceForKind('water');
  },

  /** Cadence over every supplement row, all labels collapsed. */
  async getSupplementCadence(): Promise<CadenceEstimate> {
    return cadenceForKind('supplement');
  },
};

async function cadenceForKind(kind: BodyEventKind): Promise<CadenceEstimate> {
  const rows = await sql.select<BodyEventRow>(
    `SELECT id, kind, data, logged_at
     FROM body_events
     WHERE kind = ?
     ORDER BY logged_at ASC`,
    [kind],
  );
  return computeCadence(
    rows.map((r) => ({ ts: r.logged_at, label: kind })),
  );
}

function extractLabel(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>)['label'];
      if (typeof v === 'string') return v;
    }
  } catch {
    // corrupted row — return empty so it never matches a real activity
  }
  return '';
}
