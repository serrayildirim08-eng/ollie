/**
 * @ollie/store · core
 *
 * Per-module state lives at `void.state.<mod>.v<STORE_VERSION>` in the
 * underlying adapter. Reads are cached in-memory. Writes go to both the
 * cache and the adapter, then fan out to subscribers.
 *
 * Subscriber model:
 *   - subscribeKey(mod, key, cb)  → fires when that single key changes
 *   - subscribe(mod, cb)          → fires when ANY key in the module changes
 *
 * The store is created via `createStore(adapter)`. Apps typically instantiate
 * a singleton (apps/web/src/store.ts); tests instantiate per-test with
 * `createMemoryAdapter()`.
 */

import type { StorageAdapter } from './adapter';

export const STORE_VERSION = 5;
export const STORE_META_KEY = 'void.state._meta.v1';
export const storeModuleKey = (mod: string): string =>
  `void.state.${mod}.v${STORE_VERSION}`;

export type ModuleState = Record<string, unknown>;
type Subscriber<T = unknown> = (value: T) => void;

/**
 * Structural equality for store values (#64). The store mirrors module SQLite
 * into watcher-read keys on every dump's ALL-modules sweep (see
 * apps/native bridge/index.ts + dispatch.ts) — each sweep builds fresh arrays,
 * so without a value-equality check every unchanged module would still notify
 * every subscriber. Compares by JSON-shape: handles the array/object payloads
 * the bridges write; falls back to `Object.is` for primitives/functions.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

export interface Store {
  get<T = unknown>(mod: string, key: string, defaultValue?: T): T;
  set<T = unknown>(mod: string, key: string, value: T): void;
  update<T = unknown>(mod: string, key: string, updater: (current: T | undefined) => T): void;
  remove(mod: string, key: string): void;
  getModule(mod: string): ModuleState | null;
  setModule(mod: string, state: ModuleState): void;
  subscribe(mod: string, cb: Subscriber<ModuleState | null>): () => void;
  subscribeKey<T = unknown>(mod: string, key: string, cb: Subscriber<T>): () => void;
  version(): number;
  /** Test-only: drop in-memory cache + every subscriber. */
  _reset(): void;
  /** Internal: invalidate cache after a cross-tab write. */
  _invalidateModule(mod: string): void;
}

export function createStore(adapter: StorageAdapter): Store {
  const cache = new Map<string, ModuleState | null>();
  // mod → key → Set<subscriber>; key '*' subscribes to whole module
  const subs = new Map<string, Map<string, Set<Subscriber>>>();

  function readModule(mod: string): ModuleState | null {
    if (cache.has(mod)) return cache.get(mod) ?? null;
    const raw = adapter.getItem(storeModuleKey(mod));
    if (!raw) {
      cache.set(mod, null);
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as ModuleState;
      cache.set(mod, parsed);
      return parsed;
    } catch (err) {
      console.warn(`[@ollie/store] corrupt JSON for "${mod}", treating as empty`, err);
      cache.set(mod, null);
      return null;
    }
  }

  function writeModule(mod: string, state: ModuleState | null): void {
    cache.set(mod, state);
    if (state === null) {
      adapter.removeItem(storeModuleKey(mod));
    } else {
      adapter.setItem(storeModuleKey(mod), JSON.stringify(state));
    }
  }

  function notify(mod: string, key: string, value: unknown): void {
    const modSubs = subs.get(mod);
    if (!modSubs) return;
    const keySubs = modSubs.get(key);
    if (keySubs) {
      for (const cb of keySubs) {
        try {
          cb(value);
        } catch (err) {
          console.error('[@ollie/store] subscriber threw:', err);
        }
      }
    }
    if (key !== '*') {
      const starSubs = modSubs.get('*');
      if (starSubs) {
        // #95: clone so `*` subscribers can't mutate the internal cache.
        const live = readModule(mod);
        const snapshot = live ? { ...live } : null;
        for (const cb of starSubs) {
          try {
            cb(snapshot);
          } catch (err) {
            console.error('[@ollie/store] subscriber threw:', err);
          }
        }
      }
    }
  }

  function addSubscriber(mod: string, key: string, cb: Subscriber): () => void {
    let modSubs = subs.get(mod);
    if (!modSubs) {
      modSubs = new Map();
      subs.set(mod, modSubs);
    }
    let keySubs = modSubs.get(key);
    if (!keySubs) {
      keySubs = new Set();
      modSubs.set(key, keySubs);
    }
    keySubs.add(cb);
    return () => {
      const s = subs.get(mod)?.get(key);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) subs.get(mod)?.delete(key);
    };
  }

  const store: Store = {
    get<T = unknown>(mod: string, key: string, defaultValue?: T): T {
      const state = readModule(mod);
      if (!state || !(key in state)) return defaultValue as T;
      return state[key] as T;
    },
    set<T = unknown>(mod: string, key: string, value: T): void {
      const current = readModule(mod);
      // #64: short-circuit when the stored value is structurally identical.
      // The all-modules dump sweep re-sets every module with freshly-built
      // arrays; without this, byte-identical data still fans out to every
      // subscriber. Note: this compares by VALUE, not reference — a
      // same-reference object that was mutated in place will NOT be detected
      // as changed, so callers must always pass a new value (the bridges do).
      if (current && key in current && deepEqual(current[key], value)) {
        return;
      }
      // #95: shallow-copy before mutating so the cached object handed to
      // subscribers / getModule callers is never mutated under them.
      const next: ModuleState = current ? { ...current } : {};
      next[key] = value;
      writeModule(mod, next);
      notify(mod, key, value);
    },
    update<T = unknown>(mod: string, key: string, updater: (current: T | undefined) => T): void {
      const next = updater(store.get<T>(mod, key));
      store.set<T>(mod, key, next);
    },
    remove(mod: string, key: string): void {
      const state = readModule(mod);
      if (!state || !(key in state)) return;
      // #95: shallow-copy before mutating so cached refs handed out earlier
      // are not corrupted.
      const next: ModuleState = { ...state };
      delete next[key];
      writeModule(mod, next);
      notify(mod, key, undefined);
    },
    getModule(mod: string): ModuleState | null {
      // #95: return a shallow clone so callers cannot mutate the internal
      // cache object (which subscribers and future reads also hold).
      const state = readModule(mod);
      return state ? { ...state } : null;
    },
    setModule(mod: string, state: ModuleState): void {
      writeModule(mod, state);
      notify(mod, '*', state);
    },
    subscribe(mod, cb) {
      return addSubscriber(mod, '*', cb as Subscriber);
    },
    subscribeKey<T = unknown>(mod: string, key: string, cb: Subscriber<T>): () => void {
      return addSubscriber(mod, key, cb as Subscriber);
    },
    version: () => STORE_VERSION,
    _reset() {
      cache.clear();
      subs.clear();
    },
    _invalidateModule(mod: string): void {
      cache.delete(mod);
      const next = readModule(mod);
      // A cross-tab write can touch ANY key in the module, so fan out to
      // every per-key (subscribeKey) listener in addition to the whole-
      // module ('*') subscribers — otherwise the cache is refreshed but
      // bound components never re-render (#94).
      const modSubs = subs.get(mod);
      if (modSubs) {
        for (const [key, keySubs] of modSubs) {
          if (key === '*') continue;
          const value = next && key in next ? next[key] : undefined;
          for (const cb of keySubs) {
            try {
              cb(value);
            } catch (err) {
              console.error('[@ollie/store] subscriber threw:', err);
            }
          }
        }
      }
      notify(mod, '*', next);
    },
  };

  return store;
}
