/**
 * @ollie/logic · recurring pattern detection
 *
 * Phase 2 of FINANCE_BACKEND_DESIGN.md.
 * - Fuzzy merchant clustering (Jaro-Winkler)
 * - Amount-band split: largest-gap split on sorted amounts (≥2 on each side)
 * - Frequency CUSUM change-point (Page 1954; Biometrika 41(1/2):100–115)
 * All pure functions. `now` injected by callers.
 */

import type {
  FinanceRecord,
  RecurringPattern,
  DetectRecurringResult,
  NextDuePrediction,
  Cadence,
} from './types';
import { jaroWinkler } from './jaro';
import { daysBetween, fMedian, fMad, fMean } from './math';

// ─── amount-band split ────────────────────────────────────────────────
function splitByPriceBand(records: FinanceRecord[], tolerance: number): FinanceRecord[][] {
  if (!records || records.length < 4) return [records];
  const withAmt = records.filter((r) => r.amount != null);
  if (withAmt.length < 4) return [records];
  const sorted = [...withAmt].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  let bestGap = 0;
  let bestIdx = -1;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      ((sorted[i].amount ?? 0) - (sorted[i - 1].amount ?? 0)) /
      Math.max(sorted[i - 1].amount ?? 1, 1);
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  if (bestGap <= tolerance || bestIdx < 0) return [records];
  const low = sorted.slice(0, bestIdx);
  const high = sorted.slice(bestIdx);
  if (low.length < 2 || high.length < 2) return [records];
  const noAmt = records.filter((r) => r.amount == null);
  if (noAmt.length) (low.length >= high.length ? low : high).push(...noAmt);
  return [low, high];
}

// ─── CUSUM change-point ───────────────────────────────────────────────
interface CusumResult {
  splitIdx: number | null;
  preMean: number | null;
  postMean: number | null;
}

function detectFreqChangePoint(
  intervals: number[],
  opts?: { k?: number; h?: number },
): CusumResult {
  if (!Array.isArray(intervals) || intervals.length < 6) {
    return { splitIdx: null, preMean: null, postMean: null };
  }
  const o = opts ?? {};
  const med = fMedian(intervals) ?? 0;
  const mad = fMad(intervals, med);
  const sigma = 1.4826 * (mad || 0.5);
  const k = o.k != null ? o.k : 0.5 * sigma;
  const h = o.h != null ? o.h : 5 * sigma;
  let sHi = 0;
  let sLo = 0;
  for (let i = 0; i < intervals.length; i++) {
    sHi = Math.max(0, sHi + (intervals[i] - med - k));
    sLo = Math.max(0, sLo - (intervals[i] - med + k));
    if (sHi > h || sLo > h) {
      const pre = intervals.slice(0, i);
      const post = intervals.slice(i);
      if (pre.length < 2 || post.length < 2) continue;
      const preMean = pre.reduce((a, b) => a + b, 0) / pre.length;
      const postMean = post.reduce((a, b) => a + b, 0) / post.length;
      return { splitIdx: i, preMean, postMean };
    }
  }
  return { splitIdx: null, preMean: null, postMean: null };
}

// ─── pattern builder ──────────────────────────────────────────────────
function buildPattern(
  records: FinanceRecord[],
  keyBase: string,
  minOcc: number,
  extra?: Partial<RecurringPattern>,
): RecurringPattern {
  const sorted = [...records].sort((a, b) =>
    (a.event_date ?? '').localeCompare(b.event_date ?? ''),
  );
  const amounts = sorted.map((r) => r.amount).filter((v): v is number => v != null);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1].event_date, sorted[i].event_date));
  }
  const medI = fMedian(intervals) ?? 0;
  const madI = fMad(intervals, medI);
  const medA = amounts.length ? fMedian(amounts) : null;
  const madA = amounts.length ? fMad(amounts, medA ?? 0) : 0;

  let cadence: Cadence = 'irregular';
  if (medI >= 6 && medI <= 8) cadence = 'weekly';
  else if (medI >= 12 && medI <= 16) cadence = 'biweekly';
  else if (medI >= 25 && medI <= 35) cadence = 'monthly';
  else if (medI >= 85 && medI <= 95) cadence = 'quarterly';
  else if (medI >= 350 && medI <= 380) cadence = 'yearly';

  const status = sorted.length >= minOcc ? 'mature' : 'early_detection';

  return {
    id: 'rec-' + keyBase.replace(/\s+/g, '-'),
    merchant_normalized: extra?.key ?? keyBase,
    display_name: sorted[0].merchant ?? undefined,
    record_ids: sorted.map((r) => r.id).filter((id): id is string => Boolean(id)),
    cadence,
    interval_days_median: medI,
    interval_days_mad: madI,
    amount_median: medA,
    amount_mad: madA,
    last_at: new Date(sorted[sorted.length - 1].event_date + 'T12:00:00').getTime(),
    first_seen_at: new Date(sorted[0].event_date + 'T12:00:00').getTime(),
    last_seen_at: new Date(sorted[sorted.length - 1].event_date + 'T12:00:00').getTime(),
    status,
    kind: sorted[0].direction === 'in' ? 'income' : 'bill',
    user_dismissed_stale: false,
    ...(extra ?? {}),
  };
}

// ─── public API ───────────────────────────────────────────────────────
export interface DetectRecurringOpts {
  minOccurrences?: number;
  fuzzyMatchThreshold?: number;
  priceDriftTolerance?: number;
}

export function detectRecurring(
  records: FinanceRecord[],
  opts?: DetectRecurringOpts,
): DetectRecurringResult {
  const o = opts ?? {};
  const minOcc = o.minOccurrences ?? 3;
  const fuzzyTh = o.fuzzyMatchThreshold ?? 0.88;
  const priceDriftTol = o.priceDriftTolerance ?? 0.15;

  if (!Array.isArray(records) || records.length === 0) {
    return { recurring: [], earlyDetection: [], oneOffs: [] };
  }

  const withM = records.filter((r) => r?.merchant_normalized);

  // merchant clustering
  const clusters: Array<{ key: string; records: FinanceRecord[] }> = [];
  for (const r of withM) {
    let bi = -1;
    let bs = 0;
    for (let i = 0; i < clusters.length; i++) {
      const sim = jaroWinkler(r.merchant_normalized!, clusters[i].key);
      if (sim > bs) {
        bs = sim;
        bi = i;
      }
    }
    if (bi >= 0 && bs >= fuzzyTh) clusters[bi].records.push(r);
    else clusters.push({ key: r.merchant_normalized!, records: [r] });
  }

  const recurring: RecurringPattern[] = [];
  const earlyDetection: RecurringPattern[] = [];
  const oneOffs: FinanceRecord[] = [];

  for (const c of clusters) {
    if (c.records.length < 2) {
      oneOffs.push(...c.records);
      continue;
    }
    const bands = splitByPriceBand(c.records, priceDriftTol);
    for (let bi = 0; bi < bands.length; bi++) {
      const band = bands[bi];
      if (band.length < 2) {
        oneOffs.push(...band);
        continue;
      }
      const suffix = bands.length > 1 ? `-band${bi}` : '';
      const sortedBand = [...band].sort((a, b) =>
        (a.event_date ?? '').localeCompare(b.event_date ?? ''),
      );
      const ivs: number[] = [];
      for (let i = 1; i < sortedBand.length; i++) {
        ivs.push(daysBetween(sortedBand[i - 1].event_date, sortedBand[i].event_date));
      }
      const cp = detectFreqChangePoint(ivs);
      if (cp.splitIdx != null && sortedBand.length >= 6) {
        const pre = sortedBand.slice(0, cp.splitIdx);
        const post = sortedBand.slice(cp.splitIdx);
        const parentId = 'rec-' + c.key.replace(/\s+/g, '-') + suffix;
        const pPre = buildPattern(pre, c.key + suffix + '-pre', minOcc, {
          key: c.key,
          cusum_split_parent_id: parentId,
        });
        const pPost = buildPattern(post, c.key + suffix + '-post', minOcc, {
          key: c.key,
          cusum_split_parent_id: parentId,
        });
        (pPre.status === 'mature' ? recurring : earlyDetection).push(pPre);
        (pPost.status === 'mature' ? recurring : earlyDetection).push(pPost);
      } else {
        const p = buildPattern(band, c.key + suffix, minOcc, { key: c.key });
        (p.status === 'mature' ? recurring : earlyDetection).push(p);
      }
    }
  }

  return { recurring, earlyDetection, oneOffs };
}

export function predictNextDue(p: RecurringPattern, _now: number): NextDuePrediction {
  if (!p?.last_at || !p.interval_days_median) {
    return { dueAt: null, confidence: 'low', rangeDays: null };
  }
  const dueAt = p.last_at + p.interval_days_median * 86_400_000;
  const mad = p.interval_days_mad || 0;
  const rangeDays = Number((1.4826 * mad).toFixed(1));
  return {
    dueAt,
    confidence: mad < 3 ? 'high' : mad < 7 ? 'medium' : 'low',
    rangeDays,
  };
}

// ─── reports ──────────────────────────────────────────────────────────
import type { MonthlyFlowResult, MoMDelta } from './types';

export function computeMonthlyOutflow(
  records: FinanceRecord[],
  offset: number,
  now: number,
): MonthlyFlowResult {
  if (!Array.isArray(records)) return { outflow: 0, inflow: 0, count: 0, net: 0 };
  const target = new Date(now);
  target.setMonth(target.getMonth() + (offset || 0));
  const ym =
    target.getFullYear() + '-' + String(target.getMonth() + 1).padStart(2, '0');
  let out = 0;
  let inn = 0;
  let c = 0;
  for (const r of records) {
    if (!r?.event_date || r.amount == null) continue;
    if (!r.event_date.startsWith(ym)) continue;
    c++;
    if (r.direction === 'in') inn += r.amount;
    else out += r.amount;
  }
  return {
    outflow: Number(out.toFixed(2)),
    inflow: Number(inn.toFixed(2)),
    count: c,
    net: Number((inn - out).toFixed(2)),
  };
}

export function monthOverMonthDelta(
  records: FinanceRecord[],
  baseN: number,
  now: number,
): MoMDelta | null {
  const B = baseN || 3;
  const tm = computeMonthlyOutflow(records, 0, now);
  const base: number[] = [];
  for (let i = 1; i <= B; i++) {
    const m = computeMonthlyOutflow(records, -i, now);
    if (m.count > 0) base.push(m.outflow);
  }
  if (base.length < B) return null;
  const bm = fMean(base) ?? 0;
  const d = tm.outflow - bm;
  const th = 0.1 * bm;
  return {
    thisMonth: tm.outflow,
    baseline: Number(bm.toFixed(2)),
    delta: Number(d.toFixed(2)),
    direction: d > th ? 'up' : d < -th ? 'down' : 'flat',
  };
}
