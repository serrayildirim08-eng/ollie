/**
 * @ollie/logic · finance · D3 pattern-detection (Canva-style)
 *
 * Sprint 3 · D3. Three quiet detectors that surface a card in the
 * Finance module — never a push notification. Brand voice: lowercase,
 * factual, no judgement.
 *
 * 1. SUBSCRIPTION DETECTION
 *    Same merchant + same amount (±5%) appearing ≥3 times at intervals
 *    of 28-32 days (monthly), 88-94 days (quarterly), 360-370 days
 *    (yearly). Surfaces "canva — $20 monthly for 3 months. cancel?"
 *
 * 2. ADHD-TAX DETECTION
 *    Running 30-day total of transactions flagged is_adhd_tax. Factual,
 *    never judgmental.
 *
 * 3. CYCLE-CORRELATED SPENDING
 *    Per-cycle: median daily luteal spend vs follicular spend. If
 *    luteal ≥ 1.20× follicular consistently across ≥3 cycles, surface
 *    "your spending in luteal phase has been ~X% higher across N cycles.
 *    pattern, not medical."
 *
 * Pure. No store. No emits. No wall-clock reads — `now` is injected.
 */

import type { FinanceRecord } from './types';

// ─── 1. SUBSCRIPTION DETECTION ────────────────────────────────────────────

const DAY = 86_400_000;

export type DetectedSubscriptionCadence = 'monthly' | 'quarterly' | 'yearly';

export interface DetectedSubscriptionCard {
  pattern: 'd3-subscription';
  pattern_id: string;
  merchant: string;
  amount: number;
  cadence: DetectedSubscriptionCadence;
  occurrence_count: number;
  first_seen_ts: number;
  last_seen_ts: number;
  /** Quiet card copy — factual, lowercase. */
  copy: string;
}

const CADENCE_BANDS: Array<{ cadence: DetectedSubscriptionCadence; min: number; max: number }> = [
  { cadence: 'monthly',   min: 28,  max: 32  },
  { cadence: 'quarterly', min: 88,  max: 94  },
  { cadence: 'yearly',    min: 360, max: 370 },
];

function normalize(merchant: string | null | undefined): string {
  if (!merchant) return '';
  return merchant.toLowerCase().trim().replace(/\s+/g, ' ');
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface MerchantAmountCluster {
  merchant: string;
  amount: number;
  occurrences: Array<{ ts: number; id?: string }>;
}

function clusterByMerchantAmount(records: FinanceRecord[]): MerchantAmountCluster[] {
  // Group by normalized merchant. Within each merchant, cluster amounts
  // that are within ±5% of each other.
  const byMerchant = new Map<string, FinanceRecord[]>();
  for (const r of records) {
    if (!r || r.direction !== 'out' || r.amount == null || !r.merchant_normalized) continue;
    if (r.kind === 'bill') continue; // bills handled by existing recurring detector
    const k = normalize(r.merchant_normalized);
    if (!k) continue;
    const arr = byMerchant.get(k) ?? [];
    arr.push(r);
    byMerchant.set(k, arr);
  }

  const clusters: MerchantAmountCluster[] = [];
  for (const [merchant, recs] of byMerchant) {
    const sorted = [...recs].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
    let current: FinanceRecord[] = [];
    let currentBand: number | null = null;
    for (const r of sorted) {
      const amt = r.amount as number;
      if (currentBand == null) {
        current = [r];
        currentBand = amt;
        continue;
      }
      // ±5% of the cluster median
      const med = median(current.map((x) => x.amount ?? 0));
      const tolerance = Math.max(med * 0.05, 0.5);
      if (Math.abs(amt - med) <= tolerance) {
        current.push(r);
      } else {
        if (current.length) {
          clusters.push({
            merchant,
            amount: median(current.map((x) => x.amount ?? 0)),
            occurrences: current.map((x) => ({
              ts: x.event_date ? Date.parse(x.event_date) : 0,
              id: x.id,
            })).filter((o) => o.ts > 0),
          });
        }
        current = [r];
        currentBand = amt;
      }
    }
    if (current.length) {
      clusters.push({
        merchant,
        amount: median(current.map((x) => x.amount ?? 0)),
        occurrences: current.map((x) => ({
          ts: x.event_date ? Date.parse(x.event_date) : 0,
          id: x.id,
        })).filter((o) => o.ts > 0),
      });
    }
  }
  return clusters;
}

function fitsCadence(intervals: number[], band: { min: number; max: number }): boolean {
  // Intervals must fall within the band. For 3 occurrences (= 2 intervals)
  // both must be in band — too lenient otherwise. For longer histories
  // (≥5 occurrences = ≥4 intervals) allow exactly 1 stray to tolerate
  // a single mis-billed month.
  let inBand = 0;
  for (const iv of intervals) {
    if (iv >= band.min && iv <= band.max) inBand++;
  }
  if (intervals.length === 0) return false;
  if (intervals.length < 4) return inBand === intervals.length;
  return inBand >= intervals.length - 1;
}

function classifyCadence(occurrenceTs: number[]): DetectedSubscriptionCadence | null {
  if (occurrenceTs.length < 3) return null;
  const sorted = [...occurrenceTs].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i] - sorted[i - 1]) / DAY);
  }
  for (const band of CADENCE_BANDS) {
    if (fitsCadence(intervals, band)) return band.cadence;
  }
  return null;
}

export function detectSubscriptions(
  records: FinanceRecord[],
): DetectedSubscriptionCard[] {
  const out: DetectedSubscriptionCard[] = [];
  const clusters = clusterByMerchantAmount(records ?? []);
  for (const c of clusters) {
    if (c.occurrences.length < 3) continue;
    const ts = c.occurrences.map((o) => o.ts);
    const cadence = classifyCadence(ts);
    if (!cadence) continue;
    const sorted = [...ts].sort((a, b) => a - b);
    const amount = Math.round(c.amount * 100) / 100;
    const cadenceWord =
      cadence === 'monthly' ? 'monthly' :
      cadence === 'quarterly' ? 'quarterly' : 'yearly';
    out.push({
      pattern: 'd3-subscription',
      pattern_id: `d3-sub:${c.merchant}:${amount}:${cadence}`,
      merchant: c.merchant,
      amount,
      cadence,
      occurrence_count: c.occurrences.length,
      first_seen_ts: sorted[0],
      last_seen_ts: sorted[sorted.length - 1],
      copy: `${c.merchant} — $${amount.toFixed(2)} ${cadenceWord} for ${c.occurrences.length} ${c.occurrences.length === 1 ? 'month' : 'months'}. cancel?`,
    });
  }
  return out;
}

// ─── 2. ADHD-TAX DETECTION ────────────────────────────────────────────────

export interface ADHDTaxRunningTotal {
  total_30d: number;
  count_30d: number;
  /** Quiet copy. Factual. No judgement. */
  copy: string;
}

export function adhdTaxRunningTotal(
  records: FinanceRecord[],
  now: number,
): ADHDTaxRunningTotal {
  const cutoff = now - 30 * DAY;
  let total = 0;
  let count = 0;
  for (const r of records ?? []) {
    if (!r || !r.is_adhd_tax || r.direction !== 'out' || r.amount == null) continue;
    const ts = r.event_date ? Date.parse(r.event_date) : 0;
    if (!ts || ts < cutoff || ts > now) continue;
    total += r.amount;
    count += 1;
  }
  total = Math.round(total * 100) / 100;
  return {
    total_30d: total,
    count_30d: count,
    copy: count
      ? `you've spent $${total.toFixed(2)} this month on impulse. ${count} ${count === 1 ? 'transaction' : 'transactions'}.`
      : '',
  };
}

// ─── 3. CYCLE-CORRELATED SPENDING ─────────────────────────────────────────

export interface CycleBoundary {
  /** Cycle start ts (period day 1). */
  startTs: number;
  /** Next cycle start ts, or null if it's the current open cycle. */
  endTs: number | null;
  /** Cycle length used for phase mapping. */
  lengthDays?: number;
}

export interface CycleSpendingPatternCard {
  pattern: 'd3-cycle-spending';
  luteal_ratio: number;
  follicular_median: number;
  luteal_median: number;
  cycle_count: number;
  copy: string;
}

/**
 * Standard convention: luteal phase ≈ last 14 days of the cycle.
 * Follicular ≈ day 1 (period start) through ovulation, ~first half.
 * We use a simple split: first 50% follicular, last 50% luteal, with the
 * first 5 days carved as menstrual (excluded from both buckets to reduce
 * noise — bleeding days have their own spend signature).
 */
function dailySpendByPhase(
  records: FinanceRecord[],
  cycles: CycleBoundary[],
): Array<{ follicular: number[]; luteal: number[] }> {
  const out: Array<{ follicular: number[]; luteal: number[] }> = [];
  for (const c of cycles) {
    if (typeof c.startTs !== 'number') continue;
    const end = c.endTs ?? c.startTs + (c.lengthDays ?? 28) * DAY;
    const lenDays = Math.max(1, Math.round((end - c.startTs) / DAY));
    const follicularStart = c.startTs + 5 * DAY;
    const lutealStart = c.startTs + Math.floor(lenDays / 2) * DAY;
    const cycleSpend: { follicular: number[]; luteal: number[] } = { follicular: [], luteal: [] };

    // Bucket each day's spend.
    const dailyTotals = new Map<number, number>();
    for (const r of records ?? []) {
      if (!r || r.direction !== 'out' || r.amount == null || !r.event_date) continue;
      if (r.kind === 'bill' || r.kind === 'sub') continue;
      const ts = Date.parse(r.event_date);
      if (!ts || ts < c.startTs || ts >= end) continue;
      const dayBucket = Math.floor(ts / DAY) * DAY;
      dailyTotals.set(dayBucket, (dailyTotals.get(dayBucket) ?? 0) + r.amount);
    }
    for (const [dayTs, amt] of dailyTotals) {
      if (dayTs < follicularStart) continue; // skip menstrual
      if (dayTs < lutealStart) cycleSpend.follicular.push(amt);
      else cycleSpend.luteal.push(amt);
    }
    out.push(cycleSpend);
  }
  return out;
}

export function detectCycleSpendingPattern(
  records: FinanceRecord[],
  cycles: CycleBoundary[],
): CycleSpendingPatternCard | null {
  if (!Array.isArray(cycles) || cycles.length < 3) return null;
  const buckets = dailySpendByPhase(records ?? [], cycles);

  // Per-cycle medians.
  const lutealMedians: number[] = [];
  const follicularMedians: number[] = [];
  let elevatedCount = 0;
  for (const b of buckets) {
    if (!b.luteal.length || !b.follicular.length) continue;
    const lm = median(b.luteal);
    const fm = median(b.follicular);
    lutealMedians.push(lm);
    follicularMedians.push(fm);
    if (fm > 0 && lm / fm >= 1.20) elevatedCount += 1;
  }
  if (lutealMedians.length < 3) return null;
  // Pattern fires only if ≥75% of usable cycles show elevation.
  if (elevatedCount / lutealMedians.length < 0.75) return null;

  const lutealMed = median(lutealMedians);
  const folMed = median(follicularMedians);
  const ratio = folMed > 0 ? lutealMed / folMed : 0;
  const pct = Math.round((ratio - 1) * 100);

  return {
    pattern: 'd3-cycle-spending',
    luteal_ratio: ratio,
    follicular_median: folMed,
    luteal_median: lutealMed,
    cycle_count: lutealMedians.length,
    copy: `your spending in luteal phase has been ~${pct}% higher across ${lutealMedians.length} cycles. pattern, not medical.`,
  };
}

// ─── unified surface ──────────────────────────────────────────────────────

export interface D3Output {
  subscriptions: DetectedSubscriptionCard[];
  adhdTax: ADHDTaxRunningTotal;
  cycleSpending: CycleSpendingPatternCard | null;
}

export function detectD3Patterns(input: {
  records: FinanceRecord[];
  cycles: CycleBoundary[];
  now: number;
}): D3Output {
  return {
    subscriptions: detectSubscriptions(input.records),
    adhdTax: adhdTaxRunningTotal(input.records, input.now),
    cycleSpending: detectCycleSpendingPattern(input.records, input.cycles),
  };
}
