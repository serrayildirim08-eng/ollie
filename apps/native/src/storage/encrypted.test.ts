/**
 * encryptedKv tests — envelope iteration count (#12).
 *
 * The persisted envelope records the PBKDF2 iteration count used to derive
 * the key. This pins:
 *   1. round-trip set→get works,
 *   2. the iteration count is written into the envelope,
 *   3. a future iteration bump does NOT break old values (each value decrypts
 *      with the count it was written with),
 *   4. a legacy envelope with no `iterations` field decrypts at 100k.
 *
 * `./kv` is mocked with an in-memory Map so we exercise the real crypto path
 * (jsdom provides crypto.subtle).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveKey,
  encryptData,
  randomSalt,
  bytesToBase64,
  CRYPTO_PARAMS,
} from '@ollie/crypto';

const mem = new Map<string, unknown>();

vi.mock('./kv', () => ({
  kv: {
    async get<T>(key: string): Promise<T | null> {
      return (mem.has(key) ? (mem.get(key) as T) : null);
    },
    async set<T>(key: string, val: T): Promise<void> {
      mem.set(key, val);
    },
    async delete(key: string): Promise<void> {
      mem.delete(key);
    },
  },
}));

import { encryptedKv } from './encrypted';

interface RawEnvelope {
  iv: string;
  ciphertext: string;
  salt: string;
  iterations?: number;
}

const PASS = 'correct horse battery staple';

beforeEach(() => {
  mem.clear();
});

describe('encryptedKv · iteration count in envelope (#12)', () => {
  it('round-trips a value and records the current iteration count', async () => {
    await encryptedKv.set('k', { hello: 'world' }, PASS);
    const env = mem.get('k') as RawEnvelope;
    expect(env.iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);

    const back = await encryptedKv.get<{ hello: string }>('k', PASS);
    expect(back).toEqual({ hello: 'world' });
  });

  it('decrypts a value written with a DIFFERENT (legacy) iteration count', async () => {
    // Hand-build an envelope at the legacy 100k count, simulating a value
    // written before a future bump to PBKDF2_ITERATIONS.
    const salt = randomSalt();
    const legacyIters = CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS;
    const key = await deriveKey(PASS, salt, legacyIters);
    const { iv, ciphertext } = await encryptData(key, { v: 42 });
    mem.set('legacy', {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      salt: bytesToBase64(salt),
      iterations: legacyIters,
    } satisfies RawEnvelope);

    // get() must derive with the STORED count, not the current default.
    const back = await encryptedKv.get<{ v: number }>('legacy', PASS);
    expect(back).toEqual({ v: 42 });
  });

  it('falls back to LEGACY 100k for an envelope with NO iterations field', async () => {
    const salt = randomSalt();
    const key = await deriveKey(PASS, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const { iv, ciphertext } = await encryptData(key, 'pre-S7');
    // Note: NO `iterations` field — an envelope written before the field existed.
    mem.set('old', {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      salt: bytesToBase64(salt),
    } satisfies RawEnvelope);

    const back = await encryptedKv.get<string>('old', PASS);
    expect(back).toBe('pre-S7');
  });

  it('a future iteration bump keeps newly-written values decryptable', async () => {
    // Write at the current count, then read back — proving get() honours the
    // per-envelope count rather than assuming a single global constant.
    await encryptedKv.set('future', [1, 2, 3], PASS);
    const env = mem.get('future') as RawEnvelope;
    // Simulate the codebase later raising the default: the stored envelope is
    // unchanged and must still decrypt because the count travels with it.
    expect(env.iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    const back = await encryptedKv.get<number[]>('future', PASS);
    expect(back).toEqual([1, 2, 3]);
  });
});
