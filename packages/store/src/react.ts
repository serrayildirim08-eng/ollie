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

import { useState, useEffect, useCallback } from 'react';
import type { Store } from './store';

export function useStoreSlice<T>(
  store: Store,
  mod: string,
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => store.get<T>(mod, key, defaultValue));
  useEffect(() => {
    // The initializer only ran on mount, so when [store, mod, key] change we
    // must re-read the current value before subscribing — otherwise the hook
    // renders the previous slice's stale value until the next write (#121).
    setValue(store.get<T>(mod, key, defaultValue));
    const unsub = store.subscribeKey<T>(mod, key, (next) => setValue(next));
    return unsub;
    // defaultValue is intentionally excluded: callers commonly pass a fresh
    // literal each render, and including it would re-subscribe every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, mod, key]);
  // Stable setter identity so memoized children / effects keyed on it don't
  // re-run every render (#122).
  const set = useCallback(
    (next: T) => store.set<T>(mod, key, next),
    [store, mod, key],
  );
  return [value, set];
}
