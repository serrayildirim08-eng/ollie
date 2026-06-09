/**
 * @ollie/logic · brain · the learning loop — "learn YOU"
 *
 * Sprint 4. The heart: turn the raw signals Sprint 1 captured into a PERSONAL
 * procrastination map. The brain watches what THIS user actually defers (and
 * whether that ever caused harm) and slowly learns, per bucket, whether a kind
 * of thing is genuinely OK to let rest for her — overriding the cold-start
 * defaults in select.ts over time.
 *
 * Everything here is PURE — no I/O, no DOM, no wall-clock reads. The native
 * side reads `brain_deferral_events` + `brain_harm_events`, groups them by
 * bucket, and feeds them in; this module owns only the verdict math, so the
 * whole loop is unit-testable.
 *
 * Serra's 4 locked decisions, honoured here:
 *   1. COARSE→FINE — learn at the CATEGORY level first (chores / groceries /
 *      bills / meds…). When a FINER bucket (a specific item / type, e.g. "milk"
 *      vs "eggs") has enough of its own data, its verdict overrides the coarser
 *      one for that bucket. Coarse is useful early; data sharpens it.
 *   2. CAUTIOUS — never override the cold-start default on 1–2 points. A bucket
 *      needs MIN_SAMPLE (~5) consistent observations before its LEARNED verdict
 *      is trusted; below that → 'unknown' (the caller falls back: finer→coarser→
 *      cold-start). Wrong-learning is worse than slow-learning.
 *   3. SILENT — this file emits NO user-facing copy. It returns verdicts only.
 *      Nothing here announces "I've stopped reminding you about X".
 *   4. OVERRIDE — a user pin (see {@link resolvePin}) wins over BOTH the learned
 *      verdict and the cold-start default. Pins live in the native store; this
 *      module only defines the resolution order so the math stays testable.
 *
 * No shame anywhere: this is "what's genuinely fine for her to let rest", never
 * severity or blame.
 */

// ─── decisions (Serra-locked) ─────────────────────────────────────────────

/**
 * DECISION 2 — CAUTIOUS. Minimum deferral observations in a bucket before a
 * LEARNED verdict is trusted. Below this the verdict is 'unknown' and the
 * caller falls back (finer→coarser→cold-start). Conservative on purpose.
 */
export const MIN_SAMPLE = 5;

/**
 * The fraction of a bucket's defers that may have led to harm and STILL let the
 * verdict be 'ok-to-defer'. At or above this harm rate the bucket flips to
 * 'protect'. Kept low — even a couple of real harms in a small sample should
 * stop us from learning "safe to drop".
 */
export const HARM_RATE_PROTECT = 0.25;

// ─── shapes ───────────────────────────────────────────────────────────────

/** A learned deferability verdict for one bucket. */
export type LearnedDeferability = 'ok-to-defer' | 'protect' | 'unknown';

/**
 * The minimal per-bucket observation summary the native side computes from the
 * raw event tables and feeds in. Pure: no timestamps required for the verdict
 * itself — the caller decides any recency windowing when it groups the rows.
 */
export interface BucketObservations {
  /** How many times she chose to defer something in THIS bucket. */
  deferCount: number;
  /**
   * How many of those deferrals are linked to a real harm event (a spoiled
   * item / late bill / missed deadline tied to this bucket). 0 ≤ harmCount ≤
   * deferCount — a defer that caused harm is the strongest "protect" signal.
   */
  harmCount: number;
}

/** A learned verdict plus the evidence behind it (kept for introspection). */
export interface LearnedVerdict {
  deferability: LearnedDeferability;
  /** 0…1 — how trusted this verdict is. 0 when 'unknown'. */
  confidence: number;
  /** The deferCount the verdict was computed from (the sample size). */
  sampleSize: number;
  /** Observed harm rate (harmCount / deferCount), 0 when no defers. */
  harmRate: number;
}

// ─── the verdict ──────────────────────────────────────────────────────────

/**
 * Learn one bucket's verdict from its observation summary. Pure + total —
 * never throws.
 *
 * Logic (Serra-locked):
 *   - below MIN_SAMPLE defers              → 'unknown' (caller falls back)
 *   - enough defers, harmRate ≥ threshold  → 'protect'  (deferring hurt her)
 *   - enough defers, harmRate < threshold  → 'ok-to-defer' (safe to let rest)
 *
 * Confidence grows with sample size past the threshold (a gentle saturating
 * curve) and is higher the further the harm rate sits from the decision edge.
 * Confidence is only meaningful when the verdict is trusted; 'unknown' → 0.
 */
export function learnBucket(obs: BucketObservations): LearnedVerdict {
  const deferCount = Math.max(0, Math.floor(num(obs?.deferCount)));
  const harmCount = clampInt(num(obs?.harmCount), 0, deferCount);
  const harmRate = deferCount > 0 ? harmCount / deferCount : 0;

  if (deferCount < MIN_SAMPLE) {
    return { deferability: 'unknown', confidence: 0, sampleSize: deferCount, harmRate };
  }

  // How much past the threshold the sample is → a saturating sample-confidence
  // in [0,1): at exactly MIN_SAMPLE it's modest; it climbs toward 1 with more.
  const sampleConf = 1 - MIN_SAMPLE / (deferCount + 1);

  if (harmRate >= HARM_RATE_PROTECT) {
    // protect — distance ABOVE the edge sharpens confidence.
    const edge = (harmRate - HARM_RATE_PROTECT) / (1 - HARM_RATE_PROTECT);
    return {
      deferability: 'protect',
      confidence: round(sampleConf * (0.5 + 0.5 * edge)),
      sampleSize: deferCount,
      harmRate,
    };
  }

  // ok-to-defer — distance BELOW the edge (toward zero harm) sharpens it.
  const edge = (HARM_RATE_PROTECT - harmRate) / HARM_RATE_PROTECT;
  return {
    deferability: 'ok-to-defer',
    confidence: round(sampleConf * (0.5 + 0.5 * edge)),
    sampleSize: deferCount,
    harmRate,
  };
}

// ─── coarse→fine resolution (DECISION 1) ──────────────────────────────────

/**
 * A user pin (DECISION 4) — a correction that WINS over everything. Stored per
 * bucket on the native side; this is just the read shape.
 */
export type Pin = 'protect' | 'ok-to-defer';

/**
 * The map the selector consults: per-bucket learned verdicts at both
 * granularities, plus any user pins. Keys are bucket ids the caller chose (the
 * native side keys category-level by the cold-start category, and finer by
 * `${category}:${item}` or a task-type). Lookups are exact-string.
 */
export interface LearnedMap {
  /** Learned verdict per bucket key (both coarse + fine keys live here). */
  verdicts: Record<string, LearnedVerdict>;
  /** User pins per bucket key — override everything. */
  pins?: Record<string, Pin>;
}

/**
 * The fully-resolved deferability decision for a candidate, after applying the
 * Serra-locked resolution order. `source` says which layer won (for tests +
 * introspection); `deferability` is null when nothing learned/pinned applied
 * and the caller should keep its cold-start default.
 */
export interface ResolvedDeferability {
  deferability: LearnedDeferability | null;
  source: 'pin' | 'learned-fine' | 'learned-coarse' | 'cold-start';
}

/**
 * Resolve a candidate's deferability against the learned map, honouring the
 * full Serra-locked order:
 *
 *   USER PIN  >  learned FINE (if confident)  >  learned COARSE (if confident)
 *             >  cold-start (caller's default)
 *
 * Pins are checked finest-first too (a pin on the specific item beats a pin on
 * the category). A learned verdict only wins when it is trusted — i.e. not
 * 'unknown' (below-threshold buckets resolve to 'unknown' and are skipped, so a
 * thin fine bucket correctly falls through to the coarse bucket, then to
 * cold-start). Pure + total.
 *
 * @param fineKey   the finer bucket key (e.g. `groceries:milk`), or null/'' if
 *                  this candidate has no finer granularity.
 * @param coarseKey the coarse/category bucket key (e.g. `groceries`).
 */
export function resolveDeferability(
  map: LearnedMap | null | undefined,
  fineKey: string | null | undefined,
  coarseKey: string | null | undefined,
): ResolvedDeferability {
  const verdicts = map?.verdicts ?? {};
  const pins = map?.pins ?? {};

  const fine = (fineKey ?? '').toString();
  const coarse = (coarseKey ?? '').toString();

  // 1. USER PIN — finest-first, wins over everything.
  if (fine && pins[fine]) return { deferability: pins[fine], source: 'pin' };
  if (coarse && pins[coarse]) return { deferability: pins[coarse], source: 'pin' };

  // 2. learned FINE — only if it's a trusted (non-'unknown') verdict.
  if (fine) {
    const v = verdicts[fine];
    if (v && v.deferability !== 'unknown') {
      return { deferability: v.deferability, source: 'learned-fine' };
    }
  }

  // 3. learned COARSE — same trust gate.
  if (coarse) {
    const v = verdicts[coarse];
    if (v && v.deferability !== 'unknown') {
      return { deferability: v.deferability, source: 'learned-coarse' };
    }
  }

  // 4. nothing applied — caller keeps its cold-start default.
  return { deferability: null, source: 'cold-start' };
}

/**
 * Map a learned/pinned verdict onto the numeric deferability scale select.ts
 * scores on (0 = protect … 1 = freely defer). Returns null for 'unknown'/null
 * so the caller keeps its cold-start number. The 0.5 NEUTRAL midpoint is never
 * produced here — a learned verdict is always a clear protect/ok-to-defer.
 */
export function verdictToDeferability(
  deferability: LearnedDeferability | null | undefined,
): number | null {
  if (deferability === 'protect') return 0;
  if (deferability === 'ok-to-defer') return 1;
  return null;
}

// ─── tiny helpers ─────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
