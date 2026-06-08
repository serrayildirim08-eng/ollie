/**
 * @ollie/logic · brain · deferral tracking
 *
 * Pure computation over EXISTING task timestamps — no new capture, no I/O,
 * no wall-clock reads (the caller passes `now`). Given a task with a
 * `created_at`, an optional due date, a done flag, and (optional) snooze
 * timestamps, this derives the three signals the brain's learning needs:
 *
 *   - daysSitting: how long the task has been open (created → now, or
 *     created → completion if already done). Whole days, floored at 0.
 *   - overdue:     true when there's a due date in the PAST and the task
 *     isn't done. A done task is never overdue; a task with no due date
 *     is never overdue.
 *   - deferCount:  how many times the user pushed it back (snooze count).
 *
 * This is an OBSERVATION signal, not a nag — no copy, no severity. The
 * surfaces that consume it stay calm/optional ("want me to bump this up?").
 */

import { DAY_MS } from '../util';

/** A task as the deferral helper sees it — a tolerant subset of the real rows. */
export interface DeferralTask {
  /** ms-since-epoch the task was created. Required — it's the aging clock. */
  createdAt: number;
  /**
   * Optional due date. Accepts a ms timestamp OR an ISO/date string
   * (admin_tasks store dates as 'YYYY-MM-DD' strings; work_tasks may carry
   * a ms `dueAt`). Null/undefined/unparseable → no due date.
   */
  dueDate?: number | string | null;
  /** True when the task is complete. A done task is never "overdue". */
  done?: boolean;
  /**
   * ms-since-epoch the task was completed, when known. Used to freeze
   * `daysSitting` at completion instead of letting it grow forever.
   */
  completedAt?: number | null;
  /**
   * Snooze / defer timestamps — one entry per time the user pushed it back.
   * `deferCount` is their length. Accepts a count number as a shortcut.
   */
  snoozes?: number[] | number | null;
}

export interface DeferralSignal {
  /** Whole days the task has been sitting open (>= 0). */
  daysSitting: number;
  /** True only when there's a past due date AND the task isn't done. */
  overdue: boolean;
  /** How many times the task was deferred / snoozed (>= 0). */
  deferCount: number;
}

/** Coerce a ms-or-string due value into a ms timestamp, or null. */
function toMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** How many times this task was deferred. Tolerant of array-or-count input. */
function deferCountOf(snoozes: DeferralTask['snoozes']): number {
  if (Array.isArray(snoozes)) return snoozes.length;
  if (typeof snoozes === 'number' && Number.isFinite(snoozes) && snoozes > 0) {
    return Math.floor(snoozes);
  }
  return 0;
}

/**
 * Compute the deferral signal for one task. Pure: never throws, never reads
 * the clock — the caller supplies `now` (defaults to 0 so accidental
 * clock-less calls are deterministic rather than wrong).
 */
export function computeDeferral(
  task: DeferralTask,
  now: number,
): DeferralSignal {
  const created = Number.isFinite(task.createdAt) ? task.createdAt : now;

  // daysSitting freezes at completion for done tasks; otherwise grows to now.
  const endTs = task.done === true && typeof task.completedAt === 'number' && Number.isFinite(task.completedAt)
    ? task.completedAt
    : now;
  const elapsedMs = endTs - created;
  const daysSitting = elapsedMs > 0 ? Math.floor(elapsedMs / DAY_MS) : 0;

  const dueMs = toMs(task.dueDate);
  const overdue = task.done !== true && dueMs != null && dueMs < now;

  return {
    daysSitting,
    overdue,
    deferCount: deferCountOf(task.snoozes),
  };
}
