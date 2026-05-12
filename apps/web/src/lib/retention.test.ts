/**
 * Unit tests for retention telemetry.
 *
 * Pure function path: trackSession(store, emit, now) — no React,
 * no globals. Tests use an in-memory store + a spy emit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { trackSession, readRetention } from './retention';

type Emission = { name: string; payload: unknown };

function makeHarness() {
  const store = createStore(createMemoryAdapter());
  const emissions: Emission[] = [];
  const emit = (name: string, payload: unknown) => {
    emissions.push({ name, payload });
  };
  return { store, emissions, emit };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 1, 12, 0, 0); // 2026-05-01 12:00 UTC

describe('retention · fresh install', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('emits installed + session_started on first ever launch', () => {
    trackSession(h.store, h.emit, T0);
    const names = h.emissions.map(e => e.name);
    expect(names).toContain('void:retention:installed');
    expect(names).toContain('void:retention:session_started');
    expect(names).not.toContain('void:retention:d1_returned');
    expect(names).not.toContain('void:retention:d7_returned');
  });

  it('records installed_at + session_count=1 in the store', () => {
    trackSession(h.store, h.emit, T0);
    const snap = readRetention(h.store);
    expect(snap.installedAt).toBe(T0);
    expect(snap.sessionCount).toBe(1);
    expect(snap.lastSessionAt).toBe(T0);
    expect(snap.d1Fired).toBe(false);
    expect(snap.d7Fired).toBe(false);
  });

  it('stamps source: "fresh" on the installed event', () => {
    trackSession(h.store, h.emit, T0);
    const installed = h.emissions.find(e => e.name === 'void:retention:installed');
    expect(installed?.payload).toMatchObject({ installed_at: T0, source: 'fresh' });
  });
});

describe('retention · returning sessions', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('does not re-fire installed on second session', () => {
    trackSession(h.store, h.emit, T0);
    h.emissions.length = 0;
    trackSession(h.store, h.emit, T0 + 2 * HOUR);
    const names = h.emissions.map(e => e.name);
    expect(names).not.toContain('void:retention:installed');
    expect(names).toContain('void:retention:session_started');
  });

  it('increments session_count across launches', () => {
    trackSession(h.store, h.emit, T0);
    trackSession(h.store, h.emit, T0 + HOUR);
    trackSession(h.store, h.emit, T0 + 2 * HOUR);
    expect(readRetention(h.store).sessionCount).toBe(3);
  });

  it('does NOT fire d1_returned for a return within 24h', () => {
    trackSession(h.store, h.emit, T0);
    h.emissions.length = 0;
    trackSession(h.store, h.emit, T0 + 23 * HOUR);
    expect(h.emissions.map(e => e.name)).not.toContain('void:retention:d1_returned');
  });
});

describe('retention · D1 milestone', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('fires d1_returned exactly once at the first ≥24h return', () => {
    trackSession(h.store, h.emit, T0);
    trackSession(h.store, h.emit, T0 + DAY + HOUR);
    trackSession(h.store, h.emit, T0 + DAY + 5 * HOUR);
    const d1s = h.emissions.filter(e => e.name === 'void:retention:d1_returned');
    expect(d1s).toHaveLength(1);
  });

  it('payload records install_at, returned_at, hours elapsed', () => {
    trackSession(h.store, h.emit, T0);
    trackSession(h.store, h.emit, T0 + DAY + 2 * HOUR);
    const d1 = h.emissions.find(e => e.name === 'void:retention:d1_returned');
    expect(d1?.payload).toMatchObject({
      installed_at: T0,
      returned_at: T0 + DAY + 2 * HOUR,
      hours: 26,
    });
  });

  it('persists d1_fired + first_return_at to the store', () => {
    trackSession(h.store, h.emit, T0);
    const returnTs = T0 + DAY + 30 * 60 * 1000;
    trackSession(h.store, h.emit, returnTs);
    const snap = readRetention(h.store);
    expect(snap.d1Fired).toBe(true);
    expect(snap.firstReturnAt).toBe(returnTs);
  });

  it('does not fire d1 on the same launch as install even if now is way past', () => {
    // Simulates clock drift / replayed install — both events same call.
    trackSession(h.store, h.emit, T0);
    const names = h.emissions.map(e => e.name);
    expect(names).not.toContain('void:retention:d1_returned');
  });
});

describe('retention · D7 milestone', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('fires d7_returned at ≥7d after install', () => {
    trackSession(h.store, h.emit, T0);
    trackSession(h.store, h.emit, T0 + 7 * DAY + HOUR);
    expect(h.emissions.map(e => e.name)).toContain('void:retention:d7_returned');
  });

  it('only fires d7 once', () => {
    trackSession(h.store, h.emit, T0);
    trackSession(h.store, h.emit, T0 + 7 * DAY + HOUR);
    trackSession(h.store, h.emit, T0 + 8 * DAY);
    const d7s = h.emissions.filter(e => e.name === 'void:retention:d7_returned');
    expect(d7s).toHaveLength(1);
  });

  it('a launch at day 8 fires both d1 and d7 once each', () => {
    trackSession(h.store, h.emit, T0);
    h.emissions.length = 0;
    trackSession(h.store, h.emit, T0 + 8 * DAY);
    const names = h.emissions.map(e => e.name);
    expect(names).toContain('void:retention:d1_returned');
    expect(names).toContain('void:retention:d7_returned');
  });
});
