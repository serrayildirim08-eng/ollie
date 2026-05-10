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

export function phaseForDay(day: number, cycleLengthDays: number): CyclePhase {
  if (day <= 5) return 'menstrual';
  if (day <= cycleLengthDays - 18) return 'follicular';
  if (day <= cycleLengthDays - 13) return 'ovulation window';
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
        out.push({ event: e, cycleIdx: i, dayInCycle: day, phase: phaseForDay(day, c.cycleLengthDays) });
        break;
      }
    }
  }
  return out;
}
