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

/**
 * Module namespaces whose @ollie/store mirror must NEVER touch durable disk.
 *
 * These four modules carry the most sensitive captures (cycle/medication/mood
 * + the raw brain-dump stream). The native app's real durable copy lives in
 * the SQLCipher-encrypted SQLite DB (see apps/native/src/storage + the Rust
 * keychain key). The @ollie/store layer is only a *watcher-read mirror* that
 * the bridges (apps/native/src/modules/<m>/bridge.ts) rebuild from SQLite on
 * every boot — so routing it to RAM loses nothing: it is repopulated by
 * `runAllSyncs` within the session, and the watchers light up exactly as
 * before. Persisting it to localStorage was a *second*, plaintext copy of the
 * encrypted data — that is the surface we are closing.
 *
 * `journal` is included because the dump bridge mirrors the raw dump text into
 * `journal.entries` (and `journal.patterns` is a recomputed watcher output);
 * both are 100% derived from the dump SQLite archive, so RAM-only is safe.
 *
 * NOT included: `shared`. It is a cross-module blob that also holds the auth
 * passphrase salt/verifier and the research-stream consent + device id — none
 * of which are derivable from SQLite, so evicting it would lock users out /
 * drop consent. (Residual: the dump bridge also merges dump text into
 * `shared.actionLog`; that single field stays on disk because the store writes
 * one blob per module and we cannot evict it without taking auth/consent with
 * it. See the self-review note.)
 */
export const SENSITIVE_STORE_MODULES = ['cycle', 'medication', 'mood', 'dump', 'journal'] as const;

/**
 * Default sensitivity predicate: matches `void.state.<mod>.*` for any store
 * version (so legacy `.v4` snapshots route the same as current `.v5`).
 */
export function isSensitiveStoreKey(key: string): boolean {
  for (const mod of SENSITIVE_STORE_MODULES) {
    if (key.startsWith(`void.state.${mod}.`)) return true;
  }
  return false;
}

/**
 * Wrap a durable adapter so that keys deemed "sensitive" are held ONLY in an
 * in-memory Map and never written to the durable backend. Everything else
 * passes straight through.
 *
 * Contract preservation — this is the whole point:
 *   - Fully SYNCHRONOUS. No promises, no awaits. The store reads/writes
 *     synchronously (store.ts readModule/writeModule) and the orchestrator's
 *     watchers read synchronously; an async adapter would break both and was
 *     the exact failure mode of the prior rejected attempt.
 *   - INFALLIBLE. Never throws. A throwing setItem would silently stop
 *     persistence (the prior "silent-autosave regression"); construction is
 *     wrapped in try/catch and the hot paths do no work that can throw.
 *
 * One-time plaintext eviction: at construction we pull any pre-existing
 * sensitive values that are already sitting in the durable backend (from
 * before this change shipped) into memory and DELETE them from disk — so the
 * old plaintext mirror is actively wiped, not just stopped going forward.
 */
export function partitionedAdapter(
  base: StorageAdapter,
  isSensitive: (key: string) => boolean = isSensitiveStoreKey,
): StorageAdapter {
  const mem = new Map<string, string>();

  // One-time eviction of any plaintext sensitive values already on disk.
  // Best-effort + fully guarded: a failure here must never block boot.
  try {
    for (const k of base.getAllKeys()) {
      if (!isSensitive(k)) continue;
      const v = base.getItem(k);
      if (v != null) mem.set(k, v);
      base.removeItem(k);
    }
  } catch {
    /* best-effort — never throw at construction */
  }

  return {
    getItem(key) {
      if (isSensitive(key)) return mem.get(key) ?? null;
      return base.getItem(key);
    },
    setItem(key, value) {
      if (isSensitive(key)) {
        mem.set(key, value);
        return;
      }
      base.setItem(key, value);
    },
    removeItem(key) {
      if (isSensitive(key)) {
        mem.delete(key);
        return;
      }
      base.removeItem(key);
    },
    getAllKeys() {
      // Union both backends so the migration snapshot (migrations.ts) and any
      // other enumerator sees sensitive keys too.
      const keys = new Set<string>(base.getAllKeys());
      for (const k of mem.keys()) keys.add(k);
      return [...keys];
    },
    // Cross-tab change events only make sense for durable keys; sensitive keys
    // live in this process's RAM and never cross tabs. Delegate to the base so
    // non-sensitive cross-tab sync keeps working unchanged.
    onChange: base.onChange ? (handler) => base.onChange!(handler) : undefined,
  };
}

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
