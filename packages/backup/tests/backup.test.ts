/**
 * @ollie/backup · C4 tests
 *
 * "export → import on a different store" round-trip with passphrase.
 * Adversarial: wrong passphrase, tampered envelope, version mismatch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  deriveKey,
  encryptData,
  randomSalt,
  bytesToBase64,
  CRYPTO_PARAMS,
} from '@ollie/crypto';
import {
  exportBackup,
  importBackup,
  defaultFilename,
  envelopeToFileBytes,
  BACKUP_VERSION,
  type BackupEnvelope,
} from '../src/index';

const PW = 'correct-horse-battery-staple-22';

let original: ReturnType<typeof createStore>;

beforeEach(() => {
  original = createStore(createMemoryAdapter());
  original.setModule('cycle', { items: [{ ts: 1, action: 'started' }] });
  original.setModule('finance', { records: [{ id: 'r1', amount: 20 }] });
  original.setModule('shared', { settings: { theme: 'cream' } });
});

describe('exportBackup', () => {
  it('produces a versioned envelope with non-empty ciphertext', async () => {
    const env = await exportBackup(original, PW);
    expect(env.version).toBe(BACKUP_VERSION);
    expect(env.app).toBe('ollie');
    expect(env.ciphertext.length).toBeGreaterThan(40);
    expect(env.salt.length).toBeGreaterThan(0);
    expect(env.iv.length).toBeGreaterThan(0);
    expect(env.metadata.module_count).toBe(3);
  });

  it('rejects short passphrases', async () => {
    await expect(exportBackup(original, 'short')).rejects.toThrow();
  });

  it('default filename embeds the date', async () => {
    const env = await exportBackup(original, PW);
    expect(defaultFilename(env)).toMatch(/^ollie-backup-\d{4}-\d{2}-\d{2}\.ollie\.backup\.json$/);
  });
});

describe('importBackup · round-trip', () => {
  it('export then import to a fresh store reproduces the original modules', async () => {
    const env = await exportBackup(original, PW);
    const fresh = createStore(createMemoryAdapter());

    const r = await importBackup(fresh, env, PW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied_modules).toEqual(expect.arrayContaining(['cycle', 'finance', 'shared']));
    }
    expect(fresh.get('cycle', 'items', [])).toEqual([{ ts: 1, action: 'started' }]);
    expect(fresh.get('finance', 'records', [])).toEqual([{ id: 'r1', amount: 20 }]);
    expect(fresh.get('shared', 'settings', null)).toEqual({ theme: 'cream' });
  });

  it('parses from string + Uint8Array + ArrayBuffer', async () => {
    const env = await exportBackup(original, PW);
    const bytes = envelopeToFileBytes(env);

    for (const input of [JSON.stringify(env), bytes, bytes.buffer]) {
      const fresh = createStore(createMemoryAdapter());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await importBackup(fresh, input as any, PW);
      expect(r.ok).toBe(true);
    }
  });
});

describe('importBackup · adversarial', () => {
  it('wrong passphrase → wrong-passphrase error', async () => {
    const env = await exportBackup(original, PW);
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, env, 'wrong-passphrase-aaaaaaaa');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
  });

  it('tampered ciphertext → wrong-passphrase error', async () => {
    const env = await exportBackup(original, PW);
    const tampered = { ...env, ciphertext: 'AAAA' + env.ciphertext.slice(4) };
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, tampered, PW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
  });

  it('non-ollie envelope → not-an-ollie-backup error', async () => {
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, JSON.stringify({ random: 'json' }), PW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-an-ollie-backup');
  });

  it('newer envelope version → unsupported-version error', async () => {
    const env = await exportBackup(original, PW);
    const newer = { ...env, version: BACKUP_VERSION + 999 };
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, newer, PW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unsupported-version');
  });

  it('corrupt JSON string → corrupt-envelope error', async () => {
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, '{not valid json', PW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('corrupt-envelope');
  });
});

// ─── S7 · PBKDF2 iteration count back-compat ──────────────────────────────────

describe('importBackup · S7 iteration-count back-compat', () => {
  /**
   * Hand-build a LEGACY backup envelope: encrypt the snapshot with a key
   * derived at the legacy 100k count and OMIT the `kdf_iterations` field —
   * exactly what a backup exported before the S7 bump looks like.
   */
  async function buildLegacyEnvelope(
    snapshot: Record<string, unknown>,
    passphrase: string,
  ): Promise<BackupEnvelope> {
    const salt = randomSalt();
    const key = await deriveKey(passphrase, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    const enc = await encryptData(key, snapshot);
    return {
      version: BACKUP_VERSION,
      app: 'ollie',
      created_at: '2026-01-01T00:00:00.000Z',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(enc.iv),
      ciphertext: bytesToBase64(enc.ciphertext),
      // NO kdf_iterations field — this is a pre-S7 envelope.
      metadata: { module_count: Object.keys(snapshot).length },
    };
  }

  it('a NEW backup stamps kdf_iterations = 600k', async () => {
    const env = await exportBackup(original, PW);
    expect(env.kdf_iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    expect(env.kdf_iterations).toBe(600_000);
  });

  it('a NEW (600k) backup round-trips through importBackup', async () => {
    const env = await exportBackup(original, PW);
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, env, PW);
    expect(r.ok).toBe(true);
    expect(fresh.get('finance', 'records', [])).toEqual([{ id: 'r1', amount: 20 }]);
  });

  it('a LEGACY (100k, no kdf_iterations) backup STILL decrypts — back-compat', async () => {
    const legacy = await buildLegacyEnvelope(
      { cycle: { items: [{ ts: 9, action: 'legacy' }] } },
      PW,
    );
    expect(legacy.kdf_iterations).toBeUndefined();

    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, legacy, PW);
    expect(r.ok).toBe(true);
    expect(fresh.get('cycle', 'items', [])).toEqual([{ ts: 9, action: 'legacy' }]);
  });

  it('a legacy backup with the WRONG passphrase still fails cleanly (no false positive)', async () => {
    const legacy = await buildLegacyEnvelope({ shared: { x: 1 } }, PW);
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, legacy, 'a-different-passphrase-zz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
  });

  it('an explicit kdf_iterations=100k envelope decrypts (forward-explicit legacy)', async () => {
    const legacy = await buildLegacyEnvelope({ shared: { y: 2 } }, PW);
    // Same bytes, but with the field explicitly present at 100k.
    const explicit: BackupEnvelope = { ...legacy, kdf_iterations: 100_000 };
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, explicit, PW);
    expect(r.ok).toBe(true);
    expect(fresh.get('shared', 'y', null)).toBe(2);
  });

  it('a 600k envelope mislabeled as 100k fails (proves the field is honoured on read)', async () => {
    const env = await exportBackup(original, PW); // real 600k
    const mislabeled: BackupEnvelope = { ...env, kdf_iterations: 100_000 };
    const fresh = createStore(createMemoryAdapter());
    const r = await importBackup(fresh, mislabeled, PW);
    // Wrong count → wrong key → AES auth-tag mismatch → wrong-passphrase.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-passphrase');
  });
});

describe('import · merge mode', () => {
  it('merge preserves existing keys not in backup', async () => {
    const env = await exportBackup(original, PW);
    const target = createStore(createMemoryAdapter());
    target.setModule('cycle', { existing: 'data', items: [{ different: true }] });

    const r = await importBackup(target, env, PW, { mode: 'merge' });
    expect(r.ok).toBe(true);
    // merge overwrites items but keeps `existing`.
    expect(target.get('cycle', 'existing', null)).toBe('data');
    expect(target.get('cycle', 'items', [])).toEqual([{ ts: 1, action: 'started' }]);
  });
});
