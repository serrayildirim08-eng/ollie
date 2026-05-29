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
import { migrateBody } from '../body/migrate';
import { events as bodyEvents } from '../body/repo';

export const workHandler: ModuleHandler<'work'> = {
  module: 'work',
  async apply(fragment): Promise<HandlerResult> {
    await migrateWork();
    const p = fragment.payload as WorkAction;

    // Undo factories — work has TWO tables (tasks + events). Both delete-by-id.
    const undoEvent = (id: string) => () => events.remove(id);
    const undoTask = (id: string) => () => tasks.remove(id);

    switch (p.action) {
      case 'log_focus_session': {
        const focusRow = await events.addFocus({
          durationMin: p.durationMin ?? null,
          project: p.project ?? null,
        });

        // Downstream multi-route: "hyperfocused all morning, didn't eat" —
        // router classifies as work.log_focus_session and sets
        // `skipped_meals: true`. Mirror to body.log_hunger so the body box
        // notices the missed meal. Approach B (primary handler emits
        // secondary), matching grocery's price→finance pattern.
        let bodyRowId: string | null = null;
        if ((p as { skipped_meals?: boolean }).skipped_meals === true) {
          try {
            await migrateBody();
            const bodyRow = await bodyEvents.add({ kind: 'hunger', data: {} });
            bodyRowId = bodyRow.id;
          } catch (err) {
            console.error('[work] body mirror failed', err);
          }
        }

        const mins = p.durationMin != null ? `${p.durationMin}m ` : '';
        const proj = p.project ? ` on ${p.project}` : '';
        return {
          ok: true,
          note: `logged ${mins}focus${proj}`.trim(),
          deepLink: '/box/work',
          undo: async () => {
            await events.remove(focusRow.id);
            if (bodyRowId) {
              try { await bodyEvents.remove(bodyRowId); } catch { /* best-effort */ }
            }
          },
        };
      }

      case 'create_task': {
        const task = await tasks.add({
          text: p.text,
          project: p.project ?? null,
          kind: 'task',
        });
        // NOTE: tasks.add upserts on (text, done=0). Undo removes the row
        // regardless of whether it was fresh or refreshed — see finance.add_bill
        // comment for the same trade-off rationale.
        return {
          ok: true,
          note: `added task: ${task.text}`,
          deepLink: '/box/work',
          undo: undoTask(task.id),
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
          undo: undoTask(task.id),
        };
      }

      case 'log_meeting': {
        const ev = await events.addMeeting({
          with: p.with ?? null,
          durationMin: p.durationMin ?? null,
        });
        const who = p.with ? ` with ${p.with}` : '';
        return {
          ok: true,
          note: `logged meeting${who}`,
          deepLink: '/box/work',
          undo: undoEvent(ev.id),
        };
      }

      case 'distraction_journal': {
        const ev = await events.addDistraction({ what: p.what });
        return {
          ok: true,
          note: `noted distraction: ${p.what}`,
          deepLink: '/box/work',
          undo: undoEvent(ev.id),
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
