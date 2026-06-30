/**
 * apps/native · notify/tauriBackend.ts  —  @ollie/notifications backend for Tauri.
 *
 * WHY THIS EXISTS (audit S8 · gap 2)
 * ──────────────────────────────────
 * `@ollie/notifications` ships with a NOOP backend (console.log only) and the
 * host app is expected to `installBackend()` a real one at boot. apps/web wires
 * the web backend; apps/native never wired ANY backend — so every `notify()`
 * call (most importantly the cadence-scanner's overdue cues: grocery restock,
 * household chores, pet feed, medication, …) reached the NOOP backend and NEVER
 * surfaced on the device. This is the root of "my reminders never arrive".
 *
 * This backend bridges the dispatcher's deliver / schedule / cancel onto the
 * real Tauri OS notification path already used by per-task reminders
 * (`./systemNotify`), so cadence cues finally reach Notification Center / the
 * iOS lock screen.
 *
 * It deliberately delegates ALL Tauri-vs-fallback detection to systemNotify:
 *   - deliver  → sendSystemNotification (Tauri plugin, else console fallback)
 *   - schedule → scheduleAt (durable native OS scheduler on Tauri, else timer)
 *   - cancel   → emits `ollie-cancel-notif` (idempotent Rust handler)
 *
 * No-double-delivery: the dispatcher (`@ollie/notifications`) only arms its own
 * in-process fallback timer when `schedule()` returns a FALSY platform id. We
 * return a truthy id (the dedupe_key) because `scheduleAt` already owns the
 * fire — either via the native OS scheduler (Tauri) or its own setTimeout
 * fallback (web preview / vitest). Returning truthy keeps the dispatcher from
 * arming a second timer for the same fire (the NC6 double-push guard).
 *
 * Suppression / budget / dedupe / quiet-hours all live INSIDE notify() and are
 * applied before deliver/schedule are ever called — installing the store
 * (see store.ts) activates them. This backend is intentionally "dumb": it only
 * performs the final OS hand-off.
 */

import type { NotificationBackend, NotificationSpec } from '@ollie/notifications';
import {
  sendSystemNotification,
  scheduleAt,
  requestNotificationPermission,
  checkNotificationPermission,
} from './systemNotify';

/** Stable id for a spec — prefer the dedupe_key so cancel() lines up. */
function specId(spec: NotificationSpec, fireAt?: number): string {
  return spec.dedupe_key ?? `notif:${spec.title}:${fireAt ?? Date.now()}`;
}

export const tauriBackend: NotificationBackend = {
  name: 'tauri',

  async deliver(spec: NotificationSpec): Promise<string | undefined> {
    await sendSystemNotification({
      title: spec.title,
      body: spec.body,
      extra: spec.extra,
    });
    // Immediate delivery has no cancellable platform handle to report.
    return undefined;
  },

  schedule(spec: NotificationSpec, fireAt: number): string | undefined {
    const id = specId(spec, fireAt);
    // scheduleAt owns the fire (native OS scheduler on Tauri, timer otherwise).
    scheduleAt(fireAt, { title: spec.title, body: spec.body }, id);
    // Return a truthy id so the dispatcher does NOT also arm an in-process
    // timer for the same fire — scheduleAt already covers both contexts.
    return id;
  },

  cancel(dedupeKey: string): void {
    // Mirror systemNotify's cancelNative: idempotent emit; the Rust handler is
    // a no-op when nothing is scheduled under this id, so it's always safe.
    void import('@tauri-apps/api/event')
      .then(({ emit }) => emit('ollie-cancel-notif', dedupeKey))
      .catch((err) => {
        console.warn('[tauriBackend] cancel emit failed', err);
      });
  },

  async requestPermission(): Promise<'granted' | 'denied' | 'default'> {
    const granted = await requestNotificationPermission();
    return granted ? 'granted' : 'denied';
  },

  async checkPermission(): Promise<'granted' | 'denied' | 'default'> {
    return checkNotificationPermission();
  },
};
