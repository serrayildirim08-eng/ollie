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
import { scheduleAt } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';

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
        const task = await tasks.add({ kind: 'task', text: p.text, data: { kind: 'task' } });
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
        const task = await tasks.add({ kind: 'paperwork', text: p.what, data: { kind: 'paperwork' } });
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
 * dump clock), schedule the notification two ways for the same fire time:
 *
 *   1. client setTimeout (scheduleAt) — fires while the app is open /
 *      minimised, identically on macOS + iOS.
 *   2. server-side Supabase `scheduled_jobs` row (scheduleServerReminder)
 *      — drained by the cron → APNs, so it fires even with the app fully
 *      CLOSED. No-op when not signed in / sync off / api absent.
 *
 * Both carry the SAME stable `dedupe_key` (`reminder:<taskId>`); the notify
 * dispatcher and the cron both honor dedupe_key, so whichever lands first
 * wins and the user is never double-pinged.
 *
 * Fire-and-forget — the schedule is a side-effect of the row write, never
 * a blocker. No-op when remindIn is absent or its scheduledAtMs is missing.
 */
function scheduleReminderIfPresent(
  remindIn: RemindIn | undefined,
  taskId: string,
  title: string,
  body: string,
): void {
  if (!remindIn || typeof remindIn.scheduledAtMs !== 'number') return;
  scheduleAt(remindIn.scheduledAtMs, { title, body });
  scheduleServerReminder(
    { title, body, category: 'REMINDER', dedupe_key: `reminder:${taskId}` },
    remindIn.scheduledAtMs,
  );
}
