/**
 * @ollie/logic · finance · variable income tracking
 *
 * Money-module gap closure. Targets the gig/freelance/contractor case
 * the existing classifyPayFrequency() (reports.ts) doesn't characterise
 * well — it returns a 5-bucket label, but doesn't surface:
 *
 *   - "this looks like recurring invoice payments from N clients"
 *   - "this month's income is X% below the 3-month rolling average"
 *
 * Pure functions. No I/O, no DOM, no wall-clock reads — `now` is
 * always an explicit ms timestamp parameter.
 *
 * UI consumes via a separate card component (out of scope here).
 */

import type { FinanceRecord } from './types';
import { DAY_MS, fMedian, fMad } from './math';
import { jaroWinkler } from './jaro';

// ─── 1. pay-frequency classification ──────────────────────────────────────

export type PayFrequencyLabel = 'weekly' | 'biweekly' | 'monthly' | 'random';
export type PayFrequencyConfidence = 'low' | 'medium' | 'high';

export interface PayFrequencyEvidence {
  /** Total inbound records considered (with valid event_date and amount). */
  n_events: number;
  /** Number of pairwise intervals (n_events - 1). */
  n_intervals: number;
  /** Median interval in days, or null when <2 events. */
  interval_days_median: number | null;
  /** Scaled MAD (Rousseeuw σ ≈ 1.4826·MAD), or null when <2 events. */
  interval_days_mad: number | null;
  /** Coefficient of variation (mad / median). Null when not computable. */
  cv: number | null;
}

export interface ClassifyPayFrequencyResult {
  frequency: PayFrequencyLabel;
  confidence: PayFrequencyConfidence;
  /** Median cadence in days when one fits a known band; null for random. */
  cadenceDays: number | null;
  evidence: PayFrequencyEvidence;
}

/**
 * classifyPayFrequency — distinct from reports.ts:classifyPayFrequency.
 *
 * Differences:
 *   - returns 'random' instead of 'irregular' (matches gap-closure spec)
 *   - returns 3-level confidence (low/medium/high) without 'prior' band
 *   - returns null cadenceDays for random rather than reporting a
 *     misleading median
 *
 * Rules:
 *   weekly   = median 6..8d
 *   biweekly = median 12..16d
 *   monthly  = median 25..32d (covers 28-32 lunar + 30/31 calendar)
 *   random   = anything else, or <3 events
 *
 * Confidence (only assigned when frequency != 'random'):
 *   high   = n_intervals >= 5 AND cv < 0.10
 *   medium = n_intervals >= 3 AND cv < 0.30
 *   low    = otherwise
 *
 * Random always returns 'low' confidence — there's no signal to be
 * confident about.
 */
export function classifyPayFrequency(
  transactions: FinanceRecord[],
): ClassifyPayFrequencyResult {
  const events = (transactions ?? [])
    .filter((r) => r?.direction === 'in' && r.event_date)
    .map((r) => new Date(r.event_date + 'T12:00:00').getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const nEvents = events.length;
  if (nEvents < 3) {
    return {
      frequency: 'random',
      confidence: 'low',
      cadenceDays: null,
      evidence: {
        n_events: nEvents,
        n_intervals: Math.max(0, nEvents - 1),
        interval_days_median: null,
        interval_days_mad: null,
        cv: null,
      },
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) {
    intervals.push((events[i] - events[i - 1]) / DAY_MS);
  }
  const median = fMedian(intervals) ?? 0;
  // fMad already returns scaled MAD (×1.4826) per math.ts contract
  const mad = fMad(intervals, median);
  const cv = median > 0 ? mad / median : null;

  let frequency: PayFrequencyLabel = 'random';
  if (median >= 6 && median <= 8) frequency = 'weekly';
  else if (median >= 12 && median <= 16) frequency = 'biweekly';
  else if (median >= 25 && median <= 32) frequency = 'monthly';

  let confidence: PayFrequencyConfidence = 'low';
  if (frequency !== 'random' && cv != null) {
    if (intervals.length >= 5 && cv < 0.1) confidence = 'high';
    else if (intervals.length >= 3 && cv < 0.3) confidence = 'medium';
    else confidence = 'low';
  }

  return {
    frequency,
    confidence,
    cadenceDays: frequency === 'random' ? null : Number(median.toFixed(2)),
    evidence: {
      n_events: nEvents,
      n_intervals: intervals.length,
      interval_days_median: Number(median.toFixed(2)),
      interval_days_mad: Number(mad.toFixed(2)),
      cv: cv == null ? null : Number(cv.toFixed(3)),
    },
  };
}

// ─── 2. invoice / client payment detection ────────────────────────────────

export interface InvoicePayment {
  /** Normalised merchant key — same shape as merchant_normalized. */
  client_normalized: string;
  /** Best display name found among matched records. */
  client: string;
  /** Number of inbound payments grouped under this client. */
  occurrence_count: number;
  /** Median amount of the cluster. */
  amount_median: number;
  /** Scaled MAD of the amounts (Rousseeuw). */
  amount_mad: number;
  /** Median interval in days between payments; null when <2 occurrences. */
  interval_days_median: number | null;
  /** Scaled MAD of the intervals; null when <3 occurrences. */
  interval_days_mad: number | null;
  /** First and last observation timestamps (ms). */
  first_seen_at: number;
  last_seen_at: number;
  /** Optional flag: did this client match the caller-supplied list. */
  matched_known_client: boolean;
}

export interface DetectInvoicePaymentsOpts {
  /** Jaro-Winkler threshold for fuzzy merchant clustering. Default 0.88. */
  fuzzyMatchThreshold?: number;
  /** Minimum occurrences to surface as an invoice payment. Default 2. */
  minOccurrences?: number;
}

/**
 * detectInvoicePayments — positive recurring inbound from the same source.
 *
 * Uses the same fuzzy clustering as recurring.ts. Doesn't require a
 * tight cadence — gig invoices are often irregular by week but recur
 * over months. We require:
 *
 *   - direction === 'in'
 *   - amount > 0
 *   - merchant_normalized present
 *   - cluster size >= minOccurrences (default 2)
 *
 * `knownClients` is an optional caller-supplied normalisation hint —
 * if a record's merchant_normalized fuzzy-matches a known client, the
 * cluster inherits that client's normalised name (helps the UI label
 * "Acme Corp" instead of "ACME CORP INC #123").
 */
export function detectInvoicePayments(
  transactions: FinanceRecord[],
  knownClients?: string[],
  opts?: DetectInvoicePaymentsOpts,
): InvoicePayment[] {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  const o = opts ?? {};
  const fuzzyTh = o.fuzzyMatchThreshold ?? 0.88;
  const minOcc = o.minOccurrences ?? 2;

  const inbound = transactions.filter(
    (r) =>
      r?.direction === 'in' &&
      r.amount != null &&
      r.amount > 0 &&
      r.merchant_normalized &&
      r.event_date,
  );

  // Cluster on merchant_normalized (same approach as recurring.ts)
  const clusters: Array<{
    key: string;
    displayName: string | null;
    records: FinanceRecord[];
  }> = [];
  for (const r of inbound) {
    const norm = r.merchant_normalized!;
    let bi = -1;
    let bs = 0;
    for (let i = 0; i < clusters.length; i++) {
      const sim = jaroWinkler(norm, clusters[i].key);
      if (sim > bs) {
        bs = sim;
        bi = i;
      }
    }
    if (bi >= 0 && bs >= fuzzyTh) {
      clusters[bi].records.push(r);
    } else {
      clusters.push({ key: norm, displayName: r.merchant ?? null, records: [r] });
    }
  }

  const known = (knownClients ?? []).map((s) => s.toLowerCase());

  const payments: InvoicePayment[] = [];
  for (const c of clusters) {
    if (c.records.length < minOcc) continue;

    const sorted = [...c.records].sort((a, b) =>
      (a.event_date ?? '').localeCompare(b.event_date ?? ''),
    );
    const amounts = sorted.map((r) => r.amount as number);
    const medAmt = fMedian(amounts) ?? 0;
    const madAmt = fMad(amounts, medAmt);

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = new Date(sorted[i - 1].event_date + 'T12:00:00').getTime();
      const b = new Date(sorted[i].event_date + 'T12:00:00').getTime();
      intervals.push((b - a) / DAY_MS);
    }
    const medIv = intervals.length ? fMedian(intervals) : null;
    const madIv = intervals.length >= 2 ? fMad(intervals, medIv ?? 0) : null;

    const first = new Date(sorted[0].event_date + 'T12:00:00').getTime();
    const last = new Date(sorted[sorted.length - 1].event_date + 'T12:00:00').getTime();

    const keyLower = c.key.toLowerCase();
    const isKnown = known.some(
      (k) => k === keyLower || jaroWinkler(keyLower, k) >= fuzzyTh,
    );

    payments.push({
      client_normalized: c.key,
      client: c.displayName ?? c.key,
      occurrence_count: sorted.length,
      amount_median: Number(medAmt.toFixed(2)),
      amount_mad: Number(madAmt.toFixed(2)),
      interval_days_median: medIv == null ? null : Number(medIv.toFixed(2)),
      interval_days_mad: madIv == null ? null : Number(madIv.toFixed(2)),
      first_seen_at: first,
      last_seen_at: last,
      matched_known_client: isKnown,
    });
  }

  // Most recent first, then highest amount
  payments.sort((a, b) => {
    if (b.last_seen_at !== a.last_seen_at) return b.last_seen_at - a.last_seen_at;
    return b.amount_median - a.amount_median;
  });
  return payments;
}

// ─── 3. monthly income volatility ─────────────────────────────────────────

export interface MonthlyVolatilityResult {
  /** Total inbound for the calendar month containing `now`. */
  thisMonth: number;
  /** Mean of the three prior calendar months' inbound totals. */
  threeMonthAvg: number;
  /** Percentage delta (thisMonth − threeMonthAvg) / threeMonthAvg.
   *  Returns 0 when threeMonthAvg is 0 to keep callers safe. */
  deltaPct: number;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * monthlyVolatility — this-month income vs trailing 3-month average.
 *
 * Used by the UI to surface "income down 38% this month" cards for
 * variable-income workers. Pure: `now` is injected, not read.
 */
export function monthlyVolatility(
  transactions: FinanceRecord[],
  now: number,
): MonthlyVolatilityResult {
  const inbound = (transactions ?? []).filter(
    (r) => r?.direction === 'in' && r.amount != null && r.event_date,
  );

  const totals = new Map<string, number>();
  for (const r of inbound) {
    const key = r.event_date.slice(0, 7); // YYYY-MM
    totals.set(key, (totals.get(key) ?? 0) + (r.amount as number));
  }

  const thisKey = monthKey(now);
  const thisMonth = totals.get(thisKey) ?? 0;

  // Last three full months prior to thisKey
  const priorKeys: string[] = [];
  const d = new Date(now);
  for (let i = 1; i <= 3; i++) {
    const prior = new Date(d.getFullYear(), d.getMonth() - i, 1);
    priorKeys.push(
      prior.getFullYear() + '-' + String(prior.getMonth() + 1).padStart(2, '0'),
    );
  }

  const priorTotals = priorKeys.map((k) => totals.get(k) ?? 0);
  const sum = priorTotals.reduce((s, x) => s + x, 0);
  const threeMonthAvg = sum / 3;
  const deltaPct =
    threeMonthAvg > 0 ? (thisMonth - threeMonthAvg) / threeMonthAvg : 0;

  return {
    thisMonth: Number(thisMonth.toFixed(2)),
    threeMonthAvg: Number(threeMonthAvg.toFixed(2)),
    deltaPct: Number(deltaPct.toFixed(4)),
  };
}
