/**
 * goals-v2 · useGoalsActions — write bridge
 *
 * The handful of mutations the v2 goals screens perform, written through
 * the SAME `goals.*` store keys + row shapes the live `GoalsModule` uses. A
 * goal added, a milestone toggled, a goal parked / dropped, a check-in
 * recorded through the v2 preview is visible to the live module and
 * vice-versa — they share one goals store.
 *
 *   - `addGoal` mirrors `GoalsModule.save` — a new `goals.items` row with
 *     `id`/`title`/`label`/`category`/`status: 'active'`/`created_at`.
 *   - `toggleMilestone` mirrors `GoalsModule.toggleMilestone` — flips a
 *     milestone's `completed_at` and recomputes the parent `progress` from
 *     `done / total`, exactly the live module's rule.
 *   - `setStatus` mirrors `GoalsModule.setStatus` — sets `status` +
 *     `status_at`. Used for park (`paused`) and drop (`dropped`).
 *   - `addReview` mirrors `GoalsModule.tagReview` — a `goals.reviews` row
 *     with `goal_id`/`alive_flag`/`ts`.
 *
 * Every write is non-shaming by construction: there is no "abandon", no
 * "fail" — a parked or dropped goal is a valid, unshamed status.
 */
import { useCallback } from 'react';
import type { GoalCategory } from '@ollie/logic/goals';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import type { GoalItem } from './selectors';
import type { GoalReview } from '@ollie/logic/goals';

/** the draft an add-screen commit hands `addGoal` */
export interface GoalDraft {
  name: string;
  category: GoalCategory | null;
}

export interface GoalsActions {
  /** add a new goal; returns the created row's id, or null */
  addGoal: (draft: GoalDraft) => string | null;
  /** toggle a milestone done/open; recomputes the parent goal's progress */
  toggleMilestone: (goalId: string, milestoneId: string) => void;
  /** set a goal's status (used for 'paused' = park, 'dropped' = let go) */
  setStatus: (goalId: string, status: string) => void;
  /** record a soft check-in for a goal */
  addReview: (goalId: string, aliveFlag: 'want' | 'invested', note: string) => void;
}

/** strip the few HTML-significant chars, like the live module's `sanitize` */
function sanitize(s: string): string {
  const map: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[<>&"']/g, (c) => map[c] ?? c);
}

export function useGoalsActions(now: number): GoalsActions {
  const [goals, setGoals] = useStoreSlice<GoalItem[]>('goals', 'items', []);
  const [reviews, setReviews] = useStoreSlice<GoalReview[]>('goals', 'reviews', []);

  const goalList = useCallback(
    () => (Array.isArray(goals) ? goals : []),
    [goals],
  );

  const addGoal = useCallback(
    (draft: GoalDraft): string | null => {
      const name = draft.name.trim();
      if (!name) return null;
      const id = mkId('goal');
      const safe = sanitize(name);
      const row: GoalItem = {
        id,
        title: safe,
        label: safe,
        category: draft.category ?? undefined,
        status: 'active',
        status_at: now,
        created_at: now,
        milestones: [],
      };
      setGoals([...goalList(), row]);
      return id;
    },
    [goalList, setGoals, now],
  );

  const toggleMilestone = useCallback(
    (goalId: string, milestoneId: string) => {
      setGoals(
        goalList().map((g) => {
          if (!g || g.id !== goalId) return g;
          const next = (Array.isArray(g.milestones) ? g.milestones : []).map((m) =>
            m && m.id === milestoneId
              ? { ...m, completed_at: m.completed_at ? null : now }
              : m,
          );
          // recompute progress from milestones — the live module's rule
          const total = next.length;
          const done = next.filter((m) => m && m.completed_at).length;
          const progress = total > 0 ? Math.round((done / total) * 100) : g.progress;
          return { ...g, milestones: next, progress };
        }),
      );
    },
    [goalList, setGoals, now],
  );

  const setStatus = useCallback(
    (goalId: string, status: string) => {
      setGoals(
        goalList().map((g) =>
          g && g.id === goalId ? { ...g, status, status_at: now } : g,
        ),
      );
    },
    [goalList, setGoals, now],
  );

  const addReview = useCallback(
    (goalId: string, aliveFlag: 'want' | 'invested', note: string) => {
      const list = Array.isArray(reviews) ? reviews : [];
      const row: GoalReview & { note?: string } = {
        goal_id: goalId,
        alive_flag: aliveFlag,
        ts: now,
      };
      const trimmed = note.trim();
      if (trimmed) row.note = sanitize(trimmed);
      setReviews([...list, row]);
    },
    [reviews, setReviews, now],
  );

  return { addGoal, toggleMilestone, setStatus, addReview };
}
