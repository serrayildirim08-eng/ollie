/**
 * @ollie/crypto · AES-GCM-256 + PBKDF2 zero-knowledge primitives
 *
 * Sprint 2 · C1. Ports the legacy `window.VOID.backup` crypto path
 * out of void-app.html into a testable package. Used by:
 *   - @ollie/sync     — encrypted per-module sync via Supabase
 *   - @ollie/backup   — encrypted .json export/import
 *   - @ollie/auth     — passphrase → derived key chain
 *
 * Constitutional rule (Decision · zero-knowledge):
 *   the server NEVER sees raw user data. all encryption happens on
 *   the device. the passphrase is derived into a CryptoKey that
 *   lives only in memory — losing the passphrase means losing the
 *   data, by design.
 *
 * Parameters (locked):
 *   PBKDF2:  SHA-256, 100_000 iterations, 16-byte random salt
 *   AES-GCM: 256-bit key, 12-byte random IV (NIST-recommended)
 *
 * All functions are pure — no store, no events, no wall-clock reads.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedPayload {
  /** Random 12-byte IV used for this encryption. */
  iv: Uint8Array;
  /** AES-GCM-256 ciphertext (includes 16-byte auth tag at end). */
  ciphertext: Uint8Array;
}

// ──────────────────────────────────────────────────────────────────────────
// crypto.subtle access — works in browser, Node 20+, workers, jsdom.
// ──────────────────────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
    crypto?: { subtle?: SubtleCrypto };
  };
  const s = g.crypto?.subtle;
  if (!s) {
    throw new Error('@ollie/crypto: crypto.subtle not available in this environment');
  }
  return s;
}

function getRandomValues<T extends ArrayBufferView>(arr: T): T {
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto?: { getRandomValues?: (a: any) => any };
  };
  const r = g.crypto?.getRandomValues;
  if (!r) throw new Error('@ollie/crypto: crypto.getRandomValues not available');
  return r.call(g.crypto, arr) as T;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Generate a fresh random salt. Store this alongside the encrypted
 * payload — callers need the same salt to derive the same key from
 * the same passphrase on another device.
 */
export function randomSalt(): Uint8Array {
  return getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Generate a fresh random IV. Must be unique per (key, plaintext)
 * to maintain AES-GCM security guarantees. We use a fresh 12-byte
 * IV per encryption call.
 */
export function randomIv(): Uint8Array {
  return getRandomValues(new Uint8Array(IV_BYTES));
}

/**
 * Derive an AES-GCM-256 CryptoKey from a passphrase + salt.
 * PBKDF2 SHA-256 100k iterations. Pure — deterministic given the
 * same passphrase + salt.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!passphrase) {
    throw new Error('@ollie/crypto: passphrase must be a non-empty string');
  }
  if (!salt || salt.byteLength < 8) {
    throw new Error(`@ollie/crypto: salt must be ≥ 8 bytes, got ${salt?.byteLength ?? 0}`);
  }
  const subtle = getSubtle();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt an arbitrary JSON-serializable value. Returns the IV and
 * ciphertext separately so callers can persist them as fields on a
 * row (Supabase) or as keys in a backup envelope.
 */
export async function encryptData(
  key: CryptoKey,
  data: unknown,
): Promise<EncryptedPayload> {
  const subtle = getSubtle();
  const iv = randomIv();
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource),
  );
  return { iv, ciphertext };
}

/**
 * Decrypt an EncryptedPayload back to its JSON value. Throws on:
 *   - wrong key (key derived from wrong passphrase)
 *   - tampered ciphertext (auth tag mismatch)
 *   - tampered IV
 *   - non-JSON plaintext (corrupt envelope)
 *
 * Callers should catch and surface a friendly "wrong passphrase /
 * corrupt backup" message — never log the underlying error to the
 * user.
 */
export async function decryptData<T = unknown>(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<T> {
  if (!payload || !payload.iv || !payload.ciphertext) {
    throw new Error('@ollie/crypto: payload must include iv and ciphertext');
  }
  const subtle = getSubtle();
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: payload.iv as BufferSource },
    key,
    payload.ciphertext as BufferSource,
  );
  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text) as T;
}

// ──────────────────────────────────────────────────────────────────────────
// base64 helpers — for persisting bytes as strings (Supabase bytea fields
// can accept hex/base64; backup .json file stores base64 strings).
// ──────────────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  // btoa is available in browsers + Node 20+
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis;
  if (typeof g.btoa === 'function') return g.btoa(bin);
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64) as string;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// ──────────────────────────────────────────────────────────────────────────
// Strength meter — used by signup UI (C5). Pure, no entropy library deps.
// ──────────────────────────────────────────────────────────────────────────

export interface PassphraseStrength {
  /** 0–100. Crude but useful: length × character-class diversity. */
  score: number;
  /** human-readable bucket. */
  band: 'weak' | 'ok' | 'strong' | 'great';
  /** specific recommendations to improve. */
  notes: string[];
}

const MIN_LENGTH = 16;

export function passphraseStrength(passphrase: string): PassphraseStrength {
  const notes: string[] = [];
  const len = passphrase.length;
  let classes = 0;
  if (/[a-z]/.test(passphrase)) classes++;
  if (/[A-Z]/.test(passphrase)) classes++;
  if (/[0-9]/.test(passphrase)) classes++;
  if (/[^A-Za-z0-9]/.test(passphrase)) classes++;

  if (len < MIN_LENGTH) notes.push(`must be at least ${MIN_LENGTH} characters`);
  if (classes < 2) notes.push('mix in upper/lower/digits or punctuation');
  if (/(.)\1\1/.test(passphrase)) notes.push('avoid three-in-a-row repeats');

  let score = Math.min(100, Math.round(len * 4 + (classes - 1) * 10));
  if (len < MIN_LENGTH) score = Math.min(score, 35);
  if (classes < 2) score = Math.min(score, 50);

  let band: PassphraseStrength['band'];
  if (score >= 85) band = 'great';
  else if (score >= 65) band = 'strong';
  else if (score >= 45) band = 'ok';
  else band = 'weak';

  return { score, band, notes };
}

export const CRYPTO_PARAMS = {
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  KEY_BITS,
  MIN_PASSPHRASE_LENGTH: MIN_LENGTH,
} as const;
