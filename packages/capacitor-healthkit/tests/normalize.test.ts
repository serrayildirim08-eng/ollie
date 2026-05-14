/**
 * @ollie/capacitor-healthkit · normalize tests
 *
 * These pin the HealthKit raw-shape → ollie internal-shape contract.
 * They run pure (no plugin imports) against fixtures shaped like the
 * @capgo/capacitor-health response payload.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeHeartRateSample,
  normalizeHydrationSample,
  normalizeRestingHRSample,
  normalizeSamples,
  normalizeSleepSample,
  normalizeStepSample,
} from '../src/normalize';
import type { RawHealthSample } from '../src/types';

const INGESTED = 1_730_000_000_000;

function raw(over: Partial<RawHealthSample> = {}): RawHealthSample {
  return {
    startDate: '2026-05-13T22:00:00.000Z',
    endDate: '2026-05-13T22:30:00.000Z',
    value: 0,
    unit: 'count',
    id: undefined,
    source: 'Apple Watch',
    ...over,
  };
}

describe('normalizeStepSample', () => {
  it('maps a basic step sample', () => {
    const r = normalizeStepSample(raw({ value: 1234 }), INGESTED);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('stepCount');
    expect(r!.steps).toBe(1234);
    expect(r!.source).toBe('healthkit');
    expect(r!.ingested_at).toBe(INGESTED);
  });

  it('preserves a plugin-supplied id when present', () => {
    const r = normalizeStepSample(raw({ value: 42, id: 'HK-UUID-ABC' }), INGESTED);
    expect(r!.id).toBe('HK-UUID-ABC');
  });

  it('mints a deterministic synthetic id when the plugin omits one', () => {
    const a = normalizeStepSample(raw({ value: 42 }), INGESTED);
    const b = normalizeStepSample(raw({ value: 42 }), INGESTED + 1_000);
    expect(a!.id).toBe(b!.id);
    expect(a!.id.startsWith('hk-syn-')).toBe(true);
  });

  it('two distinct samples mint different ids', () => {
    const a = normalizeStepSample(raw({ value: 100 }), INGESTED);
    const b = normalizeStepSample(raw({ value: 101 }), INGESTED);
    expect(a!.id).not.toBe(b!.id);
  });

  it('rounds + clamps absurd values', () => {
    const r = normalizeStepSample(raw({ value: 999_999 }), INGESTED);
    expect(r!.steps).toBe(100_000);
  });

  it('returns null on malformed dates', () => {
    expect(normalizeStepSample(raw({ startDate: 'not-a-date', value: 1 }), INGESTED)).toBeNull();
    expect(normalizeStepSample(raw({ endDate: '', value: 1 }), INGESTED)).toBeNull();
  });

  it('returns null when value is not coercible', () => {
    expect(normalizeStepSample(raw({ value: 'nope' }), INGESTED)).toBeNull();
  });

  it('returns null when end < start', () => {
    expect(
      normalizeStepSample(
        raw({ startDate: '2026-05-13T22:30:00.000Z', endDate: '2026-05-13T22:00:00.000Z', value: 10 }),
        INGESTED,
      ),
    ).toBeNull();
  });
});

describe('normalizeHeartRateSample', () => {
  it('rounds bpm to integer', () => {
    const r = normalizeHeartRateSample(raw({ value: 72.6 }), INGESTED);
    expect(r!.bpm).toBe(73);
    expect(r!.kind).toBe('heartRate');
  });

  it('drops implausibly low bpm (sensor noise)', () => {
    expect(normalizeHeartRateSample(raw({ value: 10 }), INGESTED)).toBeNull();
  });

  it('drops implausibly high bpm (sensor noise)', () => {
    expect(normalizeHeartRateSample(raw({ value: 300 }), INGESTED)).toBeNull();
  });

  it('accepts boundary values', () => {
    expect(normalizeHeartRateSample(raw({ value: 25 }), INGESTED)).not.toBeNull();
    expect(normalizeHeartRateSample(raw({ value: 250 }), INGESTED)).not.toBeNull();
  });
});

describe('normalizeRestingHRSample', () => {
  it('maps a resting HR reading', () => {
    const r = normalizeRestingHRSample(raw({ value: 56 }), INGESTED);
    expect(r!.kind).toBe('restingHeartRate');
    expect(r!.bpm).toBe(56);
  });

  it('drops implausible values', () => {
    expect(normalizeRestingHRSample(raw({ value: 5 }), INGESTED)).toBeNull();
    expect(normalizeRestingHRSample(raw({ value: 999 }), INGESTED)).toBeNull();
  });
});

describe('normalizeHydrationSample', () => {
  it('maps a default-unit (mL) hydration sample', () => {
    const r = normalizeHydrationSample(raw({ value: 250, unit: 'ml' }), INGESTED);
    expect(r!.volume_ml).toBe(250);
    expect(r!.kind).toBe('hydration');
  });

  it('coerces litres to mL when unit is L', () => {
    const r = normalizeHydrationSample(raw({ value: 0.5, unit: 'L' }), INGESTED);
    expect(r!.volume_ml).toBe(500);
  });

  it('drops > 10L/day to avoid sensor-stuck artefacts', () => {
    expect(normalizeHydrationSample(raw({ value: 15_000, unit: 'ml' }), INGESTED)).toBeNull();
  });

  it('drops negatives', () => {
    expect(normalizeHydrationSample(raw({ value: -100, unit: 'ml' }), INGESTED)).toBeNull();
  });
});

describe('normalizeSleepSample', () => {
  it('maps an asleep segment', () => {
    const r = normalizeSleepSample(
      raw({
        startDate: '2026-05-13T23:00:00.000Z',
        endDate: '2026-05-14T06:30:00.000Z',
        value: 'asleep',
      }),
      INGESTED,
    );
    expect(r!.stage).toBe('asleep');
    expect(r!.duration_min).toBe(450);
    expect(r!.kind).toBe('sleepAnalysis');
  });

  it('maps remSleep alias forms', () => {
    expect(normalizeSleepSample(raw({ value: 'rem' }), INGESTED)!.stage).toBe('remSleep');
    expect(normalizeSleepSample(raw({ value: 'remSleep' }), INGESTED)!.stage).toBe('remSleep');
    expect(normalizeSleepSample(raw({ value: 'REM_SLEEP' }), INGESTED)!.stage).toBe('remSleep');
  });

  it('maps "core" sleep to lightSleep (older iOS naming)', () => {
    expect(normalizeSleepSample(raw({ value: 'core' }), INGESTED)!.stage).toBe('lightSleep');
  });

  it('maps numeric HKCategoryValueSleepAnalysis codes', () => {
    expect(normalizeSleepSample(raw({ value: 0 }), INGESTED)!.stage).toBe('inBed');
    expect(normalizeSleepSample(raw({ value: 1 }), INGESTED)!.stage).toBe('asleep');
    expect(normalizeSleepSample(raw({ value: 2 }), INGESTED)!.stage).toBe('awake');
    expect(normalizeSleepSample(raw({ value: 3 }), INGESTED)!.stage).toBe('lightSleep');
    expect(normalizeSleepSample(raw({ value: 4 }), INGESTED)!.stage).toBe('deepSleep');
    expect(normalizeSleepSample(raw({ value: 5 }), INGESTED)!.stage).toBe('remSleep');
  });

  it('drops unknown stage strings', () => {
    expect(normalizeSleepSample(raw({ value: 'wat' }), INGESTED)).toBeNull();
  });

  it('drops segments longer than 24h (definitely bad data)', () => {
    expect(
      normalizeSleepSample(
        raw({
          startDate: '2026-05-12T00:00:00.000Z',
          endDate: '2026-05-14T00:00:00.000Z',
          value: 'asleep',
        }),
        INGESTED,
      ),
    ).toBeNull();
  });

  it('returns null when end < start', () => {
    expect(
      normalizeSleepSample(
        raw({
          startDate: '2026-05-14T06:00:00.000Z',
          endDate: '2026-05-13T23:00:00.000Z',
          value: 'asleep',
        }),
        INGESTED,
      ),
    ).toBeNull();
  });
});

describe('normalizeSamples (dispatcher)', () => {
  it('drops null entries from a mixed input batch', () => {
    const rows: RawHealthSample[] = [
      raw({ value: 100, startDate: '2026-05-13T08:00:00.000Z', endDate: '2026-05-13T09:00:00.000Z' }),
      raw({ value: 'nope' }),
      raw({ value: 200, startDate: '2026-05-13T10:00:00.000Z', endDate: '2026-05-13T11:00:00.000Z' }),
    ];
    const out = normalizeSamples('stepCount', rows, INGESTED);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.source === 'healthkit')).toBe(true);
  });

  it('is idempotent on a stable input (same ids out)', () => {
    const rows: RawHealthSample[] = [
      raw({ value: 100, id: 'X', startDate: '2026-05-13T08:00:00.000Z', endDate: '2026-05-13T09:00:00.000Z' }),
    ];
    const a = normalizeSamples('stepCount', rows, INGESTED);
    const b = normalizeSamples('stepCount', rows, INGESTED + 9_999);
    expect(a[0]!.id).toBe(b[0]!.id);
  });
});
