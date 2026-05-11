/**
 * @ollie/crypto · round-trip + adversarial tests
 */

import { describe, it, expect } from 'vitest';
import {
  deriveKey,
  encryptData,
  decryptData,
  randomSalt,
  randomIv,
  bytesToBase64,
  base64ToBytes,
  passphraseStrength,
  CRYPTO_PARAMS,
} from '../src/index';

describe('crypto · deriveKey + round-trip', () => {
  it('round-trips an object', async () => {
    const salt = randomSalt();
    const key = await deriveKey('correct horse battery staple ✿', salt);
    const enc = await encryptData(key, { hello: 'world', n: 42 });
    const out = await decryptData<{ hello: string; n: number }>(key, enc);
    expect(out).toEqual({ hello: 'world', n: 42 });
  });

  it('round-trips an array', async () => {
    const salt = randomSalt();
    const key = await deriveKey('pwd-1234567890abcdef', salt);
    const enc = await encryptData(key, [1, 2, 3]);
    const out = await decryptData(key, enc);
    expect(out).toEqual([1, 2, 3]);
  });

  it('round-trips unicode', async () => {
    const salt = randomSalt();
    const key = await deriveKey('hece ipi 한글 🌿', salt);
    const data = { name: 'tontin', note: 'çok şirin · 🐾' };
    const enc = await encryptData(key, data);
    const out = await decryptData(key, enc);
    expect(out).toEqual(data);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const salt = randomSalt();
    const key = await deriveKey('a-passphrase-of-good-length', salt);
    const a = await encryptData(key, { x: 1 });
    const b = await encryptData(key, { x: 1 });
    expect(bytesToBase64(a.ciphertext)).not.toBe(bytesToBase64(b.ciphertext));
    expect(bytesToBase64(a.iv)).not.toBe(bytesToBase64(b.iv));
  });
});

describe('crypto · adversarial', () => {
  it('wrong passphrase → decrypt throws', async () => {
    const salt = randomSalt();
    const key1 = await deriveKey('right-passphrase-aaaaaaaa', salt);
    const enc = await encryptData(key1, { a: 1 });
    const key2 = await deriveKey('wrong-passphrase-bbbbbbbb', salt);
    await expect(decryptData(key2, enc)).rejects.toThrow();
  });

  it('different salt with same passphrase → decrypt throws', async () => {
    const passphrase = 'same-passphrase-twice-over';
    const enc = await encryptData(await deriveKey(passphrase, randomSalt()), { a: 1 });
    const otherKey = await deriveKey(passphrase, randomSalt());
    await expect(decryptData(otherKey, enc)).rejects.toThrow();
  });

  it('tampered ciphertext → decrypt throws (auth tag check)', async () => {
    const salt = randomSalt();
    const key = await deriveKey('passphrase-of-sufficient-length', salt);
    const enc = await encryptData(key, { secret: 'shh' });
    const tampered = new Uint8Array(enc.ciphertext);
    tampered[0] ^= 0xff;
    await expect(decryptData(key, { iv: enc.iv, ciphertext: tampered })).rejects.toThrow();
  });

  it('tampered IV → decrypt throws', async () => {
    const salt = randomSalt();
    const key = await deriveKey('passphrase-of-sufficient-length', salt);
    const enc = await encryptData(key, { x: 1 });
    const ivTampered = new Uint8Array(enc.iv);
    ivTampered[5] ^= 0x10;
    await expect(decryptData(key, { iv: ivTampered, ciphertext: enc.ciphertext })).rejects.toThrow();
  });

  it('decryptData refuses missing iv / ciphertext', async () => {
    const salt = randomSalt();
    const key = await deriveKey('passphrase-of-sufficient-length', salt);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(decryptData(key, {} as any)).rejects.toThrow();
  });

  it('deriveKey refuses empty passphrase', async () => {
    await expect(deriveKey('', randomSalt())).rejects.toThrow();
  });

  it('deriveKey refuses too-short salt', async () => {
    await expect(deriveKey('long-enough-passphrase-here', new Uint8Array(4))).rejects.toThrow();
  });
});

describe('crypto · IV / salt randomness', () => {
  it('randomSalt returns 16 bytes', () => {
    expect(randomSalt().byteLength).toBe(16);
  });
  it('randomIv returns 12 bytes', () => {
    expect(randomIv().byteLength).toBe(12);
  });
  it('two consecutive salts differ (probabilistically)', () => {
    expect(bytesToBase64(randomSalt())).not.toBe(bytesToBase64(randomSalt()));
  });
});

describe('crypto · base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64, 0]);
    const b64 = bytesToBase64(bytes);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });
});

describe('crypto · passphraseStrength', () => {
  it('flags short passphrases as weak', () => {
    const s = passphraseStrength('short');
    expect(s.band).toBe('weak');
    expect(s.notes).toContain('must be at least 16 characters');
  });

  it('rewards length + class diversity', () => {
    const s = passphraseStrength('Correct-Horse-Battery-Staple-42!');
    expect(['strong', 'great']).toContain(s.band);
  });

  it('penalises three-in-a-row repeats', () => {
    const s = passphraseStrength('aaaaaaaaaaaaaaaaa1B!');
    expect(s.notes).toContain('avoid three-in-a-row repeats');
  });
});

describe('crypto · constants', () => {
  it('exposes locked params', () => {
    expect(CRYPTO_PARAMS.PBKDF2_ITERATIONS).toBe(100_000);
    expect(CRYPTO_PARAMS.IV_BYTES).toBe(12);
    expect(CRYPTO_PARAMS.SALT_BYTES).toBe(16);
    expect(CRYPTO_PARAMS.KEY_BITS).toBe(256);
    expect(CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH).toBe(16);
  });
});
