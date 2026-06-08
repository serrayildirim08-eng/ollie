/**
 * @ollie/logic · brain · the learning loop — unit tests
 *
 * Covers Serra's 4 locked Sprint-4 decisions on the pure core:
 *   1. COARSE→FINE — a finer bucket overrides the coarser once it has enough
 *      data; below threshold the finer bucket falls back to the coarser, then
 *      to cold-start.
 *   2. CAUTIOUS — < MIN_SAMPLE defers → 'unknown' (caller falls back); 5+ with
 *      no harm → 'ok-to-defer'; defers that led to harm → 'protect'.
 *   3. SILENT — there is no copy/notification surface here to assert against;
 *      the module returns verdicts only (covered by the absence of any string
 *      output + the select-integration test in brain-select-learned.test.ts).
 *   4. OVERRIDE — a user pin beats both learned + cold-start.
 */

import { describe, it, expect } from 'vitest';
import {
  learnBucket,
  resolveDeferability,
  verdictToDeferability,
  MIN_SAMPLE,
  HARM_RATE_PROTECT,
  type LearnedMap,
} from '../src/brain';

// ─── DECISION 2 · learnBucket verdict + cautious threshold ─────────────────

describe('learnBucket · cautious threshold', () => {
  it('< MIN_SAMPLE defers → unknown (caller falls back)', () => {
    for (let n = 0; n < MIN_SAMPLE; n += 1) {
      const v = learnBucket({ deferCount: n, harmCount: 0 });
      expect(v.deferability).toBe('unknown');
      expect(v.confidence).toBe(0);
      expect(v.sampleSize).toBe(n);
    }
  });

  it('exactly MIN_SAMPLE defers with no harm → ok-to-defer', () => {
    const v = learnBucket({ deferCount: MIN_SAMPLE, harmCount: 0 });
    expect(v.deferability).toBe('ok-to-defer');
    expect(v.confidence).toBeGreaterThan(0);
    expect(v.sampleSize).toBe(MIN_SAMPLE);
    expect(v.harmRate).toBe(0);
  });

  it('many defers, no harm → ok-to-defer with higher confidence than the bare minimum', () => {
    const min = learnBucket({ deferCount: MIN_SAMPLE, harmCount: 0 });
    const lots = learnBucket({ deferCount: 30, harmCount: 0 });
    expect(lots.deferability).toBe('ok-to-defer');
    expect(lots.confidence).toBeGreaterThan(min.confidence);
  });
});

describe('learnBucket · harm flips to protect', () => {
  it('defers that repeatedly led to harm → protect', () => {
    // 6 defers, 3 of them tied to a harm event → harmRate 0.5 ≥ threshold.
    const v = learnBucket({ deferCount: 6, harmCount: 3 });
    expect(v.deferability).toBe('protect');
    expect(v.harmRate).toBeCloseTo(0.5);
    expect(v.confidence).toBeGreaterThan(0);
  });

  it('a single harm in a large clean sample stays ok-to-defer (below harm-rate edge)', () => {
    // 20 defers, 1 harm → 0.05 < 0.25 → still safe to let rest.
    const v = learnBucket({ deferCount: 20, harmCount: 1 });
    expect(v.deferability).toBe('ok-to-defer');
    expect(v.harmRate).toBeLessThan(HARM_RATE_PROTECT);
  });

  it('harm right at the threshold protects (>= is protective)', () => {
    // 8 defers, 2 harm → exactly 0.25.
    const v = learnBucket({ deferCount: 8, harmCount: 2 });
    expect(v.harmRate).toBeCloseTo(HARM_RATE_PROTECT);
    expect(v.deferability).toBe('protect');
  });

  it('clamps absurd inputs — harmCount never exceeds deferCount', () => {
    const v = learnBucket({ deferCount: 5, harmCount: 99 });
    expect(v.harmRate).toBe(1);
    expect(v.deferability).toBe('protect');
  });

  it('is total — junk inputs do not throw', () => {
    // @ts-expect-error — deliberately wrong shape
    expect(() => learnBucket(null)).not.toThrow();
    // @ts-expect-error — deliberately wrong shape
    expect(learnBucket({}).deferability).toBe('unknown');
  });
});

// ─── DECISION 1 · coarse→fine resolution ───────────────────────────────────

describe('resolveDeferability · coarse→fine', () => {
  function mapWith(verdicts: LearnedMap['verdicts'], pins?: LearnedMap['pins']): LearnedMap {
    return { verdicts, pins };
  }

  it('a confident FINE verdict overrides the coarse one for that bucket', () => {
    // groceries (coarse) learned ok-to-defer, but milk (fine) learned protect.
    const map = mapWith({
      groceries: learnBucket({ deferCount: 10, harmCount: 0 }), // ok-to-defer
      'groceries:milk': learnBucket({ deferCount: 6, harmCount: 4 }), // protect
    });
    const r = resolveDeferability(map, 'groceries:milk', 'groceries');
    expect(r.source).toBe('learned-fine');
    expect(r.deferability).toBe('protect');
  });

  it('a below-threshold FINE bucket falls back to the confident COARSE bucket', () => {
    const map = mapWith({
      groceries: learnBucket({ deferCount: 10, harmCount: 0 }), // ok-to-defer
      'groceries:eggs': learnBucket({ deferCount: 2, harmCount: 0 }), // unknown
    });
    const r = resolveDeferability(map, 'groceries:eggs', 'groceries');
    expect(r.source).toBe('learned-coarse');
    expect(r.deferability).toBe('ok-to-defer');
  });

  it('below threshold at BOTH granularities → falls through to cold-start (null)', () => {
    const map = mapWith({
      groceries: learnBucket({ deferCount: 1, harmCount: 0 }), // unknown
      'groceries:eggs': learnBucket({ deferCount: 2, harmCount: 0 }), // unknown
    });
    const r = resolveDeferability(map, 'groceries:eggs', 'groceries');
    expect(r.source).toBe('cold-start');
    expect(r.deferability).toBeNull();
  });

  it('an empty/absent map always falls through to cold-start', () => {
    expect(resolveDeferability(null, 'x', 'y').source).toBe('cold-start');
    expect(resolveDeferability({ verdicts: {} }, 'x', 'y').deferability).toBeNull();
  });
});

// ─── DECISION 4 · user pin overrides everything ────────────────────────────

describe('resolveDeferability · user pin (override)', () => {
  it('a pin beats both the learned verdict AND the cold-start', () => {
    // groceries learned ok-to-defer, but the user pinned "always protect".
    const map: LearnedMap = {
      verdicts: { groceries: learnBucket({ deferCount: 10, harmCount: 0 }) },
      pins: { groceries: 'protect' },
    };
    const r = resolveDeferability(map, null, 'groceries');
    expect(r.source).toBe('pin');
    expect(r.deferability).toBe('protect');
  });

  it('a FINE pin beats a coarse pin', () => {
    const map: LearnedMap = {
      verdicts: {},
      pins: { groceries: 'protect', 'groceries:milk': 'ok-to-defer' },
    };
    const r = resolveDeferability(map, 'groceries:milk', 'groceries');
    expect(r.source).toBe('pin');
    expect(r.deferability).toBe('ok-to-defer');
  });

  it('a pin wins even when learned says the opposite', () => {
    const map: LearnedMap = {
      verdicts: { 'groceries:milk': learnBucket({ deferCount: 8, harmCount: 6 }) }, // protect
      pins: { 'groceries:milk': 'ok-to-defer' },
    };
    const r = resolveDeferability(map, 'groceries:milk', 'groceries');
    expect(r.source).toBe('pin');
    expect(r.deferability).toBe('ok-to-defer');
  });
});

// ─── verdictToDeferability — onto the 0…1 scale select.ts scores on ─────────

describe('verdictToDeferability', () => {
  it('maps protect→0, ok-to-defer→1, unknown/null→null', () => {
    expect(verdictToDeferability('protect')).toBe(0);
    expect(verdictToDeferability('ok-to-defer')).toBe(1);
    expect(verdictToDeferability('unknown')).toBeNull();
    expect(verdictToDeferability(null)).toBeNull();
  });
});
