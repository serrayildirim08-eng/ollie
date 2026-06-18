/**
 * @ollie/sync · audit #1 round-trip — bytea hex wire format
 *
 * The encrypted_state / finance_records columns are Postgres `bytea`
 * with `check (octet_length(iv) = 12)`. PostgREST stores a string sent
 * for a bytea column verbatim, so a base64 IV (16 ASCII chars) landed as
 * 16 octets and EVERY write was rejected. The client must instead send
 * the Postgres `\x`+hex input literal so the IV stores as exactly 12
 * raw bytes.
 *
 * These tests pin the WIRE value: it must be `\x`-hex, never base64, and
 * a full encrypt → wire → decrypt round trip must restore the data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { deriveKey, randomSalt } from '@ollie/crypto';
import { createSyncClient, createFinanceSyncClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';

interface CapturedUpsert {
  rows: unknown;
  authJwt: string | undefined;
}

function makeFakeApi() {
  const captured: { upserts: CapturedUpsert[]; remoteRows: unknown[] } = {
    upserts: [],
    remoteRows: [],
  };
  const api: OllieAPI = {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async () => ({ ok: true, status: 200, data: captured.remoteRows })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async (_t: string, rows: any, opts: any) => {
          captured.upserts.push({ rows, authJwt: opts?.authJwt });
          return { ok: true, status: 201, data: rows };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn(async () => ({ ok: true, status: 200 })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: vi.fn() as any,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { signUp: vi.fn() as any, signInWithPassword: vi.fn() as any, refresh: vi.fn() as any, signOut: vi.fn() as any },
    },
  };
  return { api, captured };
}

const HEX_LITERAL = /^\\x[0-9a-f]+$/;

let store: ReturnType<typeof createStore>;
let key: CryptoKey;

beforeEach(async () => {
  vi.useFakeTimers();
  store = createStore(createMemoryAdapter());
  store.set('shared', 'settings.sync', { enabled: true });
  store.set('shared', 'consent.necessary', true);
  key = await deriveKey('correct-horse-battery-staple-x', randomSalt());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('audit #1 · encrypted_state wire format', () => {
  it('sends \\x-hex (not base64) and the IV is exactly 12 octets', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 1000,
    });
    await sync.start();
    captured.upserts.length = 0;

    store.set('cycle', 'items', [{ ts: 1, action: 'started' }]);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(captured.upserts.length).toBe(1);
    const row = (captured.upserts[0].rows as Array<{ ciphertext: string; iv: string }>)[0];

    // The load-bearing assertion: wire value is Postgres bytea hex, NOT base64.
    expect(row.iv).toMatch(HEX_LITERAL);
    expect(row.ciphertext).toMatch(HEX_LITERAL);
    expect(row.iv.startsWith('\\x')).toBe(true);

    // 12-byte IV → "\x" + 24 hex chars → octet_length on the server = 12,
    // satisfying `check (octet_length(iv) = 12)`. A base64 IV would be
    // 16 chars and trip the constraint.
    expect(row.iv.length).toBe(2 + 24);

    // Guard against base64 sneaking back in: base64 of a 12-byte IV
    // contains '=' padding or '+'/'/' or uppercase — none allowed in our hex.
    expect(/[A-Z+/=]/.test(row.iv)).toBe(false);

    sync.stop();
  });

  it('round-trips: the exact \\x-hex wire value decrypts back to the data', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 1000,
    });
    await sync.start();
    captured.upserts.length = 0;

    const payload = [{ ts: 7, action: 'symptom', note: 'round-trip' }];
    store.set('cycle', 'items', payload);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const wireRow = (captured.upserts[0].rows as Array<{
      ciphertext: string; iv: string; module: string;
    }>)[0];
    expect(wireRow.iv).toMatch(HEX_LITERAL);

    // Feed the EXACT wire row back through syncIn on a clean store —
    // proves the server-shaped \x-hex decodes without a base64 detour.
    const store2 = createStore(createMemoryAdapter());
    store2.set('shared', 'settings.sync', { enabled: true });
    const { api: api2, captured: cap2 } = makeFakeApi();
    cap2.remoteRows = [{
      id: 'r1',
      user_id: 'u',
      module: 'cycle',
      ciphertext: wireRow.ciphertext,
      iv: wireRow.iv,
      updated_at: new Date(9000).toISOString(),
      blob_version: 1,
    }];
    const sync2 = createSyncClient({
      store: store2, api: api2, userId: 'u', authJwt: 'jwt', encryptionKey: key,
      modules: ['cycle'], now: () => 9999,
    });
    await sync2.syncIn();

    expect(store2.get('cycle', 'items', null)).toEqual(payload);

    sync.stop();
    sync2.stop();
  });
});

describe('audit #1 · finance_records wire format', () => {
  it('sends \\x-hex (not base64) for encrypted_payload + iv', async () => {
    const { api, captured } = makeFakeApi();
    const fin = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 1000,
    });
    await fin.upsertRecord({ id: 'bill-1', amount: 42, last_edited_at: 1000 }, 'bill');
    // Drain the queue.
    await fin.syncOut();
    await vi.runAllTimersAsync();

    const upsertCall = captured.upserts.find((u) =>
      Array.isArray(u.rows) && (u.rows as Array<{ record_type?: string }>)[0]?.record_type,
    );
    expect(upsertCall).toBeTruthy();
    const row = (upsertCall!.rows as Array<{ encrypted_payload: string; iv: string }>)[0];

    expect(row.iv).toMatch(HEX_LITERAL);
    expect(row.encrypted_payload).toMatch(HEX_LITERAL);
    // 12-byte IV → "\x" + 24 hex chars.
    expect(row.iv.length).toBe(2 + 24);
    expect(/[A-Z+/=]/.test(row.iv)).toBe(false);

    fin.stop();
  });
});
