/**
 * apps/native · api/analytics.ts — funnel + retention telemetry
 *
 * Two thin surfaces:
 *   - track(eventType, extra?)  → one funnel_events row (activation funnel)
 *   - initAnalytics()           → boot-time retention_events rows
 *                                 (installed / session_started / dN_returned)
 *
 * Everything here is fire-and-forget: never throws, never blocks a user
 * flow, silently no-ops when offline / signed-out / consent withheld.
 *
 * Consent: gated on @ollie/consent hasNecessaryConsent() — no necessary
 * consent, no telemetry. The store is imported LAZILY (dynamic import)
 * because ../store statically imports notify/systemNotify, which imports
 * this module (notif_permission tracking) — a static import here would
 * close that cycle at boot.
 *
 * Auth: /ingest-event requires a verified Clerk JWT (the worker derives
 * user_hash from the token's sub; the client-sent value is a placeholder).
 * The token getter lives in React (useAuth), so AnalyticsBridge in the
 * router calls setAnalyticsBearer() once signed in; events emitted before
 * that are queued (bounded) and flushed when the bearer arrives.
 */

import { ingestEvent } from './workers';
import { kv } from '../storage';
import { newId } from '../storage/id';

// ─── event types ─────────────────────────────────────────────────────────────

export type FunnelEventType =
  | 'onboarding_completed'
  | 'first_dump'
  | 'dump_submitted'
  | 'route_corrected'
  | 'notif_permission'
  | 'account_deleted';

// ─── persisted keys ──────────────────────────────────────────────────────────

const INSTALL_TS_KEY = 'analytics.install_ts';
const SESSION_COUNT_KEY = 'analytics.session_count';
const DEVICE_ID_KEY = 'analytics.device_id';
/** Once-ever event flags, e.g. `analytics.sent.first_dump`. */
const SENT_PREFIX = 'analytics.sent.';

// ─── bearer wiring ───────────────────────────────────────────────────────────

type BearerGetter = () => Promise<string | null>;

let bearerGetter: BearerGetter | null = null;

/** Events emitted before sign-in resolve; bounded so a signed-out session
 *  can't grow the queue without limit. */
const MAX_QUEUE = 32;
const pending: Array<() => Promise<void>> = [];

/**
 * Wire the Clerk token getter (from useAuth().getToken) and flush anything
 * queued before sign-in. Called by AnalyticsBridge inside <SignedIn>.
 */
export function setAnalyticsBearer(fn: BearerGetter): void {
  bearerGetter = fn;
  const jobs = pending.splice(0);
  for (const job of jobs) void job().catch(() => {});
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** App version: Tauri config version when native, package fallback in web
 *  preview. Cached after first resolve. */
let appVersionCache: string | null = null;
async function appVersion(): Promise<string> {
  if (appVersionCache) return appVersionCache;
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { getVersion } = await import('@tauri-apps/api/app');
      appVersionCache = await getVersion();
      return appVersionCache;
    }
  } catch {
    /* fall through */
  }
  appVersionCache = '0.0.0-web';
  return appVersionCache;
}

async function consentGranted(): Promise<boolean> {
  try {
    // Lazy imports — see module docblock (boot-cycle avoidance).
    const [{ hasNecessaryConsent }, { store }] = await Promise.all([
      import('@ollie/consent'),
      import('../store'),
    ]);
    return hasNecessaryConsent(store);
  } catch {
    return false;
  }
}

async function installTs(): Promise<number | null> {
  return kv.get<number>(INSTALL_TS_KEY);
}

function minutesSince(ts: number): number {
  return Math.round(((Date.now() - ts) / 60_000) * 10) / 10;
}

/** Run `job` now when the bearer is wired, else queue it (bounded). */
function whenAuthed(job: () => Promise<void>): void {
  if (bearerGetter) {
    void job().catch(() => {});
    return;
  }
  if (pending.length < MAX_QUEUE) pending.push(job);
}

/** POST one row via the worker. Silently no-ops on any failure. */
async function send(table: 'funnel_events' | 'retention_events', row: Record<string, unknown>): Promise<void> {
  if (!(await consentGranted())) return;
  const jwt = await bearerGetter?.().catch(() => null);
  if (!jwt) return;
  // `user_hash` placeholder: the worker overwrites it with the hash derived
  // from the verified Clerk sub (handleIngestEvent IDOR guard); it just has
  // to be PRESENT in the row to be forced + survive the column whitelist.
  await ingestEvent({ table, row: { user_hash: '', ...row } }, { authJwt: jwt });
}

// ─── track() — funnel events ─────────────────────────────────────────────────

/**
 * Record one activation-funnel event. Fire-and-forget: never throws,
 * never blocks; drops silently when consent is withheld or signed out.
 */
export function track(
  eventType: FunnelEventType,
  extra: Record<string, unknown> = {},
): void {
  try {
    whenAuthed(async () => {
      const ts = await installTs();
      await send('funnel_events', {
        event_type: eventType,
        app: 'ollie',
        app_version: await appVersion(),
        ...(ts != null ? { minutes_since_install: minutesSince(ts) } : {}),
        ...extra,
      });
    });
  } catch {
    /* never throws */
  }
}

/**
 * Record a funnel event AT MOST ONCE EVER (persisted flag), e.g.
 * first_dump / onboarding_completed. Same fire-and-forget contract.
 */
export function trackOnce(
  eventType: FunnelEventType,
  extra: Record<string, unknown> = {},
): void {
  try {
    void (async () => {
      const flagKey = `${SENT_PREFIX}${eventType}`;
      if (await kv.get<boolean>(flagKey)) return;
      // Flag BEFORE the network call — a lost row beats a duplicate "once"
      // event, and the send path already tolerates silent drops.
      await kv.set(flagKey, true);
      track(eventType, extra);
    })().catch(() => {});
  } catch {
    /* never throws */
  }
}

// ─── initAnalytics() — boot retention events ─────────────────────────────────

const RETURN_MILESTONES: Array<{ event: 'd1_returned' | 'd7_returned' | 'd30_returned'; ms: number }> = [
  { event: 'd1_returned', ms: 24 * 60 * 60 * 1000 },
  { event: 'd7_returned', ms: 7 * 24 * 60 * 60 * 1000 },
  { event: 'd30_returned', ms: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * Boot-time retention markers. Call once from main.tsx (non-blocking):
 *   - persists install_ts on very first run + emits 'installed' once
 *   - emits 'session_started' each boot (session_count, hours_since_install)
 *   - emits d1/d7/d30_returned each at most once past 24h / 7d / 30d
 */
export function initAnalytics(): void {
  void (async () => {
    let ts = await installTs();
    const firstRun = ts == null;
    if (ts == null) {
      ts = Date.now();
      await kv.set(INSTALL_TS_KEY, ts);
    }
    const installedAt = ts;

    const sessionCount = ((await kv.get<number>(SESSION_COUNT_KEY)) ?? 0) + 1;
    await kv.set(SESSION_COUNT_KEY, sessionCount);

    let deviceId = await kv.get<string>(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = newId('dev_');
      await kv.set(DEVICE_ID_KEY, deviceId);
    }

    const hoursSinceInstall =
      Math.round(((Date.now() - installedAt) / 3_600_000) * 100) / 100;
    // retention_events columns are NOT NULL — locale/country best-effort.
    const locale =
      (typeof navigator !== 'undefined' && navigator.language) || 'unknown';
    const base = {
      event_at: new Date().toISOString(),
      country: 'unknown', // no geo lookup client-side; worker/DB analysis can join later
      locale,
      device_id: deviceId,
    };

    const events: Array<Record<string, unknown>> = [];
    if (firstRun) {
      events.push({ ...base, event_type: 'installed', session_count: 1, hours_since_install: 0 });
    }
    events.push({
      ...base,
      event_type: 'session_started',
      session_count: sessionCount,
      hours_since_install: hoursSinceInstall,
    });
    for (const m of RETURN_MILESTONES) {
      if (Date.now() - installedAt < m.ms) continue;
      const flagKey = `${SENT_PREFIX}${m.event}`;
      if (await kv.get<boolean>(flagKey)) continue;
      await kv.set(flagKey, true); // once ever — flag first, same as trackOnce
      events.push({
        ...base,
        event_type: m.event,
        session_count: sessionCount,
        hours_since_install: hoursSinceInstall,
      });
    }

    const version = await appVersion();
    for (const row of events) {
      whenAuthed(() => send('retention_events', { ...row, app_version: version }));
    }
  })().catch(() => {});
}
