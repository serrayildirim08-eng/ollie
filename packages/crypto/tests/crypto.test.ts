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
  bytesToPgHex,
  pgHexToBytes,
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
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(decryptData(key, { iv: enc.iv, ciphertext: tampered })).rejects.toThrow();
  });

  it('tampered IV → decrypt throws', async () => {
    const salt = randomSalt();
    const key = await deriveKey('passphrase-of-sufficient-length', salt);
    const enc = await encryptData(key, { x: 1 });
    const ivTampered = new Uint8Array(enc.iv);
    ivTampered[5] = (ivTampered[5] ?? 0) ^ 0x10;
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

describe('crypto · passphraseStrength (zxcvbn-backed)', () => {
  it('flags short passphrases as weak', async () => {
    const s = await passphraseStrength('short');
    expect(s.band).toBe('weak');
    expect(s.notes).toContain(
      `must be at least ${CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH} characters`,
    );
  });

  it('flags an 11-char passphrase (one below the floor) as weak', async () => {
    const s = await passphraseStrength('a1B!a1B!a1B'); // 11 chars
    expect(s.band).toBe('weak');
    expect(s.notes).toContain(
      `must be at least ${CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH} characters`,
    );
  });

  it('does not add the length note for a 12-char passphrase (at the floor)', async () => {
    const s = await passphraseStrength('Tr0ub4dor&3X'); // 12 chars — exact minimum
    expect(s.notes).not.toContain(
      `must be at least ${CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH} characters`,
    );
  });

  it('rewards a long, high-entropy passphrase', async () => {
    const s = await passphraseStrength('Correct-Horse-Battery-Staple-42!');
    expect(['strong', 'great']).toContain(s.band);
    expect(s.score).toBeGreaterThanOrEqual(65);
  });

  it('rates a low-entropy long passphrase below a high-entropy one', async () => {
    // zxcvbn catches a dictionary/pattern weakness the old length×class
    // heuristic missed: this is 20 chars but trivially guessable.
    const weak = await passphraseStrength('password123password1');
    const strong = await passphraseStrength('Correct-Horse-Battery-Staple-42!');
    expect(weak.score).toBeLessThan(strong.score);
  });

  it('a 3-in-a-row repeat string surfaces zxcvbn guidance', async () => {
    const s = await passphraseStrength('aaaaaaaaaaaaaaaaa1B!');
    expect(s.band).toBe('weak');
    // zxcvbn emits a warning/suggestion for repeated characters.
    expect(s.notes.length).toBeGreaterThan(0);
  });
});

describe('crypto · constants', () => {
  it('exposes locked params', () => {
    // S7: new derivations use 600k (OWASP 2023+ PBKDF2-SHA256 guidance).
    expect(CRYPTO_PARAMS.PBKDF2_ITERATIONS).toBe(600_000);
    // Legacy count is a fixed compat constant — payloads with no stored
    // count decrypt with this.
    expect(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS).toBe(100_000);
    expect(CRYPTO_PARAMS.IV_BYTES).toBe(12);
    expect(CRYPTO_PARAMS.SALT_BYTES).toBe(16);
    expect(CRYPTO_PARAMS.KEY_BITS).toBe(256);
    expect(CRYPTO_PARAMS.MIN_PASSPHRASE_LENGTH).toBe(12);
  });
});

// ─── S7 · PBKDF2 iteration count is migration-sensitive ───────────────────────

describe('crypto · S7 · deriveKey iteration count', () => {
  it('a key derived at 100k decrypts a payload encrypted at 100k (legacy round-trip)', async () => {
    const salt = randomSalt();
    const legacyKey = await deriveKey('legacy-passphrase-aaaa', salt, 100_000);
    const enc = await encryptData(legacyKey, { era: 'pre-S7', n: 1 });
    // Re-derive with the SAME legacy count → same key → decrypts.
    const reKey = await deriveKey('legacy-passphrase-aaaa', salt, 100_000);
    const out = await decryptData<{ era: string; n: number }>(reKey, enc);
    expect(out).toEqual({ era: 'pre-S7', n: 1 });
  });

  it('a key derived at 600k decrypts a payload encrypted at 600k (new round-trip)', async () => {
    const salt = randomSalt();
    const newKey = await deriveKey('new-passphrase-bbbbbb', salt, 600_000);
    const enc = await encryptData(newKey, { era: 'post-S7', n: 2 });
    const reKey = await deriveKey('new-passphrase-bbbbbb', salt, 600_000);
    const out = await decryptData<{ era: string; n: number }>(reKey, enc);
    expect(out).toEqual({ era: 'post-S7', n: 2 });
  });

  it('the default iteration count is 600k (a no-arg derivation matches an explicit 600k one)', async () => {
    const salt = randomSalt();
    const defaultKey = await deriveKey('same-passphrase-cccccc', salt);
    const enc = await encryptData(defaultKey, { x: 7 });
    // An explicit-600k key must decrypt what the default produced.
    const explicit = await deriveKey('same-passphrase-cccccc', salt, 600_000);
    expect(await decryptData(explicit, enc)).toEqual({ x: 7 });
  });

  it('a 600k key CANNOT decrypt a 100k payload (counts must match — proves the field is load-bearing)', async () => {
    const salt = randomSalt();
    const legacyKey = await deriveKey('crossed-passphrase-dddd', salt, 100_000);
    const enc = await encryptData(legacyKey, { secret: 'shh' });
    const wrongCountKey = await deriveKey('crossed-passphrase-dddd', salt, 600_000);
    await expect(decryptData(wrongCountKey, enc)).rejects.toThrow();
  });

  it('rejects a non-positive / non-integer iteration count', async () => {
    const salt = randomSalt();
    await expect(deriveKey('passphrase-here-xxxxxx', salt, 0)).rejects.toThrow();
    await expect(deriveKey('passphrase-here-xxxxxx', salt, -1)).rejects.toThrow();
    await expect(deriveKey('passphrase-here-xxxxxx', salt, 1.5)).rejects.toThrow();
  });
});

// ─── B3-8 · expanded coverage — security/privacy-critical package ─────────────

describe('crypto · payload shapes round-trip', () => {
  it('round-trips null, false, 0, and empty string', async () => {
    const key = await deriveKey('payload-edge-cases-pass', randomSalt());
    for (const v of [null, false, 0, '', [], {}] as const) {
      const enc = await encryptData(key, v);
      expect(await decryptData(key, enc)).toEqual(v);
    }
  });

  it('round-trips a deeply nested object', async () => {
    const key = await deriveKey('nested-object-passphrase', randomSalt());
    const data = { a: { b: { c: [1, { d: 'deep' }], e: true } }, f: null };
    const enc = await encryptData(key, data);
    expect(await decryptData(key, enc)).toEqual(data);
  });

  it('round-trips a large (~64 KB) payload', async () => {
    const key = await deriveKey('large-payload-passphrase', randomSalt());
    const data = { blob: 'x'.repeat(64 * 1024) };
    const enc = await encryptData(key, data);
    const out = await decryptData<typeof data>(key, enc);
    expect(out.blob.length).toBe(64 * 1024);
  });

  it('encryptData produces a 12-byte IV per call', async () => {
    const key = await deriveKey('iv-length-check-passphr', randomSalt());
    const enc = await encryptData(key, { x: 1 });
    expect(enc.iv.byteLength).toBe(12);
  });

  it('ciphertext is longer than plaintext (16-byte GCM auth tag appended)', async () => {
    const key = await deriveKey('auth-tag-length-passphr', randomSalt());
    const plaintext = JSON.stringify({ x: 1 });
    const enc = await encryptData(key, { x: 1 });
    expect(enc.ciphertext.byteLength).toBe(plaintext.length + 16);
  });
});

describe('crypto · decryptData rejection paths', () => {
  it('rejects a payload missing iv', async () => {
    const key = await deriveKey('missing-iv-passphrase-x', randomSalt());
    const enc = await encryptData(key, { x: 1 });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decryptData(key, { ciphertext: enc.ciphertext } as any),
    ).rejects.toThrow(/iv and ciphertext/);
  });

  it('rejects a payload missing ciphertext', async () => {
    const key = await deriveKey('missing-ct-passphrase-x', randomSalt());
    const enc = await encryptData(key, { x: 1 });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decryptData(key, { iv: enc.iv } as any),
    ).rejects.toThrow(/iv and ciphertext/);
  });

  it('rejects a null payload', async () => {
    const key = await deriveKey('null-payload-passphrase', randomSalt());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(decryptData(key, null as any)).rejects.toThrow();
  });

  it('truncated ciphertext (shorter than auth tag) → throws', async () => {
    const key = await deriveKey('truncated-ct-passphrase', randomSalt());
    const enc = await encryptData(key, { x: 1 });
    const truncated = enc.ciphertext.slice(0, 4);
    await expect(decryptData(key, { iv: enc.iv, ciphertext: truncated })).rejects.toThrow();
  });

  it('an empty-byte ciphertext → throws', async () => {
    const key = await deriveKey('empty-ct-passphrase-xxx', randomSalt());
    await expect(
      decryptData(key, { iv: randomIv(), ciphertext: new Uint8Array(0) }),
    ).rejects.toThrow();
  });
});

describe('crypto · deriveKey validation', () => {
  it('a salt of exactly 8 bytes is accepted (the documented floor)', async () => {
    const key = await deriveKey('eight-byte-salt-passphr', new Uint8Array(8).fill(7));
    const enc = await encryptData(key, { ok: true });
    expect(await decryptData(key, enc)).toEqual({ ok: true });
  });

  it('rejects a 7-byte salt (one below the floor)', async () => {
    await expect(
      deriveKey('seven-byte-salt-passphr', new Uint8Array(7)),
    ).rejects.toThrow(/≥ 8 bytes/);
  });

  it('the derived key is non-extractable', async () => {
    const key = await deriveKey('non-extractable-passphr', randomSalt());
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('same passphrase + same salt + same count → interchangeable keys', async () => {
    const salt = randomSalt();
    const k1 = await deriveKey('determinism-passphrase-', salt);
    const k2 = await deriveKey('determinism-passphrase-', salt);
    const enc = await encryptData(k1, { proof: 'deterministic' });
    // k2 must decrypt what k1 encrypted — proves PBKDF2 is deterministic.
    expect(await decryptData(k2, enc)).toEqual({ proof: 'deterministic' });
  });
});

describe('crypto · base64 helpers — edge cases', () => {
  it('round-trips empty bytes', () => {
    expect(Array.from(base64ToBytes(bytesToBase64(new Uint8Array(0))))).toEqual([]);
  });

  it('round-trips all 256 byte values', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
  });

  it('round-trips a real encrypted payload through base64', async () => {
    const key = await deriveKey('base64-roundtrip-passph', randomSalt());
    const enc = await encryptData(key, { secret: 'shh', n: 9 });
    const rebuilt = {
      iv: base64ToBytes(bytesToBase64(enc.iv)),
      ciphertext: base64ToBytes(bytesToBase64(enc.ciphertext)),
    };
    expect(await decryptData(key, rebuilt)).toEqual({ secret: 'shh', n: 9 });
  });

  it('bytesToBase64 output is valid base64 (decodes without throwing)', () => {
    const b64 = bytesToBase64(randomSalt());
    expect(() => base64ToBytes(b64)).not.toThrow();
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('crypto · IV uniqueness at scale', () => {
  it('100 IVs are all distinct (random source sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(bytesToBase64(randomIv()));
    expect(seen.size).toBe(100);
  });

  it('100 salts are all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(bytesToBase64(randomSalt()));
    expect(seen.size).toBe(100);
  });
});

describe('crypto · passphraseStrength — bands + guidance', () => {
  it('an empty / nullish passphrase does not throw and lands weak', async () => {
    const s = await passphraseStrength('');
    expect(s.band).toBe('weak');
    expect(s.score).toBeLessThanOrEqual(35);
  });

  it('score is always within 0..100 and band is one of the four buckets', async () => {
    for (const p of ['', 'abc', 'password', 'Correct-Horse-Battery-Staple-42!']) {
      const s = await passphraseStrength(p);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(['weak', 'ok', 'strong', 'great']).toContain(s.band);
    }
  });

  it('notes is always an array of strings', async () => {
    const s = await passphraseStrength('Correct-Horse-Battery-Staple-42!');
    expect(Array.isArray(s.notes)).toBe(true);
    for (const n of s.notes) expect(typeof n).toBe('string');
  });

  it('a passphrase below the floor is never advertised above weak', async () => {
    // 11 chars, high character-class diversity — zxcvbn alone might score
    // it higher, but the hard length floor caps it at weak.
    const s = await passphraseStrength('aB3$aB3$aB3');
    expect(s.band).toBe('weak');
  });
});

describe('crypto · Postgres bytea hex helpers (audit #1)', () => {
  it('encodes bytes as \\x + lowercase hex, two chars per byte', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xab, 0xff]);
    expect(bytesToPgHex(bytes)).toBe('\\x000fabff');
    // A 12-byte IV → "\x" + 24 hex chars → octet_length = 12 on the server.
    expect(bytesToPgHex(randomIv()).length).toBe(2 + 24);
  });

  it('round-trips bytes → \\x-hex → bytes', () => {
    const bytes = randomIv();
    expect(pgHexToBytes(bytesToPgHex(bytes))).toEqual(bytes);
  });

  it('never produces base64-only characters (uppercase / + / / / =)', () => {
    const hex = bytesToPgHex(new Uint8Array([0xff, 0xfe, 0x10, 0x7a]));
    expect(/[A-Z+/=]/.test(hex)).toBe(false);
  });

  it('decodes legacy base64 values too (back-compat for pre-fix rows)', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 99]);
    // A legacy row stored base64 ASCII inside the bytea column.
    expect(pgHexToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
