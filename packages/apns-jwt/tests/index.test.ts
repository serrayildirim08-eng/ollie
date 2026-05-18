/**
 * @ollie/apns-jwt — tests for the shared APNs provider-token signer.
 *
 * Covers (audit #5):
 *   - JWT 3-segment shape + decoded header/claims
 *   - ES256 signature round-trip (verified with the matching public key)
 *   - createApnsJwtSigner cache reuse + re-sign past the refresh margin
 */

import { describe, it, expect, vi } from 'vitest';
import { signApnsJwt, createApnsJwtSigner, type ApnsKeyConfig } from '../src/index';

// ─── helpers ────────────────────────────────────────────────────────────────

/** base64url → bytes. */
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url → decoded JSON object. */
function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

/** Wrap raw pkcs8 bytes in p8 PEM armour with 64-char lines. */
function toPem(pkcs8: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(pkcs8);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

/** Generate a real P-256 key pair; return the private key as p8 PEM
 *  plus the public CryptoKey for verification. */
async function makeKeyPair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer;
  return { pem: toPem(pkcs8), publicKey: kp.publicKey };
}

async function makeConfig(): Promise<{ config: ApnsKeyConfig; publicKey: CryptoKey }> {
  const { pem, publicKey } = await makeKeyPair();
  return {
    config: { authKey: pem, keyId: 'ABC1234567', teamId: 'TEAM123456' },
    publicKey,
  };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('signApnsJwt', () => {
  it('produces a 3-segment JWT with the expected header + claims', async () => {
    const { config } = await makeConfig();
    const jwt = await signApnsJwt(config);

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const header = decodeSegment(parts[0]);
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('ABC1234567');

    const claims = decodeSegment(parts[1]);
    expect(claims.iss).toBe('TEAM123456');
    expect(typeof claims.iat).toBe('number');
    // iat is seconds, set to "about now".
    expect(Math.abs((claims.iat as number) - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it('ES256 signature verifies against the matching public key', async () => {
    const { config, publicKey } = await makeConfig();
    const jwt = await signApnsJwt(config);
    const [h, c, sig] = jwt.split('.');

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      publicKey,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it('a tampered signing input fails verification', async () => {
    const { config, publicKey } = await makeConfig();
    const jwt = await signApnsJwt(config);
    const [h, c, sig] = jwt.split('.');

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      publicKey,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${c}tampered`),
    );
    expect(ok).toBe(false);
  });
});

describe('createApnsJwtSigner', () => {
  it('returns the cached token on a second call within the refresh margin', async () => {
    const { config } = await makeConfig();
    const signer = createApnsJwtSigner();
    const first = await signer.getApnsJwt(config);
    const second = await signer.getApnsJwt(config);
    expect(second).toBe(first);
  });

  it('re-signs once the cached token is within refreshMarginSec of expiry', async () => {
    vi.useFakeTimers();
    try {
      const { config } = await makeConfig();
      // Token exp = iat + 3600. refreshMargin 900 → reused for ~2700s.
      const signer = createApnsJwtSigner(900);
      const first = await signer.getApnsJwt(config);

      // Still inside the reuse window.
      vi.advanceTimersByTime(2000 * 1000);
      expect(await signer.getApnsJwt(config)).toBe(first);

      // Past it — within the refresh margin → must re-sign.
      vi.advanceTimersByTime(800 * 1000);
      const resigned = await signer.getApnsJwt(config);
      expect(resigned).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
