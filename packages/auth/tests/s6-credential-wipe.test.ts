/**
 * @ollie/auth · S6 — account deletion must leave NO credential material.
 *
 * The pre-fix local wipe only scanned `void.state.*` localStorage keys. It
 * left the salt + encrypted_server_pw (and the per-email variants, and
 * `auth.email_for_login`) recoverable — an attacker with device access
 * could still brute-force them. Worse, the store's in-memory module cache
 * still held them, so a later write to the `shared` module re-flushed and
 * RESURRECTED the keys.
 *
 * These tests assert every credential key is gone from the store after
 * `deleteAccount`, AND that it cannot be resurrected by a later write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createAuthClient, wipeAuthCredentials } from '../src/index';
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

/** Every auth credential key, seeded as the running app would write them. */
const SALT_KEY = 'shared.auth.salt';
const PW_KEY = 'shared.auth.encrypted_server_pw';
const SALT_EMAIL_A = 'shared.auth.salt_by_email.serra@example.com';
const SALT_EMAIL_B = 'shared.auth.salt_by_email.alt@example.com';
const PW_EMAIL_A = 'shared.auth.encrypted_server_pw_by_email.serra@example.com';
const PW_EMAIL_B = 'shared.auth.encrypted_server_pw_by_email.alt@example.com';

function seedCredentials(store: ReturnType<typeof createStore>) {
  store.set('shared', 'auth.session', {
    user_id: 'user-1',
    email: 'serra@example.com',
    access_token: 'jwt-token-aaa',
    refresh_token: 'rt',
    signed_in_at: new Date().toISOString(),
  });
  store.set('shared', 'auth.email_for_login', 'serra@example.com');
  store.set('shared', SALT_KEY, 'c2FsdC1iYXNlNjQ=');
  store.set('shared', PW_KEY, '{"iv":"aXY=","ct":"Y3Q=","kdf_iter":600000}');
  store.set('shared', SALT_EMAIL_A, 'c2FsdC1hLWJhc2U2NA==');
  store.set('shared', SALT_EMAIL_B, 'c2FsdC1iLWJhc2U2NA==');
  store.set('shared', PW_EMAIL_A, '{"iv":"aXY=","ct":"Y3RB"}');
  store.set('shared', PW_EMAIL_B, '{"iv":"aXY=","ct":"Y3RC"}');
  // A non-credential `shared` key that must SURVIVE the credential wipe.
  store.set('shared', 'settings.theme', 'cream');
}

const ALL_CREDENTIAL_KEYS = [
  'auth.session',
  'auth.email_for_login',
  SALT_KEY,
  PW_KEY,
  SALT_EMAIL_A,
  SALT_EMAIL_B,
  PW_EMAIL_A,
  PW_EMAIL_B,
];

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore(createMemoryAdapter());
});

describe('auth · S6 · wipeAuthCredentials (direct)', () => {
  it('removes every fixed + per-email credential key', () => {
    seedCredentials(store);
    wipeAuthCredentials(store);
    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).toBe('__ABSENT__');
    }
  });

  it('leaves non-credential `shared` keys intact', () => {
    seedCredentials(store);
    wipeAuthCredentials(store);
    expect(store.get('shared', 'settings.theme', null)).toBe('cream');
  });

  it('the keys cannot be RESURRECTED by a later write to the shared module', () => {
    seedCredentials(store);
    wipeAuthCredentials(store);
    // A subsequent write to an unrelated `shared` key must not re-flush a
    // stale cached blob carrying the deleted credential keys.
    store.set('shared', 'settings.locale', 'en');
    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).toBe('__ABSENT__');
    }
    expect(store.get('shared', 'settings.locale', null)).toBe('en');
  });

  it('is idempotent — a second call on an already-wiped store is a no-op', () => {
    seedCredentials(store);
    wipeAuthCredentials(store);
    expect(() => wipeAuthCredentials(store)).not.toThrow();
    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).toBe('__ABSENT__');
    }
  });

  it('handles an empty store without throwing', () => {
    expect(() => wipeAuthCredentials(store)).not.toThrow();
  });
});

describe('auth · S6 · deleteAccount wipes credential material', () => {
  it('after a successful deleteAccount, NO auth credential key remains', async () => {
    seedCredentials(store);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, user_id: 'user-1', deleted_tables: [], deleted_rows: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const r = await auth.deleteAccount();
    expect(r.ok).toBe(true);

    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).toBe('__ABSENT__');
    }
    expect(auth.state().session).toBeNull();
    expect(auth.encryptionKey()).toBeNull();
  });

  it('a write after deleteAccount does not resurrect any credential key', async () => {
    seedCredentials(store);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, user_id: 'user-1', deleted_tables: [], deleted_rows: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await auth.deleteAccount();

    // App keeps running; something writes to `shared` again.
    store.set('shared', 'settings.onboarded', true);
    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).toBe('__ABSENT__');
    }
  });

  it('a FAILED deleteAccount (server 401) leaves credentials INTACT (retry-safe)', async () => {
    seedCredentials(store);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: 'bad-jwt' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const auth = createAuthClient({
      store,
      api: makeFakeApi(),
      accountDeleteUrl: ENDPOINT,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const r = await auth.deleteAccount();
    expect(r.ok).toBe(false);
    // Server rejected → nothing wiped → the user can retry.
    for (const k of ALL_CREDENTIAL_KEYS) {
      expect(store.get('shared', k, '__ABSENT__')).not.toBe('__ABSENT__');
    }
  });
});
