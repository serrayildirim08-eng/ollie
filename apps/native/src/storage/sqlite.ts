/**
 * native/storage/sqlite.ts — SQL wrapper
 *
 * Primary:  @tauri-apps/plugin-sql  (native SQLite via Tauri)
 * Fallback: in-memory shim          (Vite browser preview — no persistence)
 *
 * Required Tauri plugin: @tauri-apps/plugin-sql ^2
 */

// ── In-memory shim ────────────────────────────────────────────────────────

interface ShimRow {
  [col: string]: unknown;
}

// Bare-minimum shim: stores nothing, executes nothing.
// Browser preview can call the API without crashing; data won't survive
// a page reload. Swap for sql.js if offline browser testing matters later.
const memShim = {
  async execute(_query: string, _params?: unknown[]): Promise<{ rowsAffected: number }> {
    return { rowsAffected: 0 };
  },
  async select<T extends ShimRow = ShimRow>(_query: string, _params?: unknown[]): Promise<T[]> {
    return [];
  },
};

// ── Tauri SQL handle ──────────────────────────────────────────────────────

async function getTauriDb() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return null;
  }
  try {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    return await Database.load('sqlite:ollie.db');
  } catch {
    return null;
  }
}

let dbPromise: ReturnType<typeof getTauriDb> | null = null;
function db() {
  if (!dbPromise) dbPromise = getTauriDb();
  return dbPromise;
}

// ── Public API ────────────────────────────────────────────────────────────

export const sql = {
  /**
   * Run a write statement (INSERT / UPDATE / DELETE / CREATE TABLE …).
   * Returns rowsAffected from Tauri; shim always returns 0.
   */
  async execute(query: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    const d = await db();
    if (d) return d.execute(query, params);
    return memShim.execute(query, params);
  },

  /**
   * Run a SELECT and return typed rows.
   * Callers own casting — generic T lets them supply a row shape.
   */
  async select<T extends ShimRow = ShimRow>(query: string, params: unknown[] = []): Promise<T[]> {
    const d = await db();
    if (d) return (await d.select(query, params)) as T[];
    return memShim.select<T>(query, params);
  },
};
