/**
 * Mood module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for mood — handlers and screens call these
 * and stay query-agnostic.
 *
 * Conventions:
 *   - Every write is append-only (no upsert; the log is the truth).
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `data` is stored as JSON text and parsed on read.
 */

import { sql } from '../../storage/sqlite';
import { newId } from '../../storage/id';
import { startOfTodayMs, type MoodEvent, type MoodEventKind } from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface MoodEventRow {
  id: string;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

interface CountRow {
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

function rowToEvent(r: MoodEventRow): MoodEvent {
  return {
    id: r.id,
    kind: r.kind as MoodEventKind,
    data: safeParse(r.data),
    loggedAt: r.logged_at,
  };
}

export const events = {
  /** Most-recent-first list of every logged mood event. */
  async list(): Promise<MoodEvent[]> {
    const rows = await sql.select<MoodEventRow>(
      `SELECT id, kind, data, logged_at
       FROM mood_events
       ORDER BY logged_at DESC`,
    );
    return rows.map(rowToEvent);
  },

  /**
   * Append a new event row. `kind` is constrained to MoodEventKind; the
   * data payload is whatever the handler wants to persist for that kind.
   */
  async add(input: {
    kind: MoodEventKind;
    data?: Record<string, unknown>;
  }): Promise<MoodEvent> {
    const id = newId('m_');
    const now = Date.now();
    const payload = input.data ?? {};
    await sql.execute(
      `INSERT INTO mood_events (id, kind, data, logged_at)
       VALUES (?, ?, ?, ?)`,
      [id, input.kind, JSON.stringify(payload), now],
    );
    return { id, kind: input.kind, data: payload, loggedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM mood_events WHERE id = ?`, [id]);
  },

  /** Count of every mood event logged today (all kinds). */
  async todayCount(now: number = Date.now()): Promise<number> {
    const since = startOfTodayMs(now);
    const rows = await sql.select<CountRow>(
      `SELECT COUNT(*) AS total
       FROM mood_events
       WHERE logged_at >= ?`,
      [since],
    );
    const total = rows.length > 0 ? rows[0]!.total : 0;
    return typeof total === 'number' && Number.isFinite(total) ? total : 0;
  },

  /** Most-recent-first list of every event of one kind. */
  async recentByKind(kind: MoodEventKind): Promise<MoodEvent[]> {
    const rows = await sql.select<MoodEventRow>(
      `SELECT id, kind, data, logged_at
       FROM mood_events
       WHERE kind = ?
       ORDER BY logged_at DESC`,
      [kind],
    );
    return rows.map(rowToEvent);
  },

  /**
   * Single most-recent mood-OR-energy event, or null when none logged.
   *
   * The Health room's read-only "energy" tile is the mood log's one real
   * consumer (it gives the dead mood log a surface). Energy is the primary
   * signal; if no energy has ever been logged we fall back to the latest
   * mood reading so the tile still reflects how the person is doing. Pure
   * read — no write, no mood screen.
   */
  async latestEnergyOrMood(): Promise<MoodEvent | null> {
    const rows = await sql.select<MoodEventRow>(
      `SELECT id, kind, data, logged_at
       FROM mood_events
       WHERE kind = 'energy' OR kind = 'mood'
       ORDER BY logged_at DESC
       LIMIT 1`,
    );
    return rows.length > 0 ? rowToEvent(rows[0]!) : null;
  },
};
