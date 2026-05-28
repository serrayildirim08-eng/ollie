/**
 * Admin module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { renewals as renewalsRepo, cadence as cadenceRepo } from './repo';

export { adminHandler } from './handler';
export { migrateAdmin } from './migrate';
export { renewals, tasks, cadence } from './repo';
export { AdminBox } from './AdminBox';
export type {
  AdminRenewal,
  AdminTask,
  AdminTaskData,
  AdminTaskKind,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per distinct
 * renewal type (passport, lease, insurance…). The string label doubles
 * as both the key and the copy label since it's already user-readable.
 *
 * Tasks aren't scanned — admin tasks are free-form text without a
 * natural recurrence key (see repo.ts cadence section).
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await renewalsRepo.list();
  const types = new Set<string>();
  for (const r of list) {
    const key = r.renewalType.trim();
    if (key) types.add(key);
  }

  const out: CadenceTrackedEntry[] = [];
  for (const renewalType of types) {
    try {
      const estimate = await cadenceRepo.getRenewalCadenceFor(renewalType);
      out.push({
        module: 'admin',
        key: renewalType,
        label: renewalType,
        estimate,
      });
    } catch {
      /* skip one broken renewal type, keep scanning */
    }
  }
  return out;
}
