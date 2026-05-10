/**
 * @ollie/logic · anomaly detection
 *
 * Phase 3.
 * - detectAnomaly: Iglewicz & Hoaglin 1993 modified z-score (threshold 3.5)
 * - detectPostPaydaySpikes: Stephens 2003 / Mastrobuoni & Weinberg 2009
 * - trackADHDTaxEvents: rolling window ADHD-tax aggregation
 * - detectSubscriptionStale: subscription staleness check
 */

import type {
  FinanceRecord,
  RecurringPattern,
  AnomalyResult,
  PostPaydaySpike,
  ADHDTaxSummary,
  StaleSubscription,
} from './types';
import { DAY_MS, isoDate, fMedian, fMad } from './math';

/** Iglewicz & Hoaglin 1993 modified z-score. Threshold 3.5. */
export function detectAnomaly(
  r: FinanceRecord,
  p: RecurringPattern,
  opts?: { threshold?: number },
): AnomalyResult {
  if (!r || !p || r.amount == null || p.amount_median == null) {
    return { isAnomaly: false, modZ: null, framing: null };
  }
  const threshold = typeof opts?.threshold === 'number' ? opts.threshold : 3.5;
  const madRaw = p.amount_mad;
  if (!madRaw) {
    const rel = Math.abs(r.amount - p.amount_median) / Math.max(p.amount_median, 1);
    if (rel > 0.5) {
      return {
        isAnomaly: true,
        modZ: null,
        framing: r.amount > p.amount_median ? 'high' : 'low',
      };
    }
    return { isAnomaly: false, modZ: null, framing: null };
  }
  const modZ = (0.6745 * (r.amount - p.amount_median)) / madRaw;
  if (Math.abs(modZ) >= threshold) {
    return {
      isAnomaly: true,
      modZ: Number(modZ.toFixed(2)),
      framing: modZ > 0 ? 'high' : 'low',
    };
  }
  return { isAnomaly: false, modZ: Number(modZ.toFixed(2)), framing: null };
}

/**
 * Pay-cycle consumption spike detection.
 * Requires ≥3 income events (§9.8). Observation framing only (§9.14).
 */
export function detectPostPaydaySpikes(
  incomeRecords: FinanceRecord[],
  discretionaryRecords: FinanceRecord[],
  now: number,
  opts?: { windowDays?: number; multiplier?: number; modZThreshold?: number },
): PostPaydaySpike[] {
  const o = opts ?? {};
  const windowDays = o.windowDays ?? 3;
  const multiplier = o.multiplier ?? 1.5;
  const modZTh = o.modZThreshold ?? 3.5;

  const incomes = (incomeRecords ?? []).filter(
    (r) => r?.direction === 'in' && r.event_date,
  );
  const discs = (discretionaryRecords ?? []).filter(
    (r) => r?.direction === 'out' && r.event_date && r.amount != null,
  );
  if (incomes.length < 3 || !discs.length) return [];

  const byDay: Record<string, number> = {};
  for (const r of discs) {
    byDay[r.event_date] = (byDay[r.event_date] ?? 0) + (r.amount ?? 0);
  }

  const nowMs = now;
  const window28: number[] = [];
  for (const [d, total] of Object.entries(byDay)) {
    const t = new Date(d + 'T12:00:00').getTime();
    if (nowMs - t <= 28 * DAY_MS && nowMs - t >= 0) window28.push(total);
  }
  if (window28.length < 5) return [];

  const personalMedian = fMedian(window28) ?? 0;
  const madRaw = fMad(window28, personalMedian);
  const out: PostPaydaySpike[] = [];

  for (const inc of incomes) {
    const t0 = new Date(inc.event_date + 'T12:00:00').getTime();
    for (let off = 0; off <= windowDays; off++) {
      const t = t0 + off * DAY_MS;
      const iso = isoDate(t);
      const dayTotal = byDay[iso] ?? 0;
      if (!dayTotal) continue;
      const ratio = personalMedian > 0 ? dayTotal / personalMedian : 0;
      const modZ = madRaw > 0 ? (0.6745 * (dayTotal - personalMedian)) / madRaw : null;
      if (ratio >= multiplier && modZ != null && modZ >= modZTh) {
        out.push({
          spike_id: `spike-${inc.id}-${off}`,
          income_record_id: inc.id,
          day_offset: off,
          spike_date: iso,
          day_total: Number(dayTotal.toFixed(2)),
          personal_28d_median: Number(personalMedian.toFixed(2)),
          ratio: Number(ratio.toFixed(2)),
          modZ: Number(modZ.toFixed(2)),
          framing: 'observation',
        });
      }
    }
  }
  return out;
}

export function trackADHDTaxEvents(
  records: FinanceRecord[],
  wDays: number,
  now: number,
): ADHDTaxSummary {
  const W = wDays || 90;
  const cutoff = now - W * DAY_MS;
  const ev = (records ?? []).filter(
    (r) =>
      r?.is_adhd_tax &&
      r.event_date &&
      new Date(r.event_date + 'T12:00:00').getTime() >= cutoff,
  );
  const byType: Record<string, { count: number; total: number }> = {};
  let total = 0;
  for (const r of ev) {
    const ty = r.adhd_tax_type ?? 'other';
    if (!byType[ty]) byType[ty] = { count: 0, total: 0 };
    byType[ty].count++;
    if (r.amount != null) {
      byType[ty].total += r.amount;
      total += r.amount;
    }
  }
  return { count: ev.length, total: Number(total.toFixed(2)), byType };
}

export function detectSubscriptionStale(
  patterns: RecurringPattern[],
  dumps: Array<{ text: string; ts: number }>,
  dismissed: Set<string> | string[],
  th: number,
  now: number,
): StaleSubscription[] {
  const T = th || 90;
  const dSet = dismissed instanceof Set ? dismissed : new Set(dismissed ?? []);
  const stale: StaleSubscription[] = [];
  for (const p of patterns ?? []) {
    if (p.kind !== 'subscription' && p.kind !== 'bill') continue;
    if (dSet.has(p.id)) continue;
    const mentioned = (dumps ?? []).some((d) => {
      if (!d?.text || !d.ts) return false;
      if (now - d.ts > T * DAY_MS) return false;
      const text = String(d.text).toLowerCase();
      return (
        text.includes(p.merchant_normalized) ||
        (p.display_name && text.includes(String(p.display_name).toLowerCase()))
      );
    });
    if (mentioned) continue;
    const daysSince = Math.round((now - p.last_at) / DAY_MS);
    if (daysSince >= T) {
      stale.push({
        pattern_id: p.id,
        display_name: p.display_name,
        days_since: daysSince,
        cadence: p.cadence,
      });
    }
  }
  return stale;
}
