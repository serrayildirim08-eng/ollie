/**
 * Admin module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every admin action the
 * router emits to a real repository call. Notes are kept short — the
 * dump UX is silent ("okay!" only); these notes feed dev logging + any
 * future surface that wants to show what happened.
 */

import type { AdminAction, ModuleHandler, HandlerResult } from '../../router/schema';
import { migrateAdmin } from './migrate';
import { renewals, tasks } from './repo';
import { inferInitialBallState } from './ballState';
import { scheduleTaskReminder } from '../../notify/taskReminder';

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
        scheduleTaskReminder(p.remindIn, task.id, {
          title: 'to do', body: p.text, module: 'admin', actionUrl: 'ollie://todo',
        });
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
        scheduleTaskReminder(p.remindIn, task.id, {
          title: 'call', body: reminderBody, module: 'admin', actionUrl: 'ollie://todo',
        });
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

