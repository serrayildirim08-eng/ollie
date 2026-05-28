/**
 * Goals module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for goals — handlers and screens call these
 * and stay query-agnostic.
 *
 * Conventions:
 *   - `goals.ensure(name, why?)` upserts the registry by normalised name
 *     and returns the row. Callers use this whenever the router mentions a
 *     goal so we never duplicate.
 *   - `events.add(...)` is append-only.
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `goalId` on events is nullable — when the router didn't name a goal
 *     the event still gets logged with `goal_id = NULL`.
 */

import { sql } from '../../storage';
import {
  normaliseName,
  type Goal,
  type GoalEvent,
  type GoalEventKind,
  type GoalWithLatest,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface GoalRow {
  id: string;
  name: string;
  why: string | null;
  created_at: number;
  [col: string]: unknown;
}

interface EventRow {
  id: string;
  goal_id: string | null;
  kind: string;
  text: string;
  logged_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `gl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── goals registry ───────────────────────────────────────────────────────

export const goals = {
  async list(): Promise<Goal[]> {
    const rows = await sql.select<GoalRow>(
      `SELECT id, name, why, created_at
       FROM goals_registry
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToGoal);
  },

  /**
   * List goals enriched with their latest `progress` event (for the UI).
   * Done in two queries rather than a JOIN to keep the row shape simple
   * and the SQL portable to the browser-shim.
   */
  async listWithLatest(): Promise<GoalWithLatest[]> {
    const all = await goals.list();
    if (all.length === 0) return [];
    const enriched: GoalWithLatest[] = [];
    for (const g of all) {
      const rows = await sql.select<EventRow>(
        `SELECT id, goal_id, kind, text, logged_at
         FROM goals_events
         WHERE goal_id = ? AND kind = 'progress'
         ORDER BY logged_at DESC
         LIMIT 1`,
        [g.id],
      );
      const latest = rows.length > 0 ? rowToEvent(rows[0]!) : null;
      enriched.push({ ...g, latestProgress: latest });
    }
    return enriched;
  },

  /** Look up by normalised name. Returns null if not found. */
  async findByName(name: string): Promise<Goal | null> {
    const n = normaliseName(name);
    const rows = await sql.select<GoalRow>(
      `SELECT id, name, why, created_at
       FROM goals_registry WHERE name = ? LIMIT 1`,
      [n],
    );
    if (rows.length === 0) return null;
    return rowToGoal(rows[0]!);
  },

  /**
   * Ensure a goal row exists for `name`. If absent, insert it; if present,
   * leave it alone but backfill `why` when we have one and the existing
   * row doesn't. Either way returns the canonical row.
   */
  async ensure(name: string, why?: string | null): Promise<Goal> {
    const n = normaliseName(name);
    const existing = await goals.findByName(n);
    if (existing) {
      if (why && !existing.why) {
        await sql.execute(
          `UPDATE goals_registry SET why = ? WHERE id = ?`,
          [why, existing.id],
        );
        return { ...existing, why };
      }
      return existing;
    }
    const id = newId();
    const now = Date.now();
    await sql.execute(
      `INSERT INTO goals_registry (id, name, why, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, n, why ?? null, now],
    );
    return { id, name: n, why: why ?? null, createdAt: now };
  },

  async remove(id: string): Promise<void> {
    // Detach events rather than cascade-delete — the user might've meant to
    // just retire the goal without losing the notes.
    await sql.execute(`UPDATE goals_events SET goal_id = NULL WHERE goal_id = ?`, [id]);
    await sql.execute(`DELETE FROM goals_registry WHERE id = ?`, [id]);
  },
};

// ─── events ───────────────────────────────────────────────────────────────

export const events = {
  async add(input: {
    goalId: string | null;
    kind: GoalEventKind;
    text: string;
  }): Promise<GoalEvent> {
    const id = newId();
    const now = Date.now();
    await sql.execute(
      `INSERT INTO goals_events (id, goal_id, kind, text, logged_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.goalId, input.kind, input.text, now],
    );
    return {
      id,
      goalId: input.goalId,
      kind: input.kind,
      text: input.text,
      loggedAt: now,
    };
  },

  /** Most-recent-first list of events of a given kind, across all goals. */
  async listByKind(kind: GoalEventKind, limit = 20): Promise<GoalEvent[]> {
    const rows = await sql.select<EventRow>(
      `SELECT id, goal_id, kind, text, logged_at
       FROM goals_events
       WHERE kind = ?
       ORDER BY logged_at DESC
       LIMIT ?`,
      [kind, limit],
    );
    return rows.map(rowToEvent);
  },

  /** Events that don't belong to any goal (router didn't name one). */
  async listUnassigned(limit = 20): Promise<GoalEvent[]> {
    const rows = await sql.select<EventRow>(
      `SELECT id, goal_id, kind, text, logged_at
       FROM goals_events
       WHERE goal_id IS NULL
       ORDER BY logged_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(rowToEvent);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM goals_events WHERE id = ?`, [id]);
  },
};

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    name: r.name,
    why: r.why,
    createdAt: r.created_at,
  };
}

function rowToEvent(r: EventRow): GoalEvent {
  return {
    id: r.id,
    goalId: r.goal_id,
    kind: r.kind as GoalEventKind,
    text: r.text,
    loggedAt: r.logged_at,
  };
}
