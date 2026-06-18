/**
 * @ollie/logic · finance · savings deposit detection
 *
 * Pure functions. No I/O, no React, no DOM.
 * `now` is injected by callers.
 *
 * Detects transfers to savings accounts from transaction records and
 * braindump text, then attempts to attribute them to named savings goals.
 *
 * Confidence rules:
 *   high   — outbound+inbound same-day same-amount pair, OR explicit goal
 *             name in memo → auto-update goal progress
 *   medium — keyword match in memo with plausible amount → surface card
 *   low    — weak keyword match or ambiguous → ignore / don't surface
 */

import type { FinanceRecord, SavingsGoal } from './types';
import { median as medianOf } from '../stats';

// ─── types ────────────────────────────────────────────────────────────────

export type SavingsTransferConfidence = 'high' | 'medium' | 'low';

export interface SavingsTransfer {
  id: string;
  /** Transaction record id that triggered this detection (outbound side). */
  record_id: string;
  /** Paired inbound record id, if both sides are visible. */
  paired_record_id: string | null;
  amount: number;
  date: string;               // YYYY-MM-DD
  memo: string | null;
  /** e.g. "transfer to savings", "high-yield", "deposit" */
  matched_keyword: string | null;
  confidence: SavingsTransferConfidence;
  /** Set when both sides of a transfer are visible. */
  is_matched_pair: boolean;
}

export interface GoalAttribution {
  transfer: SavingsTransfer;
  goal_id: string;
  goal_name: string;
  /** How the match was made. */
  match_reason: 'explicit_memo' | 'amount_frequency' | 'ambiguous';
  confidence: SavingsTransferConfidence;
  /** When true the orchestrator may auto-update goal progress. */
  auto_apply: boolean;
}

// ─── keyword lists ────────────────────────────────────────────────────────

/** Keywords in memo/description that indicate a savings transfer. */
const SAVINGS_KEYWORDS: Array<{ re: RegExp; keyword: string }> = [
  { re: /transfer\s+to\s+savings/i,      keyword: 'transfer to savings' },
  { re: /to\s+high[\s-]?yield/i,         keyword: 'to high-yield' },
  { re: /to\s+savings/i,                 keyword: 'to savings' },
  { re: /\bhysa\b/i,                     keyword: 'hysa' },
  { re: /savings\s+account/i,            keyword: 'savings account' },
  { re: /\bemergency\s+fund\b/i,         keyword: 'emergency fund' },
  { re: /\bsinking\s+fund\b/i,           keyword: 'sinking fund' },
  { re: /\bdeposit\b/i,                  keyword: 'deposit' },
  { re: /\bsave\b/i,                     keyword: 'save' },
];

/**
 * Keywords in *braindump* text that indicate a savings deposit was made.
 * Intentionally narrower than the transaction-memo list to reduce false
 * positives from free-form prose.
 */
const BRAINDUMP_SAVINGS_KEYWORDS: Array<{ re: RegExp; keyword: string }> = [
  { re: /moved\s+.{1,30}\s+to\s+savings/i,    keyword: 'moved to savings' },
  { re: /put\s+.{1,30}\s+in(to)?\s+savings/i, keyword: 'put into savings' },
  { re: /transferred\s+.{1,30}\s+to\s+savings/i, keyword: 'transferred to savings' },
  { re: /saved\s+\$\s*\d/i,                    keyword: 'saved $' },
  { re: /deposit(ed)?\s+.{0,20}\s+(to|into)\s+(savings|hysa|emergency|fund)/i, keyword: 'deposited to savings' },
  { re: /added\s+.{0,20}\s+(to|into)\s+(my\s+)?(savings|emergency\s+fund|sinking\s+fund)/i, keyword: 'added to savings' },
];

// ─── helpers ──────────────────────────────────────────────────────────────

function extractAmount(text: string): number | null {
  const m = text.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    return isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

/**
 * Deterministic, purity-preserving id for a detected transfer.
 *
 * The previous implementation used `Date.now()` plus a module-level counter,
 * which made `detectSavingsTransfers` non-pure (same input → different ids on
 * each call / across runs) and order-coupled via shared mutable state. The id
 * is now a stable hash of the fields that define the transfer, so identical
 * inputs always yield identical ids.
 */
function transferId(parts: {
  record_id: string;
  paired_record_id: string | null;
  date: string;
  amount: number;
}): string {
  const key = `${parts.record_id}|${parts.paired_record_id ?? ''}|${parts.date}|${parts.amount}`;
  // 32-bit FNV-1a — deterministic, no I/O, collision-resistant enough for ids.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `st-${(h >>> 0).toString(36)}`;
}

// ─── detectSavingsTransfers ───────────────────────────────────────────────

/**
 * Scan FinanceRecord[] for savings transfers.
 *
 * Strategy:
 *   1. Matched pair: outbound + inbound on same day with same amount →
 *      high confidence.
 *   2. Single-sided with strong keyword (transfer to savings, hysa, etc.) →
 *      medium confidence.
 *   3. Single-sided with weak keyword (deposit, save) only → low confidence
 *      (not returned; callers ignore low).
 */
export function detectSavingsTransfers(transactions: FinanceRecord[]): SavingsTransfer[] {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  const outbound = transactions.filter(
    (r) => r?.direction === 'out' && r.amount != null && r.amount > 0,
  );
  const inbound = transactions.filter(
    (r) => r?.direction === 'in' && r.amount != null && r.amount > 0,
  );

  const results: SavingsTransfer[] = [];
  const pairedOutboundIds = new Set<string>();
  const pairedInboundIds = new Set<string>();

  // Pass 1: same-day, same-amount outbound↔inbound pairs.
  for (const out of outbound) {
    const match = inbound.find(
      (inp) =>
        !pairedInboundIds.has(inp.id ?? '') &&
        inp.event_date === out.event_date &&
        Math.abs((inp.amount ?? 0) - (out.amount ?? 0)) < 0.01,
    );
    if (match) {
      pairedOutboundIds.add(out.id ?? '');
      pairedInboundIds.add(match.id ?? '');
      const memo = out.notes ?? out.merchant ?? null;
      const kw = SAVINGS_KEYWORDS.find((k) => k.re.test(memo ?? ''))?.keyword ?? null;
      results.push({
        id: transferId({
          record_id: out.id ?? '',
          paired_record_id: match.id ?? null,
          date: out.event_date,
          amount: out.amount as number,
        }),
        record_id: out.id ?? '',
        paired_record_id: match.id ?? null,
        amount: out.amount as number,
        date: out.event_date,
        memo,
        matched_keyword: kw,
        confidence: 'high',
        is_matched_pair: true,
      });
    }
  }

  // Pass 2: single-sided keyword matches for unpaired outbound records.
  for (const out of outbound) {
    if (pairedOutboundIds.has(out.id ?? '')) continue;
    const text = [out.notes, out.merchant, out.category].filter(Boolean).join(' ');
    const hit = SAVINGS_KEYWORDS.find((k) => k.re.test(text));
    if (!hit) continue;

    // 'deposit' and 'save' alone are weak signals — treat as low, skip.
    const weakOnly = hit.keyword === 'deposit' || hit.keyword === 'save';
    const confidence: SavingsTransferConfidence = weakOnly ? 'low' : 'medium';
    if (confidence === 'low') continue;

    results.push({
      id: transferId({
        record_id: out.id ?? '',
        paired_record_id: null,
        date: out.event_date,
        amount: out.amount as number,
      }),
      record_id: out.id ?? '',
      paired_record_id: null,
      amount: out.amount as number,
      date: out.event_date,
      memo: out.notes ?? out.merchant ?? null,
      matched_keyword: hit.keyword,
      confidence,
      is_matched_pair: false,
    });
  }

  return results;
}

// ─── matchTransfersToGoals ────────────────────────────────────────────────

/**
 * Attempt to attribute SavingsTransfer[] to SavingsGoal[].
 *
 * High confidence (auto_apply = true):
 *   - Explicit goal name in the transfer memo.
 *   - Transfer is a matched pair AND goal has a close amount match (±5%)
 *     in its contributions history.
 *
 * Medium confidence (auto_apply = false):
 *   - Amount matches a goal's typical contribution frequency (within ±5%
 *     of prior contributions' median).
 *   - Ambiguous when multiple goals match.
 */
export function matchTransfersToGoals(
  transfers: SavingsTransfer[],
  goals: Array<SavingsGoal & { id: string; name: string }>,
): GoalAttribution[] {
  if (!Array.isArray(transfers) || !Array.isArray(goals)) return [];
  if (transfers.length === 0 || goals.length === 0) return [];

  const attributions: GoalAttribution[] = [];

  for (const transfer of transfers) {
    if (transfer.confidence === 'low') continue;

    // 1. Explicit name match in memo.
    const memoText = (transfer.memo ?? '').toLowerCase();
    const explicitGoal = goals.find((g) => g.name && memoText.includes(g.name.toLowerCase()));
    if (explicitGoal) {
      attributions.push({
        transfer,
        goal_id: explicitGoal.id,
        goal_name: explicitGoal.name,
        match_reason: 'explicit_memo',
        confidence: 'high',
        auto_apply: true,
      });
      continue;
    }

    // 2. Amount-frequency match against contribution history.
    const amtMatches: Array<{ goal: typeof goals[0]; medianContrib: number }> = [];
    for (const goal of goals) {
      const contribs = (goal.contributions ?? [])
        .map((c) => c.amount)
        .filter((v): v is number => v != null && v > 0);
      if (contribs.length === 0) continue;
      const median = medianOf(contribs);
      if (Math.abs(transfer.amount - median) / median <= 0.05) {
        amtMatches.push({ goal, medianContrib: median });
      }
    }

    if (amtMatches.length === 1) {
      const { goal } = amtMatches[0];
      attributions.push({
        transfer,
        goal_id: goal.id,
        goal_name: goal.name,
        match_reason: 'amount_frequency',
        confidence: transfer.is_matched_pair ? 'high' : 'medium',
        auto_apply: transfer.is_matched_pair,
      });
    } else if (amtMatches.length > 1) {
      // Ambiguous — surface as card for each candidate.
      for (const { goal } of amtMatches) {
        attributions.push({
          transfer,
          goal_id: goal.id,
          goal_name: goal.name,
          match_reason: 'ambiguous',
          confidence: 'medium',
          auto_apply: false,
        });
      }
    }
    // No match → not attributed; orchestrator surfaces generic "did this go toward a goal?" card.
  }

  return attributions;
}

// ─── detectSavingsFromBraindump ───────────────────────────────────────────

export interface BraindumpSavingsCandidate {
  text: string;
  matched_keyword: string;
  amount: number | null;
  confidence: SavingsTransferConfidence;
}

/**
 * Keyword-spot savings transfers in free-form braindump text.
 * Returns medium-confidence candidates only (low ignored by caller).
 */
export function detectSavingsFromBraindump(text: string): BraindumpSavingsCandidate[] {
  if (!text || typeof text !== 'string') return [];
  const results: BraindumpSavingsCandidate[] = [];

  for (const { re, keyword } of BRAINDUMP_SAVINGS_KEYWORDS) {
    if (re.test(text)) {
      const amount = extractAmount(text);
      results.push({
        text: text.trim(),
        matched_keyword: keyword,
        amount,
        confidence: 'medium',
      });
      break; // one candidate per text block
    }
  }

  return results;
}
