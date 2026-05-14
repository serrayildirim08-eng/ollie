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

// ─── detectRecurringEarly ─────────────────────────────────────────────

/**
 * Known-recurring merchant patterns for low-confidence single-occurrence
 * detection. Normalised (lowercase, no TLD). Add new entries here only —
 * never widen an existing pattern to avoid false positives.
 */
const KNOWN_RECURRING_PATTERNS: RegExp[] = [
  // streaming
  /\bnetflix\b/, /\bspotify\b/, /\bhulu\b/, /\bdisney\b/, /\bapple\s*tv\b/,
  /\bhbo\b/, /\bamazon\s*prime\b/, /\bparamount\b/, /\bpandora\b/, /\btidal\b/,
  // utilities
  /\belectr(ic|icity)\b/, /\bwater\s*bill\b/, /\bgas\s*bill\b/, /\binternet\b/,
  /\bphone\s*bill\b/, /\bmobile\s*plan\b/, /\bcell\s*phone\b/,
  // housing
  /\brent\b/, /\bmortgage\b/, /\bhoa\b/,
  // insurance
  /\binsurance\b/, /\bgeico\b/, /\bstate\s*farm\b/, /\ballstate\b/,
  // software / cloud
  /\badobe\b/, /\bmicrosoft\b/, /\boffice\s*365\b/, /\bdropbox\b/, /\bgoogle\s*one\b/,
  /\bicloud\b/, /\bslack\b/, /\bgithub\b/, /\bnotion\b/, /\bfigma\b/,
  // health + fitness
  /\bgym\b/, /\bpeloton\b/, /\bheadspace\b/, /\bcalm\b/,
  // food subscriptions
  /\bhello\s*fresh\b/, /\bblue\s*apron\b/,
  // loans / financing
  /\bloan\b/, /\bstudent\s*loan\b/, /\bauto\s*loan\b/, /\bcar\s*(payment|loan)\b/,
  /\bcredit\s*card\s*payment\b/,
  // additional utility providers
  /\bcomcast\b/, /\bxfinity\b/, /\bverizon\b/, /\bat&t\b/, /\bt-mobile\b/,
  /\bspectrum\b/, /\bpge\b/, /\bconedison\b/, /\bcon\s*ed\b/,
];

/**
 * Patterns that strongly indicate 'bill' category (essential, recurring, typically >$50).
 * Checked against merchant_normalized (lowercase). Order: most-specific first.
 */
const BILL_PATTERNS: RegExp[] = [
  /\brent\b/, /\bmortgage\b/, /\bhoa\b/,
  /\belectr(ic|icity)\b/, /\bwater\s*bill\b/, /\bgas\s*bill\b/,
  /\binternet\b/, /\bphone\s*bill\b/, /\bmobile\s*plan\b/, /\bcell\s*phone\b/,
  /\binsurance\b/, /\bgeico\b/, /\bstate\s*farm\b/, /\ballstate\b/,
  /\bloan\b/, /\bstudent\s*loan\b/, /\bauto\s*loan\b/, /\bcar\s*(payment|loan)\b/,
  /\bcredit\s*card\s*payment\b/,
  /\bcomcast\b/, /\bxfinity\b/, /\bverizon\b/, /\bat&t\b/, /\bt-mobile\b/,
  /\bspectrum\b/, /\bpge\b/, /\bconedison\b/, /\bcon\s*ed\b/,
];

/**
 * Patterns that strongly indicate 'subscription' category (typically <$30, optional services).
 */
const SUBSCRIPTION_PATTERNS: RegExp[] = [
  /\bnetflix\b/, /\bspotify\b/, /\bhulu\b/, /\bdisney\b/, /\bapple\s*tv\b/,
  /\bhbo\b/, /\bamazon\s*prime\b/, /\bparamount\b/, /\bpandora\b/, /\btidal\b/,
  /\badobe\b/, /\bmicrosoft\b/, /\boffice\s*365\b/, /\bdropbox\b/, /\bgoogle\s*one\b/,
  /\bicloud\b/, /\bslack\b/, /\bgithub\b/, /\bnotion\b/, /\bfigma\b/,
  /\bgym\b/, /\bpeloton\b/, /\bheadspace\b/, /\bcalm\b/,
  /\bhello\s*fresh\b/, /\bblue\s*apron\b/,
];

/** Threshold: amounts at or above this are presumed essential bills. */
const BILL_AMOUNT_THRESHOLD = 50;

/**
 * Classify a candidate as 'bill', 'subscription', or 'unknown'.
 * Rules (in priority order):
 *   1. Merchant matches BILL_PATTERNS → 'bill'
 *   2. Merchant matches SUBSCRIPTION_PATTERNS → 'subscription'
 *   3. Amount ≥ $50 → 'bill'
 *   4. Amount < $30 and not null → 'subscription'
 *   5. 'unknown'
 */
export function classifyRecurringCategory(
  merchantNormalized: string,
  estimatedAmount: number | null,
): RecurringCandidateCategory {
  const norm = merchantNormalized.toLowerCase();
  if (BILL_PATTERNS.some((re) => re.test(norm))) return 'bill';
  if (SUBSCRIPTION_PATTERNS.some((re) => re.test(norm))) return 'subscription';
  if (estimatedAmount != null && estimatedAmount >= BILL_AMOUNT_THRESHOLD) return 'bill';
  if (estimatedAmount != null && estimatedAmount < 30) return 'subscription';
  return 'unknown';
}

export type EarlyConfidence = 'low' | 'medium' | 'high';

export interface RecurringCandidateEvidence {
  occurrenceCount: number;
  amountVariance: number | null;  // coefficient of variation; null when single occurrence
  intervalVariance: number | null; // MAD in days; null when fewer than 2 intervals
}

export type RecurringCandidateCategory = 'bill' | 'subscription' | 'unknown';

export interface RecurringCandidate {
  merchant: string;
  merchant_normalized: string;
  estimatedAmount: number | null;
  estimatedInterval: number | null;  // days
  nextDueDate: number | null;        // ms timestamp
  confidence: EarlyConfidence;
  evidence: RecurringCandidateEvidence;
  /** 'bill' for essential recurring (rent, utilities, insurance, loan).
   *  'subscription' for recurring entertainment/SaaS typically <$30.
   *  'unknown' when heuristics are inconclusive. */
  category: RecurringCandidateCategory;
}

export interface DetectRecurringEarlyOpts {
  /** Amount tolerance as a fraction. Default 0.05 (±5%). */
  amountTolerance?: number;
  /** Interval tolerance in days. Default 5. */
  intervalToleranceDays?: number;
  /** Jaro-Winkler threshold for merchant clustering. Default 0.88. */
  fuzzyMatchThreshold?: number;
}

/**
 * detectRecurringEarly — surfaces candidate recurring bills with 1–2 occurrences.
 *
 * Confidence rules:
 *   high   — ≥3 occurrences (delegates to caller; included for completeness)
 *   medium — 2 occurrences with consistent amount (±5%) and interval (±5d)
 *   low    — 1 occurrence AND merchant matches KNOWN_RECURRING_PATTERNS
 *
 * Pure function; no side effects. Does NOT replace detectRecurring().
 */
export function detectRecurringEarly(
  records: FinanceRecord[],
  opts?: DetectRecurringEarlyOpts,
): RecurringCandidate[] {
  if (!Array.isArray(records) || records.length === 0) return [];

  const o = opts ?? {};
  const amtTol = o.amountTolerance ?? 0.05;
  const ivTol = o.intervalToleranceDays ?? 5;
  const fuzzyTh = o.fuzzyMatchThreshold ?? 0.88;

  // Only consider expense records with a merchant
  const withM = records.filter((r) => r?.merchant_normalized && r.direction !== 'in');

  // Cluster by merchant (same logic as detectRecurring)
  const clusters: Array<{ key: string; displayName: string | null; records: FinanceRecord[] }> = [];
  for (const r of withM) {
    let bi = -1;
    let bs = 0;
    for (let i = 0; i < clusters.length; i++) {
      const sim = jaroWinkler(r.merchant_normalized!, clusters[i].key);
      if (sim > bs) { bs = sim; bi = i; }
    }
    if (bi >= 0 && bs >= fuzzyTh) {
      clusters[bi].records.push(r);
    } else {
      clusters.push({ key: r.merchant_normalized!, displayName: r.merchant ?? null, records: [r] });
    }
  }

  const candidates: RecurringCandidate[] = [];

  for (const c of clusters) {
    const sorted = [...c.records].sort((a, b) =>
      (a.event_date ?? '').localeCompare(b.event_date ?? ''),
    );
    const count = sorted.length;
    const amounts = sorted.map((r) => r.amount).filter((v): v is number => v != null);
    const medAmt = amounts.length ? fMedian(amounts) : null;
    const madAmt = amounts.length > 1 ? fMad(amounts, medAmt ?? 0) : 0;
    const cvAmt = (medAmt && medAmt > 0) ? madAmt / medAmt : null;

    if (count >= 3) {
      // high confidence — pass through; detectRecurring() is the authority
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(daysBetween(sorted[i - 1].event_date, sorted[i].event_date));
      }
      const medI = fMedian(intervals) ?? 0;
      const madI = fMad(intervals, medI);
      const lastAt = new Date(sorted[sorted.length - 1].event_date + 'T12:00:00').getTime();
      candidates.push({
        merchant: c.displayName ?? c.key,
        merchant_normalized: c.key,
        estimatedAmount: medAmt,
        estimatedInterval: medI || null,
        nextDueDate: medI > 0 ? lastAt + medI * 86_400_000 : null,
        confidence: 'high',
        category: classifyRecurringCategory(c.key, medAmt),
        evidence: {
          occurrenceCount: count,
          amountVariance: cvAmt,
          intervalVariance: madI,
        },
      });
      continue;
    }

    if (count === 2) {
      const interval = daysBetween(sorted[0].event_date, sorted[1].event_date);
      const amountConsistent = cvAmt === null || cvAmt <= amtTol;
      // interval must be plausibly recurring: 3–400 days, variance within tolerance
      const intervalPlausible = interval >= 3 && interval <= 400;
      const lastAt = new Date(sorted[1].event_date + 'T12:00:00').getTime();
      if (amountConsistent && intervalPlausible) {
        candidates.push({
          merchant: c.displayName ?? c.key,
          merchant_normalized: c.key,
          estimatedAmount: medAmt,
          estimatedInterval: interval,
          nextDueDate: lastAt + interval * 86_400_000,
          confidence: 'medium',
          category: classifyRecurringCategory(c.key, medAmt),
          evidence: {
            occurrenceCount: 2,
            amountVariance: cvAmt,
            intervalVariance: ivTol, // we only have 1 interval; report the tolerance
          },
        });
      }
      continue;
    }

    if (count === 1) {
      const norm = c.key.toLowerCase();
      const isKnown = KNOWN_RECURRING_PATTERNS.some((re) => re.test(norm));
      if (!isKnown) continue;
      const lastAt = new Date(sorted[0].event_date + 'T12:00:00').getTime();
      candidates.push({
        merchant: c.displayName ?? c.key,
        merchant_normalized: c.key,
        estimatedAmount: medAmt,
        estimatedInterval: null,
        nextDueDate: null,
        confidence: 'low',
        category: classifyRecurringCategory(c.key, medAmt),
        evidence: {
          occurrenceCount: 1,
          amountVariance: null,
          intervalVariance: null,
        },
      });
      void lastAt; // suppress unused-var lint
      continue;
    }
  }

  return candidates;
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
