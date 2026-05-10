/**
 * @ollie/logic · cycle phase + per-symptom correlation
 *
 * computePhaseForDate returns one of menstrual / follicular / ovulation
 * window / luteal for a given timestamp, using the user's own average
 * cycle length and bleed length.
 *
 * correlateSymptom checks whether a symptom tag clusters in a single
 * phase across at least 3 cycles. Principle 2.13: early-return if the
 * sample size is too small to call it a pattern.
 *
 * deriveCycleStats surfaces summary stats for the UI, including
 * irregular_flag when sd > 7 (principle 2.14).
 */

import type {
  CycleRecord,
  CycleStats,
  Phase,
  SymptomCorrelation,
  SymptomEvent,
} from './types';
import { DAY_MS } from './constants';
import { mean, sampleSd } from './math';

export function computePhaseForDate(
  cycles: readonly CycleRecord[] | undefined | null,
  dateTs: number | undefined | null,
): Phase {
  if (!Array.isArray(cycles) || cycles.length === 0 || typeof dateTs !== 'number') return 'unknown';
  const starts = cycles
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);
  if (starts.length === 0) return 'unknown';
  const lastStart = starts[starts.length - 1];
  if (dateTs < lastStart) return 'unknown';
  const day = Math.floor((dateTs - lastStart) / DAY_MS) + 1;

  const lens: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    lens.push(Math.round((starts[i] - starts[i - 1]) / DAY_MS));
  }
  const avgCycle = lens.length ? Math.round(mean(lens)) : 28;

  const bleeds = cycles
    .map((c) => c?.periodLengthDays)
    .filter((d): d is number => typeof d === 'number');
  const menstrualEnd = bleeds.length ? Math.round(mean(bleeds)) : 5;

  if (day <= menstrualEnd) return 'menstrual';
  const fertileStart = avgCycle - 18;
  const fertileEnd = avgCycle - 13;
  if (day < fertileStart) return 'follicular';
  if (day <= fertileEnd) return 'ovulation window';
  return 'luteal';
}

export function deriveCycleStats(cycles: readonly CycleRecord[] | undefined | null): CycleStats {
  const safe = Array.isArray(cycles) ? cycles : [];
  const lens = safe
    .map((c) => c?.cycleLengthDays)
    .filter((d): d is number => typeof d === 'number');
  const bleeds = safe
    .map((c) => c?.periodLengthDays)
    .filter((d): d is number => typeof d === 'number');
  const starts = safe
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);
  const lastStart = starts.length ? starts[starts.length - 1] : null;

  if (lens.length === 0) {
    return {
      cycles_logged_count: 0,
      mean_length: null,
      sd_length: 0,
      mean_bleed: null,
      irregular_flag: false,
      last_period_start: lastStart,
    };
  }
  const mean_length = mean(lens);
  const sd_length = sampleSd(lens);
  const mean_bleed = bleeds.length ? mean(bleeds) : null;
  return {
    cycles_logged_count: lens.length,
    mean_length: +mean_length.toFixed(1),
    sd_length: +sd_length.toFixed(1),
    mean_bleed: mean_bleed !== null ? +mean_bleed.toFixed(1) : null,
    irregular_flag: sd_length > 7,
    last_period_start: lastStart,
  };
}

export function correlateSymptom(
  cycles: readonly CycleRecord[] | undefined | null,
  symptomEvents: readonly SymptomEvent[] | undefined | null,
  symptomTag: string,
): SymptomCorrelation {
  const tagLower = (symptomTag || '').toLowerCase();
  if (!tagLower) return { hasPattern: false, reason: 'no symptom tag provided.' };
  const safeCycles = Array.isArray(cycles) ? cycles : [];
  const starts = safeCycles
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);
  if (starts.length === 0) return { hasPattern: false, reason: 'need more data' };

  const matched = (symptomEvents || []).filter(
    (e) => !!e && typeof e.ts === 'number' && (e.text || '').toLowerCase().includes(tagLower),
  );
  if (matched.length === 0) return { hasPattern: false, reason: 'need more data' };

  const byCycle = new Map<number, number[]>();
  for (const e of matched) {
    let idx = -1;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= e.ts && (i === starts.length - 1 || starts[i + 1] > e.ts)) {
        idx = i;
        break;
      }
    }
    if (idx < 0 || idx >= safeCycles.length) continue;
    if (!byCycle.has(idx)) byCycle.set(idx, []);
    byCycle.get(idx)!.push(e.ts - starts[idx]);
  }

  if (byCycle.size < 3) return { hasPattern: false, reason: 'need more data', cycles: byCycle.size };

  const phaseCount: Record<Phase, number> = {
    menstrual: 0,
    follicular: 0,
    'ovulation window': 0,
    luteal: 0,
    unknown: 0,
  };
  let total = 0;
  byCycle.forEach((offsets, idx) => {
    const cycleLen = safeCycles[idx]?.cycleLengthDays ?? 28;
    for (const off of offsets) {
      const day = Math.floor(off / DAY_MS) + 1;
      let phase: Phase = 'luteal';
      if (day <= 5) phase = 'menstrual';
      else if (day < cycleLen - 17) phase = 'follicular';
      else if (day <= cycleLen - 13) phase = 'ovulation window';
      phaseCount[phase]++;
      total++;
    }
  });
  if (total === 0) return { hasPattern: false, reason: 'need more data' };

  let topPhase: Phase = 'luteal';
  let topCount = 0;
  for (const phase of Object.keys(phaseCount) as Phase[]) {
    if (phase === 'unknown') continue;
    if (phaseCount[phase] > topCount) {
      topPhase = phase;
      topCount = phaseCount[phase];
    }
  }
  if (topCount / total <= 0.6) return { hasPattern: false, reason: 'no single-phase cluster' };
  return { hasPattern: true, phase: topPhase, occurrences: total, cycles: byCycle.size };
}
