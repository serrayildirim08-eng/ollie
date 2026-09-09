/**
 * native/storage/encrypted.ts — encrypted KV
 *
 * Wraps `kv` with AES-GCM-256 encryption from @ollie/crypto.
 * Per-value salt is stored alongside the ciphertext so the same
 * passphrase always decrypts correctly across sessions/devices.
 *
 * Persisted shape per key (JSON-stringified inside kv):
 *   { iv: string; ciphertext: string; salt: string; iterations?: number }
 *   (iv/ciphertext/salt are all base64)
 *
 * S7 — PBKDF2 iteration count is migration-sensitive. The iteration count
 * used at derivation time is written into the envelope (`iterations`) so a
 * future bump to `PBKDF2_ITERATIONS` doesn't render prior values
 * undecryptable. Envelopes written before this field existed are decrypted
 * with the historical 100k count (LEGACY_PBKDF2_ITERATIONS).
 */

import {
  deriveKey,
  encryptData,
  decryptData,
  randomSalt,
  bytesToBase64,
  base64ToBytes,
  CRYPTO_PARAMS,
} from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';
import { kv } from './kv';

interface StoredEnvelope {
  iv: string;          // base64
  ciphertext: string;  // base64
  salt: string;        // base64
  /** PBKDF2 iteration count used to derive the key. Absent → legacy 100k. */
  iterations?: number;
}

function envelopeToPayload(env: StoredEnvelope): { payload: EncryptedPayload; salt: Uint8Array } {
  return {
    payload: {
      iv: base64ToBytes(env.iv),
      ciphertext: base64ToBytes(env.ciphertext),
    },
    salt: base64ToBytes(env.salt),
  };
}

export const encryptedKv = {
  async get<T = unknown>(key: string, passphrase: string): Promise<T | null> {
    const envelope = await kv.get<StoredEnvelope>(key);
    if (!envelope) return null;

    const { payload, salt } = envelopeToPayload(envelope);
    // Missing `iterations` ⇒ envelope predates the S7 field ⇒ legacy 100k.
    const iterations = envelope.iterations ?? CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
    const cryptoKey = await deriveKey(passphrase, salt, iterations);
    return decryptData<T>(cryptoKey, payload);
  },

  async set<T = unknown>(key: string, val: T, passphrase: string): Promise<void> {
    const salt = randomSalt();
    const iterations = CRYPTO_PARAMS.PBKDF2_ITERATIONS;
    const cryptoKey = await deriveKey(passphrase, salt, iterations);
    const { iv, ciphertext } = await encryptData(cryptoKey, val);

    const envelope: StoredEnvelope = {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      salt: bytesToBase64(salt),
      iterations,
    };
    await kv.set(key, envelope);
  },
};
