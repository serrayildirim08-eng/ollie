/**
 * native/storage/encrypted.ts — encrypted KV
 *
 * Wraps `kv` with AES-GCM-256 encryption from @ollie/crypto.
 * Per-value salt is stored alongside the ciphertext so the same
 * passphrase always decrypts correctly across sessions/devices.
 *
 * Persisted shape per key (JSON-stringified inside kv):
 *   { iv: string; ciphertext: string; salt: string }   (all base64)
 */

import {
  deriveKey,
  encryptData,
  decryptData,
  randomSalt,
  bytesToBase64,
  base64ToBytes,
} from '@ollie/crypto';
import type { EncryptedPayload } from '@ollie/crypto';
import { kv } from './kv';

interface StoredEnvelope {
  iv: string;         // base64
  ciphertext: string; // base64
  salt: string;       // base64
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
    const cryptoKey = await deriveKey(passphrase, salt);
    return decryptData<T>(cryptoKey, payload);
  },

  async set<T = unknown>(key: string, val: T, passphrase: string): Promise<void> {
    const salt = randomSalt();
    const cryptoKey = await deriveKey(passphrase, salt);
    const { iv, ciphertext } = await encryptData(cryptoKey, val);

    const envelope: StoredEnvelope = {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      salt: bytesToBase64(salt),
    };
    await kv.set(key, envelope);
  },
};
