/**
 * @ollie/logic · finance · subscription dormancy scoring
 *
 * Heuristic detection of subscriptions the user is paying for but has
 * stopped engaging with. Cross-references two data sources we already
 * have on device:
 *
 *   1. Charge cadence   — recent FinanceRecord rows for the same merchant
 *   2. Brain-dump mentions — references to the service in dump entries
 *
 * Pure function. Takes already-decrypted brain-dump entries. Caller is
 * responsible for the decrypt path; raw user text must NEVER be passed
 * to a worker.
 *
 * Hard data-hygiene rules:
 *   - If we lack data to compute a field, return null. NEVER fill with
 *     a synthetic timestamp.
 *   - If the subscription was created < 7 days ago, mark inconclusive
 *     ("too soon to tell"). No cancel button surfaces for it.
 *   - If no alias-catalog key matches the sub name, the brain-dump
 *     scan returns null and we surface a manual yes/no card instead
 *     of guessing.
 *
 * Output is sorted so the highest-priority cancel candidates appear
 * first, with monthly cost used as the tiebreaker.
 */

import type { FinanceRecord } from './types';
import {
  SUBSCRIPTION_ALIASES,
  matchAliasKey,
  scanMentions,
} from './subscription-aliases';

import { DAY_MS } from '../util';

export type DormancyRecommendation =
  | 'cancel_candidate'
  | 'review'
  | 'active'
  | 'inconclusive'
  | 'too_soon';

export interface StoredSubLike {
  id: string;
  name: string;
  amount: number;
  /** monthly | yearly — yearly normalises to monthly_amount in scoring */
  period: 'monthly' | 'yearly';
  /** ms timestamp the sub was first added */
  ts: number;
  /** optional: pre-resolved alias catalog key */
  alias_key?: string | null;
  /** optional: user-set snooze deadline; signals filtered out by caller */
  snoozeUntil?: number | null;
}

export interface BrainDumpEntry {
  ts: number;
  text: string;
}

export interface DormancySignal {
  subscriptionId: string;
  subscriptionName: string;
  /** Resolved canonical alias key (e.g. "netflix") or null if no match. */
  aliasKey: string | null;
  /** Number of matched charges in the trailing 90-day window. */
  chargesIn90d: number;
  /** Most recent charge timestamp (ms) or null. */
  lastChargeAt: number | null;
  /** Most recent brain-dump mention timestamp (ms) or null. */
  lastMentionAt: number | null;
  /** Days since most recent mention. null when no mention recorded. */
  daysSinceMention: number | null;
  /** Mention count in the trailing 90-day window. */
  mentionsIn90d: number;
  /** Normalised monthly amount (yearly / 12). */
  monthlyAmount: number;
  /** Days since the subscription was created. */
  daysSinceCreated: number;
  /**
   * Dormancy score 0..100 (higher = more dormant). null when we cannot
   * meaningfully score (no alias match, or too_soon).
   */
  dormancyScore: number | null;
  /** Greppable evidence string used by the UI for the row subtitle. */
  evidence: string;
  recommendation: DormancyRecommendation;
}

/** Cost weighting threshold — subs above this monthly cost get a score bump. */
const COST_WEIGHT_THRESHOLD = 20;
/** New-sub cooling window — younger than this, mark too_soon. */
const TOO_SOON_DAYS = 7;
/** Analysis window. */
const ANALYSIS_WINDOW_DAYS = 90;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizedMonthly(sub: StoredSubLike): number {
  if (!Number.isFinite(sub.amount) || sub.amount <= 0) return 0;
  return sub.period === 'yearly' ? sub.amount / 12 : sub.amount;
}

/**
 * Count charges in the 90-day window for this subscription. We match
 * against alias terms rather than exact merchant strings because the
 * user types "Spotify USA" in finance records while the sub is named
 * "Spotty Premium" and brain-dumps say "spotify" — the alias catalog
 * is the source of truth.
 *
 * When aliasKey is null (no catalog match), fall back to a soft name
 * compare so we still produce a charge count for the UI.
 */
function countCharges(
  records: ReadonlyArray<FinanceRecord>,
  aliasKey: string | null,
  subName: string,
  now: number,
): { count: number; last: number | null } {
  const windowStart = now - ANALYSIS_WINDOW_DAYS * DAY_MS;
  const aliasTerms = aliasKey ? SUBSCRIPTION_ALIASES[aliasKey] : null;
  const nameLow = subName.toLowerCase().trim();
  let count = 0;
  let last: number | null = null;
  for (const r of records) {
    if (!r || r.direction !== 'out' || r.amount == null) continue;
    const merchant = (r.merchant_normalized ?? r.merchant ?? '').toLowerCase();
    if (!merchant) continue;
    let hit = false;
    if (aliasTerms) {
      for (const term of aliasTerms) {
        if (merchant.includes(term.toLowerCase())) { hit = true; break; }
      }
    } else if (nameLow) {
      hit = merchant.includes(nameLow);
    }
    if (!hit) continue;
    // resolve event timestamp — prefer created_at, fall back to event_date
    const ts = typeof r.created_at === 'number'
      ? r.created_at
      : r.event_date
        ? Date.parse(r.event_date)
        : NaN;
    if (!Number.isFinite(ts)) continue;
    if (ts < windowStart) continue;
    count += 1;
    if (last === null || ts > last) last = ts;
  }
  return { count, last };
}

/**
 * Score one subscription. Decision tree:
 *
 *   age < 7d                            -> too_soon, score null
 *   no alias match (& no mention scan)  -> inconclusive, score null
 *   0 charges in 90d                    -> inconclusive (already cancelled?)
 *   0 mentions + >=3 charges            -> cancel_candidate, score >= 80
 *   1-2 mentions                        -> review, score 40..70
 *   >=3 mentions OR mention <14d ago    -> active, score <=30
 *
 * Cost weight: subs above $20/mo get a +10 score bump and tiebreak
 * higher in the sorted output.
 */
function scoreOne(
  sub: StoredSubLike,
  records: ReadonlyArray<FinanceRecord>,
  dumps: ReadonlyArray<BrainDumpEntry>,
  now: number,
): DormancySignal {
  const monthlyAmount = normalizedMonthly(sub);
  const daysSinceCreated = Math.floor((now - sub.ts) / DAY_MS);
  const aliasKey = sub.alias_key ?? matchAliasKey(sub.name);
  const windowStart = now - ANALYSIS_WINDOW_DAYS * DAY_MS;
  const charges = countCharges(records, aliasKey, sub.name, now);
  const mentions = aliasKey ? scanMentions(aliasKey, dumps, windowStart) : null;

  const daysSinceMention = mentions?.lastMentionAt != null
    ? Math.floor((now - mentions.lastMentionAt) / DAY_MS)
    : null;

  const base = {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    aliasKey,
    chargesIn90d: charges.count,
    lastChargeAt: charges.last,
    lastMentionAt: mentions?.lastMentionAt ?? null,
    daysSinceMention,
    mentionsIn90d: mentions?.countInWindow ?? 0,
    monthlyAmount,
    daysSinceCreated,
  };

  // too soon to tell — sub was added within the cooling window
  if (daysSinceCreated < TOO_SOON_DAYS) {
    return {
      ...base,
      dormancyScore: null,
      recommendation: 'too_soon',
      evidence: `added ${daysSinceCreated}d ago. too soon to tell.`,
    };
  }

  // no alias match — we cannot scan brain dumps for mentions, so ask
  // the user instead of guessing
  if (!aliasKey) {
    return {
      ...base,
      dormancyScore: null,
      recommendation: 'inconclusive',
      evidence: `not in the catalog. we couldn't match this to your writing.`,
    };
  }

  // probably already cancelled — no charges in 90 days
  if (charges.count === 0) {
    return {
      ...base,
      dormancyScore: null,
      recommendation: 'inconclusive',
      evidence: `no charges in the last ${ANALYSIS_WINDOW_DAYS} days. maybe already cancelled.`,
    };
  }

  const mentionCount = mentions?.countInWindow ?? 0;

  // active — frequent or very recent mentions
  if (mentionCount >= 3 || (daysSinceMention != null && daysSinceMention < 14)) {
    const recentNote = daysSinceMention != null
      ? `${mentionCount} mentions in the last 90 days, ${daysSinceMention}d ago`
      : `${mentionCount} mentions in the last 90 days`;
    return {
      ...base,
      dormancyScore: clamp(20 - mentionCount * 4, 0, 30),
      recommendation: 'active',
      evidence: recentNote,
    };
  }

  // review — 1 or 2 mentions
  if (mentionCount >= 1) {
    const note = daysSinceMention != null
      ? `${mentionCount} mentions in the last 90 days, ${daysSinceMention}d ago`
      : `${mentionCount} mentions in the last 90 days`;
    const score = clamp(70 - mentionCount * 15 + (monthlyAmount > COST_WEIGHT_THRESHOLD ? 5 : 0), 40, 70);
    return {
      ...base,
      dormancyScore: score,
      recommendation: 'review',
      evidence: note,
    };
  }

  // cancel candidate — 0 mentions, has charges
  const chargesWord = charges.count === 1 ? 'time' : 'times';
  const evidence = `paid ${charges.count} ${chargesWord} since you last wrote about it`;
  const score = clamp(
    80 + charges.count * 2 + (monthlyAmount > COST_WEIGHT_THRESHOLD ? 10 : 0),
    80,
    100,
  );
  return {
    ...base,
    dormancyScore: score,
    recommendation: 'cancel_candidate',
    evidence,
  };
}

/**
 * Sort key: cancel_candidate > review > inconclusive > too_soon >
 * active. Inside each bucket, higher dormancyScore first, then higher
 * monthlyAmount, then alphabetical.
 */
const RECOMMENDATION_RANK: Record<DormancyRecommendation, number> = {
  cancel_candidate: 0,
  review:           1,
  inconclusive:     2,
  too_soon:         3,
  active:           4,
};

function compareSignals(a: DormancySignal, b: DormancySignal): number {
  const ra = RECOMMENDATION_RANK[a.recommendation];
  const rb = RECOMMENDATION_RANK[b.recommendation];
  if (ra !== rb) return ra - rb;
  const sa = a.dormancyScore ?? -1;
  const sb = b.dormancyScore ?? -1;
  if (sa !== sb) return sb - sa;
  if (a.monthlyAmount !== b.monthlyAmount) return b.monthlyAmount - a.monthlyAmount;
  return a.subscriptionName.localeCompare(b.subscriptionName);
}

/**
 * Score every stored subscription against finance records + brain
 * dumps and return them sorted with cancel candidates first.
 *
 * Snoozed subs (snoozeUntil > now) are filtered out entirely — the
 * caller does not need to render them.
 */
export function scoreDormancy(
  subs: ReadonlyArray<StoredSubLike>,
  records: ReadonlyArray<FinanceRecord>,
  dumps: ReadonlyArray<BrainDumpEntry>,
  now: number,
): DormancySignal[] {
  const out: DormancySignal[] = [];
  for (const sub of subs) {
    if (!sub || !sub.id) continue;
    if (sub.snoozeUntil != null && sub.snoozeUntil > now) continue;
    out.push(scoreOne(sub, records, dumps, now));
  }
  out.sort(compareSignals);
  return out;
}

/** Aggregate counts the audit screen needs for its header + summary. */
export interface DormancySummary {
  totalSubs: number;
  monthlyTotal: number;
  candidateCount: number;
  reviewCount: number;
  inconclusiveCount: number;
}

export function summarize(
  signals: ReadonlyArray<DormancySignal>,
  allSubs: ReadonlyArray<StoredSubLike>,
): DormancySummary {
  let monthlyTotal = 0;
  for (const s of allSubs) monthlyTotal += normalizedMonthly(s);
  let candidate = 0;
  let review = 0;
  let inc = 0;
  for (const s of signals) {
    if (s.recommendation === 'cancel_candidate') candidate += 1;
    else if (s.recommendation === 'review') review += 1;
    else if (s.recommendation === 'inconclusive') inc += 1;
  }
  return {
    totalSubs: allSubs.length,
    monthlyTotal,
    candidateCount: candidate,
    reviewCount: review,
    inconclusiveCount: inc,
  };
}
