/**
 * @ollie/logic/patterns · phase-fold helpers
 *
 * Common pre-detector pipeline:
 *   - filter cycles to "closed" (have cycleLengthDays)
 *   - irregular guard: σ > 7 days suppresses phase-based patterns (2.14)
 *   - 72h cooldown filter on recently edited cycles (2.17)
 *   - phaseFold: bucket events into menstrual/follicular/ovulation/luteal
 *
 * Pure. `now` is an explicit param (no Date.now() reads inside).
 */

import type { CycleRecord } from '../cycle/types';
import { DAY_MS } from '../cycle/constants';
import { sampleSd } from './stats';
import type { CyclePhase } from './types';

export const COOLDOWN_MS = 72 * 3600 * 1000;
export const IRREGULAR_SIGMA = 7;

export type ClosedCycle = CycleRecord & { cycleLengthDays: number };

export function closedCycles(cycles: readonly CycleRecord[] | undefined | null): ClosedCycle[] {
  return (cycles || []).filter(
    (c): c is ClosedCycle => !!c && typeof c.cycleStartTs === 'number' && typeof c.cycleLengthDays === 'number',
  );
}

export function isIrregular(cycles: readonly ClosedCycle[]): boolean {
  const lens = cycles.map((c) => c.cycleLengthDays);
  if (lens.length < 2) return false;
  return sampleSd(lens) > IRREGULAR_SIGMA;
}

export function cooldownFilter(
  cycles: readonly ClosedCycle[],
  lastEditedByCycle: Record<number, number> | undefined,
  now: number | undefined,
): ClosedCycle[] {
  const lastEdit = lastEditedByCycle || {};
  const t = typeof now === 'number' ? now : 0;
  return cycles.filter((c) => {
    const edited = lastEdit[c.cycleStartTs];
    return !(edited && t > 0 && t - edited < COOLDOWN_MS);
  });
}

export const DEFAULT_BLEED_DAYS = 5;

/**
 * CANONICAL cycle-phase classifier — the ONE definition used by every
 * detector (finding #51). Three earlier copies disagreed on whether the
 * follicular/ovulation boundary used `<` vs `<=` and `cycleLen-17` vs
 * `cycleLen-18`, so the same cycle-day landed in different phases depending
 * on the call site. The pinned convention is:
 *
 *   day <= bleedLen ............................ menstrual   (bleedLen default 5)
 *   bleedLen < day < cycleLen-18 ............... follicular
 *   cycleLen-18 <= day <= cycleLen-13 .......... ovulation window  (inclusive, 6-day fertile window)
 *   day > cycleLen-13 .......................... luteal
 *
 * The ovulation window is anchored to a ~14-day luteal phase: it spans the
 * 6 days ending 13 days before the next expected period. `day` is 1-based
 * (cycle day 1 == first day of bleed).
 *
 * Degenerate inputs are clamped: when the cycle is so short that the
 * ovulation window would fall on or before the bleed end, the window is
 * dropped and those days stay menstrual/follicular.
 */
export function phaseForDay(
  day: number,
  cycleLengthDays: number,
  bleedLen: number = DEFAULT_BLEED_DAYS,
): CyclePhase {
  const bleed = Number.isFinite(bleedLen) && bleedLen > 0 ? Math.round(bleedLen) : DEFAULT_BLEED_DAYS;
  if (day <= bleed) return 'menstrual';
  const ovStart = cycleLengthDays - 18;
  const ovEnd = cycleLengthDays - 13;
  // Short-cycle guard: if the window would collide with the bleed, there is
  // no meaningful follicular/ovulation split — fall back to follicular→luteal
  // at the window end.
  if (ovStart <= bleed) {
    return day <= ovEnd ? 'follicular' : 'luteal';
  }
  if (day < ovStart) return 'follicular';
  if (day <= ovEnd) return 'ovulation window';
  return 'luteal';
}

export interface FoldedEvent<T> {
  event: T;
  cycleIdx: number;
  dayInCycle: number;
  phase: CyclePhase;
}

export function phaseFold<T extends { ts: number }>(
  cycles: readonly ClosedCycle[],
  events: readonly T[] | undefined | null,
): FoldedEvent<T>[] {
  if (cycles.length === 0) return [];
  const sorted = cycles.slice().sort((a, b) => a.cycleStartTs - b.cycleStartTs);
  const out: FoldedEvent<T>[] = [];
  for (const e of events || []) {
    if (!e || typeof e.ts !== 'number') continue;
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const end = c.cycleStartTs + c.cycleLengthDays * DAY_MS;
      if (e.ts >= c.cycleStartTs && e.ts < end) {
        const day = Math.floor((e.ts - c.cycleStartTs) / DAY_MS) + 1;
        const bleed = typeof c.periodLengthDays === 'number' ? c.periodLengthDays : DEFAULT_BLEED_DAYS;
        out.push({ event: e, cycleIdx: i, dayInCycle: day, phase: phaseForDay(day, c.cycleLengthDays, bleed) });
        break;
      }
    }
  }
  return out;
}
