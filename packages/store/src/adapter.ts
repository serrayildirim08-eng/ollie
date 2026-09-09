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
 * of which are derivable from SQLite, so evicting the WHOLE blob would lock
 * users out / drop consent. The single sensitive FIELD inside it
 * (`shared.actionLog`, which carries raw brain-dump text) is partitioned out
 * separately — see SENSITIVE_BLOB_FIELDS below.
 */
export const SENSITIVE_STORE_MODULES = ['cycle', 'medication', 'mood', 'dump', 'journal'] as const;

/**
 * Sub-fields that are sensitive even though their MODULE blob is not.
 *
 * `shared` cannot be RAM-only as a whole (it carries the auth salt/verifier +
 * consent that are NOT derivable from SQLite). But the dump bridge merges raw
 * brain-dump text into `shared.actionLog`, so persisting the whole shared blob
 * to plaintext localStorage leaks that raw text — the exact surface this
 * blocker closes. `actionLog`'s authoritative copy is the SQLCipher-encrypted
 * dump archive, and the dump + habits bridges rebuild it from SQLite on every
 * boot (apps/native/src/modules/{dump,habits}/bridge.ts → syncToStore), so
 * holding it in RAM-only loses nothing for the watchers. We therefore strip
 * these fields out of the on-disk blob and keep them in the in-memory overlay,
 * mirroring the whole-module partition above but at field granularity.
 *
 * Keyed by module name; matched against `void.state.<mod>.*` at any version.
 */
export const SENSITIVE_BLOB_FIELDS: Readonly<Record<string, readonly string[]>> = {
  shared: ['actionLog'],
};

/** Internal mem-overlay key prefix for stripped sensitive sub-fields. The
 *  prefix does NOT start with `void.state.` so it can never collide with a real
 *  store key, and it is filtered out of getAllKeys(). */
const BLOB_FIELD_MEM_PREFIX = '@@sensitive-blob-fields@@:';

/**
 * If `key` is a module blob that carries sensitive sub-fields, return that
 * field list; otherwise null. Matches any store version (e.g. `.v4` / `.v5`).
 */
export function sensitiveBlobFieldsFor(key: string): readonly string[] | null {
  for (const mod of Object.keys(SENSITIVE_BLOB_FIELDS)) {
    if (key.startsWith(`void.state.${mod}.`)) return SENSITIVE_BLOB_FIELDS[mod];
  }
  return null;
}

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
 * old plaintext mirror is actively wiped, not just stopped going forward. The
 * same eviction strips sensitive SUB-FIELDS (SENSITIVE_BLOB_FIELDS, e.g.
 * `shared.actionLog`) out of otherwise-durable blobs already on disk.
 */
export function partitionedAdapter(
  base: StorageAdapter,
  isSensitive: (key: string) => boolean = isSensitiveStoreKey,
): StorageAdapter {
  const mem = new Map<string, string>();
  const memFieldKey = (key: string) => BLOB_FIELD_MEM_PREFIX + key;

  // Split a module-blob JSON string into { durable, sensitive } where the
  // sensitive sub-fields are pulled out. Returns null when there is nothing to
  // split (not an object / no sensitive field present), so callers can fast-path
  // the unchanged value. Never throws.
  function splitBlob(
    key: string,
    value: string,
  ): { durable: string; sensitive: string } | null {
    const fields = sensitiveBlobFieldsFor(key);
    if (!fields) return null;
    try {
      const obj = JSON.parse(value) as Record<string, unknown>;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      const sensitive: Record<string, unknown> = {};
      let any = false;
      for (const f of fields) {
        if (Object.prototype.hasOwnProperty.call(obj, f)) {
          sensitive[f] = obj[f];
          delete obj[f];
          any = true;
        }
      }
      if (!any) return null;
      return { durable: JSON.stringify(obj), sensitive: JSON.stringify(sensitive) };
    } catch {
      // Non-JSON / non-object value can't carry the sensitive object field, so
      // there is nothing to strip; let it pass through untouched.
      return null;
    }
  }

  // One-time eviction of any plaintext sensitive values already on disk.
  // Best-effort + fully guarded: a failure here must never block boot.
  try {
    for (const k of base.getAllKeys()) {
      if (isSensitive(k)) {
        const v = base.getItem(k);
        if (v != null) mem.set(k, v);
        base.removeItem(k);
        continue;
      }
      // Partially-sensitive blob already on disk → strip the sensitive field
      // into RAM and rewrite the redacted blob so the old plaintext is wiped.
      const v = base.getItem(k);
      if (v == null) continue;
      const split = splitBlob(k, v);
      if (split) {
        mem.set(memFieldKey(k), split.sensitive);
        base.setItem(k, split.durable);
      }
    }
  } catch {
    /* best-effort — never throw at construction */
  }

  return {
    getItem(key) {
      if (isSensitive(key)) return mem.get(key) ?? null;
      const durable = base.getItem(key);
      const fieldRaw = mem.get(memFieldKey(key));
      if (fieldRaw == null) return durable; // nothing partitioned out
      // Merge the RAM-held sensitive fields back so readers (and the store's
      // cache rehydration) see the complete blob within the session.
      try {
        const obj = durable ? (JSON.parse(durable) as Record<string, unknown>) : {};
        const sensitive = JSON.parse(fieldRaw) as Record<string, unknown>;
        return JSON.stringify({ ...obj, ...sensitive });
      } catch {
        return durable;
      }
    },
    setItem(key, value) {
      if (isSensitive(key)) {
        mem.set(key, value);
        return;
      }
      const split = splitBlob(key, value);
      if (split) {
        mem.set(memFieldKey(key), split.sensitive);
        base.setItem(key, split.durable);
        return;
      }
      // No sensitive field present in this write → clear any stale overlay so a
      // later read doesn't resurrect a removed field, then persist as-is.
      if (mem.has(memFieldKey(key))) mem.delete(memFieldKey(key));
      base.setItem(key, value);
    },
    removeItem(key) {
      if (isSensitive(key)) {
        mem.delete(key);
        return;
      }
      mem.delete(memFieldKey(key));
      base.removeItem(key);
    },
    getAllKeys() {
      // Union both backends so the migration snapshot (migrations.ts) and any
      // other enumerator sees sensitive keys too — but never leak the internal
      // blob-field overlay keys (they are not real store keys).
      const keys = new Set<string>(base.getAllKeys());
      for (const k of mem.keys()) {
        if (k.startsWith(BLOB_FIELD_MEM_PREFIX)) continue;
        keys.add(k);
      }
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
