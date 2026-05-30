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
import { scheduleAt, sendSystemNotification } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';

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
        scheduleReminderIfPresent(p.remindIn, task.id, 'to do', p.text);
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
        // "start a timer" → fire a system notification after `mins` (default
        // 30). We use an in-process setTimeout rather than scheduleAt's OS
        // path: Tauri's scheduled notifications don't defer on macOS desktop
        // (they fire immediately — a mobile-oriented feature), so a timer
        // routed there pinged instantly. setTimeout fires at the right moment
        // while the app is open / minimised. (True app-closed background is an
        // iPhone-build concern; revisit when the APNs push plugin lands.)
        const mins =
          typeof p.durationMin === 'number' && p.durationMin > 0 ? p.durationMin : 30;
        const timerId = setTimeout(() => {
          void sendSystemNotification({ title: 'timer done', body: `${mins} min up` });
        }, mins * 60_000);
        return {
          ok: true,
          note: `timer started · ${mins} min`,
          deepLink: '/box/work',
          undo: async () => {
            clearTimeout(timerId);
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
 * Schedule a reminder for the same fire time when the routed task carries a
 * worker-resolved `remindIn` hint:
 *
 *   1. scheduleAt — on Tauri this hands the reminder to the native OS local
 *      scheduler (fires even if the app is QUIT); off Tauri it falls back to
 *      an in-process setTimeout (fires while the page is open).
 *   2. server-side Supabase `scheduled_jobs` row (scheduleServerReminder)
 *      — drained by the cron → APNs, so it fires even with the app fully
 *      CLOSED. No-op when not signed in / sync off / api absent.
 *
 * All paths carry the SAME stable id (`reminder:<taskId>`) so they can never
 * double-fire. Mirrors the admin handler's helper —
 * intentionally not promoted to a shared util while only two callers exist
 * (Approach B's cross-route hint pattern keeps logic with its primary
 * handler; collapse later if a third caller appears).
 */
function scheduleReminderIfPresent(
  remindIn: RemindIn | undefined,
  taskId: string,
  title: string,
  body: string,
): void {
  if (!remindIn || typeof remindIn.scheduledAtMs !== 'number') return;
  // Same stable id across all three paths (OS local notification, in-process
  // timer, server-push job) so the dispatcher / cron dedupe to one ping.
  const id = `reminder:${taskId}`;
  scheduleAt(remindIn.scheduledAtMs, { title, body }, id);
  scheduleServerReminder(
    { title, body, category: 'REMINDER', dedupe_key: id },
    remindIn.scheduledAtMs,
  );
}
