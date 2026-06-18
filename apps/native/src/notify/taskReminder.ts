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
import type { RemindIn } from '../router/schema';
import { scheduleAt } from './systemNotify';
import { scheduleServerReminder } from './serverReminder';
import { OLLIE_REMINDER_CATEGORY } from './notificationActions';

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
 * Schedule a task reminder if a usable `remindIn` hint is present. No-op
 * otherwise. See module doc for the OS-local + server-push fan-out.
 */
export function scheduleTaskReminder(
  remindIn: RemindIn | undefined,
  taskId: string,
  { title, body, module, actionUrl }: TaskReminderOptions,
): void {
  if (!remindIn) return;
  const fireAt = resolveReminderFireAt(remindIn);
  if (fireAt === null) return;
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
