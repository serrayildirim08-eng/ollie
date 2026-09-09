/**
 * Medication module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { medications as medicationsRepo, cadence as cadenceRepo } from './repo';

export { medicationHandler } from './handler';
export { migrateMedication } from './migrate';
export { events, medications, cabinet, cadence } from './repo';
export { MedicationBox } from './MedicationBox';
export {
  purposeFor,
  purposeLabel,
  coercePurpose,
  PURPOSE_ORDER,
  MED_PURPOSES,
  type MedPurpose,
} from './purposeMap';
export { isLow, daysOfSupply, decrementQty } from './lowStock';
export type {
  CabinetItem,
  EventKind,
  Medication,
  MedicationEvent,
  MedicationEventWithName,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per medication
 * in the registry, keyed by med id (stable across name normalisation)
 * with the med name as the label — copy reads "no <name> logged today".
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await medicationsRepo.list();
  const out: CadenceTrackedEntry[] = [];
  for (const med of list) {
    try {
      const estimate = await cadenceRepo.getDoseCadenceFor(med.id);
      out.push({
        module: 'medication',
        key: med.id,
        label: med.name,
        estimate,
      });
    } catch {
      /* skip one broken med, keep scanning */
    }
  }
  return out;
}
