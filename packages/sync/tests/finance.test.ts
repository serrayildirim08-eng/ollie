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
import { deriveKey, randomSalt, bytesToBase64, bytesToPgHex, encryptData } from '@ollie/crypto';
import { createFinanceSyncClient } from '../src/finance';
import type { RemoteFinanceRow } from '../src/finance';
import type { OllieAPI } from '@ollie/api';
import { settleUntil, settleQuiet } from './_timers';

const PAGE_LIMIT = 500;

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
        // sync never calls rpc — present only to satisfy the rest interface.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: vi.fn(async () => ({ ok: true, status: 200, data: [] })) as any,
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
    // Wait for the OUTCOME (the upsert), not for a timer. The chain crosses a
    // native crypto.subtle promise that fake timers do not control; a bare
    // advance+runAllTimersAsync can return before that promise arms the drain
    // timer — that is the documented flake.
    await settleUntil(() => captured.upserts.length >= 1);

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
    // First write IS a real change → wait for the upsert outcome.
    await settleUntil(() => captured.upserts.length >= 1);
    const firstCount = captured.upserts.length;

    // Same structural value — diff should detect no change. There is no
    // positive outcome to wait for here, so settle the chain quietly and
    // assert the absence of a new upsert.
    store.set('finance', 'bills', [{ ...row }]);
    await settleQuiet();
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
    await settleUntil(() => captured.deletes.length >= 1);

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
    // audit #6: composite (updated_at, id) ordering so boundary-timestamp
    // rows page deterministically (no skips).
    expect(firstGet.params?.order).toBe('updated_at.asc,id.asc');
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

  it('cursor advances so the next pull only asks for rows >= cursor (gte, audit #6)', async () => {
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

    // Manual second pull — params should now include updated_at gte cursor.
    // audit #6: gte. (not gt.) so rows sharing the boundary timestamp are
    // never skipped; the in-client seen-id dedupe prevents re-applying the
    // cursor row itself.
    await sync.syncIn();
    const lastGet = captured.gets[captured.gets.length - 1];
    expect(lastGet.params?.updated_at).toBe(`gte.${new Date(7000).toISOString()}`);
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
    // bills + subscriptions are separate store keys → two debounced diffs.
    // Wait until BOTH ids have been upserted (they may land in one batched
    // upsert call or two — either way both ids must appear).
    await settleUntil(() => {
      const ids = new Set<string>();
      for (const u of captured.upserts) {
        for (const r of u.rows as Array<{ id: string }>) ids.add(r.id);
      }
      return ids.has('b1') && ids.has('s1');
    });

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

// ──────────────────────────────────────────────────────────────────────────
// A PostgREST-faithful fake whose GET honours the cursor/keyset predicates the
// production syncIn builds. Backed by a fixed server-side row set so we can
// exercise multi-page paging, gte. boundary dedupe, and decrypt-failure clamp
// the way the real server would behave.
// ──────────────────────────────────────────────────────────────────────────
function makePagingApi(serverRows: RemoteFinanceRow[]) {
  const gets: Array<Record<string, string> | undefined> = [];
  // Stable (updated_at, id) ordering — matches the server's order clause.
  const sorted = [...serverRows].sort((a, b) =>
    a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function applyPredicate(p: Record<string, string> | undefined): RemoteFinanceRow[] {
    let rows = sorted;
    const ua = p?.updated_at;
    if (ua?.startsWith('gte.')) {
      const ts = ua.slice(4);
      rows = rows.filter((r) => r.updated_at >= ts);
    } else if (ua?.startsWith('gt.')) {
      const ts = ua.slice(3);
      rows = rows.filter((r) => r.updated_at > ts);
    }
    const or = p?.or;
    if (or) {
      // (updated_at.gt.TS,and(updated_at.eq.TS,id.gt.ID))
      const m = /\(updated_at\.gt\.([^,]+),and\(updated_at\.eq\.([^,]+),id\.gt\.([^)]+)\)\)/.exec(or);
      if (m) {
        const [, gtTs, eqTs, gtId] = m;
        rows = rows.filter((r) =>
          r.updated_at > gtTs || (r.updated_at === eqTs && r.id > gtId));
      }
    }
    return rows.slice(0, PAGE_LIMIT);
  }

  const api: OllieAPI = {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co', anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async (_t: string, opts: any) => {
          gets.push(opts?.params);
          return { ok: true, status: 200, data: applyPredicate(opts?.params) };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async (_t: string, rows: any) => ({ ok: true, status: 201, data: rows })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn(async () => ({ ok: true, status: 204, data: null })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: vi.fn(async () => ({ ok: true, status: 200, data: [] })) as any,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { signUp: vi.fn() as any, signInWithPassword: vi.fn() as any, refresh: vi.fn() as any, signOut: vi.fn() as any },
    },
  };
  return { api, gets };
}

async function makeRow(
  k: CryptoKey, id: string, ts: number, extra: Record<string, unknown> = {},
): Promise<RemoteFinanceRow> {
  const enc = await encryptData(k, { id, last_edited_at: ts, ...extra });
  return {
    id, user_id: 'u', module: 'finance', record_type: 'bill',
    encrypted_payload: bytesToPgHex(enc.ciphertext),
    iv: bytesToPgHex(enc.iv),
    blob_version: 1, deleted_at: null,
    created_at: new Date(ts).toISOString(),
    updated_at: new Date(ts).toISOString(),
  };
}

describe('finance sync · #5 decrypt-failure does not advance cursor past failed row', () => {
  it('a row that fails to decrypt is re-fetched on the next pull (no silent loss)', async () => {
    // Two applied rows below a corrupt row. The written cursor must clamp
    // strictly BELOW the failure (to the highest applied row at 1000) so the
    // next pull (gte.cursor) re-asks for the failed row at 2000 — never
    // jumps past it.
    const good1 = await makeRow(key, 'g1', 1000);
    const badEnc = await encryptData(key, { id: 'bad', last_edited_at: 2000 });
    const badCt = new Uint8Array(badEnc.ciphertext); badCt[0] ^= 0xff;
    const bad: RemoteFinanceRow = {
      id: 'bad', user_id: 'u', module: 'finance', record_type: 'bill',
      encrypted_payload: bytesToPgHex(badCt), iv: bytesToPgHex(badEnc.iv),
      blob_version: 1, deleted_at: null,
      created_at: new Date(2000).toISOString(), updated_at: new Date(2000).toISOString(),
    };

    const { api, gets } = makePagingApi([good1, bad]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    // Cursor must be the applied row strictly BELOW the failure (1000), not
    // 3000 — otherwise the failed row at 2000 could never be retried.
    expect(sync._inspect().cursor).toBe(new Date(1000).toISOString());

    // Next pull uses gte.1000 so it re-includes the 2000 failure row.
    await sync.syncIn();
    const lastGet = gets[gets.length - 1];
    expect(lastGet?.updated_at).toBe(`gte.${new Date(1000).toISOString()}`);

    warn.mockRestore();
    sync.stop();
  });
});

describe('finance sync · #6 boundary-timestamp paging (>PAGE_LIMIT rows at one ts)', () => {
  it('pages through 600 rows sharing one updated_at with zero loss and no infinite loop', async () => {
    const TS = 5000;
    const N = 600; // > PAGE_LIMIT (500)
    const rows: RemoteFinanceRow[] = [];
    for (let i = 0; i < N; i++) {
      // zero-pad ids so lexical id ordering == numeric (matches server).
      rows.push(await makeRow(key, `r${String(i).padStart(4, '0')}`, TS));
    }
    const { api } = makePagingApi(rows);
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const bills = store.get<Array<{ id: string }>>('finance', 'bills', []) ?? [];
    expect(bills.length).toBe(N);
    expect(new Set(bills.map((b) => b.id)).size).toBe(N);
    sync.stop();
  });

  it('two rows sharing a boundary timestamp across pulls are both applied (gte, no skip)', async () => {
    const a = await makeRow(key, 'aaa', 4000);
    const b = await makeRow(key, 'bbb', 4000); // same ts as a
    const { api } = makePagingApi([a, b]);
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 9000,
    });
    await sync.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    // Second pull at the SAME boundary must not re-apply, must not skip.
    await sync.syncIn();
    const bills = store.get<Array<{ id: string }>>('finance', 'bills', []) ?? [];
    expect(new Set(bills.map((x) => x.id))).toEqual(new Set(['aaa', 'bbb']));
    sync.stop();
  });
});

describe('finance sync · #117 outbound LWW timestamp falls back to created_at', () => {
  it('a row with created_at but no last_edited_at ships updated_at = created_at (not now())', async () => {
    const { api, captured } = makeFakeApi();
    const sync = createFinanceSyncClient({
      store, api, userId: 'u', authJwt: 'jwt', encryptionKey: key, now: () => 999999,
    });
    await sync.start();
    captured.upserts.length = 0;

    store.set('finance', 'bills', [{ id: 'b1', amount: 10, created_at: 4242 }]);
    await settleUntil(() => captured.upserts.length >= 1);

    const row = (captured.upserts[0].rows as Array<Record<string, unknown>>)[0];
    // Mirrors inbound precedence: last_edited_at ?? created_at ?? now().
    // Must be created_at (4242), NOT now() (999999).
    expect(row.updated_at).toBe(new Date(4242).toISOString());
    sync.stop();
  });
});
