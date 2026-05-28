/**
 * Admin module · repository.
 *
 * Thin typed wrapper over the SQLite layer. All SQL strings live here —
 * handlers and screens stay query-agnostic.
 *
 * Two object families:
 *   - `tasks`    — generic admin rows (todo / phone / appointment /
 *                  paperwork / decision), classified by `kind`.
 *   - `renewals` — passport / license / lease / insurance reminders,
 *                  sorted by `due_date` ASC (soonest first), then
 *                  `added_at` DESC for the no-date tail.
 *
 * Conventions:
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `done` is stored as 0/1.
 *   - `data` is a JSON envelope so we can add kind-specific fields
 *     without migrating the table.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import type { AdminRenewal, AdminTask, AdminTaskData, AdminTaskKind } from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface TaskRow {
  id: string;
  kind: string;
  text: string;
  data: string | null;
  done: number;
  created_at: number;
  [col: string]: unknown;
}

interface RenewalRow {
  id: string;
  renewal_type: string;
  due_date: string | null;
  added_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── tasks ────────────────────────────────────────────────────────────────

export const tasks = {
  /** Most-recent first across all kinds. UI buckets by kind locally. */
  async list(): Promise<AdminTask[]> {
    const rows = await sql.select<TaskRow>(
      `SELECT id, kind, text, data, done, created_at
       FROM admin_tasks
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToTask);
  },

  /**
   * Add a row. Each call is a fresh row — admin rows have no natural dedupe
   * key (two "call dentist" entries are legitimate if the first was missed).
   */
  async add(input: { kind: AdminTaskKind; text: string; data?: AdminTaskData }): Promise<AdminTask> {
    const id = newId();
    const now = Date.now();
    const data: AdminTaskData = input.data ?? ({ kind: input.kind } as AdminTaskData);
    await sql.execute(
      `INSERT INTO admin_tasks (id, kind, text, data, done, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [id, input.kind, input.text, JSON.stringify(data), now],
    );
    return { id, kind: input.kind, text: input.text, data, done: false, createdAt: now };
  },

  async setDone(id: string, done: boolean): Promise<void> {
    await sql.execute(
      `UPDATE admin_tasks SET done = ? WHERE id = ?`,
      [done ? 1 : 0, id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM admin_tasks WHERE id = ?`, [id]);
  },
};

// ─── renewals ─────────────────────────────────────────────────────────────

export const renewals = {
  /**
   * Soonest-due first. Rows without a `due_date` fall to the bottom
   * ordered by `added_at` DESC (most recently logged first) — the screen
   * still wants to surface them, just below dated entries.
   */
  async list(): Promise<AdminRenewal[]> {
    const rows = await sql.select<RenewalRow>(
      `SELECT id, renewal_type, due_date, added_at
       FROM admin_renewals
       ORDER BY
         CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
         due_date ASC,
         added_at DESC`,
    );
    return rows.map(rowToRenewal);
  },

  /**
   * Add a renewal. Like tasks, renewals are not deduped — the user may
   * legitimately log "passport" twice (once for self, once for partner).
   */
  async add(input: { renewalType: string; dueDate?: string | null }): Promise<AdminRenewal> {
    const id = newId();
    const now = Date.now();
    const dueDate = input.dueDate ?? null;
    await sql.execute(
      `INSERT INTO admin_renewals (id, renewal_type, due_date, added_at)
       VALUES (?, ?, ?, ?)`,
      [id, input.renewalType, dueDate, now],
    );
    return { id, renewalType: input.renewalType, dueDate, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM admin_renewals WHERE id = ?`, [id]);
  },
};

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToTask(r: TaskRow): AdminTask {
  return {
    id: r.id,
    kind: r.kind as AdminTaskKind,
    text: r.text,
    data: parseTaskData(r.data, r.kind as AdminTaskKind),
    done: r.done === 1,
    createdAt: r.created_at,
  };
}

function rowToRenewal(r: RenewalRow): AdminRenewal {
  return {
    id: r.id,
    renewalType: r.renewal_type,
    dueDate: r.due_date,
    addedAt: r.added_at,
  };
}

/** Defensive JSON parse — falls back to a kind-only envelope on bad data. */
function parseTaskData(raw: string | null, kind: AdminTaskKind): AdminTaskData {
  if (!raw) return { kind } as AdminTaskData;
  try {
    const parsed = JSON.parse(raw) as AdminTaskData;
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) return parsed;
    return { kind } as AdminTaskData;
  } catch {
    return { kind } as AdminTaskData;
  }
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Admin renewals (passport / lease / insurance) are append-only with an
// `added_at` timestamp. Cadence keyed by `renewal_type` reveals how often
// the user logs the same renewal — usually annual+, so 'observed' is rare
// but honest when it triggers.
//
// Admin TASKS aren't included here: their text is free-form ("call dentist"
// / "scan tax docs") and the dedupe is by kind, not text — there's no
// natural recurrence key to cadence on without false grouping.

export const cadence = {
  /**
   * Cadence for one renewal type by string label ("passport", "lease").
   * Case-sensitive — we match the value the writer stored verbatim.
   */
  async getRenewalCadenceFor(renewalType: string): Promise<CadenceEstimate> {
    const key = renewalType.trim();
    if (!key) return computeCadence([]);
    const rows = await sql.select<RenewalRow>(
      `SELECT id, renewal_type, due_date, added_at
       FROM admin_renewals
       WHERE renewal_type = ?
       ORDER BY added_at ASC`,
      [key],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.added_at, label: key })),
    );
  },
};
