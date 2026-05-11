import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createStore,
  createMemoryAdapter,
  storeModuleKey,
  STORE_VERSION,
  runMigrations,
  readMeta,
  type Store,
  type StorageAdapter,
} from '../src/index';

let adapter: StorageAdapter;
let store: Store;

beforeEach(() => {
  adapter = createMemoryAdapter();
  store = createStore(adapter);
});

describe('@ollie/store · get / set', () => {
  it('returns defaultValue when the key is missing', () => {
    expect(store.get('cycle', 'items', [])).toEqual([]);
    expect(store.get('cycle', 'missing', 42)).toBe(42);
    expect(store.get('cycle', 'missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    store.set('cycle', 'items', [1, 2, 3]);
    expect(store.get('cycle', 'items')).toEqual([1, 2, 3]);
  });

  it('persists writes through the adapter', () => {
    store.set('cycle', 'items', ['a']);
    const raw = adapter.getItem(storeModuleKey('cycle'));
    expect(raw).toBe(JSON.stringify({ items: ['a'] }));
  });

  it('update() applies a function to the current value', () => {
    store.set('cycle', 'count', 0);
    store.update<number>('cycle', 'count', (c) => (c ?? 0) + 5);
    expect(store.get('cycle', 'count')).toBe(5);
  });

  it('remove() deletes the key from the module', () => {
    store.set('cycle', 'items', ['a']);
    store.remove('cycle', 'items');
    expect(store.get('cycle', 'items', null)).toBeNull();
  });
});

describe('@ollie/store · getModule / setModule', () => {
  it('getModule returns null when the module has no data', () => {
    expect(store.getModule('cycle')).toBeNull();
  });

  it('getModule returns a snapshot of all keys', () => {
    store.set('cycle', 'a', 1);
    store.set('cycle', 'b', 2);
    expect(store.getModule('cycle')).toEqual({ a: 1, b: 2 });
  });

  it('setModule atomically replaces module state', () => {
    store.set('cycle', 'a', 1);
    store.setModule('cycle', { newKey: true });
    expect(store.getModule('cycle')).toEqual({ newKey: true });
  });
});

describe('@ollie/store · subscriptions', () => {
  it('subscribeKey fires when that key is set', () => {
    const seen: unknown[] = [];
    store.subscribeKey('cycle', 'items', (v) => seen.push(v));
    store.set('cycle', 'items', [1]);
    store.set('cycle', 'items', [1, 2]);
    expect(seen).toEqual([[1], [1, 2]]);
  });

  it('subscribeKey does NOT fire for unrelated keys', () => {
    const seen: unknown[] = [];
    store.subscribeKey('cycle', 'items', (v) => seen.push(v));
    store.set('cycle', 'other', 'x');
    expect(seen).toEqual([]);
  });

  it('subscribe (whole module) fires on any key change', () => {
    const seen: unknown[] = [];
    store.subscribe('cycle', (snap) => seen.push(snap));
    store.set('cycle', 'a', 1);
    store.set('cycle', 'b', 2);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ a: 1, b: 2 });
  });

  it('unsubscribe stops further notifications', () => {
    const seen: unknown[] = [];
    const unsub = store.subscribeKey('cycle', 'items', (v) => seen.push(v));
    store.set('cycle', 'items', [1]);
    unsub();
    store.set('cycle', 'items', [1, 2]);
    expect(seen).toEqual([[1]]);
  });

  it('a throwing subscriber does not block others', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: unknown[] = [];
    store.subscribeKey('cycle', 'items', () => {
      throw new Error('boom');
    });
    store.subscribeKey('cycle', 'items', (v) => seen.push(v));
    store.set('cycle', 'items', [42]);
    expect(seen).toEqual([[42]]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('@ollie/store · resilience', () => {
  it('treats corrupt JSON as an empty module + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.setItem(storeModuleKey('cycle'), '{not valid json');
    expect(store.getModule('cycle')).toBeNull();
    expect(store.get('cycle', 'items', [])).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('_invalidateModule re-reads from the adapter and fires `*` subs', () => {
    const seen: unknown[] = [];
    store.subscribe('cycle', (snap) => seen.push(snap));
    // Simulate another tab writing directly
    adapter.setItem(storeModuleKey('cycle'), JSON.stringify({ external: true }));
    store._invalidateModule('cycle');
    expect(store.getModule('cycle')).toEqual({ external: true });
    expect(seen[seen.length - 1]).toEqual({ external: true });
  });
});

describe('@ollie/store · migrations', () => {
  it('writes meta with the current STORE_VERSION on first run', () => {
    runMigrations(adapter);
    const meta = readMeta(adapter);
    expect(meta.version).toBe(STORE_VERSION);
    expect(meta.lastOpenedAt).toBeTypeOf('number');
    expect(meta.migratedAt).toBeTypeOf('number');
  });

  it('skips migrations when already at STORE_VERSION', () => {
    runMigrations(adapter);
    const before = readMeta(adapter).migratedAt;
    runMigrations(adapter);
    const after = readMeta(adapter).migratedAt;
    expect(after).toBe(before); // migratedAt should NOT advance on no-op
  });

  it('runs registered migrations in version order', () => {
    const calls: number[] = [];
    runMigrations(adapter, {
      1: () => calls.push(1),
      2: () => calls.push(2),
      3: () => calls.push(3),
      4: () => calls.push(4),
      5: () => calls.push(5),
    });
    expect(calls).toEqual([1, 2, 3, 4, 5]);
  });

  it('a failing migration is logged AND halts subsequent migrations (audit C5)', () => {
    // Credibility audit C5: previously a failing migration was logged
    // and the rest continued, leaving the data in a half-migrated
    // state. Now: failing migration triggers a snapshot rollback and
    // halts. The meta version is NOT bumped so next boot retries.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: number[] = [];
    runMigrations(adapter, {
      2: () => {
        throw new Error('migration 2 broken');
      },
      3: () => calls.push(3),
    });
    expect(calls).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
