/**
 * @ollie/notifications · web backend
 *
 * NL1. Browser Web Notifications API + ServiceWorker scheduling
 * fallback. Used in dev, desktop browser, and as iOS Safari PWA
 * fallback when Capacitor isn't present.
 *
 * Permission is requested lazily on first notify() call. If permission
 * is denied, we silently fall through to the console-log noop path —
 * the user explicitly opted out, no point in errors.
 */

import type { NotificationBackend, NotificationSpec } from '../types';

declare const window: {
  Notification?: typeof Notification;
  location?: { assign?: (url: string) => void };
} & Record<string, unknown>;

const platformIds = new Map<string, Notification>();
const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

function hasNotifications(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

async function ensurePermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!hasNotifications()) return 'denied';
  const Notif = window.Notification!;
  if (Notif.permission === 'granted') return 'granted';
  if (Notif.permission === 'denied') return 'denied';
  try {
    const p = await Notif.requestPermission();
    return p;
  } catch {
    return 'denied';
  }
}

function show(spec: NotificationSpec): string | undefined {
  if (!hasNotifications()) return undefined;
  const Notif = window.Notification!;
  if (Notif.permission !== 'granted') return undefined;
  try {
    const n = new Notif(spec.title, {
      body: spec.body ?? '',
      tag: spec.dedupe_key, // browser dedupe → replaces same-tag
      data: { action_url: spec.action_url, ...(spec.extra ?? {}) },
      // Brand voice: never set a notification icon that draws attention.
      silent: false,
    });
    if (spec.action_url) {
      n.onclick = () => {
        try {
          window.location?.assign?.(spec.action_url!);
        } catch {
          /* noop */
        }
      };
    }
    platformIds.set(spec.dedupe_key, n);
    return spec.dedupe_key;
  } catch (err) {
    console.warn('[notify · web] show failed', err);
    return undefined;
  }
}

export const webBackend: NotificationBackend = {
  name: 'web',
  async deliver(spec) {
    const perm = await ensurePermission();
    if (perm !== 'granted') return undefined;
    return show(spec);
  },
  schedule(spec, fireAt) {
    const delay = Math.max(0, fireAt - Date.now());
    const t = setTimeout(() => {
      scheduledTimers.delete(spec.dedupe_key);
      void show(spec);
    }, delay);
    scheduledTimers.set(spec.dedupe_key, t);
    return spec.dedupe_key;
  },
  cancel(dedupeKey) {
    const t = scheduledTimers.get(dedupeKey);
    if (t) clearTimeout(t);
    scheduledTimers.delete(dedupeKey);
    const n = platformIds.get(dedupeKey);
    try { n?.close?.(); } catch { /* noop */ }
    platformIds.delete(dedupeKey);
  },
  requestPermission: ensurePermission,
};

/** Install the web backend into the dispatcher. Call once at boot. */
export async function installWebBackend(): Promise<NotificationBackend> {
  const { installBackend } = await import('../index');
  installBackend(webBackend);
  return webBackend;
}
