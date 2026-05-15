/**
 * apps/web · retention telemetry
 *
 * D1 / D7 retention markers. Two surfaces:
 *   1. Local `void:retention:*` event emission — the original
 *      contract, used by tests and any in-app analytics screens.
 *   2. Server bridge — when a research client is provided to
 *      `makeRetentionBridge()`, the same lifecycle events also
 *      `trackTable('retention_events', row)` so they land in the
 *      Supabase telemetry pipeline.
 *
 * Constitutional: no engagement nudges. This module only WRITES marker
 * events; it never schedules a notification or prompts the user.
 *
 * trackSession() is idempotent per session — call it once per app
 * mount via the boundary in App.tsx, which threads the store singleton
 * + the @ollie/events emit. Tests pass an isolated store + a spy emit
 * (see retention.test.ts).
 */

import type { Store } from '@ollie/store';
import type { ResearchClient } from '@ollie/research-stream';

const NS = 'shared';
const K_INSTALLED = 'telemetry.installed_at';
const K_SESSION_COUNT = 'telemetry.session_count';
const K_FIRST_RETURN = 'telemetry.first_return_at';
const K_D1_FIRED = 'telemetry.d1_fired';
const K_D7_FIRED = 'telemetry.d7_fired';
const K_D30_FIRED = 'telemetry.d30_fired';
const K_LAST_SESSION = 'telemetry.last_session_at';

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type RetentionEmit = (name: string, payload: unknown) => void;

export interface RetentionSnapshot {
  installedAt: number;
  sessionCount: number;
  lastSessionAt: number;
  firstReturnAt: number | null;
  d1Fired: boolean;
  d7Fired: boolean;
  d30Fired: boolean;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function readRetention(store: Store): RetentionSnapshot {
  return {
    installedAt: store.get<number>(NS, K_INSTALLED, 0),
    sessionCount: store.get<number>(NS, K_SESSION_COUNT, 0),
    lastSessionAt: store.get<number>(NS, K_LAST_SESSION, 0),
    firstReturnAt: store.get<number | null>(NS, K_FIRST_RETURN, null),
    d1Fired: store.get<boolean>(NS, K_D1_FIRED, false),
    d7Fired: store.get<boolean>(NS, K_D7_FIRED, false),
    d30Fired: store.get<boolean>(NS, K_D30_FIRED, false),
  };
}

export function trackSession(
  store: Store,
  emit: RetentionEmit,
  now: number = Date.now(),
): RetentionSnapshot {
  let installedAt = store.get<number>(NS, K_INSTALLED, 0);
  const isFresh = !installedAt;

  if (isFresh) {
    installedAt = now;
    store.set(NS, K_INSTALLED, now);
    emit('void:retention:installed', {
      installed_at: now,
      source: 'fresh',
      ts: now,
    });
  }

  const sessionCount = store.get<number>(NS, K_SESSION_COUNT, 0) + 1;
  store.set(NS, K_SESSION_COUNT, sessionCount);
  store.set(NS, K_LAST_SESSION, now);

  emit('void:retention:session_started', {
    session_count: sessionCount,
    hours_since_install: round1((now - installedAt) / HOUR),
    ts: now,
  });

  const sinceInstall = now - installedAt;
  const d1Fired = store.get<boolean>(NS, K_D1_FIRED, false);
  if (!d1Fired && !isFresh && sinceInstall >= DAY) {
    store.set(NS, K_FIRST_RETURN, now);
    store.set(NS, K_D1_FIRED, true);
    emit('void:retention:d1_returned', {
      installed_at: installedAt,
      returned_at: now,
      hours: round1(sinceInstall / HOUR),
    });
  }

  const d7Fired = store.get<boolean>(NS, K_D7_FIRED, false);
  if (!d7Fired && !isFresh && sinceInstall >= 7 * DAY) {
    store.set(NS, K_D7_FIRED, true);
    emit('void:retention:d7_returned', {
      installed_at: installedAt,
      returned_at: now,
      days: round1(sinceInstall / DAY),
    });
  }

  const d30Fired = store.get<boolean>(NS, K_D30_FIRED, false);
  if (!d30Fired && !isFresh && sinceInstall >= 30 * DAY) {
    store.set(NS, K_D30_FIRED, true);
    emit('void:retention:d30_returned', {
      installed_at: installedAt,
      returned_at: now,
      days: round1(sinceInstall / DAY),
    });
  }

  return readRetention(store);
}

// ─── server bridge ────────────────────────────────────────────────────────────

export interface RetentionBridgeContext {
  user_hash: string;
  device_id: string;
  country: string;
  locale: string;
  app_version: string;
}

/**
 * Build an emit-wrapper that fans out every `void:retention:*` event to
 * `research.trackTable('retention_events', row)` in addition to the inner
 * emit. Pure higher-order — easy to spy in tests.
 */
export function makeRetentionBridge(
  innerEmit: RetentionEmit,
  research: Pick<ResearchClient, 'trackTable'>,
  ctx: () => RetentionBridgeContext | null,
): RetentionEmit {
  return (name: string, payload: unknown) => {
    innerEmit(name, payload);
    if (!name.startsWith('void:retention:')) return;
    const c = ctx();
    if (!c) return;
    if (!c.user_hash) return; // pre-sign-in events — drop, no anonymous rows.

    const eventType = name.slice('void:retention:'.length);
    // Whitelist only the lifecycle event types — protects against future
    // void:retention:* events that aren't intended for the server.
    if (
      eventType !== 'installed' &&
      eventType !== 'session_started' &&
      eventType !== 'd1_returned' &&
      eventType !== 'd7_returned' &&
      eventType !== 'd30_returned'
    ) {
      return;
    }

    const p = (payload ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = {
      event_type: eventType,
      event_at: new Date(typeof p.ts === 'number' ? p.ts : Date.now()).toISOString(),
      user_hash: c.user_hash,
      device_id: c.device_id,
      country: c.country,
      locale: c.locale,
      app_version: c.app_version,
    };
    if (typeof p.session_count === 'number') {
      row.session_count = p.session_count;
    }
    if (typeof p.hours_since_install === 'number') {
      row.hours_since_install = p.hours_since_install;
    } else if (typeof p.hours === 'number') {
      row.hours_since_install = p.hours;
    }

    research.trackTable('retention_events', row);
  };
}

