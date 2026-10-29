/**
 * kv tests.
 *
 * kv lives in the encrypted SQLite db (kv_store table) when running under
 * Tauri, and imports + wipes the legacy plaintext plugin-store file on first
 * use. We set `__TAURI_INTERNALS__` so kv takes the Tauri branch, back `sql`
 * with a tiny in-memory table, and mock plugin-store as the legacy file.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const table = new Map<string, string>();
const legacy = new Map<string, unknown>();
let legacySaved = 0;

vi.mock('./sqlite', () => ({
  sql: {
    async execute(q: string, p: unknown[] = []) {
      if (q.startsWith('CREATE TABLE')) return { rowsAffected: 0 };
      if (q.startsWith('INSERT OR IGNORE')) {
        const [k, v] = p as [string, string];
        if (!table.has(k)) table.set(k, v);
        return { rowsAffected: 1 };
      }
      if (q.startsWith('INSERT INTO kv_store')) {
        const [k, v] = p as [string, string];
        table.set(k, v);
        return { rowsAffected: 1 };
      }
      if (q.startsWith('DELETE')) {
        table.delete((p as [string])[0]);
        return { rowsAffected: 1 };
      }
      throw new Error(`unexpected sql: ${q}`);
    },
    async select(q: string, p: unknown[] = []) {
      if (q.startsWith('SELECT value')) {
        const v = table.get((p as [string])[0]);
        return v === undefined ? [] : [{ value: v }];
      }
      if (q.startsWith('SELECT key')) return [...table.keys()].map((key) => ({ key }));
      throw new Error(`unexpected sql: ${q}`);
    },
  },
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    async get(key: string) {
      return legacy.get(key);
    },
    async keys() {
      return [...legacy.keys()];
    },
    async clear() {
      legacy.clear();
    },
    async save() {
      legacySaved += 1;
    },
  }),
}));

beforeEach(() => {
  table.clear();
  legacy.clear();
  legacySaved = 0;
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.resetModules();
});

async function freshKv() {
  return (await import('./kv')).kv;
}

describe('kv · corrupt JSON (#124)', () => {
  it('returns null instead of throwing for a corrupt value', async () => {
    table.set('bad', '{not valid json');
    const kv = await freshKv();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(kv.get('bad')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still reads well-formed values after a corrupt one was stored', async () => {
    table.set('bad', 'oops[');
    const kv = await freshKv();
    await kv.set('good', { ok: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await kv.get('bad')).toBeNull();
    warn.mockRestore();
    expect(await kv.get('good')).toEqual({ ok: true });
  });

  it('round-trips, overwrites, deletes and lists', async () => {
    const kv = await freshKv();
    await kv.set('n', [1, 2, 3]);
    await kv.set('n', [4]);
    expect(await kv.get('n')).toEqual([4]);
    await kv.set('m', 'x');
    expect((await kv.keys()).sort()).toEqual(['m', 'n']);
    await kv.delete('n');
    expect(await kv.get('n')).toBeNull();
  });
});

describe('kv · legacy plaintext store import', () => {
  it('moves legacy values into the encrypted table and wipes the file', async () => {
    legacy.set('home_chat_v1', JSON.stringify([{ id: 'a', text: 'call mom' }]));
    legacy.set('appLang', JSON.stringify('tr'));
    const kv = await freshKv();

    expect(await kv.get('home_chat_v1')).toEqual([{ id: 'a', text: 'call mom' }]);
    expect(await kv.get('appLang')).toBe('tr');
    expect(legacy.size).toBe(0);
    expect(legacySaved).toBe(1);
  });

  it('never lets a legacy value overwrite a newer encrypted one', async () => {
    table.set('appLang', JSON.stringify('es'));
    legacy.set('appLang', JSON.stringify('en'));
    const kv = await freshKv();
    expect(await kv.get('appLang')).toBe('es');
  });

  it('imports before the first read, so a legacy key is never seen as missing', async () => {
    legacy.set('analytics.device_id', JSON.stringify('dev-123'));
    const kv = await freshKv();
    // concurrent first calls both wait for the single import
    const [a, b] = await Promise.all([kv.get('analytics.device_id'), kv.keys()]);
    expect(a).toBe('dev-123');
    expect(b).toContain('analytics.device_id');
  });

  it('does nothing when there is no legacy data', async () => {
    const kv = await freshKv();
    expect(await kv.get('x')).toBeNull();
    expect(legacySaved).toBe(0);
  });
});
