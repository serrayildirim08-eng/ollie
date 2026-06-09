/**
 * @ollie/cadence · recurring detection.
 *
 * Pure, no I/O. Given a stream of timestamped events grouped by a free-form
 * `key` (canonical merchant, habit id, med name, pet-feed type), this scans
 * for groups whose cadence median lines up with a known calendar cycle and
 * yields a `RecurringPattern` per qualifying group.
 *
 * The "what counts as recurring" rules live here so each module (finance,
 * habits, medication, pets) gets the same shape:
 *
 *   - At least `MIN_SAMPLES` events for the group (default 2). One spend
 *     isn't a pattern; two starts the conversation.
 *   - Cadence confidence ≥ 'observed' (so wildly irregular spreads demote
 *     themselves out — see @ollie/cadence STABLE_CV_THRESHOLD * 2 rule).
 *   - Median interval matches a known cycle within tolerance:
 *       weekly  =  7d ± 2d
 *       monthly = 30d ± 5d
 *       yearly  = 365d ± 15d
 *     The bands are tight enough that "every 14 days" doesn't get pulled
 *     into the weekly bucket and "every 200 days" doesn't get called
 *     yearly. Anything outside all three bands yields nothing.
 *
 * Callers control how the records map to `{ key, ts, amount? }` — finance
 * passes normalised merchant + occurredAt; habits would pass habit-id +
 * completedAt; medication would pass dose-name + takenAt. The `amount?`
 * field is optional and only forwarded for callers that want to surface a
 * median value (finance does, habits doesn't).
 *
 * This file has zero DB. Callers feed it sanitised events; we group by
 * key, compute cadence per group, classify, and return.
 */

import { computeCadence } from './index';
import type { CadenceConfidence } from './index';

// ─── public types ────────────────────────────────────────────────────────

/** A calendar cycle that detection will classify into. Module-agnostic. */
export type RecurringCycle = 'weekly' | 'monthly' | 'yearly';

/** One input event. `key` is the group label (already-canonicalised). */
export interface RecurringEvent {
  /** Pre-normalised group key — caller owns canonicalisation. */
  key: string;
  /** ms-since-epoch. */
  ts: number;
  /**
   * Optional amount — forwarded into the median calculation so finance can
   * surface "$X recurring". Pass `undefined` for non-monetary modules.
   */
  amount?: number | null;
}

/** One detected recurring group. */
export interface RecurringPattern {
  /** The group key passed in (already canonical). */
  key: string;
  /** Classified cycle — the median interval landed inside one of the bands. */
  cycle: RecurringCycle;
  /** Pass-through cadence confidence — 'observed' or 'stable'. */
  confidence: Exclude<CadenceConfidence, 'low-data'>;
  /** Number of events in this group. */
  sampleSize: number;
  /** Median interval in ms (straight from computeCadence). */
  medianIntervalMs: number;
  /**
   * Median of forwarded amounts, or null when no amounts were supplied or
   * every supplied amount was null. Robust to outliers (median, not mean).
   */
  medianAmount: number | null;
  /** Most recent event ts in the group. */
  lastTs: number;
}

// ─── tolerance bands ─────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cycle bands in ms. Tight enough that bi-weekly (14d) doesn't slide into
 * weekly, and quarterly (90d) doesn't slide into monthly. Outside all
 * bands → no pattern emitted.
 */
const CYCLE_BANDS: Array<{ cycle: RecurringCycle; centerMs: number; toleranceMs: number }> = [
  { cycle: 'weekly',  centerMs:  7 * DAY_MS, toleranceMs:  2 * DAY_MS },
  { cycle: 'monthly', centerMs: 30 * DAY_MS, toleranceMs:  5 * DAY_MS },
  { cycle: 'yearly',  centerMs: 365 * DAY_MS, toleranceMs: 15 * DAY_MS },
];

/** Minimum group size before we bother computing cadence. */
const MIN_SAMPLES = 2;

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Detect recurring patterns across a flat list of events.
 *
 * The caller already canonicalised `key` (lowercase, trimmed, etc.) — we
 * trust it as-is. Same-key events are grouped, cadence is computed per
 * group, and groups whose median interval matches a calendar cycle are
 * emitted as `RecurringPattern`.
 *
 * Returned patterns are sorted by lastTs DESC (most recently seen first) —
 * matches how UI surfaces typically want to display them.
 */
export function detectRecurring(events: RecurringEvent[]): RecurringPattern[] {
  // Group by key.
  const grouped = new Map<string, RecurringEvent[]>();
  for (const ev of events) {
    if (!ev || typeof ev.key !== 'string' || ev.key.length === 0) continue;
    const arr = grouped.get(ev.key);
    if (arr) arr.push(ev);
    else grouped.set(ev.key, [ev]);
  }

  const out: RecurringPattern[] = [];
  for (const [key, group] of grouped.entries()) {
    if (group.length < MIN_SAMPLES) continue;

    const estimate = computeCadence(
      group.map((g) => ({ ts: g.ts, label: key })),
    );

    // 'low-data' means too few samples OR wildly irregular — either way
    // we don't surface. 'observed' and 'stable' both qualify.
    if (estimate.confidence === 'low-data') continue;
    if (estimate.lastTs == null) continue;

    const cycle = classifyCycle(estimate.medianIntervalMs);
    if (cycle == null) continue;

    out.push({
      key,
      cycle,
      confidence: estimate.confidence,
      sampleSize: estimate.sampleSize,
      medianIntervalMs: estimate.medianIntervalMs,
      medianAmount: medianAmountOf(group),
      lastTs: estimate.lastTs,
    });
  }

  out.sort((a, b) => b.lastTs - a.lastTs);
  return out;
}

/**
 * Classify a median interval (ms) into a calendar cycle, or null when it
 * matches nothing. Exported because some callers want to test classification
 * against a precomputed interval without re-running detection.
 */
export function classifyCycle(medianMs: number): RecurringCycle | null {
  if (!Number.isFinite(medianMs) || medianMs <= 0) return null;
  for (const band of CYCLE_BANDS) {
    if (Math.abs(medianMs - band.centerMs) <= band.toleranceMs) {
      return band.cycle;
    }
  }
  return null;
}

// ─── private helpers ─────────────────────────────────────────────────────

function medianAmountOf(group: RecurringEvent[]): number | null {
  const values: number[] = [];
  for (const ev of group) {
    if (typeof ev.amount === 'number' && Number.isFinite(ev.amount)) {
      values.push(ev.amount);
    }
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid]!;
  return (values[mid - 1]! + values[mid]!) / 2;
}
