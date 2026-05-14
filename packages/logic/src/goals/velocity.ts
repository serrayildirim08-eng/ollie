/**
 * @ollie/logic · goals · velocity (audit task 15, 2026-05-14)
 *
 * Goal-completion velocity per category. Compares completion rates
 * across the 6 category buckets (career/relationship/health/finance/
 * learning/creative) over a rolling 90-day window.
 *
 * "Which category do you actually finish?" — surfaces the gap so the
 * orchestrator can prompt the user (e.g. "learning goals finish 2x
 * faster than career. flagging.").
 *
 * Pure: inputs → outputs, no DOM, no store reads, no Date.now() inside.
 *
 * Threshold: emit only when total >= 3 in a category (sub-sample is
 * noise). Completion = status === 'done' or status === 'completed'.
 * Completion timestamp source: status_at (changed-to ts) → fallback
 * to last_activity_at → created_at. days_to_complete is clamped to
 * a non-negative integer.
 */

import { resolveNow } from './helpers';
import { SOURCES } from './sources';
import type {
  GoalsHistory,
  GoalsOpts,
  Goal,
  GoalCategory,
  PatternSource,
} from './types';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_MIN_SAMPLE = 3;

const COMPLETED_STATUSES = new Set(['done', 'completed']);

function completionTs(g: Goal): number | undefined {
  if (typeof g.status_at === 'number' && g.status_at > 0) return g.status_at;
  if (typeof g.last_activity_at === 'number' && g.last_activity_at > 0) {
    return g.last_activity_at;
  }
  if (typeof g.created_at === 'number' && g.created_at > 0) return g.created_at;
  return undefined;
}

export interface VelocityCategoryStat {
  category: GoalCategory;
  total: number;
  completed: number;
  velocity: number;            // completed / total, 0..1
  avg_days_to_complete: number; // 0 when completed === 0
}

export interface VelocityPatternSignal {
  signal: 'goals_velocity_pattern';
  category: GoalCategory;
  total: number;
  completed: number;
  velocity: number;
  avg_days_to_complete: number;
  /** Optional companion: best/worst category from the same scan. */
  top_category?: GoalCategory;
  bottom_category?: GoalCategory;
  /** Ratio (top_velocity / bottom_velocity) — undefined when only one cat. */
  velocity_gap?: number;
  evidence: string[];
  copy: string;
  copy_es: string;
  sources: PatternSource[];
  ts: number;
}

export interface VelocityOpts extends GoalsOpts {
  /** Override the 90d window. */
  velocityWindowDays?: number;
  /** Override the per-category min sample (default 3). */
  velocityMinSample?: number;
}

/**
 * Compute velocity stats per category. Pure helper exposed for tests
 * and for the orchestrator's notification gate (2x-gap check).
 */
export function computeVelocityByCategory(
  history: GoalsHistory | null | undefined,
  opts?: VelocityOpts | null,
): VelocityCategoryStat[] {
  const now = resolveNow(history, opts);
  const windowDays = typeof opts?.velocityWindowDays === 'number'
    ? opts.velocityWindowDays
    : DEFAULT_WINDOW_DAYS;
  const minSample = typeof opts?.velocityMinSample === 'number'
    ? opts.velocityMinSample
    : DEFAULT_MIN_SAMPLE;

  const windowStart = now - windowDays * DAY_MS;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  if (goals.length === 0) return [];

  // Bucket goals by category. Anything uncategorized is skipped — we
  // can't compute per-category velocity without a category.
  const byCat = new Map<GoalCategory, { total: number; completed: number; sumDays: number }>();

  for (const g of goals) {
    if (!g || typeof g !== 'object') continue;
    const cat = g.category;
    if (!cat) continue;
    // Window gate: goal must have been *created* inside the window.
    // (Goals from years ago shouldn't dominate the 90d snapshot.)
    if (typeof g.created_at !== 'number' || g.created_at < windowStart || g.created_at > now) {
      continue;
    }

    const bucket = byCat.get(cat) ?? { total: 0, completed: 0, sumDays: 0 };
    bucket.total += 1;

    const status = typeof g.status === 'string' ? g.status : '';
    if (COMPLETED_STATUSES.has(status)) {
      const compTs = completionTs(g);
      if (typeof compTs === 'number' && compTs >= g.created_at) {
        bucket.completed += 1;
        // Clamp to int days; floor so a sub-day completion = 0d, not 1d.
        const days = Math.max(0, Math.floor((compTs - g.created_at) / DAY_MS));
        bucket.sumDays += days;
      }
    }
    byCat.set(cat, bucket);
  }

  const out: VelocityCategoryStat[] = [];
  for (const [category, b] of byCat) {
    if (b.total < minSample) continue;
    const velocity = b.completed / b.total;
    const avg_days_to_complete = b.completed === 0
      ? 0
      : Math.round((b.sumDays / b.completed) * 10) / 10;
    out.push({
      category,
      total: b.total,
      completed: b.completed,
      velocity: Math.round(velocity * 100) / 100,
      avg_days_to_complete,
    });
  }

  // Deterministic order: highest velocity first, then category alpha.
  out.sort((a, b) => {
    if (b.velocity !== a.velocity) return b.velocity - a.velocity;
    return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
  });

  return out;
}

/**
 * Detector entrypoint. Returns one VelocityPatternSignal per category
 * that has >= minSample goals in the window. Returns null when nothing
 * to emit (no goals, all sub-threshold, or no categorized rows).
 *
 * The orchestrator subscribes to these patterns and may dispatch a
 * notification when the gap between top + bottom velocity is >= 2x.
 */
export function detectGoalVelocityByCategory(
  history: GoalsHistory | null | undefined,
  opts?: VelocityOpts | null,
): VelocityPatternSignal[] | null {
  // Consent gate mirrors the rest of phase1/2/3. Default true.
  if (opts && typeof opts.consent === 'boolean' && !opts.consent) return null;

  const now = resolveNow(history, opts);
  const stats = computeVelocityByCategory(history, opts);
  if (stats.length === 0) return null;

  // Best/worst from the same scan. When only one category passes
  // threshold, top===bottom and gap is undefined.
  const top = stats[0];
  const bottom = stats[stats.length - 1];
  const gap = (top.velocity > 0 && bottom.velocity > 0 && top !== bottom)
    ? Math.round((top.velocity / bottom.velocity) * 100) / 100
    : undefined;

  const windowDays = typeof opts?.velocityWindowDays === 'number'
    ? opts.velocityWindowDays
    : DEFAULT_WINDOW_DAYS;

  const out: VelocityPatternSignal[] = [];
  for (const s of stats) {
    const pct = Math.round(s.velocity * 100);
    const copy =
      `${s.category} goals — ${s.completed}/${s.total} done (${pct}%)` +
      (s.completed > 0 ? `, avg ${s.avg_days_to_complete}d.` : '.');
    const copy_es =
      `objetivos de ${s.category} — ${s.completed}/${s.total} hechos (${pct}%)` +
      (s.completed > 0 ? `, media ${s.avg_days_to_complete}d.` : '.');

    out.push({
      signal: 'goals_velocity_pattern',
      category: s.category,
      total: s.total,
      completed: s.completed,
      velocity: s.velocity,
      avg_days_to_complete: s.avg_days_to_complete,
      top_category: top.category,
      bottom_category: bottom.category,
      velocity_gap: gap,
      evidence: [
        `category:${s.category}`,
        `total:${s.total}`,
        `completed:${s.completed}`,
        `velocity:${s.velocity}`,
        `window_days:${windowDays}`,
      ],
      copy,
      copy_es,
      sources: [SOURCES.steel],
      ts: now,
    });
  }

  return out;
}
