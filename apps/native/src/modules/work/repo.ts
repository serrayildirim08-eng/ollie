/**
 * Work module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for work — handlers and screens call these
 * and stay query-agnostic.
 *
 * Conventions:
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `done` is stored as 0/1.
 *   - Event variable shape is stringified JSON in the `data` column;
 *     the row mapper hydrates it back into a discriminated union.
 *   - Tasks dedupe by trimmed text within the active (done=0) set — a
 *     second "send invoice" while one is still open just refreshes the
 *     timestamp rather than piling identical rows.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import type {
  FocusSessionData,
  MeetingData,
  DistractionData,
  WorkEvent,
  WorkEventData,
  WorkEventKind,
  WorkHandoffNote,
  WorkScheduledBlock,
  WorkTask,
  WorkTaskKind,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface WorkTaskRow {
  id: string;
  text: string;
  project: string | null;
  kind: string;
  due_date: string | null;
  done: number;
  created_at: number;
  [col: string]: unknown;
}

interface WorkEventRow {
  id: string;
  kind: string;
  data: string;
  logged_at: number;
  [col: string]: unknown;
}

interface WorkScheduledBlockRow {
  id: string;
  label: string | null;
  start_ts: number;
  duration_min: number | null;
  cancelled_at: number | null;
  created_at: number;
  [col: string]: unknown;
}

interface WorkHandoffNoteRow {
  id: string;
  text: string;
  project: string | null;
  resolved_at: number | null;
  ts: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Local ISO-yyyy-mm-dd today; mirrors the helper in admin/repo.ts. */
function isoTodayWork(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── tasks ────────────────────────────────────────────────────────────────

export const tasks = {
  /** All tasks (done + open), most-recent-first. */
  async list(): Promise<WorkTask[]> {
    const rows = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       ORDER BY created_at DESC`,
    );
    return rows.map(rowToTask);
  },

  /** Just deadlines, soonest due-date first (nulls last). */
  async listDeadlines(): Promise<WorkTask[]> {
    const rows = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       WHERE kind = 'deadline'
       ORDER BY (due_date IS NULL), due_date ASC, created_at DESC`,
    );
    return rows.map(rowToTask);
  },

  /** Most recently completed task — used for the "today" hairline. */
  async lastDone(): Promise<WorkTask | null> {
    const rows = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       WHERE done = 1
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    return rows.length > 0 ? rowToTask(rows[0]!) : null;
  },

  /**
   * Add an open task. If an open row with the same normalised text already
   * exists, refresh its timestamp + project rather than inserting a dupe.
   */
  async add(input: {
    text: string;
    project?: string | null;
    kind?: WorkTaskKind;
    dueDate?: string | null;
  }): Promise<WorkTask> {
    const text = normaliseText(input.text);
    const project = input.project ?? null;
    const kind: WorkTaskKind = input.kind ?? 'task';
    const dueDate = input.dueDate ?? null;
    const now = Date.now();

    const existing = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       WHERE text = ? AND done = 0
       LIMIT 1`,
      [text],
    );

    if (existing.length > 0) {
      const row = existing[0]!;
      const mergedProject = project ?? row.project;
      const mergedDue = dueDate ?? row.due_date;
      const mergedKind = kind ?? (row.kind as WorkTaskKind);
      await sql.execute(
        `UPDATE work_tasks
           SET project = ?, kind = ?, due_date = ?, created_at = ?
         WHERE id = ?`,
        [mergedProject, mergedKind, mergedDue, now, row.id],
      );
      return {
        id: row.id,
        text: row.text,
        project: mergedProject,
        kind: mergedKind,
        dueDate: mergedDue,
        done: false,
        createdAt: now,
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO work_tasks (id, text, project, kind, due_date, done, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [id, text, project, kind, dueDate, now],
    );
    return { id, text, project, kind, dueDate, done: false, createdAt: now };
  },

  /**
   * Open work rows for the cross-module /todo aggregate. Two pieces:
   *   - tasks (kind='task') where `done = 0`
   *   - deadlines (kind='deadline') where `done = 0` AND
   *     (due_date IS NULL OR due_date >= today)
   * Most-recent-first ordering; the TodoScreen does date bucketing.
   */
  async listOpen(today: string = isoTodayWork()): Promise<WorkTask[]> {
    const rows = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       WHERE done = 0
         AND (
           kind = 'task'
           OR (kind = 'deadline' AND (due_date IS NULL OR due_date >= ?))
         )
       ORDER BY created_at DESC`,
      [today],
    );
    return rows.map(rowToTask);
  },

  /** Mark a task complete — used by the /todo screen's check-off
   *  affordance. Hard-sets done=1 rather than toggleDone, so the call
   *  site doesn't accidentally un-complete a row. */
  async markComplete(id: string): Promise<void> {
    await sql.execute(
      `UPDATE work_tasks SET done = 1, created_at = ? WHERE id = ?`,
      [Date.now(), id],
    );
  },

  /** Toggle done state. Refreshes created_at so the row floats to "recent". */
  async toggleDone(id: string): Promise<void> {
    const existing = await sql.select<WorkTaskRow>(
      `SELECT id, done FROM work_tasks WHERE id = ? LIMIT 1`,
      [id],
    );
    if (existing.length === 0) return;
    const next = existing[0]!.done === 1 ? 0 : 1;
    await sql.execute(
      `UPDATE work_tasks SET done = ?, created_at = ? WHERE id = ?`,
      [next, Date.now(), id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM work_tasks WHERE id = ?`, [id]);
  },
};

// ─── events ───────────────────────────────────────────────────────────────

export const events = {
  /** All events, most-recent-first. */
  async list(limit = 50): Promise<WorkEvent[]> {
    const rows = await sql.select<WorkEventRow>(
      `SELECT id, kind, data, logged_at
       FROM work_events
       ORDER BY logged_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(rowToEvent);
  },

  /**
   * Sum focus-session minutes logged between [fromMs, toMs). Used to
   * surface the "today" focus total at the top of the screen.
   */
  async focusMinutesBetween(fromMs: number, toMs: number): Promise<number> {
    const rows = await sql.select<WorkEventRow>(
      `SELECT id, kind, data, logged_at
       FROM work_events
       WHERE kind = 'focus_session' AND logged_at >= ? AND logged_at < ?`,
      [fromMs, toMs],
    );
    let total = 0;
    for (const r of rows) {
      const parsed = parseEventData(r.kind as WorkEventKind, r.data);
      if (parsed.kind === 'focus_session' && parsed.durationMin != null) {
        total += parsed.durationMin;
      }
    }
    return total;
  },

  async addFocus(input: FocusSessionData): Promise<WorkEvent> {
    const data: WorkEventData = {
      kind: 'focus_session',
      durationMin: input.durationMin ?? null,
      project: input.project ?? null,
    };
    return insertEvent('focus_session', data);
  },

  async addMeeting(input: MeetingData): Promise<WorkEvent> {
    const data: WorkEventData = {
      kind: 'meeting',
      with: input.with ?? null,
      durationMin: input.durationMin ?? null,
    };
    return insertEvent('meeting', data);
  },

  async addDistraction(input: DistractionData): Promise<WorkEvent> {
    const data: WorkEventData = {
      kind: 'distraction',
      what: normaliseText(input.what),
    };
    return insertEvent('distraction', data);
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM work_events WHERE id = ?`, [id]);
  },
};

// ─── scheduled blocks ───────────────────────────────────────────────────────

export const scheduledBlocks = {
  /** Active (non-cancelled) blocks, soonest start first. */
  async list(): Promise<WorkScheduledBlock[]> {
    const rows = await sql.select<WorkScheduledBlockRow>(
      `SELECT id, label, start_ts, duration_min, cancelled_at, created_at
       FROM work_scheduled_blocks
       WHERE cancelled_at IS NULL
       ORDER BY start_ts ASC`,
    );
    return rows.map(rowToScheduledBlock);
  },

  /** Every block including cancelled — the bridge mirrors all of these so the
   *  cue scan can see + skip cancelled rows by `cancelledAt`. */
  async listAll(): Promise<WorkScheduledBlock[]> {
    const rows = await sql.select<WorkScheduledBlockRow>(
      `SELECT id, label, start_ts, duration_min, cancelled_at, created_at
       FROM work_scheduled_blocks
       ORDER BY start_ts ASC`,
    );
    return rows.map(rowToScheduledBlock);
  },

  /** Book a future deep-work block. */
  async add(input: {
    label?: string | null;
    startTs: number;
    durationMin?: number | null;
  }): Promise<WorkScheduledBlock> {
    const id = newId();
    const now = Date.now();
    const label = input.label ? normaliseText(input.label) : null;
    const durationMin = input.durationMin ?? null;
    await sql.execute(
      `INSERT INTO work_scheduled_blocks
         (id, label, start_ts, duration_min, cancelled_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [id, label, input.startTs, durationMin, now],
    );
    return {
      id,
      label,
      startTs: input.startTs,
      durationMin,
      cancelledAt: null,
      createdAt: now,
    };
  },

  /** Soft-cancel a block (hidden from the list; cue scan skips it). */
  async cancel(id: string): Promise<void> {
    await sql.execute(
      `UPDATE work_scheduled_blocks SET cancelled_at = ? WHERE id = ?`,
      [Date.now(), id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM work_scheduled_blocks WHERE id = ?`, [id]);
  },
};

// ─── handoff notes ──────────────────────────────────────────────────────────

export const handoffs = {
  /** Open (unresolved) notes, most-recent-first. */
  async listOpen(): Promise<WorkHandoffNote[]> {
    const rows = await sql.select<WorkHandoffNoteRow>(
      `SELECT id, text, project, resolved_at, ts
       FROM work_handoff_notes
       WHERE resolved_at IS NULL
       ORDER BY ts DESC`,
    );
    return rows.map(rowToHandoff);
  },

  /** Every note including resolved, most-recent-first. */
  async list(): Promise<WorkHandoffNote[]> {
    const rows = await sql.select<WorkHandoffNoteRow>(
      `SELECT id, text, project, resolved_at, ts
       FROM work_handoff_notes
       ORDER BY ts DESC`,
    );
    return rows.map(rowToHandoff);
  },

  async add(input: {
    text: string;
    project?: string | null;
  }): Promise<WorkHandoffNote> {
    const id = newId();
    const ts = Date.now();
    const text = normaliseText(input.text);
    const project = input.project ? normaliseText(input.project) : null;
    await sql.execute(
      `INSERT INTO work_handoff_notes (id, text, project, resolved_at, ts)
       VALUES (?, ?, ?, NULL, ?)`,
      [id, text, project, ts],
    );
    return { id, text, project, resolvedAt: null, ts };
  },

  /** Mark a hand-off resolved — drops it from the open list. */
  async resolve(id: string): Promise<void> {
    await sql.execute(
      `UPDATE work_handoff_notes SET resolved_at = ? WHERE id = ?`,
      [Date.now(), id],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM work_handoff_notes WHERE id = ?`, [id]);
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────

async function insertEvent(
  kind: WorkEventKind,
  data: WorkEventData,
): Promise<WorkEvent> {
  const id = newId();
  const now = Date.now();
  await sql.execute(
    `INSERT INTO work_events (id, kind, data, logged_at)
     VALUES (?, ?, ?, ?)`,
    [id, kind, JSON.stringify(data), now],
  );
  return { id, kind, data, loggedAt: now };
}

function rowToTask(r: WorkTaskRow): WorkTask {
  const kind: WorkTaskKind = r.kind === 'deadline' ? 'deadline' : 'task';
  return {
    id: r.id,
    text: r.text,
    project: r.project,
    kind,
    dueDate: r.due_date,
    done: r.done === 1,
    createdAt: r.created_at,
  };
}

function rowToEvent(r: WorkEventRow): WorkEvent {
  const kind = r.kind as WorkEventKind;
  return {
    id: r.id,
    kind,
    data: parseEventData(kind, r.data),
    loggedAt: r.logged_at,
  };
}

function rowToScheduledBlock(r: WorkScheduledBlockRow): WorkScheduledBlock {
  return {
    id: r.id,
    label: r.label,
    startTs: r.start_ts,
    durationMin: numOrNull(r.duration_min),
    cancelledAt: numOrNull(r.cancelled_at),
    createdAt: r.created_at,
  };
}

function rowToHandoff(r: WorkHandoffNoteRow): WorkHandoffNote {
  return {
    id: r.id,
    text: r.text,
    project: r.project,
    resolvedAt: numOrNull(r.resolved_at),
    ts: r.ts,
  };
}

/**
 * Hydrate the JSON payload into a typed `WorkEventData`. Defensive against
 * partial / corrupted rows — falls back to a minimal shape per kind so the
 * UI never crashes on a bad event blob.
 */
function parseEventData(kind: WorkEventKind, raw: string): WorkEventData {
  let parsed: Record<string, unknown> = {};
  try {
    const x = JSON.parse(raw) as unknown;
    if (x && typeof x === 'object') parsed = x as Record<string, unknown>;
  } catch {
    // fall through to defaults
  }
  if (kind === 'focus_session') {
    return {
      kind: 'focus_session',
      durationMin: numOrNull(parsed.durationMin),
      project: strOrNull(parsed.project),
    };
  }
  if (kind === 'meeting') {
    return {
      kind: 'meeting',
      with: strOrNull(parsed.with),
      durationMin: numOrNull(parsed.durationMin),
    };
  }
  return {
    kind: 'distraction',
    what: typeof parsed.what === 'string' ? parsed.what : '',
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Work tasks are open-row-deduped by normalised `text`; once a task is
// toggled done, the next dump of the same text inserts a fresh row. So
// the row stream for a recurring chore ("send invoice", "weekly check-in")
// carries real cadence — gap = time between completions/dumps.
//
// We key by the same normalised `text` so the writer + the cadence
// surface read consistently.

export const cadence = {
  /**
   * Cadence for one recurring task by normalised text. Filters
   * `work_tasks` rows where `text` matches.
   *
   * `text` may include surrounding whitespace; we apply `normaliseText` so
   * "Send invoice " and "send invoice" collapse into the same series.
   */
  async getTaskCadenceFor(text: string): Promise<CadenceEstimate> {
    const key = normaliseText(text);
    if (!key) return computeCadence([]);
    const rows = await sql.select<WorkTaskRow>(
      `SELECT id, text, project, kind, due_date, done, created_at
       FROM work_tasks
       WHERE text = ?
       ORDER BY created_at ASC`,
      [key],
    );
    return computeCadence(
      rows.map((r) => ({ ts: r.created_at, label: key })),
    );
  },
};
