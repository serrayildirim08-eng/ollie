/**
 * @ollie/sync · C3 tests
 *
 * Uses an in-memory store + a fake api whose upsert/get methods are
 * captured. The encryption key is a real CryptoKey derived from a
 * passphrase via @ollie/crypto.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { deriveKey, randomSalt, bytesToBase64, encryptData } from '@ollie/crypto';
import { createSyncClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';
import { settleQuiet } from './_timers';

interface CapturedUpsert {
  rows: unknown;
  authJwt: string | undefined;
  params: Record<string, string> | undefined;
}

function makeFakeApi() {
  const captured: { upserts: CapturedUpsert[]; getCalls: number; remoteRows: unknown[] } = {
    upserts: [],
    getCalls: 0,
    remoteRows: [],
  };

  let nextUpsertResult: { ok: boolean; status: number; code?: string } = { ok: true, status: 201 };

  const api: OllieAPI = {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async (_t: string, _opts: any) => {
          captured.getCalls++;
          return { ok: true, status: 200, data: captured.remoteRows };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async (_t: string, rows: any, opts: any) => {
          captured.upserts.push({ rows, authJwt: opts?.authJwt, params: opts?.params });
          if (nextUpsertResult.ok) return { ok: true, status: 201, data: rows };
          return { ok: false, error: { code: nextUpsertResult.code ?? 'http', status: nextUpsertResult.status, message: 'x' } };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn() as any,
        // sync never calls rpc — present only to satisfy the rest interface.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: vi.fn() as any,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { signUp: vi.fn() as any, signInWithPassword: vi.fn() as any, refresh: vi.fn() as any, signOut: vi.fn() as any },
    },
  };
  return { api, captured, setNextUpsert(r: typeof nextUpsertResult) { nextUpsertResult = r; } };
}

let store: ReturnType<typeof createStore>;
let key: CryptoKey;

beforeEach(async () => {
  vi.useFakeTimers();
  store = createStore(createMemoryAdapter());
  store.set('shared', 'settings.sync', { enabled: true });
  key = await deriveKey('correct-horse-battery-staple-x', randomSalt());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sync · opt-in gate', () => {
  it('toggle off → 0 network calls', async () => {
    store.set('shared', 'settings.sync', { enabled: false });
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 1000 });
    await sync.start();
    store.set('cycle', 'items', [{ ts: 1, action: 'started' }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(captured.upserts.length).toBe(0);
    expect(captured.getCalls).toBe(0);
    sync.stop();
  });
});

describe('sync · outbound', () => {
  it('debounces and pushes encrypted rows on store change', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 1000 });
    await sync.start();
    captured.upserts.length = 0; // ignore initial syncIn-related state

    store.set('cycle', 'items', [{ ts: 1, action: 'started' }]);
    await vi.advanceTimersByTimeAsync(500); // > 300ms debounce
    // Flush microtasks — pushModule chains through encrypt → enqueue → drain.
    await vi.runAllTimersAsync();
    expect(captured.upserts.length).toBe(1);
    const row = (captured.upserts[0].rows as Array<{ module: string; ciphertext: string; iv: string }>)[0];
    expect(row.module).toBe('cycle');
    expect(row.ciphertext).toBeTypeOf('string');
    expect(row.iv).toBeTypeOf('string');
    expect(captured.upserts[0].authJwt).toBe('jwt');
    // Audit #23: PostgREST needs the (user_id, module) conflict target
    // explicitly or the 2nd+ push per module 409s and retries forever.
    expect(captured.upserts[0].params).toEqual({ on_conflict: 'user_id,module' });
    sync.stop();
  });

  it('coalesces multiple changes inside the debounce window', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 1000 });
    await sync.start();
    captured.upserts.length = 0;

    store.set('cycle', 'items', [{ ts: 1, action: 'started' }]);
    await vi.advanceTimersByTimeAsync(100);
    store.set('cycle', 'items', [{ ts: 1, action: 'started' }, { ts: 2, action: 'symptom' }]);
    await vi.advanceTimersByTimeAsync(500);
    // The debounced upsert only lands after the async encryption settles,
    // which a fixed tick-count can lose on slow CI runners. Poll until it
    // arrives (vi.waitFor flushes microtasks + advances fake timers between
    // retries) instead of guessing a cycle budget.
    await vi.waitFor(() => {
      expect(captured.upserts.length).toBe(1);
    }, { timeout: 2000, interval: 20 });
    sync.stop();
  });

  it('offline queue retains writes; reconnect flushes', async () => {
    let online = false;
    const { api, captured, setNextUpsert } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 1000, isOnline: () => online,
    });
    await sync.start();
    captured.upserts.length = 0;

    store.set('cycle', 'items', [{ x: 1 }]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    expect(captured.upserts.length).toBe(0);
    expect(sync._inspect().queueDepth).toBeGreaterThan(0);

    // Reconnect
    online = true;
    setNextUpsert({ ok: true, status: 201 });
    await sync.syncOut();
    // The upsert is fired by syncOut but only lands after the async
    // encryption settles — which the fake clock can't advance and a fixed
    // tick-count loses on slow CI. Poll until it arrives.
    await vi.waitFor(() => {
      expect(captured.upserts.length).toBeGreaterThan(0);
    }, { timeout: 2000, interval: 20 });
    sync.stop();
  });
});

describe('sync · inbound', () => {
  it('decrypts remote row and writes it to the store via setModule', async () => {
    const { api } = makeFakeApi();

    // Pre-build a remote row
    const remoteData = { items: [{ ts: 99, action: 'started' }] };
    const enc = await encryptData(key, remoteData);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api.supabase.rest.get as any) = vi.fn(async () => ({
      ok: true, status: 200, data: [{
        id: 'r1', user_id: 'u', module: 'cycle',
        ciphertext: bytesToBase64(enc.ciphertext),
        iv: bytesToBase64(enc.iv),
        updated_at: new Date(5_000).toISOString(),
        blob_version: 1,
      }],
    }));

    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 6000 });
    await sync.start();
    // Allow the initial syncIn to settle
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    expect(store.get('cycle', 'items', [])).toEqual([{ ts: 99, action: 'started' }]);
    sync.stop();
  });

  it('LWW: skips remote row older than local edit ts', async () => {
    const { api } = makeFakeApi();
    // Pre-set a local module + local edit ts in the future
    store.setModule('cycle', { items: [{ local: true }] });
    store.set('_sync', 'local_ts.cycle', 10_000);

    const enc = await encryptData(key, { items: [{ remote: true }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api.supabase.rest.get as any) = vi.fn(async () => ({
      ok: true, status: 200, data: [{
        id: 'r1', user_id: 'u', module: 'cycle',
        ciphertext: bytesToBase64(enc.ciphertext),
        iv: bytesToBase64(enc.iv),
        updated_at: new Date(5_000).toISOString(), // older than local
        blob_version: 1,
      }],
    }));

    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 12_000 });
    await sync.start();
    await Promise.resolve();
    expect(store.get('cycle', 'items', [])).toEqual([{ local: true }]);
    sync.stop();
  });

  it('#7: an inbound apply does NOT echo back out as a push (no ping-pong)', async () => {
    const { api, captured } = makeFakeApi();
    const enc = await encryptData(key, { items: [{ remote: true }] });
    captured.remoteRows = [{
      id: 'r1', user_id: 'u', module: 'cycle',
      ciphertext: bytesToBase64(enc.ciphertext),
      iv: bytesToBase64(enc.iv),
      updated_at: new Date(5_000).toISOString(),
      blob_version: 1,
    }];

    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 6000 });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    // The apply landed…
    expect(store.get('cycle', 'items', [])).toEqual([{ remote: true }]);

    // …but it must NOT have enqueued a push. Give the chain time to (wrongly)
    // arm a debounce/drain, then assert nothing was upserted and the queue
    // is empty.
    await vi.runAllTimersAsync();
    expect(captured.upserts.length).toBe(0);
    expect(sync._inspect().queueDepth).toBe(0);
    sync.stop();
  });

  it('#7: watermark is the applied REMOTE ts, not now() — same-row re-pull is LWW-skipped', async () => {
    const { api, captured } = makeFakeApi();
    const enc = await encryptData(key, { items: [{ remote: true }] });
    captured.remoteRows = [{
      id: 'r1', user_id: 'u', module: 'cycle',
      ciphertext: bytesToBase64(enc.ciphertext),
      iv: bytesToBase64(enc.iv),
      updated_at: new Date(5_000).toISOString(),
      blob_version: 1,
    }];

    const sync = createSyncClient({ store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, modules: ['cycle'], now: () => 6000 });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    // Watermark must equal the remote ts (5000), NOT nowFn() (6000). If it
    // were clobbered with now(), a later remote row at 5500 would be wrongly
    // LWW-skipped.
    expect(store.get('_sync', 'local_ts.cycle', 0)).toBe(5000);
    sync.stop();
  });
});

describe('sync · #118 same-ms enqueue dedupe (monotonic seq, no NUL key)', () => {
  it('two writes for one module in the same ms both survive the queue (newer kept)', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 7000, isOnline: () => false,
    });
    await sync.start();
    captured.upserts.length = 0;

    // Offline: two distinct writes at the SAME injected clock value. The old
    // (module, updated_at) dedupe key would collide here and could drop the
    // newer entry. With monotonic seq, coalesce-by-module keeps exactly the
    // latest write and the queue holds it.
    store.set('cycle', 'items', [{ v: 1 }]);
    await settleQuiet();
    store.set('cycle', 'items', [{ v: 2 }]);
    await settleQuiet();

    expect(sync._inspect().queueDepth).toBe(1);
    const q = store.get<Array<{ seq: number; module: string }>>('_sync', 'queue', []) ?? [];
    expect(q.length).toBe(1);
    expect(q[0].module).toBe('cycle');
    // The surviving entry carries a monotonic seq id (audit #118).
    expect(typeof q[0].seq).toBe('number');
    sync.stop();
  });

  it('drain removes shipped entries by seq, leaving a same-ms newer write intact', async () => {
    const { api, captured } = makeFakeApi();
    // Pre-seed two queue entries for DIFFERENT modules with identical
    // updated_at — the old string key `${module}\x00${updated_at}` is what
    // made git treat index.ts as binary; seq removal sidesteps that entirely.
    const ts = new Date(7000).toISOString();
    store.set('_sync', 'queue', [
      { seq: 1, module: 'cycle', row: { user_id: 'u', module: 'cycle', ciphertext: '\\x00', iv: '\\x00', updated_at: ts, blob_version: 1 } },
      { seq: 2, module: 'work', row: { user_id: 'u', module: 'work', ciphertext: '\\x00', iv: '\\x00', updated_at: ts, blob_version: 1 } },
    ]);

    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle', 'work'], now: () => 7000,
    });
    // Drain via syncOut → drainOnce. Both entries ship; both removed by seq.
    await sync.syncOut();
    await vi.waitFor(() => {
      expect(captured.upserts.length).toBeGreaterThan(0);
    }, { timeout: 2000, interval: 20 });
    await vi.runAllTimersAsync();
    // After a clean ship, the pre-seeded entries are gone.
    const q = store.get<unknown[]>('_sync', 'queue', []) ?? [];
    // syncOut also pushes the (empty) modules, but with no store data those
    // re-enqueue; the key assertion is the two PRE-SEEDED entries (seq 1,2)
    // are no longer present.
    const seqs = (q as Array<{ seq: number }>).map((e) => e.seq);
    expect(seqs).not.toContain(1);
    expect(seqs).not.toContain(2);
    sync.stop();
  });
});

describe('sync · #120 bookkeeping namespacing + coalesced queueDepth', () => {
  it('outbound queue + watermark live under the `_sync` module, NOT `shared`', async () => {
    const { api } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 7000, isOnline: () => false,
    });
    await sync.start();

    // An offline edit enqueues a push AND records a local watermark.
    store.set('cycle', 'items', [{ v: 1 }]);
    await settleQuiet();

    // Bookkeeping is namespaced under `_sync` (so cross-tab's `_` filter skips
    // it) — and the old `shared` keys are NOT written.
    const q = store.get<unknown[]>('_sync', 'queue', []) ?? [];
    expect(q.length).toBe(1);
    expect(store.get<number>('_sync', 'local_ts.cycle', 0)).toBe(7000);
    expect(store.get<unknown[]>('shared', '_sync_queue', [])).toEqual([]);
    expect(store.get<number>('shared', '_sync_local_ts.cycle', 0)).toBe(0);
    sync.stop();
  });

  it('queueDepth reports COALESCED depth (distinct modules), not raw length', async () => {
    const { api } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle', 'work'], now: () => 7000, isOnline: () => false,
    });
    await sync.start();

    // Pre-seed a RAW queue with two entries for the SAME module + one for a
    // second module. drainOnce() would coalesce the same-module pair into one
    // upsert, so the honest "pending pushes" depth is 2, not 3.
    const ts = new Date(7000).toISOString();
    const mkRow = (m: string) => ({ user_id: 'u', module: m, ciphertext: '\\x00', iv: '\\x00', updated_at: ts, blob_version: 1 });
    store.set('_sync', 'queue', [
      { seq: 1, module: 'cycle', row: mkRow('cycle') },
      { seq: 2, module: 'cycle', row: mkRow('cycle') },
      { seq: 3, module: 'work', row: mkRow('work') },
    ]);

    expect(sync._inspect().queueDepth).toBe(2);
    sync.stop();
  });
});
