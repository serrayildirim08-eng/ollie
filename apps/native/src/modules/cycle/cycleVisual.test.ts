/**
 * cycleVisual.ts · pure-helper tests.
 *
 * Pins the growth curve's four landmarks: day-1 sprout + shedding, the
 * ovulation peak, a full luteal canopy, and that a period day always sheds.
 */

import { describe, it, expect } from 'vitest';
import { cycleVisual } from './cycleVisual';

describe('cycleVisual', () => {
  it('day 1 bleeding → a shedding sprout (low growth)', () => {
    const v = cycleVisual(1, 'bleeding', true);
    expect(v.shedding).toBe(true);
    expect(v.growth).toBeGreaterThan(0);
    expect(v.growth).toBeLessThan(0.15);
  });

  it('day 1 (no live bleeding flag) is still a sprout', () => {
    const v = cycleVisual(1, 'early cycle', false);
    expect(v.shedding).toBe(false);
    expect(v.growth).toBeCloseTo(0.06, 2);
  });

  it('ovulation (~mid-cycle) is the fullest the tree gets', () => {
    const v = cycleVisual(14, 'around ovulation', false);
    expect(v.shedding).toBe(false);
    expect(v.growth).toBeGreaterThan(0.85);
    // bold olives appear in the component at g > 0.72 — peak must clear it.
    expect(v.growth).toBeGreaterThan(0.72);
  });

  it('luteal stays full + green', () => {
    const v = cycleVisual(21, 'luteal', false);
    expect(v.shedding).toBe(false);
    expect(v.growth).toBeGreaterThan(0.72);
  });

  it('a period day always sheds, even if the phase label disagrees', () => {
    const v = cycleVisual(20, 'luteal', true);
    expect(v.shedding).toBe(true);
    expect(v.growth).toBeLessThan(0.2);
  });

  it("a 'period' phase forces shedding without a live bleeding flag", () => {
    const v = cycleVisual(2, 'period', false);
    expect(v.shedding).toBe(true);
    expect(v.growth).toBeLessThan(0.2);
  });

  it('growth rises monotonically from sprout to ovulation', () => {
    const days = [1, 4, 7, 10, 14];
    const gs = days.map((d) => cycleVisual(d, 'follicular', false).growth);
    for (let i = 1; i < gs.length; i++) {
      expect(gs[i]).toBeGreaterThan(gs[i - 1]);
    }
  });

  it('clamps to 0..1 and tolerates a junk day', () => {
    const v = cycleVisual(NaN, 'follicular', false);
    expect(v.growth).toBeGreaterThanOrEqual(0);
    expect(v.growth).toBeLessThanOrEqual(1);
  });

  it('an over-long luteal stretch declines but stays mostly full', () => {
    const v = cycleVisual(40, 'luteal', false);
    expect(v.growth).toBeGreaterThan(0.72);
    expect(v.growth).toBeLessThan(0.9);
  });
});
