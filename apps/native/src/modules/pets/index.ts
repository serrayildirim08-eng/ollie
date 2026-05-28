/**
 * Pets module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { events as eventsRepo, cadence as cadenceRepo } from './repo';

export { petsHandler } from './handler';
export { migratePets } from './migrate';
export { events, cadence } from './repo';
export { PetsBox } from './PetsBox';
export type {
  PetEvent,
  PetEventData,
  PetEventKind,
} from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per distinct
 * pet name observed in the feed-event stream. Untagged feeds (no
 * `pet_name`) are skipped — copy reads as "<pet> usually gets fed by
 * now" and "(unknown)" reads worse than silence.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await eventsRepo.list();
  const pets = new Set<string>();
  for (const e of list) {
    if (e.kind !== 'feed') continue;
    if (e.petName && e.petName.length > 0) pets.add(e.petName);
  }

  const out: CadenceTrackedEntry[] = [];
  for (const petName of pets) {
    try {
      const estimate = await cadenceRepo.getFeedCadenceFor(petName);
      out.push({
        module: 'pets',
        key: petName,
        label: petName,
        estimate,
      });
    } catch {
      /* skip one broken pet, keep scanning */
    }
  }
  return out;
}
