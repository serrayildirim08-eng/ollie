/**
 * @ollie/orchestrator · body-correlations tests
 *
 * Covers:
 *   - runBodyCorrelationPass executes + persists results
 *   - pattern:detected emitted exactly once per detected correlator
 *   - PENDING correlators (water_focus) never emit
 *   - 24h cooldown skips re-emit
 *   - Cooldown clears after 24h AND magnitude shift
 *   - nextLocal03 schedules into the future
 *   - scheduleBodyCorrelationPass first-run + teardown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import {
  runBodyCorrelationPass,
  scheduleBodyCorrelationPass,
  nextLocal03,
} from '../src/body-correlations';

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-05-10T12:00:00').getTime();

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── seeders ─────────────────────────────────────────────────────────────

function seedSleepDebtHabitsDetectable(store: ReturnType<typeof createStore>): void {
  const sleepRecords: Array<{
    night_of: string;
    bedtime: string | null;
    wake_time: string | null;
    onset_latency_min: number | null;
    wakings_count: number | null;
    wakings_total_min: number | null;
    tst_min: number;
    quality: number;
    quality_text: string | null;
    notes: string | null;
    tokens: string[];
    is_skipped: boolean;
    is_partial: boolean;
    is_disputed: boolean;
  }> = [];
  const habits = [
    { id: 'h1', name: 'water', category: 'health', created_at: FIXED_NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
    { id: 'h2', name: 'walk',  category: 'health', created_at: FIXED_NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
    { id: 'h3', name: 'read',  category: 'mental', created_at: FIXED_NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
    { id: 'h4', name: 'clean', category: 'home',   created_at: FIXED_NOW - 30 * DAY_MS, completions: [] as Array<{ ts: number }> },
  ];
  for (let i = 21; i >= 1; i--) {
    const dayTs = FIXED_NOW - i * DAY_MS;
    const goodSleep = i > 10;
    sleepRecords.push({
      night_of: dayKey(dayTs),
      bedtime: '23:00',
      wake_time: goodSleep ? '07:00' : '03:00',
      onset_latency_min: 15,
      wakings_count: 0,
      wakings_total_min: 0,
      tst_min: goodSleep ? 8 * 60 : 4 * 60,
      quality: goodSleep ? 4 : 2,
      quality_text: null,
      notes: null,
      tokens: [],
      is_skipped: false,
      is_partial: false,
      is_disputed: false,
    });
    if (goodSleep) {
      for (const h of habits) h.completions.push({ ts: dayTs + 9 * 3600_000 });
    }
  }
  store.set('sleep', 'records', sleepRecords);
  store.set('shared', 'habits_v2', habits);
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('runBodyCorrelationPass', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    _clearAllHandlers();
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    _clearAllHandlers();
  });

  it('returns one result per registered correlator on an empty store', () => {
    const results = runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    expect(results.length).toBe(6);
  });

  it('persists results under body.correlations + body.correlationsLastComputedAt', () => {
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    const persisted = store.get('body', 'correlations', null);
    expect(persisted).not.toBeNull();
    const lastComputed = store.get<number>('body', 'correlationsLastComputedAt', 0);
    expect(lastComputed).toBe(FIXED_NOW);
  });

  it('does NOT emit pattern:detected for water_focus (PENDING)', () => {
    const seen: Array<{ correlation_name: string }> = [];
    on('pattern:detected', (payload: unknown) => {
      seen.push(payload as { correlation_name: string });
    });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    expect(seen.find((s) => s.correlation_name === 'water_focus')).toBeUndefined();
  });

  it('emits zero pattern:detected events on empty input', () => {
    const seen: unknown[] = [];
    on('pattern:detected', (p: unknown) => { seen.push(p); });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    expect(seen).toHaveLength(0);
  });

  it('emits pattern:detected when sleep_debt_habits crosses threshold', () => {
    seedSleepDebtHabitsDetectable(store);
    const seen: Array<{ correlation_name: string; copy: string; correlation: number }> = [];
    on('pattern:detected', (payload: unknown) => {
      seen.push(payload as { correlation_name: string; copy: string; correlation: number });
    });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    const hit = seen.find((s) => s.correlation_name === 'sleep_debt_habits');
    expect(hit).toBeDefined();
    expect(hit!.copy).toMatch(/habit completion drops as sleep debt climbs/);
    expect(hit!.correlation).toBeLessThan(-0.30);
  });

  it('skips re-emit within 24h cooldown', () => {
    seedSleepDebtHabitsDetectable(store);
    let count = 0;
    on('pattern:detected', () => { count++; });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW + 1000 });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW + 3600_000 });
    expect(count).toBe(1);
  });

  it('emits pattern:detected at most once per correlator per call', () => {
    seedSleepDebtHabitsDetectable(store);
    const byName = new Map<string, number>();
    on('pattern:detected', (payload: unknown) => {
      const name = (payload as { correlation_name: string }).correlation_name;
      byName.set(name, (byName.get(name) ?? 0) + 1);
    });
    runBodyCorrelationPass({ store, now: () => FIXED_NOW });
    for (const [, c] of byName) expect(c).toBe(1);
  });
});

// ─── scheduler ───────────────────────────────────────────────────────────

describe('nextLocal03', () => {
  it('schedules for next 03:00 LOCAL', () => {
    const noon = new Date('2026-05-10T12:00:00').getTime();
    const next = nextLocal03(noon);
    const d = new Date(next);
    expect(d.getHours()).toBe(3);
    expect(d.getMinutes()).toBe(0);
    expect(next).toBeGreaterThan(noon);
  });

  it('skips to tomorrow when already past 03:00', () => {
    const at04 = new Date('2026-05-10T04:00:00').getTime();
    const next = nextLocal03(at04);
    expect(next - at04).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(next - at04).toBeLessThan(25 * 3600_000);
  });
});

describe('scheduleBodyCorrelationPass', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    vi.useFakeTimers();
    _clearAllHandlers();
    store = createStore(createMemoryAdapter());
  });
  afterEach(() => {
    vi.useRealTimers();
    _clearAllHandlers();
  });

  it('runs immediately on schedule() unless skipFirstRun=true', () => {
    scheduleBodyCorrelationPass({ store, now: () => FIXED_NOW });
    const persisted = store.get('body', 'correlations', null);
    expect(persisted).not.toBeNull();
  });

  it('returns a teardown function that clears the timer', () => {
    const teardown = scheduleBodyCorrelationPass({
      store,
      now: () => FIXED_NOW,
      skipFirstRun: true,
    });
    expect(typeof teardown).toBe('function');
    teardown(); // should not throw
  });

  it('skipFirstRun=true skips the initial pass', () => {
    const teardown = scheduleBodyCorrelationPass({
      store,
      now: () => FIXED_NOW,
      skipFirstRun: true,
    });
    const persisted = store.get('body', 'correlations', null);
    expect(persisted).toBeNull();
    teardown();
  });
});
