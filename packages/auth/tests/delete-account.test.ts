/**
 * @ollie/auth · deleteAccount() — Sprint B' · server-cascade erasure
 *
 * Covers:
 *   - happy path (server 200 → local wipe + session cleared)
 *   - no-session guard
 *   - no-endpoint guard
 *   - 401 unauthorized → code='unauthorized', NO local wipe
 *   - 403 bad-confirm → code='bad-confirm', NO local wipe
 *   - 500 cascade-failed → code='cascade-failed', partial preserved, NO local wipe
 *   - 500 auth-delete-failed → code='auth-delete-failed', partial preserved, NO local wipe
 *   - network error → code='network', NO local wipe
 *   - body shape sent: bearer JWT + { confirm: "DELETE" }
 *   - local wipe scans every `void.state.*` key (not just store-managed mods)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter, storeModuleKey } from '@ollie/store';
import { createAuthClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';

const ENDPOINT = 'https://api.ollie.test/account/delete';

function makeFakeApi(): OllieAPI {
  return {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async () => ({ ok: true, status: 200, data: [] })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async () => ({ ok: true, status: 201, data: null })) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: vi.fn() as any,
      },
      auth: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signUp: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signInWithPassword: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        refresh: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signOut: vi.fn() as any,
      },
    },
  };
}

interface LocalStorageShim {
  store: Map<string, string>;
  length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
}

function installLocalStorageShim(): LocalStorageShim {
  const data = new Map<string, string>();
  const shim: LocalStorageShim = {
    store: data,
    get length() { return data.size; },
    key(i: number) {
      const keys = Array.from(data.keys());
      return keys[i] ?? null;
    },
    getItem(k) { return data.get(k) ?? null; },
    setItem(k, v) { data.set(k, v); },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); },
  };
  (globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = shim;
  return shim;
}

function seedSession(store: ReturnType<typeof createStore>) {
  store.set('shared', 'auth.session', {
    user_id: 'user-1',
    email: 'serra@example.com',
    access_token: 'jwt-token-aaa',
    refresh_token: 'rt',
    signed_in_at: new Date().toISOString(),
  });
}

let store: ReturnType<typeof createStore>;
let localShim: LocalStorageShim;

beforeEach(() => {
  store = createStore(createMemoryAdapter());
  localShim = installLocalStorageShim();
  // Seed module data so we can assert the wipe.
  localShim.setItem(storeModuleKey('shared'), '{"onboarded":true}');
  localShim.setItem(storeModuleKey('finance'), '{"records":[1,2,3]}');
  localShim.setItem(storeModuleKey('cycle'), '{"items":[]}');
  localShim.setItem('vendor:unrelated', 'leave-me');
});

describe('auth · deleteAccount · happy path', () => {
  it('200 → wipes local + clears session + posts bearer JWT and confirm token', async () => {
    seedSession(store);

    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({
        ok: true,
        user_id: 'user-1',
        deleted_tables: ['encrypted_state', 'finance_records', 'profiles'],
        deleted_rows: { encrypted_state: 9, finance_records: 142, profiles: 1 },
        auth_user_deleted: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const r = await auth.deleteAccount();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user_id).toBe('user-1');
    expect(r.deleted_tables).toContain('encrypted_state');
    expect(r.deleted_rows.finance_records).toBe(142);

    // Server received the right call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-token-aaa');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ confirm: 'DELETE' });

    // Session cleared.
    expect(auth.state().session).toBeNull();
    expect(auth.encryptionKey()).toBeNull();

    // localStorage wiped of every void.state.* key, unrelated keys preserved.
    expect(localShim.store.has(storeModuleKey('shared'))).toBe(false);
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(false);
    expect(localShim.store.has(storeModuleKey('cycle'))).toBe(false);
    expect(localShim.store.has('vendor:unrelated')).toBe(true);
  });
});

describe('auth · deleteAccount · guards', () => {
  it('no session → code=no-session, never hits server, local data preserved', async () => {
    const fetchMock = vi.fn();
    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('no-session');
    expect(fetchMock).not.toHaveBeenCalled();
    // module data still present
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
  });

  it('no endpoint configured → code=no-endpoint, no fetch, no wipe', async () => {
    seedSession(store);
    const fetchMock = vi.fn();
    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      // accountDeleteUrl deliberately unset
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('no-endpoint');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.state().session).not.toBeNull();
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
  });
});

describe('auth · deleteAccount · server failures preserve local data', () => {
  it('401 → unauthorized, NO local wipe, NO session clear', async () => {
    seedSession(store);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: 'bad-jwt', message: 'invalid' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      }),
    );
    const auth = createAuthClient({
      store, api: makeFakeApi(), accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthorized');
    // local untouched
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
    expect(auth.state().session).not.toBeNull();
  });

  it('403 → bad-confirm, NO wipe', async () => {
    seedSession(store);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: 'bad-confirm', message: 'x' }), {
        status: 403, headers: { 'content-type': 'application/json' },
      }),
    );
    const auth = createAuthClient({
      store, api: makeFakeApi(), accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-confirm');
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
  });

  it('500 cascade-failed → preserves partial result, NO wipe', async () => {
    seedSession(store);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: false,
        code: 'cascade-failed',
        message: 'failed mid-cascade',
        partial: {
          deleted_tables: ['encrypted_state'],
          deleted_rows: { encrypted_state: 5 },
          failed_table: 'finance_records',
          auth_user_deleted: false,
        },
      }), { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    const auth = createAuthClient({
      store, api: makeFakeApi(), accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('cascade-failed');
    expect(r.partial?.failed_table).toBe('finance_records');
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
    expect(auth.state().session).not.toBeNull();
  });

  it('500 auth-delete-failed → preserves partial, NO wipe', async () => {
    seedSession(store);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: false, code: 'auth-delete-failed',
        partial: { deleted_tables: ['encrypted_state', 'profiles'], deleted_rows: { encrypted_state: 1, profiles: 1 }, auth_user_deleted: false },
        message: 'admin delete failed',
      }), { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    const auth = createAuthClient({
      store, api: makeFakeApi(), accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('auth-delete-failed');
    expect(r.partial?.deleted_tables).toContain('profiles');
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
  });

  it('fetch throws → code=network, NO wipe', async () => {
    seedSession(store);
    const fetchMock = vi.fn(async () => {
      throw new Error('econnreset');
    });
    const auth = createAuthClient({
      store, api: makeFakeApi(), accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('network');
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(true);
    expect(auth.state().session).not.toBeNull();
  });
});
