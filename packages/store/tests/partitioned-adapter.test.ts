import { describe, it, expect } from 'vitest';
import {
  partitionedAdapter,
  isSensitiveStoreKey,
  createMemoryAdapter,
  createStore,
  storeModuleKey,
  type StorageAdapter,
  type StorageChange,
} from '../src/index';

describe('isSensitiveStoreKey', () => {
  it('matches the sensitive module namespaces at any store version', () => {
    expect(isSensitiveStoreKey('void.state.cycle.v5')).toBe(true);
    expect(isSensitiveStoreKey('void.state.cycle.v4')).toBe(true);
    expect(isSensitiveStoreKey('void.state.medication.v5')).toBe(true);
    expect(isSensitiveStoreKey('void.state.mood.v5')).toBe(true);
    expect(isSensitiveStoreKey('void.state.dump.v5')).toBe(true);
    expect(isSensitiveStoreKey('void.state.journal.v5')).toBe(true);
  });

  it('does NOT match shared / auth-bearing or other modules', () => {
    expect(isSensitiveStoreKey('void.state.shared.v5')).toBe(false);
    expect(isSensitiveStoreKey('void.state.grocery.v5')).toBe(false);
    expect(isSensitiveStoreKey('void.state.work.v5')).toBe(false);
    expect(isSensitiveStoreKey('void.state._meta.v1')).toBe(false);
    // substring-but-not-prefix must not falsely match
    expect(isSensitiveStoreKey('void.state.moodboard.v5')).toBe(false);
    expect(isSensitiveStoreKey('something.cycle.v5')).toBe(false);
  });
});

describe('partitionedAdapter routing', () => {
  it('keeps sensitive keys in RAM and never writes them to the base', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);

    a.setItem(storeModuleKey('cycle'), JSON.stringify({ items: [1, 2] }));
    a.setItem(storeModuleKey('dump'), JSON.stringify({ items: [] }));

    // Readable through the wrapper...
    expect(a.getItem(storeModuleKey('cycle'))).toBe(JSON.stringify({ items: [1, 2] }));
    // ...but absent from the durable backend.
    expect(base.getItem(storeModuleKey('cycle'))).toBeNull();
    expect(base.getItem(storeModuleKey('dump'))).toBeNull();
  });

  it('passes non-sensitive keys straight through to the base', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);

    a.setItem(storeModuleKey('shared'), JSON.stringify({ salt: 'x' }));
    expect(base.getItem(storeModuleKey('shared'))).toBe(JSON.stringify({ salt: 'x' }));
    expect(a.getItem(storeModuleKey('shared'))).toBe(JSON.stringify({ salt: 'x' }));
  });

  it('removeItem routes correctly per partition', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);
    a.setItem(storeModuleKey('mood'), 'm');
    a.setItem(storeModuleKey('grocery'), 'g');

    a.removeItem(storeModuleKey('mood'));
    a.removeItem(storeModuleKey('grocery'));

    expect(a.getItem(storeModuleKey('mood'))).toBeNull();
    expect(a.getItem(storeModuleKey('grocery'))).toBeNull();
    expect(base.getItem(storeModuleKey('grocery'))).toBeNull();
  });

  it('one-time eviction pulls pre-existing plaintext off disk into RAM', () => {
    // Simulate an upgrade: sensitive plaintext already sitting in the backend.
    const base = createMemoryAdapter({
      [storeModuleKey('cycle')]: JSON.stringify({ items: ['secret'] }),
      [storeModuleKey('shared')]: JSON.stringify({ salt: 'keep' }),
    });

    const a = partitionedAdapter(base);

    // Sensitive value is wiped from disk...
    expect(base.getItem(storeModuleKey('cycle'))).toBeNull();
    // ...but still readable through the wrapper (continuity within session).
    expect(a.getItem(storeModuleKey('cycle'))).toBe(JSON.stringify({ items: ['secret'] }));
    // Non-sensitive value untouched on disk.
    expect(base.getItem(storeModuleKey('shared'))).toBe(JSON.stringify({ salt: 'keep' }));
  });

  it('getAllKeys unions both backends', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);
    a.setItem(storeModuleKey('cycle'), 'c'); // RAM
    a.setItem(storeModuleKey('shared'), 's'); // disk

    const keys = a.getAllKeys();
    expect(keys).toContain(storeModuleKey('cycle'));
    expect(keys).toContain(storeModuleKey('shared'));
    // no duplicates
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('delegates onChange to the base when present, omits it otherwise', () => {
    let registered = false;
    const baseWithChange: StorageAdapter = {
      ...createMemoryAdapter(),
      onChange(_handler: (c: StorageChange) => void) {
        registered = true;
        return () => {};
      },
    };
    const a = partitionedAdapter(baseWithChange);
    expect(typeof a.onChange).toBe('function');
    a.onChange?.(() => {});
    expect(registered).toBe(true);

    // memory adapter has no onChange → wrapper omits it too
    const a2 = partitionedAdapter(createMemoryAdapter());
    expect(a2.onChange).toBeUndefined();
  });

  it('is infallible: construction over a throwing getAllKeys does not throw', () => {
    const hostile: StorageAdapter = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      getAllKeys: () => {
        throw new Error('boom');
      },
    };
    expect(() => partitionedAdapter(hostile)).not.toThrow();
  });
});

describe('store over a partitioned adapter (watcher-read path)', () => {
  it('reads back sensitive module state synchronously within the session', () => {
    const base = createMemoryAdapter();
    const store = createStore(partitionedAdapter(base));

    store.set('cycle', 'items', [{ ts: 1, action: 'started' }]);
    // Synchronous read — exactly what the orchestrator's watchers do.
    expect(store.get('cycle', 'items')).toEqual([{ ts: 1, action: 'started' }]);
    // Nothing leaked to the durable backend.
    expect(base.getItem(storeModuleKey('cycle'))).toBeNull();
  });

  it('still fires subscribers for sensitive modules (watchers light up)', () => {
    const store = createStore(partitionedAdapter(createMemoryAdapter()));
    const seen: unknown[] = [];
    store.subscribeKey('dump', 'items', (v) => seen.push(v));
    store.set('dump', 'items', [{ ts: 1, text: 'hi' }]);
    expect(seen).toEqual([[{ ts: 1, text: 'hi' }]]);
  });
});
