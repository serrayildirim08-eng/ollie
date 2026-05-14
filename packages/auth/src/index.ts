/**
 * @ollie/auth · account model + auth flow (Sprint 5 · F1 — Pattern A)
 *
 * THREAT MODEL — Pattern A · passphrase-only-on-device.
 *
 * NOTE (Sprint B' pivot 2026-05-14): the original posture was a strict
 * server-blind dogma. That was abandoned; opt-in anonymized data collection
 * (see `@ollie/consent` + `@ollie/pii-scrub`) is the new default. The
 * passphrase-on-device guard in this file still holds for the LOGIN
 * passphrase — Supabase still never sees the user's passphrase — but the
 * old blanket privacy claim no longer applies to brain-dump content for
 * opted-in users. See `project_ollie_b2b_pivot.md`.
 *
 *   1. signUp:
 *      - generate 32 random bytes → `serverPassword` (hex). This is the
 *        ONLY string ever handed to Supabase Auth. Supabase sees it,
 *        bcrypts it, never sees the user's actual passphrase.
 *      - call supabase.auth.signUp(email, serverPassword).
 *      - generate a 16-byte salt; derive an AES-GCM-256 key from
 *        `passphrase + salt` via PBKDF2-SHA-256 100k iters. The key
 *        stays in memory only.
 *      - encrypt `serverPassword` with the derived key, persist the
 *        ciphertext + salt in the `profiles` row (RLS-gated, only
 *        readable post-auth). Salt is non-secret; ciphertext is
 *        useless without the user's passphrase.
 *   2. signIn:
 *      - fetch salt + encrypted server password from `profiles`. To
 *        fetch we need an auth jwt, so first we get a temporary session
 *        by attempting auth with a deterministic "lookup" password that
 *        ALWAYS fails — no, simpler: the salt is stored in BOTH
 *        localStorage (when this device has seen the user) AND profiles
 *        (after first signIn).
 *      - if salt found locally → derive key locally → decrypt server
 *        password from local cache. If wrong passphrase → decrypt
 *        throws → "wrong passphrase" without contacting Supabase.
 *      - if no local data (new device) → first call supabase.auth
 *        passwordless lookup is not available; instead we ask the user
 *        to import a backup from the original device. (Pattern A
 *        accepts this UX tradeoff — sign-in on a brand-new device
 *        requires a backup file. Documented at signup.)
 *      - once decrypted, call supabase.auth.signInWithPassword(email,
 *        serverPassword). Receive session JWT. Salt + ciphertext are
 *        also uploaded to profiles for cross-device discovery in
 *        future revs.
 *   3. signOut: drop in-memory key + clear session. Salt + encrypted
 *      server password stay (needed for next sign-in on this device).
 *
 * Constitutional invariant: the user's PASSPHRASE never leaves the
 * device. The 32-byte serverPassword (uncorrelated with the passphrase)
 * is what Supabase sees. A Supabase breach reveals only the bcrypt'd
 * serverPassword which cannot be inverted to learn the passphrase OR
 * the encryption key.
 *
 * State lives at:
 *   shared.auth.session                 { access_token, refresh_token, user_id, email }
 *   shared.auth.salt                    base64 — derive same key with same passphrase
 *   shared.auth.salt_by_email.<email>   per-email salt cache
 *   shared.auth.encrypted_server_pw     base64 — { iv, ciphertext } encrypted with derived key
 *   shared.auth.email_for_login         last-used email (so login pre-fills)
 *
 * The derived CryptoKey is held in-process only — never persisted.
 *
 * SAFETY ASSERTION: a unit test in __tests__/passphrase-on-device.test.ts
 * spies on every supabase call argument and FAILS if the passphrase string
 * appears anywhere. Do not regress this.
 */

import { createOllieAPI } from '@ollie/api';
import type { OllieAPI } from '@ollie/api';
import {
  base64ToBytes,
  bytesToBase64,
  deriveKey,
  encryptData,
  decryptData,
  randomSalt,
  passphraseStrength,
  CRYPTO_PARAMS,
} from '@ollie/crypto';
import * as events from '@ollie/events';
import type { Store } from '@ollie/store';

const MIN_PASSPHRASE_LENGTH = CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH;

export interface AuthSession {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  /** ISO ts. */
  signed_in_at: string;
}

export interface AuthState {
  session: AuthSession | null;
  /** Whether an encryption key is currently in-memory (i.e. unlocked). */
  unlocked: boolean;
}

export interface AuthDeps {
  store: Store;
  api: OllieAPI;
  /** Optional Supabase profiles table that stores per-user salt. */
  profilesTable?: string;
  now?: () => number;
  /**
   * Account-deletion endpoint URL (Cloudflare Worker
   * `apps/api · POST /account/delete`). When unset, `deleteAccount()`
   * returns code='no-endpoint' so the UI can decide whether to fall
   * back to a local-only wipe or surface a configuration error.
   *
   * Wired by `apps/web/src/lib/account-boot.ts` from
   * `VITE_ACCOUNT_DELETE_URL` (or built via VITE_API_WORKER_URL).
   */
  accountDeleteUrl?: string;
  /** Injectable fetch — tests substitute a mock. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

interface SupabaseAuthResponse {
  user?: { id?: string; email?: string };
  session?: { access_token?: string; refresh_token?: string };
  // Some auth endpoints return access_token at the root.
  access_token?: string;
  refresh_token?: string;
}

interface SignUpResult { ok: true; user_id: string; }
interface SignUpError { ok: false; code: 'weak-passphrase' | 'mismatch' | 'no-consent' | 'http' | 'network'; message: string; notes?: string[]; }
export type SignUpResultLike = SignUpResult | SignUpError;

interface SignInResult { ok: true; user_id: string; }
interface SignInError { ok: false; code: 'wrong-passphrase' | 'wrong-email' | 'http' | 'network' | 'missing-salt' | 'no-device-data'; message: string; }
export type SignInResultLike = SignInResult | SignInError;

interface DeleteAccountResult { ok: true; user_id: string; deleted_tables: string[]; deleted_rows: Record<string, number>; }
interface DeleteAccountError {
  ok: false;
  /**
   * - `no-session`        — no local session, nothing to delete on server
   * - `no-endpoint`       — accountDeleteUrl not configured
   * - `bad-confirm`       — server rejected the confirm token (shouldn't happen — code-bug)
   * - `unauthorized`      — JWT expired / not accepted by server
   * - `cascade-failed`    — server-side DELETEs failed partway; retry-safe
   * - `auth-delete-failed` — cascade succeeded but auth.users delete failed; retry-safe
   * - `network`           — fetch threw
   * - `http`              — non-2xx with no recognised code
   */
  code: 'no-session' | 'no-endpoint' | 'bad-confirm' | 'unauthorized' | 'cascade-failed' | 'auth-delete-failed' | 'network' | 'http';
  message: string;
  /** Partial cascade summary when server returned a 500 with detail. */
  partial?: { deleted_tables: string[]; deleted_rows: Record<string, number>; failed_table?: string };
}
export type DeleteAccountResultLike = DeleteAccountResult | DeleteAccountError;

export interface SignUpInput {
  email: string;
  passphrase: string;
  passphraseConfirm: string;
  /** Must be true. UI shows the "i'll lose my data if i lose this passphrase" line. */
  acknowledged_unrecoverable: boolean;
}

export interface SignInInput {
  email: string;
  passphrase: string;
}

/** Standardised salt path in Supabase profiles. */
const SALT_LOCAL_KEY = 'shared.auth.salt';
const SALT_LOCAL_KEY_BY_EMAIL = (email: string) => `shared.auth.salt_by_email.${email.toLowerCase()}`;
const ENCRYPTED_SERVER_PW_KEY = 'shared.auth.encrypted_server_pw';
const ENCRYPTED_SERVER_PW_BY_EMAIL = (email: string) => `shared.auth.encrypted_server_pw_by_email.${email.toLowerCase()}`;
const PROFILES_TABLE_DEFAULT = 'profiles';

export interface AuthClient {
  state(): AuthState;
  /** in-memory only — not persisted. null when locked. */
  encryptionKey(): CryptoKey | null;
  signUp(input: SignUpInput): Promise<SignUpResultLike>;
  signIn(input: SignInInput): Promise<SignInResultLike>;
  signOut(): Promise<void>;
  /**
   * Server-side account deletion (GDPR / App Store erasure path).
   *
   * Flow:
   *   1. POST { confirm: "DELETE" } with the user JWT to the account-
   *      deletion endpoint configured at boot.
   *   2. On 2xx: drop in-memory key, clear session, wipe every
   *      `void.state.*` key from localStorage, clear store modules.
   *   3. On non-2xx: return the error; DO NOT wipe local data so the
   *      user can retry without losing access.
   *
   * The local wipe runs AFTER the server reports success — if the
   * server fails mid-cascade the data on this device stays usable.
   */
  deleteAccount(): Promise<DeleteAccountResultLike>;
  /** Recompute the strength bucket for UI meters. Pure. */
  strength(passphrase: string): ReturnType<typeof passphraseStrength>;
}

export function createAuthClient(deps: AuthDeps): AuthClient {
  let inMemoryKey: CryptoKey | null = null;
  const nowFn = deps.now ?? (() => Date.now());
  const profilesTable = deps.profilesTable ?? PROFILES_TABLE_DEFAULT;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  function state(): AuthState {
    const session = deps.store.get<AuthSession | null>('shared', 'auth.session', null);
    return { session, unlocked: inMemoryKey !== null };
  }

  function persistSalt(email: string, saltBase64: string): void {
    deps.store.set('shared', SALT_LOCAL_KEY, saltBase64);
    deps.store.set('shared', SALT_LOCAL_KEY_BY_EMAIL(email), saltBase64);
  }

  function persistEncryptedServerPw(email: string, envelopeBase64: string): void {
    deps.store.set('shared', ENCRYPTED_SERVER_PW_KEY, envelopeBase64);
    deps.store.set('shared', ENCRYPTED_SERVER_PW_BY_EMAIL(email), envelopeBase64);
  }

  async function uploadProfileToSupabase(
    authJwt: string,
    userId: string,
    saltBase64: string,
    encryptedServerPw: string,
  ): Promise<void> {
    try {
      // Pattern A: salt is non-secret (PBKDF2 salt) and encrypted_server_pw
      // is useless without the user's passphrase. Both are RLS-gated
      // anyway. Upload so a second device can fetch them post-auth.
      await deps.api.supabase.rest.upsert(
        profilesTable,
        [{ id: userId, salt: saltBase64, encrypted_server_pw: encryptedServerPw }],
        { authJwt },
      );
    } catch (err) {
      console.warn('[auth] uploading profile failed; continuing — data is in localStorage', err);
    }
  }

  async function fetchProfileFromSupabase(
    authJwt: string,
    userId: string,
  ): Promise<{ salt?: string; encrypted_server_pw?: string } | null> {
    try {
      const r = await deps.api.supabase.rest.get<Array<{ salt?: string; encrypted_server_pw?: string }>>(profilesTable, {
        authJwt,
        params: { id: `eq.${userId}`, select: 'salt,encrypted_server_pw' },
      });
      if (r.ok && r.data?.[0]) return r.data[0];
    } catch { /* fall through */ }
    return null;
  }

  /** Encrypt the server password with the derived key and pack to base64 JSON. */
  async function packServerPw(key: CryptoKey, serverPassword: string): Promise<string> {
    const env = await encryptData(key, serverPassword);
    return JSON.stringify({
      iv: bytesToBase64(env.iv),
      ct: bytesToBase64(env.ciphertext),
    });
  }

  /** Decrypt a packed envelope. Throws if wrong key (wrong passphrase). */
  async function unpackServerPw(key: CryptoKey, envelopeBase64: string): Promise<string> {
    const parsed = JSON.parse(envelopeBase64) as { iv: string; ct: string };
    return await decryptData<string>(key, {
      iv: base64ToBytes(parsed.iv),
      ciphertext: base64ToBytes(parsed.ct),
    });
  }

  async function signUp(input: SignUpInput): Promise<SignUpResultLike> {
    if (!input.acknowledged_unrecoverable) {
      return { ok: false, code: 'no-consent', message: 'must acknowledge passphrase is unrecoverable' };
    }
    const strength = passphraseStrength(input.passphrase);
    if (input.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return {
        ok: false, code: 'weak-passphrase',
        message: `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
        notes: strength.notes,
      };
    }
    if (input.passphrase !== input.passphraseConfirm) {
      return { ok: false, code: 'mismatch', message: 'passphrase confirmation does not match' };
    }

    // Pattern A:
    //   1. Derive the encryption key LOCALLY from passphrase + fresh salt.
    //   2. Generate a random 32-byte hex serverPassword. This is the ONLY
    //      string sent to Supabase Auth — Supabase never sees the
    //      passphrase.
    //   3. Encrypt the serverPassword with the derived key, persist
    //      ciphertext locally + (post-auth) on profiles.
    const salt = randomSalt();
    const saltBase64 = bytesToBase64(salt);
    inMemoryKey = await deriveKey(input.passphrase, salt);
    const serverPassword = generateRandomServerPassword();
    const encryptedServerPw = await packServerPw(inMemoryKey, serverPassword);

    // SAFETY: the only password ever sent to Supabase is `serverPassword`,
    // which is uncorrelated with `input.passphrase`. See passphrase-on-device
    // assertion test.
    const r = await deps.api.supabase.auth.signUp(input.email, serverPassword);
    if (!r.ok) {
      // Roll back the in-memory key — signup failed, don't leave the
      // client in a half-authed state.
      inMemoryKey = null;
      const code = r.error.code === 'network' ? 'network' : 'http';
      return { ok: false, code, message: r.error.message };
    }
    const payload = (r.data ?? {}) as SupabaseAuthResponse;
    const userId = payload.user?.id;
    if (!userId) {
      inMemoryKey = null;
      return { ok: false, code: 'http', message: 'signup response missing user.id' };
    }

    // Persist local credentials. Some Supabase projects require email
    // confirmation before issuing a session — we still persist locally
    // so the user can confirm + sign in on this device.
    persistSalt(input.email, saltBase64);
    persistEncryptedServerPw(input.email, encryptedServerPw);

    const accessToken = payload.session?.access_token ?? payload.access_token;
    const refreshToken = payload.session?.refresh_token ?? payload.refresh_token;
    if (accessToken && refreshToken) {
      const session: AuthSession = {
        user_id: userId,
        email: input.email,
        access_token: accessToken,
        refresh_token: refreshToken,
        signed_in_at: new Date(nowFn()).toISOString(),
      };
      deps.store.set('shared', 'auth.session', session);
      void uploadProfileToSupabase(accessToken, userId, saltBase64, encryptedServerPw);
    }
    deps.store.set('shared', 'auth.email_for_login', input.email);

    try { events.emit('auth:signed_up', { user_id: userId, ts: nowFn() }); }
    catch { /* registry warn ok */ }

    return { ok: true, user_id: userId };
  }

  async function signIn(input: SignInInput): Promise<SignInResultLike> {
    // Pattern A:
    //   1. Look up local salt + encrypted_server_pw for this email.
    //   2. Derive the key from passphrase + salt LOCALLY.
    //   3. Attempt to decrypt the server password. Wrong passphrase →
    //      decrypt throws → return wrong-passphrase WITHOUT contacting
    //      Supabase. The user's passphrase never leaves the device.
    //   4. If decrypt succeeds, call supabase.auth.signInWithPassword
    //      with the random serverPassword (which Supabase already
    //      bcrypt'd at signup).
    //
    // New device with no local data → no-device-data. UX: import a
    // backup from the original device first. Documented at signup.

    const saltBase64 = deps.store.get<string | null>(
      'shared',
      SALT_LOCAL_KEY_BY_EMAIL(input.email),
      null,
    );
    const encryptedServerPwLocal = deps.store.get<string | null>(
      'shared',
      ENCRYPTED_SERVER_PW_BY_EMAIL(input.email),
      null,
    );

    if (!saltBase64 || !encryptedServerPwLocal) {
      // Pre-Pattern A devices may have only the salt cached. In that
      // case there's no way to recover the server password locally —
      // ask the user to import a backup.
      if (!saltBase64) {
        return {
          ok: false,
          code: 'missing-salt',
          message: 'no sign-in data found on this device — import a backup from your original device',
        };
      }
      return {
        ok: false,
        code: 'no-device-data',
        message: 'no sign-in data found on this device — import a backup from your original device',
      };
    }

    const salt = base64ToBytes(saltBase64);
    const derivedKey = await deriveKey(input.passphrase, salt);

    let serverPassword: string;
    try {
      serverPassword = await unpackServerPw(derivedKey, encryptedServerPwLocal);
    } catch {
      // Wrong passphrase → decrypt fails. Never contact Supabase.
      return { ok: false, code: 'wrong-passphrase', message: 'wrong passphrase' };
    }

    // Now authenticate with Supabase using the decrypted serverPassword.
    // The passphrase is never sent.
    const r = await deps.api.supabase.auth.signInWithPassword(input.email, serverPassword);
    if (!r.ok) {
      if (r.error.code === 'http' && (r.error.status === 400 || r.error.status === 401)) {
        return { ok: false, code: 'wrong-passphrase', message: 'wrong email or passphrase' };
      }
      const code = r.error.code === 'network' ? 'network' : 'http';
      return { ok: false, code, message: r.error.message };
    }
    const payload = (r.data ?? {}) as SupabaseAuthResponse;
    const userId = payload.user?.id;
    const accessToken = payload.session?.access_token ?? payload.access_token;
    const refreshToken = payload.session?.refresh_token ?? payload.refresh_token;
    if (!userId || !accessToken || !refreshToken) {
      return { ok: false, code: 'http', message: 'sign-in response incomplete' };
    }

    inMemoryKey = derivedKey;
    deps.store.set('shared', SALT_LOCAL_KEY, saltBase64);
    deps.store.set('shared', ENCRYPTED_SERVER_PW_KEY, encryptedServerPwLocal);

    const session: AuthSession = {
      user_id: userId,
      email: input.email,
      access_token: accessToken,
      refresh_token: refreshToken,
      signed_in_at: new Date(nowFn()).toISOString(),
    };
    deps.store.set('shared', 'auth.session', session);
    deps.store.set('shared', 'auth.email_for_login', input.email);

    // Best-effort: re-upload profile so future devices can discover
    // post-import. Failure is non-fatal — we already have local data.
    void uploadProfileToSupabase(accessToken, userId, saltBase64, encryptedServerPwLocal);

    try { events.emit('auth:signed_in', { user_id: userId, ts: nowFn() }); }
    catch { /* registry warn ok */ }

    return { ok: true, user_id: userId };
  }

  async function signOut(): Promise<void> {
    const session = deps.store.get<AuthSession | null>('shared', 'auth.session', null);
    if (session?.access_token) {
      try { await deps.api.supabase.auth.signOut(session.access_token); }
      catch { /* non-fatal */ }
    }
    inMemoryKey = null;
    deps.store.set('shared', 'auth.session', null);
    // Salt stays — it's needed for the next sign-in on this device.
    try { events.emit('auth:signed_out', { ts: nowFn() }); }
    catch { /* registry warn ok */ }
  }

  async function deleteAccount(): Promise<DeleteAccountResultLike> {
    const session = deps.store.get<AuthSession | null>('shared', 'auth.session', null);
    if (!session) {
      return { ok: false, code: 'no-session', message: 'no active session to delete' };
    }
    if (!deps.accountDeleteUrl) {
      return { ok: false, code: 'no-endpoint', message: 'account deletion endpoint not configured' };
    }

    // POST { confirm: "DELETE" } with the JWT. The server re-verifies
    // the JWT through Supabase /auth/v1/user, then service-role cascades
    // every user-scoped table, then deletes the auth.users row last.
    let res: Response;
    try {
      res = await fetchImpl(deps.accountDeleteUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${session.access_token}`,
          'accept': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
    } catch (err) {
      return {
        ok: false,
        code: 'network',
        message: 'network error: ' + String((err as Error).message ?? err).slice(0, 200),
      };
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      // body wasn't json — fall through with empty parsed
    }

    if (!res.ok) {
      const serverCode = typeof parsed.code === 'string' ? parsed.code : '';
      const partial = parsed.partial as
        | { deleted_tables?: string[]; deleted_rows?: Record<string, number>; failed_table?: string }
        | undefined;
      const partialOut = partial && partial.deleted_tables && partial.deleted_rows
        ? {
            deleted_tables: partial.deleted_tables,
            deleted_rows: partial.deleted_rows,
            failed_table: partial.failed_table,
          }
        : undefined;
      if (res.status === 401) {
        return { ok: false, code: 'unauthorized', message: 'session expired — sign in again to delete your account' };
      }
      if (res.status === 403 || serverCode === 'bad-confirm') {
        return { ok: false, code: 'bad-confirm', message: 'server rejected the confirmation token' };
      }
      if (serverCode === 'cascade-failed') {
        return { ok: false, code: 'cascade-failed', message: 'partial deletion — please retry', partial: partialOut };
      }
      if (serverCode === 'auth-delete-failed') {
        return { ok: false, code: 'auth-delete-failed', message: 'partial deletion — please retry', partial: partialOut };
      }
      const msg = typeof parsed.message === 'string' ? parsed.message : `http ${res.status}`;
      return { ok: false, code: 'http', message: msg, partial: partialOut };
    }

    // Server reported success. NOW wipe local data — only after the
    // server cascade succeeded. If we wiped first and the network call
    // failed, the user would lose their data on this device with the
    // server row orphaned, which is the exact bug we're fixing.
    const deletedUserId = typeof parsed.user_id === 'string' ? parsed.user_id : session.user_id;
    const deletedTables = Array.isArray(parsed.deleted_tables) ? (parsed.deleted_tables as string[]) : [];
    const deletedRows = (parsed.deleted_rows && typeof parsed.deleted_rows === 'object')
      ? (parsed.deleted_rows as Record<string, number>)
      : {};

    inMemoryKey = null;
    deps.store.set('shared', 'auth.session', null);
    // Wipe every `void.state.*` key. The store adapter's own
    // `removeItem` is fine but doesn't know about peer modules — we
    // scan localStorage directly for the prefix used by storeModuleKey.
    try {
      if (typeof localStorage !== 'undefined') {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('void.state.')) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
      }
    } catch { /* non-fatal */ }

    try { events.emit('auth:signed_out', { ts: nowFn() }); }
    catch { /* registry warn ok */ }

    return {
      ok: true,
      user_id: deletedUserId,
      deleted_tables: deletedTables,
      deleted_rows: deletedRows,
    };
  }

  return {
    state,
    encryptionKey: () => inMemoryKey,
    signUp,
    signIn,
    signOut,
    deleteAccount,
    strength: passphraseStrength,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function generateRandomServerPassword(): string {
  // Pattern A: 32 random bytes → 64-char hex. This is the ONLY string
  // ever sent to Supabase Auth. Uncorrelated with the user's passphrase
  // by design — Supabase sees this, never the passphrase.
  const arr = new Uint8Array(32);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis;
  g.crypto.getRandomValues(arr);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export { MIN_PASSPHRASE_LENGTH };
