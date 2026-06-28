/**
 * Shared task-reminder scheduler.
 *
 * Extracted from the near-verbatim `scheduleReminderIfPresent` helpers in
 * the admin + work handlers (audit #13). The only per-caller variation was
 * the notification `module` tag (for the tap-routing `extra`) and the
 * `actionUrl` deep link — both are now parameters.
 *
 * When a routed task carries a `remindIn` hint (worker-resolved against the
 * dump clock), schedule the notification for the same fire time via:
 *
 *   1. scheduleAt — on Tauri this hands the reminder to the native OS local
 *      scheduler (fires even if the app is QUIT); off Tauri it falls back to
 *      an in-process setTimeout (fires while the page is open).
 *   2. server-side Supabase `scheduled_jobs` row (scheduleServerReminder)
 *      — drained by the cron → APNs, so it fires even with the app fully
 *      CLOSED. No-op when not signed in / sync off / api absent.
 *
 * All paths carry the SAME stable id (`reminder:<taskId>`); the notify
 * dispatcher and the cron both honor dedupe_key, so whichever lands first
 * wins and the user is never double-pinged.
 *
 * Fire-and-forget — the schedule is a side-effect of the row write, never a
 * blocker. No-op when remindIn is absent or unusable.
 *
 * Audit #92: `scheduledAtMs` is computed worker-side against the worker's
 * clock. A skewed/stale value (or a worker bug) could be in the past — which
 * would fire the reminder INSTANTLY ("remind me in 1hr" → pings now) — or
 * absurdly far in the future. We don't trust it blindly: we re-derive the
 * fire time from the user-intent `amount`/`unit` against THIS device's clock,
 * and reject anything outside a sane horizon.
 */
import type { RemindIn, HandlerResult } from '../router/schema';
import { scheduleAt } from './systemNotify';
import { scheduleServerReminder } from './serverReminder';
import { OLLIE_REMINDER_CATEGORY } from './notificationActions';
import { resolveTimeOfDayFireAt } from './reminderCascade';

/** No reminder should ever be scheduled more than this far out — a
 *  "remind me" hint that resolves beyond a year is almost certainly a clock
 *  bug, not a real intent. Renewals/staged cues use a different path. */
const MAX_REMINDER_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

const UNIT_MS: Record<RemindIn['unit'], number> = {
  sec: 1000,
  min: 60 * 1000,
  hr: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/**
 * Resolve the wall-clock fire time for a reminder, re-deriving it from the
 * user-intent amount/unit against the DEVICE clock rather than trusting the
 * worker-supplied absolute timestamp (audit #92). Returns null when the hint
 * is unusable (non-positive amount, unknown unit) or resolves to the past /
 * beyond the sane horizon.
 */
export function resolveReminderFireAt(remindIn: RemindIn): number | null {
  const { amount, unit } = remindIn;
  const unitMs = UNIT_MS[unit];
  let fireAt: number;
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && unitMs) {
    fireAt = Date.now() + amount * unitMs;
  } else if (typeof remindIn.scheduledAtMs === 'number' && Number.isFinite(remindIn.scheduledAtMs)) {
    fireAt = remindIn.scheduledAtMs;
  } else {
    return null;
  }

  const now = Date.now();
  if (fireAt <= now) return null;
  if (fireAt - now > MAX_REMINDER_HORIZON_MS) return null;
  return fireAt;
}

export interface TaskReminderOptions {
  title: string;
  body: string;
  /** Notification `extra.module` tag → drives onAction tap routing. */
  module: string;
  /** Deep link opened on notification tap (e.g. 'ollie://todo'). */
  actionUrl: string;
}

/**
 * Schedule a one-shot reminder at an ABSOLUTE wall-clock `fireAt` (ms epoch).
 *
 * The shared core behind both the relative-hint path (scheduleTaskReminder) and
 * the manual-reminder cascade (DumpScreen → "remind me to call mom at 6pm" /
 * the "when?" pick / the 7pm fallback). Fans the same reminder out over all
 * three delivery paths under ONE stable id (`reminder:<taskId>`):
 *   - OS-local notification (survives app-quit on Tauri),
 *   - in-process timer (web preview / open app),
 *   - server-push job (cron → APNs, fires app-fully-closed).
 * The notify dispatcher + cron both honor dedupe_key, so whichever lands first
 * wins — never a double ping.
 *
 * No-op (defensive) when `fireAt` is non-finite or already in the past — the
 * cascade resolvers never return a past time, but a caller bug shouldn't fire a
 * reminder instantly. Never throws.
 */
export function scheduleReminderAt(
  fireAt: number,
  taskId: string,
  { title, body, module, actionUrl }: TaskReminderOptions,
): void {
  if (typeof fireAt !== 'number' || !Number.isFinite(fireAt)) return;
  if (fireAt - Date.now() > MAX_REMINDER_HORIZON_MS) return;
  if (fireAt <= Date.now()) return;
  // Same stable id across all three paths (OS local notification, in-process
  // timer, server-push job) so the dispatcher / cron dedupe to one ping.
  const id = `reminder:${taskId}`;
  // actionTypeId + extra → "Got it ✓ / Snooze" buttons (A3); extra tells
  // onAction which row to complete.
  scheduleAt(
    fireAt,
    { title, body, actionTypeId: OLLIE_REMINDER_CATEGORY, extra: { module, refId: taskId } },
    id,
  );
  // action_url deep-links the notification tap straight to where the task
  // surfaces (A2).
  scheduleServerReminder(
    {
      title, body, category: 'REMINDER', dedupe_key: id,
      action_url: actionUrl, notification_category: OLLIE_REMINDER_CATEGORY,
    },
    fireAt,
  );
}

/**
 * Schedule a task reminder if a usable `remindIn` hint is present. No-op
 * otherwise. See module doc for the OS-local + server-push fan-out.
 */
export function scheduleTaskReminder(
  remindIn: RemindIn | undefined,
  taskId: string,
  opts: TaskReminderOptions,
): void {
  if (!remindIn) return;
  const fireAt = resolveReminderFireAt(remindIn);
  if (fireAt === null) return;
  scheduleReminderAt(fireAt, taskId, opts);
}

/** The reminder-hint fields Layer 1 may attach to a reminder-capable action. */
export interface ReminderPlanInput {
  reminder?: boolean;
  remindAt?: string;
  remindIn?: RemindIn;
}

/**
 * Plan + schedule a manual one-shot reminder for a freshly-created to-do row.
 *
 * Brain-vs-body split: Layer 1 (the AI router) only flags reminder INTENT and
 * extracts a time when the user named one. This function is the deterministic
 * body — it decides what to schedule and when, with NO LLM in the loop:
 *
 *   1. explicit clock time ("at 6pm" → remindAt "18:00") → schedule the next
 *      occurrence (today, else tomorrow) immediately. Returns undefined.
 *   2. relative hint ("in N min" → remindIn) → existing worker-anchored path.
 *      Returns undefined.
 *   3. explicit "remind me" with NO usable time → returns a `reminderCascade`
 *      descriptor so the caller (DumpScreen) can surface the "when?" card; the
 *      to-do already exists, nothing is scheduled yet.
 *   4. not a reminder at all → returns undefined, schedules nothing.
 *
 * `cascadeText` overrides the human label used in the "when?" card (e.g. a
 * phone task's person name); defaults to `opts.body`.
 */
export function planReminder(
  p: ReminderPlanInput,
  taskId: string,
  module: 'admin' | 'work',
  opts: TaskReminderOptions,
  cascadeText?: string,
): HandlerResult['reminderCascade'] {
  if (p.remindAt) {
    const fireAt = resolveTimeOfDayFireAt(p.remindAt);
    if (fireAt !== null) {
      scheduleReminderAt(fireAt, taskId, opts);
      return undefined;
    }
    // Unparseable time string: fall through so an explicit reminder still gets
    // the "when?" cascade rather than silently losing the reminder.
  }
  if (p.remindIn) {
    scheduleTaskReminder(p.remindIn, taskId, opts);
    return undefined;
  }
  if (p.reminder) {
    return { taskId, text: cascadeText ?? opts.body, module };
  }
  return undefined;
}
