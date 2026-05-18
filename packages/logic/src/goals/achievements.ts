/**
 * @ollie/logic · goals · achievement gallery (Phase 3 · feature 4)
 *
 * Read-only query helper over the existing goals.items slice. Goals
 * already carry everything needed — `status` ('done' | 'graveyard' |
 * ...), `status_at` (last status-change ts), `created_at`, `category`.
 * No new storage, no migration: the gallery is a projection.
 *
 * "Achievement" = a goal the user actually finished. We treat status
 * 'done' and 'completed' as wins. Graveyard goals are buried, not
 * achieved, so they are excluded by default (the UI has its own
 * graveyard filter).
 *
 * Pure: inputs → outputs. No DOM, no store reads, no Date.now() inside.
 */

import type { Goal, GoalCategory } from './types';

import { DAY_MS } from '../util';

/** Statuses that count as a finished, celebrate-worthy goal. */
const ACHIEVED_STATUSES = new Set(['done', 'completed']);

export interface AchievementItem {
  /** Source goal id. */
  id: string;
  /** Display label (label → title → id fallback). */
  title: string;
  /** Optional category bucket. */
  category?: GoalCategory;
  /**
   * ms epoch the goal was completed. Resolution order:
   * status_at → last_activity_at → created_at. May be undefined when
   * none are present (very old / malformed rows).
   */
  completed_at?: number;
  /** ms epoch the goal was created, when known. */
  created_at?: number;
  /**
   * Whole days from creation to completion. Undefined when either
   * timestamp is missing. Clamped to ≥ 0.
   */
  days_to_complete?: number;
}

export interface AchievementGalleryOptions {
  /** Restrict to a single category bucket. */
  category?: GoalCategory;
  /** Only goals completed at/after this ms epoch. */
  since?: number;
  /**
   * 'recent'   — newest completion first (default).
   * 'oldest'   — oldest completion first.
   * 'category' — grouped by category alpha, then recent within group.
   */
  sort?: 'recent' | 'oldest' | 'category';
}

export interface AchievementGallery {
  /** Flat, sorted achievement list. */
  items: AchievementItem[];
  /** Total achievements (after `since` / `category` filters). */
  total: number;
  /** Count per category — only categories with ≥ 1 achievement appear. */
  by_category: Partial<Record<GoalCategory, number>>;
}

function resolveTitle(g: Goal): string {
  return (
    (typeof g.label === 'string' && g.label.trim()) ||
    (typeof g.title === 'string' && g.title.trim()) ||
    g.id
  );
}

function resolveCompletedAt(g: Goal): number | undefined {
  if (typeof g.status_at === 'number' && g.status_at > 0) return g.status_at;
  if (typeof g.last_activity_at === 'number' && g.last_activity_at > 0) {
    return g.last_activity_at;
  }
  if (typeof g.created_at === 'number' && g.created_at > 0) return g.created_at;
  return undefined;
}

/** True when a goal counts as a finished achievement. */
export function isAchievedGoal(g: Goal | null | undefined): boolean {
  if (!g || typeof g !== 'object') return false;
  const status = typeof g.status === 'string' ? g.status : '';
  return ACHIEVED_STATUSES.has(status);
}

/**
 * Project the goals list into an achievement gallery. Verifies that
 * completed goals are queryable + persisted — the gallery is purely a
 * read over goals.items, so nothing extra has to be stored.
 */
export function buildAchievementGallery(
  goals: Goal[] | null | undefined,
  opts: AchievementGalleryOptions = {},
): AchievementGallery {
  const list = Array.isArray(goals) ? goals : [];
  const sort = opts.sort ?? 'recent';

  const items: AchievementItem[] = [];
  for (const g of list) {
    if (!isAchievedGoal(g)) continue;
    if (opts.category && g.category !== opts.category) continue;

    const completedAt = resolveCompletedAt(g);
    if (typeof opts.since === 'number') {
      if (typeof completedAt !== 'number' || completedAt < opts.since) continue;
    }

    let daysToComplete: number | undefined;
    if (
      typeof completedAt === 'number' &&
      typeof g.created_at === 'number' &&
      completedAt >= g.created_at
    ) {
      daysToComplete = Math.max(
        0,
        Math.floor((completedAt - g.created_at) / DAY_MS),
      );
    }

    items.push({
      id: g.id,
      title: resolveTitle(g),
      category: g.category,
      completed_at: completedAt,
      created_at: typeof g.created_at === 'number' ? g.created_at : undefined,
      days_to_complete: daysToComplete,
    });
  }

  // Sort. Rows missing completed_at sink to the end of time-based sorts.
  const ts = (i: AchievementItem): number => i.completed_at ?? -Infinity;
  if (sort === 'oldest') {
    items.sort((a, b) => ts(a) - ts(b));
  } else if (sort === 'category') {
    items.sort((a, b) => {
      const ca = a.category ?? '';
      const cb = b.category ?? '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return ts(b) - ts(a);
    });
  } else {
    items.sort((a, b) => ts(b) - ts(a)); // 'recent'
  }

  const byCategory: Partial<Record<GoalCategory, number>> = {};
  for (const i of items) {
    if (!i.category) continue;
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
  }

  return { items, total: items.length, by_category: byCategory };
}
