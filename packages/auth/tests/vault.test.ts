/**
 * @ollie/auth · encryption-vault tests
 *
 * Covers the post-Clerk vault surface: create / unlock / lock / reset,
 * the in-memory-key invariant, and the `state()` projection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import type { Store } from '@ollie/store';
import { createVault, MIN_PASSPHRASE_LENGTH } from '../src/index';

const GOOD_PASSPHRASE = 'correct horse battery staple';
const ANOTHER_PASSPHRASE = 'a completely different long passphrase';

function freshStore(): Store {
  return createStore(createMemoryAdapter());
}

/** Pull the raw `shared` module straight from the store. */
function sharedModule(store: Store): Record<string, unknown> {
  return (store.getModule('shared') ?? {}) as Record<string, unknown>;
}

describe('@ollie/auth · createVault', () => {
  let store: Store;

  beforeEach(() => {
    store = freshStore();
  });

  it('exports MIN_PASSPHRASE_LENGTH as 12', () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
  });

  it('starts with an empty, locked vault on a fresh device', () => {
    const vault = createVault({ store });
    expect(vault.state()).toEqual({ exists: false, unlocked: false });
    expect(vault.encryptionKey()).toBeNull();
  });

  describe('create()', () => {
    it('rejects a passphrase below the minimum length', async () => {
      const vault = createVault({ store });
      const res = await vault.create('short');
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.code).toBe('weak-passphrase');
      expect(res.message).toContain(String(MIN_PASSPHRASE_LENGTH));
      expect(Array.isArray(res.notes)).toBe(true);
      // Nothing should have been written or unlocked.
      expect(vault.state()).toEqual({ exists: false, unlocked: false });
      expect(vault.encryptionKey()).toBeNull();
    });

    it('creates a vault, sets the in-memory key, and persists salt + verifier', async () => {
      const vault = createVault({ store });
      const res = await vault.create(GOOD_PASSPHRASE);
      expect(res.ok).toBe(true);

      expect(vault.state()).toEqual({ exists: true, unlocked: true });
      expect(vault.encryptionKey()).not.toBeNull();

      const shared = sharedModule(store);
      expect(typeof shared['vault.salt']).toBe('string');
      expect(typeof shared['vault.verifier']).toBe('string');

      const verifier = JSON.parse(shared['vault.verifier'] as string) as Record<string, unknown>;
      expect(typeof verifier.iv).toBe('string');
      expect(typeof verifier.ct).toBe('string');
      expect(typeof verifier.kdf_iter).toBe('number');
    });
  });

  describe('unlock()', () => {
    it('returns no-vault when unlock is called before any create', async () => {
      const vault = createVault({ store });
      const res = await vault.unlock(GOOD_PASSPHRASE);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.code).toBe('no-vault');
      expect(vault.encryptionKey()).toBeNull();
    });

    it('round-trips create → lock → unlock with the correct passphrase', async () => {
      const creator = createVault({ store });
      expect((await creator.create(GOOD_PASSPHRASE)).ok).toBe(true);
      creator.lock();
      expect(creator.state()).toEqual({ exists: true, unlocked: false });
      expect(creator.encryptionKey()).toBeNull();

      // A FRESH client over the same store (simulates an app restart).
      const returning = createVault({ store });
      expect(returning.state()).toEqual({ exists: true, unlocked: false });

      const res = await returning.unlock(GOOD_PASSPHRASE);
      expect(res.ok).toBe(true);
      expect(returning.state()).toEqual({ exists: true, unlocked: true });
      expect(returning.encryptionKey()).not.toBeNull();
    });

    it('rejects a wrong passphrase and leaves the vault locked', async () => {
      const creator = createVault({ store });
      expect((await creator.create(GOOD_PASSPHRASE)).ok).toBe(true);

      const returning = createVault({ store });
      const res = await returning.unlock(ANOTHER_PASSPHRASE);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.code).toBe('wrong-passphrase');
      // Key MUST NOT be set on a wrong passphrase.
      expect(returning.encryptionKey()).toBeNull();
      expect(returning.state()).toEqual({ exists: true, unlocked: false });
    });
  });

  describe('lock()', () => {
    it('drops the in-memory key but keeps salt + verifier', async () => {
      const vault = createVault({ store });
      await vault.create(GOOD_PASSPHRASE);
      expect(vault.encryptionKey()).not.toBeNull();

      vault.lock();
      expect(vault.encryptionKey()).toBeNull();
      expect(vault.state()).toEqual({ exists: true, unlocked: false });

      const shared = sharedModule(store);
      expect(shared['vault.salt']).toBeDefined();
      expect(shared['vault.verifier']).toBeDefined();
    });
  });

  describe('reset()', () => {
    it('wipes vault.salt + vault.verifier and drops the key', async () => {
      const vault = createVault({ store });
      await vault.create(GOOD_PASSPHRASE);
      expect(vault.state().exists).toBe(true);

      vault.reset();
      expect(vault.encryptionKey()).toBeNull();
      expect(vault.state()).toEqual({ exists: false, unlocked: false });

      const shared = sharedModule(store);
      expect(shared['vault.salt']).toBeUndefined();
      expect(shared['vault.verifier']).toBeUndefined();
    });

    it('makes a subsequent unlock return no-vault', async () => {
      const vault = createVault({ store });
      await vault.create(GOOD_PASSPHRASE);
      vault.reset();

      const res = await vault.unlock(GOOD_PASSPHRASE);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.code).toBe('no-vault');
    });
  });

  describe('invariant · the derived key is never persisted', () => {
    it('writes only salt + verifier to the store — no key material', async () => {
      const vault = createVault({ store });
      await vault.create(GOOD_PASSPHRASE);

      const shared = sharedModule(store);
      // Exactly the two documented keys, nothing else.
      expect(Object.keys(shared).sort()).toEqual(['vault.salt', 'vault.verifier']);

      // The serialized store must not contain anything that looks like a
      // raw CryptoKey or the passphrase itself.
      const serialized = JSON.stringify(shared);
      expect(serialized).not.toContain(GOOD_PASSPHRASE);
      expect(serialized).not.toContain('CryptoKey');
    });

    it('unlock does not write the key back to the store', async () => {
      const creator = createVault({ store });
      await creator.create(GOOD_PASSPHRASE);
      const before = JSON.stringify(sharedModule(store));

      const returning = createVault({ store });
      await returning.unlock(GOOD_PASSPHRASE);
      const after = JSON.stringify(sharedModule(store));

      // unlock is a pure read of salt + verifier — no store mutation.
      expect(after).toEqual(before);
    });
  });

  describe('state() reflects reality', () => {
    it('tracks exists/unlocked across the full lifecycle', async () => {
      const vault = createVault({ store });
      expect(vault.state()).toEqual({ exists: false, unlocked: false });

      await vault.create(GOOD_PASSPHRASE);
      expect(vault.state()).toEqual({ exists: true, unlocked: true });

      vault.lock();
      expect(vault.state()).toEqual({ exists: true, unlocked: false });

      await vault.unlock(GOOD_PASSPHRASE);
      expect(vault.state()).toEqual({ exists: true, unlocked: true });

      vault.reset();
      expect(vault.state()).toEqual({ exists: false, unlocked: false });
    });
  });

  describe('strength()', () => {
    it('proxies passphraseStrength and bands a weak passphrase as weak', async () => {
      const vault = createVault({ store });
      const weak = await vault.strength('abc');
      expect(weak.band).toBe('weak');
      expect(weak.notes.some((n) => n.includes(String(MIN_PASSPHRASE_LENGTH)))).toBe(true);
    });
  });
});
