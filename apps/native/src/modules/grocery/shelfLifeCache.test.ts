/**
 * shelfLifeCache · unit tests.
 *
 * Asserts:
 *   1. First load fetches the table when KV is empty.
 *   2. Cached load resolves immediately from memo (no extra fetch).
 *   3. ETag round-trips: a 304 reply leaves the existing memo intact.
 *   4. Direct + alias lookup work; unknowns return null.
 *   5. Network failure leaves an empty memo (UI degrades to "no aging").
 *   6. Name normalisation: case + whitespace tolerant.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── stub the worker client ────────────────────────────────────────────────
const getShelfLifeAllMock = vi.fn();
vi.mock('../../api/workers', () => ({
  getShelfLifeAll: (...args: unknown[]) => getShelfLifeAllMock(...args),
}));

// ── stub the kv store with an in-memory map so tests are hermetic ─────────
const kvStore = new Map<string, unknown>();
vi.mock('../../storage', () => ({
  kv: {
    async get<T>(k: string): Promise<T | null> {
      const v = kvStore.get(k);
      return v == null ? null : (v as T);
    },
    async set<T>(k: string, v: T): Promise<void> {
      kvStore.set(k, v);
    },
    async delete(k: string): Promise<void> {
      kvStore.delete(k);
    },
    async keys(): Promise<string[]> {
      return [...kvStore.keys()];
    },
  },
}));

import {
  __resetForTests,
  loadShelfLifeTable,
  lookupDays,
  refresh,
} from './shelfLifeCache';

beforeEach(() => {
  kvStore.clear();
  getShelfLifeAllMock.mockReset();
  __resetForTests();
});

describe('loadShelfLifeTable', () => {
  it('hydrates an empty table on first call and triggers a background refresh', async () => {
    getShelfLifeAllMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: { milk: 7 }, aliases: { 'skim milk': 'milk' }, version: 1 },
      etag: 'W/"abc"',
    });

    const t = await loadShelfLifeTable();
    expect(t.items).toEqual({}); // first synchronous return is empty (kv was empty)

    // Allow the fire-and-forget refresh to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(getShelfLifeAllMock).toHaveBeenCalledTimes(1);
    expect(getShelfLifeAllMock).toHaveBeenCalledWith({ ifNoneMatch: undefined });

    // After refresh the lookup picks up the new memo.
    expect(lookupDays('milk')).toBe(7);
    expect(lookupDays('skim milk')).toBe(7);
  });

  it('returns the memo immediately on subsequent calls', async () => {
    getShelfLifeAllMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: { milk: 7 }, aliases: {}, version: 1 },
      etag: null,
    });
    await loadShelfLifeTable();
    await new Promise((r) => setTimeout(r, 0));

    const second = await loadShelfLifeTable();
    expect(second.items.milk).toBe(7);
    // No second network call — memo is hot.
    expect(getShelfLifeAllMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates from KV first if a previous session persisted a table', async () => {
    kvStore.set('ollie:shelflife:v1', {
      items: { rice: 365 },
      aliases: {},
      version: 9,
    });
    // Worker times out — but disk hydrate already gave us a table.
    getShelfLifeAllMock.mockResolvedValue({
      ok: false,
      error: { code: 'timeout', message: 'timeout' },
    });
    await loadShelfLifeTable();
    await new Promise((r) => setTimeout(r, 0));
    expect(lookupDays('rice')).toBe(365);
  });
});

describe('refresh', () => {
  it('sends If-None-Match when a stored etag exists and is a no-op on 304', async () => {
    kvStore.set('ollie:shelflife:v1', {
      items: { milk: 7 },
      aliases: {},
      version: 1,
    });
    kvStore.set('ollie:shelflife:etag', 'W/"v1"');
    await loadShelfLifeTable(); // hydrate from disk first
    // Drain the first auto-refresh kicked by loadShelfLifeTable.
    getShelfLifeAllMock.mockResolvedValueOnce({ ok: true, status: 304, etag: 'W/"v1"' });
    await new Promise((r) => setTimeout(r, 0));

    // Explicit refresh — should use the stored etag.
    getShelfLifeAllMock.mockResolvedValueOnce({
      ok: true,
      status: 304,
      etag: 'W/"v1"',
    });
    await refresh();
    expect(getShelfLifeAllMock).toHaveBeenLastCalledWith({ ifNoneMatch: 'W/"v1"' });
    // Memo intact.
    expect(lookupDays('milk')).toBe(7);
  });

  it('updates memo + disk on 200', async () => {
    getShelfLifeAllMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: { milk: 7, eggs: 21 }, aliases: {}, version: 2 },
      etag: 'W/"v2"',
    });
    await loadShelfLifeTable();
    await new Promise((r) => setTimeout(r, 0));

    expect(lookupDays('eggs')).toBe(21);
    expect(kvStore.get('ollie:shelflife:etag')).toBe('W/"v2"');
    expect(kvStore.get('ollie:shelflife:v1')).toMatchObject({ version: 2 });
  });

  it('silently degrades on network failure (empty memo, UI shows no aging)', async () => {
    getShelfLifeAllMock.mockResolvedValue({
      ok: false,
      error: { code: 'network', message: 'offline' },
    });
    await loadShelfLifeTable();
    await new Promise((r) => setTimeout(r, 0));
    expect(lookupDays('milk')).toBeNull();
  });
});

describe('lookupDays', () => {
  beforeEach(async () => {
    getShelfLifeAllMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: { 'whole milk': 7, eggs: 21 },
        aliases: { 'milk': 'whole milk', 'large eggs': 'eggs' },
        version: 1,
      },
      etag: null,
    });
    await loadShelfLifeTable();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('resolves canonical names directly', () => {
    expect(lookupDays('whole milk')).toBe(7);
    expect(lookupDays('eggs')).toBe(21);
  });

  it('resolves aliases', () => {
    expect(lookupDays('milk')).toBe(7);
    expect(lookupDays('large eggs')).toBe(21);
  });

  it('returns null for unknown items', () => {
    expect(lookupDays('antimatter')).toBeNull();
    expect(lookupDays('')).toBeNull();
  });

  it('is case + whitespace tolerant', () => {
    expect(lookupDays('  WHOLE   Milk  ')).toBe(7);
    expect(lookupDays('Large Eggs')).toBe(21);
  });
});
