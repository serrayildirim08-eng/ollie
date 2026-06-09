/**
 * Cycle module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { cycleCadence } from './repo';

export { cycleHandler } from './handler';
export { migrateCycle } from './migrate';
export { cycleRepo, cycleCadence } from './repo';
export { CycleBox } from './CycleBox';
export type { CycleEvent, CycleEventKind, CurrentCycle } from './types';

/**
 * Cadence adapter for the CadenceScanner. Cycle emits a single 'period'
 * entry — the natural anchor is period-start → period-start. Label
 * stays "period" so the copy template substitutes a calm noun.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  try {
    const estimate = await cycleCadence.getPeriodCadence();
    return [
      {
        module: 'cycle',
        key: 'period',
        label: 'period',
        estimate,
      },
    ];
  } catch {
    return [];
  }
}
