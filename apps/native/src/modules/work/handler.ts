/**
 * Work module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every work action the router
 * emits to a real repository call. Notes are kept short — the dump UX is
 * silent ("okay!" only); these notes are for dev logging + any future
 * surface that wants to show what happened.
 */

import type { ModuleHandler, HandlerResult, WorkAction } from '../../router/schema';
import { migrateWork } from './migrate';
import { tasks, events } from './repo';

export const workHandler: ModuleHandler<'work'> = {
  module: 'work',
  async apply(fragment): Promise<HandlerResult> {
    await migrateWork();
    const p = fragment.payload as WorkAction;
    switch (p.action) {
      case 'log_focus_session': {
        await events.addFocus({
          durationMin: p.durationMin ?? null,
          project: p.project ?? null,
        });
        const mins = p.durationMin != null ? `${p.durationMin}m ` : '';
        const proj = p.project ? ` on ${p.project}` : '';
        return {
          ok: true,
          note: `logged ${mins}focus${proj}`.trim(),
          deepLink: '/box/work',
        };
      }

      case 'create_task': {
        const task = await tasks.add({
          text: p.text,
          project: p.project ?? null,
          kind: 'task',
        });
        return {
          ok: true,
          note: `added task: ${task.text}`,
          deepLink: '/box/work',
        };
      }

      case 'log_deadline': {
        const task = await tasks.add({
          text: p.text,
          kind: 'deadline',
          dueDate: p.dueDate ?? null,
        });
        const when = p.dueDate ? ` (${p.dueDate})` : '';
        return {
          ok: true,
          note: `noted deadline: ${task.text}${when}`,
          deepLink: '/box/work',
        };
      }

      case 'log_meeting': {
        await events.addMeeting({
          with: p.with ?? null,
          durationMin: p.durationMin ?? null,
        });
        const who = p.with ? ` with ${p.with}` : '';
        return {
          ok: true,
          note: `logged meeting${who}`,
          deepLink: '/box/work',
        };
      }

      case 'distraction_journal': {
        await events.addDistraction({ what: p.what });
        return {
          ok: true,
          note: `noted distraction: ${p.what}`,
          deepLink: '/box/work',
        };
      }

      default:
        // Make new actions a build error rather than a silent skip.
        return exhaustive(p);
    }
  },
};

function exhaustive(p: never): never {
  throw new Error(`work: unhandled action ${JSON.stringify(p)}`);
}
