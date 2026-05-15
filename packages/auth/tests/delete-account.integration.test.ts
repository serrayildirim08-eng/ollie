/**
 * @ollie/auth · deleteAccount integration — full sign-up → delete loop.
 *
 * Threat-model coverage:
 *   - After a successful signUp the store carries the session + the
 *     local salt + encrypted server pw + module data. deleteAccount()
 *     must drop ALL of them after the server reports success.
 *   - The auth:signed_out event MUST fire so account-boot's sync
 *     teardown listener tears the sync clients down (no zombie sync
 *     after the server row is gone).
 *   - encryptionKey() returns null post-delete (no leak of the AES key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter, storeModuleKey } from '@ollie/store';
import * as events from '@ollie/events';
import { createAuthClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';

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
      },
      auth: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signUp: vi.fn(async () => ({
          ok: true, status: 200,
          data: { user: { id: 'user-1' }, session: { access_token: 'jwt-token', refresh_token: 'rt' } },
        })) as any,
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
}

function installLocalStorageShim(): LocalStorageShim {
  const data = new Map<string, string>();
  const shim: LocalStorageShim = {
    store: data,
    get length() { return data.size; },
    key(i: number) { return Array.from(data.keys())[i] ?? null; },
    getItem(k) { return data.get(k) ?? null; },
    setItem(k, v) { data.set(k, v); },
    removeItem(k) { data.delete(k); },
  };
  (globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = shim;
  return shim;
}

let store: ReturnType<typeof createStore>;
let localShim: LocalStorageShim;

beforeEach(() => {
  store = createStore(createMemoryAdapter());
  localShim = installLocalStorageShim();
});

describe('auth · deleteAccount full loop', () => {
  it('signUp → deleteAccount → session/key/local data all gone + signed_out emitted', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true, user_id: 'user-1',
        deleted_tables: ['encrypted_state', 'profiles'],
        deleted_rows: { encrypted_state: 7, profiles: 1 },
        auth_user_deleted: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: 'https://api.test/account/delete',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });

    // Seed some "real" module data that would be left over from
    // module use post-signup.
    localShim.setItem(storeModuleKey('finance'), '{"records":[1,2]}');
    localShim.setItem(storeModuleKey('habits'), '{"streaks":[]}');

    // Listen for signed_out — must fire after successful delete.
    const signedOutSpy = vi.fn();
    events.on('auth:signed_out', signedOutSpy);

    expect(auth.state().session?.email).toBe('serra@example.com');
    expect(auth.encryptionKey()).not.toBeNull();

    const r = await auth.deleteAccount();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deleted_rows.encrypted_state).toBe(7);

    // After delete: session + key + module data all cleared.
    expect(auth.state().session).toBeNull();
    expect(auth.encryptionKey()).toBeNull();
    expect(localShim.store.has(storeModuleKey('finance'))).toBe(false);
    expect(localShim.store.has(storeModuleKey('habits'))).toBe(false);
    expect(signedOutSpy).toHaveBeenCalled();
  });
});
