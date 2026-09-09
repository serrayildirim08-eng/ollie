/**
 * native/storage/kv.ts — key-value store
 *
 * Primary: @tauri-apps/plugin-store  (native disk via Tauri)
 * Fallback: window.localStorage      (Vite browser preview)
 *
 * Required Tauri plugins (add to package.json + src-tauri/Cargo.toml):
 *   @tauri-apps/plugin-store   ^2
 *   @tauri-apps/plugin-sql     ^2   (used by sqlite.ts)
 *
 * Values are JSON-serialized so any JSON-safe type round-trips cleanly.
 */

// Tauri store is loaded lazily so the module doesn't throw during
// Vite browser preview where __TAURI_INTERNALS__ is absent.
async function getTauriStore() {
  // The Tauri global is injected at runtime; absent in plain browser.
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null;
  }
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    // 'ollie.bin' is the on-disk store file inside the app data dir.
    return await load('ollie.bin', { defaults: {}, autoSave: true });
  } catch {
    return null;
  }
}

// Module-level promise so we open the store file once per session.
let storePromise: ReturnType<typeof getTauriStore> | null = null;
function store() {
  if (!storePromise) storePromise = getTauriStore();
  return storePromise;
}

// One corrupt value must not throw on every read of that key forever:
// a malformed payload is treated as absent (null) rather than a hard error.
function safeParse<T>(raw: string, key: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[kv] corrupt JSON for "${key}", treating as empty`, err);
    return null;
  }
}

export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const s = await store();
    if (s) {
      const raw = (await s.get(key)) as string | undefined | null;
      if (raw == null) return null;
      return safeParse<T>(raw, key);
    }
    // localStorage fallback
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return safeParse<T>(raw, key);
  },

  async set<T = unknown>(key: string, val: T): Promise<void> {
    const serialized = JSON.stringify(val);
    const s = await store();
    if (s) {
      await s.set(key, serialized);
      return;
    }
    localStorage.setItem(key, serialized);
  },

  async delete(key: string): Promise<void> {
    const s = await store();
    if (s) {
      await s.delete(key);
      return;
    }
    localStorage.removeItem(key);
  },

  async keys(): Promise<string[]> {
    const s = await store();
    if (s) {
      return s.keys();
    }
    return Object.keys(localStorage);
  },
};
