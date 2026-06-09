/**
 * Admin module · domain types.
 *
 * The admin module catches all the small life-admin debris the brain dump
 * surfaces: "call dentist", "schedule eye exam tuesday", "passport renews
 * in march", "decide on insurance". Two table shapes back this:
 *
 *   1. `admin_tasks` — generic checkable rows, classified by `kind`
 *      (task / phone / appointment / paperwork / decision).
 *   2. `admin_renewals` — first-class objects because they have a due_date
 *      and need a soonest-due surface at the top of the screen.
 *
 * Kinds are a soft enum — the router lands these directly from its
 * `AdminAction` discriminator, so changes here have to track schema.ts.
 */

export type AdminTaskKind =
  | 'task'         // create_task — generic todo
  | 'phone'        // create_phone_task — "call X about Y"
  | 'appointment'  // schedule_appointment — optionally dated
  | 'paperwork'    // log_paperwork — a form / filing to remember
  | 'decision';    // recurring_decision — something to think about

/**
 * Whose court the task is in (audit #7, v1). Minimal three-state model — NO
 * 'theirs' in v1:
 *   - mine    — default; the user still has to act.
 *   - waiting — handed off / awaiting a reply ("sent the form", "they'll confirm").
 *   - done    — completed.
 * `lastTransitionAt` is stamped on every state change so the resurfacing
 * detector can find tasks that have gone quiet (untouched ≥ 7 days).
 */
export type BallState = 'mine' | 'waiting' | 'done';

/**
 * One row in `admin_tasks`. `data` is an opaque JSON envelope for
 * kind-specific extras (phone reason, appointment date) — keeping it in
 * one column lets us add new fields without migrating.
 */
export interface AdminTask {
  id: string;
  kind: AdminTaskKind;
  /** body of the row — task text / person name / what */
  text: string;
  /** kind-specific extras parsed out of the JSON envelope */
  data: AdminTaskData;
  done: boolean;
  /**
   * Optional ISO yyyy-mm-dd due date for generic tasks (task / phone /
   * paperwork). First-class column (not the JSON envelope) so the /todo
   * aggregate can sort + bucket by urgency, mirroring renewals. Null when the
   * router saw no date. (appointment rows keep their date in `data` too.)
   */
  dueDate?: string | null;
  /** Whose court the task is in (v1: mine | waiting | done). Defaults to mine. */
  ballState: BallState;
  /** ms-since-epoch of the last ball_state change; seeds from createdAt. */
  lastTransitionAt: number;
  createdAt: number; // ms since epoch
}

/**
 * Discriminated extras stored in the `data` column. Each kind has its
 * own minimal payload — the UI uses these for the secondary line.
 */
export type AdminTaskData =
  | { kind: 'task' }
  | { kind: 'phone'; reason?: string }
  | { kind: 'appointment'; date?: string }
  | { kind: 'paperwork' }
  | { kind: 'decision' };

/**
 * Renewal — passport, license, lease, insurance, or any other string the
 * router surfaces. `dueDate` is optional because the router will sometimes
 * see "passport renewal" with no date and we still want to log it.
 */
export interface AdminRenewal {
  id: string;
  /** soft enum — known values get nicer formatting, anything else passes through */
  renewalType: string;
  /** ISO yyyy-mm-dd or null when the router couldn't extract a date */
  dueDate: string | null;
  addedAt: number; // ms since epoch
}

/** Known renewal types — used for capitalised labels in the UI. */
export const KNOWN_RENEWAL_TYPES = ['passport', 'license', 'lease', 'insurance'] as const;

/**
 * One row in `admin_recurring_decisions`. Surfaced on the /todo screen as a
 * DECISION variant bullet with cancel / keep / later affordances.
 *
 * `decision` is null while the user hasn't acted. 'later' is never stored
 * as a decision value — instead, `snoozeUntilMs` is bumped forward 7 days
 * and `decision` stays null so the row re-surfaces automatically.
 */
export interface RecurringDecisionRow {
  id: string;
  /** The subscription / service / thing to decide on — e.g. "chatgpt subscription". */
  what: string;
  /** Set when the user clicks cancel or keep. Null while pending. */
  decision: 'cancel' | 'keep' | null;
  /** Ms-since-epoch snooze expiry. Null if not snoozed. */
  snoozeUntilMs: number | null;
  createdAt: number; // ms since epoch
}

/**
 * Days until the renewal is due. Negative numbers mean overdue. Returns
 * null when no due date is set so the caller can render "no date".
 */
export function daysUntil(dueDate: string | null, now: number = Date.now()): number | null {
  if (!dueDate) return null;
  const due = Date.parse(dueDate);
  if (Number.isNaN(due)) return null;
  const MS_PER_DAY = 86_400_000;
  // Compare at day granularity — round both to local midnight so a row
  // due "today" reads as 0 even when it's 11pm.
  const dueDay = Math.floor(due / MS_PER_DAY);
  const nowDay = Math.floor(now / MS_PER_DAY);
  return dueDay - nowDay;
}

/**
 * Editorial summary of how soon a renewal is due. Examples:
 *   "in 14 days", "in 1 day", "today", "1 day overdue", "14 days overdue",
 *   "no date".
 */
export function formatDaysUntil(dueDate: string | null, now: number = Date.now()): string {
  const days = daysUntil(dueDate, now);
  if (days == null) return 'no date';
  if (days === 0) return 'today';
  if (days === 1) return 'in 1 day';
  if (days === -1) return '1 day overdue';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days overdue`;
}
