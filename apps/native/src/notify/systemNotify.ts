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
import { track } from '../api/analytics';

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
    // Funnel telemetry: only when the OS prompt actually ran (not the
    // already-granted short-circuit above). Fire-and-forget, consent-gated.
    track('notif_permission', { value: result === 'granted' ? 'granted' : 'denied' });
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
/** Defensive upper bound on how far out scheduleAt will arm a reminder.
 *  Callers re-derive intent-based fire times (see admin/work handlers #92),
 *  but this is a belt-and-braces guard so a bogus far-future timestamp can
 *  never arm a multi-year setTimeout or hand the OS an absurd schedule. */
const MAX_SCHEDULE_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

export function scheduleAt(
  at: number,
  payload: NotifyEventDetail,
  id: string,
): ScheduledNotificationHandle {
  const delay = at - Date.now();

  // Beyond the sane horizon — almost certainly a clock-skew / bad-input bug
  // (#92). Drop quietly rather than arm a years-long timer or hand the OS
  // garbage.
  if (delay > MAX_SCHEDULE_HORIZON_MS) {
    console.warn('[systemNotify] scheduleAt fire time beyond horizon — dropping', id);
    return { cancel: () => {} };
  }

  // Past or near-immediate (< 1s) — fire now so we don't arm a no-op timer
  // or hand the OS a fire time it would treat as "now" anyway.
  if (delay <= 1000) {
    void sendSystemNotification(payload);
    return { cancel: () => {} };
  }

  // Mutable timer slot — the native path leaves this null (OS owns the fire);
  // the fallback / non-Tauri path fills it so cancel() can clear it.
  let timerId: ReturnType<typeof setTimeout> | null = null;
  // Flips true the moment cancel() is called. The async path-decider below
  // checks this BEFORE the dynamic import and BEFORE emitting the schedule
  // event, so a cancel that races ahead of the native schedule still wins: we
  // never commit what was already cancelled. (Audit #27 — the OS notification
  // used to fire after the user undid it because cancel() ran before the
  // emit('ollie-schedule-notif') reached the Rust listener.)
  let cancelled = false;

  const armTimer = (): void => {
    // A cancel that landed while the plugin loader was resolving must not
    // arm a stale timer.
    if (cancelled) return;
    timerId = setTimeout(() => {
      void sendSystemNotification(payload);
    }, delay);
  };

  // Idempotently tell the OS to drop this id. The Rust cancel handler is a
  // no-op when nothing is scheduled under `id`, so it is always safe to emit
  // — even before (or without) a successful schedule. cancel() therefore
  // fires this unconditionally rather than gating on a "did we schedule yet?"
  // flag that the async race can leave stale.
  const cancelNative = (): void => {
    void import('@tauri-apps/api/event')
      .then(({ emit }) => emit('ollie-cancel-notif', id))
      .catch((err) => {
        console.warn('[systemNotify] cancel emit failed', err);
      });
  };

  // Decide the path asynchronously: loadNotificationPlugin() resolves whether
  // we're in a Tauri context (same __TAURI_INTERNALS__ detection used above).
  // The handle is returned synchronously; cancel() reads the flags whenever
  // it's eventually called.
  void loadNotificationPlugin().then(async (plugin) => {
    if (cancelled) return; // cancelled before we even chose a path
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
      // Re-check right before committing to the OS: cancel() may have run
      // while the dynamic import above was in flight. Without this, the emit
      // would commit a schedule the user already undid (#27).
      if (cancelled) return;
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
    } catch (err) {
      // Native scheduler unreachable/failed — fall back to the in-process
      // timer so an open app still fires (no double-fire: native didn't take).
      console.warn('[systemNotify] schedule_local_notification failed; falling back to timer', err);
      armTimer();
    }
  });

  return {
    cancel: () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      // Always emit the native cancel for this id, regardless of whether the
      // async scheduler has reached emit('ollie-schedule-notif') yet. The
      // Rust cancel handler is idempotent, so an early cancel that beats the
      // schedule still removes it once it lands — and a cancel after a
      // successful schedule removes it the obvious way. Skipped only when we
      // KNOW we're off-Tauri (no plugin), where there is nothing native to
      // cancel and the timer clear above is sufficient.
      void loadNotificationPlugin().then((plugin) => {
        if (plugin) cancelNative();
      });
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
 * Strategy: delegate to `scheduleAt`, the canonical durable scheduler.
 * It already owns both halves of audit #71:
 *   - overflow guard — drops fire times beyond MAX_SCHEDULE_HORIZON_MS so a
 *     bare setTimeout delay never overflows the 32-bit signed-int ceiling
 *     (~24.8d) and fires IMMEDIATELY.
 *   - persistence-aware path — on Tauri it EMITs to the Rust scheduler, which
 *     hands the fire time to the OS and survives app-quit. A multi-day finance
 *     bill reminder routed here is therefore NOT lost when the app closes; the
 *     in-process setTimeout is only a fallback for web preview / vitest where
 *     no native scheduler exists.
 *
 * The orchestrator's `dedupe_key` is the natural stable id — it's also what
 * the native cancel path keys on, so reusing it keeps dedup/cancel coherent.
 * Past or near-immediate fires deliver now (scheduleAt handles that too).
 */
export function scheduleSystemNotification(spec: NotificationSpec, fireAt: number): void {
  scheduleAt(
    fireAt,
    { title: spec.title, body: spec.body },
    spec.dedupe_key ?? `notif:${spec.title}:${fireAt}`,
  );
}
