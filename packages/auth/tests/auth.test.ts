/**
 * @ollie/auth · C5 tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createAuthClient } from '../src/index';
import type { OllieAPI } from '@ollie/api';

interface FakeApiState {
  signUpResult: { ok: boolean; status?: number; data?: unknown; code?: string };
  signInResult: { ok: boolean; status?: number; data?: unknown; code?: string };
  signOutCalled: number;
  upsertedProfiles: unknown[];
  profileSaltLookup: { [userId: string]: string };
}

function makeFakeApi(state: FakeApiState): OllieAPI {
  return {
    request: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anthropic: { proxyUrl: null, route: vi.fn() as any },
    supabase: {
      url: 'https://x.supabase.co',
      anonKey: 'anon',
      rest: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: vi.fn(async (table: string, opts: any) => {
          if (table === 'profiles') {
            const m = String(opts?.params?.id ?? '').match(/eq\.(.+)/);
            const userId = m?.[1];
            if (userId && state.profileSaltLookup[userId]) {
              return { ok: true, status: 200, data: [{ salt: state.profileSaltLookup[userId] }] };
            }
            return { ok: true, status: 200, data: [] };
          }
          return { ok: true, status: 200, data: [] };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async (table: string, rows: any) => {
          if (table === 'profiles') state.upsertedProfiles.push(...rows);
          return { ok: true, status: 201, data: rows };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn() as any,
      },
      auth: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signUp: vi.fn(async () => state.signUpResult.ok
          ? { ok: true, status: 200, data: state.signUpResult.data }
          : { ok: false, error: { code: state.signUpResult.code ?? 'http', status: state.signUpResult.status ?? 400, message: 'x' } }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signInWithPassword: vi.fn(async () => state.signInResult.ok
          ? { ok: true, status: 200, data: state.signInResult.data }
          : { ok: false, error: { code: state.signInResult.code ?? 'http', status: state.signInResult.status ?? 400, message: 'x' } }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        refresh: vi.fn() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signOut: vi.fn(async () => { state.signOutCalled++; return { ok: true, status: 200, data: null }; }) as any,
      },
    },
  };
}

let store: ReturnType<typeof createStore>;
let fakeState: FakeApiState;

beforeEach(() => {
  store = createStore(createMemoryAdapter());
  fakeState = {
    signUpResult: { ok: true, data: { user: { id: 'user-1' }, session: { access_token: 'a', refresh_token: 'r' } } },
    signInResult: { ok: true, data: { user: { id: 'user-1' }, session: { access_token: 'a2', refresh_token: 'r2' } } },
    signOutCalled: 0,
    upsertedProfiles: [],
    profileSaltLookup: {},
  };
});

describe('auth · signUp', () => {
  it('happy path: persists session + derives key', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState), now: () => 1000 });
    const r = await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(true);
    expect(auth.state().session?.user_id).toBe('user-1');
    expect(auth.state().unlocked).toBe(true);
    expect(auth.encryptionKey()).not.toBeNull();
  });

  it('rejects short passphrase', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signUp({
      email: 'a@b.c', passphrase: 'too short', passphraseConfirm: 'too short',
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('weak-passphrase');
  });

  it('rejects mismatched confirmation', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signUp({
      email: 'a@b.c',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'different-passphrase-aaaaaaaaa',
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('mismatch');
  });

  it('rejects when acknowledgement checkbox is off', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signUp({
      email: 'a@b.c',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no-consent');
  });
});

describe('auth · signIn', () => {
  it('happy path with salt in localStorage', async () => {
    const api = makeFakeApi(fakeState);
    const auth = createAuthClient({ store, api, now: () => 1000 });
    // signUp first to populate salt
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    await auth.signOut();
    expect(auth.state().unlocked).toBe(false);

    const r = await auth.signIn({ email: 'serra@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(true);
    expect(auth.state().unlocked).toBe(true);
  });

  it('wrong email → wrong-passphrase code (400 from server)', async () => {
    fakeState.signInResult = { ok: false, status: 400, code: 'http' };
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signIn({ email: 'nope@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
  });

  it('missing salt → missing-salt error', async () => {
    fakeState.signInResult = { ok: true, data: { user: { id: 'user-2' }, session: { access_token: 'a', refresh_token: 'r' } } };
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signIn({ email: 'unknown@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing-salt');
  });

  it('falls back to fetching salt from profiles table', async () => {
    // Pre-populate the server-side profile with a salt the auth client can fetch.
    fakeState.profileSaltLookup['user-2'] = 'AAAAAAAAAAAAAAAAAAAAAA==';
    fakeState.signInResult = { ok: true, data: { user: { id: 'user-2' }, session: { access_token: 'a', refresh_token: 'r' } } };

    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signIn({ email: 'roaming@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(true);
    expect(auth.state().unlocked).toBe(true);
  });
});

describe('auth · signOut', () => {
  it('drops in-memory key + clears session, salt remains', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    expect(auth.encryptionKey()).not.toBeNull();
    await auth.signOut();
    expect(auth.encryptionKey()).toBeNull();
    expect(auth.state().session).toBeNull();
    // salt persists for next sign-in on this device
    expect(store.get('shared', 'shared.auth.salt', null)).not.toBeNull();
  });
});
