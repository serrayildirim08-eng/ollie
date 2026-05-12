/**
 * @ollie/auth · Pattern A tests (Sprint 5 · F1)
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
  /** Captured signUp/signIn args so tests can introspect what was sent. */
  signUpCalls: Array<{ email: string; password: string }>;
  signInCalls: Array<{ email: string; password: string }>;
  profileLookup: { [userId: string]: { salt?: string; encrypted_server_pw?: string } };
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
            if (userId && state.profileLookup[userId]) {
              return { ok: true, status: 200, data: [state.profileLookup[userId]] };
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
        signUp: vi.fn(async (email: string, password: string) => {
          state.signUpCalls.push({ email, password });
          return state.signUpResult.ok
            ? { ok: true, status: 200, data: state.signUpResult.data }
            : { ok: false, error: { code: state.signUpResult.code ?? 'http', status: state.signUpResult.status ?? 400, message: 'x' } };
        }) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signInWithPassword: vi.fn(async (email: string, password: string) => {
          state.signInCalls.push({ email, password });
          return state.signInResult.ok
            ? { ok: true, status: 200, data: state.signInResult.data }
            : { ok: false, error: { code: state.signInResult.code ?? 'http', status: state.signInResult.status ?? 400, message: 'x' } };
        }) as any,
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
    signUpCalls: [],
    signInCalls: [],
    profileLookup: {},
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

  it('passes a random server password (NOT the passphrase) to Supabase', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const passphrase = 'correct-horse-battery-staple-x';
    await auth.signUp({
      email: 'serra@example.com',
      passphrase,
      passphraseConfirm: passphrase,
      acknowledged_unrecoverable: true,
    });
    expect(fakeState.signUpCalls.length).toBe(1);
    const sent = fakeState.signUpCalls[0].password;
    expect(sent).not.toBe(passphrase);
    expect(sent).not.toContain(passphrase);
    // 32 bytes hex = 64 chars
    expect(sent).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('auth · signIn', () => {
  it('happy path with salt + encrypted_server_pw in localStorage', async () => {
    const api = makeFakeApi(fakeState);
    const auth = createAuthClient({ store, api, now: () => 1000 });
    // signUp first to populate salt + encrypted server pw
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

  it('wrong passphrase → fails LOCALLY without calling Supabase', async () => {
    const api = makeFakeApi(fakeState);
    const auth = createAuthClient({ store, api, now: () => 1000 });
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    await auth.signOut();
    fakeState.signInCalls.length = 0;

    const r = await auth.signIn({ email: 'serra@example.com', passphrase: 'wrong-wrong-wrong-wrong-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
    // CRITICAL: Supabase auth was never contacted on wrong passphrase.
    expect(fakeState.signInCalls.length).toBe(0);
  });

  it('new device with no local data → no-device-data', async () => {
    fakeState.signInResult = { ok: true, data: { user: { id: 'user-2' }, session: { access_token: 'a', refresh_token: 'r' } } };
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signIn({ email: 'unknown@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing-salt');
  });

  it('passes decrypted server password (NOT the passphrase) to Supabase', async () => {
    const api = makeFakeApi(fakeState);
    const auth = createAuthClient({ store, api, now: () => 1000 });
    const passphrase = 'correct-horse-battery-staple-x';
    await auth.signUp({
      email: 'serra@example.com',
      passphrase,
      passphraseConfirm: passphrase,
      acknowledged_unrecoverable: true,
    });
    const serverPwSent = fakeState.signUpCalls[0].password;

    await auth.signOut();
    fakeState.signInCalls.length = 0;

    const r = await auth.signIn({ email: 'serra@example.com', passphrase });
    expect(r.ok).toBe(true);
    expect(fakeState.signInCalls.length).toBe(1);
    const signInPw = fakeState.signInCalls[0].password;
    expect(signInPw).not.toBe(passphrase);
    expect(signInPw).not.toContain(passphrase);
    // Should decrypt to the SAME server password we generated at signUp.
    expect(signInPw).toBe(serverPwSent);
  });
});

describe('auth · signOut', () => {
  it('drops in-memory key + clears session, salt + encrypted_server_pw remain', async () => {
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
    // encrypted server pw also persists
    expect(store.get('shared', 'shared.auth.encrypted_server_pw', null)).not.toBeNull();
  });
});
