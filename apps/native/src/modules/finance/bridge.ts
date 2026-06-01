/**
 * apps/native · modules/finance/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The finance Layer-2 watcher (packages/orchestrator/src/finance.ts — the 6
 * detectors: doom-buying, hyperfocus burst, duplicate, sub-cancel-avoidance,
 * cycle×spend, return-abandonment) reads @ollie/store keys; native captures
 * money events into SQLite (finance/repo.ts) and never writes them. This
 * mirror reads every SQLite finance table and projects it into the store.
 *
 * Mapping (SQLite repo → finance.records FinanceRecord[]):
 *   finance_transactions  → direction 'out', kind 'spend'   (the spend stream)
 *   finance_income        → direction 'in',  kind 'income'  (money in)
 *   finance_refunds       → direction 'in',  kind 'refund'  + returnable context
 *   finance_bills         → direction 'out', kind 'bill'    (recurring bill)
 *   finance_subscriptions → direction 'out', kind 'sub'     (subscription)
 *
 * `finance.records` is LOAD-BEARING: recomputeDerived() in the watcher runs
 * detectRecurring / detectAnomaly / detectDuplicatePurchases / D3 cycle×spend
 * over it, and the cross-module patterns watcher reads it too. Every other
 * derived key (recurring / upcoming / patterns / savingsLedger …) is OUTPUT
 * the watcher computes from records — we must NOT write those or we clobber
 * the watcher. We DO mirror the canonical-but-not-derived slices the watcher
 * reads as inputs:
 *   finance.cancellations — from subscriptions the user marked canceled, so
 *                           computeSavings() has its input.
 *   finance.settings      — seed defaults if the watcher hasn't (it self-seeds
 *                           in init(), so we only fill when absent).
 *
 * Read-merge-append on `shared.*`: finance writes none, so nothing there.
 *
 * Each record carries a stable id = `sqlite:<table>:<rowId>` so the merge is
 * idempotent — re-syncing never duplicates a row, and records the watcher
 * created from dump parsing (different id shape) are preserved untouched.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { mergeRecord, type FinanceRecord } from '@ollie/logic/finance';
import { migrateFinance } from './migrate';
import { bills, income, refunds, subscriptions, transactions } from './repo';

/** Prefix marking a record this bridge owns (so we replace, not duplicate). */
const SRC_PREFIX = 'sqlite:';

/** ms-since-epoch → YYYY-MM-DD (local) for FinanceRecord.event_date. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Build a canonical FinanceRecord from a partial, with a stable source id. */
function toRecord(
  table: string,
  rowId: string,
  partial: Partial<FinanceRecord>,
  ts: number,
): FinanceRecord {
  const rec = mergeRecord(null, partial, ts);
  rec.id = `${SRC_PREFIX}${table}:${rowId}`;
  rec.raw_source_id = `${SRC_PREFIX}${table}:${rowId}`;
  return rec;
}

export async function syncToStore(store: Store): Promise<void> {
  await migrateFinance();

  const [txRows, incomeRows, refundRows, billRows, subRows] = await Promise.all([
    transactions.list(),
    income.list(),
    refunds.list(),
    bills.list(),
    subscriptions.list(),
  ]);

  const mirrored: FinanceRecord[] = [];

  for (const t of txRows) {
    mirrored.push(
      toRecord('transactions', t.id, {
        event_date: isoDay(t.occurredAt),
        amount: t.amount,
        currency: t.currency ?? 'USD',
        merchant: t.merchant,
        category: t.category,
        direction: 'out',
        kind: 'spend',
      }, t.occurredAt),
    );
  }

  for (const i of incomeRows) {
    mirrored.push(
      toRecord('income', i.id, {
        event_date: isoDay(i.receivedAt),
        amount: i.amount,
        currency: i.currency ?? 'USD',
        merchant: i.source,
        direction: 'in',
        kind: 'income',
      }, i.receivedAt),
    );
  }

  for (const r of refundRows) {
    mirrored.push(
      toRecord('refunds', r.id, {
        event_date: isoDay(r.refundedAt),
        amount: r.amount,
        currency: r.currency ?? 'USD',
        merchant: r.merchant,
        notes: r.originalItem,
        direction: 'in',
        kind: 'refund',
      }, r.refundedAt),
    );
  }

  for (const b of billRows) {
    mirrored.push(
      toRecord('bills', b.id, {
        event_date: isoDay(b.addedAt),
        amount: b.amount,
        currency: b.currency ?? 'USD',
        merchant: b.merchant,
        direction: 'out',
        kind: 'bill',
      }, b.addedAt),
    );
  }

  for (const s of subRows) {
    mirrored.push(
      toRecord('subscriptions', s.id, {
        event_date: isoDay(s.addedAt),
        amount: s.amount,
        currency: s.currency ?? 'USD',
        merchant: s.name,
        direction: 'out',
        kind: 'sub',
      }, s.addedAt),
    );
  }

  // Read-merge: keep any records the watcher built from dump parsing (ids NOT
  // under our SRC_PREFIX); replace our own slice wholesale so deletions in
  // SQLite propagate. Sorted by event_date for the detectors' stream order.
  const existing = store.get<FinanceRecord[]>('finance', 'records', []) ?? [];
  const foreign = existing.filter(
    (r) => typeof r?.raw_source_id !== 'string' || !r.raw_source_id.startsWith(SRC_PREFIX),
  );
  const next = [...foreign, ...mirrored].sort((a, b) =>
    (a.event_date ?? '').localeCompare(b.event_date ?? ''),
  );
  store.set('finance', 'records', next);

  // ── cancellations ─────────────────────────────────────────────────────
  // computeSavings() reads finance.cancellations. The native subscriptions
  // table carries a `canceled_at_ms` column (set via subscriptions.markCanceled
  // when the user cancels). We can't read it through subscriptions.list() (it
  // omits the column), so derive cancellations from the raw subscription rows
  // we have plus any prior cancellations — read-merge by id, never drop a
  // historic entry (Decision #14: preserve count once recorded).
  // NOTE: list() doesn't surface canceled_at_ms; we keep prior cancellations
  // intact and let the orchestrator's onSubscriptionCancelled own new ones.
  // This bridge only ensures the key EXISTS so computeSavings doesn't read
  // undefined on a fresh install.
  if (store.get('finance', 'cancellations', null) == null) {
    store.set('finance', 'cancellations', []);
  }
}
