/**
 * apps/native · server-side reminder bridge (durable, app-closed delivery)
 *
 * The client-side `scheduleAt` setTimeout (see ./systemNotify) fires a
 * reminder only while the app process is alive — it dies on app QUIT and
 * iOS freezes JS timers once backgrounded. For TRUE app-fully-closed
 * delivery a reminder must also be promoted to a server-side Supabase
 * `scheduled_jobs` row, which the Cloudflare cron drains → APNs push.
 *
 * THE SEAM: the reminder handlers (admin / work) are pure — they don't
 * carry auth / api / userId. So we mirror the store.ts pattern of
 * *injecting* a capability rather than importing auth into handlers:
 * this module holds a single module-scope `scheduleServerReminder`
 * function (default no-op) that the handlers call fire-and-forget. The
 * app composition root (see ./serverReminderBridge) installs the real
 * implementation once it can resolve `{ api, authJwt, userId, budget }`
 * at call time.
 *
 * Belt-and-suspenders: the handler ALSO arms the client setTimeout. Both
 * paths carry the SAME `dedupe_key` (`reminder:<taskId>`), and both the
 * notify dispatcher and the cron honor dedupe_key — so whichever fires
 * first wins and the user never gets a double ping.
 *
 * Degrades gracefully: the default is a no-op, and the real installer's
 * resolver returns early (no api / not signed in / sync disabled) so the
 * primary row write is never blocked or broken.
 */

import type { NotificationSpec } from '@ollie/notifications';

/**
 * Injected capability: promote a reminder to a durable server-side job.
 * Fire-and-forget — never throws, never blocks the caller's row write.
 *
 *   spec   — the NotificationSpec (category 'REMINDER', stable dedupe_key)
 *   fireAt — absolute wall-clock ms when the push should fire
 */
export type ScheduleServerReminder = (spec: NotificationSpec, fireAt: number) => void;

const noop: ScheduleServerReminder = () => {};

let current: ScheduleServerReminder = noop;

/**
 * Install the real server-reminder capability. Called once from the app
 * composition root. Idempotent — last writer wins (HMR-safe).
 */
export function setServerReminder(fn: ScheduleServerReminder): void {
  current = fn;
}

/**
 * Restore the default no-op. Called on sign-out / auth-identity change so
 * a stale closure can never POST under the previous user's identity, and
 * by tests to start from a clean slate.
 */
export function clearServerReminder(): void {
  current = noop;
}

/**
 * Schedule a durable server-side reminder. Safe to call from any handler:
 * before the bridge is installed (or when not signed in) this is a no-op.
 */
export function scheduleServerReminder(spec: NotificationSpec, fireAt: number): void {
  try {
    current(spec, fireAt);
  } catch (err) {
    // A bridge failure must never surface to the handler / break the row.
    console.warn('[serverReminder] scheduleServerReminder failed', err);
  }
}
