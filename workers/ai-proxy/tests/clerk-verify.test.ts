/**
 * Tests for the Clerk JWT verify helper.
 *
 * We do not want to talk to the real Clerk JWKS over the network in tests,
 * so we generate a throwaway RS256 keypair, mint a JWT against it, mock
 * `fetch` to return that key as a JWKS, and assert the verify outcome.
 *
 * Covered:
 *   - happy path returns the `sub` claim
 *   - missing env returns null (does not throw)
 *   - wrong issuer claim returns null
 *   - expired token returns null
 *   - malformed JWT returns null
 *
 * The dual-mode `verifyJwt` (Clerk → Supabase fallback) is exercised in
 * its existing telemetry-auth suite — we only test the pure Clerk leg here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { verifyClerkJwt, _resetClerkJwksCache } from '../src/clerk-verify';

const ISSUER = 'https://faithful-stag-15.clerk.accounts.dev';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

interface KeyMaterial {
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
  kid: string;
}

async function makeKey(): Promise<KeyMaterial> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = 'test-kid-1';
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk, kid };
}

async function mintJwt(
  privateKey: CryptoKey,
  kid: string,
  opts: { sub?: string; iss?: string; exp?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(opts.sub ?? 'user_test_123')
    .setIssuer(opts.iss ?? ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(opts.exp ?? now + 60)
    .sign(privateKey);
}

function mockJwksFetch(publicJwk: Record<string, unknown>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    },
  );
}

describe('verifyClerkJwt', () => {
  let spy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    _resetClerkJwksCache();
  });

  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it('returns the sub claim for a valid token', async () => {
    const k = await makeKey();
    spy = mockJwksFetch(k.publicJwk);
    const jwt = await mintJwt(k.privateKey, k.kid, { sub: 'user_abc' });
    const userId = await verifyClerkJwt(jwt, { CLERK_ISSUER: ISSUER });
    expect(userId).toBe('user_abc');
  });

  it('returns null when CLERK_ISSUER is unset', async () => {
    const userId = await verifyClerkJwt('whatever', {});
    expect(userId).toBeNull();
  });

  it('returns null for a token signed by a different key', async () => {
    const k1 = await makeKey();
    const k2 = await makeKey();
    // JWKS only publishes k1, but the JWT is signed by k2 with k1's kid
    spy = mockJwksFetch(k1.publicJwk);
    const jwt = await mintJwt(k2.privateKey, k1.kid);
    const userId = await verifyClerkJwt(jwt, { CLERK_ISSUER: ISSUER });
    expect(userId).toBeNull();
  });

  it('rejects a token signed with a non-RS256 algorithm (alg pinning, L1)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'es-kid';
    publicJwk.alg = 'ES256';
    publicJwk.use = 'sig';
    spy = mockJwksFetch(publicJwk);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'es-kid' })
      .setSubject('user_es')
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const userId = await verifyClerkJwt(jwt, { CLERK_ISSUER: ISSUER });
    expect(userId).toBeNull();
  });

  it('returns null when the issuer claim does not match', async () => {
    const k = await makeKey();
    spy = mockJwksFetch(k.publicJwk);
    const jwt = await mintJwt(k.privateKey, k.kid, {
      iss: 'https://someone-else.clerk.accounts.dev',
    });
    const userId = await verifyClerkJwt(jwt, { CLERK_ISSUER: ISSUER });
    expect(userId).toBeNull();
  });

  it('returns null when the token is expired', async () => {
    const k = await makeKey();
    spy = mockJwksFetch(k.publicJwk);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await mintJwt(k.privateKey, k.kid, { exp: now - 10 });
    const userId = await verifyClerkJwt(jwt, { CLERK_ISSUER: ISSUER });
    expect(userId).toBeNull();
  });

  it('returns null for a malformed jwt', async () => {
    const userId = await verifyClerkJwt('not.a.jwt', { CLERK_ISSUER: ISSUER });
    expect(userId).toBeNull();
  });
});
