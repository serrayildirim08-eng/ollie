/**
 * @ollie/logic · mergeRecord
 *
 * Idempotent merge of a partial FinanceRecord onto an existing one (or
 * creates a new shell). Tokens are unioned — never reset on merge.
 */

import type { FinanceRecord } from './types';
import { normalizeMerchant } from './jaro';

export function mergeRecord(
  prev: FinanceRecord | null | undefined,
  next: Partial<FinanceRecord> | null | undefined,
  now: number,
): FinanceRecord {
  const base: FinanceRecord = prev ?? {
    id: 'fin-' + now + '-' + Math.random().toString(36).slice(2, 8),
    created_at: now,
    extractor_version: 'rule-1',
    raw_source_id: null,
    raw_span: null,
    event_date: new Date(now).toISOString().slice(0, 10),
    amount: null,
    currency: 'USD',
    merchant: null,
    merchant_normalized: null,
    category: null,
    notes: null,
    direction: 'out',
    tokens: [],
    is_adhd_tax: false,
    adhd_tax_type: null,
    cycle_phase: null,
    journal_entry_ids: [],
  };

  const out: FinanceRecord = { ...base };
  for (const k of Object.keys(next ?? {}) as Array<keyof FinanceRecord>) {
    const v = next![k];
    if (v !== undefined && v !== null)
      (out as unknown as Record<string, unknown>)[k] = v;
  }
  out.last_edited_at = now;

  // union tokens, never reset
  if (Array.isArray(base.tokens) && Array.isArray(next?.tokens)) {
    out.tokens = Array.from(new Set([...(base.tokens ?? []), ...(next?.tokens ?? [])]));
  }

  if (out.merchant) out.merchant_normalized = normalizeMerchant(out.merchant);
  return out;
}
