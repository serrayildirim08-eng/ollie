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

import { on as onEvent } from '@ollie/events';
import type { NotificationBackend } from '../types';

interface CapPluginRef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Plugins?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

type CapacitorGlobal = { Capacitor?: CapPluginRef };

// The two Capacitor plugins are optional peer-style deps — present only
// inside the iOS shell. We load them via a runtime-tolerant dynamic
// import to keep this package installable in environments without iOS.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynImport: (s: string) => Promise<any> =
   
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
  const g = globalThis as unknown as CapacitorGlobal;
  return Boolean(g.Capacitor?.isNativePlatform?.());
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

/**
 * Build the JSON body for the worker's `/register-token` POST.
 *
 * `user_id` is included ONLY when a non-empty session id is supplied —
 * the worker (apps/api/src/worker.ts `handleRegister`) gates its Postgres
 * `push_tokens` mirror on `if (body.user_id)`, so omitting the key (rather
 * than sending `null`) keeps that gate unambiguous. `registeredAt` is a
 * param purely so tests can pin a deterministic value.
 */
export function buildRegistrationBody(
  token: string,
  userId: string | null | undefined,
  registeredAt: number = Date.now(),
): { token: string; platform: 'ios'; registered_at: number; user_id?: string } {
  return {
    token,
    platform: 'ios',
    registered_at: registeredAt,
    ...(userId ? { user_id: userId } : {}),
  };
}

export interface CapacitorBackendOptions {
  /** Cloudflare worker endpoint that registers device tokens with APNs. */
  pushRegisterEndpoint?: string;
  /** Bearer token sent with the register POST (matches worker). */
  pushRegisterAuth?: string;
  /**
   * Returns the signed-in user's id, or null when no session exists yet.
   * Read lazily at POST time (not at boot) so it picks up a sign-in that
   * happens after `installCapacitorBackend()` runs.
   *
   * WHY THIS MATTERS: the worker (apps/api/src/worker.ts) only mirrors a
   * token into the joinable Postgres `push_tokens` table when the register
   * POST carries `user_id`. Without it the iOS token lands in KV only and
   * the cron drain's `tokensForUser()` JOIN never finds it → remote push
   * is silently never delivered.
   */
  getUserId?: () => string | null | undefined;
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
      // Local-notifications permission (covers schedule_at fires).
      const r = await localPlugin.requestPermissions();
      // Remote APNs: only relevant inside the iOS shell. This is the
      // call that pops the iOS system dialog — it now runs ONLY from an
      // explicit requestPermission() (i.e. behind the priming screen),
      // never as a side-effect of installCapacitorBackend(). On grant we
      // also kick off APNs device registration so the token flows to the
      // worker. Best-effort: a push-permission failure never downgrades
      // the local-notifications result below.
      if (isCapacitorNative() && pushPlugin) {
        try {
          const pp = await pushPlugin.requestPermissions();
          if (pp.receive === 'granted') {
            await pushPlugin.register();
          }
        } catch (err) {
          console.warn('[notify · capacitor] push permission/register failed', err);
        }
      }
      if (r.display === 'granted') return 'granted';
      if (r.display === 'denied') return 'denied';
      return 'default';
    } catch {
      return 'denied';
    }
  },
};

/**
 * Install the capacitor backend.
 *
 * IMPORTANT — no cold permission prompt: this function does NOT call
 * `requestPermissions()`. Popping the iOS system dialog at app boot with
 * zero context was the bug a prior audit flagged. The OS dialog now fires
 * only from `capacitorBackend.requestPermission()` — an explicit on-demand
 * call made behind the NotificationPrimer screen.
 *
 * What this DOES do at install time is wire the APNs `registration` /
 * `registrationError` listeners and the `auth:signed_in` re-POST hook, so
 * that once the user later grants permission (and `register()` runs inside
 * `requestPermission()`), the device token is captured and forwarded to
 * the worker with the correct `user_id`. Setting up listeners pops no
 * dialog — only `requestPermissions()` / `register()` do.
 */
export async function installCapacitorBackend(
  opts: CapacitorBackendOptions = {},
): Promise<NotificationBackend> {
  const { installBackend } = await import('../index');
  installBackend(capacitorBackend);

  if (!isCapacitorNative()) return capacitorBackend;

  await ensurePlugins();
  if (!pushPlugin) return capacitorBackend;

  // Capacitor fires the 'registration' event with the APNs device token
  // as soon as APNs hands one back — which can be BEFORE the user signs
  // in, so getUserId() may return null at that moment. We therefore keep
  // the latest token here and (re-)POST it whenever a user_id becomes
  // available: once on 'registration', and again on `auth:signed_in`.
  let latestToken: string | null = null;

  function resolveUserId(): string | null {
    try {
      return opts.getUserId?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * POST the current device token to the worker, including `user_id` when
   * a session exists. Best-effort: a failed POST never throws. Re-POSTing
   * the same token is safe — the worker upserts on `device_token`, so a
   * later call with a user_id simply rebinds the row.
   */
  async function postRegistration(): Promise<void> {
    const t = latestToken;
    if (!t) return;
    if (!opts.pushRegisterEndpoint) {
      console.log('[notify · capacitor] device token captured (no worker endpoint set):', t.slice(0, 12) + '…');
      return;
    }
    const userId = resolveUserId();
    try {
      await fetch(opts.pushRegisterEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.pushRegisterAuth ? { authorization: `Bearer ${opts.pushRegisterAuth}` } : {}),
        },
        body: JSON.stringify(buildRegistrationBody(t, userId)),
      });
    } catch (err) {
      console.warn('[notify · capacitor] push register POST failed', err);
    }
  }

  try {
    // Set up the APNs listeners NOW (this pops no dialog). The actual
    // `requestPermissions()` + `register()` that triggers the OS dialog
    // and makes APNs emit `registration` runs later, on-demand, inside
    // `capacitorBackend.requestPermission()` — behind the priming screen.
    await pushPlugin.addListener('registration', async (token: unknown) => {
      const t = (token as { value?: string })?.value;
      if (!t) return;
      latestToken = t;
      await postRegistration();
    });
    await pushPlugin.addListener('registrationError', (err: unknown) => {
      console.warn('[notify · capacitor] APNs registration error', err);
    });
    // When the user signs in AFTER the APNs token arrived, re-POST so the
    // worker can mirror the token into Postgres `push_tokens` keyed on the
    // now-known user_id. No-ops when no token has been captured yet.
    onEvent('auth:signed_in', () => { void postRegistration(); });
  } catch (err) {
    console.warn('[notify · capacitor] push listener setup failed', err);
  }

  return capacitorBackend;
}
