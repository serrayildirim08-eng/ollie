/**
 * apps/native · bridge/index.ts  —  the great-rewiring runner
 *
 * The native app captures into SQLite (per-module repo.ts). Every Layer-2
 * watcher in packages/orchestrator reads the OLD @ollie/store keys instead.
 * Each module owns a `bridge.ts` that mirrors its SQLite rows → its store
 * keys. This runner fans out to all 12 so the watchers see live data.
 *
 * `runAllSyncs` is called (a) once on boot and (b) after each dump dispatch,
 * so freshly-captured data is mirrored before the next watcher tick. Each
 * module's syncToStore is wrapped in try/catch — one module's failure can
 * never starve the other eleven, and never throws into the dispatch path.
 *
 * Module agents: edit ONLY your own modules/<m>/bridge.ts. This file just
 * fans out; do not add per-module logic here.
 */

import type { Store } from '@ollie/store';

import { syncToStore as syncSleep } from '../modules/sleep/bridge';
import { syncToStore as syncBody } from '../modules/body/bridge';
import { syncToStore as syncCycle } from '../modules/cycle/bridge';
import { syncToStore as syncHabits } from '../modules/habits/bridge';
import { syncToStore as syncWork } from '../modules/work/bridge';
import { syncToStore as syncGoals } from '../modules/goals/bridge';
import { syncToStore as syncFinance } from '../modules/finance/bridge';
import { syncToStore as syncAdmin } from '../modules/admin/bridge';
import { syncToStore as syncPets } from '../modules/pets/bridge';
import { syncToStore as syncGrocery } from '../modules/grocery/bridge';
import { syncToStore as syncMedication } from '../modules/medication/bridge';
import { syncToStore as syncDump } from '../modules/dump/bridge';
import { syncToStore as syncMood } from '../modules/mood/bridge';

type NamedSync = readonly [module: string, fn: (store: Store) => Promise<void>];

const SYNCS: readonly NamedSync[] = [
  ['sleep', syncSleep],
  ['body', syncBody],
  ['cycle', syncCycle],
  ['habits', syncHabits],
  ['work', syncWork],
  ['goals', syncGoals],
  ['finance', syncFinance],
  ['admin', syncAdmin],
  ['pets', syncPets],
  ['grocery', syncGrocery],
  ['medication', syncMedication],
  ['mood', syncMood],
  ['dump', syncDump],
];

/**
 * Mirror module SQLite captures into the @ollie/store keys their watchers
 * read. Each sync is isolated so one failure can't break the others, and the
 * whole call resolves rather than rejects — safe to fire-and-forget or await.
 *
 * Always fans out to ALL modules — deliberately NOT scoped to a dump's touched
 * modules. In-app capture UIs write SQLite without mirroring to the store (e.g.
 * FocusTimer → work/repo.ts addFocus inserts an event only), and their
 * syncToStore runs ONLY here + at boot. The all-modules sweep is therefore the
 * safety net that mirrors those in-app captures on the next dump of any kind; a
 * touched-only scope would leave them stale and silently darken their watchers
 * (the "great disconnect" this bridge exists to fix). It's cheap regardless:
 * store.set no-ops on deep-equal values, so unchanged modules cause zero
 * watcher churn. Speed is achieved by the dispatch caller firing this
 * non-blocking, not by narrowing the set.
 */
export async function runAllSyncs(store: Store): Promise<void> {
  await Promise.all(
    SYNCS.map(async ([module, fn]) => {
      try {
        await fn(store);
      } catch (err) {
         
        console.error(`[bridge] ${module} syncToStore failed (non-fatal):`, err);
      }
    }),
  );
}
