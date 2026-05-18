/**
 * @ollie/apns-jwt — shared APNs provider-token (ES256 JWT) signing.
 *
 * Background: the exact ES256 / Apple-p8 signing routine was duplicated
 * verbatim in workers/apns-push and apps/api/src/worker.ts. The logic was
 * already correct — this module is purely a de-duplication so there is one
 * copy to audit and maintain.
 *
 * Runtime: uses only Web Crypto (`crypto.subtle`) plus `atob` / `btoa`,
 * which exist in both the Cloudflare Workers runtime and the API worker.
 * No Node built-ins, so it is safe to import from either side.
 *
 * Apple spec: a provider token is valid for up to 1 hour and should be
 * regenerated no more than once every 20 minutes. `getApnsJwt` caches the
 * signed token in-process and re-signs when it is within `refreshMarginSec`
 * of expiry (default 15 min, i.e. tokens are reused for ~45 min).
 */

export interface ApnsKeyConfig {
  /** Full p8 PEM contents of the Apple auth key. */
  authKey: string;
  /** 10-character Apple Key ID. */
  keyId: string;
  /** 10-character Apple Team ID. */
  teamId: string;
}

/** Strip PEM armour and decode the base64 body to raw pkcs8 bytes. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Base64url-encode a string or byte buffer (no padding). */
function base64Url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Sign a fresh APNs provider token (ES256). Always re-signs — callers that
 * want caching should use {@link getApnsJwt}.
 */
export async function signApnsJwt(config: ApnsKeyConfig): Promise<string> {
  const header = { alg: 'ES256', kid: config.keyId };
  const claims = { iss: config.teamId, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.authKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(sig)}`;
}

interface CachedJwt {
  token: string;
  /** Epoch seconds at which the token expires. */
  exp: number;
}

/**
 * A reusable, self-caching APNs JWT signer. Each instance keeps one cached
 * token; create one per worker module (module-scope) to mirror the previous
 * per-worker `__jwtCache` behaviour.
 */
export function createApnsJwtSigner(refreshMarginSec = 900): {
  getApnsJwt: (config: ApnsKeyConfig) => Promise<string>;
} {
  let cache: CachedJwt | null = null;

  async function getApnsJwt(config: ApnsKeyConfig): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cache && cache.exp - now > refreshMarginSec) {
      return cache.token;
    }
    const token = await signApnsJwt(config);
    cache = { token, exp: now + 3600 };
    return token;
  }

  return { getApnsJwt };
}
