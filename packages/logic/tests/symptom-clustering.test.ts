import { describe, it, expect } from 'vitest';
import {
  bucketSymptom,
  findCorrelations,
  SYMPTOM_BUCKETS,
  detectBoundaries,
  DAY_MS,
  type CycleItem,
  type SymptomEvent,
} from '../src/cycle';

const day = (n: number): number => n * DAY_MS;
const startEvents = (offsets: readonly number[]): CycleItem[] =>
  offsets.map((d) => ({ ts: day(d), action: 'started' as const }));

describe('bucketSymptom + SYMPTOM_BUCKETS', () => {
  it('matches common cycle symptom synonyms', () => {
    expect(bucketSymptom('cramps so bad')).toBe('cramps');
    expect(bucketSymptom('migraine again')).toBe('headaches');
    expect(bucketSymptom('feeling bloated')).toBe('bloating');
    expect(bucketSymptom('massive breakout')).toBe('acne');
    expect(bucketSymptom('exhausted')).toBe('fatigue');
  });

  it('returns null for unmatched text', () => {
    expect(bucketSymptom('cooked dinner')).toBeNull();
    expect(bucketSymptom('')).toBeNull();
    expect(bucketSymptom(null)).toBeNull();
  });

  it('exposes a non-empty bucket map', () => {
    expect(Object.keys(SYMPTOM_BUCKETS).length).toBeGreaterThan(5);
  });
});

describe('findCorrelations', () => {
  it('returns [] when there are too few cycles or events', () => {
    expect(findCorrelations([], [])).toEqual([]);
    expect(findCorrelations([{ ts: 0, text: 'cramps' }], [])).toEqual([]);
  });

  it('detects a clear day-cluster pattern', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112, 140]));
    const events: SymptomEvent[] = [];
    // Cramps on day 1 of each cycle, 5 cycles in a row.
    for (const off of [0, 28, 56, 84, 112]) {
      events.push({ ts: day(off), text: 'cramps' });
    }
    const insights = findCorrelations(events, cycles);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0].bucket).toBe('cramps');
    expect(insights[0].meanDay).toBe(1);
  });

  it('rejects high-variance clusters (stdev > 4.5)', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112, 140]));
    // Spread cramps across very different cycle days.
    const events: SymptomEvent[] = [
      { ts: day(1), text: 'cramps' },
      { ts: day(35), text: 'cramps' },
      { ts: day(70), text: 'cramps' },
      { ts: day(95), text: 'cramps' },
      { ts: day(125), text: 'cramps' },
    ];
    const insights = findCorrelations(events, cycles);
    expect(insights).toEqual([]);
  });

  it('caps output at 2 insights', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112, 140]));
    const events: SymptomEvent[] = [];
    // Three different bucket clusters, all clean on day 1.
    for (const off of [0, 28, 56, 84, 112]) {
      events.push({ ts: day(off), text: 'cramps' });
      events.push({ ts: day(off), text: 'bloating' });
      events.push({ ts: day(off), text: 'acne breakout' });
    }
    const insights = findCorrelations(events, cycles);
    expect(insights.length).toBeLessThanOrEqual(2);
  });
});
