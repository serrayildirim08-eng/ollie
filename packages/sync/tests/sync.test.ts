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

interface CapturedUpsert {
  rows: unknown;
  authJwt: string | undefined;
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
          captured.upserts.push({ rows, authJwt: opts?.authJwt });
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
    // Flush enough microtask cycles to let the debounced upsert land.
    for (let i = 0; i < 20 && captured.upserts.length === 0; i++) {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    }
    // Single upsert for the latest snapshot
    expect(captured.upserts.length).toBe(1);
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
    // pushModule awaits encryptData (WebCrypto) before enqueueing. Under
    // fake timers the encrypt promise needs extra microtask cycles to
    // settle before the queue reflects the write. Mirror the bounded
    // retry pattern used in the coalesce test above.
    for (let i = 0; i < 20 && sync._inspect().queueDepth === 0; i++) {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    }
    expect(captured.upserts.length).toBe(0);
    expect(sync._inspect().queueDepth).toBeGreaterThan(0);

    // Reconnect
    online = true;
    setNextUpsert({ ok: true, status: 201 });
    await sync.syncOut();
    // Flush enough microtask cycles to let the async upsert land. CI
    // runners need more cycles than local; loop until populated or give
    // up after a bounded number of ticks.
    for (let i = 0; i < 20 && captured.upserts.length === 0; i++) {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    }
    expect(captured.upserts.length).toBeGreaterThan(0);
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
    store.set('shared', '_sync_local_ts.cycle', 10_000);

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
});
