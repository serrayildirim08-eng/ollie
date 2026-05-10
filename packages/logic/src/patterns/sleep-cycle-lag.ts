/**
 * @ollie/logic/patterns · sleep_cycle_lag detector
 *
 * For each cycle: does TST in the last `preWindowDays` (default 5) days
 * drop ≥ 30 min vs. the cycle mean? Pattern surfaces when this holds
 * across 3+ cycles and the average drop is ≥ 30 min.
 */

import type { CycleRecord } from '../cycle/types';
import { DAY_MS } from '../cycle/constants';
import { closedCycles, cooldownFilter, isIrregular } from './phase-fold';
import { mean } from './stats';
import type { DetectorOptions, SleepCycleLagPattern, SleepSession } from './types';

export function detectSleepCycleLag(
  cycles: readonly CycleRecord[] | undefined | null,
  sleepSessions: readonly SleepSession[] | undefined | null,
  opts: DetectorOptions & { preWindowDays?: number } = {},
): SleepCycleLagPattern | null {
  const closed = closedCycles(cycles);
  if (closed.length < 3) return null;
  if (isIrregular(closed)) return null;
  const eligible = cooldownFilter(closed, opts.lastEditedByCycle, opts.now);
  if (eligible.length < 3) return null;

  const preWindowDays = opts.preWindowDays ?? 5;
  const deltas: number[] = [];
  for (const c of eligible) {
    const start = c.cycleStartTs;
    const end = start + c.cycleLengthDays * DAY_MS;
    const preStart = end - preWindowDays * DAY_MS;
    const inCycle = (sleepSessions || []).filter(
      (s) => !!s && typeof s.ts === 'number' && typeof s.tstMinutes === 'number' && s.ts >= start && s.ts < end,
    );
    if (inCycle.length < 5) continue;
    const pre = inCycle.filter((s) => s.ts >= preStart);
    if (pre.length < 2) continue;
    const cycleMean = mean(inCycle.map((s) => s.tstMinutes));
    const preMean = mean(pre.map((s) => s.tstMinutes));
    deltas.push(preMean - cycleMean);
  }
  if (deltas.length < 3) return null;

  const dropCycles = deltas.filter((d) => d <= -30).length;
  if (dropCycles < 3) return null;
  const meanDelta = mean(deltas);
  if (meanDelta > -30) return null;

  const mins = Math.max(5, Math.round(-meanDelta / 5) * 5);
  return {
    id: 'sleep_cycle_lag',
    type: 'sleep_cycle_lag',
    cycles: dropCycles,
    copy: `sleep drops ~${mins} min in the days before your period — ${dropCycles} cycles.`,
    subcopy: 'pattern, not medical.',
    meta: { meanDeltaMinutes: meanDelta, cyclesWithDrop: dropCycles, preWindowDays },
  };
}
