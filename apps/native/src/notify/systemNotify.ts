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

interface PluginScheduleApi {
  /** Tauri 2.x: `Schedule.at(date, repeating?, allowWhileIdle?)` */
  at: (date: Date, repeating?: boolean, allowWhileIdle?: boolean) => unknown;
}

interface PluginApi {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
  sendNotification: (opts: {
    title: string;
    body?: string;
    schedule?: unknown;
    icon?: string;
    sound?: string;
  }) => void;
  Schedule: PluginScheduleApi;
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
      Schedule: mod.Schedule,
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
export async function sendSystemNotification({ title, body }: NotifyEventDetail): Promise<void> {
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
    });
  } catch (err) {
    console.warn('[systemNotify] sendNotification failed', err);
  }
}

// ─── scheduled delivery (ad-hoc reminders) ────────────────────────────────

/** Returned from `scheduleAt` — `cancel()` aborts the pending fire if it
 *  hasn't happened yet. For the Tauri schedule path cancellation only works
 *  on the in-process record (the OS-scheduled notification will still fire);
 *  for the setTimeout fallback it clears the timer cleanly. */
export interface ScheduledNotificationHandle {
  cancel(): void;
}

/**
 * Schedule a system notification to fire at an absolute wall-clock time.
 *
 * Strategy (in order of preference):
 *   1. Tauri plugin's native `schedule: Schedule.at(date)` — survives app
 *      restarts because the OS holds the pending notification.
 *   2. Fallback: in-process `setTimeout` — works in web preview / vitest but
 *      does NOT survive an app restart. Use only for short timers in
 *      non-Tauri contexts (the production use-case for time-deferred
 *      reminders always lives inside the Tauri shell on desktop).
 *
 * Permission is checked once; if denied we drop quietly (matches
 * sendSystemNotification's silent-drop behaviour — the in-app surfaces
 * still record the underlying row regardless).
 *
 * Never throws; all upstream failures degrade to console.warn so the
 * primary row write that triggered this call is never undone.
 */
export function scheduleAt(
  at: number,
  payload: NotifyEventDetail,
): ScheduledNotificationHandle {
  const now = Date.now();
  const delay = at - now;

  // Past or near-immediate (< 1s) — just fire now via the in-process path so
  // we never round-trip through the OS scheduler for a no-op delay.
  if (delay <= 1000) {
    void sendSystemNotification(payload);
    return { cancel: () => {} };
  }

  let cancelled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  void (async () => {
    const plugin = await loadNotificationPlugin();
    if (cancelled) return;

    // ── Tauri native path — preferred when the plugin reports a Schedule. ──
    if (plugin && typeof plugin.Schedule?.at === 'function') {
      try {
        const granted = await plugin.isPermissionGranted();
        if (!granted) return;
        if (cancelled) return;
        const schedule = plugin.Schedule.at(new Date(at));
        plugin.sendNotification({
          title: payload.title,
          body: payload.body,
          schedule,
        });
        return;
      } catch (err) {
        // Fall through to setTimeout below — the OS may have rejected the
        // schedule (permissions, daemon down, etc). The in-process timer is
        // a safe last-resort even if it won't survive a restart.
        console.warn('[systemNotify] schedule.at failed, falling back', err);
      }
    }

    // ── setTimeout fallback — web preview, vitest, plugin path failed. ──
    // NOT durable across app restarts; acceptable for short ad-hoc reminders.
    timerId = setTimeout(() => {
      void sendSystemNotification(payload);
    }, Math.max(0, at - Date.now()));
  })();

  return {
    cancel: () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
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
