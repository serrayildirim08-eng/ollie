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

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { detectLowMood } from '@ollie/logic/goals';
import { sql } from '../../storage';
import { newId } from '../../storage/id';
import { migrateGoals } from './migrate';
import {
  ACTIVE_GOAL_CAP,
  DELETE_LOCK_MS,
  normaliseName,
  type DeleteGate,
  type Goal,
  type GoalDraft,
  type GoalEvent,
  type GoalEventKind,
  type GoalWithLatest,
} from './types';

/**
 * Thrown by `goals.create` when the active-goal cap is reached. The UI
 * catches `.code === 'goal_cap'` to show the "you already have 5 going"
 * surface instead of a generic failure (brief G2).
 */
export class GoalCapError extends Error {
  readonly code = 'goal_cap';
  constructor(message = 'active goal cap reached') {
    super(message);
    this.name = 'GoalCapError';
  }
}

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface GoalRow {
  id: string;
  name: string;
  why: string | null;
  target_date: number | null;
  obstacle: string | null;
  premortem: string | null;
  ulysses_contract: string | null;
  created_at: number;
  [col: string]: unknown;
}

interface MoodRow {
  id: string;
  text: string;
  logged_at: number;
  [col: string]: unknown;
}

/** Columns selected for every goals_registry read. */
const GOAL_COLS =
  'id, name, why, target_date, obstacle, premortem, ulysses_contract, created_at';

interface EventRow {
  id: string;
  goal_id: string | null;
  kind: string;
  text: string;
  logged_at: number;
  [col: string]: unknown;
}


// ─── goals registry ───────────────────────────────────────────────────────

export const goals = {
  async list(): Promise<Goal[]> {
    await migrateGoals();
    const rows = await sql.select<GoalRow>(
      `SELECT ${GOAL_COLS}
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
      `SELECT ${GOAL_COLS}
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
   *
   * Enforces the active-goal cap on the INSERT path only: matching an
   * existing goal (or backfilling its `why`) never adds an active goal so
   * it always passes. Creating a new one at `ACTIVE_GOAL_CAP` throws
   * `GoalCapError` — same gate as `create()` — so a dump can't slip past
   * the cap (and the required why/obstacle/premortem capture) by going
   * through `ensure`. Callers that prefer a soft fallback (notes landing in
   * the unassigned bucket) catch `GoalCapError`.
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
    const count = await goals.activeCount();
    if (count >= ACTIVE_GOAL_CAP) {
      throw new GoalCapError();
    }
    const id = newId('gl_');
    const now = Date.now();
    await sql.execute(
      `INSERT INTO goals_registry (id, name, why, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, n, why ?? null, now],
    );
    return {
      id,
      name: n,
      why: why ?? null,
      targetDate: null,
      obstacle: null,
      premortem: null,
      ulyssesContract: null,
      createdAt: now,
    };
  },

  /**
   * Explicit rich-create path (the create modal). Persists every captured
   * field. Enforces the active-goal cap BEFORE inserting — throws
   * `GoalCapError` (code 'goal_cap') when the registry is already at
   * `ACTIVE_GOAL_CAP` so the UI can show its own surface. Unlike `ensure`,
   * this is a deliberate user action so refusing is correct (brief G2).
   */
  async create(draft: GoalDraft): Promise<Goal> {
    // Self-migrate: the create modal calls repo directly (not via the dump
    // handler that normally runs migrateGoals), so the new columns may not
    // exist yet on this session's DB. Idempotent + promise-cached.
    await migrateGoals();
    const count = await goals.activeCount();
    if (count >= ACTIVE_GOAL_CAP) {
      throw new GoalCapError();
    }
    const id = newId('gl_');
    const now = Date.now();
    const name = normaliseName(draft.name);
    const why = draft.why ?? null;
    const targetDate = draft.targetDate ?? null;
    const obstacle = draft.obstacle ?? null;
    const premortem = draft.premortem ?? null;
    const ulyssesContract = draft.ulyssesContract ?? null;
    await sql.execute(
      `INSERT INTO goals_registry
         (id, name, why, target_date, obstacle, premortem, ulysses_contract, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, why, targetDate, obstacle, premortem, ulyssesContract, now],
    );
    return {
      id,
      name,
      why,
      targetDate,
      obstacle,
      premortem,
      ulyssesContract,
      createdAt: now,
    };
  },

  /** Count of active goals. All registry rows are active (no archive flag). */
  async activeCount(): Promise<number> {
    const rows = await sql.select<{ n: number; [col: string]: unknown }>(
      `SELECT COUNT(*) AS n FROM goals_registry`,
    );
    return rows.length > 0 ? Number(rows[0]!.n) : 0;
  },

  /**
   * Append a mood signal to the local mood log (brief G4). Fed by the dump
   * pipeline / mood capture so `canDelete` has something real to read.
   * Self-pruning: keeps only the last ~50 rows / 14 days so the table
   * stays tiny.
   */
  async recordMoodSignal(text: string): Promise<void> {
    await migrateGoals();
    const id = newId('gl_');
    const now = Date.now();
    await sql.execute(
      `INSERT INTO goals_mood_log (id, text, logged_at) VALUES (?, ?, ?)`,
      [id, text, now],
    );
    // Prune: drop anything older than 14 days, then keep only the newest 50.
    const cutoff = now - 14 * 24 * 60 * 60 * 1000;
    await sql.execute(`DELETE FROM goals_mood_log WHERE logged_at < ?`, [cutoff]);
    await sql.execute(
      `DELETE FROM goals_mood_log
       WHERE id NOT IN (
         SELECT id FROM goals_mood_log ORDER BY logged_at DESC LIMIT 50
       )`,
    );
  },

  /**
   * Low-mood delete gate (brief G4). Reads the last 14 days of the local
   * mood log, builds a DumpHistory, and asks `detectLowMood`. A signal
   * locks deletion for `DELETE_LOCK_MS`.
   *
   * FAILS OPEN: no mood data, no signal, or any error → { allowed: true }.
   * We never block a deletion just because the gate couldn't decide.
   */
  async canDelete(_id: string): Promise<DeleteGate> {
    try {
      await migrateGoals();
      const now = Date.now();
      const windowStart = now - 14 * 24 * 60 * 60 * 1000;
      const rows = await sql.select<MoodRow>(
        `SELECT id, text, logged_at
         FROM goals_mood_log
         WHERE logged_at >= ?
         ORDER BY logged_at DESC`,
        [windowStart],
      );
      if (rows.length === 0) return { allowed: true };
      const history = {
        dumps: rows.map((r) => ({ ts: r.logged_at, rawText: r.text })),
        now,
      };
      const signal = detectLowMood(history);
      if (signal) {
        return {
          allowed: false,
          lockedUntil: now + DELETE_LOCK_MS,
          reason: 'low_mood',
        };
      }
      return { allowed: true };
    } catch {
      // Fail open — never block deletion on a gate failure.
      return { allowed: true };
    }
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
    const id = newId('gl_');
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
    targetDate: r.target_date,
    obstacle: r.obstacle,
    premortem: r.premortem,
    ulyssesContract: r.ulysses_contract,
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

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Goal progress events are append-only with `logged_at` timestamps and a
// nullable `goal_id` foreign key. The useful cadence signal: "how often
// am I touching this goal?" — keyed by `goal_id`, filtered to the
// 'progress' kind so milestone / obstacle events don't dilute the rhythm.

export const cadence = {
  /**
   * Cadence of progress events for one goal. Returns a 'low-data' estimate
   * when fewer than 2 progress events exist for the goal.
   */
  async getProgressCadenceFor(goalId: string): Promise<CadenceEstimate> {
    const rows = await sql.select<EventRow>(
      `SELECT id, goal_id, kind, text, logged_at
       FROM goals_events
       WHERE goal_id = ? AND kind = 'progress'
       ORDER BY logged_at ASC`,
      [goalId],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.logged_at, label: goalId })),
    );
  },
};
