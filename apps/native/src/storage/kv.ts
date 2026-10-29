/**
 * native/storage/kv.ts — key-value store
 *
 * Primary: a `kv_store` table inside the SQLCipher-encrypted ollie.db
 *          (same encryption + key as every module table — see
 *          src-tauri/src/secure_db.rs)
 * Fallback: window.localStorage (Vite browser preview only)
 *
 * History: values used to live in a plugin-store JSON file (`ollie.bin`) that
 * was NOT encrypted — chat log, unsent draft, partner state, reminder ladder
 * text. On first use per session we import anything still in that file into
 * the encrypted table (existing table rows win), then empty the file. The
 * import is idempotent: a crash half-way just repeats it next launch.
 * Every read/write waits for the import, so no caller ever sees a key as
 * "missing" while it is still sitting in the legacy file.
 *
 * Values are JSON-serialized so any JSON-safe type round-trips cleanly.
 */

import { sql } from './sqlite';

const LEGACY_STORE_FILE = 'ollie.bin';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function importLegacyStore(): Promise<void> {
  let legacy: Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').load>> | null = null;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    legacy = await load(LEGACY_STORE_FILE, { defaults: {}, autoSave: false });
  } catch {
    return; // no legacy store (fresh install / plugin absent) — nothing to import
  }
  const keys = await legacy.keys();
  if (keys.length === 0) return;
  for (const key of keys) {
    const raw = await legacy.get(key);
    if (raw == null) continue;
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    await sql.execute('INSERT OR IGNORE INTO kv_store (key, value) VALUES (?, ?)', [key, value]);
  }
  // Only after every key is safely in the encrypted table: wipe the plaintext.
  await legacy.clear();
  await legacy.save();
}

let readyPromise: Promise<void> | null = null;

/** Create the table and pull in the legacy plaintext store, once per session. */
function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await sql.execute(
        'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
      await importLegacyStore();
    })().catch((e) => {
      // Transient failure must not brick kv for the session — retry next call.
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
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

interface KvRow {
  [col: string]: unknown;
  key: string;
  value: string;
}

export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    if (inTauri()) {
      await ready();
      const rows = await sql.select<KvRow>('SELECT value FROM kv_store WHERE key = ?', [key]);
      const raw = rows[0]?.value;
      if (raw == null) return null;
      return safeParse<T>(raw, key);
    }
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return safeParse<T>(raw, key);
  },

  async set<T = unknown>(key: string, val: T): Promise<void> {
    const serialized = JSON.stringify(val);
    if (inTauri()) {
      await ready();
      await sql.execute(
        'INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, serialized],
      );
      return;
    }
    localStorage.setItem(key, serialized);
  },

  async delete(key: string): Promise<void> {
    if (inTauri()) {
      await ready();
      await sql.execute('DELETE FROM kv_store WHERE key = ?', [key]);
      return;
    }
    localStorage.removeItem(key);
  },

  async keys(): Promise<string[]> {
    if (inTauri()) {
      await ready();
      const rows = await sql.select<KvRow>('SELECT key FROM kv_store');
      return rows.map((r) => r.key);
    }
    return Object.keys(localStorage);
  },
};

/** Test-only: forget the once-per-session import so a test can re-run it. */
export function _resetKvForTests(): void {
  readyPromise = null;
}
