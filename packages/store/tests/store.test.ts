import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createStore,
  createMemoryAdapter,
  installCrossTabSync,
  storeModuleKey,
  STORE_VERSION,
  STORE_META_KEY,
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

describe('@ollie/store · set deep-equal no-op (#64)', () => {
  it('does NOT notify when the new value is structurally identical', () => {
    store.set('work', 'focus_log', [{ id: 'a', mins: 25 }]);
    const seen: unknown[] = [];
    store.subscribeKey('work', 'focus_log', (v) => seen.push(v));
    // A fresh array with identical shape (what the all-modules sweep builds).
    store.set('work', 'focus_log', [{ id: 'a', mins: 25 }]);
    expect(seen).toEqual([]); // no fan-out for unchanged data
  });

  it('whole-module `*` subscribers also stay quiet on a no-op set', () => {
    store.set('work', 'focus_log', [{ id: 'a' }]);
    const seen: unknown[] = [];
    store.subscribe('work', (snap) => seen.push(snap));
    store.set('work', 'focus_log', [{ id: 'a' }]);
    expect(seen).toEqual([]);
  });

  it('still notifies when a structurally different value arrives', () => {
    store.set('work', 'focus_log', [{ id: 'a', mins: 25 }]);
    const seen: unknown[] = [];
    store.subscribeKey('work', 'focus_log', (v) => seen.push(v));
    store.set('work', 'focus_log', [{ id: 'a', mins: 50 }]);
    expect(seen).toEqual([[{ id: 'a', mins: 50 }]]);
  });

  it('notifies the first time a key is set even if value equals default', () => {
    const seen: unknown[] = [];
    store.subscribeKey('cycle', 'items', (v) => seen.push(v));
    store.set('cycle', 'items', []);
    expect(seen).toEqual([[]]); // key did not exist before → must fire
  });
});

describe('@ollie/store · clone safety (#95)', () => {
  it('getModule returns a clone; mutating it does not corrupt the store', () => {
    store.set('cycle', 'a', { n: 1 });
    const snap = store.getModule('cycle')!;
    (snap as Record<string, unknown>).a = { n: 999 };
    (snap as Record<string, unknown>).injected = true;
    // Internal state untouched.
    expect(store.getModule('cycle')).toEqual({ a: { n: 1 } });
  });

  it('a `*` subscriber cannot corrupt the cache by mutating its snapshot', () => {
    store.set('cycle', 'a', 1);
    store.subscribe('cycle', (snap) => {
      if (snap) (snap as Record<string, unknown>).hacked = true;
    });
    store.set('cycle', 'b', 2);
    expect(store.getModule('cycle')).toEqual({ a: 1, b: 2 });
  });

  it('set does not mutate a previously-returned getModule snapshot', () => {
    store.set('cycle', 'a', 1);
    const earlier = store.getModule('cycle')!;
    store.set('cycle', 'b', 2);
    // The earlier snapshot is frozen-in-time, not retro-mutated.
    expect(earlier).toEqual({ a: 1 });
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

  // ─── audit item #14 · snapshot works on the memory adapter ────────────────

  it('captures a non-empty pre-migration snapshot on the memory adapter', () => {
    // Seed non-sensitive void.state.* keys — the snapshot must SEE these.
    adapter.setItem('void.state.work.items', '[1,2,3]');
    adapter.setItem('void.state.finance.bills', '{"a":1}');
    adapter.setItem('unrelated.key', 'ignored');

    const result = runMigrations(adapter, { 1: () => {} });

    // Before the fix this was 0 — the snapshot poked at adapter methods
    // the memory adapter did not implement, so it silently captured
    // nothing for every non-browser runtime.
    expect(result.snapshotKeyCount).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('EXCLUDES RAM-only sensitive module blobs from the plaintext snapshot (GAP 4)', () => {
    // Sensitive modules must NEVER be folded into the plaintext snapshot blob.
    adapter.setItem('void.state.cycle.v5', '{"cycles":["secret"]}');
    adapter.setItem('void.state.dump.v5', '{"items":["secret dump"]}');
    adapter.setItem('void.state.work.items', '{"a":1}'); // non-sensitive → kept

    const result = runMigrations(adapter, { 1: () => {} });

    // Only the non-sensitive key is snapshotted.
    expect(result.snapshotKeyCount).toBe(1);
    const snapKey = adapter
      .getAllKeys()
      .find((k) => k.startsWith('void.state._backup.pre_migration.'))!;
    const snapBlob = adapter.getItem(snapKey)!;
    expect(snapBlob).not.toContain('secret');
    expect(snapBlob).not.toContain('cycle');
    expect(snapBlob).not.toContain('dump');
  });

  it('restores void.state.* keys from snapshot when a migration fails', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    adapter.setItem('void.state.work.items', 'ORIGINAL');

    const result = runMigrations(adapter, {
      2: (a) => {
        // Migration mutates data, then blows up.
        a.setItem('void.state.work.items', 'CORRUPTED');
        throw new Error('boom');
      },
    });

    // Rollback restored the pre-migration value.
    expect(adapter.getItem('void.state.work.items')).toBe('ORIGINAL');
    expect(result.ok).toBe(false);
    expect(result.failedVersion).toBe(2);
    // Meta version NOT bumped — next boot retries.
    expect(readMeta(adapter).version ?? 0).toBeLessThan(STORE_VERSION);
    errSpy.mockRestore();
  });

  it('returns a typed MigrationResult instead of the magic global', () => {
    // Clean global slate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__ollie_migration_failed;

    const ok = runMigrations(adapter, { 1: () => {} });
    expect(ok.ok).toBe(true);
    expect(ok.version).toBe(STORE_VERSION);
    expect(ok.ran).toBe(true);

    // The magic global is no longer written by either branch.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = createMemoryAdapter();
    const failed = runMigrations(fresh, { 1: () => { throw new Error('x'); } });
    expect(failed.ok).toBe(false);
    expect(failed.failedVersion).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).__ollie_migration_failed).toBeUndefined();
    errSpy.mockRestore();
  });
});

describe('@ollie/store · cross-tab sync (#120)', () => {
  // An adapter that exposes onChange so we can simulate a sibling tab writing
  // a key + assert which modules get invalidated.
  function makeOnChangeAdapter() {
    let handler: ((c: { key: string; newValue: string | null }) => void) | null = null;
    const adapter: StorageAdapter = {
      ...createMemoryAdapter(),
      onChange(h) {
        handler = h as typeof handler;
        return () => { handler = null; };
      },
    };
    return { adapter, fire: (key: string) => handler?.({ key, newValue: '{}' }) };
  }

  it('invalidates a real module when a sibling tab writes its key', () => {
    const { adapter, fire } = makeOnChangeAdapter();
    const s = createStore(adapter);
    const spy = vi.spyOn(s, '_invalidateModule');
    installCrossTabSync(s, adapter);
    fire(storeModuleKey('cycle'));
    expect(spy).toHaveBeenCalledWith('cycle');
  });

  it('SKIPS the `_sync` bookkeeping namespace (deny-list, #123)', () => {
    const { adapter, fire } = makeOnChangeAdapter();
    const s = createStore(adapter);
    const spy = vi.spyOn(s, '_invalidateModule');
    installCrossTabSync(s, adapter);
    // The `_sync` namespace (audit #120) carries cursor/queue/watermark
    // bookkeeping — a cross-tab write there must NOT invalidate anything.
    fire(storeModuleKey('_sync'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT broadly suppress every `_`-prefixed module (#123 deny-list, not prefix)', () => {
    const { adapter, fire } = makeOnChangeAdapter();
    const s = createStore(adapter);
    const spy = vi.spyOn(s, '_invalidateModule');
    installCrossTabSync(s, adapter);
    // A legitimate module that merely starts with `_` (not the bookkeeping
    // namespace) must still invalidate — the old broad `startsWith('_')`
    // filter would have silently dropped it.
    fire(storeModuleKey('_widget'));
    expect(spy).toHaveBeenCalledWith('_widget');
  });
});

describe('@ollie/store · cross-tab fans out to per-key subscribers (#94)', () => {
  it('_invalidateModule fires subscribeKey listeners, not just `*`', () => {
    const adapter = createMemoryAdapter();
    const s = createStore(adapter);
    // Prime the cache.
    s.set('cycle', 'items', [1]);
    const keySeen: unknown[] = [];
    const starSeen: unknown[] = [];
    s.subscribeKey('cycle', 'items', (v) => keySeen.push(v));
    s.subscribe('cycle', (snap) => starSeen.push(snap));

    // Sibling tab wrote a new module blob; invalidate.
    adapter.setItem(storeModuleKey('cycle'), JSON.stringify({ items: [1, 2, 3] }));
    s._invalidateModule('cycle');

    // Per-key subscriber must have received the new value (#94 — previously
    // only the `*` subscriber fired so bound components never re-rendered).
    expect(keySeen[keySeen.length - 1]).toEqual([1, 2, 3]);
    expect(starSeen[starSeen.length - 1]).toEqual({ items: [1, 2, 3] });
  });

  it('per-key subscriber receives undefined when its key vanished cross-tab', () => {
    const adapter = createMemoryAdapter();
    const s = createStore(adapter);
    s.set('cycle', 'items', [1]);
    const keySeen: unknown[] = [];
    s.subscribeKey('cycle', 'items', (v) => keySeen.push(v));

    adapter.setItem(storeModuleKey('cycle'), JSON.stringify({ other: true }));
    s._invalidateModule('cycle');

    expect(keySeen[keySeen.length - 1]).toBeUndefined();
  });
});

describe('@ollie/store · migration snapshot key collisions (#125)', () => {
  it('two same-ms snapshots on one adapter keep distinct keys (no overwrite)', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const a = createMemoryAdapter();
      a.setItem('void.state.cycle.items', 'V1');
      runMigrations(a, { 1: () => {} }); // snapshot 1 @ frozen ms

      // Force another migration pass at the SAME frozen ms by rewinding meta.
      a.setItem(STORE_META_KEY, JSON.stringify({ version: 0 }));
      a.setItem('void.state.cycle.items', 'V2');
      runMigrations(a, { 1: () => {} }); // snapshot 2 @ same ms

      // Pre-fix: both used the bare `...pre_migration.<ms>` key → the second
      // overwrote the first. Now the per-process counter suffix keeps them
      // distinct, so BOTH snapshots survive (subject to the keep=3 cap).
      const snaps = a.getAllKeys().filter((k) => k.includes('_backup.pre_migration.'));
      expect(snaps.length).toBe(2);
      expect(new Set(snaps).size).toBe(2);
    } finally {
      now.mockRestore();
    }
  });
});
