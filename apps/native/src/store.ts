/**
 * apps/native · store singleton + orchestrator boot
 *
 * The Tauri shell runs a WebView, so the same browserAdapter the web app
 * uses (localStorage-backed) is the correct store adapter here. A single
 * module-scope singleton survives React.StrictMode double-invoke and HMR.
 *
 * Boot order (mirrors apps/web/src/store.ts):
 *   1. runMigrations against the adapter
 *   2. createStore(browserAdapter)
 *   3. createOrchestrator(store, { cadenceSources }) → init()
 *
 * Cadence sources today: all 11 native modules — grocery / body / habits
 * (initial trio) plus sleep / pets / finance / work / goals / admin /
 * cycle / medication (this commit). Each module's `enumerateCadences`
 * barrel export yields its own CadenceTrackedEntry stream.
 *
 * scheduleNotification is intentionally NOT injected yet — APNs wiring
 * lives behind the Tauri push plugin which is a separate milestone. Until
 * then the cadence scanner falls back to its in-app notify() surface
 * (@ollie/notifications), which is the correct dogfood path: DevTools
 * log + in-app toast, no server APNs round trip.
 */

import {
  browserAdapter,
  createStore,
  runMigrations,
} from '@ollie/store';
import {
  createOrchestrator,
  pickCopyVariant,
  DEFAULT_CADENCE_COPY,
  type CadenceTrackedEntry,
  type CadenceSourceFn,
} from '@ollie/orchestrator';
import { isOverdue } from '@ollie/cadence';
import { enumerateCadences as enumerateGrocery } from './modules/grocery';
import { enumerateCadences as enumerateBody } from './modules/body';
import { enumerateCadences as enumerateHabits } from './modules/habits';
import { enumerateCadences as enumerateSleep } from './modules/sleep';
import { enumerateCadences as enumeratePets } from './modules/pets';
import { enumerateCadences as enumerateFinance } from './modules/finance';
import { enumerateCadences as enumerateWork } from './modules/work';
import { enumerateCadences as enumerateGoals } from './modules/goals';
import { enumerateCadences as enumerateAdmin } from './modules/admin';
import { enumerateCadences as enumerateCycle } from './modules/cycle';
import { enumerateCadences as enumerateMedication } from './modules/medication';

runMigrations(browserAdapter);
export const store = createStore(browserAdapter);

/**
 * Dev-only wrapper around an enumerateCadences adapter. Passes entries
 * through unchanged, but logs each one that is currently overdue (i.e.
 * the entries the scanner is about to fire on this tick, modulo dedupe).
 *
 * `import.meta.env.DEV` is Vite-injected — false in production builds,
 * so the wrapper is a true no-op overhead in shipped binaries.
 */
function withDevLog(module: string, fn: CadenceSourceFn): CadenceSourceFn {
  if (!import.meta.env.DEV) return fn;
  return async () => {
    const entries = await fn();
    const now = Date.now();
    const templates = DEFAULT_CADENCE_COPY[module];
    for (const entry of entries) {
      if (isOverdue(entry.estimate, now) !== true) continue;
      const label = entry.label ?? entry.key;
      const copy = templates
        ? pickCopyVariant(templates, entry.module, entry.key, label).title
        : label;
      // eslint-disable-next-line no-console
      console.log(`[cadence] overdue ${entry.module}:${entry.key} → "${copy}"`);
    }
    return entries;
  };
}

const cadenceSources: Record<string, CadenceSourceFn> = {
  grocery: withDevLog('grocery', enumerateGrocery),
  body: withDevLog('body', enumerateBody),
  habits: withDevLog('habits', enumerateHabits),
  sleep: withDevLog('sleep', enumerateSleep),
  pets: withDevLog('pets', enumeratePets),
  finance: withDevLog('finance', enumerateFinance),
  work: withDevLog('work', enumerateWork),
  goals: withDevLog('goals', enumerateGoals),
  admin: withDevLog('admin', enumerateAdmin),
  cycle: withDevLog('cycle', enumerateCycle),
  medication: withDevLog('medication', enumerateMedication),
};

export const orchestrator = createOrchestrator(store, { cadenceSources });
orchestrator.init();

if (typeof window !== 'undefined') {
  // Tauri windows fire `beforeunload` on app quit / dev-server reload —
  // this lets the scanner cancel its boot timer / interval / visibility
  // listener cleanly so HMR doesn't accrete duplicate timers.
  window.addEventListener('beforeunload', () => {
    orchestrator.teardown();
  });
}

// Re-exports for the rest of the app — components import from here, not
// from @ollie/store / @ollie/orchestrator directly.
export type { CadenceTrackedEntry };
