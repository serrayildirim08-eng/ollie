/**
 * Sleep module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { cadence as cadenceRepo } from './repo';

export { sleepHandler } from './handler';
export { migrateSleep } from './migrate';
export { sleepRepo } from './repo';
export { cadence } from './repo';
export { SleepBox } from './SleepBox';
export type {
  DreamData,
  InsomniaData,
  SleepEvent,
  SleepKind,
  SleepLogData,
  WindDownData,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Sleep emits a single 'nightly'
 * entry — the user logs one sleep stream, not per-category. The scanner
 * uses the entry to decide if a nightly log was missed.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  try {
    const estimate = await cadenceRepo.getSleepLogCadence();
    return [
      {
        module: 'sleep',
        key: 'nightly',
        label: 'sleep',
        estimate,
      },
    ];
  } catch {
    return [];
  }
}
