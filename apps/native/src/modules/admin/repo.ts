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
import { newId } from '../../storage/id';
import type { AdminRenewal, AdminTask, AdminTaskData, AdminTaskKind, BallState, RecurringDecisionRow } from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface TaskRow {
  id: string;
  kind: string;
  text: string;
  data: string | null;
  done: number;
  due_date: string | null;
  ball_state: string | null;
  last_transition_at: number | null;
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


// ─── tasks ────────────────────────────────────────────────────────────────

export const tasks = {
  /** Most-recent first across all kinds. UI buckets by kind locally. */
  async list(): Promise<AdminTask[]> {
    const rows = await sql.select<TaskRow>(
      `SELECT id, kind, text, data, done, due_date, ball_state, last_transition_at, created_at
       FROM admin_tasks
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToTask);
  },

  /**
   * Add a row. Each call is a fresh row — admin rows have no natural dedupe
   * key (two "call dentist" entries are legitimate if the first was missed).
   * `dueDate` (ISO yyyy-mm-dd) is optional; null when the router saw no date.
   */
  async add(input: {
    kind: AdminTaskKind;
    text: string;
    data?: AdminTaskData;
    dueDate?: string | null;
    ballState?: BallState;
  }): Promise<AdminTask> {
    const id = newId('a_');
    const now = Date.now();
    const data: AdminTaskData = input.data ?? ({ kind: input.kind } as AdminTaskData);
    const dueDate = input.dueDate ?? null;
    const ballState: BallState = input.ballState ?? 'mine';
    await sql.execute(
      `INSERT INTO admin_tasks (id, kind, text, data, done, due_date, ball_state, last_transition_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [id, input.kind, input.text, JSON.stringify(data), dueDate, ballState, now, now],
    );
    return {
      id,
      kind: input.kind,
      text: input.text,
      data,
      done: false,
      dueDate,
      ballState,
      lastTransitionAt: now,
      createdAt: now,
    };
  },

  async setDone(id: string, done: boolean): Promise<void> {
    // Completing a task moves the ball to `done`; un-completing returns it to
    // `mine`. Either way we stamp last_transition_at (audit #7).
    await sql.execute(
      `UPDATE admin_tasks SET done = ?, ball_state = ?, last_transition_at = ? WHERE id = ?`,
      [done ? 1 : 0, done ? 'done' : 'mine', Date.now(), id],
    );
  },

  /** Move a task's ball_state (mine | waiting | done) and stamp the transition. */
  async setBallState(id: string, ballState: BallState): Promise<void> {
    await sql.execute(
      `UPDATE admin_tasks SET ball_state = ?, last_transition_at = ?, done = ? WHERE id = ?`,
      [ballState, Date.now(), ballState === 'done' ? 1 : 0, id],
    );
  },

  /**
   * Set a task's due date (ISO yyyy-mm-dd or null). Used by the brain's
   * defer_tasks offer to push a non-urgent, due-today task to tomorrow. Only
   * touches `due_date` — never `ball_state` / `done` / `last_transition_at` —
   * so deferring a date doesn't move the ball or alter completion.
   */
  async setDueDate(id: string, dueDate: string | null): Promise<void> {
    await sql.execute(
      `UPDATE admin_tasks SET due_date = ? WHERE id = ?`,
      [dueDate, id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM admin_tasks WHERE id = ?`, [id]);
  },

  /**
   * Open admin tasks for the cross-module /todo aggregate. Filters out
   * `done = 1` rows; sorted most-recent-first so the TodoScreen can apply
   * its own date bucketing.
   */
  async listOpen(): Promise<AdminTask[]> {
    const rows = await sql.select<TaskRow>(
      `SELECT id, kind, text, data, done, due_date, ball_state, last_transition_at, created_at
       FROM admin_tasks
       WHERE done = 0
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToTask);
  },

  /** Mark a task complete. Moves the ball to `done` + stamps the transition. */
  async markComplete(id: string): Promise<void> {
    await sql.execute(
      `UPDATE admin_tasks SET done = 1, ball_state = 'done', last_transition_at = ? WHERE id = ?`,
      [Date.now(), id],
    );
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
    const id = newId('a_');
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

  /**
   * Renewals open against today's date. `due_date IS NULL` rows are
   * included — the /todo screen wants them in the "no date" tail. Future
   * dates included; expired (past) rows excluded so the list doesn't
   * carry stale debris.
   */
  async listOpen(today: string = isoToday()): Promise<AdminRenewal[]> {
    const rows = await sql.select<RenewalRow>(
      `SELECT id, renewal_type, due_date, added_at
       FROM admin_renewals
       WHERE due_date IS NULL OR due_date >= ?
       ORDER BY
         CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
         due_date ASC,
         added_at DESC`,
      [today],
    );
    return rows.map(rowToRenewal);
  },

  /** Renewals don't have a completed_at column — "done early" deletes
   *  the row. The /todo X collapses to remove(). */
  async markComplete(id: string): Promise<void> {
    await sql.execute(`DELETE FROM admin_renewals WHERE id = ?`, [id]);
  },
};

/** Local ISO-yyyy-mm-dd for today; injectable via the param so tests can
 *  pin time. Kept local because admin is the only consumer. */
function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToTask(r: TaskRow): AdminTask {
  return {
    id: r.id,
    kind: r.kind as AdminTaskKind,
    text: r.text,
    data: parseTaskData(r.data, r.kind as AdminTaskKind),
    done: r.done === 1,
    dueDate: r.due_date ?? null,
    ballState: (r.ball_state as BallState) ?? 'mine',
    // seed from created_at for legacy rows whose column is still NULL
    lastTransitionAt: r.last_transition_at ?? r.created_at,
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

// ─── recurring decisions ──────────────────────────────────────────────────
//
// "cancel netflix?", "want to cancel chatgpt" — decisions the user still
// needs to act on. Separate from admin_tasks so snooze semantics don't
// pollute the generic task schema.

interface RecurringDecisionDbRow {
  id: string;
  what: string;
  decision: string | null;
  snooze_until_ms: number | null;
  created_at: number;
  [col: string]: unknown;
}

const MS_PER_DAY = 86_400_000;
const SNOOZE_DAYS = 7;

export const recurringDecisions = {
  /**
   * Add a decision row (called from the admin handler when the router
   * lands an `admin.recurring_decision` action).
   */
  async add(input: { what: string }): Promise<RecurringDecisionRow> {
    const id = newId('a_');
    const now = Date.now();
    await sql.execute(
      `INSERT INTO admin_recurring_decisions (id, what, decision, snooze_until_ms, created_at)
       VALUES (?, ?, NULL, NULL, ?)`,
      [id, input.what.trim(), now],
    );
    return { id, what: input.what.trim(), decision: null, snoozeUntilMs: null, createdAt: now };
  },

  /**
   * Open decisions for the /todo aggregate. Filters:
   *   - rows with a non-null `decision` (already acted on) are excluded.
   *   - rows where `snooze_until_ms > nowMs` are excluded (snoozed).
   *
   * `nowMs` defaults to Date.now() — injectable so tests can pin time.
   */
  async listOpen(nowMs: number = Date.now()): Promise<RecurringDecisionRow[]> {
    const rows = await sql.select<RecurringDecisionDbRow>(
      `SELECT id, what, decision, snooze_until_ms, created_at
       FROM admin_recurring_decisions
       WHERE decision IS NULL
         AND (snooze_until_ms IS NULL OR snooze_until_ms <= ?)
       ORDER BY created_at DESC`,
      [nowMs],
    );
    return rows.map(rowToDecision);
  },

  /**
   * Record the user's decision on a row.
   *
   * - 'cancel' / 'keep' → sets `decision` column; row drops from listOpen.
   * - 'later'           → bumps `snooze_until_ms` forward 7 days from nowMs;
   *                        row re-surfaces after that window expires.
   */
  async decide(
    id: string,
    decision: 'cancel' | 'keep' | 'later',
    nowMs: number = Date.now(),
  ): Promise<void> {
    if (decision === 'later') {
      const snoozeUntil = nowMs + SNOOZE_DAYS * MS_PER_DAY;
      await sql.execute(
        `UPDATE admin_recurring_decisions SET snooze_until_ms = ? WHERE id = ?`,
        [snoozeUntil, id],
      );
    } else {
      await sql.execute(
        `UPDATE admin_recurring_decisions SET decision = ? WHERE id = ?`,
        [decision, id],
      );
    }
  },

  /**
   * Clear any snooze on a decision so it re-enters `listOpen` (and leads
   * /todo) today. Used by the brain's surface_decision offer — accepting
   * "bring it to today" un-snoozes the row without recording a decision.
   */
  async unsnooze(id: string): Promise<void> {
    await sql.execute(
      `UPDATE admin_recurring_decisions SET snooze_until_ms = NULL WHERE id = ?`,
      [id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM admin_recurring_decisions WHERE id = ?`, [id]);
  },
};

function rowToDecision(r: RecurringDecisionDbRow): RecurringDecisionRow {
  return {
    id: r.id,
    what: r.what,
    decision: r.decision as RecurringDecisionRow['decision'],
    snoozeUntilMs: r.snooze_until_ms,
    createdAt: r.created_at,
  };
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
