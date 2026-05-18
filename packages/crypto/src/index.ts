/**
 * @ollie/crypto · AES-GCM-256 + PBKDF2 passphrase-derived primitives
 *
 * Sprint 2 · C1. Ports the legacy `window.VOID.backup` crypto path
 * out of void-app.html into a testable package. Used by:
 *   - @ollie/sync     — encrypted per-module sync via Supabase (opt-out path)
 *   - @ollie/backup   — encrypted .json export/import
 *   - @ollie/auth     — passphrase → derived key chain
 *
 * NOTE (Sprint B' pivot 2026-05-14): the original posture was that the
 * server never sees raw user data, full stop. That default was abandoned
 * for the opt-in anonymized data-collection model (see `@ollie/consent`
 * + `@ollie/pii-scrub` + `research_corpus`). This crypto package is
 * retained for: (a) the auth passphrase derivation that still keeps the
 * LOGIN passphrase off-server, (b) encrypted backup export/import, and
 * (c) the future opt-out sync path if a B2B customer demands it.
 *
 * Parameters:
 *   PBKDF2:  SHA-256, 16-byte random salt
 *            iteration count — see below (S7)
 *   AES-GCM: 256-bit key, 12-byte random IV (NIST-recommended)
 *
 * SECURITY (S7 · iteration count is migration-sensitive):
 *   The PBKDF2 iteration count was raised from 100_000 to 600_000 to
 *   meet OWASP's current PBKDF2-SHA256 guidance. A flat bump would have
 *   broken decryption of every existing backup, profile, and login —
 *   their keys were derived at 100k and a 600k re-derivation yields a
 *   DIFFERENT key.
 *
 *   The fix is structural: every encrypted envelope now STORES the
 *   iteration count it was derived with, and the decrypter reads it
 *   back. New derivations use `PBKDF2_ITERATIONS` (600k). Old payloads
 *   carry no stored count — the decrypter falls back to
 *   `LEGACY_PBKDF2_ITERATIONS` (100k) so they still decrypt.
 *
 *   `deriveKey`'s `iterations` parameter is therefore EXPLICIT for any
 *   read path: a caller decrypting a stored payload MUST pass the
 *   payload's stored count (or LEGACY when absent). The default (600k)
 *   is only correct for a brand-new derivation.
 *
 * All functions are pure — no store, no events, no wall-clock reads.
 */

/**
 * Current PBKDF2 iteration count for NEW derivations (OWASP 2023+
 * guidance for PBKDF2-SHA256).
 */
const PBKDF2_ITERATIONS = 600_000;

/**
 * The historical iteration count. Payloads written before the S7 bump
 * carry NO stored count; the decrypter falls back to this value.
 * DO NOT change — it is a fixed compatibility constant.
 */
const LEGACY_PBKDF2_ITERATIONS = 100_000;

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
 * PBKDF2 SHA-256. Pure — deterministic given the same passphrase + salt
 * + iteration count.
 *
 * @param iterations PBKDF2 iteration count. Defaults to the current
 *   `PBKDF2_ITERATIONS` (600k) — correct ONLY for a fresh derivation.
 *   When DECRYPTING a stored payload you MUST pass the count that
 *   payload was written with: read it from the envelope, falling back
 *   to `LEGACY_PBKDF2_ITERATIONS` (100k) when the field is absent. See
 *   the S7 note at the top of this file.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (!passphrase) {
    throw new Error('@ollie/crypto: passphrase must be a non-empty string');
  }
  if (!salt || salt.byteLength < 8) {
    throw new Error(`@ollie/crypto: salt must be ≥ 8 bytes, got ${salt?.byteLength ?? 0}`);
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`@ollie/crypto: iterations must be a positive integer, got ${iterations}`);
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
      iterations,
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
// Strength meter — used by signup UI (C5).
//
// Backed by zxcvbn (Dropbox's research-grade estimator: dictionary, l33t,
// keyboard-pattern and date detection) instead of the old hand-rolled
// length × character-class heuristic. zxcvbn ships a ~400 KB dictionary,
// so it is LAZY-LOADED via dynamic import — the cost is only paid the
// first time the signup screen scores a passphrase.
// ──────────────────────────────────────────────────────────────────────────

export interface PassphraseStrength {
  /** 0–100. Derived from zxcvbn's 0–4 crack-resistance score. */
  score: number;
  /** human-readable bucket. */
  band: 'weak' | 'ok' | 'strong' | 'great';
  /** specific recommendations to improve. */
  notes: string[];
}

const MIN_LENGTH = 12;

/** Map zxcvbn's integer 0–4 score onto our 0–100 scale + band. */
function bandFor(zScore: 0 | 1 | 2 | 3 | 4): { score: number; band: PassphraseStrength['band'] } {
  switch (zScore) {
    case 0: return { score: 10,  band: 'weak' };
    case 1: return { score: 35,  band: 'weak' };
    case 2: return { score: 55,  band: 'ok' };
    case 3: return { score: 75,  band: 'strong' };
    case 4: return { score: 95,  band: 'great' };
  }
}

/**
 * Score a passphrase with zxcvbn. Async because zxcvbn is lazy-loaded.
 *
 * The MIN_LENGTH (12-char) hard floor is enforced on top of zxcvbn: a
 * passphrase shorter than the minimum is always capped to the 'weak'
 * band regardless of entropy, and carries the explicit length note.
 */
export async function passphraseStrength(passphrase: string): Promise<PassphraseStrength> {
  const { default: zxcvbn } = await import('zxcvbn');
  const result = zxcvbn(passphrase ?? '');

  const zScore = result.score as 0 | 1 | 2 | 3 | 4;
  let { score, band } = bandFor(zScore);

  const notes: string[] = [];
  if ((passphrase ?? '').length < MIN_LENGTH) {
    notes.push(`must be at least ${MIN_LENGTH} characters`);
    // Below the hard floor we never advertise more than 'weak'.
    band = 'weak';
    score = Math.min(score, 35);
  }
  // Surface zxcvbn's own guidance (warning + suggestions) verbatim.
  const warning = result.feedback?.warning;
  if (warning) notes.push(warning.toLowerCase());
  for (const s of result.feedback?.suggestions ?? []) {
    notes.push(s.toLowerCase());
  }

  return { score, band, notes };
}

export const CRYPTO_PARAMS = {
  /** Iteration count for NEW derivations (OWASP 2023+ guidance). */
  PBKDF2_ITERATIONS,
  /** Historical count — payloads with no stored count decrypt with this. */
  LEGACY_PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  KEY_BITS,
  MIN_PASSPHRASE_LENGTH: MIN_LENGTH,
} as const;
