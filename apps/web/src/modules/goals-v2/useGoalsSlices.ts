/**
 * goals-v2 · useGoalsSlices — live store bridge
 *
 * Subscribes to the EXISTING `goals.*` slices (the same keys the live
 * `GoalsModule` reads + writes) and returns them as one `GoalsSlices`
 * object for the v2 selectors. Read-only here; mutations go through
 * `useGoalsActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes. Mirrors
 * admin-v2/useAdminSlices.ts.
 *
 *   - `goals.items`    — the goal list (source of truth)
 *   - `goals.sessions` — thinking / doing session tags (velocity input)
 *   - `goals.reviews`  — weekly check-ins (sunk-cost + drift input)
 *   - `goals.dumps`    — dump entries scanned by the echo detectors
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type { GoalSession, GoalReview, DumpEntry } from '@ollie/logic/goals';
import type { GoalsSlices, GoalItem } from './selectors';

export function useGoalsSlices(): GoalsSlices {
  const [goals] = useStoreSlice<GoalItem[]>('goals', 'items', []);
  const [sessions] = useStoreSlice<GoalSession[]>('goals', 'sessions', []);
  const [reviews] = useStoreSlice<GoalReview[]>('goals', 'reviews', []);
  const [dumps] = useStoreSlice<DumpEntry[]>('goals', 'dumps', []);

  return useMemo<GoalsSlices>(
    () => ({
      goals: Array.isArray(goals)
        ? goals.filter((g): g is GoalItem => Boolean(g) && typeof g === 'object')
        : [],
      sessions: Array.isArray(sessions)
        ? sessions.filter((s): s is GoalSession => Boolean(s) && typeof s === 'object')
        : [],
      reviews: Array.isArray(reviews)
        ? reviews.filter((r): r is GoalReview => Boolean(r) && typeof r === 'object')
        : [],
      dumps: Array.isArray(dumps)
        ? dumps.filter((d): d is DumpEntry => Boolean(d) && typeof d === 'object')
        : [],
    }),
    [goals, sessions, reviews, dumps],
  );
}
