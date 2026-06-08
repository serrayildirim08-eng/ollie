/**
 * @ollie/logic · brain · the selection discipline
 *
 * The brain's primary job: instead of letting every detector that fires drop
 * a card (a nag-wall), gather ALL candidate noticings across her whole life,
 * SCORE each one, and surface only the most important FEW — Serra's locked
 * 2–3 across everything at once (never a wall, never per-module).
 *
 * Everything here is PURE — no I/O, no DOM, no wall-clock reads (the caller
 * passes `now`). The native side owns gathering candidates from the store and
 * persisting snooze/dismiss state; this module owns only the math, so the
 * whole discipline is unit-testable and Sprint 4's LEARNED per-person map can
 * later override the cold-start defaults without touching the wiring.
 *
 * No shame anywhere: scoring is about "what deserves her attention now", not
 * severity or blame. A low-capacity day raises the bar moderately so small,
 * deferrable noticings rest — but genuinely important things (a deadline, a
 * med, a bill due) still come through.
 */

import { DAY_MS } from '../util';

// ─── decisions (Serra-locked) ─────────────────────────────────────────────

/** DECISION 1 — never surface more than this many noticings at once. */
export const MAX_NOTICINGS = 3;
/** DECISION 1 — aim for at least this many when enough clear the bar. */
export const TARGET_NOTICINGS = 2;

// ─── candidate shape ──────────────────────────────────────────────────────

/**
 * A noticing candidate, normalised from any source (a `<module>.patterns`
 * card, `shared.patterns`, the grocery replenish signal, a harm signal). Kept
 * deliberately small + tolerant so the native gatherer can map anything onto
 * it without a per-detector adapter.
 */
export interface NoticingCandidate {
  /** Stable id — used for snooze/dismiss keying + dedupe. Required. */
  id: string;
  /** Owning module, e.g. 'grocery' | 'work' | 'admin'. Drives the defer map. */
  module: string;
  /** The one editorial sentence shown to the user. */
  copy: string;
  /**
   * The detector's category / pattern-kind, when known (e.g. the pattern id
   * 'grocery-replenish-needed', or a category like 'deadline_passed'). Used by
   * the cold-start defer map. Optional — falls back to the module.
   */
  category?: string | null;
  /**
   * ms-since-epoch when this becomes / became time-critical (a due date, a
   * predicted run-out, a deadline). Sooner = more urgent. Null/undefined →
   * not time-critical.
   */
  urgencyAt?: number | null;
  /** ms-since-epoch the noticing was first created/detected, when known. */
  createdAt?: number | null;
  /**
   * Sprint 3 — optional situation facts the gatherer recovered from the source
   * pattern (item names, days-past, count). Carried so the copy layer can
   * generate a fitted sentence and the action layer can recover what to act on
   * (e.g. WHICH items to add to the grocery list). Opaque to the selector — it
   * scores on the fields above only. Kept tolerant so any source can attach it.
   */
  facts?: {
    /** Item / subject names involved (e.g. ['milk']). */
    items?: string[];
    /** Days past the relevant date for the headline item, when known. */
    days?: number | null;
    [extra: string]: unknown;
  } | null;
}

/** A scored candidate — the candidate plus its computed score + parts. */
export interface ScoredNoticing extends NoticingCandidate {
  /** Final score (higher = more deserving of her attention now). */
  score: number;
  /** Score breakdown, kept for tests + future learning-loop introspection. */
  parts: {
    urgency: number;
    deferability: number;
  };
}

// ─── cold-start defer map (Serra-approved) ────────────────────────────────
//
// "ok to defer" vs "protect". This is the COLD START — Sprint 4 will learn a
// per-person map and override it. Keyed by category/pattern-id first, then by
// module. Higher deferability = safer to let it rest = scored LOWER.

/** How safe a kind of noticing is to defer. 0 = protect, 1 = freely defer. */
export type Deferability = number;

const DEFERABLE = 1; // chores/home, groceries/errands, social "I'll call sometime"
const NEUTRAL = 0.5; // unknown — neither protected nor freely droppable
const PROTECT = 0; // hard deadlines, meds, appointments, bills due, health

/**
 * Cold-start deferability by MODULE. A module-level default; a more specific
 * category/pattern match (below) wins over this.
 */
const MODULE_DEFERABILITY: Record<string, Deferability> = {
  // freely deferrable — chores, errands, the house, social
  grocery: DEFERABLE,
  pets: DEFERABLE, // routine pet-care noticings; a vet deadline is caught by category
  habits: DEFERABLE,
  journal: DEFERABLE, // dump resurfacings / anniversaries — never urgent
  dump: DEFERABLE,
  // protect — these modules carry the things that won't wait
  medication: PROTECT,
  admin: PROTECT, // renewals + paperwork deadlines
  finance: PROTECT, // bills due / late
  cycle: PROTECT, // health
  body: PROTECT, // health
  sleep: NEUTRAL,
  // work + goals are mixed — a deadline protects, a soft nudge defers. The
  // category map + urgency signal separate them; module default stays neutral.
  work: NEUTRAL,
  goals: NEUTRAL,
};

/**
 * Cold-start deferability by CATEGORY / pattern-id. More specific than the
 * module default — a substring match against the candidate's category id.
 * Ordered most-protective first so the strongest signal wins on overlap.
 */
const CATEGORY_DEFERABILITY: Array<{ match: string; value: Deferability }> = [
  // ── protect: time / health critical ──
  { match: 'deadline', value: PROTECT },
  { match: 'overdue', value: PROTECT },
  { match: 'due', value: PROTECT },
  { match: 'missed', value: PROTECT }, // harm:missed deadline
  { match: 'late', value: PROTECT }, // harm:late bill
  { match: 'med', value: PROTECT },
  { match: 'dose', value: PROTECT },
  { match: 'appointment', value: PROTECT },
  { match: 'appt', value: PROTECT },
  { match: 'renewal', value: PROTECT },
  { match: 'bill', value: PROTECT },
  { match: 'health', value: PROTECT },
  { match: 'symptom', value: PROTECT },
  // ── deferrable: chores / errands / social / soft ──
  { match: 'replenish', value: DEFERABLE }, // grocery "milk ran low"
  { match: 'spoiled', value: DEFERABLE }, // harm:spoiled — already happened, no rush
  { match: 'grocery', value: DEFERABLE },
  { match: 'stale', value: DEFERABLE },
  { match: 'cadence', value: DEFERABLE },
  { match: 'chore', value: DEFERABLE },
  { match: 'errand', value: DEFERABLE },
  { match: 'social', value: DEFERABLE },
  { match: 'call', value: DEFERABLE },
  { match: 'duplicate', value: DEFERABLE },
];

/**
 * Resolve a candidate's deferability (0 protect … 1 freely defer). Category /
 * pattern-id match wins; otherwise the module default; otherwise NEUTRAL.
 */
export function deferabilityOf(candidate: NoticingCandidate): Deferability {
  const cat = (candidate.category ?? '').toString().toLowerCase();
  if (cat) {
    for (const { match, value } of CATEGORY_DEFERABILITY) {
      if (cat.includes(match)) return value;
    }
  }
  const mod = (candidate.module ?? '').toString().toLowerCase();
  if (mod in MODULE_DEFERABILITY) return MODULE_DEFERABILITY[mod];
  return NEUTRAL;
}

// ─── scoring ──────────────────────────────────────────────────────────────

/** Capacity-shaped threshold a noticing must clear to be surfaced. */
const BASE_THRESHOLD = 1.0;
/** DECISION 3 — low capacity raises the bar MODERATELY (not total silence). */
const LOW_CAPACITY_BUMP = 1.0;

/**
 * Urgency contribution from a time-critical date. Already-due / imminent →
 * high; comfortably in the future → tapering toward 0; absent → 0. Pure: the
 * caller passes `now`.
 *
 * Curve (deliberately simple + testable):
 *   - overdue (urgencyAt <= now)        → 3   (the strongest pull)
 *   - within ~1 day                     → 2.5
 *   - within ~3 days                    → 2
 *   - within ~7 days                    → 1.5
 *   - within ~14 days                   → 1
 *   - further out / none                → 0
 */
function urgencyScore(urgencyAt: number | null | undefined, now: number): number {
  if (typeof urgencyAt !== 'number' || !Number.isFinite(urgencyAt)) return 0;
  const days = (urgencyAt - now) / DAY_MS;
  if (days <= 0) return 3;
  if (days <= 1) return 2.5;
  if (days <= 3) return 2;
  if (days <= 7) return 1.5;
  if (days <= 14) return 1;
  return 0;
}

/**
 * Deferability contribution: a PROTECTED noticing (deferability 0) gets a full
 * +1 floor so it can clear the bar on its own; a freely-deferrable one (1)
 * gets 0. Linear in between. This is what keeps a med/deadline surfacing even
 * with no explicit urgencyAt, while a "milk ran low" rests unless it's all
 * that's around.
 */
function deferabilityScore(deferability: Deferability): number {
  const d = Math.max(0, Math.min(1, deferability));
  return 1 - d;
}

/**
 * How much a freely-deferrable item's time-pressure still counts. A protected
 * item (deferability 0) feels its urgency at full weight; a freely-deferrable
 * one (deferability 1) at this fraction. This is what lets "milk ran low
 * yesterday" carry SOME pull on a normal day but drop under the raised
 * low-capacity bar, while a hard deadline that's overdue always punches
 * through. Linear between the two ends.
 */
const DEFERRABLE_URGENCY_WEIGHT = 0.5;

/**
 * Score one candidate. Pure — never throws, never reads the clock.
 *
 *   urgencyWeight = 1 − deferability·(1 − DEFERRABLE_URGENCY_WEIGHT)
 *   score         = urgencyScore·urgencyWeight + deferabilityScore
 *
 * The urgency weight means a deferrable chore's deadline pulls at half strength
 * vs a protected deadline — so on a low-capacity day the raised bar drops the
 * chore but never the protected, time-critical thing. Kept additive +
 * transparent (parts retained) so Sprint 4 can swap the deferability source
 * for a learned per-person map without changing callers.
 */
export function scoreNoticing(candidate: NoticingCandidate, now: number): ScoredNoticing {
  const deferability = deferabilityOf(candidate);
  const urgencyWeight = 1 - deferability * (1 - DEFERRABLE_URGENCY_WEIGHT);
  const urgency = urgencyScore(candidate.urgencyAt, now) * urgencyWeight;
  const deferScore = deferabilityScore(deferability);
  return {
    ...candidate,
    score: urgency + deferScore,
    parts: { urgency, deferability: deferScore },
  };
}

/** The score bar for a given capacity level (DECISION 3). */
export function thresholdFor(capacity: 'low' | 'medium' | 'high'): number {
  return capacity === 'low' ? BASE_THRESHOLD + LOW_CAPACITY_BUMP : BASE_THRESHOLD;
}

// ─── selection ────────────────────────────────────────────────────────────

export interface SelectOptions {
  /** Sprint-1 capacity level. 'low' raises the bar moderately. Default 'medium'. */
  capacity?: 'low' | 'medium' | 'high';
  /** Ids currently snoozed (postpone) OR permanently dismissed — excluded. */
  excludeIds?: Iterable<string>;
}

/**
 * THE selection discipline. Given all gathered candidates, return the top
 * 2–3 (never more than {@link MAX_NOTICINGS}) that clear the capacity-adjusted
 * bar, excluding snoozed + dismissed ids. Pure + deterministic.
 *
 * Tie-break order (stable so the surface doesn't shuffle on every recompute):
 *   1. higher score
 *   2. higher urgency part (sooner deadlines first among equal scores)
 *   3. older createdAt (the thing that's been waiting longest)
 *   4. id (final deterministic fallback)
 *
 * If fewer than {@link TARGET_NOTICINGS} clear the bar, returns fewer (even
 * an empty list) — Serra locked "show fewer, never pad".
 */
export function selectNoticings(
  candidates: NoticingCandidate[],
  now: number,
  options: SelectOptions = {},
): ScoredNoticing[] {
  const capacity = options.capacity ?? 'medium';
  const threshold = thresholdFor(capacity);
  const excluded = new Set<string>(options.excludeIds ?? []);

  const scored = (Array.isArray(candidates) ? candidates : [])
    .filter((c): c is NoticingCandidate => !!c && typeof c.id === 'string' && c.id.length > 0)
    .filter((c) => !excluded.has(c.id))
    // de-dupe by id — first occurrence wins (gatherer may merge own + shared)
    .filter((c, i, arr) => arr.findIndex((o) => o.id === c.id) === i)
    .map((c) => scoreNoticing(c, now))
    .filter((s) => s.score >= threshold);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.parts.urgency !== a.parts.urgency) return b.parts.urgency - a.parts.urgency;
    const ca = a.createdAt ?? Number.POSITIVE_INFINITY;
    const cb = b.createdAt ?? Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });

  return scored.slice(0, MAX_NOTICINGS);
}
