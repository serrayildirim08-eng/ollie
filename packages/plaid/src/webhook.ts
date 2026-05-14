/**
 * @ollie/plaid · webhook verification + routing
 *
 * Plaid signs every webhook body with an ES256 JWT in the
 * `Plaid-Verification` header. The JWT's `request_body_sha256` claim
 * MUST equal sha256(rawBody). We:
 *
 *   1. parse the JWT header → extract `kid`
 *   2. fetch the matching public key from Plaid's /webhook_verification_key/get
 *      endpoint (cached by kid; rotated infrequently)
 *   3. verify the JWT signature with that public key (ES256)
 *   4. compare jwt.claims.request_body_sha256 to sha256(rawBody)
 *   5. compare jwt.claims.iat to wall-clock (reject older than 5 min)
 *
 * If any step fails, the webhook is treated as forged — we return
 * verified=false and the caller MUST 401 the response, never trust
 * the body, never enqueue work.
 *
 * The Worker runtime (Cloudflare) exposes crypto.subtle for ES256
 * verification + crypto.subtle.digest for sha256. We do not pull in
 * `jsonwebtoken` — it's CommonJS + Node-only.
 */

import type { PlaidApi } from 'plaid';
import type { PlaidWebhookCode, PlaidWebhookType } from './types';

export interface PlaidWebhookEvent {
  webhook_type: PlaidWebhookType | string;
  webhook_code: PlaidWebhookCode | string;
  item_id: string;
  /** Present on TRANSACTIONS_REMOVED. */
  removed_transactions?: string[];
  /** Present on most update codes. */
  new_transactions?: number;
  /** Present on ERROR. */
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
  };
  /** Pass-through for any field we did not enumerate. */
  [k: string]: unknown;
}

export interface WebhookVerificationResult {
  verified: boolean;
  reason?: string;
}

export interface VerifyWebhookOptions {
  /** Raw request body — MUST be the exact bytes Plaid sent. */
  rawBody: string;
  /** Value of the `Plaid-Verification` header. */
  verificationHeader: string | null;
  /**
   * Plaid client — used to fetch the verification public key on cache
   * miss. The caller is responsible for caching across requests
   * (Workers: stash in KV by kid).
   */
  plaid: PlaidApi;
  /**
   * Optional kid → public key cache. If supplied and a hit, we skip
   * the API call to Plaid. Keys are JWK strings.
   */
  keyCache?: {
    get(kid: string): Promise<string | null>;
    set(kid: string, jwk: string, ttlSec: number): Promise<void>;
  };
  /** Tolerance for clock skew. Default 5 minutes. */
  maxAgeSec?: number;
  /** Now-getter for tests. */
  now?: () => number;
}

/**
 * Verify a Plaid webhook. Returns { verified: true } only when ALL
 * checks pass; otherwise { verified: false, reason }.
 */
export async function verifyWebhook(
  opts: VerifyWebhookOptions,
): Promise<WebhookVerificationResult> {
  if (!opts.verificationHeader) {
    return { verified: false, reason: 'missing_verification_header' };
  }
  const maxAge = opts.maxAgeSec ?? 5 * 60;
  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);

  // ─── parse JWT (header.claims.sig) ─────────────────────────────────────
  const parts = opts.verificationHeader.split('.');
  if (parts.length !== 3) {
    return { verified: false, reason: 'malformed_jwt' };
  }
  const [headerB64, claimsB64, sigB64] = parts;
  let header: { kid?: string; alg?: string };
  let claims: { request_body_sha256?: string; iat?: number };
  try {
    header = JSON.parse(b64urlDecode(headerB64));
    claims = JSON.parse(b64urlDecode(claimsB64));
  } catch {
    return { verified: false, reason: 'unparseable_jwt' };
  }
  if (header.alg !== 'ES256') {
    return { verified: false, reason: `unexpected_alg:${String(header.alg)}` };
  }
  if (!header.kid) {
    return { verified: false, reason: 'missing_kid' };
  }
  if (typeof claims.iat !== 'number') {
    return { verified: false, reason: 'missing_iat' };
  }
  if (nowSec - claims.iat > maxAge) {
    return { verified: false, reason: 'stale_jwt' };
  }
  if (!claims.request_body_sha256) {
    return { verified: false, reason: 'missing_body_hash_claim' };
  }

  // ─── compare body hash to claim ────────────────────────────────────────
  const actualBodyHash = await sha256Hex(opts.rawBody);
  if (actualBodyHash !== claims.request_body_sha256) {
    return { verified: false, reason: 'body_hash_mismatch' };
  }

  // ─── fetch public key (cache → Plaid) ──────────────────────────────────
  let jwkString: string | null = null;
  if (opts.keyCache) {
    jwkString = await opts.keyCache.get(header.kid);
  }
  if (!jwkString) {
    try {
      const r = await opts.plaid.webhookVerificationKeyGet({ key_id: header.kid });
      jwkString = JSON.stringify(r.data.key);
      if (opts.keyCache) {
        // Plaid public keys rotate rarely — 24h cache is safe.
        await opts.keyCache.set(header.kid, jwkString, 24 * 60 * 60);
      }
    } catch (err) {
      return { verified: false, reason: `key_fetch_failed:${String(err)}` };
    }
  }

  // ─── verify ES256 sig ──────────────────────────────────────────────────
  let cryptoKey: CryptoKey;
  try {
    const jwk = JSON.parse(jwkString) as JsonWebKey;
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch (err) {
    return { verified: false, reason: `key_import_failed:${String(err)}` };
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
  const sigBytes = derFromJoseSig(b64urlDecodeBytes(sigB64));
  // crypto.subtle expects "raw" JOSE format for ECDSA, which is what
  // we already have (64 bytes for P-256). derFromJoseSig is kept for
  // documentation; we pass the raw form below.
  const rawSig = b64urlDecodeBytes(sigB64);
  void sigBytes; // suppress unused

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      rawSig as BufferSource,
      signingInput as BufferSource,
    );
  } catch (err) {
    return { verified: false, reason: `verify_threw:${String(err)}` };
  }
  if (!ok) {
    return { verified: false, reason: 'bad_signature' };
  }

  return { verified: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Router — given a verified event, return what the caller should do
// ──────────────────────────────────────────────────────────────────────────

export type WebhookAction =
  | { kind: 'sync_transactions'; item_id: string; reason: PlaidWebhookCode | string }
  | { kind: 'tombstone_transactions'; item_id: string; removed_ids: string[] }
  | { kind: 'mark_item_error'; item_id: string; error: PlaidWebhookEvent['error'] }
  | { kind: 'mark_item_revoked'; item_id: string }
  | { kind: 'ignore'; reason: string };

export interface WebhookRouterResult {
  action: WebhookAction;
}

/**
 * Map a verified webhook payload to a concrete action. Pure: no I/O.
 * Caller (the worker) is responsible for executing the action.
 */
export function routeWebhook(event: PlaidWebhookEvent): WebhookRouterResult {
  const type = event.webhook_type;
  const code = event.webhook_code;
  const itemId = event.item_id;

  if (type === 'TRANSACTIONS') {
    if (
      code === 'INITIAL_UPDATE' ||
      code === 'HISTORICAL_UPDATE' ||
      code === 'DEFAULT_UPDATE' ||
      code === 'SYNC_UPDATES_AVAILABLE'
    ) {
      return { action: { kind: 'sync_transactions', item_id: itemId, reason: code } };
    }
    if (code === 'TRANSACTIONS_REMOVED') {
      return {
        action: {
          kind: 'tombstone_transactions',
          item_id: itemId,
          removed_ids: event.removed_transactions ?? [],
        },
      };
    }
  }

  if (type === 'ITEM') {
    if (code === 'ERROR') {
      return { action: { kind: 'mark_item_error', item_id: itemId, error: event.error } };
    }
    if (code === 'USER_PERMISSION_REVOKED' || code === 'PENDING_EXPIRATION') {
      return { action: { kind: 'mark_item_revoked', item_id: itemId } };
    }
  }

  return { action: { kind: 'ignore', reason: `${String(type)}:${String(code)}` } };
}

// ──────────────────────────────────────────────────────────────────────────
// base64url + crypto helpers (Workers-compatible)
// ──────────────────────────────────────────────────────────────────────────

function b64urlDecode(s: string): string {
  const bin = b64urlDecodeBin(s);
  return new TextDecoder().decode(b64urlBinToBytes(bin));
}

function b64urlDecodeBytes(s: string): Uint8Array {
  return b64urlBinToBytes(b64urlDecodeBin(s));
}

function b64urlDecodeBin(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(padded);
}

function b64urlBinToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Convert a 64-byte JOSE-format ECDSA signature (r||s) to ASN.1 DER.
 * Kept for completeness — Workers' crypto.subtle.verify accepts the
 * raw JOSE form directly, so this is unused at runtime. Left in
 * source so a future contributor adding Node-side verification has
 * the conversion handy.
 */
function derFromJoseSig(jose: Uint8Array): Uint8Array {
  if (jose.length !== 64) return jose;
  const r = stripLeading(jose.slice(0, 32));
  const s = stripLeading(jose.slice(32));
  const rWithSign = r[0] >= 0x80 ? prefixZero(r) : r;
  const sWithSign = s[0] >= 0x80 ? prefixZero(s) : s;
  const total = 4 + rWithSign.length + sWithSign.length;
  const out = new Uint8Array(2 + total);
  out[0] = 0x30;
  out[1] = total;
  out[2] = 0x02;
  out[3] = rWithSign.length;
  out.set(rWithSign, 4);
  out[4 + rWithSign.length] = 0x02;
  out[5 + rWithSign.length] = sWithSign.length;
  out.set(sWithSign, 6 + rWithSign.length);
  return out;
}

function stripLeading(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00) i++;
  return b.slice(i);
}

function prefixZero(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length + 1);
  out[0] = 0x00;
  out.set(b, 1);
  return out;
}
