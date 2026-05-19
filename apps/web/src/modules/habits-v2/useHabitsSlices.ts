/**
 * habits-v2 · useHabitsSlices — live store bridge
 *
 * Subscribes to the EXISTING habits slices (the same keys the live
 * `HabitsModule` reads + writes) and returns them as one `HabitsSlices`
 * object for the v2 selectors. Read-only here; mutations go through
 * `useHabitsActions`.
 *
 *   - `shared.habits_v2` — the `StoredHabit[]` list. When the store is
 *     empty the live module falls back to its 6 seeded defaults; this
 *     bridge mirrors that exactly so the v2 cold-start face shows the
 *     SAME starting shape, not a blank page.
 *   - `habits.patterns` — the orchestrator-written noticed-patterns slice
 *     (the same one the live `HabitsNoticed` panel reads).
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes. Mirrors
 * medication-v2/useMedicationSlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import {
  DEFAULT_HABITS,
  type HabitsSlices,
  type StoredHabit,
  type PatternEntry,
} from './selectors';

export function useHabitsSlices(): HabitsSlices {
  const [habits] = useStoreSlice<StoredHabit[]>('shared', 'habits_v2', DEFAULT_HABITS);
  const [patterns] = useStoreSlice<PatternEntry[]>('habits', 'patterns', []);

  return useMemo<HabitsSlices>(() => {
    // mirror HabitsModule: an empty/missing list falls back to the 6 seeds
    const list =
      Array.isArray(habits) && habits.length > 0 ? habits : DEFAULT_HABITS;
    return {
      habits: list,
      patterns: Array.isArray(patterns) ? patterns : [],
    };
  }, [habits, patterns]);
}
