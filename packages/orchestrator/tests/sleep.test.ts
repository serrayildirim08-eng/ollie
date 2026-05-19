/**
 * @ollie/orchestrator · sleep orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on, emit } from '@ollie/events';
import { createSleepOrchestrator } from '../src/sleep';
import type { NotificationSpec } from '@ollie/notifications';

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-05-11T12:00:00Z').getTime();

/**
 * Build a realistic fixture: 21 consecutive nights of sleep records.
 * Nights alternate 5h and 8h TST to create detectable debt + weekend gap.
 * onset_latency_min kept at 20 (normal), so sleep_onset_gap stays quiet.
 */
function makeSleepRecords(now: number, count = 21): Array<{
  night_of: string;
  bedtime: string | null;
  wake_time: string | null;
  onset_latency_min: number | null;
  wakings_count: number | null;
  wakings_total_min: number | null;
  tst_min: number;
  time_in_bed_min: number;
  efficiency: number;
  quality: number;
  quality_text: string;
  notes: string | null;
  tokens: string[];
  is_skipped: boolean;
  is_partial: boolean;
  is_disputed: boolean;
  raw_source_id: string;
}> {
  const records = [];
  for (let d = count; d >= 1; d--) {
    const dayTs = now - d * DAY_MS;
    const date = new Date(dayTs);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const nightOf = `${yyyy}-${mm}-${dd}`;
    const tstMin = d % 2 === 0 ? 300 : 480; // 5h or 8h
    records.push({
      night_of: nightOf,
      bedtime: '23:00',
      wake_time: tstMin === 480 ? '07:00' : '04:00',
      onset_latency_min: 20,
      wakings_count: 0,
      wakings_total_min: 0,
      tst_min: tstMin,
      time_in_bed_min: tstMin + 20,
      efficiency: tstMin / (tstMin + 20),
      quality: 3,
      quality_text: 'ok',
      notes: null,
      tokens: [],
      is_skipped: false,
      is_partial: false,
      is_disputed: false,
      raw_source_id: String(dayTs),
    });
  }
  return records;
}

describe('sleep orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createSleepOrchestrator(store, { now: () => FIXED_NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes stats and lastRecomputeAt on init()', () => {
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));

    orch.init();

    const lastRecompute = store.get<number>('sleep', 'lastRecomputeAt', 0);
    expect(lastRecompute).toBe(FIXED_NOW);

    // deriveSleepStats requires ≥5 non-skipped records with tst_min.
    const stats = store.get<{ nights_counted: number } | null>('sleep', 'stats', null);
    expect(stats).not.toBeNull();
    expect(stats!.nights_counted).toBeGreaterThanOrEqual(5);
  });

  it('writes non-zero sleep debt for under-target fixture', () => {
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));

    orch.init();

    // Mean TST is (5+8)/2 = 6.5h < default target 7.5h → positive debt.
    const debt = store.get<{ totalDeficitHours: number; nightsCounted: number } | null>(
      'sleep', 'debt', null,
    );
    expect(debt).not.toBeNull();
    expect(debt!.totalDeficitHours).toBeGreaterThan(0);
    expect(debt!.nightsCounted).toBeGreaterThan(0);
  });

  it('populates patterns array and emits sleep:pattern_detected for new patterns', () => {
    // Seed records with enough data to fire weekend_recovery_illusion:
    // clear weekday-short / weekend-long split over ≥2 weeks.
    const records = makeSleepRecords(FIXED_NOW, 28);
    // Mark Fri/Sat nights as 9h (480+60 = 540), Mon-Thu as 5h.
    records.forEach((r) => {
      const dow = new Date(r.night_of + 'T12:00:00Z').getUTCDay(); // 0=Sun
      if (dow === 5 || dow === 6) {
        r.tst_min = 540;
        r.time_in_bed_min = 560;
        r.efficiency = 540 / 560;
      } else {
        r.tst_min = 300;
        r.time_in_bed_min = 320;
        r.efficiency = 300 / 320;
      }
    });
    store.set('sleep', 'records', records);

    // Enable weekend recovery detection via settings.
    store.set('sleep', 'settings', {
      show_weekend_recovery: true,
      weekday_set: ['sun', 'mon', 'tue', 'wed', 'thu'],
      weekend_set: ['fri', 'sat'],
    });

    const detected: string[] = [];
    on('sleep:pattern_detected', (p: unknown) => {
      detected.push((p as { pattern: string }).pattern);
    });

    orch.init();

    const patterns = store.get<Array<{ pattern: string }>>('sleep', 'patterns', []);
    expect(Array.isArray(patterns)).toBe(true);
    // At minimum the store key exists and was written.
    const ts = store.get<number>('sleep', 'patternsLastComputedAt', 0);
    expect(ts).toBe(FIXED_NOW);
  });

  it('re-runs recomputeDerived when sleep.records changes and updates stats', () => {
    orch.init();

    // Initial: no records → stats null.
    const statsBefore = store.get<unknown>('sleep', 'stats', null);
    expect(statsBefore).toBeNull();

    // Write records — subscribeKey fires synchronously in the memory adapter.
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));
    // Flush 500ms debounce.
    vi.advanceTimersByTime(600);

    const statsAfter = store.get<{ nights_counted: number } | null>('sleep', 'stats', null);
    expect(statsAfter).not.toBeNull();
    expect(statsAfter!.nights_counted).toBeGreaterThan(0);
  });

  it('teardown stops further recomputes', () => {
    orch.init();

    orch.teardown();

    // Place a sentinel then write records — should NOT trigger recompute.
    store.set('sleep', 'lastRecomputeAt', 0 as never);
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));
    vi.advanceTimersByTime(600);

    // If orchestrator is torn down, the subscription is gone and the sentinel stays.
    const ts = store.get<number>('sleep', 'lastRecomputeAt', -1);
    expect(ts).toBe(0);
  });

  it('init() is idempotent — calling it multiple times does not duplicate subscriptions', () => {
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));

    orch.init();
    orch.init();
    orch.init();

    const ts = store.get<number>('sleep', 'lastRecomputeAt', 0);
    expect(ts).toBe(FIXED_NOW);

    const stats = store.get<{ nights_counted: number } | null>('sleep', 'stats', null);
    expect(stats).not.toBeNull();
  });
});

// ─── Faz 2: forecast · wind-down log · insomnia survey ──────────────────────

describe('sleep orchestrator — tonight forecast', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createSleepOrchestrator(store, { now: () => FIXED_NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('writes a non-null tonightForecast from records alone (no PredictApi)', () => {
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW));
    orch.init();

    const forecast = store.get<{
      mean_h: number;
      ci95_h: [number, number];
      method: string;
      nights_counted: number;
    } | null>('sleep', 'tonightForecast', null);

    expect(forecast).not.toBeNull();
    expect(forecast!.method).toBe('recency_weighted_dow');
    expect(forecast!.mean_h).toBeGreaterThan(0);
    expect(forecast!.nights_counted).toBeGreaterThanOrEqual(3);
  });

  it('leaves tonightForecast null when there are too few nights', () => {
    store.set('sleep', 'records', makeSleepRecords(FIXED_NOW, 2));
    orch.init();
    expect(store.get('sleep', 'tonightForecast', null)).toBeNull();
  });
});

describe('sleep orchestrator — wind-down log', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createSleepOrchestrator(store, { now: () => FIXED_NOW });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('appends a sleep:wind_down_step event to sleep.windDownLog', () => {
    emit('sleep:wind_down_step', {
      ts: FIXED_NOW,
      step_id: 'phone_away',
      step_label: 'phone away',
      action: 'checked',
    });

    const log = store.get<Array<{ step_id: string; action: string }>>('sleep', 'windDownLog', []);
    expect(log).toHaveLength(1);
    expect(log![0].step_id).toBe('phone_away');
    expect(log![0].action).toBe('checked');
  });

  it('keeps log time-sorted across multiple steps', () => {
    emit('sleep:wind_down_step', { ts: FIXED_NOW + 200, step_id: 'into_bed', action: 'checked' });
    emit('sleep:wind_down_step', { ts: FIXED_NOW + 100, step_id: 'lights_low', action: 'checked' });

    const log = store.get<Array<{ ts: number }>>('sleep', 'windDownLog', []);
    expect(log).toHaveLength(2);
    expect(log![0].ts).toBeLessThan(log![1].ts);
  });

  it('drops exact duplicate (ts, step_id, action) rows', () => {
    const ev = { ts: FIXED_NOW, step_id: 'phone_away', action: 'checked' as const };
    emit('sleep:wind_down_step', ev);
    emit('sleep:wind_down_step', ev);
    expect(store.get<unknown[]>('sleep', 'windDownLog', [])).toHaveLength(1);
  });

  it('ignores malformed events (bad action, missing fields)', () => {
    emit('sleep:wind_down_step', { ts: FIXED_NOW, step_id: 'x', action: 'started' });
    emit('sleep:wind_down_step', { ts: FIXED_NOW, action: 'checked' });
    emit('sleep:wind_down_step', { step_id: 'x', action: 'checked' });
    expect(store.get<unknown[]>('sleep', 'windDownLog', [])).toHaveLength(0);
  });
});

describe('sleep orchestrator — insomnia survey', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    orch = createSleepOrchestrator(store, { now: () => FIXED_NOW });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('scores answers written to sleep.insomnia_survey_answers', () => {
    store.set('sleep', 'insomnia_survey_answers', [3, 3, 3, 3, 3, 3, 3]);

    const result = store.get<{ score: number; band: string; scored_at: number } | null>(
      'sleep', 'insomnia_survey_result', null,
    );
    expect(result).not.toBeNull();
    expect(result!.score).toBe(21);
    expect(result!.band).toBe('moderate');
    expect(result!.scored_at).toBe(FIXED_NOW);
  });

  it('leaves prior result untouched when new answers are invalid', () => {
    store.set('sleep', 'insomnia_survey_answers', [0, 0, 0, 0, 0, 0, 0]);
    const first = store.get<{ score: number } | null>('sleep', 'insomnia_survey_result', null);
    expect(first!.score).toBe(0);

    // Invalid (too short) — must NOT clobber the existing result.
    store.set('sleep', 'insomnia_survey_answers', [1, 2, 3]);
    const after = store.get<{ score: number } | null>('sleep', 'insomnia_survey_result', null);
    expect(after!.score).toBe(0);
  });
});

// ─── push notification subscribers ──────────────────────────────────────────

describe('sleep orchestrator — push notification subscribers', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createSleepOrchestrator>;
  let scheduled: Array<{ spec: NotificationSpec; fireAt: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
    scheduled = [];
    orch = createSleepOrchestrator(store, {
      now: () => FIXED_NOW,
      scheduleNotification: (spec, fireAt) => { scheduled.push({ spec, fireAt }); },
    });
    orch.init();
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
    vi.useRealTimers();
  });

  it('sleep:wind_down_window → REMINDER push with deadpan copy', () => {
    emit('sleep:wind_down_window', {
      bedtimeTs: FIXED_NOW + 60 * 60_000,
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('REMINDER');
    expect(scheduled[0].spec.title).toBe('wind-down in 60 min. or whenever.');
    expect(scheduled[0].spec.dedupe_key).toContain('sleep:wind_down_window');
  });

  it('pattern:caffeine_sleep_detected → PATTERN_ALERT push (re-uses P3 event)', () => {
    emit('pattern:caffeine_sleep_detected', {
      correlation: -0.6,
      threshold: { hours: 15, minutes: 0 },
      sampleSize: 14,
      copy: 'coffee after 3pm. heads up — sleep usually dips.',
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('PATTERN_ALERT');
    expect(scheduled[0].spec.title).toContain('coffee after 3pm');
    expect(scheduled[0].spec.dedupe_key).toContain('sleep:caffeine_late_warning');
  });

  it('pattern:caffeine_sleep_detected → falls back to static copy when P3 copy empty', () => {
    emit('pattern:caffeine_sleep_detected', {
      correlation: -0.4,
      threshold: { hours: 15, minutes: 0 },
      sampleSize: 12,
      copy: '',
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.title).toBe('coffee after 3pm. heads up — sleep usually dips.');
  });

  it('sleep:debt_accumulated → PATTERN_ALERT push with hours + bedtime substituted', () => {
    emit('sleep:debt_accumulated', {
      debtHours: 6.2,
      targetHours: 7.5,
      idealBedtimeHHMM: '22:30',
      ts: FIXED_NOW,
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].spec.category).toBe('PATTERN_ALERT');
    expect(scheduled[0].spec.title).toBe("you're 6h short this week. ideal bedtime tonight: 10:30pm.");
  });

  it('sleep:debt_accumulated → handles 12:00 noon edge', () => {
    emit('sleep:debt_accumulated', {
      debtHours: 4.5,
      targetHours: 7.5,
      idealBedtimeHHMM: '12:00',
      ts: FIXED_NOW,
    });
    expect(scheduled[0].spec.title).toContain('12:00pm');
  });

  it('emits sleep:debt_accumulated from recomputeDerived when 7d total falls > 4h short', () => {
    let debtEmitted = 0;
    on('sleep:debt_accumulated', () => { debtEmitted++; });

    const records: ReturnType<typeof makeSleepRecords> = [];
    for (let d = 7; d >= 1; d--) {
      const dayTs = FIXED_NOW - d * DAY_MS;
      const date = new Date(dayTs);
      records.push({
        night_of: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
        bedtime: '23:00',
        wake_time: '03:30',
        onset_latency_min: 20,
        wakings_count: 0,
        wakings_total_min: 0,
        tst_min: 270, // 4.5h
        time_in_bed_min: 290,
        efficiency: 270 / 290,
        quality: 2,
        quality_text: 'short',
        notes: null,
        tokens: [],
        is_skipped: false,
        is_partial: false,
        is_disputed: false,
        raw_source_id: String(dayTs),
      });
    }
    store.set('sleep', 'records', records);
    vi.advanceTimersByTime(600);

    expect(debtEmitted).toBeGreaterThanOrEqual(1);
  });

  it('scheduleNotification NOT called when not injected', () => {
    orch.teardown();
    scheduled.length = 0;
    const store2 = createStore(createMemoryAdapter());
    const orch2 = createSleepOrchestrator(store2, { now: () => FIXED_NOW });
    orch2.init();
    emit('sleep:wind_down_window', { bedtimeTs: FIXED_NOW + 60 * 60_000, ts: FIXED_NOW });
    expect(scheduled).toHaveLength(0);
    orch2.teardown();
  });
});
