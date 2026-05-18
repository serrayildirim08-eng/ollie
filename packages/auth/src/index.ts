/**
 * @ollie/auth · passphrase-derived encryption vault
 *
 * Ollie's identity/login is owned by Clerk. This package does NOT do
 * identity any more — no Supabase Auth, no server-password envelope, no
 * account-deletion HTTP calls. It is ONLY the encryption layer:
 *
 *   - derive an AES-GCM-256 key from a user passphrase + a per-device salt
 *   - hold that key in process memory
 *   - gate the key behind the passphrase (create / unlock / lock)
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
 *      - the salt + encrypted server password live in BOTH localStorage
 *        (when this device has seen the user) AND the `profiles` row
 *        (uploaded after signUp / first signIn).
 *      - if salt found locally → derive key locally → decrypt server
 *        password from local cache. If wrong passphrase → decrypt
 *        throws → "wrong passphrase" without contacting Supabase.
 *      - if no local data (NEW DEVICE) → fetch salt + encrypted server
 *        password from Supabase `profiles`, keyed by email. Both
 *        columns are non-secret (PBKDF2 salt; ciphertext is useless
 *        without the passphrase) so they can be served pre-auth via the
 *        anon key. The user still needs the correct passphrase to
 *        derive the key and decrypt — the passphrase never leaves the
 *        device. Recovered credentials are then cached locally so the
 *        next sign-in on this device takes the fast local path.
 *      - if neither local nor Supabase has the data → `missing-salt`;
 *        the UI guides the user to import a backup from the original
 *        device.
 *      - once decrypted, call supabase.auth.signInWithPassword(email,
 *        serverPassword). Receive session JWT. Salt + ciphertext are
 *        also re-uploaded to profiles for cross-device discovery.
 *   3. signOut: drop in-memory key + clear session. Salt + encrypted
 *      server password stay (needed for next sign-in on this device).
 *
 * Storage (all in the `'shared'` store module):
 *   vault.salt      — base64 string, the PBKDF2 salt
 *   vault.verifier  — JSON string { iv, ct, kdf_iter }, an AES-GCM
 *                     envelope encrypting the constant VERIFY_CONSTANT.
 *                     `unlock` re-derives the key and confirms it
 *                     decrypts this envelope back to VERIFY_CONSTANT
 *                     before the key is accepted into memory.
 */

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

/** Storage keys (in the `shared` store module). */
const SALT_KEY = 'vault.salt';
const VERIFIER_KEY = 'vault.verifier';

/**
 * The constant plaintext encrypted into `vault.verifier`. `unlock`
 * decrypts the verifier and checks the result equals this string — a
 * mismatch (or a decrypt throw) means the passphrase was wrong.
 */
const VERIFY_CONSTANT = 'ollie-vault-verify-v1';

/** Persisted verifier envelope shape. */
interface VerifierEnvelope {
  /** base64 AES-GCM IV. */
  iv: string;
  /** base64 AES-GCM ciphertext (+ auth tag). */
  ct: string;
  /** PBKDF2 iteration count the key was derived with. */
  kdf_iter: number;
}

export interface VaultState {
  /** A passphrase has been set on this device (salt + verifier present). */
  exists: boolean;
  /** The encryption key is currently held in memory. */
  unlocked: boolean;
}

export type CreateResult =
  | { ok: true }
  | { ok: false; code: 'weak-passphrase'; message: string; notes?: string[] };

export type UnlockResult =
  | { ok: true }
  | { ok: false; code: 'wrong-passphrase' | 'no-vault'; message: string };

interface SignUpResult { ok: true; user_id: string; }
interface SignUpError { ok: false; code: 'weak-passphrase' | 'mismatch' | 'no-consent' | 'http' | 'network'; message: string; notes?: string[]; }
export type SignUpResultLike = SignUpResult | SignUpError;

interface SignInResult { ok: true; user_id: string; /** true when salt/credentials were recovered from Supabase (new-device path). */ recovered_from_server?: boolean; }
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
  /** Recompute the strength bucket for UI meters. Async (zxcvbn is lazy-loaded). */
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
    email: string,
    saltBase64: string,
    encryptedServerPw: string,
  ): Promise<void> {
    try {
      // Pattern A: salt is non-secret (PBKDF2 salt) and encrypted_server_pw
      // is useless without the user's passphrase. Upload so a second
      // device can fetch them — keyed by `email` for the new-device
      // sign-in path (where the userId is not yet known).
      await deps.api.supabase.rest.upsert(
        profilesTable,
        [{ id: userId, email: email.toLowerCase(), salt: saltBase64, encrypted_server_pw: encryptedServerPw }],
        { authJwt },
      );
    } catch (err) {
      // SECURITY (S4): never log the raw `err` — it can carry the failed
      // request (with `Authorization: Bearer <jwt>`) or the profile body
      // (`encrypted_server_pw`). Log only a safe summary.
      console.warn(
        '[auth] uploading profile failed; continuing — data is in localStorage:',
        safeErrSummary(err),
      );
    }
  }

  /**
   * Fetch the per-user `salt` + `encrypted_server_pw` from Supabase
   * `profiles`. Both columns are non-secret (PBKDF2 salt; ciphertext
   * useless without the passphrase) — see `uploadProfileToSupabase`.
   *
   * Two lookup modes:
   *   - by `userId` (post-auth, e.g. re-uploading on signIn). The row is
   *     RLS-gated to the authed user — a plain REST GET with `authJwt`.
   *   - by `email` (the "new device" path — we have no userId yet and
   *     no JWT). This goes through the `profile_recovery_lookup`
   *     SECURITY DEFINER RPC, NOT a table GET.
   *
   * SECURITY (F1, 2026-05-19): the old email path did an anon REST GET
   * against `profiles`. The RLS policy backing it (profiles_select_anon_
   * recovery) had no row scoping, so anyone with the public anon key
   * could omit the email filter and dump every user's email + credential
   * material. The `profile_recovery_lookup` RPC closes this — its body
   * owns the WHERE clause, so a caller can only ever resolve the single
   * row for an email they ALREADY know. No enumeration is possible.
   * See supabase/migrations/20260519000001_profiles_anon_rpc_fix.sql.
   *
   * Returns null on any miss / network error so callers can degrade
   * to the existing `missing-salt` path.
   */
  async function fetchProfileFromSupabase(
    lookup: { authJwt?: string; userId?: string; email?: string },
  ): Promise<{ salt?: string; encrypted_server_pw?: string } | null> {
    try {
      if (lookup.userId) {
        // Post-auth path: RLS-gated row read keyed by id.
        const r = await deps.api.supabase.rest.get<Array<{ salt?: string; encrypted_server_pw?: string }>>(profilesTable, {
          authJwt: lookup.authJwt,
          params: { select: 'salt,encrypted_server_pw', id: `eq.${lookup.userId}` },
        });
        if (r.ok && r.data?.[0]) return r.data[0];
        return null;
      }
      if (lookup.email) {
        // New-device path: SECURITY DEFINER RPC — point lookup by a
        // known email, no table SELECT, no enumeration.
        const r = await deps.api.supabase.rest.rpc<
          Array<{ id?: string; salt?: string; encrypted_server_pw?: string }>
        >('profile_recovery_lookup', { p_email: lookup.email.toLowerCase() }, {
          authJwt: lookup.authJwt,
        });
        if (r.ok && r.data?.[0]) {
          return {
            salt: r.data[0].salt,
            encrypted_server_pw: r.data[0].encrypted_server_pw,
          };
        }
        return null;
      }
    } catch { /* fall through */ }
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.iv !== 'string' || typeof o.ct !== 'string') return null;
  const kdfIter =
    typeof o.kdf_iter === 'number' && Number.isInteger(o.kdf_iter) && o.kdf_iter > 0
      ? o.kdf_iter
      : CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
  return { iv: o.iv, ct: o.ct, kdf_iter: kdfIter };
}

  /**
   * Encrypt the server password with the derived key and pack to base64 JSON.
   *
   * SECURITY (S7): the envelope records `kdf_iter` — the PBKDF2 iteration
   * count the key was derived with — so a later sign-in can re-derive the
   * SAME key even after the global default changes. New envelopes always
   * carry this field; legacy envelopes (pre-S7) do not and the reader
   * falls back to the legacy 100k count.
   */
  async function packServerPw(
    key: CryptoKey,
    serverPassword: string,
    kdfIterations: number,
  ): Promise<string> {
    const env = await encryptData(key, serverPassword);
    return JSON.stringify({
      iv: bytesToBase64(env.iv),
      ct: bytesToBase64(env.ciphertext),
      kdf_iter: kdfIterations,
    });
  }

  /**
   * Read the PBKDF2 iteration count an envelope was written with.
   * Legacy envelopes (no `kdf_iter`) → the historical 100k count.
   * The envelope JSON is plaintext, so this is readable BEFORE the key
   * is derived — which is exactly what sign-in needs.
   */
  function envelopeKdfIterations(envelopeBase64: string): number {
    try {
      const parsed = JSON.parse(envelopeBase64) as { kdf_iter?: unknown };
      if (typeof parsed.kdf_iter === 'number' && Number.isInteger(parsed.kdf_iter) && parsed.kdf_iter > 0) {
        return parsed.kdf_iter;
      }
    } catch { /* fall through to legacy */ }
    return CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
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
    // passphraseStrength is async (zxcvbn is lazy-loaded).
    if (input.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      const strength = await passphraseStrength(input.passphrase);
      return {
        ok: false,
        code: 'weak-passphrase',
        message: `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
        notes: strength.notes,
      };
    }

    const salt = randomSalt();
    const saltBase64 = bytesToBase64(salt);
    // SECURITY (S7): new derivations use the current 600k iteration count.
    // The count is recorded in the envelope so sign-in can reproduce the key.
    const kdfIterations = CRYPTO_PARAMS.PBKDF2_ITERATIONS;
    inMemoryKey = await deriveKey(input.passphrase, salt, kdfIterations);
    const serverPassword = generateRandomServerPassword();
    const encryptedServerPw = await packServerPw(inMemoryKey, serverPassword, kdfIterations);

    // Encrypt the verifier constant so a later unlock can prove the
    // passphrase without storing the passphrase or the key.
    const env = await encryptData(key, VERIFY_CONSTANT);
    const verifier: VerifierEnvelope = {
      iv: bytesToBase64(env.iv),
      ct: bytesToBase64(env.ciphertext),
      kdf_iter: kdfIterations,
    };

    deps.store.set('shared', SALT_KEY, bytesToBase64(salt));
    deps.store.set('shared', VERIFIER_KEY, JSON.stringify(verifier));

    inMemoryKey = key;
    try {
      events.emit('vault:unlocked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
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
      void uploadProfileToSupabase(accessToken, userId, input.email, saltBase64, encryptedServerPw);
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

    let saltBase64 = deps.store.get<string | null>(
      'shared',
      SALT_LOCAL_KEY_BY_EMAIL(input.email),
      null,
    );
    let encryptedServerPwLocal = deps.store.get<string | null>(
      'shared',
      ENCRYPTED_SERVER_PW_BY_EMAIL(input.email),
      null,
    );

    // Whether this sign-in pulled its credentials from Supabase rather
    // than the local store (the documented "new device" path, step 2).
    let recoveredFromServer = false;

    if (!saltBase64 || !encryptedServerPwLocal) {
      // New device (doc-comment step 2): no local salt/ciphertext for
      // this email. Fall back to fetching the non-secret salt +
      // encrypted_server_pw from Supabase `profiles` keyed by email.
      // Both columns are useless without the user's passphrase, so
      // serving them pre-auth leaks nothing.
      const remote = await fetchProfileFromSupabase({ email: input.email });
      if (remote?.salt && remote.encrypted_server_pw) {
        saltBase64 = remote.salt;
        encryptedServerPwLocal = remote.encrypted_server_pw;
        recoveredFromServer = true;
      }
    }

    if (!saltBase64 || !encryptedServerPwLocal) {
      // No local data AND Supabase could not supply it (no profiles
      // row, network failure, or RLS denied). Surface the existing
      // user-facing guidance — import a backup from the first device.
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
    // SECURITY (S7): derive with the iteration count this envelope was
    // written with. Legacy envelopes (pre-S7) carry no count → 100k;
    // post-S7 envelopes carry 600k. Reading the count from the (plaintext)
    // envelope BEFORE deriving is what keeps old logins working.
    const kdfIterations = envelopeKdfIterations(encryptedServerPwLocal);
    const derivedKey = await deriveKey(input.passphrase, salt, kdfIterations);

    let plaintext: string;
    try {
      plaintext = await decryptData<string>(key, {
        iv: base64ToBytes(verifier.iv),
        ciphertext: base64ToBytes(verifier.ct),
      });
    } catch {
      // Wrong passphrase → AES-GCM auth-tag mismatch. Do not set the key.
      return { ok: false, code: 'wrong-passphrase', message: 'wrong passphrase' };
    }
    if (plaintext !== VERIFY_CONSTANT) {
      // Decrypt succeeded but produced the wrong plaintext — treat as
      // wrong passphrase. Do not set the key.
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
    // On the new-device path the credentials came from Supabase — cache
    // them per-email locally so future sign-ins on THIS device take the
    // fast local path (no profiles round-trip, no regression).
    if (recoveredFromServer) {
      persistSalt(input.email, saltBase64);
      persistEncryptedServerPw(input.email, encryptedServerPwLocal);
    }

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
    void uploadProfileToSupabase(accessToken, userId, input.email, saltBase64, encryptedServerPwLocal);

    try { events.emit('auth:signed_in', { user_id: userId, ts: nowFn() }); }
    catch { /* registry warn ok */ }

    return recoveredFromServer
      ? { ok: true, user_id: userId, recovered_from_server: true }
      : { ok: true, user_id: userId };
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
      events.emit('vault:unlocked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
    }
    return { ok: true };
  }

  function lock(): void {
    inMemoryKey = null;
    deps.store.set('shared', 'auth.session', null);

    // SECURITY (S6): wipe the credential material. The old `void.state.*`
    // localStorage scan was insufficient on two counts:
    //   1. It bypassed the store, so the store's in-memory module cache
    //      still held `shared.auth.*` — a later `store.set` on `shared`
    //      would re-flush the cached blob and RESURRECT the deleted keys.
    //   2. It only touched `localStorage` — on adapters that aren't
    //      `localStorage` (memory/Electron/Capacitor) it cleared nothing.
    // Fix: explicitly remove every auth credential key THROUGH the store
    // (cache + adapter both drop it), including the dynamic per-email
    // variants, BEFORE the prefix scan.
    wipeAuthCredentials(deps.store);

    // Then wipe every `void.state.*` key from localStorage as a
    // belt-and-suspenders sweep of peer module data.
    try {
      events.emit('vault:locked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
    }
  }

  function reset(): void {
    try {
      deps.store.remove('shared', SALT_KEY);
    } catch {
      /* non-fatal */
    }
    try {
      deps.store.remove('shared', VERIFIER_KEY);
    } catch {
      /* non-fatal */
    }
    inMemoryKey = null;
    try {
      events.emit('vault:locked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
    }
  }

  return {
    state,
    encryptionKey: () => inMemoryKey,
    create,
    unlock,
    lock,
    reset,
    strength: passphraseStrength,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * SECURITY (S4): collapse an unknown thrown value into a SAFE one-line
 * summary fit for `console.*` / Sentry breadcrumbs.
 *
 * A raw error object can carry the originating `fetch` Request (with an
 * `Authorization: Bearer <jwt>` header) or the request body (which for
 * this package includes `encrypted_server_pw`). We deliberately surface
 * ONLY a short message string and, when present, a numeric `status` —
 * never the object, never its `cause`, never `config`/`request`/`response`.
 */
export function safeErrSummary(err: unknown): string {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err.slice(0, 200);
  if (typeof err === 'object') {
    const o = err as { message?: unknown; name?: unknown; status?: unknown; code?: unknown };
    const parts: string[] = [];
    if (typeof o.name === 'string' && o.name && o.name !== 'Error') parts.push(o.name);
    if (typeof o.message === 'string' && o.message) parts.push(o.message.slice(0, 200));
    else parts.push('error (no message)');
    if (typeof o.status === 'number') parts.push(`status=${o.status}`);
    if (typeof o.code === 'string' && o.code) parts.push(`code=${o.code}`);
    return parts.join(' · ');
  }
  return 'non-error thrown value';
}

/**
 * SECURITY (S6): remove every auth credential key from the store.
 *
 * Account deletion must leave NO material an attacker with device access
 * could brute-force. The keys (all in the `shared` module):
 *   - `auth.session`
 *   - `auth.email_for_login`
 *   - `shared.auth.salt`                          (fixed)
 *   - `shared.auth.encrypted_server_pw`           (fixed)
 *   - `shared.auth.salt_by_email.<email>`         (one per known email)
 *   - `shared.auth.encrypted_server_pw_by_email.<email>` (per email)
 *
 * The per-email variants have dynamic suffixes, so we cannot hard-code
 * them — we enumerate the live `shared` module and remove any key under
 * the two `shared.auth.*_by_email.` prefixes. Going through `store.remove`
 * (not a raw localStorage delete) keeps the store's in-memory cache and
 * the underlying adapter in sync, so the keys cannot be resurrected by a
 * later write to the `shared` module.
 *
 * Exported for direct unit testing.
 */
export function wipeAuthCredentials(store: Store): void {
  // Fixed keys.
  const fixed = [
    'auth.session',
    'auth.email_for_login',
    SALT_LOCAL_KEY,                // 'shared.auth.salt'
    ENCRYPTED_SERVER_PW_KEY,       // 'shared.auth.encrypted_server_pw'
  ];
  for (const k of fixed) {
    try { store.remove('shared', k); } catch { /* non-fatal */ }
  }

  // Dynamic per-email keys: enumerate the `shared` module and drop any
  // key under the per-email prefixes.
  const SALT_BY_EMAIL_PREFIX = 'shared.auth.salt_by_email.';
  const PW_BY_EMAIL_PREFIX = 'shared.auth.encrypted_server_pw_by_email.';
  try {
    const sharedModule = store.getModule('shared');
    if (sharedModule) {
      for (const key of Object.keys(sharedModule)) {
        if (key.startsWith(SALT_BY_EMAIL_PREFIX) || key.startsWith(PW_BY_EMAIL_PREFIX)) {
          try { store.remove('shared', key); } catch { /* non-fatal */ }
        }
      }
    }
  } catch { /* non-fatal */ }
}

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
