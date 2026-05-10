/**
 * @ollie/logic/patterns · finance_cycle_spend detector
 *
 * For each transaction category: compare daily-spend rate in luteal vs.
 * follicular days. Surface the highest-delta category that has 5+ txns
 * across 3+ cycles with at least a 40% rate difference.
 */

import type { CycleRecord } from '../cycle/types';
import { closedCycles, cooldownFilter, isIrregular, phaseFold } from './phase-fold';
import type { DetectorOptions, FinanceCycleSpendPattern, FinanceTransaction } from './types';

export function detectFinanceCycleSpend(
  cycles: readonly CycleRecord[] | undefined | null,
  transactions: readonly FinanceTransaction[] | undefined | null,
  opts: DetectorOptions & { minDelta?: number; minTxnCount?: number } = {},
): FinanceCycleSpendPattern | null {
  const minDelta = opts.minDelta ?? 0.4;
  const minTxnCount = opts.minTxnCount ?? 5;

  const closed = closedCycles(cycles);
  if (closed.length < 3) return null;
  if (isIrregular(closed)) return null;
  const eligible = cooldownFilter(closed, opts.lastEditedByCycle, opts.now);
  if (eligible.length < 3) return null;

  const phaseDays = { luteal: 0, follicular: 0 };
  for (const c of eligible) {
    const L = c.cycleLengthDays;
    phaseDays.luteal += Math.min(13, Math.max(0, L - 5));
    phaseDays.follicular += Math.max(0, L - 23);
  }
  if (phaseDays.luteal === 0 || phaseDays.follicular === 0) return null;

  const folded = phaseFold(eligible, transactions);
  const byCategory: Record<
    string,
    { luteal: number; follicular: number; cycles: Set<number>; txnCount: number }
  > = {};
  for (const f of folded) {
    const cat = String(f.event.category || f.event.category_l1 || 'uncategorized').toLowerCase();
    if (!byCategory[cat]) byCategory[cat] = { luteal: 0, follicular: 0, cycles: new Set(), txnCount: 0 };
    byCategory[cat].txnCount++;
    byCategory[cat].cycles.add(f.cycleIdx);
    if (f.phase === 'luteal') byCategory[cat].luteal += Math.abs(f.event.amount || 0);
    else if (f.phase === 'follicular') byCategory[cat].follicular += Math.abs(f.event.amount || 0);
  }

  const results: FinanceCycleSpendPattern[] = [];
  for (const cat of Object.keys(byCategory)) {
    const d = byCategory[cat];
    if (d.txnCount < minTxnCount) continue;
    if (d.cycles.size < 3) continue;
    const dailyLuteal = d.luteal / phaseDays.luteal;
    const dailyFoll = d.follicular / phaseDays.follicular;
    const smaller = Math.min(dailyLuteal, dailyFoll);
    if (smaller <= 0) continue;
    const larger = Math.max(dailyLuteal, dailyFoll);
    const deltaPct = (larger - smaller) / smaller;
    if (deltaPct < minDelta) continue;
    const higher: 'luteal' | 'follicular' = dailyLuteal > dailyFoll ? 'luteal' : 'follicular';
    const pct = Math.round(deltaPct * 100);
    results.push({
      id: 'finance_cycle_spend:' + cat,
      type: 'finance_cycle_spend',
      cycles: d.cycles.size,
      copy: `${cat} spending — ~${pct}% higher in your ${higher} week, ${d.cycles.size} cycles.`,
      subcopy: 'pattern, not medical.',
      meta: {
        category: cat,
        higherPhase: higher,
        deltaPct,
        dailyLuteal,
        dailyFoll,
        txnCount: d.txnCount,
      },
    });
  }
  results.sort((a, b) => b.cycles - a.cycles || b.meta.deltaPct - a.meta.deltaPct);
  return results[0] ?? null;
}
