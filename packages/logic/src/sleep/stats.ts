/**
 * @ollie/logic · sleep · stats & analysis
 *
 * deriveSleepStats, computeSleepDebt, detectBedtimeDrift,
 * estimateChronotype, computeSocialJetlag, correlateSleepWith,
 * detectDSPSPattern, detectShortSleepRun, forecastTonightTST.
 *
 * No I/O. No DOM. No wall-clock reads (now is explicit).
 */

import type {
  SleepRecord,
  SleepStats,
  SleepDebt,
  BedtimeDriftResult,
  ChronotypeResult,
  SocialJetlagResult,
  CorrelationResult,
  CorrelationMetric,
  DSPSResult,
  ShortSleepRunResult,
  ForecastResult,
  PredictApi,
  SleepSettings,
} from './types';
import {
  parseTimeOfDay,
  bedtimeRelativeMinutes,
  minutesInBed,
  formatTime,
  isoDate,
  _mean,
  _stdev,
  _median,
} from './helpers';
import { CHRONO_BANDS } from './constants';

export function deriveSleepStats(records: SleepRecord[], W = 14): SleepStats | null {
  if (!Array.isArray(records)) return null;
  const usable = records
    .filter((r) => r && !r.is_skipped && r.tst_min != null)
    .slice(-W);
  if (usable.length < 5) return null;
  const tst = usable.map((r) => r.tst_min as number);
  const sol = usable.map((r) => r.onset_latency_min || 0);
  const eff = usable.map((r) => r.efficiency).filter((x): x is number => x != null);
  const wak = usable.map((r) => r.wakings_count || 0);
  return {
    nights_counted: usable.length,
    tst_mean_min: Math.round(_mean(tst)!),
    tst_sd_min: Math.round(_stdev(tst)),
    sol_mean_min: Math.round(_mean(sol)!),
    wakings_mean: Number(_mean(wak)!.toFixed(2)),
    efficiency_mean: eff.length >= 3 ? Number(_mean(eff)!.toFixed(3)) : null,
  };
}

export function computeSleepDebt(
  records: SleepRecord[],
  targetHours: number | undefined,
  W = 14,
  now?: number,
): SleepDebt {
  const target = typeof targetHours === 'number' ? targetHours : 7.5;
  const targetMin = target * 60;
  if (!Array.isArray(records) || records.length === 0)
    return { totalDeficitHours: 0, nightsCounted: 0 };
  const cutoff = typeof now === 'number' ? now - W * 86400000 : 0;
  const window = records
    .filter((r) => r && !r.is_skipped && r.tst_min != null)
    .filter((r) => {
      if (typeof now !== 'number') return true;
      const d = new Date(r.night_of + 'T12:00:00');
      return d.getTime() >= cutoff;
    });
  let deficit = 0;
  for (const r of window) deficit += Math.max(0, targetMin - (r.tst_min as number));
  return { totalDeficitHours: Number((deficit / 60).toFixed(2)), nightsCounted: window.length };
}

export function detectBedtimeDrift(
  records: SleepRecord[],
  _now?: number,
): BedtimeDriftResult | null {
  if (!Array.isArray(records)) return null;
  const usable = records
    .filter((r) => r && !r.is_skipped && r.bedtime)
    .slice(-21);
  if (usable.length < 7) return null;
  const ys = usable
    .map((r) => bedtimeRelativeMinutes(parseTimeOfDay(r.bedtime)))
    .filter((x): x is number => x != null);
  if (ys.length < 7) return null;
  const xs = ys.map((_, i) => i);
  const n = ys.length;
  const xM = _mean(xs)!;
  const yM = _mean(ys)!;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xM) * (ys[i] - yM);
    den += (xs[i] - xM) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = yM - slope * xM;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yH = slope * xs[i] + intercept;
    ssRes += (ys[i] - yH) ** 2;
    ssTot += (ys[i] - yM) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  if (r2 < 0.3) return null;
  return {
    slope: Number(slope.toFixed(2)),
    r2: Number(r2.toFixed(3)),
    direction: slope > 0 ? 'later' : 'earlier',
    n_nights: n,
  };
}

export function estimateChronotype(
  records: SleepRecord[],
  _now?: number,
): ChronotypeResult | null {
  if (!Array.isArray(records)) return null;
  const usable = records
    .filter((r) => r && !r.is_skipped && r.bedtime && r.wake_time)
    .slice(-28);
  if (usable.length < 14) return null;
  const mids: number[] = [];
  for (const r of usable) {
    const bt = parseTimeOfDay(r.bedtime);
    const wt = parseTimeOfDay(r.wake_time);
    if (bt == null || wt == null) continue;
    const inBed = minutesInBed(bt, wt);
    if (!inBed) continue;
    mids.push((bt + inBed / 2) % 1440);
  }
  if (mids.length < 10) return null;
  const msfSc = _median(mids)!;
  const band =
    CHRONO_BANDS.find((b) => msfSc < b.max) || CHRONO_BANDS[CHRONO_BANDS.length - 1];
  return {
    msfSc: Math.round(msfSc),
    msfScFormatted: formatTime(Math.round(msfSc)),
    category: band.band,
    nNights: mids.length,
  };
}

export function computeSocialJetlag(
  records: SleepRecord[],
  settings?: SleepSettings | null,
): SocialJetlagResult | null {
  if (!Array.isArray(records)) return null;
  const weekdays = settings?.weekday_set || ['sun', 'mon', 'tue', 'wed', 'thu'];
  const weekendDays = settings?.weekend_set || ['fri', 'sat'];
  const wkSet = new Set(weekdays.map((d) => d.toLowerCase()));
  const weSet = new Set(weekendDays.map((d) => d.toLowerCase()));
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const usable = records
    .filter((r) => r && !r.is_skipped && r.bedtime && r.wake_time && r.night_of)
    .slice(-28);
  if (usable.length < 14) return null;
  const midFor = (r: SleepRecord): number | null => {
    const bt = parseTimeOfDay(r.bedtime);
    const wt = parseTimeOfDay(r.wake_time);
    if (bt == null || wt == null) return null;
    const ib = minutesInBed(bt, wt);
    if (!ib) return null;
    return (bt + ib / 2) % 1440;
  };
  const workMids: number[] = [], freeMids: number[] = [];
  for (const r of usable) {
    const d = new Date(r.night_of + 'T12:00:00');
    const name = dayNames[d.getDay()];
    const m = midFor(r);
    if (m == null) continue;
    if (wkSet.has(name)) workMids.push(m);
    else if (weSet.has(name)) freeMids.push(m);
  }
  if (workMids.length < 5 || freeMids.length < 3) return null;
  const msw = _median(workMids)!;
  const msf = _median(freeMids)!;
  let delta = msf - msw;
  if (delta < -720) delta += 1440;
  else if (delta > 720) delta -= 1440;
  return {
    hours: Number((Math.abs(delta) / 60).toFixed(2)),
    direction: delta > 0 ? 'free-later' : 'free-earlier',
    nWeekdayNights: workMids.length,
    nWeekendNights: freeMids.length,
  };
}

export function correlateSleepWith(
  records: SleepRecord[],
  _events: unknown,
  tokenList: string[],
  metric: CorrelationMetric,
  _now?: number,
): CorrelationResult | null {
  if (!Array.isArray(records) || !Array.isArray(tokenList) || tokenList.length === 0)
    return null;
  const keyMap: Record<CorrelationMetric, keyof SleepRecord> = {
    sol: 'onset_latency_min',
    tst: 'tst_min',
    efficiency: 'efficiency',
    wakings: 'wakings_count',
  };
  const key = keyMap[metric];
  if (!key) return null;
  const tokLower = tokenList.map((t) => String(t).toLowerCase());
  const match = (r: SleepRecord): boolean =>
    Array.isArray(r.tokens) &&
    r.tokens.some((tok) => tokLower.includes(String(tok).split(':').pop() ?? ''));
  const a: number[] = [], b: number[] = [];
  for (const r of records) {
    if (!r || r.is_skipped) continue;
    const v = r[key] as number | null | undefined;
    if (v == null) continue;
    (match(r) ? a : b).push(v);
  }
  if (a.length < 10 || b.length < 10) return null;
  const mA = _mean(a)!;
  const mB = _mean(b)!;
  const pooledSd = Math.sqrt((_stdev(a) ** 2 + _stdev(b) ** 2) / 2);
  let effect: number;
  if (pooledSd > 0) effect = (mA - mB) / pooledSd;
  else {
    const delta = mA - mB;
    if (Math.abs(delta) < 1) return null;
    effect = delta > 0 ? 10 : -10;
  }
  if (Math.abs(effect) < 0.2) return null;
  return {
    metric,
    meanWith: Number(mA.toFixed(1)),
    meanWithout: Number(mB.toFixed(1)),
    nWith: a.length,
    nWithout: b.length,
    effectSize: Number(effect.toFixed(2)),
  };
}

export function detectDSPSPattern(
  records: SleepRecord[],
  _now?: number,
): DSPSResult | null {
  if (!Array.isArray(records)) return null;
  const usable = records
    .filter((r) => r && !r.is_skipped && r.bedtime && r.wake_time)
    .slice(-28);
  if (usable.length < 14) return null;
  const bts = usable
    .map((r) => parseTimeOfDay(r.bedtime))
    .filter((x): x is number => x != null);
  const wks = usable
    .map((r) => parseTimeOfDay(r.wake_time))
    .filter((x): x is number => x != null);
  if (bts.length < 14 || wks.length < 14) return null;
  const late = bts.filter((b) => b < 360 || b === 0).length;
  const medWake = _median(wks)!;
  if (late / bts.length < 0.5) return null;
  if (medWake < 600) return null;
  return {
    runWeeks: Math.floor(usable.length / 7),
    medianBedtime: formatTime(Math.round(_median(bts)!)),
    medianWake: formatTime(Math.round(medWake)),
    lateBedtimeFraction: Number((late / bts.length).toFixed(2)),
    nNights: usable.length,
  };
}

export function detectShortSleepRun(
  records: SleepRecord[],
  thresholdHours?: number,
  minRun?: number,
  _now?: number,
): ShortSleepRunResult | null {
  if (!Array.isArray(records)) return null;
  const thMin = (thresholdHours != null ? thresholdHours : 5) * 60;
  const minR = minRun != null ? minRun : 5;
  let run = 0, best = 0;
  const acc: number[] = [];
  for (const r of records) {
    if (!r || r.is_skipped || r.tst_min == null) {
      run = 0;
      continue;
    }
    if (r.tst_min < thMin) {
      run++;
      acc.push(r.tst_min);
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  if (best < minR) return null;
  return { runNights: best, meanTst: Math.round(_mean(acc) || 0) };
}

export function forecastTonightTST(
  records: SleepRecord[],
  predictApi: PredictApi,
): ForecastResult | null {
  if (!Array.isArray(records) || !predictApi || typeof predictApi.forecast !== 'function')
    return null;
  const usable = records
    .filter((r) => r && !r.is_skipped && typeof r.tst_min === 'number' && isFinite(r.tst_min as number))
    .slice(-14);
  if (usable.length < 3) return null;
  const hours = usable.map((r) => (r.tst_min as number) / 60);
  const f = predictApi.forecast(hours, { preset: 'sleepHours' });
  if (!f || typeof f.mean !== 'number') return null;
  return {
    mean_h: Number(f.mean.toFixed(1)),
    ci95_h: [Number(f.ci95[0].toFixed(1)), Number(f.ci95[1].toFixed(1))],
    mean_min: Math.round(f.mean * 60),
    ci95_min: [Math.round(f.ci95[0] * 60), Math.round(f.ci95[1] * 60)],
    tier: f.tier,
    method: f.method,
    nights_counted: usable.length,
  };
}

/** Re-export isoDate so patterns can use it without circular imports. */
export { isoDate };
