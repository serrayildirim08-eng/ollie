/**
 * @ollie/notifications · electron backend (NL3)
 *
 * The Electron main process exposes the system Notification API; the
 * renderer (where this code runs) can either:
 *
 *   (a) call `new Notification(...)` directly — the HTML5 API mapped
 *       through Chromium, which Electron forwards to macOS Notification
 *       Center; OR
 *   (b) invoke an IPC channel exposed via `preload.js` that constructs
 *       a native `electron.Notification` in the main process.
 *
 * We prefer (b) because it gives us:
 *   - reliable click handlers in the main process
 *   - the ability to schedule via main-process setTimeout that survives
 *     renderer reloads
 *   - native silent/sound control
 *
 * The renderer detects whether the preload contract is in place
 * (window.ollie?.notify is a function) and falls back to the HTML5
 * route when running outside Electron.
 */

import type { NotificationBackend, NotificationSpec } from '../types';

interface PreloadBridge {
  notify: (spec: NotificationSpec) => Promise<string | undefined> | string | undefined;
  schedule: (spec: NotificationSpec, fireAt: number) => Promise<string | undefined> | string | undefined;
  cancel: (dedupe_key: string) => Promise<void> | void;
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

interface OllieWindow {
  ollie?: { notify?: PreloadBridge };
}

declare const window: Window & OllieWindow;

function bridge(): PreloadBridge | null {
  if (typeof window === 'undefined') return null;
  return window.ollie?.notify ?? null;
}

function html5(): typeof Notification | null {
  if (typeof window === 'undefined') return null;
  return (window as { Notification?: typeof Notification }).Notification ?? null;
}

const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function deliverHtml5(spec: NotificationSpec): Promise<string | undefined> {
  const Notif = html5();
  if (!Notif) return undefined;
  if (Notif.permission !== 'granted') {
    try { await Notif.requestPermission(); } catch { return undefined; }
  }
  if (Notif.permission !== 'granted') return undefined;
  try {
    const n = new Notif(spec.title, {
      body: spec.body ?? '',
      tag: spec.dedupe_key,
      silent: false,
    });
    if (spec.action_url) {
      n.onclick = () => {
        try { window.location?.assign?.(spec.action_url!); } catch { /* noop */ }
      };
    }
    return spec.dedupe_key;
  } catch (err) {
    console.warn('[notify · electron · html5] failed', err);
    return undefined;
  }
}

export const electronBackend: NotificationBackend = {
  name: 'electron',
  async deliver(spec) {
    const b = bridge();
    if (b) {
      try { return await b.notify(spec); }
      catch (err) { console.warn('[notify · electron · bridge] failed', err); }
    }
    return deliverHtml5(spec);
  },
  async schedule(spec, fireAt) {
    const b = bridge();
    if (b) {
      try { return await b.schedule(spec, fireAt); }
      catch (err) { console.warn('[notify · electron · bridge schedule] failed', err); }
    }
    // Fallback: in-renderer timer (lost on reload — the dispatcher
    // handles persistence + resume).
    const delay = Math.max(0, fireAt - Date.now());
    const t = setTimeout(() => {
      scheduledTimers.delete(spec.dedupe_key);
      void deliverHtml5(spec);
    }, delay);
    scheduledTimers.set(spec.dedupe_key, t);
    return spec.dedupe_key;
  },
  async cancel(dedupeKey) {
    const t = scheduledTimers.get(dedupeKey);
    if (t) clearTimeout(t);
    scheduledTimers.delete(dedupeKey);
    const b = bridge();
    if (b) {
      try { await b.cancel(dedupeKey); }
      catch { /* noop */ }
    }
  },
  async requestPermission() {
    const b = bridge();
    if (b?.requestPermission) return b.requestPermission();
    const Notif = html5();
    if (!Notif) return 'denied';
    if (Notif.permission === 'granted') return 'granted';
    if (Notif.permission === 'denied') return 'denied';
    try { return await Notif.requestPermission(); }
    catch { return 'denied'; }
  },
};

export async function installElectronBackend() {
  const { installBackend } = await import('../index');
  installBackend(electronBackend);
  return electronBackend;
}
