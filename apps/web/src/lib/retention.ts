/**
 * apps/web · retention telemetry
 *
 * Local-only D1 / D7 retention markers, so we can tell who came back
 * without a backend in place. Once Group C (sync) lands these same
 * events will flow up through @ollie/research-stream — the local
 * `void:retention:*` event names stay stable.
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

const NS = 'shared';
const K_INSTALLED = 'telemetry.installed_at';
const K_SESSION_COUNT = 'telemetry.session_count';
const K_FIRST_RETURN = 'telemetry.first_return_at';
const K_D1_FIRED = 'telemetry.d1_fired';
const K_D7_FIRED = 'telemetry.d7_fired';
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

  return readRetention(store);
}
