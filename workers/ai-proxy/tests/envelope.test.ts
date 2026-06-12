import { describe, it, expect } from 'vitest';
import { envelopeEncrypt, envelopeDecrypt, rewrapDek } from '../src/crypto/envelope';

// 32-byte base64 KEKs for tests.
const KEK = btoa('0'.repeat(32));
const KEK2 = btoa('1'.repeat(32));

describe('envelope encryption', () => {
  it('round-trips a payload', async () => {
    const payload = { action: 'pantry_add', item: 'süt', qty: 2 };
    const env = await envelopeEncrypt(KEK, payload);
    expect(env.ciphertext).toBeTruthy();
    expect(env.wrapped_dek).toBeTruthy();
    const back = await envelopeDecrypt(KEK, env);
    expect(back).toEqual(payload);
  });

  it('ciphertext leaks no plaintext', async () => {
    const env = await envelopeEncrypt(KEK, { secret: 'leche privada' });
    expect(atob(env.ciphertext)).not.toContain('leche');
  });

  it('different records get different DEKs (different wrapped_dek + iv)', async () => {
    const a = await envelopeEncrypt(KEK, { x: 1 });
    const b = await envelopeEncrypt(KEK, { x: 1 });
    expect(a.wrapped_dek).not.toEqual(b.wrapped_dek);
    expect(a.iv).not.toEqual(b.iv);
  });

  it('wrong KEK fails to decrypt', async () => {
    const env = await envelopeEncrypt(KEK, { x: 1 });
    await expect(envelopeDecrypt(KEK2, env)).rejects.toThrow();
  });

  it('rejects a non-32-byte KEK', async () => {
    await expect(envelopeEncrypt(btoa('short'), { x: 1 })).rejects.toThrow();
  });

  it('rotation re-wraps DEK, ciphertext still decrypts under new KEK', async () => {
    const env = await envelopeEncrypt(KEK, { x: 42 });
    const rewrapped = await rewrapDek(KEK, KEK2, env);
    const merged = { ...env, ...rewrapped };
    const back = await envelopeDecrypt(KEK2, merged);
    expect(back).toEqual({ x: 42 });
    // Old KEK no longer works after rotation.
    await expect(envelopeDecrypt(KEK, merged)).rejects.toThrow();
  });
});
