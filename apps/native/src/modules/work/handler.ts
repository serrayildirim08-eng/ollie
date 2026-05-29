/**
 * Work module · handler.
 *
 * Replaces the stub in modules/stubs.ts. Maps every work action the router
 * emits to a real repository call. Notes are kept short — the dump UX is
 * silent ("okay!" only); these notes are for dev logging + any future
 * surface that wants to show what happened.
 */

import type { ModuleHandler, HandlerResult, WorkAction, RemindIn } from '../../router/schema';
import { migrateWork } from './migrate';
import { tasks, events } from './repo';
import { migrateBody } from '../body/migrate';
import { events as bodyEvents } from '../body/repo';
import { scheduleAt } from '../../notify/systemNotify';

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
        // Time-deferred reminder side-effect (Approach B). The worker resolved
        // scheduledAtMs against its clock; we just hand it to the OS.
        scheduleReminderIfPresent(p.remindIn, 'to do', p.text);
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

      case 'start_timer': {
        // "start a timer" → background system notification at now + duration
        // (default 30 min). scheduleAt prefers the durable Tauri OS scheduler
        // so it fires even if the app is closed. No DB row — a timer isn't a
        // logged focus session until it actually completes.
        const mins =
          typeof p.durationMin === 'number' && p.durationMin > 0 ? p.durationMin : 30;
        const handle = scheduleAt(Date.now() + mins * 60_000, {
          title: 'timer done',
          body: `${mins} min up`,
        });
        return {
          ok: true,
          note: `timer started · ${mins} min`,
          deepLink: '/box/work',
          // Undo cancels the pending fire (in-process path; an already
          // OS-scheduled notification may still surface — best effort).
          undo: async () => {
            handle.cancel();
          },
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

/**
 * Fire a scheduled system notification when the routed task carries a
 * worker-resolved `remindIn` hint. Mirrors the admin handler's helper —
 * intentionally not promoted to a shared util while only two callers exist
 * (Approach B's cross-route hint pattern keeps logic with its primary
 * handler; collapse later if a third caller appears).
 */
function scheduleReminderIfPresent(
  remindIn: RemindIn | undefined,
  title: string,
  body: string,
): void {
  if (!remindIn || typeof remindIn.scheduledAtMs !== 'number') return;
  scheduleAt(remindIn.scheduledAtMs, { title, body });
}
