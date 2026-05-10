/**
 * @ollie/store · React hook
 *
 * Subscribes a component to a single (module, key) slice and re-renders on
 * change. Returns a tuple matching React's `useState` — value + setter.
 *
 * The hook takes the store as its first argument so apps can wire it to
 * their own singleton without the package mandating one. Apps typically
 * wrap this in a project-local `useStoreSlice(mod, key, default)` that
 * pre-binds the store.
 */

import { useState, useEffect } from 'react';
import type { Store } from './store';

export function useStoreSlice<T>(
  store: Store,
  mod: string,
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => store.get<T>(mod, key, defaultValue));
  useEffect(() => {
    const unsub = store.subscribeKey<T>(mod, key, (next) => setValue(next));
    return unsub;
  }, [store, mod, key]);
  return [value, (next: T) => store.set<T>(mod, key, next)];
}
