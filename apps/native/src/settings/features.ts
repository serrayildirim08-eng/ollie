/**
 * apps/native · settings/features.ts — v1 feature flags.
 *
 * Lets us keep code in the tree but OFF the v1 surface (audit #10). Flags live
 * under the `settings.features` store key (persists + reactive), default false.
 * Turning one on is reversible — flip the flag, no revert. Mirrors appLang.ts.
 *
 * v1 default-OFF features:
 *   - partner: the bilateral "intimate window" module. Mocked + untested + not
 *     brain-dump-routable, so it is deferred out of v1 (kept in the tree).
 *   - goals / habits / pets: deferred from the current surface per Serra
 *     (2026-06-28). Code + data stay; flip the flag to bring them back.
 */

import { useEffect, useState } from 'react';
import { store } from '../store';

export type FeatureFlag = 'partner' | 'goals' | 'habits' | 'pets';

const NS = 'settings';
const KEY = 'features';

/** Flags that are OFF unless the stored map explicitly enables them. */
const DEFAULTS: Record<FeatureFlag, boolean> = {
  partner: false,
  // Deferred from the current surface (kept in the tree, reversible).
  goals: false,
  habits: false,
  pets: false,
};

function readFlags(): Partial<Record<FeatureFlag, boolean>> {
  const raw = store.get<Partial<Record<FeatureFlag, boolean>>>(NS, KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

/** Read a flag (validated, defaults from DEFAULTS). Non-reactive. */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const v = readFlags()[flag];
  return typeof v === 'boolean' ? v : DEFAULTS[flag];
}

/** Set a flag. Reversible — flip it back to hide the surface again. */
export function setFeatureEnabled(flag: FeatureFlag, enabled: boolean): void {
  store.set(NS, KEY, { ...readFlags(), [flag]: enabled });
}

/** Reactive flag hook — re-renders when the stored map changes. */
export function useFeature(flag: FeatureFlag): boolean {
  const [on, setOn] = useState<boolean>(() => isFeatureEnabled(flag));
  useEffect(() => {
    const refresh = (): void => setOn(isFeatureEnabled(flag));
    const unsub = store.subscribeKey(NS, KEY, refresh);
    refresh();
    return unsub;
  }, [flag]);
  return on;
}
