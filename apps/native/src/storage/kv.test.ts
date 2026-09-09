/**
 * kv tests — corrupt-value resilience (#124).
 *
 * A single malformed value must NOT throw on every read of that key forever;
 * `get` returns null for unparseable JSON.
 *
 * kv prefers the Tauri plugin-store and only falls back to localStorage when
 * the Tauri global is absent. jsdom here ships a non-functional localStorage,
 * so we drive the Tauri path: set `__TAURI_INTERNALS__` + mock plugin-store
 * with an in-memory map.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();

vi.mock('@tauri-apps/plugin-store', () => ({
  load: async () => ({
    async get(key: string) {
      return mem.has(key) ? mem.get(key) : undefined;
    },
    async set(key: string, val: string) {
      mem.set(key, val);
    },
    async delete(key: string) {
      mem.delete(key);
    },
    async keys() {
      return [...mem.keys()];
    },
  }),
}));

beforeEach(() => {
  mem.clear();
  // Make kv take the Tauri branch.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.resetModules();
});

async function freshKv() {
  // Re-import per test so the module-level store promise is rebuilt against
  // the freshly-reset mock.
  return (await import('./kv')).kv;
}

describe('kv · corrupt JSON (#124)', () => {
  it('returns null instead of throwing for a corrupt value', async () => {
    mem.set('bad', '{not valid json');
    const kv = await freshKv();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(kv.get('bad')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still reads well-formed values after a corrupt one was stored', async () => {
    mem.set('bad', 'oops[');
    const kv = await freshKv();
    await kv.set('good', { ok: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await kv.get('bad')).toBeNull();
    warn.mockRestore();
    expect(await kv.get('good')).toEqual({ ok: true });
  });

  it('round-trips normal values unchanged', async () => {
    const kv = await freshKv();
    await kv.set('n', [1, 2, 3]);
    expect(await kv.get('n')).toEqual([1, 2, 3]);
  });
});
