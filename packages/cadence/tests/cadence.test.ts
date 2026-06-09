import { describe, it, expect } from 'vitest';
import {
  computeCadence,
  daysSinceLast,
  isOverdue,
  medianIntervalDays,
  type TimestampedEvent,
} from '../src/index';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function ev(daysAgoFromT0: number, label = 'thing'): TimestampedEvent {
  return { ts: T0 - daysAgoFromT0 * DAY, label };
}

// ─── empty / single ──────────────────────────────────────────────────────

describe('computeCadence — empty', () => {
  it('returns low-data with null nextExpectedTs', () => {
    const out = computeCadence([]);
    expect(out.sampleSize).toBe(0);
    expect(out.confidence).toBe('low-data');
    expect(out.nextExpectedTs).toBeNull();
    expect(out.lastTs).toBeNull();
    expect(out.medianIntervalMs).toBe(0);
  });
});

describe('computeCadence — single event', () => {
  it('returns low-data with lastTs set but no nextExpectedTs', () => {
    const out = computeCadence([ev(0)]);
    expect(out.sampleSize).toBe(1);
    expect(out.confidence).toBe('low-data');
    expect(out.nextExpectedTs).toBeNull();
    expect(out.lastTs).toBe(T0);
    expect(out.medianIntervalMs).toBe(0);
  });
});

// ─── observed (3 events, regular-ish) ────────────────────────────────────

describe('computeCadence — 3 events at weekly cadence', () => {
  it('returns observed with 7-day median', () => {
    const events = [ev(14), ev(7), ev(0)];
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(3);
    // 3 events with cv = 0 (perfectly regular) but only 3 samples →
    // 'observed' (stable needs ≥5).
    expect(out.confidence).toBe('observed');
    expect(out.medianIntervalMs).toBe(7 * DAY);
    expect(out.nextExpectedTs).toBe(T0 + 7 * DAY);
    expect(out.lastTs).toBe(T0);
  });

  it('is order-independent', () => {
    const a = computeCadence([ev(14), ev(7), ev(0)]);
    const b = computeCadence([ev(0), ev(14), ev(7)]);
    expect(a).toEqual(b);
  });
});

// ─── stable (5+ events, low cv) ──────────────────────────────────────────

describe('computeCadence — 5 weekly events', () => {
  it('returns stable with weekly median', () => {
    const events = [ev(28), ev(21), ev(14), ev(7), ev(0)];
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(5);
    expect(out.confidence).toBe('stable');
    expect(out.medianIntervalMs).toBe(7 * DAY);
    expect(out.nextExpectedTs).toBe(T0 + 7 * DAY);
  });
});

describe('computeCadence — 6 events with ±1 day jitter', () => {
  it('stays stable when cv stays below threshold', () => {
    // gaps: 6, 8, 7, 6, 8 days — cv ≈ 0.13 → well under 0.6
    const tss = [T0 - 35 * DAY, T0 - 29 * DAY, T0 - 21 * DAY, T0 - 14 * DAY, T0 - 8 * DAY, T0];
    const events = tss.map((t) => ({ ts: t, label: 'x' }));
    const out = computeCadence(events);
    expect(out.confidence).toBe('stable');
    expect(out.sampleSize).toBe(6);
  });
});

// ─── irregular ───────────────────────────────────────────────────────────

describe('computeCadence — irregular pattern', () => {
  it('demotes to observed when cv is moderate', () => {
    // gaps: 1d, 14d, 3d, 21d → cv ≈ 0.86 (above 0.6, below 1.2)
    const tss = [T0 - 39 * DAY, T0 - 38 * DAY, T0 - 24 * DAY, T0 - 21 * DAY, T0];
    const events = tss.map((t) => ({ ts: t, label: 'x' }));
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(5);
    expect(out.confidence).toBe('observed');
  });

  it('demotes to low-data when cv is wildly irregular', () => {
    // gaps: 1d, 60d, 1d, 60d → cv ≈ 0.97; still > 0.6 but < 1.2.
    // Make it more violent: 1d, 100d, 1d, 100d, 1d → cv ≈ 0.98
    // Push past 1.2 with 1d, 200d, 1d, 1d, 200d
    const tss = [
      T0 - 403 * DAY,
      T0 - 402 * DAY,
      T0 - 202 * DAY,
      T0 - 201 * DAY,
      T0 - 200 * DAY,
      T0,
    ];
    const events = tss.map((t) => ({ ts: t, label: 'x' }));
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(6);
    expect(out.confidence).toBe('low-data');
  });
});

// ─── edge cases ──────────────────────────────────────────────────────────

describe('computeCadence — edge cases', () => {
  it('drops non-finite timestamps silently', () => {
    const events: TimestampedEvent[] = [
      { ts: Number.NaN, label: 'bad' },
      { ts: Infinity, label: 'bad' },
      { ts: -1, label: 'bad' },
      { ts: 0, label: 'bad' },
      ev(7),
      ev(0),
    ];
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(2);
    expect(out.medianIntervalMs).toBe(7 * DAY);
  });

  it('treats same-instant duplicates as one sample for cadence', () => {
    // 3 ts values, 2 of them identical → only 1 positive gap.
    const events = [
      { ts: T0 - 7 * DAY, label: 'x' },
      { ts: T0, label: 'x' },
      { ts: T0, label: 'x' },
    ];
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(3);
    expect(out.medianIntervalMs).toBe(7 * DAY);
    expect(out.confidence).toBe('observed');
  });

  it('returns low-data when every ts is identical', () => {
    const events = [
      { ts: T0, label: 'x' },
      { ts: T0, label: 'x' },
      { ts: T0, label: 'x' },
    ];
    const out = computeCadence(events);
    expect(out.sampleSize).toBe(3);
    expect(out.medianIntervalMs).toBe(0);
    expect(out.confidence).toBe('low-data');
    expect(out.nextExpectedTs).toBeNull();
  });

  it('takes median, not mean — robust to one outlier gap', () => {
    // gaps: 7, 7, 7, 60, 7 days → mean ≈ 17.6, median = 7
    const tss = [
      T0 - 88 * DAY,
      T0 - 81 * DAY,
      T0 - 74 * DAY,
      T0 - 67 * DAY,
      T0 - 7 * DAY,
      T0,
    ];
    const events = tss.map((t) => ({ ts: t, label: 'x' }));
    const out = computeCadence(events);
    expect(out.medianIntervalMs).toBe(7 * DAY);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  it('returns null when there is no estimate', () => {
    const est = computeCadence([]);
    expect(isOverdue(est, Date.now())).toBeNull();
  });

  it('returns false within threshold', () => {
    const est = computeCadence([ev(14), ev(7), ev(0)]);
    // next expected at T0 + 7d; now at T0 + 7d + 0.5d → within 1d threshold
    const now = T0 + 7 * DAY + DAY / 2;
    expect(isOverdue(est, now)).toBe(false);
  });

  it('returns true past threshold', () => {
    const est = computeCadence([ev(14), ev(7), ev(0)]);
    const now = T0 + 7 * DAY + 2 * DAY;
    expect(isOverdue(est, now)).toBe(true);
  });
});

describe('daysSinceLast / medianIntervalDays', () => {
  it('reports days since last event, rounded to 0.1', () => {
    const est = computeCadence([ev(0)]);
    const now = T0 + 3 * DAY + DAY / 2;
    expect(daysSinceLast(est, now)).toBe(3.5);
  });

  it('reports null when no events', () => {
    expect(daysSinceLast(computeCadence([]), Date.now())).toBeNull();
  });

  it('reports median interval in days', () => {
    const est = computeCadence([ev(14), ev(7), ev(0)]);
    expect(medianIntervalDays(est)).toBe(7);
  });
});
