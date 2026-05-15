/**
 * @ollie/sync · finance per-record tests
 *
 * Validates:
 *   - encrypt → upsert → pull → decrypt round-trip
 *   - delete is propagated as a tombstone (deleted_at set)
 *   - consent gate (necessary off / sync off → 0 network calls)
 *   - tampered ciphertext fails closed (row skipped, store unchanged)
 *   - RLS hardening at the client layer: every read+write filters
 *     by user_id (defense in depth; the migration enforces RLS too)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { deriveKey, randomSalt, bytesToBase64, encryptData } from '@ollie/crypto';
import { createFinanceSyncClient } from '../src/finance';
import type { RemoteFinanceRow } from '../src/finance';
import type { OllieAPI } from '@ollie/api';

interface CapturedUpsert {
  table: string;
  rows: unknown;
  authJwt: string | undefined;
}

interface CapturedDelete {
  table: string;
  params: Record<string, string> | undefined;
  authJwt: string | undefined;
}

interface CapturedGet {
  table: string;
  params: Record<string, string> | undefined;
  authJwt: string | undefined;
}

function makeFakeApi() {
  const captured: {
    upserts: CapturedUpsert[];
    deletes: CapturedDelete[];
    gets: CapturedGet[];
    nextGetRows: RemoteFinanceRow[];
  } = { upserts: [], deletes: [], gets: [], nextGetRows: [] };

  let nextUpsertOk = true;

  const api: OllieAPI = {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async (table: string, opts: any) => {
          captured.gets.push({ table, params: opts?.params, authJwt: opts?.authJwt });
          const rows = captured.nextGetRows;
          // Drain once — subsequent pages return empty so syncIn terminates.
          captured.nextGetRows = [];
          return { ok: true, status: 200, data: rows };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async (table: string, rows: any, opts: any) => {
          captured.upserts.push({ table, rows, authJwt: opts?.authJwt });
          if (nextUpsertOk) return { ok: true, status: 201, data: rows };
          return { ok: false, error: { code: 'http', status: 500, message: 'x' } };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn(async (table: string, opts: any) => {
          captured.deletes.push({ table, params: opts?.params, authJwt: opts?.authJwt });
          return { ok: true, status: 204, data: null };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { signUp: vi.fn() as any, signInWithPassword: vi.fn() as any, refresh: vi.fn() as any, signOut: vi.fn() as any },
    },
  };
  return { api, captured, setNextUpsertOk(v: boolean) { nextUpsertOk = v; } };
}

let store: ReturnType<typeof createStore>;
let key: CryptoKey;

beforeEach(async () => {
  vi.useFakeTimers();
  store = createStore(createMemoryAdapter());
  // Both gates ON by default for the encrypted-sync path.
  store.set('shared', 'settings.sync', { enabled: true });
  // Görev 1: writes the LEGACY key on purpose — exercises the
  // legacy-fallback bridge in hasNecessaryConsent() so a returning
  // pre-consolidation install is proven to keep syncing.
  store.set('shared', 'consent.necessary', true);
  key = await deriveKey('correct-horse-battery-staple-finance', randomSalt());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('finance sync · consent + opt-in gates', () => {
  it('sync.enabled=false → 0 network calls', async () => {
    store.set('shared', 'settings.sync', { enabled: false });
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await sync.start();
    store.set('finance', 'bills', [{ id: 'b1', amount: 100, last_edited_at: 1000 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(captured.upserts.length).toBe(0);
    expect(captured.deletes.length).toBe(0);
    expect(captured.gets.length).toBe(0);
    sync.stop();
  });

  it('consent.necessary=false → 0 network calls (defense in depth)', async () => {
    store.set('shared', 'consent.necessary', false);
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await sync.start();
    store.set('finance', 'bills', [{ id: 'b1', amount: 100, last_edited_at: 1000 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(captured.upserts.length).toBe(0);
    expect(captured.gets.length).toBe(0);
    sync.stop();
  });
});

describe('finance sync · outbound encryption + upsert', () => {
  it('encrypts each added bill and upserts to finance_records with iv+ciphertext', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'user-a', authJwt: 'jwt-a', encryptionKey: key,
      now: () => 5000,
    });
    await sync.start();
    captured.upserts.length = 0;

    store.set('finance', 'bills', [
      { id: 'b1', amount: 49.99, merchant: 'electric', last_edited_at: 5000 },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(captured.upserts.length).toBe(1);
    expect(captured.upserts[0].table).toBe('finance_records');
    const rows = captured.upserts[0].rows as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.id).toBe('b1');
    expect(row.user_id).toBe('user-a');
    expect(row.module).toBe('finance');
    expect(row.record_type).toBe('bill');
    expect(row.encrypted_payload).toBeTypeOf('string');
    expect(row.iv).toBeTypeOf('string');
    expect(row.deleted_at).toBeNull();
    // critical: server NEVER sees the merchant string
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('electric');
    expect(serialized).not.toContain('49.99');
    expect(captured.upserts[0].authJwt).toBe('jwt-a');
    sync.stop();
  });

  it('does NOT re-upsert when the same row is written twice with identical contents', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await sync.start();
    captured.upserts.length = 0;

    const row = { id: 'b1', amount: 10, last_edited_at: 1000 };
    store.set('finance', 'bills', [row]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    const firstCount = captured.upserts.length;

    // Same structural value — diff should detect no change.
    store.set('finance', 'bills', [{ ...row }]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    // No drain triggered because queue is empty, so upserts unchanged.
    expect(captured.upserts.length).toBe(firstCount);
    sync.stop();
  });

  it('issues a hard delete with user_id filter when a row is removed locally', async () => {
    const { api, captured } = makeFakeApi();
    store.set('finance', 'bills', [
      { id: 'b1', amount: 10, last_edited_at: 1000 },
      { id: 'b2', amount: 20, last_edited_at: 1000 },
    ]);
    const sync = createFinanceSyncClient({
      store, api, userId: 'user-a', authJwt: 'jwt', encryptionKey: key, now: () => 2000,
    });
    await sync.start();
    captured.upserts.length = 0;
    captured.deletes.length = 0;

    // Delete b2
    store.set('finance', 'bills', [{ id: 'b1', amount: 10, last_edited_at: 1000 }]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(captured.deletes.length).toBe(1);
    expect(captured.deletes[0].table).toBe('finance_records');
    // user_id filter on every delete — defense-in-depth even though RLS
    // also enforces ownership.
    expect(captured.deletes[0].params?.id).toBe('eq.b2');
    expect(captured.deletes[0].params?.user_id).toBe('eq.user-a');
    sync.stop();
  });
});

describe('finance sync · inbound decrypt + apply', () => {
  it('round-trip: encrypt locally, simulate remote row, pull, decrypt back into store', async () => {
    const { api, captured } = makeFakeApi();
    // Pre-build a remote row encrypted with the same key.
    const original = { id: 'b9', amount: 99.5, merchant: 'spotify', last_edited_at: 7000 };
    const enc = await encryptData(key, original);
    captured.nextGetRows = [{
      id: 'b9',
      user_id: 'u',
      module: 'finance',
      record_type: 'subscription',
      encrypted_payload: bytesToBase64(enc.ciphertext),
      iv: bytesToBase64(enc.iv),
      blob_version: 1,
      deleted_at: null,
      created_at: new Date(7000).toISOString(),
      updated_at: new Date(7000).toISOString(),
    }];

    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const subs = store.get<Array<Record<string, unknown>>>('finance', 'subscriptions', []);
    expect(subs?.length).toBe(1);
    expect(subs?.[0].id).toBe('b9');
    expect(subs?.[0].amount).toBe(99.5);
    expect(subs?.[0].merchant).toBe('spotify');

    // Pull filtered by user_id and ordered by updated_at — defense in depth.
    const firstGet = captured.gets[0];
    expect(firstGet.table).toBe('finance_records');
    expect(firstGet.params?.user_id).toBe('eq.u');
    expect(firstGet.params?.order).toBe('updated_at.asc');
    sync.stop();
  });

  it('tampered ciphertext: skip the row, store stays empty, no throw', async () => {
    const { api, captured } = makeFakeApi();
    const enc = await encryptData(key, { id: 'b9', amount: 1 });
    const ct = new Uint8Array(enc.ciphertext);
    ct[0] ^= 0xff; // flip a bit — AES-GCM auth tag rejects this
    captured.nextGetRows = [{
      id: 'b9',
      user_id: 'u',
      module: 'finance',
      record_type: 'bill',
      encrypted_payload: bytesToBase64(ct),
      iv: bytesToBase64(enc.iv),
      blob_version: 1,
      deleted_at: null,
      created_at: new Date(7000).toISOString(),
      updated_at: new Date(7000).toISOString(),
    }];

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(store.get('finance', 'bills', [])).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    sync.stop();
  });

  it('tombstone row removes a local entry with the same id', async () => {
    const { api, captured } = makeFakeApi();
    store.set('finance', 'bills', [{ id: 'b1', amount: 10, last_edited_at: 1000 }]);

    captured.nextGetRows = [{
      id: 'b1',
      user_id: 'u',
      module: 'finance',
      record_type: 'bill',
      encrypted_payload: '',  // tombstone — server stores an empty blob
      iv: bytesToBase64(new Uint8Array(12)),
      blob_version: 1,
      deleted_at: new Date(8000).toISOString(),
      created_at: new Date(8000).toISOString(),
      updated_at: new Date(8000).toISOString(),
    }];

    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(store.get('finance', 'bills', [])).toEqual([]);
    sync.stop();
  });

  it('cursor advances so the next pull only asks for newer rows', async () => {
    const { api, captured } = makeFakeApi();
    const enc = await encryptData(key, { id: 'b1', amount: 10 });
    captured.nextGetRows = [{
      id: 'b1', user_id: 'u', module: 'finance', record_type: 'bill',
      encrypted_payload: bytesToBase64(enc.ciphertext), iv: bytesToBase64(enc.iv),
      blob_version: 1, deleted_at: null,
      created_at: new Date(7000).toISOString(),
      updated_at: new Date(7000).toISOString(),
    }];

    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    // Manual second pull — params should now include updated_at gt cursor.
    await sync.syncIn();
    const lastGet = captured.gets[captured.gets.length - 1];
    expect(lastGet.params?.updated_at).toBe(`gt.${new Date(7000).toISOString()}`);
    sync.stop();
  });
});

describe('finance sync · RLS hardening at client layer', () => {
  it('every upsert row carries user_id from deps — never a foreign uid', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'user-a', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await sync.start();
    captured.upserts.length = 0;

    store.set('finance', 'bills', [{ id: 'b1', amount: 10, last_edited_at: 1000 }]);
    // Attempt to spoof — irrelevant, since the sync layer overwrites user_id.
    store.set('finance', 'subscriptions', [{ id: 's1', amount: 5, user_id: 'user-b', last_edited_at: 1000 }]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    for (const u of captured.upserts) {
      const rows = u.rows as Array<{ user_id: string }>;
      for (const r of rows) expect(r.user_id).toBe('user-a');
    }
    sync.stop();
  });

  it('every GET request filters by user_id (server RLS also enforces; this is defense in depth)', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'user-a', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    expect(captured.gets.length).toBeGreaterThan(0);
    for (const g of captured.gets) {
      expect(g.params?.user_id).toBe('eq.user-a');
    }
    sync.stop();
  });

  it('cross-user isolation: user B cannot decrypt user A ciphertext (wrong key)', async () => {
    const { api, captured } = makeFakeApi();
    // User A encrypts.
    const keyA = await deriveKey('passphrase-of-user-a-xxxxx', randomSalt());
    const encA = await encryptData(keyA, { id: 'b1', amount: 10, merchant: 'A-secret' });

    // Simulate the server returning that row to user B who has a
    // different derived key. Decryption MUST fail closed; store stays
    // empty.
    captured.nextGetRows = [{
      id: 'b1', user_id: 'user-b', module: 'finance', record_type: 'bill',
      encrypted_payload: bytesToBase64(encA.ciphertext), iv: bytesToBase64(encA.iv),
      blob_version: 1, deleted_at: null,
      created_at: new Date(7000).toISOString(),
      updated_at: new Date(7000).toISOString(),
    }];

    const keyB = await deriveKey('passphrase-of-user-b-xxxxx', randomSalt());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sync = createFinanceSyncClient({
      store, api, userId: 'user-b', authJwt: 'jwt', encryptionKey: keyB, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(store.get('finance', 'bills', [])).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    sync.stop();
  });
});
