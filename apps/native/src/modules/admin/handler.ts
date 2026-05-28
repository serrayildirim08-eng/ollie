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

export const adminHandler: ModuleHandler<'admin'> = {
  module: 'admin',
  async apply(fragment): Promise<HandlerResult> {
    await migrateAdmin();
    const p = fragment.payload as AdminAction;
    switch (p.action) {
      case 'create_task': {
        await tasks.add({ kind: 'task', text: p.text, data: { kind: 'task' } });
        return { ok: true, note: `noted: ${p.text}`, deepLink: '/box/admin' };
      }

      case 'create_phone_task': {
        const text = p.person;
        await tasks.add({
          kind: 'phone',
          text,
          data: { kind: 'phone', reason: p.reason },
        });
        const note = p.reason ? `call ${p.person} — ${p.reason}` : `call ${p.person}`;
        return { ok: true, note, deepLink: '/box/admin' };
      }

      case 'schedule_appointment': {
        await tasks.add({
          kind: 'appointment',
          text: p.what,
          data: { kind: 'appointment', date: p.date },
        });
        const note = p.date
          ? `appointment: ${p.what} on ${p.date}`
          : `appointment: ${p.what}`;
        return { ok: true, note, deepLink: '/box/admin' };
      }

      case 'log_paperwork': {
        await tasks.add({ kind: 'paperwork', text: p.what, data: { kind: 'paperwork' } });
        return { ok: true, note: `paperwork: ${p.what}`, deepLink: '/box/admin' };
      }

      case 'recurring_decision': {
        await tasks.add({ kind: 'decision', text: p.what, data: { kind: 'decision' } });
        return { ok: true, note: `decision to revisit: ${p.what}`, deepLink: '/box/admin' };
      }

      case 'log_renewal': {
        await renewals.add({ renewalType: p.renewal_type, dueDate: p.due_date ?? null });
        const note = p.due_date
          ? `${p.renewal_type} renewal due ${p.due_date}`
          : `${p.renewal_type} renewal logged`;
        return { ok: true, note, deepLink: '/box/admin' };
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
