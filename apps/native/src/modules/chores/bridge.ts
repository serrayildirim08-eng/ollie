/**
 * apps/native · modules/chores/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The chores Layer-2 watcher (packages/orchestrator/src/chores.ts) reads
 * `chores.registry` and emits a "chore due" offer for each recurring chore
 * whose cadence clock has rolled over. Native captures chores into SQLite
 * (chores/repo.ts) and never wrote the store keys, so the watcher ran on an
 * empty input. This bridge fills it.
 *
 * Store keys written (INPUT to the watcher — clean overwrite from the source
 * of truth):
 *   chores.registry — every chore row mapped to the orchestrator's
 *                     ChoreRecord shape ({ id, name, kind, cadenceDays,
 *                     lastDoneAt, done, createdAt }). LOAD-BEARING for the
 *                     cadence-due offer detector.
 *
 * NOT written here (OUTPUT the watcher owns — clobbering would erase the
 * detector results): chores.patterns, chores.patternsLastComputedAt.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import type { ChoreRecord } from '@ollie/orchestrator';
import { migrateChores } from './migrate';
import { chores } from './repo';

export async function syncToStore(store: Store): Promise<void> {
  await migrateChores();

  const rows = await chores.list();
  const registry: ChoreRecord[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    cadenceDays: c.cadenceDays,
    weekdays: c.weekdays,
    lastDoneAt: c.lastDoneAt,
    done: c.done,
    createdAt: c.createdAt,
  }));

  store.set<ChoreRecord[]>('chores', 'registry', registry);
}
