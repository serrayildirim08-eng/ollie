/**
 * apps/native · system notifications via Tauri's first-party notification plugin.
 *
 * Three responsibilities:
 *
 *   1. permission flow — `requestNotificationPermission()` checks first
 *      via `isPermissionGranted`, requests only if not granted. Idempotent
 *      and safe to call multiple times. Never re-prompts a denied user.
 *
 *   2. system delivery — `sendSystemNotification({ title, body })` fires
 *      a real macOS Notification Center / Windows toast / GNOME bubble.
 *      Gracefully degrades to `console.log` when the Tauri plugin isn't
 *      reachable (web `pnpm dev` preview, vitest jsdom, browser HMR
 *      reload before runtime injects the IPC bridge). The cadence
 *      scanner's in-app @ollie/notifications surface stays as the
 *      always-on fallback log — this module is additive.
 *
 *   3. event bridge — `installNotifyListener()` subscribes to the
 *      `ollie:notify` CustomEvent on window. Anything that fires
 *      `window.dispatchEvent(new CustomEvent('ollie:notify', { detail:
 *      { title, body } }))` gets a system notification.
 *
 *      Current emitters (contract owners):
 *        - work module's FocusTimer (frontend-junior-1, parallel sprint)
 *        - cadence scanner via the orchestrator's `scheduleNotification`
 *          injection in `store.ts` (this milestone)
 *        - any future feature that wants a quiet, fire-and-forget
 *          system ping — no orchestrator wiring required.
 *
 * Out of scope (separate milestone):
 *   - APNs / iPhone push (cycle/sleep/body scheduled notifications still
 *     fall through to in-app log on desktop until the push plugin lands)
 *   - action buttons / images / sound customisation
 *   - Linux fallback paths beyond what the Tauri plugin handles
 */

import type { NotificationSpec } from '@ollie/notifications';

/** Shape of a CustomEvent we listen for on `window`. */
export interface NotifyEventDetail {
  title: string;
  body?: string;
  /** Registered category id → shows action buttons (A3). */
  actionTypeId?: string;
  /** Carried back to onAction so it knows what row to act on (A3). */
  extra?: Record<string, unknown>;
}

/** Public custom-event name. Stable contract — do not rename. */
export const NOTIFY_EVENT = 'ollie:notify';

// ─── plugin loader (lazy, soft) ────────────────────────────────────────────
//
// We can't statically import `@tauri-apps/plugin-notification` because the
// module would be evaluated in jsdom / browser-preview contexts where
// `@tauri-apps/api` core throws if no IPC bridge exists. Dynamic import +
// try/catch keeps the same source file working in:
//   - Tauri WebView (plugin reachable, real notifications)
//   - pnpm dev browser preview (no IPC, falls back to console.log)
//   - vitest jsdom (mocked or null)

interface PluginApi {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
  sendNotification: (opts: {
    title: string;
    body?: string;
    icon?: string;
    sound?: string;
    actionTypeId?: string;
    extra?: Record<string, unknown>;
  }) => void;
}

let pluginCache: PluginApi | null | undefined;

/**
 * Resolve the Tauri notification plugin once, cache the result. `null`
 * means we're not in a Tauri context — every subsequent call short-circuits.
 *
 * Detection heuristic: presence of `window.__TAURI_INTERNALS__`, which the
 * Tauri runtime injects before user JS runs. Tauri 2.x guarantees this.
 */
export async function loadNotificationPlugin(): Promise<PluginApi | null> {
  if (pluginCache !== undefined) return pluginCache;
  if (typeof window === 'undefined') {
    pluginCache = null;
    return null;
  }
  const taurified = (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  if (!taurified) {
    pluginCache = null;
    return null;
  }
  try {
    const mod = (await import('@tauri-apps/plugin-notification')) as unknown as PluginApi;
    pluginCache = {
      isPermissionGranted: mod.isPermissionGranted,
      requestPermission: mod.requestPermission,
      sendNotification: mod.sendNotification,
    };
    return pluginCache;
  } catch (err) {
    console.warn('[systemNotify] plugin import failed', err);
    pluginCache = null;
    return null;
  }
}

/** Test-only: reset the plugin cache so the next call re-resolves. */
export function _resetPluginCacheForTests(): void {
  pluginCache = undefined;
}

// ─── permission ────────────────────────────────────────────────────────────

/**
 * Returns the final permission state after (optionally) prompting.
 *
 * Behaviour:
 *   - no Tauri plugin (web preview, jsdom)     → `false`
 *   - already granted                          → `true` (no prompt)
 *   - default (never asked) → prompts          → returns user's choice
 *   - already denied                           → `false` (no re-prompt)
 *
 * Safe to call from a click handler. Never throws.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const plugin = await loadNotificationPlugin();
  if (!plugin) return false;
  try {
    const granted = await plugin.isPermissionGranted();
    if (granted) return true;
    const result = await plugin.requestPermission();
    return result === 'granted';
  } catch (err) {
    console.warn('[systemNotify] permission flow failed', err);
    return false;
  }
}

/**
 * Read current permission WITHOUT prompting. Used by the UI to decide
 * whether to render the editorial prime line.
 *
 * Resolves to:
 *   - `'granted'` when the OS already trusts us
 *   - `'denied'`  when the user has refused (we never re-ask)
 *   - `'default'` when we've never asked OR there's no plugin
 */
export async function checkNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  const plugin = await loadNotificationPlugin();
  if (!plugin) return 'default';
  try {
    const granted = await plugin.isPermissionGranted();
    return granted ? 'granted' : 'default';
  } catch {
    return 'default';
  }
}

// ─── deliver ───────────────────────────────────────────────────────────────

/**
 * Fire a system notification — falls back to console.log when there's
 * no Tauri plugin (web preview, tests). Never throws.
 *
 * The cadence scanner's @ollie/notifications surface is the always-on
 * in-app log; this function is the *additional* native OS ping that
 * surfaces even when the app window is minimised.
 */
export async function sendSystemNotification({ title, body, actionTypeId, extra }: NotifyEventDetail): Promise<void> {
  const plugin = await loadNotificationPlugin();
  if (!plugin) {
    // Web preview / vitest fallback — visible in the dev console.
    console.log(`[systemNotify · fallback] ${title}${body ? ' · ' + body : ''}`);
    return;
  }
  try {
    const granted = await plugin.isPermissionGranted();
    if (!granted) {
      // Quietly drop — the in-app notify() log will still fire.
      // We do NOT auto-prompt here; permission requests must come from
      // a user gesture (see requestNotificationPermission()).
      return;
    }
    // Ollie wordmark icon (cream ceramic + DM Serif lowercase 'o') — shipped
    // with the app bundle. macOS dev-mode notifications otherwise fall back to
    // the launcher's icon (terminal glyph), which is what shipped commit
    // 31e2e19 surfaced and Serra rightly hated.
    plugin.sendNotification({
      title,
      body,
      icon: 'icons/128x128.png',
      sound: 'default',
      actionTypeId,
      extra,
    });
  } catch (err) {
    console.warn('[systemNotify] sendNotification failed', err);
  }
}

// ─── scheduled delivery (ad-hoc reminders) ────────────────────────────────

/** Returned from `scheduleAt` — `cancel()` aborts the pending fire if it
 *  hasn't happened yet. In a Tauri context this cancels the OS-held local
 *  notification (via `cancel_local_notification`); in the setTimeout fallback
 *  it clears the timer cleanly. Never throws. */
export interface ScheduledNotificationHandle {
  cancel(): void;
}

/**
 * Schedule a system notification to fire at an absolute wall-clock time,
 * keyed by a stable `id` so the OS notification can be deduped / cancelled.
 *
 * Two strategies, picked by context:
 *
 *   1. Tauri (macOS / iOS) — the DURABLE path. We hand the reminder to the
 *      native OS local-notification scheduler via the Rust command
 *      `schedule_local_notification`. The OS holds it and fires it at the
 *      right wall-clock moment EVEN IF THE APP IS QUIT — the in-process timer
 *      can't do that (it dies with the process; iOS freezes JS timers when
 *      backgrounded). We do NOT also arm a setTimeout on this path, or the
 *      reminder would double-fire (OS + timer). If the invoke rejects we warn
 *      and fall back to a setTimeout so an open app still pings.
 *
 *   2. Web preview / vitest — in-process `setTimeout`. No native scheduler
 *      reachable, so this keeps dev/preview working; fires while the page is
 *      open.
 *
 * History: we used to take the setTimeout path on Tauri too, deliberately
 * avoiding the plugin's `Schedule.at(date)` (mobile-oriented, fired instantly
 * on macOS desktop — the "remind me to call mama in 1 minute → pings now" bug
 * Serra hit). The new Rust `schedule_local_notification` command is the real
 * deferred OS scheduler that behaves correctly on both platforms, so it
 * supersedes the timer on Tauri. The work module's `start_timer` still uses a
 * raw setTimeout (see modules/work/handler.ts → start_timer).
 *
 * This composes alongside the server-push path (scheduleServerReminder → cron
 * → APNs): all three (OS local, in-process timer, server job) share the SAME
 * stable id (`reminder:<taskId>`), and the notify dispatcher + cron honor
 * dedupe_key — so whichever lands first wins, never a double ping.
 *
 * Permission is checked at fire-time inside sendSystemNotification (timer
 * path) / by the OS (native path); if denied we drop quietly.
 *
 * Never throws.
 */
export function scheduleAt(
  at: number,
  payload: NotifyEventDetail,
  id: string,
): ScheduledNotificationHandle {
  const delay = at - Date.now();

  // Past or near-immediate (< 1s) — fire now so we don't arm a no-op timer
  // or hand the OS a fire time it would treat as "now" anyway.
  if (delay <= 1000) {
    void sendSystemNotification(payload);
    return { cancel: () => {} };
  }

  // Mutable timer slot — the native path leaves this null (OS owns the fire);
  // the fallback / non-Tauri path fills it so cancel() can clear it.
  let timerId: ReturnType<typeof setTimeout> | null = null;
  // Set once we've committed to the native OS scheduler, so cancel() knows to
  // route through `cancel_local_notification` instead of clearing a timer.
  let nativeScheduled = false;

  const armTimer = (): void => {
    timerId = setTimeout(() => {
      void sendSystemNotification(payload);
    }, delay);
  };

  // Decide the path asynchronously: loadNotificationPlugin() resolves whether
  // we're in a Tauri context (same __TAURI_INTERNALS__ detection used above).
  // The handle is returned synchronously; cancel() reads the flags whenever
  // it's eventually called.
  void loadNotificationPlugin().then(async (plugin) => {
    if (!plugin) {
      // Web preview / vitest — no native scheduler, keep the timer fallback.
      armTimer();
      return;
    }
    try {
      // The app is served over http://localhost, so the webview is a "remote"
      // origin and the ACL blocks direct invoke() of our app commands. Events
      // are permitted (core:event:default), so we EMIT and the Rust setup
      // listener schedules. This is the path that survives app-quit.
      const { emit } = await import('@tauri-apps/api/event');
      await emit('ollie-schedule-notif', {
        id,
        title: payload.title,
        body: payload.body,
        // Rust deserializes snake_case fields.
        fire_at_ms: at,
        // A3: native action buttons (macOS) — category + extra carried through
        // so the Rust delegate can route a button tap back to JS.
        category_id: payload.actionTypeId ?? null,
        extra_json: payload.extra ? JSON.stringify(payload.extra) : null,
      });
      nativeScheduled = true;
    } catch (err) {
      // Native scheduler unreachable/failed — fall back to the in-process
      // timer so an open app still fires (no double-fire: native didn't take).
      console.warn('[systemNotify] schedule_local_notification failed; falling back to timer', err);
      armTimer();
    }
  });

  return {
    cancel: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (nativeScheduled) {
        void import('@tauri-apps/api/event')
          .then(({ emit }) => emit('ollie-cancel-notif', id))
          .catch((err) => {
            console.warn('[systemNotify] cancel emit failed', err);
          });
      }
    },
  };
}

// ─── event listener ────────────────────────────────────────────────────────

/**
 * Subscribe to `window` for `ollie:notify` CustomEvents and forward each
 * one to `sendSystemNotification`. Returns a teardown function.
 *
 * The handler is fire-and-forget — it never blocks the dispatcher.
 * Malformed events (missing detail or detail.title) are silently dropped.
 *
 * Idempotent: calling install twice without teardown still results in
 * two handlers — callers own deduplication. For the app-boot singleton
 * path (main.tsx) we install once and never tear down.
 */
export function installNotifyListener(target?: Window): () => void {
  const win = target ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return () => {};

  const handler = (ev: Event): void => {
    const ce = ev as CustomEvent<NotifyEventDetail | undefined>;
    const detail = ce.detail;
    if (!detail || typeof detail.title !== 'string' || detail.title.length === 0) {
      return;
    }
    void sendSystemNotification({ title: detail.title, body: detail.body });
  };

  win.addEventListener(NOTIFY_EVENT, handler as EventListener);
  return () => {
    win.removeEventListener(NOTIFY_EVENT, handler as EventListener);
  };
}

// ─── orchestrator slot ─────────────────────────────────────────────────────

/**
 * Adapter matching the orchestrator's `scheduleNotification` signature
 * `(spec: NotificationSpec, fireAt: number) => void`.
 *
 * Strategy:
 *   - If `fireAt` is in the past or within ~1s, deliver immediately via
 *     the system path AND fall through so the caller's existing
 *     @ollie/notifications log path still runs.
 *   - Otherwise, schedule an in-process timer (matches the existing
 *     `@ollie/notifications` fallback shape — Tauri's plugin has no
 *     native scheduler in 2.x, so timer is the canonical approach).
 *
 * No persistence here — the dispatcher in @ollie/notifications already
 * persists `schedule_at` records across reloads. This adapter is the
 * thin glue between "orchestrator wants a notification at time X" and
 * the OS-level surface.
 */
export function scheduleSystemNotification(spec: NotificationSpec, fireAt: number): void {
  const now = Date.now();
  const delay = Math.max(0, fireAt - now);
  if (delay <= 0) {
    void sendSystemNotification({ title: spec.title, body: spec.body });
    return;
  }
  setTimeout(() => {
    void sendSystemNotification({ title: spec.title, body: spec.body });
  }, delay);
}
