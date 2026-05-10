/**
 * apps/web · store singleton + bound React hook
 *
 * The @ollie/store package exposes a `createStore(adapter)` factory and a
 * generic React hook that takes a store argument. This file builds the
 * app's single store + cross-tab sync + a project-local hook bound to it.
 *
 * Components import `useStoreSlice` from this file, NOT from @ollie/store
 * directly, so that swapping the underlying store (e.g., for tests or a
 * future remote-sync adapter) is a one-file change.
 */

import {
  browserAdapter,
  createStore,
  installCrossTabSync,
  runMigrations,
} from '@ollie/store';
import { useStoreSlice as baseUseStoreSlice } from '@ollie/store/react';

runMigrations(browserAdapter);

export const store = createStore(browserAdapter);
installCrossTabSync(store, browserAdapter);

export function useStoreSlice<T>(
  mod: string,
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  return baseUseStoreSlice<T>(store, mod, key, defaultValue);
}
