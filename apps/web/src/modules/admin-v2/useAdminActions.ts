/**
 * admin-v2 · useAdminActions — write bridge
 *
 * The handful of mutations the v2 admin screens perform, written through the
 * SAME `admin.tasks` store key + row shape the live `AdminModule` uses. A
 * task added, marked done, closed, deferred, split, or re-balled through the
 * v2 preview is visible to the live module and vice-versa — they share one
 * admin store.
 *
 *   - `addTask` mirrors `AdminModule.save` — a new `admin.tasks` row with the
 *     canonical `state`/`ball_state`/`kind`/`expiry_ts` fields plus the
 *     legacy `title`/`status` the live module still writes for compat.
 *   - `markDone` mirrors `AdminModule.markDone` — recurring tasks roll their
 *     due date forward; one-offs flip to `state: 'done'`.
 *   - `closeLoop` mirrors `AdminModule.closeLoop` — `state: 'closed'`, the
 *     loop fully shut (distinct from done).
 *   - `deferTask` mirrors `AdminModule.deferTask` — `defer_count` + 1, the
 *     due date / eta pushed out a week.
 *   - `setBall` writes `ball_state` + stamps `last_transition_at` (the slice
 *     `detectStaleBall` reads).
 *   - `splitTask` mirrors `AdminModule.splitIntoGatherFill` — two child
 *     tasks staged GATHER + FILL.
 *   - `attachDoc` mirrors A14 `addDocRef` — a doc ref appended to the task.
 */
import { useCallback } from 'react';
import { addDocRef } from '@ollie/logic/admin';
import type { BallState } from '@ollie/logic/admin';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import type { AdminItem } from './selectors';

const DAY_MS = 86_400_000;

/** the draft an add-screen commit hands `addTask` */
export interface AdminTaskDraft {
  title: string;
  kind: 'task' | 'renewal';
  category: string;
  /** an expiry ISO date (YYYY-MM-DD) for a renewal, or '' */
  expiryDate: string;
  /** a recurrence value ('year', 'month', …) or '' for a one-off */
  recur: string;
}

export interface AdminActions {
  /** add a new admin task; returns the created row's id, or null */
  addTask: (draft: AdminTaskDraft) => string | null;
  /** mark a task done (recurring tasks roll their due date forward) */
  markDone: (id: string) => void;
  /** close the loop on a task — fully shut, distinct from done */
  closeLoop: (id: string) => void;
  /** defer a task — defer_count + 1, due/eta pushed out a week */
  deferTask: (id: string) => void;
  /** set a task's ball state, stamping last_transition_at */
  setBall: (id: string, ball: BallState) => void;
  /** split a paperwork task into GATHER + FILL child tasks */
  splitTask: (id: string) => void;
  /** attach a document reference to a task */
  attachDoc: (id: string, label: string, link?: string) => void;
}

/** strip the few HTML-significant chars, like the live module's `sanitize` */
function sanitize(s: string): string {
  const map: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[<>&"']/g, (c) => map[c] ?? c);
}

export function useAdminActions(now: number): AdminActions {
  const [tasks, setTasks] = useStoreSlice<AdminItem[]>('admin', 'tasks', []);

  const list = useCallback(
    () => (Array.isArray(tasks) ? tasks : []),
    [tasks],
  );

  const addTask = useCallback(
    (draft: AdminTaskDraft): string | null => {
      const title = draft.title.trim();
      if (!title) return null;
      const id = mkId('ad');
      const safe = sanitize(title);
      const expiryTs =
        draft.kind === 'renewal' && draft.expiryDate
          ? new Date(`${draft.expiryDate}T00:00:00`).getTime()
          : undefined;
      const row: AdminItem = {
        id,
        title: safe,
        label: safe,
        category: draft.category || 'other',
        kind: draft.kind || 'task',
        due:
          draft.kind === 'renewal' && draft.expiryDate
            ? draft.expiryDate
            : null,
        expiry_ts: Number.isFinite(expiryTs) ? expiryTs : undefined,
        ball_state: 'MINE',
        last_transition_at: now,
        recur: draft.recur || 'none',
        defer_count: 0,
        action: 'add',
        ts: now,
        status: 'active',
        state: 'active',
      };
      setTasks([...list(), row]);
      return id;
    },
    [list, setTasks, now],
  );

  const markDone = useCallback(
    (id: string) => {
      setTasks(
        list().map((t) => {
          if (!t || t.id !== id) return t;
          // a recurring task with a due date rolls its date forward
          if (t.recur && t.recur !== 'none' && t.due) {
            const d = new Date(`${t.due}T00:00:00`);
            if (!Number.isNaN(d.getTime())) {
              if (t.recur === 'year') d.setFullYear(d.getFullYear() + 1);
              else if (t.recur === '2year') d.setFullYear(d.getFullYear() + 2);
              else if (t.recur === '5year') d.setFullYear(d.getFullYear() + 5);
              else if (t.recur === '10year') d.setFullYear(d.getFullYear() + 10);
              else if (t.recur === 'month') d.setMonth(d.getMonth() + 1);
              else if (t.recur === 'quarter') d.setMonth(d.getMonth() + 3);
              const nextDue = d.toISOString().slice(0, 10);
              return {
                ...t,
                due: nextDue,
                expiry_ts:
                  t.kind === 'renewal'
                    ? new Date(`${nextDue}T00:00:00`).getTime()
                    : t.expiry_ts,
                last_done_at: now,
              };
            }
          }
          return { ...t, status: 'done', state: 'done', done_at: now };
        }),
      );
    },
    [list, setTasks, now],
  );

  const closeLoop = useCallback(
    (id: string) => {
      setTasks(
        list().map((t) =>
          t && t.id === id
            ? { ...t, status: 'done', state: 'closed', closed_at: now }
            : t,
        ),
      );
    },
    [list, setTasks, now],
  );

  const deferTask = useCallback(
    (id: string) => {
      setTasks(
        list().map((t) => {
          if (!t || t.id !== id) return t;
          const nextCount =
            (typeof t.defer_count === 'number' ? t.defer_count : 0) + 1;
          let nextDue = t.due ?? null;
          let nextExpiry = t.expiry_ts;
          const nextEta =
            typeof t.eta_at === 'number' ? t.eta_at + 7 * DAY_MS : t.eta_at;
          if (t.due) {
            const d = new Date(`${t.due}T00:00:00`);
            if (!Number.isNaN(d.getTime())) {
              d.setDate(d.getDate() + 7);
              nextDue = d.toISOString().slice(0, 10);
              if (t.kind === 'renewal') {
                nextExpiry = new Date(`${nextDue}T00:00:00`).getTime();
              }
            }
          }
          return {
            ...t,
            defer_count: nextCount,
            due: nextDue,
            expiry_ts: nextExpiry,
            eta_at: nextEta,
          };
        }),
      );
    },
    [list, setTasks],
  );

  const setBall = useCallback(
    (id: string, ball: BallState) => {
      setTasks(
        list().map((t) =>
          t && t.id === id
            ? { ...t, ball_state: ball, last_transition_at: now }
            : t,
        ),
      );
    },
    [list, setTasks, now],
  );

  const splitTask = useCallback(
    (id: string) => {
      const current = list();
      const parent = current.find((t) => t && t.id === id);
      if (!parent) return;
      const lbl =
        (typeof parent.label === 'string' && parent.label.trim()) ||
        (typeof parent.title === 'string' && parent.title.trim()) ||
        'paperwork';
      const mk = (stage: string): AdminItem => {
        const safe = sanitize(`${lbl} · ${stage}`);
        return {
          id: mkId('ad'),
          title: safe,
          label: safe,
          category:
            typeof parent.category === 'string' ? parent.category : 'other',
          kind: 'task',
          due: null,
          ball_state: 'MINE',
          last_transition_at: now,
          recur: 'none',
          defer_count: 0,
          parent_task_id: id,
          stage,
          action: 'add',
          ts: now,
          status: 'active',
          state: 'active',
        };
      };
      // mark the parent split (so the v2 split row hides) + add the children
      setTasks([
        ...current.map((t) =>
          t && t.id === id ? { ...t, stage: t.stage ?? 'SPLIT' } : t,
        ),
        mk('GATHER'),
        mk('FILL'),
      ]);
    },
    [list, setTasks, now],
  );

  const attachDoc = useCallback(
    (id: string, label: string, link?: string) => {
      const l = label.trim();
      if (!l) return;
      setTasks(
        list().map((t) =>
          t && t.id === id ? (addDocRef(t, sanitize(l), link) as AdminItem) : t,
        ),
      );
    },
    [list, setTasks],
  );

  return { addTask, markDone, closeLoop, deferTask, setBall, splitTask, attachDoc };
}
