/**
 * @ollie/store · StorageAdapter
 *
 * The store talks to localStorage through this interface so the package
 * stays runtime-agnostic. The browser uses `browserAdapter`; tests use
 * `createMemoryAdapter()` to avoid touching window.
 *
 * `onChange` is optional — only the browser adapter implements it (via the
 * `storage` event for cross-tab sync). Memory adapters return undefined,
 * which `installCrossTabSync` handles as a no-op.
 */

export interface StorageChange {
  key: string | null;
  newValue: string | null;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /**
   * Enumerate every key currently held by the adapter.
   *
   * Required by the pre-migration snapshot (see migrations.ts) — without
   * it the snapshot of non-browser adapters was silently empty, so the
   * rollback-on-failed-migration path restored nothing. Implemented by
   * BOTH the browser adapter (over localStorage) and the memory adapter.
   */
  getAllKeys(): string[];
  /** Subscribe to changes made by OTHER tabs. Returns an unsubscribe fn. */
  onChange?(handler: (change: StorageChange) => void): () => void;
}

export const browserAdapter: StorageAdapter = {
  getItem(key) {
    return globalThis.localStorage.getItem(key);
  },
  setItem(key, value) {
    globalThis.localStorage.setItem(key, value);
  },
  removeItem(key) {
    globalThis.localStorage.removeItem(key);
  },
  getAllKeys() {
    const ls = globalThis.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k != null) keys.push(k);
    }
    return keys;
  },
  onChange(handler) {
    const listener = (e: StorageEvent) => {
      handler({ key: e.key, newValue: e.newValue });
    };
    globalThis.addEventListener('storage', listener);
    return () => globalThis.removeEventListener('storage', listener);
  },
};

export function createMemoryAdapter(seed?: Record<string, string>): StorageAdapter {
  const storage = new Map<string, string>(seed ? Object.entries(seed) : []);
  return {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
    getAllKeys() {
      return [...storage.keys()];
    },
  };
}
