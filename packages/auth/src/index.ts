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
 * CONSTITUTIONAL INVARIANT
 *   The user's passphrase NEVER leaves the device, and the derived
 *   CryptoKey is NEVER persisted. The key lives in a closure variable
 *   only; it is gone the moment the process ends or `lock()`/`reset()`
 *   runs. Only the non-secret PBKDF2 salt and an AES-GCM verifier
 *   envelope are written to the store — neither is usable without the
 *   passphrase.
 *
 * Storage (all in the `'shared'` store module):
 *   vault.salt      — base64 string, the PBKDF2 salt
 *   vault.verifier  — JSON string { iv, ct, kdf_iter }, an AES-GCM
 *                     envelope encrypting the constant VERIFY_CONSTANT.
 *                     `unlock` re-derives the key and confirms it
 *                     decrypts this envelope back to VERIFY_CONSTANT
 *                     before the key is accepted into memory.
 */

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

export interface VaultClient {
  /** Current vault state — derived from the store + the in-memory key. */
  state(): VaultState;
  /** The in-memory encryption key. `null` whenever the vault is locked. */
  encryptionKey(): CryptoKey | null;
  /** First-time setup: pick a passphrase, derive + store the verifier. */
  create(passphrase: string): Promise<CreateResult>;
  /** Returning user: re-derive the key and verify it against the store. */
  unlock(passphrase: string): Promise<UnlockResult>;
  /** Drop the in-memory key. Salt + verifier stay so `unlock` still works. */
  lock(): void;
  /** Wipe salt + verifier (account deletion). Also drops the in-memory key. */
  reset(): void;
  /** Score a passphrase for UI strength meters. Async (zxcvbn is lazy). */
  strength(passphrase: string): ReturnType<typeof passphraseStrength>;
}

/**
 * Read + validate the persisted verifier envelope. Returns `null` when
 * the key is absent or the stored value is not a well-formed envelope.
 */
function readVerifier(store: Store): VerifierEnvelope | null {
  const raw = store.get<string | null>('shared', VERIFIER_KEY, null);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
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

/** Read the persisted base64 salt, or `null` when absent. */
function readSalt(store: Store): string | null {
  const raw = store.get<string | null>('shared', SALT_KEY, null);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function createVault(deps: {
  store: Store;
  now?: () => number;
}): VaultClient {
  // The derived key lives ONLY here — never persisted, never logged.
  let inMemoryKey: CryptoKey | null = null;
  const nowFn = deps.now ?? (() => Date.now());

  function state(): VaultState {
    const exists = readSalt(deps.store) !== null && readVerifier(deps.store) !== null;
    return { exists, unlocked: inMemoryKey !== null };
  }

  async function create(passphrase: string): Promise<CreateResult> {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      const strength = await passphraseStrength(passphrase);
      return {
        ok: false,
        code: 'weak-passphrase',
        message: `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
        notes: strength.notes,
      };
    }

    const salt = randomSalt();
    const kdfIterations = CRYPTO_PARAMS.PBKDF2_ITERATIONS;
    const key = await deriveKey(passphrase, salt, kdfIterations);

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
    return { ok: true };
  }

  async function unlock(passphrase: string): Promise<UnlockResult> {
    const saltBase64 = readSalt(deps.store);
    const verifier = readVerifier(deps.store);
    if (!saltBase64 || !verifier) {
      return { ok: false, code: 'no-vault', message: 'no vault on this device' };
    }

    const salt = base64ToBytes(saltBase64);
    const key = await deriveKey(passphrase, salt, verifier.kdf_iter);

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

    inMemoryKey = key;
    try {
      events.emit('vault:unlocked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
    }
    return { ok: true };
  }

  function lock(): void {
    inMemoryKey = null;
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

export { MIN_PASSPHRASE_LENGTH };
