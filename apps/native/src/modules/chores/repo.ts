/**
 * Chores module · repository.
 *
 * Thin typed wrapper over the SQLite layer. All SQL strings live here —
 * handlers and screens stay query-agnostic. Mirrors grocery/admin repos.
 *
 * Two object families:
 *   - `chores`  — the registry (add / mark-done / list / remove). A chore name
 *                 dedupes to one registry row (UNIQUE index on `name`).
 *   - `cadence` — read-only adapter over `chore_completion` → CadenceEstimate,
 *                 the same shape grocery uses for "you buy X every ~N days".
 *
 * Conventions:
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `done` is stored as 0/1.
 *   - Names are normalised by the caller via normaliseChoreName; the repo
 *     normalises defensively so handler + screen can both call in.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import { newId } from '../../storage/id';
import {
  normaliseChoreName,
  type Chore,
  type ChoreKind,
} from './types';

interface ChoreRow {
  id: string;
  name: string;
  kind: string;
  cadence_days: number | null;
  last_done_at: number | null;
  done: number;
  created_at: number;
  [col: string]: unknown;
}

interface CompletionRow {
  id: string;
  name: string;
  completed_at: number;
  [col: string]: unknown;
}

// ─── chores registry ────────────────────────────────────────────────────────

export const chores = {
  /** Most-recent-first across all kinds. The UI buckets locally. */
  async list(): Promise<Chore[]> {
    const rows = await sql.select<ChoreRow>(
      `SELECT id, name, kind, cadence_days, last_done_at, done, created_at
       FROM chores
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToChore);
  },

  /** One chore by normalised name, or null. */
  async getByName(name: string): Promise<Chore | null> {
    const key = normaliseChoreName(name);
    const rows = await sql.select<ChoreRow>(
      `SELECT id, name, kind, cadence_days, last_done_at, done, created_at
       FROM chores WHERE name = ? LIMIT 1`,
      [key],
    );
    return rows.length > 0 ? rowToChore(rows[0]!) : null;
  },

  /**
   * Upsert a chore into the registry, deduped by normalised name. A second
   * "vacuum" doesn't create a second row — it refreshes the existing one. When
   * an existing one_off is re-stated as recurring (or a cadence changes) we
   * upgrade the kind + cadence in place; we never silently downgrade a
   * recurring chore to a one-off (a future "need to vacuum" shouldn't wipe a
   * learned weekly cadence). Re-adding also un-completes a previously-done
   * one-off so it returns to the active list.
   */
  async upsert(input: {
    name: string;
    kind: ChoreKind;
    cadenceDays?: number | null;
  }): Promise<Chore> {
    const name = normaliseChoreName(input.name);
    const now = Date.now();
    const existing = await chores.getByName(name);

    if (existing) {
      // Promote to recurring (or update cadence) when the new statement is
      // recurring; otherwise keep the stronger existing kind. Always clear a
      // stale `done` so re-stating brings it back to the active list.
      const nextKind: ChoreKind =
        input.kind === 'recurring' || existing.kind === 'recurring'
          ? 'recurring'
          : 'one_off';
      const nextCadence =
        input.kind === 'recurring'
          ? input.cadenceDays ?? existing.cadenceDays ?? null
          : existing.cadenceDays;
      await sql.execute(
        `UPDATE chores SET kind = ?, cadence_days = ?, done = 0 WHERE id = ?`,
        [nextKind, nextCadence, existing.id],
      );
      return {
        ...existing,
        kind: nextKind,
        cadenceDays: nextCadence,
        done: false,
      };
    }

    const id = newId('c_');
    const cadenceDays = input.kind === 'recurring' ? input.cadenceDays ?? null : null;
    await sql.execute(
      `INSERT INTO chores (id, name, kind, cadence_days, last_done_at, done, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?)`,
      [id, name, input.kind, cadenceDays, now],
    );
    return {
      id,
      name,
      kind: input.kind,
      cadenceDays,
      lastDoneAt: null,
      done: false,
      createdAt: now,
    };
  },

  /**
   * Log a chore as DONE. Appends a completion event (the cadence signal) and:
   *   - recurring chore → stamps `last_done_at` and resets the clock (stays
   *     on the registry, leaves done = 0).
   *   - one-off chore   → marks `done = 1` (drops from the active to-do list).
   *
   * The chore is created on the fly when the name isn't in the registry yet
   * ("vacuumed" with no prior "need to vacuum") — it lands as a one_off marked
   * done, so the completion is still recorded + surfaced in "recent".
   *
   * Returns the resulting chore row.
   */
  async markDone(name: string, ts: number = Date.now()): Promise<Chore> {
    const key = normaliseChoreName(name);
    await logCompletion(key, ts);

    let chore = await chores.getByName(key);
    if (!chore) {
      // First time we hear about this chore is a completion — register it as a
      // done one-off so the completion isn't orphaned.
      const id = newId('c_');
      await sql.execute(
        `INSERT INTO chores (id, name, kind, cadence_days, last_done_at, done, created_at)
         VALUES (?, ?, 'one_off', NULL, ?, 1, ?)`,
        [id, key, ts, ts],
      );
      return {
        id,
        name: key,
        kind: 'one_off',
        cadenceDays: null,
        lastDoneAt: ts,
        done: true,
        createdAt: ts,
      };
    }

    if (chore.kind === 'recurring') {
      await sql.execute(
        `UPDATE chores SET last_done_at = ?, done = 0 WHERE id = ?`,
        [ts, chore.id],
      );
      return { ...chore, lastDoneAt: ts, done: false };
    }

    await sql.execute(
      `UPDATE chores SET last_done_at = ?, done = 1 WHERE id = ?`,
      [ts, chore.id],
    );
    return { ...chore, lastDoneAt: ts, done: true };
  },

  /**
   * Toggle a one-off chore's `done` from the box UI. Recurring chores ignore
   * the un-done direction (they reset via markDone instead). When toggling a
   * one-off to done we also append a completion + stamp last_done_at so the
   * "recent" section and any cadence read stay honest.
   */
  async setDone(id: string, done: boolean): Promise<void> {
    const rows = await sql.select<ChoreRow>(
      `SELECT id, name, kind, cadence_days, last_done_at, done, created_at
       FROM chores WHERE id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return;
    const chore = rowToChore(rows[0]!);
    const now = Date.now();
    if (done) {
      await logCompletion(chore.name, now);
      await sql.execute(
        `UPDATE chores SET done = 1, last_done_at = ? WHERE id = ?`,
        [now, id],
      );
    } else {
      await sql.execute(`UPDATE chores SET done = 0 WHERE id = ?`, [id]);
    }
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM chores WHERE id = ?`, [id]);
  },

  /**
   * Recurring chores that are currently DUE — last done at least `cadenceDays`
   * ago (or never done). `nowMs` injectable so tests can pin time. Sorted by
   * how overdue they are (most overdue first).
   */
  async listDueRecurring(nowMs: number = Date.now()): Promise<Chore[]> {
    const rows = await sql.select<ChoreRow>(
      `SELECT id, name, kind, cadence_days, last_done_at, done, created_at
       FROM chores
       WHERE kind = 'recurring' AND cadence_days IS NOT NULL`,
    );
    const due = rows
      .map(rowToChore)
      .filter((c) => isChoreDue(c, nowMs))
      .sort((a, b) => dueSlackMs(a, nowMs) - dueSlackMs(b, nowMs));
    return due;
  },

  /** Open one-off chores (done = 0) for the box "to do" section + /todo. */
  async listOpenOneOff(): Promise<Chore[]> {
    const rows = await sql.select<ChoreRow>(
      `SELECT id, name, kind, cadence_days, last_done_at, done, created_at
       FROM chores
       WHERE kind = 'one_off' AND done = 0
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToChore);
  },
};

// ─── completion log ─────────────────────────────────────────────────────────

async function logCompletion(name: string, ts: number): Promise<void> {
  await sql.execute(
    `INSERT INTO chore_completion (id, name, completed_at) VALUES (?, ?, ?)`,
    [newId('c_'), normaliseChoreName(name), ts],
  );
}

// ─── due math ───────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Negative when not yet due; ≥0 (overdue, in ms) when due. */
function dueSlackMs(c: Chore, nowMs: number): number {
  if (c.cadenceDays == null) return Number.NEGATIVE_INFINITY;
  // Never done → due now (treat as maximally overdue so it surfaces).
  if (c.lastDoneAt == null) return Number.POSITIVE_INFINITY;
  const nextDue = c.lastDoneAt + c.cadenceDays * DAY_MS;
  return nowMs - nextDue;
}

/** A recurring chore is due once it's been at least `cadenceDays` since last done. */
export function isChoreDue(c: Chore, nowMs: number = Date.now()): boolean {
  if (c.kind !== 'recurring' || c.cadenceDays == null) return false;
  return dueSlackMs(c, nowMs) >= 0;
}

// ─── row mapper ─────────────────────────────────────────────────────────────

function rowToChore(r: ChoreRow): Chore {
  return {
    id: r.id,
    name: r.name,
    kind: (r.kind as ChoreKind) === 'recurring' ? 'recurring' : 'one_off',
    cadenceDays: r.cadence_days ?? null,
    lastDoneAt: r.last_done_at ?? null,
    done: r.done === 1,
    createdAt: r.created_at,
  };
}

// ─── cadence ────────────────────────────────────────────────────────────────
//
// Every completion appends a row to `chore_completion`. The local cadence
// layer reads that log and turns the per-name timestamp stream into a
// CadenceEstimate — "you usually do this chore every ~N days". Identical
// shape to grocery's purchase-log cadence.

export const cadence = {
  /**
   * Cadence estimate for one chore by normalised name. Returns a 'low-data'
   * estimate when fewer than 2 completions have been logged.
   */
  async getCadenceFor(name: string): Promise<CadenceEstimate> {
    const key = normaliseChoreName(name);
    const rows = await sql.select<CompletionRow>(
      `SELECT id, name, completed_at
       FROM chore_completion
       WHERE name = ?
       ORDER BY completed_at ASC`,
      [key],
    );
    return computeCadence(rows.map((r) => ({ ts: r.completed_at, label: r.name })));
  },
};
