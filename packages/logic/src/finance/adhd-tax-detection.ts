/**
 * @ollie/logic · finance · ADHD tax auto-detection
 *
 * Pure functions. No I/O, no React, no DOM.
 *
 * Three detection paths:
 *   A. Transaction memo analysis (detectADHDTaxFromTxn)
 *   B. Duplicate purchase detection within a time window (detectDuplicatePurchases)
 *   C. Braindump keyword spotting (detectADHDTaxFromBraindump)
 *
 * Confidence → action mapping (CONSTITUTIONAL — must not be relaxed):
 *   high   — transaction memo contains an explicit fee descriptor keyword
 *            (e.g. "late fee", "NSF fee") → may auto-add without confirmation
 *   medium — duplicate purchase suspicion, or braindump with strong keyword
 *            → surface as confirmation card
 *   low    — weak braindump keyword match → surface as card only, no auto-add
 *
 * Copy rules: factual, no shame, no judgment. Never "oof", "oops",
 * "be careful", "should have". Educational, neutral.
 */

import type { FinanceRecord } from './types';
import { DAY_MS } from './math';

// ─── types ────────────────────────────────────────────────────────────────

export type ADHDTaxCandidateCategory =
  | 'late_fee'
  | 'replacement'
  | 'duplicate'
  | 'unknown';

export type ADHDTaxConfidence = 'high' | 'medium' | 'low';

export interface ADHDTaxCandidate {
  /** Source transaction record id, if applicable. */
  record_id: string | null;
  category: ADHDTaxCandidateCategory;
  confidence: ADHDTaxConfidence;
  /** Dollar amount when known. */
  amount: number | null;
  /** The keyword or pattern that triggered detection. */
  matched_phrase: string;
  /**
   * Factual, non-judgmental copy for UI card.
   * English only. (TODO: add ES)
   */
  copy: string;
  /** When true the orchestrator may auto-add without user confirmation. */
  auto_add: boolean;
}

export interface DuplicatePurchase {
  merchant: string;
  merchant_normalized: string;
  record_ids: string[];
  amounts: number[];
  dates: string[];
  confidence: ADHDTaxConfidence;
  copy: string;
}

// ─── keyword tables ───────────────────────────────────────────────────────

/**
 * HIGH-confidence transaction-memo keywords.
 * These are explicit fee descriptors — no ambiguity.
 */
const HIGH_CONFIDENCE_MEMO_KEYWORDS: Array<{
  re: RegExp;
  keyword: string;
  category: ADHDTaxCandidateCategory;
  copy: string;
}> = [
  {
    re: /\blate\s+(fee|charge)\b/i,
    keyword: 'late fee',
    category: 'late_fee',
    copy: 'this looks like a late fee',
  },
  {
    re: /\boverdraft\s+fee\b/i,
    keyword: 'overdraft fee',
    category: 'late_fee',
    copy: 'this looks like an overdraft fee',
  },
  {
    re: /\bnsf\s+(fee|charge)\b/i,
    keyword: 'NSF fee',
    category: 'late_fee',
    copy: 'this looks like an NSF fee',
  },
  {
    re: /\breturned\s+payment\s+fee\b/i,
    keyword: 'returned payment fee',
    category: 'late_fee',
    copy: 'this looks like a returned payment fee',
  },
  {
    re: /\bpast\s+due\s+(fee|charge|penalty)\b/i,
    keyword: 'past due fee',
    category: 'late_fee',
    copy: 'this looks like a past-due fee',
  },
];

/**
 * MEDIUM-confidence transaction-memo keywords.
 * Less explicit — could be legitimate, surface as card for confirmation.
 */
const MEDIUM_CONFIDENCE_MEMO_KEYWORDS: Array<{
  re: RegExp;
  keyword: string;
  category: ADHDTaxCandidateCategory;
  copy: string;
}> = [
  {
    re: /\blate\s+charge\b/i,
    keyword: 'late charge',
    category: 'late_fee',
    copy: 'this looks like a late charge',
  },
  {
    re: /\bpenalty\s+(fee|charge)\b/i,
    keyword: 'penalty fee',
    category: 'late_fee',
    copy: 'this looks like a penalty fee',
  },
  {
    re: /\breplacement\b/i,
    keyword: 'replacement',
    category: 'replacement',
    copy: 'this looks like a replacement purchase',
  },
  {
    re: /\blost\s+(item|card|key|device|phone|charger)\b/i,
    keyword: 'lost item',
    category: 'replacement',
    copy: 'this looks like a replacement for a lost item',
  },
  {
    re: /\bduplicate\s+(order|purchase|charge)\b/i,
    keyword: 'duplicate charge',
    category: 'duplicate',
    copy: 'this may be a duplicate charge',
  },
];

/**
 * Braindump free-text keywords. Medium confidence (surface card).
 * Keyword + category + copy.
 *
 * Negative test guard: "saved $5 late fee at the cafe" must NOT match.
 * The patterns below require the phrase to appear in a context that implies
 * the user *experienced* the fee, not merely mentioned it in passing.
 * We keep regexes simple — false negatives are acceptable; false positives
 * are not.
 */
const BRAINDUMP_KEYWORDS: Array<{
  re: RegExp;
  keyword: string;
  category: ADHDTaxCandidateCategory;
  copy: string;
  confidence: ADHDTaxConfidence;
}> = [
  {
    re: /\bforgot\s+to\s+pay\b/i,
    keyword: 'forgot to pay',
    category: 'late_fee',
    copy: 'sounds like there may be a late payment',
    confidence: 'medium',
  },
  {
    re: /\bmissed\s+(a\s+)?payment\b/i,
    keyword: 'missed payment',
    category: 'late_fee',
    copy: 'sounds like there may be a missed payment',
    confidence: 'medium',
  },
  {
    re: /\blate\s+payment\b/i,
    keyword: 'late payment',
    category: 'late_fee',
    copy: 'sounds like there may be a late payment',
    confidence: 'medium',
  },
  {
    re: /\bdouble[\s-]?charged\b/i,
    keyword: 'double charged',
    category: 'duplicate',
    copy: 'this may be a double charge',
    confidence: 'medium',
  },
  {
    re: /\bduplicate\s+order\b/i,
    keyword: 'duplicate order',
    category: 'duplicate',
    copy: 'this may be a duplicate order',
    confidence: 'medium',
  },
  {
    re: /\baccidentally\s+(ordered|bought|purchased)\b/i,
    keyword: 'accidentally ordered',
    category: 'duplicate',
    copy: 'this may be an accidental purchase',
    confidence: 'medium',
  },
  {
    re: /\bbought\s+(another|a\s+second|two)\b/i,
    keyword: 'bought another',
    category: 'duplicate',
    copy: 'this may be a duplicate purchase',
    confidence: 'medium',
  },
  {
    re: /\bforgot\s+i\s+(had|owned|already)\b/i,
    keyword: 'forgot i had',
    category: 'duplicate',
    copy: 'this may be a duplicate purchase',
    confidence: 'low',
  },
];

// ─── detectADHDTaxFromTxn ─────────────────────────────────────────────────

/**
 * Scan a single transaction record for ADHD tax signals.
 *
 * Returns null when no signal found.
 * Returns high-confidence candidate when memo contains explicit fee descriptor.
 * Returns medium-confidence candidate for softer matches.
 */
export function detectADHDTaxFromTxn(transaction: FinanceRecord): ADHDTaxCandidate | null {
  if (!transaction || transaction.direction !== 'out') return null;

  const text = [
    transaction.notes,
    transaction.merchant,
    transaction.category,
  ]
    .filter(Boolean)
    .join(' ');

  if (!text) return null;

  // Check high-confidence first.
  for (const { re, keyword, category, copy } of HIGH_CONFIDENCE_MEMO_KEYWORDS) {
    if (re.test(text)) {
      return {
        record_id: transaction.id ?? null,
        category,
        confidence: 'high',
        amount: transaction.amount,
        matched_phrase: keyword,
        copy,
        auto_add: true,
      };
    }
  }

  // Check medium-confidence.
  for (const { re, keyword, category, copy } of MEDIUM_CONFIDENCE_MEMO_KEYWORDS) {
    if (re.test(text)) {
      return {
        record_id: transaction.id ?? null,
        category,
        confidence: 'medium',
        amount: transaction.amount,
        matched_phrase: keyword,
        copy,
        auto_add: false,
      };
    }
  }

  return null;
}

// ─── detectDuplicatePurchases ─────────────────────────────────────────────

/**
 * Find potential duplicate purchases: same merchant, same or similar amount
 * (within ±5%), within `windowDays` days of each other.
 *
 * Returns medium-confidence candidates only; high requires explicit fee memo.
 */
export function detectDuplicatePurchases(
  transactions: FinanceRecord[],
  windowDays = 7,
): DuplicatePurchase[] {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  const out = transactions.filter(
    (r) => r?.direction === 'out' && r.amount != null && r.merchant_normalized,
  );

  // Group by merchant_normalized.
  const byMerchant = new Map<string, FinanceRecord[]>();
  for (const r of out) {
    const k = r.merchant_normalized as string;
    const arr = byMerchant.get(k) ?? [];
    arr.push(r);
    byMerchant.set(k, arr);
  }

  const duplicates: DuplicatePurchase[] = [];

  for (const [merchant, recs] of byMerchant) {
    if (recs.length < 2) continue;

    // Sort by date.
    const sorted = [...recs].sort((a, b) =>
      (a.event_date ?? '').localeCompare(b.event_date ?? ''),
    );

    // Sliding window: for each pair within windowDays, check amount similarity.
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const dateI = sorted[i].event_date;
        const dateJ = sorted[j].event_date;
        const msI = Date.parse(dateI + 'T12:00:00');
        const msJ = Date.parse(dateJ + 'T12:00:00');
        const diffDays = Math.abs(msJ - msI) / DAY_MS;
        if (diffDays > windowDays) break; // further pairs will be even further apart

        const amtI = sorted[i].amount as number;
        const amtJ = sorted[j].amount as number;
        const maxAmt = Math.max(amtI, amtJ);
        if (maxAmt === 0) continue;
        const relDiff = Math.abs(amtI - amtJ) / maxAmt;
        if (relDiff > 0.05) continue; // >5% difference — not a duplicate

        duplicates.push({
          merchant: sorted[i].merchant ?? merchant,
          merchant_normalized: merchant,
          record_ids: [sorted[i].id ?? '', sorted[j].id ?? ''].filter(Boolean),
          amounts: [amtI, amtJ],
          dates: [dateI, dateJ],
          confidence: 'medium',
          copy: `two ${sorted[i].merchant ?? merchant} charges within ${Math.round(diffDays)} day${diffDays === 1 ? '' : 's'} for similar amounts`,
        });
      }
    }
  }

  return duplicates;
}

// ─── detectADHDTaxFromBraindump ───────────────────────────────────────────

/**
 * Keyword-spot ADHD tax signals in free-form braindump text.
 *
 * Negative test: "saved $5 late fee at the cafe" → must NOT return a
 * late_fee candidate. The BRAINDUMP_KEYWORDS patterns require the
 * phrasing to imply the user *incurred* the fee, not observed/saved one.
 *
 * Uses existing braindump tokenizer contract: receives raw text string.
 */
export function detectADHDTaxFromBraindump(text: string): ADHDTaxCandidate[] {
  if (!text || typeof text !== 'string') return [];
  const results: ADHDTaxCandidate[] = [];

  for (const { re, keyword, category, copy, confidence } of BRAINDUMP_KEYWORDS) {
    if (re.test(text)) {
      results.push({
        record_id: null,
        category,
        confidence,
        amount: null,
        matched_phrase: keyword,
        copy,
        auto_add: false, // braindump candidates are NEVER auto-added
      });
    }
  }

  return results;
}
