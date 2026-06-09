/**
 * Work module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { tasks as tasksRepo, cadence as cadenceRepo } from './repo';

export { workHandler } from './handler';
export { migrateWork } from './migrate';
export { tasks, events, cadence } from './repo';
export { WorkBox } from './WorkBox';
export type {
  WorkTask,
  WorkTaskKind,
  WorkEvent,
  WorkEventKind,
  WorkEventData,
  FocusSessionData,
  MeetingData,
  DistractionData,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per distinct
 * task text — `getTaskCadenceFor` reads the same normalised key the
 * writer dedupes on, so a recurring chore ("send invoice", "weekly
 * check-in") carries a real gap-between-completions series.
 *
 * Tasks with empty text after normalisation are skipped — they can't
 * collapse into a usable cadence series.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await tasksRepo.list();
  const seen = new Set<string>();
  const out: CadenceTrackedEntry[] = [];
  for (const task of list) {
    const key = task.text.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const estimate = await cadenceRepo.getTaskCadenceFor(key);
      out.push({
        module: 'work',
        key,
        label: task.project ?? key,
        estimate,
      });
    } catch {
      /* skip one broken task, keep scanning */
    }
  }
  return out;
}
