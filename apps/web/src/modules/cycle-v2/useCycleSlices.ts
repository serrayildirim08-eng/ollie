/**
 * cycle-v2 · useCycleSlices — live store bridge
 *
 * Subscribes to the EXISTING `cycle.*` slices (the same keys the live
 * `CycleModule` reads + writes) plus the authoritative
 * `shared.settings.birth_control_enabled` flag, and returns them as one
 * `CycleSlices` object for the v2 selectors. Read-only here; mutations go
 * through `useCycleActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes.
 */
import { useStoreSlice } from '../../store';
import type { CycleItem } from '@ollie/logic/cycle';
import type { CycleSettings, CycleSlices } from './selectors';

export const DEFAULT_CYCLE_SETTINGS: CycleSettings = {
  tracking_for_fertility: false,
  show_dial: true,
  passphrase_hint: '',
  birth_control_enabled: false,
  birth_control_type: 'combined',
};

export function useCycleSlices(): CycleSlices {
  const [items] = useStoreSlice<CycleItem[]>('cycle', 'items', []);
  const [settings] = useStoreSlice<CycleSettings>(
    'cycle',
    'settings',
    DEFAULT_CYCLE_SETTINGS,
  );
  const [birthControlEnabled] = useStoreSlice<boolean>(
    'shared',
    'settings.birth_control_enabled',
    false,
  );
  const [lastEditedByCycle] = useStoreSlice<Record<number, number>>(
    'cycle',
    'lastEditedByCycle',
    {},
  );
  const [asks] = useStoreSlice<string[]>('cycle', 'asks', []);

  return {
    items: Array.isArray(items) ? items : [],
    settings: settings ?? DEFAULT_CYCLE_SETTINGS,
    birthControlEnabled: Boolean(birthControlEnabled),
    lastEditedByCycle: lastEditedByCycle ?? {},
    asks: Array.isArray(asks) ? asks : [],
  };
}
