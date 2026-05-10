/**
 * @ollie/logic · cross-module correlations (Phase 5)
 *
 * §9.18 opt-in only. Logic layer is pure — orchestrator owns store reads.
 * spearmanRho: Spearman 1904.
 * correlateFinanceWithCycle: Pine & Fletcher 2011; Bakshi & Mason 1989.
 * correlateFinanceWithSleepDebt: McKenna et al. 2007; Killgore 2010.
 */

import type {
  FinanceRecord,
  SpearmanResult,
  CycleFinanceCorrelation,
  SleepFinanceCorrelation,
} from './types';
import { fMedian } from './math';

export function spearmanRho(xs: number[], ys: number[]): SpearmanResult | null {
  if (!Array.isArray(xs) || !Array.isArray(ys)) return null;
  if (xs.length !== ys.length || xs.length < 3) return null;

  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1; // 1-based average rank
      for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  };

  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { rho: 0, n };
  return { rho: Number((num / Math.sqrt(dx * dy)).toFixed(4)), n };
}

export interface CycleCorrelateInput {
  phasesByDate: Map<string, string> | Record<string, string>;
  cycleLengths?: number[];
}

export function correlateFinanceWithCycle(
  financeRecords: FinanceRecord[],
  cycleData: CycleCorrelateInput,
  _now: number,
): CycleFinanceCorrelation | null {
  if (!financeRecords || !cycleData?.phasesByDate) return null;

  const phasesByDate = cycleData.phasesByDate;
  const cycleLengths = Array.isArray(cycleData.cycleLengths) ? cycleData.cycleLengths : [];

  const byDay: Record<string, { phase: string; total: number }> = {};
  for (const r of financeRecords) {
    if (!r || r.direction !== 'out' || r.amount == null || !r.event_date) continue;
    if (r.kind === 'bill' || r.kind === 'sub') continue;
    const phase =
      phasesByDate instanceof Map
        ? phasesByDate.get(r.event_date)
        : (phasesByDate as Record<string, string>)[r.event_date];
    if (!phase) continue;
    if (!byDay[r.event_date]) byDay[r.event_date] = { phase, total: 0 };
    byDay[r.event_date].total += r.amount;
  }

  const entries = Object.values(byDay);
  if (entries.length < 7) return null;

  const medBy = (ph: string): number => {
    const vs = entries.filter((e) => e.phase === ph).map((e) => e.total);
    return vs.length ? (fMedian(vs) ?? 0) : 0;
  };

  const lutealMed = medBy('luteal');
  const follicularMed = medBy('follicular');
  const menstrualMed = medBy('menstrual');
  const ovulationMed = medBy('ovulation_window');
  const nonLuteal = entries.filter((e) => e.phase !== 'luteal').map((e) => e.total);
  const nonLutealMed = nonLuteal.length ? (fMedian(nonLuteal) ?? 0) : 0;
  const ratio = nonLutealMed > 0 ? lutealMed / nonLutealMed : 0;

  const phaseRank: Record<string, number> = {
    menstrual: 0,
    follicular: 1,
    ovulation_window: 2,
    luteal: 3,
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of entries) {
    const r = phaseRank[e.phase];
    if (r == null) continue;
    xs.push(r);
    ys.push(e.total);
  }
  const sp = spearmanRho(xs, ys);
  if (!sp) return null;

  return {
    luteal_median_daily: Number(lutealMed.toFixed(2)),
    follicular_median_daily: Number(follicularMed.toFixed(2)),
    menstrual_median_daily: Number(menstrualMed.toFixed(2)),
    ovulation_median_daily: Number(ovulationMed.toFixed(2)),
    luteal_vs_rest_ratio: Number(ratio.toFixed(2)),
    spearman_rho: sp.rho,
    n_days: entries.length,
    n_cycles: cycleLengths.length,
    cited_urls: [
      'https://doi.org/10.1002/cb.343',
      'https://www.acrwebsite.org/volumes/6924/volumes/v16/NA-16',
    ],
  };
}

export interface SleepCorrelateInput {
  sleepDebtByDate: Map<string, number> | Record<string, number>;
}

export function correlateFinanceWithSleepDebt(
  financeRecords: FinanceRecord[],
  sleepData: SleepCorrelateInput,
  _now: number,
): SleepFinanceCorrelation | null {
  if (!financeRecords || !sleepData?.sleepDebtByDate) return null;

  const dbg = sleepData.sleepDebtByDate;
  const byDay: Record<string, number> = {};
  for (const r of financeRecords) {
    if (!r || r.direction !== 'out' || r.amount == null || !r.event_date) continue;
    if (r.kind === 'bill' || r.kind === 'sub') continue;
    byDay[r.event_date] = (byDay[r.event_date] ?? 0) + r.amount;
  }

  const overlap: Array<{ d: string; spend: number; debt: number }> = [];
  for (const [d, spend] of Object.entries(byDay)) {
    const debt = dbg instanceof Map ? dbg.get(d) : (dbg as Record<string, number>)[d];
    if (typeof debt !== 'number') continue;
    overlap.push({ d, spend, debt });
  }
  if (overlap.length < 28) return null;

  const xs = overlap.map((o) => o.debt);
  const ys = overlap.map((o) => o.spend);
  const sp = spearmanRho(xs, ys);
  if (!sp) return null;

  const lowSleep = overlap.filter((o) => o.debt >= 2).map((o) => o.spend);
  const normalSleep = overlap.filter((o) => o.debt < 2).map((o) => o.spend);

  return {
    spearman_rho: sp.rho,
    n_days: overlap.length,
    low_sleep_days_median_spend: lowSleep.length
      ? Number((fMedian(lowSleep) ?? 0).toFixed(2))
      : 0,
    normal_sleep_days_median_spend: normalSleep.length
      ? Number((fMedian(normalSleep) ?? 0).toFixed(2))
      : 0,
    cited_urls: [
      'https://doi.org/10.1093/sleep/30.5.603',
      'https://doi.org/10.1016/B978-0-444-53702-7.00007-5',
    ],
    confidence: 'low',
  };
}
