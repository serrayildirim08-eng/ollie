/**
 * @ollie/notifications · capacitor backend (NL1 · iOS)
 *
 * Uses two Capacitor plugins, both loaded dynamically so the package
 * stays installable in environments without the iOS shell:
 *   - @capacitor/local-notifications — for schedule_at, no APNs needed
 *   - @capacitor/push-notifications — for server-driven APNs pushes
 *
 * The server side (Cloudflare Worker, see apps/api/) sends APNs pushes
 * with a custom payload that includes our NotificationSpec. The
 * receiving side here just confirms registration + relays device token
 * upstream — it does NOT call deliver() for APNs (APNs displays the
 * notification natively).
 *
 * Local-only notifications (e.g. F2 month-end savings digest fired by
 * the device while offline) go through LocalNotifications.
 */

import type { NotificationBackend, NotificationSpec } from '../types';

interface CapPluginRef<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Plugins?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

declare const globalThis: { Capacitor?: CapPluginRef<unknown> };

// The two Capacitor plugins are optional peer-style deps — present only
// inside the iOS shell. We load them via a runtime-tolerant dynamic
// import to keep this package installable in environments without iOS.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynImport: (s: string) => Promise<any> =
  // eslint-disable-next-line no-new-func
  new Function('s', 'return import(s)') as (s: string) => Promise<unknown> as never;

interface LocalNotificationsPlugin {
  schedule(opts: unknown): Promise<unknown>;
  cancel(opts: unknown): Promise<unknown>;
  requestPermissions(): Promise<{ display?: string }>;
  checkPermissions(): Promise<{ display?: string }>;
}
interface PushNotificationsPlugin {
  register(): Promise<void>;
  requestPermissions(): Promise<{ receive?: string }>;
  checkPermissions(): Promise<{ receive?: string }>;
  addListener(name: string, cb: (e: unknown) => void): Promise<unknown>;
}

async function loadLocalNotifications(): Promise<LocalNotificationsPlugin | null> {
  try {
    const mod = await dynImport('@capacitor/local-notifications');
    return (mod?.LocalNotifications ?? null) as LocalNotificationsPlugin | null;
  } catch {
    return null;
  }
}

async function loadPushNotifications(): Promise<PushNotificationsPlugin | null> {
  try {
    const mod = await dynImport('@capacitor/push-notifications');
    return (mod?.PushNotifications ?? null) as PushNotificationsPlugin | null;
  } catch {
    return null;
  }
}

function isCapacitorNative(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function dedupeKeyToNumericId(key: string): number {
  // Capacitor LocalNotifications wants numeric ids. Hash the dedupe_key
  // → 32-bit signed positive integer.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_000_000_000 + 1;
}

let localPlugin: Awaited<ReturnType<typeof loadLocalNotifications>> = null;
let pushPlugin: Awaited<ReturnType<typeof loadPushNotifications>> = null;

async function ensurePlugins(): Promise<void> {
  if (!localPlugin) localPlugin = await loadLocalNotifications();
  if (!pushPlugin) pushPlugin = await loadPushNotifications();
}

export interface CapacitorBackendOptions {
  /** Cloudflare worker endpoint that registers device tokens with APNs. */
  pushRegisterEndpoint?: string;
  /** Bearer token sent with the register POST (matches worker). */
  pushRegisterAuth?: string;
}

export const capacitorBackend: NotificationBackend = {
  name: 'capacitor',
  async deliver(spec) {
    await ensurePlugins();
    if (!localPlugin) return undefined;
    // "Deliver now" via LocalNotifications by scheduling at now()+1s.
    // Capacitor doesn't expose "show immediately"; +1s is imperceptible.
    const id = dedupeKeyToNumericId(spec.dedupe_key);
    await localPlugin.schedule({
      notifications: [{
        id,
        title: spec.title,
        body: spec.body ?? '',
        schedule: { at: new Date(Date.now() + 1000) },
        extra: { dedupe_key: spec.dedupe_key, ...spec.extra },
        actionTypeId: spec.category,
      }],
    });
    return String(id);
  },
  async schedule(spec, fireAt) {
    await ensurePlugins();
    if (!localPlugin) return undefined;
    const id = dedupeKeyToNumericId(spec.dedupe_key);
    await localPlugin.schedule({
      notifications: [{
        id,
        title: spec.title,
        body: spec.body ?? '',
        schedule: { at: new Date(fireAt) },
        extra: { dedupe_key: spec.dedupe_key, ...spec.extra },
        actionTypeId: spec.category,
      }],
    });
    return String(id);
  },
  async cancel(dedupeKey) {
    await ensurePlugins();
    if (!localPlugin) return;
    const id = dedupeKeyToNumericId(dedupeKey);
    try { await localPlugin.cancel({ notifications: [{ id }] }); }
    catch { /* noop */ }
  },
  async requestPermission() {
    await ensurePlugins();
    if (!localPlugin) return 'denied';
    try {
      const r = await localPlugin.requestPermissions();
      if (r.display === 'granted') return 'granted';
      if (r.display === 'denied') return 'denied';
      return 'default';
    } catch {
      return 'denied';
    }
  },
};

/**
 * Install the capacitor backend AND register for remote APNs pushes.
 * The returned promise resolves when the device token (if any) has
 * been forwarded to the worker.
 */
export async function installCapacitorBackend(
  opts: CapacitorBackendOptions = {},
): Promise<NotificationBackend> {
  const { installBackend } = await import('../index');
  installBackend(capacitorBackend);

  if (!isCapacitorNative()) return capacitorBackend;

  await ensurePlugins();
  if (!pushPlugin) return capacitorBackend;

  try {
    const perms = await pushPlugin.requestPermissions();
    if (perms.receive !== 'granted') return capacitorBackend;
    await pushPlugin.register();
    await pushPlugin.addListener('registration', async (token: unknown) => {
      const t = (token as { value?: string })?.value;
      if (!t) return;
      if (!opts.pushRegisterEndpoint) {
        console.log('[notify · capacitor] device token captured (no worker endpoint set):', t.slice(0, 12) + '…');
        return;
      }
      try {
        await fetch(opts.pushRegisterEndpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.pushRegisterAuth ? { authorization: `Bearer ${opts.pushRegisterAuth}` } : {}),
          },
          body: JSON.stringify({ token: t, platform: 'ios', registered_at: Date.now() }),
        });
      } catch (err) {
        console.warn('[notify · capacitor] push register POST failed', err);
      }
    });
    await pushPlugin.addListener('registrationError', (err: unknown) => {
      console.warn('[notify · capacitor] APNs registration error', err);
    });
  } catch (err) {
    console.warn('[notify · capacitor] push setup failed', err);
  }

  return capacitorBackend;
}
