/**
 * @ollie/auth · Pattern A tests (Sprint 5 · F1)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  deriveKey,
  encryptData,
  randomSalt,
  bytesToBase64,
  CRYPTO_PARAMS,
} from '@ollie/crypto';
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
            // Lookup by userId (post-auth) or by email (new-device path).
            const byId = String(opts?.params?.id ?? '').match(/eq\.(.+)/)?.[1];
            const byEmail = String(opts?.params?.email ?? '').match(/eq\.(.+)/)?.[1];
            const key = byId ?? byEmail;
            if (key && state.profileLookup[key]) {
              return { ok: true, status: 200, data: [state.profileLookup[key]] };
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
      /* eslint-disable @typescript-eslint/no-explicit-any -- auth-adapter test mocks */
      auth: {
        signUp: vi.fn(async (email: string, password: string) => {
          state.signUpCalls.push({ email, password });
          return state.signUpResult.ok
            ? { ok: true, status: 200, data: state.signUpResult.data }
            : { ok: false, error: { code: state.signUpResult.code ?? 'http', status: state.signUpResult.status ?? 400, message: 'x' } };
        }) as any,
        signInWithPassword: vi.fn(async (email: string, password: string) => {
          state.signInCalls.push({ email, password });
          return state.signInResult.ok
            ? { ok: true, status: 200, data: state.signInResult.data }
            : { ok: false, error: { code: state.signInResult.code ?? 'http', status: state.signInResult.status ?? 400, message: 'x' } };
        }) as any,
        refresh: vi.fn() as any,
        signOut: vi.fn(async () => { state.signOutCalled++; return { ok: true, status: 200, data: null }; }) as any,
      },
      /* eslint-enable @typescript-eslint/no-explicit-any */
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

  it('rejects an 11-char passphrase (one below the 12-char floor)', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const elevenChars = 'abcde123!?X'; // 11 chars
    const r = await auth.signUp({
      email: 'a@b.c', passphrase: elevenChars, passphraseConfirm: elevenChars,
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('weak-passphrase');
  });

  it('accepts a 12-char passphrase (exactly at the floor)', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const twelveChars = 'abcde123!?Xy'; // 12 chars — exact minimum
    const r = await auth.signUp({
      email: 'serra@example.com',
      passphrase: twelveChars, passphraseConfirm: twelveChars,
      acknowledged_unrecoverable: true,
    });
    expect(r.ok).toBe(true);
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

  it('new device with no local data AND no Supabase profile → missing-salt', async () => {
    fakeState.signInResult = { ok: true, data: { user: { id: 'user-2' }, session: { access_token: 'a', refresh_token: 'r' } } };
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState) });
    const r = await auth.signIn({ email: 'unknown@example.com', passphrase: 'correct-horse-battery-staple-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing-salt');
  });

  it('new device: salt absent locally → recovered from Supabase profiles → sign-in succeeds', async () => {
    const passphrase = 'correct-horse-battery-staple-x';
    const email = 'serra@example.com';

    // ── Device A: sign up. This uploads the profile (salt + ciphertext)
    //    to Supabase via uploadProfileToSupabase.
    const apiA = makeFakeApi(fakeState);
    const authA = createAuthClient({ store, api: apiA, now: () => 1000 });
    await authA.signUp({
      email, passphrase, passphraseConfirm: passphrase,
      acknowledged_unrecoverable: true,
    });
    expect(fakeState.upsertedProfiles.length).toBeGreaterThan(0);
    const uploaded = fakeState.upsertedProfiles[0] as {
      id: string; email: string; salt: string; encrypted_server_pw: string;
    };
    expect(uploaded.email).toBe(email);

    // ── Device B: a brand-new device — empty store, so no local salt.
    //    Seed Supabase's profiles with what Device A uploaded, keyed by
    //    email (the new-device lookup key).
    const storeB = createStore(createMemoryAdapter());
    fakeState.profileLookup[email] = {
      salt: uploaded.salt,
      encrypted_server_pw: uploaded.encrypted_server_pw,
    };
    fakeState.signInCalls.length = 0;
    const authB = createAuthClient({ store: storeB, api: makeFakeApi(fakeState), now: () => 2000 });

    const r = await authB.signIn({ email, passphrase });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recovered_from_server).toBe(true);
    expect(authB.state().unlocked).toBe(true);
    // Supabase auth WAS contacted with the decrypted server password.
    expect(fakeState.signInCalls.length).toBe(1);
    expect(fakeState.signInCalls[0].password).not.toBe(passphrase);

    // Recovered credentials are cached locally — next sign-in is fast path.
    expect(storeB.get('shared', `shared.auth.salt_by_email.${email}`, null)).not.toBeNull();
  });

  it('new device: wrong passphrase after Supabase recovery → wrong-passphrase, no Supabase auth call', async () => {
    const passphrase = 'correct-horse-battery-staple-x';
    const email = 'serra@example.com';

    const authA = createAuthClient({ store, api: makeFakeApi(fakeState), now: () => 1000 });
    await authA.signUp({
      email, passphrase, passphraseConfirm: passphrase,
      acknowledged_unrecoverable: true,
    });
    const uploaded = fakeState.upsertedProfiles[0] as { salt: string; encrypted_server_pw: string };

    const storeB = createStore(createMemoryAdapter());
    fakeState.profileLookup[email] = {
      salt: uploaded.salt,
      encrypted_server_pw: uploaded.encrypted_server_pw,
    };
    fakeState.signInCalls.length = 0;
    const authB = createAuthClient({ store: storeB, api: makeFakeApi(fakeState) });

    const r = await authB.signIn({ email, passphrase: 'wrong-wrong-wrong-wrong-x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
    // Even on the recovered path, a wrong passphrase fails LOCALLY at
    // decrypt — Supabase auth is never contacted.
    expect(fakeState.signInCalls.length).toBe(0);
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

// ─── S7 · PBKDF2 iteration count back-compat ──────────────────────────────────

describe('auth · S7 · iteration-count back-compat', () => {
  /**
   * Build a LEGACY profile envelope: encrypt a server password with a key
   * derived at the legacy 100k count and pack it WITHOUT a `kdf_iter`
   * field — exactly what a profile written before the S7 bump looks like.
   */
  async function buildLegacyProfile(passphrase: string, serverPassword: string) {
    const salt = randomSalt();
    const key = await deriveKey(passphrase, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const env = await encryptData(key, serverPassword);
    return {
      saltBase64: bytesToBase64(salt),
      // NO kdf_iter — pre-S7 envelope shape.
      encryptedServerPw: JSON.stringify({
        iv: bytesToBase64(env.iv),
        ct: bytesToBase64(env.ciphertext),
      }),
    };
  }

  it('a NEW signup stamps kdf_iter=600k into the profile envelope', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState), now: () => 1000 });
    await auth.signUp({
      email: 'serra@example.com',
      passphrase: 'correct-horse-battery-staple-x',
      passphraseConfirm: 'correct-horse-battery-staple-x',
      acknowledged_unrecoverable: true,
    });
    const envStr = store.get<string | null>('shared', 'shared.auth.encrypted_server_pw', null);
    expect(envStr).not.toBeNull();
    const parsed = JSON.parse(envStr!) as { kdf_iter?: number };
    expect(parsed.kdf_iter).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    expect(parsed.kdf_iter).toBe(600_000);
  });

  it('a NEW (600k) user can sign in again — round-trip with stored count', async () => {
    const auth = createAuthClient({ store, api: makeFakeApi(fakeState), now: () => 1000 });
    const passphrase = 'correct-horse-battery-staple-x';
    await auth.signUp({
      email: 'serra@example.com', passphrase, passphraseConfirm: passphrase,
      acknowledged_unrecoverable: true,
    });
    await auth.signOut();
    const r = await auth.signIn({ email: 'serra@example.com', passphrase });
    expect(r.ok).toBe(true);
    expect(auth.state().unlocked).toBe(true);
  });

  it('a LEGACY (100k, no kdf_iter) profile STILL allows sign-in — back-compat', async () => {
    const passphrase = 'correct-horse-battery-staple-x';
    const email = 'legacy@example.com';
    // The serverPassword Supabase will accept on signInWithPassword.
    const serverPassword = 'abcdef0123456789'.repeat(4);
    const legacy = await buildLegacyProfile(passphrase, serverPassword);

    // New device: empty store; the legacy profile is served by Supabase
    // (email-keyed new-device recovery path).
    const storeB = createStore(createMemoryAdapter());
    fakeState.profileLookup[email] = {
      salt: legacy.saltBase64,
      encrypted_server_pw: legacy.encryptedServerPw,
    };
    fakeState.signInCalls.length = 0;
    const authB = createAuthClient({ store: storeB, api: makeFakeApi(fakeState), now: () => 2000 });

    const r = await authB.signIn({ email, passphrase });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recovered_from_server).toBe(true);
    expect(authB.state().unlocked).toBe(true);
    // The legacy envelope decrypted to the SAME server password → that
    // exact string is what was sent to Supabase auth.
    expect(fakeState.signInCalls.length).toBe(1);
    expect(fakeState.signInCalls[0].password).toBe(serverPassword);
  });

  it('a LEGACY profile with the WRONG passphrase fails locally (no Supabase call)', async () => {
    const passphrase = 'correct-horse-battery-staple-x';
    const email = 'legacy@example.com';
    const legacy = await buildLegacyProfile(passphrase, 'serverpw'.repeat(8));

    const storeB = createStore(createMemoryAdapter());
    fakeState.profileLookup[email] = {
      salt: legacy.saltBase64,
      encrypted_server_pw: legacy.encryptedServerPw,
    };
    fakeState.signInCalls.length = 0;
    const authB = createAuthClient({ store: storeB, api: makeFakeApi(fakeState) });

    const r = await authB.signIn({ email, passphrase: 'totally-wrong-passphrase-z' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
    // Wrong passphrase → decrypt throws → Supabase never contacted.
    expect(fakeState.signInCalls.length).toBe(0);
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
