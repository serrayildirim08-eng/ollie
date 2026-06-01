/**
 * Habits module · repository.
 *
 * Thin typed wrapper over SQLite. All habit SQL lives here; the handler and
 * UI never touch sql.* directly.
 *
 * No streaks, ever (mandate: feedback-ollie-no-streaks). This repo records
 * completions with timestamps and nothing more — no consecutive-day run, no
 * "streak broke" event. Cadence ("usually every 3 days") is the only rhythm
 * signal, and it never frames a miss as failure.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import {
  normaliseHabitName,
  type Habit,
  type HabitCompletion,
  type HabitEvent,
  type HabitEventKind,
  type HabitRow,
} from './types';
// NOTE: no streak math imported/defined — see the no-streaks note above.

// SQL row shapes — `[col: string]: unknown` satisfies the ShimRow constraint
// on sql.select<T> while still letting the typed columns drive autocomplete.
interface HabitRegistryRow {
  id: string;
  name: string;
  created_at: number;
  [col: string]: unknown;
}

interface HabitCompletionRow {
  id: string;
  habit_id: string;
  completed_at: number;
  [col: string]: unknown;
}

interface HabitEventRow {
  id: string;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── registry ─────────────────────────────────────────────────────────────

export const registry = {
  async list(): Promise<Habit[]> {
    const rows = await sql.select<HabitRegistryRow>(
      `SELECT id, name, created_at
       FROM habits_registry
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToHabit);
  },

  /** Lookup by normalised name; returns null if not registered yet. */
  async findByName(name: string): Promise<Habit | null> {
    const n = normaliseHabitName(name);
    const rows = await sql.select<HabitRegistryRow>(
      `SELECT id, name, created_at FROM habits_registry WHERE name = ? LIMIT 1`,
      [n],
    );
    if (rows.length === 0) return null;
    return rowToHabit(rows[0]!);
  },

  /** Insert-if-missing. Returns the row (existing or just created). */
  async ensure(name: string): Promise<Habit> {
    const existing = await registry.findByName(name);
    if (existing) return existing;
    const habit: Habit = {
      id: newId(),
      name: normaliseHabitName(name),
      createdAt: Date.now(),
    };
    await sql.execute(
      `INSERT INTO habits_registry (id, name, created_at) VALUES (?, ?, ?)`,
      [habit.id, habit.name, habit.createdAt],
    );
    return habit;
  },

  async remove(id: string): Promise<void> {
    // Cascade manually — SQLite FKs aren't enforced unless PRAGMA is set,
    // and we'd rather not assume. Completions deleted, events untouched
    // (breaks reference by name and are historical — keep them).
    await sql.execute(`DELETE FROM habits_completions WHERE habit_id = ?`, [id]);
    await sql.execute(`DELETE FROM habits_registry WHERE id = ?`, [id]);
  },
};

// ─── completions ──────────────────────────────────────────────────────────

export const completions = {
  /** Log one completion. Caller has already ensured the habit exists. */
  async add(habitId: string, at: number = Date.now()): Promise<HabitCompletion> {
    const c: HabitCompletion = { id: newId(), habitId, completedAt: at };
    await sql.execute(
      `INSERT INTO habits_completions (id, habit_id, completed_at)
       VALUES (?, ?, ?)`,
      [c.id, c.habitId, c.completedAt],
    );
    return c;
  },

  /** All completions for a habit, newest first. Bounded to last 400 days. */
  async listForHabit(habitId: string): Promise<HabitCompletion[]> {
    const cutoff = Date.now() - 400 * 24 * 60 * 60 * 1000;
    const rows = await sql.select<HabitCompletionRow>(
      `SELECT id, habit_id, completed_at
       FROM habits_completions
       WHERE habit_id = ? AND completed_at >= ?
       ORDER BY completed_at DESC`,
      [habitId, cutoff],
    );
    return rows.map(rowToCompletion);
  },

  /** Has the habit been completed at least once today (local day)? */
  async completedToday(habitId: string): Promise<boolean> {
    const start = startOfLocalDay(Date.now());
    const rows = await sql.select<HabitCompletionRow>(
      `SELECT id, habit_id, completed_at
       FROM habits_completions
       WHERE habit_id = ? AND completed_at >= ?
       LIMIT 1`,
      [habitId, start],
    );
    return rows.length > 0;
  },

  /** Delete one completion row by id — backs the dump-card undo path. */
  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM habits_completions WHERE id = ?`, [id]);
  },
};

// ─── events (identity statements) ─────────────────────────────────────────

export const events = {
  async logIdentity(text: string): Promise<HabitEvent> {
    return insertEvent('identity', { text: text.trim() });
  },

  /** Recent events of one kind, newest first. Default limit 50. */
  async listRecent(kind: HabitEventKind, limit = 50): Promise<HabitEvent[]> {
    const rows = await sql.select<HabitEventRow>(
      `SELECT id, kind, data, logged_at
       FROM habits_events
       WHERE kind = ?
       ORDER BY logged_at DESC
       LIMIT ?`,
      [kind, limit],
    );
    return rows.map(rowToEvent);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM habits_events WHERE id = ?`, [id]);
  },
};

async function insertEvent(
  kind: HabitEventKind,
  payload: Record<string, unknown>,
): Promise<HabitEvent> {
  const e: HabitEvent = {
    id: newId(),
    kind,
    data: JSON.stringify(payload),
    loggedAt: Date.now(),
  };
  await sql.execute(
    `INSERT INTO habits_events (id, kind, data, logged_at) VALUES (?, ?, ?, ?)`,
    [e.id, e.kind, e.data, e.loggedAt],
  );
  return e;
}

// ─── UI-shaped composite query ────────────────────────────────────────────

/**
 * Returns one row per registered habit, with today's status pre-computed.
 * The screen renders this list directly. No streak — see the no-streaks note.
 */
export async function listHabitRows(): Promise<HabitRow[]> {
  const habits = await registry.list();
  const out: HabitRow[] = [];
  for (const habit of habits) {
    const comps = await completions.listForHabit(habit.id);
    out.push({
      habit,
      completedToday: comps.length > 0 && isToday(comps[0]!.completedAt),
      lastCompletedAt: comps[0]?.completedAt ?? null,
    });
  }
  return out;
}

// ─── local-day helpers ──────────────────────────────────────────────────────

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isToday(ms: number): boolean {
  return startOfLocalDay(ms) === startOfLocalDay(Date.now());
}

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToHabit(r: HabitRegistryRow): Habit {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

function rowToCompletion(r: HabitCompletionRow): HabitCompletion {
  return { id: r.id, habitId: r.habit_id, completedAt: r.completed_at };
}

function rowToEvent(r: HabitEventRow): HabitEvent {
  return {
    id: r.id,
    kind: r.kind as HabitEventKind,
    data: r.data,
    loggedAt: r.logged_at,
  };
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Habit completions are append-only with `completed_at` — cadence reads
// straight off `habits_completions`. Useful for "you usually do yoga
// every 3 days; last one was 4 days ago" style surfaces.

export const cadence = {
  /**
   * Cadence for one habit by name. Looks the habit up in the registry
   * and computes cadence across its completion log.
   *
   * Returns a 'low-data' estimate when the habit isn't registered or has
   * fewer than 2 completions on file.
   */
  async getCompletionCadenceFor(habitName: string): Promise<CadenceEstimate> {
    const habit = await registry.findByName(habitName);
    if (!habit) return computeCadence([]);
    return cadence.getCompletionCadenceForId(habit.id);
  },

  /** Same as `getCompletionCadenceFor`, but keyed by habit id (cheaper). */
  async getCompletionCadenceForId(habitId: string): Promise<CadenceEstimate> {
    const cutoff = Date.now() - 400 * 24 * 60 * 60 * 1000;
    const rows = await sql.select<HabitCompletionRow>(
      `SELECT id, habit_id, completed_at
       FROM habits_completions
       WHERE habit_id = ? AND completed_at >= ?
       ORDER BY completed_at ASC`,
      [habitId, cutoff],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.completed_at, label: r.habit_id })),
    );
  },
};
