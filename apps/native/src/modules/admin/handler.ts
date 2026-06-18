/**
 * Admin module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every admin action the
 * router emits to a real repository call. Notes are kept short — the
 * dump UX is silent ("okay!" only); these notes feed dev logging + any
 * future surface that wants to show what happened.
 */

import type { AdminAction, ModuleHandler, HandlerResult, RemindIn } from '../../router/schema';
import { migrateAdmin } from './migrate';
import { renewals, tasks } from './repo';
import { inferInitialBallState } from './ballState';
import { scheduleAt } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';
import { OLLIE_REMINDER_CATEGORY } from '../../notify/notificationActions';

export const adminHandler: ModuleHandler<'admin'> = {
  module: 'admin',
  async apply(fragment): Promise<HandlerResult> {
    await migrateAdmin();
    const p = fragment.payload as AdminAction;

    // Undo factories — admin has TWO tables (tasks + renewals), so we keep
    // separate closures rather than overloading one. Both delete-by-id.
    const undoTask = (id: string) => () => tasks.remove(id);
    const undoRenewal = (id: string) => () => renewals.remove(id);

    switch (p.action) {
      case 'create_task': {
        const task = await tasks.add({
          kind: 'task',
          text: p.text,
          data: { kind: 'task' },
          dueDate: p.dueDate ?? null,
          // move to `waiting` when the dump clearly signals a hand-off (#7)
          ballState: inferInitialBallState(p.text),
        });
        // Time-deferred reminder side-effect (Approach B). The worker
        // computes scheduledAtMs from the user's "in N min/hr" hint.
        scheduleReminderIfPresent(p.remindIn, task.id, 'to do', p.text);
        return { ok: true, note: `noted: ${p.text}`, deepLink: '/box/admin', undo: undoTask(task.id) };
      }

      case 'create_phone_task': {
        const text = p.person;
        const task = await tasks.add({
          kind: 'phone',
          text,
          data: { kind: 'phone', reason: p.reason },
          dueDate: p.dueDate ?? null,
        });
        const note = p.reason ? `call ${p.person} — ${p.reason}` : `call ${p.person}`;
        // Time-deferred reminder side-effect (Approach B).
        const reminderBody = p.reason ? `${p.person} · ${p.reason}` : p.person;
        scheduleReminderIfPresent(p.remindIn, task.id, 'call', reminderBody);
        return { ok: true, note, deepLink: '/box/admin', undo: undoTask(task.id) };
      }

      case 'schedule_appointment': {
        const task = await tasks.add({
          kind: 'appointment',
          text: p.what,
          data: { kind: 'appointment', date: p.date },
        });
        const note = p.date
          ? `appointment: ${p.what} on ${p.date}`
          : `appointment: ${p.what}`;
        return { ok: true, note, deepLink: '/box/admin', undo: undoTask(task.id) };
      }

      case 'log_paperwork': {
        const task = await tasks.add({ kind: 'paperwork', text: p.what, data: { kind: 'paperwork' }, dueDate: p.dueDate ?? null });
        return { ok: true, note: `paperwork: ${p.what}`, deepLink: '/box/admin', undo: undoTask(task.id) };
      }

      case 'recurring_decision': {
        const task = await tasks.add({ kind: 'decision', text: p.what, data: { kind: 'decision' } });
        return { ok: true, note: `decision to revisit: ${p.what}`, deepLink: '/box/admin', undo: undoTask(task.id) };
      }

      case 'log_renewal': {
        const ren = await renewals.add({ renewalType: p.renewal_type, dueDate: p.due_date ?? null });
        const note = p.due_date
          ? `${p.renewal_type} renewal due ${p.due_date}`
          : `${p.renewal_type} renewal logged`;
        return { ok: true, note, deepLink: '/box/admin', undo: undoRenewal(ren.id) };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`admin: unhandled action ${JSON.stringify(p)}`);
}

/**
 * If a routed task carries a `remindIn` hint (worker-resolved against the
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
 * Fire-and-forget — the schedule is a side-effect of the row write, never
 * a blocker. No-op when remindIn is absent or unusable.
 *
 * Audit #92: `scheduledAtMs` is computed worker-side against the worker's
 * clock. A skewed/stale value (or a worker bug) could be in the past — which
 * would fire the reminder INSTANTLY ("remind me in 1hr" → pings now) — or
 * absurdly far in the future. We don't trust it blindly: we re-derive the
 * fire time from the user-intent `amount`/`unit` against THIS device's clock,
 * and reject anything outside a sane horizon.
 */
function scheduleReminderIfPresent(
  remindIn: RemindIn | undefined,
  taskId: string,
  title: string,
  body: string,
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
    { title, body, actionTypeId: OLLIE_REMINDER_CATEGORY, extra: { module: 'admin', refId: taskId } },
    id,
  );
  // action_url deep-links the notification tap straight to where admin tasks /
  // calls surface (the to-do list). A2.
  scheduleServerReminder(
    {
      title, body, category: 'REMINDER', dedupe_key: id,
      action_url: 'ollie://todo', notification_category: OLLIE_REMINDER_CATEGORY,
    },
    fireAt,
  );
}

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
function resolveReminderFireAt(remindIn: RemindIn): number | null {
  const { amount, unit } = remindIn;
  const unitMs = UNIT_MS[unit];
  // Re-derive from intent when we have a usable amount + unit; otherwise fall
  // back to the worker's absolute timestamp (still bounds-checked below).
  let fireAt: number;
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && unitMs) {
    fireAt = Date.now() + amount * unitMs;
  } else if (typeof remindIn.scheduledAtMs === 'number' && Number.isFinite(remindIn.scheduledAtMs)) {
    fireAt = remindIn.scheduledAtMs;
  } else {
    return null;
  }

  const now = Date.now();
  // Reject the past (would fire immediately — the #92 bug) and the absurdly
  // far future (clock skew). scheduleAt's own < 1s guard handles the tiny
  // legitimately-near case.
  if (fireAt <= now) return null;
  if (fireAt - now > MAX_REMINDER_HORIZON_MS) return null;
  return fireAt;
}
