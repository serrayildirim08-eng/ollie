/**
 * medication-v2 · useMedicationSlices — live store bridge
 *
 * Subscribes to the EXISTING `medication.*` slices (the same keys the live
 * `MedicationModule` reads + writes) and returns them as one
 * `MedicationSlices` object for the v2 selectors. Read-only here;
 * mutations go through `useMedicationActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes. Mirrors
 * body-v2/useBodySlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type { MedicationItem } from '@ollie/logic/medication';
import type { MedicationSlices, AdherenceSlice } from './selectors';

export function useMedicationSlices(): MedicationSlices {
  const [items] = useStoreSlice<MedicationItem[]>('medication', 'items', []);
  const [adherence] = useStoreSlice<AdherenceSlice>(
    'medication',
    'adherence',
    {},
  );

  return useMemo<MedicationSlices>(
    () => ({
      items: Array.isArray(items) ? items : [],
      adherence: adherence && typeof adherence === 'object' ? adherence : {},
    }),
    [items, adherence],
  );
}
