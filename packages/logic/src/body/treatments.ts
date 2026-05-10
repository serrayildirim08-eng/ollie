/**
 * @ollie/logic · body treatment plan helpers (Episode Phase 3)
 *
 * Treatment plans = scheduled cycle-based interventions (kemo, allerji aşısı,
 * IVF, etc.). Stored at body.treatment_plans. Default off — onboarded via
 * body module opt-in.
 *
 * Pure: no store / DOM / wall-clock reads. `now` is always injected.
 */

import type { TreatmentPlan, TreatmentCyclePosition, TreatmentSideEffectPattern, DumpEntry } from './types';
import { SIDE_EFFECT_RE } from './regexes';

export function newTreatmentPlan(
  label: string,
  opts?: {
    now?: number;
    randomFn?: () => string;
    cycle_length_days?: number;
    total_cycles?: number;
    cycle_starts?: number[];
    notes?: string;
  },
): TreatmentPlan {
  const o = opts || {};
  const ts = typeof o.now === 'number' ? o.now : Date.now();
  const randomFn = typeof o.randomFn === 'function' ? o.randomFn : () => Math.random().toString(36).slice(2, 8);
  return {
    id: 'tx_' + ts + '_' + randomFn(),
    label,
    cycle_length_days: o.cycle_length_days || 21,
    total_cycles: o.total_cycles || 6,
    started_at: ts,
    cycle_starts: o.cycle_starts || [ts],
    notes: o.notes || '',
  };
}

export function addCycleStart(plan: TreatmentPlan, ts: number): TreatmentPlan {
  if (!plan || typeof ts !== 'number') return plan;
  const starts = Array.isArray(plan.cycle_starts) ? [...plan.cycle_starts] : [];
  starts.push(ts);
  starts.sort((a, b) => a - b);
  return { ...plan, cycle_starts: starts };
}

/**
 * Returns cycle position for the given timestamp, or null when outside plan range.
 */
export function cyclePosition(
  plan: TreatmentPlan,
  now: number,
): TreatmentCyclePosition | null {
  if (!plan || typeof now !== 'number') return null;
  const starts = Array.isArray(plan.cycle_starts) ? plan.cycle_starts.slice().sort((a, b) => a - b) : [];
  if (starts.length === 0) return null;
  if (now < starts[0]) return null;

  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= now) idx = i;
    else break;
  }
  const cycle_n = idx + 1;
  if (cycle_n > (plan.total_cycles || cycle_n)) return null;
  const dayOfCycle = Math.floor((now - starts[idx]) / 86400000) + 1;
  return {
    cycle_n,
    total: plan.total_cycles || starts.length,
    day_of_cycle: dayOfCycle,
    post_event_days: dayOfCycle - 1,
  };
}

/**
 * Detect days-of-cycle with concentrated side-effect mentions across ≥ minCycles.
 */
export function detectSideEffectPattern(
  plan: TreatmentPlan,
  dumps: DumpEntry[],
  opts?: { minCycles?: number; concThreshold?: number },
): TreatmentSideEffectPattern | null {
  if (!plan || !Array.isArray(plan.cycle_starts) || plan.cycle_starts.length < 2) return null;
  const o = opts || {};
  const minCycles = typeof o.minCycles === 'number' ? o.minCycles : 2;
  const concThreshold = typeof o.concThreshold === 'number' ? o.concThreshold : 0.6;
  const cycleLength = plan.cycle_length_days || 21;

  const starts = plan.cycle_starts.slice().sort((a, b) => a - b);
  const dayFlagsByCycle: Set<number>[] = [];
  const list = Array.isArray(dumps) ? dumps : [];

  for (let c = 0; c < starts.length; c++) {
    const cycleStart = starts[c];
    const cycleEnd = starts[c + 1] || (cycleStart + cycleLength * 86400000);
    const flags = new Set<number>();
    for (const d of list) {
      if (!d || typeof d.ts !== 'number') continue;
      if (d.ts < cycleStart || d.ts >= cycleEnd) continue;
      const text = String(d.rawText || d.text || '');
      if (!SIDE_EFFECT_RE.test(text)) continue;
      const dayOfCycle = Math.floor((d.ts - cycleStart) / 86400000) + 1;
      flags.add(dayOfCycle);
    }
    dayFlagsByCycle.push(flags);
  }
  if (dayFlagsByCycle.length < minCycles) return null;

  const dayCount: Record<number, number> = {};
  for (const flags of dayFlagsByCycle) {
    for (const day of flags) dayCount[day] = (dayCount[day] || 0) + 1;
  }

  const totalCycles = dayFlagsByCycle.length;
  const hotDays: Array<{ day: number; count: number }> = [];
  for (const [dayStr, count] of Object.entries(dayCount)) {
    if (count / totalCycles >= concThreshold) hotDays.push({ day: parseInt(dayStr, 10), count });
  }
  if (hotDays.length === 0) return null;
  hotDays.sort((a, b) => a.day - b.day);

  const ranges: Array<{ start: number; end: number; peakCount: number }> = [];
  let cur: { start: number; end: number; peakCount: number } | null = null;
  for (const h of hotDays) {
    if (!cur || h.day > cur.end + 1) {
      cur = { start: h.day, end: h.day, peakCount: h.count };
      ranges.push(cur);
    } else {
      cur.end = h.day;
      cur.peakCount = Math.max(cur.peakCount, h.count);
    }
  }
  const top = ranges.sort((a, b) => b.peakCount - a.peakCount)[0];
  const rangeStr = top.start === top.end ? ('day ' + top.start) : ('day ' + top.start + '-' + top.end);

  return {
    pattern: 'treatment_side_effect_cycle',
    plan_id: plan.id,
    plan_label: plan.label,
    cycles_observed: totalCycles,
    hot_range: { start: top.start, end: top.end },
    peak_count: top.peakCount,
    copy:
      plan.label + ': son ' + totalCycles + " cycle'da yan etkiler " + rangeStr +
      ' civarında toplanıyor. ' + top.peakCount + '/' + totalCycles + " cycle'da bu pencerede mention. " +
      'pattern, not cause.',
    source: {
      citation: 'Cleeland et al. 2003, Cancer — Symptom clusters in oncology patients',
      url: 'https://doi.org/10.1002/cncr.11382',
    },
  };
}
