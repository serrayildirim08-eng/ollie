/**
 * Goals module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { goals as goalsRepo, cadence as cadenceRepo } from './repo';

export { goalsHandler } from './handler';
export { migrateGoals } from './migrate';
export { goals, events, cadence } from './repo';
export { GoalsBox } from './GoalsBox';
export type { Goal, GoalEvent, GoalEventKind, GoalWithLatest } from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per registered
 * goal. Key is goal id (stable across renames); label is the goal name
 * which is what the copy template renders ("${name} — last touched a
 * while ago").
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await goalsRepo.list();
  const out: CadenceTrackedEntry[] = [];
  for (const goal of list) {
    try {
      const estimate = await cadenceRepo.getProgressCadenceFor(goal.id);
      out.push({
        module: 'goals',
        key: goal.id,
        label: goal.name,
        estimate,
      });
    } catch {
      /* skip one broken goal, keep scanning */
    }
  }
  return out;
}
