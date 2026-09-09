import { describe, it, expect } from 'vitest';
import {
  partitionedAdapter,
  isSensitiveStoreKey,
  sensitiveBlobFieldsFor,
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

describe('sensitiveBlobFieldsFor', () => {
  it('flags shared.actionLog as a sensitive sub-field at any version', () => {
    expect(sensitiveBlobFieldsFor('void.state.shared.v5')).toEqual(['actionLog']);
    expect(sensitiveBlobFieldsFor('void.state.shared.v4')).toEqual(['actionLog']);
  });
  it('returns null for other blobs', () => {
    expect(sensitiveBlobFieldsFor('void.state.grocery.v5')).toBeNull();
    expect(sensitiveBlobFieldsFor('void.state.cycle.v5')).toBeNull();
  });
});

describe('partitionedAdapter blob-field partitioning (shared.actionLog)', () => {
  it('strips actionLog from the on-disk shared blob but serves it through the wrapper', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);

    const full = {
      salt: 'keep',
      consent: true,
      actionLog: [{ ts: 1, rawText: 'i took my meds and felt low', undone: false }],
    };
    a.setItem(storeModuleKey('shared'), JSON.stringify(full));

    // Disk copy must NOT contain the raw dump text.
    const onDisk = base.getItem(storeModuleKey('shared'))!;
    expect(onDisk).not.toContain('actionLog');
    expect(onDisk).not.toContain('took my meds');
    expect(JSON.parse(onDisk)).toEqual({ salt: 'keep', consent: true });

    // ...but the wrapper still returns the complete blob within the session.
    expect(JSON.parse(a.getItem(storeModuleKey('shared'))!)).toEqual(full);
  });

  it('persists non-sensitive shared fields across a simulated reboot, drops actionLog', () => {
    const base = createMemoryAdapter();
    const a1 = partitionedAdapter(base);
    a1.setItem(
      storeModuleKey('shared'),
      JSON.stringify({ salt: 'keep', actionLog: [{ ts: 9, rawText: 'secret' }] }),
    );

    // New process: fresh wrapper over the SAME durable backend.
    const a2 = partitionedAdapter(base);
    const blob = JSON.parse(a2.getItem(storeModuleKey('shared'))!);
    expect(blob.salt).toBe('keep'); // durable field survives
    expect(blob.actionLog).toBeUndefined(); // RAM-only field is gone (rebuilt from SQLite by bridges)
    expect(base.getItem(storeModuleKey('shared'))).not.toContain('secret');
  });

  it('one-time eviction strips actionLog from a pre-existing plaintext shared blob', () => {
    const base = createMemoryAdapter({
      [storeModuleKey('shared')]: JSON.stringify({
        salt: 'keep',
        actionLog: [{ ts: 1, rawText: 'pre-existing plaintext leak' }],
      }),
    });
    const a = partitionedAdapter(base);

    // Disk is rewritten redacted immediately at construction.
    expect(base.getItem(storeModuleKey('shared'))).not.toContain('plaintext leak');
    expect(JSON.parse(base.getItem(storeModuleKey('shared'))!)).toEqual({ salt: 'keep' });
    // Still readable in-session.
    expect(JSON.parse(a.getItem(storeModuleKey('shared'))!).actionLog).toEqual([
      { ts: 1, rawText: 'pre-existing plaintext leak' },
    ]);
  });

  it('clears a stale overlay when a later write drops actionLog', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);
    a.setItem(storeModuleKey('shared'), JSON.stringify({ salt: 's', actionLog: [{ ts: 1 }] }));
    // Next write has no actionLog at all.
    a.setItem(storeModuleKey('shared'), JSON.stringify({ salt: 's' }));
    expect(JSON.parse(a.getItem(storeModuleKey('shared'))!)).toEqual({ salt: 's' });
  });

  it('does not expose internal overlay keys via getAllKeys', () => {
    const base = createMemoryAdapter();
    const a = partitionedAdapter(base);
    a.setItem(storeModuleKey('shared'), JSON.stringify({ salt: 's', actionLog: [{ ts: 1 }] }));
    const keys = a.getAllKeys();
    expect(keys).toContain(storeModuleKey('shared'));
    expect(keys.some((k) => k.includes('blob-fields'))).toBe(false);
  });

  it('store over the adapter keeps actionLog readable for watchers, off disk', () => {
    const base = createMemoryAdapter();
    const store = createStore(partitionedAdapter(base));
    store.set('shared', 'salt', 'keep');
    store.set('shared', 'actionLog', [{ ts: 1, rawText: 'low mood today', undone: false }]);

    // Watcher read path sees the full actionLog synchronously.
    expect(store.get('shared', 'actionLog')).toEqual([
      { ts: 1, rawText: 'low mood today', undone: false },
    ]);
    // Auth/consent field still persists to disk.
    expect(JSON.parse(base.getItem(storeModuleKey('shared'))!).salt).toBe('keep');
    // Raw dump text never reaches disk.
    expect(base.getItem(storeModuleKey('shared'))).not.toContain('low mood today');
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
