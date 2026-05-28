/**
 * Habits module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { registry, cadence as cadenceRepo } from './repo';

export { habitsHandler } from './handler';
export { migrateHabits } from './migrate';
export { registry, completions, events, cadence, listHabitRows, computeStreak } from './repo';
export { HabitsBox } from './HabitsBox';
export type {
  Habit,
  HabitCompletion,
  HabitEvent,
  HabitEventKind,
  HabitRow,
  IdentityData,
  StreakBreakData,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per registered
 * habit. The label is the habit's display name (used in notification
 * copy); the key is the habit id so renames don't break dedupe across
 * days.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const habits = await registry.list();
  const out: CadenceTrackedEntry[] = [];
  for (const habit of habits) {
    try {
      const estimate = await cadenceRepo.getCompletionCadenceForId(habit.id);
      out.push({
        module: 'habits',
        key: habit.id,
        label: habit.name,
        estimate,
      });
    } catch {
      /* skip one broken habit, keep scanning */
    }
  }
  return out;
}
