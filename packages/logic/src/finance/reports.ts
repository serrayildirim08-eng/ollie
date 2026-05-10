/**
 * @ollie/logic · savings, bills, pay-frequency, safe-to-spend, 30d forecast
 *
 * Phase 1 + 6 of FINANCE_BACKEND_DESIGN.md. Pure functions; `now` injected.
 */

import type {
  FinanceRecord,
  SavingsGoal,
  SavingsGoalProgressResult,
  UpcomingBill,
  PayFrequencyResult,
  SpendBand,
  FinanceSettings,
} from './types';
import { DAY_MS } from './math';
import { detectRecurring, predictNextDue } from './recurring';

const BLS_PRIOR = {
  mode: 'biweekly',
  intervalDaysCentral: 14,
  intervalDaysSigma: 6,
};

export function savingsGoalProgress(
  goal: SavingsGoal | null | undefined,
  _records: FinanceRecord[],
  now: number,
): SavingsGoalProgressResult | null {
  if (!goal) return null;
  const saved =
    typeof goal.saved === 'number'
      ? goal.saved
      : (goal.contributions ?? []).reduce((s, c) => s + (c.amount ?? 0), 0);
  const target = goal.target || 0;
  const remaining = Math.max(0, target - saved);
  let pace: SavingsGoalProgressResult['pace'] = null;
  if (Array.isArray(goal.contributions) && goal.contributions.length >= 2) {
    const recent = goal.contributions.filter((c) => (c.ts ?? 0) >= now - 90 * DAY_MS);
    if (recent.length) {
      const tr = recent.reduce((s, c) => s + (c.amount ?? 0), 0);
      const monthly = tr / 3;
      pace = {
        monthlyContribution: Number(monthly.toFixed(2)),
        eta: monthly > 0 ? now + (remaining / monthly) * 30 * DAY_MS : null,
      };
    }
  }
  return {
    saved: Number(saved.toFixed(2)),
    target: Number(target.toFixed(2)),
    remaining: Number(remaining.toFixed(2)),
    pace,
  };
}

export function upcomingBills(
  bills: import('./types').RecurringPattern[],
  wDays: number,
  now: number,
): UpcomingBill[] {
  const W = wDays || 14;
  const out: UpcomingBill[] = [];
  for (const b of bills ?? []) {
    const pred = predictNextDue(b, now);
    if (pred.dueAt == null) continue;
    const du = Math.round((pred.dueAt - now) / DAY_MS);
    if (du < 0 || du > W) continue;
    out.push({ bill: b, daysUntil: du, dueAt: pred.dueAt, confidence: pred.confidence });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * BLS Monthly Labor Review 2022 pay-frequency prior.
 * Prior collapses at n≥3 observed income events.
 */
export function classifyPayFrequency(
  incomeRecords: FinanceRecord[],
  _now: number,
): PayFrequencyResult {
  const events = (incomeRecords ?? [])
    .filter((r) => r?.direction === 'in' && r.event_date)
    .map((r) => new Date(r.event_date + 'T00:00:00Z').getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const nEvents = events.length;
  if (nEvents < 3) {
    return {
      freq: 'cold_start',
      confidence: 'prior',
      interval_days_median: null,
      interval_days_mad: null,
      cold_start: true,
      prior: BLS_PRIOR,
      n_events: nEvents,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) {
    intervals.push((events[i] - events[i - 1]) / DAY_MS);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = intervals.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];

  let freq: PayFrequencyResult['freq'];
  if (median >= 6 && median <= 8) freq = 'weekly';
  else if (median >= 12 && median <= 16) freq = 'biweekly';
  else if (median >= 25 && median <= 35) freq = 'monthly';
  else freq = 'irregular';

  const cv = median > 0 ? mad / median : 1;
  let confidence: PayFrequencyResult['confidence'];
  if (intervals.length >= 6 && cv < 0.1) confidence = 'high';
  else if (cv < 0.3) confidence = 'medium';
  else confidence = 'low';

  return {
    freq,
    confidence,
    interval_days_median: median,
    interval_days_mad: mad,
    cold_start: false,
    n_events: nEvents,
  };
}

/**
 * Safe-to-spend over `horizonDays`. Gaussian band. CLT-widened when <5
 * contributing patterns. Returns null when no income AND no bill patterns.
 */
export function safeToSpend(
  records: FinanceRecord[],
  now: number,
  horizonDays?: number,
  settings?: FinanceSettings,
): SpendBand | null {
  const W = Math.max(1, horizonDays ?? 7);
  const bufferPct =
    typeof settings?.buffer_pct === 'number' ? settings.buffer_pct : 0.1;
  const incomeRecs = (records ?? []).filter((r) => r?.direction === 'in');
  const outRecs = (records ?? []).filter(
    (r) => r?.direction === 'out' && (r.kind === 'bill' || r.kind === 'sub'),
  );
  const detectIn = detectRecurring(incomeRecs, { minOccurrences: 3 });
  const detectOut = detectRecurring(outRecs, { minOccurrences: 3 });
  const incomePatterns = detectIn.recurring ?? [];
  const outPatterns = detectOut.recurring ?? [];

  if (!incomePatterns.length && !outPatterns.length) {
    if (incomeRecs.length > 0) {
      const cls = classifyPayFrequency(incomeRecs, now);
      const sigma = 1.4826 * (cls.prior ? cls.prior.intervalDaysSigma : 7);
      return {
        central: 0,
        sigma: sigma * 5,
        band: [-sigma * 5, sigma * 5],
        horizonDays: W,
        cold_start: true,
        contributing_patterns: [],
      };
    }
    return null;
  }

  const contributing: SpendBand['contributing_patterns'] = [];
  let eIn = 0;
  let eOut = 0;
  let varSum = 0;

  for (const p of incomePatterns) {
    const pred = predictNextDue(p, now);
    if (pred.dueAt == null) continue;
    const dIn = (pred.dueAt - now) / DAY_MS;
    if (dIn < 0 || dIn > W) continue;
    const amt = p.amount_median ?? 0;
    eIn += amt;
    const sigma = 1.4826 * (p.amount_mad ?? 0);
    varSum += sigma * sigma;
    contributing.push({ id: p.id, kind: 'income', expected: amt });
  }
  for (const p of outPatterns) {
    const pred = predictNextDue(p, now);
    if (pred.dueAt == null) continue;
    const dOut = (pred.dueAt - now) / DAY_MS;
    if (dOut < 0 || dOut > W) continue;
    const amt = p.amount_median ?? 0;
    eOut += amt;
    const sigma = 1.4826 * (p.amount_mad ?? 0);
    varSum += sigma * sigma;
    contributing.push({ id: p.id, kind: 'bill', expected: amt });
  }

  const n = contributing.length;
  let sigma = Math.sqrt(varSum);
  if (n > 0 && n < 5) sigma *= 1 + (5 - n) * 0.2;
  const central = eIn - eOut - bufferPct * eIn;

  return {
    central,
    sigma,
    band: [central - sigma, central + sigma],
    horizonDays: W,
    cold_start: false,
    contributing_patterns: contributing,
  };
}

/**
 * 30-day cash-flow forecast band. Lindeberg-CLT (Lindeberg 1922).
 * Counts ALL pattern hits in the 30-day window.
 */
export function forecast30d(
  records: FinanceRecord[],
  now: number,
  settings?: FinanceSettings,
): SpendBand | null {
  const W = 30;
  const bufferPct =
    typeof settings?.buffer_pct === 'number' ? settings.buffer_pct : 0.1;
  const incomeRecs = (records ?? []).filter((r) => r?.direction === 'in');
  const outRecs = (records ?? []).filter(
    (r) => r?.direction === 'out' && (r.kind === 'bill' || r.kind === 'sub'),
  );
  const detectIn = detectRecurring(incomeRecs, { minOccurrences: 3 });
  const detectOut = detectRecurring(outRecs, { minOccurrences: 3 });
  const inPs = detectIn.recurring ?? [];
  const outPs = detectOut.recurring ?? [];

  if (!inPs.length && !outPs.length) {
    if (incomeRecs.length > 0) {
      const cls = classifyPayFrequency(incomeRecs, now);
      const sigma = 1.4826 * (cls.prior ? cls.prior.intervalDaysSigma : 7);
      return {
        central: 0,
        sigma: sigma * 5,
        band: [-sigma * 5, sigma * 5],
        horizonDays: W,
        cold_start: true,
        contributing_patterns: [],
      };
    }
    return null;
  }

  const countHits = (p: import('./types').RecurringPattern): number => {
    const pred = predictNextDue(p, now);
    if (pred.dueAt == null) return 0;
    const firstOffset = (pred.dueAt - now) / DAY_MS;
    if (firstOffset > W || firstOffset < 0) return 0;
    const interval = p.interval_days_median || W;
    if (interval <= 0) return 1;
    let n = 1;
    let next = pred.dueAt + interval * DAY_MS;
    while ((next - now) / DAY_MS <= W) {
      n++;
      next += interval * DAY_MS;
    }
    return n;
  };

  let eIn = 0;
  let eOut = 0;
  let varSum = 0;
  const contrib: SpendBand['contributing_patterns'] = [];

  for (const p of inPs) {
    const n = countHits(p);
    if (!n) continue;
    const amt = p.amount_median ?? 0;
    eIn += amt * n;
    const s = 1.4826 * (p.amount_mad ?? 0);
    varSum += n * s * s;
    contrib.push({ id: p.id, kind: 'income', expected: amt * n, hits: n });
  }
  for (const p of outPs) {
    const n = countHits(p);
    if (!n) continue;
    const amt = p.amount_median ?? 0;
    eOut += amt * n;
    const s = 1.4826 * (p.amount_mad ?? 0);
    varSum += n * s * s;
    contrib.push({ id: p.id, kind: 'bill', expected: amt * n, hits: n });
  }

  const nPatterns = contrib.length;
  let sigma = Math.sqrt(varSum);
  if (nPatterns > 0 && nPatterns < 5) sigma *= 1 + (5 - nPatterns) * 0.2;
  const central = eIn - eOut - bufferPct * eIn;

  return {
    central,
    sigma,
    band: [central - sigma, central + sigma],
    horizonDays: W,
    cold_start: false,
    contributing_patterns: contrib,
  };
}
