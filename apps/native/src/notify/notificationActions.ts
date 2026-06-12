/**
 * Notification action buttons (A3) — "got it ✓" / "snooze".
 *
 * iOS/macOS show action buttons when a notification carries an
 * `actionTypeId` whose category was registered up-front via
 * `registerActionTypes`. Tapping a button (even with the app backgrounded /
 * quit) wakes the app and delivers the tap to `onAction`.
 *
 * Flow:
 *   1. registerOllieNotificationActions()  — at boot, registers the category.
 *   2. notifications carry actionTypeId = OLLIE_REMINDER_CATEGORY + extra
 *      { module, refId } so we know WHAT to act on.
 *   3. initNotificationActionRouter()      — at boot, wires onAction →
 *      complete / snooze writes.
 *
 * Standing decision (Serra): notification actions = background wake + inbox
 * fallback. "got it" completes the source row; "snooze" reschedules +1h.
 *
 * Best-effort throughout: outside a Tauri runtime every call is a no-op.
 */

import { scheduleAt } from './systemNotify';

export const OLLIE_REMINDER_CATEGORY = 'OLLIE_REMINDER';
export const ACTION_COMPLETE = 'complete';
export const ACTION_SNOOZE = 'snooze';
const SNOOZE_MS = 60 * 60 * 1000; // 1 hour

/** Extra payload a reminder carries so onAction knows what to act on. */
export interface ReminderActionMeta {
  module: 'admin' | 'work';
  refId: string;
}

async function loadPlugin(): Promise<typeof import('@tauri-apps/plugin-notification') | null> {
  if (typeof window === 'undefined') return null;
  const taurified = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!taurified) return null;
  try {
    return await import('@tauri-apps/plugin-notification');
  } catch {
    return null;
  }
}

/** Register the OLLIE_REMINDER category (two buttons). Idempotent at the OS. */
export async function registerOllieNotificationActions(): Promise<void> {
  const mod = await loadPlugin();
  if (!mod) return;
  try {
    // iOS/Android only — registers the category with the OS so the plugin path
    // shows buttons. On macOS this command doesn't exist (the native Rust path
    // in local_notifications.rs registers the category there instead), so a
    // failure here is expected and harmless.
    await mod.registerActionTypes([
      {
        id: OLLIE_REMINDER_CATEGORY,
        actions: [
          { id: ACTION_COMPLETE, title: 'Got it ✓', foreground: false },
          { id: ACTION_SNOOZE, title: 'Snooze 1h', foreground: false },
        ],
      },
    ]);
  } catch {
    /* expected on macOS desktop — native path handles categories there */
  }
}

/** The completion writer is injected so this module stays free of repo imports
 *  (and easy to test). Returns true if it handled the row. */
export type CompleteFn = (meta: ReminderActionMeta) => Promise<void>;

let _completeFn: CompleteFn | null = null;
let _unlisten: (() => void) | null = null;

/**
 * Decide what an action tap means. Pure + exported for unit tests.
 * Returns the operation to perform, or null to ignore.
 */
export function routeNotificationAction(
  actionId: string | undefined,
  meta: Partial<ReminderActionMeta> | undefined,
): { op: 'complete' | 'snooze'; meta: ReminderActionMeta } | null {
  if (!meta || (meta.module !== 'admin' && meta.module !== 'work') || !meta.refId) return null;
  const full: ReminderActionMeta = { module: meta.module, refId: meta.refId };
  if (actionId === ACTION_COMPLETE) return { op: 'complete', meta: full };
  if (actionId === ACTION_SNOOZE) return { op: 'snooze', meta: full };
  return null;
}

/**
 * Wire onAction once. `complete` performs the injected completion; `snooze`
 * reschedules the same reminder +1h via the durable scheduler.
 */
/** Apply a routed action (shared by plugin onAction + native Tauri event). */
function handleAction(actionId: string | undefined, extra: Partial<ReminderActionMeta> | undefined, title?: string, body?: string): void {
  const routed = routeNotificationAction(actionId, extra);
  if (!routed) return;
  if (routed.op === 'complete') {
    void _completeFn?.(routed.meta);
  } else {
    scheduleAt(Date.now() + SNOOZE_MS, { title: title ?? 'reminder', body }, `reminder:${routed.meta.refId}`);
  }
}

/** Native macOS path (A3): Rust delegate emits this Tauri event on button tap. */
async function initNativeActionListener(): Promise<void> {
  if (typeof window === 'undefined') return;
  const taurified = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (!taurified) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ actionId?: string; extra?: string }>('ollie-notif-action', (e) => {
      const p = e.payload;
      if (!p.actionId) return; // diagnostic/non-action payloads
      let extra: Partial<ReminderActionMeta> | undefined;
      try { extra = p.extra ? JSON.parse(p.extra) : undefined; } catch { extra = undefined; }
      handleAction(p.actionId, extra);
    });
  } catch {
    /* listener unavailable outside Tauri */
  }
}

export async function initNotificationActionRouter(complete: CompleteFn): Promise<void> {
  _completeFn = complete;
  void initNativeActionListener();
  const mod = await loadPlugin();
  if (!mod) return;
  if (_unlisten) return; // already wired
  try {
    const listener = await mod.onAction((notification) => {
      const opts = notification as unknown as {
        actionId?: string;
        extra?: Partial<ReminderActionMeta>;
        title?: string;
        body?: string;
      };
      handleAction(opts.actionId, opts.extra, opts.title, opts.body);
    });
    _unlisten = () => listener.unregister();
  } catch (err) {
    console.warn('[notifActions] onAction wiring failed', err);
  }
}

/** Test-only teardown. */
export function _resetActionRouterForTests(): void {
  if (_unlisten) _unlisten();
  _unlisten = null;
  _completeFn = null;
}
