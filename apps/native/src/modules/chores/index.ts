/**
 * Chores module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { chores as choresRepo, cadence as cadenceRepo } from './repo';

export { choresHandler } from './handler';
export { migrateChores } from './migrate';
export { chores, cadence, isChoreDue } from './repo';
export { ChoresBox } from './ChoresBox';
export type { Chore, ChoreCompletion, ChoreKind } from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per chore in the
 * registry — the scanner decides which are overdue (via @ollie/cadence's
 * isOverdue over the observed completion cadence) + dispatches the
 * notification. Caller (app boot) wires this into the root orchestrator via
 * `cadenceSources.chores`.
 *
 * We surface ALL chores (not just recurring) — a one-off the user keeps redoing
 * will accumulate completions and grow its own observed cadence, at which point
 * the scanner can gently surface it. Low-data chores yield a 'low-data' estimate
 * that isOverdue() returns null for, so they stay silent until there's signal.
 *
 * Failure mode: a per-chore cadence read that throws is swallowed; the scan
 * continues with the remaining chores.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const items = await choresRepo.list();
  const out: CadenceTrackedEntry[] = [];
  for (const chore of items) {
    try {
      const estimate = await cadenceRepo.getCadenceFor(chore.name);
      out.push({
        module: 'chores',
        key: chore.name,
        label: chore.name,
        estimate,
      });
    } catch {
      /* skip a single broken row, don't kill the scan */
    }
  }
  return out;
}
