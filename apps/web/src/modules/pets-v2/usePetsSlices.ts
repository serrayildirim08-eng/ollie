/**
 * pets-v2 · usePetsSlices — live store bridge
 *
 * Subscribes to the EXISTING `pets.*` store slices — the same keys the live
 * `PetsModule` reads + writes — and returns them as one `PetsSlices` object
 * for the v2 selectors. Read-only here; mutations go through `usePetsActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer (`@ollie/logic/pets` + the `pets` store) is untouched,
 * only the rendering changes. Mirrors admin-v2/useAdminSlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type {
  PetsSlices,
  StoredPet,
  StoredCareLogEntry,
  StoredObservation,
  StoredCareGap,
  StoredHealthFlag,
  StoredMilestone,
  PetsSettings,
  AwayState,
} from './selectors';

const DEFAULT_SETTINGS: PetsSettings = {
  guilt_voice: 'on',
  weekly_letter: 'off',
  multi_caregiver: false,
};

const DEFAULT_AWAY: AwayState = { active: false, returning_at: null };

/** keep only plain non-null objects from a possibly-dirty store array */
function clean<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((v) => Boolean(v) && typeof v === 'object') as T[])
    : [];
}

export function usePetsSlices(): PetsSlices {
  const [pets] = useStoreSlice<StoredPet[]>('pets', 'pets', []);
  const [careLog] = useStoreSlice<StoredCareLogEntry[]>('pets', 'care_log', []);
  const [observations] = useStoreSlice<StoredObservation[]>(
    'pets',
    'observations',
    [],
  );
  const [careGaps] = useStoreSlice<StoredCareGap[]>('pets', 'care_gaps', []);
  const [healthFlags] = useStoreSlice<StoredHealthFlag[]>(
    'pets',
    'health_flags',
    [],
  );
  const [milestones] = useStoreSlice<StoredMilestone[]>('pets', 'milestones', []);
  const [settings] = useStoreSlice<PetsSettings>(
    'pets',
    'settings',
    DEFAULT_SETTINGS,
  );
  const [away] = useStoreSlice<AwayState>('pets', 'away', DEFAULT_AWAY);

  return useMemo<PetsSlices>(
    () => ({
      pets: clean<StoredPet>(pets),
      careLog: clean<StoredCareLogEntry>(careLog),
      observations: clean<StoredObservation>(observations),
      careGaps: clean<StoredCareGap>(careGaps),
      healthFlags: clean<StoredHealthFlag>(healthFlags),
      milestones: clean<StoredMilestone>(milestones),
      settings:
        settings && typeof settings === 'object' ? settings : DEFAULT_SETTINGS,
      away: away && typeof away === 'object' ? away : DEFAULT_AWAY,
    }),
    [pets, careLog, observations, careGaps, healthFlags, milestones, settings, away],
  );
}
