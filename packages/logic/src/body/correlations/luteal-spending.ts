/**
 * @ollie/logic · body · luteal-spending correlator
 *
 * Spearman ρ between (days_into_luteal, daily_spend).
 * Sample ≥ 14 paired (day, spend) entries; threshold |ρ| > 0.30.
 *
 * Reuses spearman() from ../math. No I/O. No DOM.
 */

import { spearman } from '../math';
import { computePhaseForDate } from '../../cycle';
import type { CycleRecord } from '../../cycle/types';
import type { FinanceRecord } from '../../finance/types';

import { DAY_MS, dayKey, resolveNow } from '../../util';
const DEFAULT_LOOKBACK_DAYS = 90;

export interface LutealSpendingResult {
  correlation: number;
  sampleSize: number;
  copy: string;
  ts: number;
}

export interface CorrelateLutealSpendingOpts {
  lookbackDays?: number;
  minSampleSize?: number;
  thresholdRho?: number;
  now?: number;
}

/** YYYY-MM-DD key in LOCAL tz — delegates to the shared util. */
const localDateKey = dayKey;

function sortedCycles(cycles: readonly CycleRecord[]): CycleRecord[] {
  return cycles
    .filter((c): c is CycleRecord => !!c && typeof c.cycleStartTs === 'number')
    .slice()
    .sort((a, b) => a.cycleStartTs - b.cycleStartTs);
}

function daysIntoLuteal(
  cycles: readonly CycleRecord[],
  dayEpoch: number,
): number | null {
  const phase = computePhaseForDate(cycles, dayEpoch);
  if (phase !== 'luteal') return null;
  let lutealStart = dayEpoch;
  for (let i = 1; i <= 30; i++) {
    const probe = dayEpoch - i * DAY_MS;
    const probePhase = computePhaseForDate(cycles, probe);
    if (probePhase !== 'luteal') {
      lutealStart = probe + DAY_MS;
      break;
    }
    if (i === 30) return null;
  }
  const daysIn = Math.round((dayEpoch - lutealStart) / DAY_MS) + 1;
  if (daysIn < 1 || daysIn > 20) return null;
  return daysIn;
}

function dailySpendByDay(txns: readonly FinanceRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txns) {
    if (!t || typeof t !== 'object') continue;
    if (t.direction !== 'out') continue;
    if (typeof t.amount !== 'number' || !isFinite(t.amount)) continue;
    if (typeof t.event_date !== 'string') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.event_date)) continue;
    const prev = out.get(t.event_date) ?? 0;
    out.set(t.event_date, prev + Math.abs(t.amount));
  }
  return out;
}

function noonEpochFromDateKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const t = new Date(y, mo, d, 12, 0, 0, 0).getTime();
  return isFinite(t) ? t : null;
}

export function correlateLutealAndSpending(
  cycles: readonly CycleRecord[] | undefined | null,
  txns: readonly FinanceRecord[] | undefined | null,
  opts?: CorrelateLutealSpendingOpts,
): LutealSpendingResult {
  const now = resolveNow(opts?.now);
  const lookback = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const minN = opts?.minSampleSize ?? 14;
  const thresholdRho = opts?.thresholdRho ?? 0.30;

  if (!Array.isArray(cycles) || cycles.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }
  if (!Array.isArray(txns) || txns.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const sortedC = sortedCycles(cycles);
  if (sortedC.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const spendByDay = dailySpendByDay(txns);
  const fromTs = now - lookback * DAY_MS;

  const xs: number[] = [];
  const ys: number[] = [];

  for (let t = fromTs; t <= now; t += DAY_MS) {
    const noon = new Date(t);
    noon.setHours(12, 0, 0, 0);
    const noonMs = noon.getTime();
    const dKey = localDateKey(noonMs);
    const noonEpoch = noonEpochFromDateKey(dKey);
    if (noonEpoch == null) continue;

    const daysIn = daysIntoLuteal(sortedC, noonEpoch);
    if (daysIn == null) continue;

    const spend = spendByDay.get(dKey) ?? 0;
    xs.push(daysIn);
    ys.push(spend);
  }

  const n = xs.length;
  if (n < minN) {
    return { correlation: 0, sampleSize: n, copy: '', ts: now };
  }

  const rho = spearman(xs, ys);
  if (Math.abs(rho) < thresholdRho) {
    return { correlation: rho, sampleSize: n, copy: '', ts: now };
  }

  let copy: string;
  if (rho > 0) {
    const meanSpend = ys.reduce((s, y) => s + y, 0) / n;
    const rounded = Math.round(meanSpend);
    const cyclesObserved = Math.max(1, Math.round(n / 12));
    copy = `spending climbs across luteal · avg $${rounded}/day · ${cyclesObserved} cycle${cyclesObserved === 1 ? '' : 's'} of data`;
  } else {
    copy = `spending drops across luteal for you · ${n} days of data`;
  }

  return { correlation: rho, sampleSize: n, copy, ts: now };
}
