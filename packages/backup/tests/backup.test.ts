/**
 * @ollie/backup · C4 tests
 *
 * "export → import on a different store" round-trip with passphrase.
 * Adversarial: wrong passphrase, tampered envelope, version mismatch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  exportBackup,
  importBackup,
  defaultFilename,
  envelopeToFileBytes,
  BACKUP_VERSION,
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
