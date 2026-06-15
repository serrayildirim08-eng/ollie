/**
 * ollie · apns-push Cloudflare Worker
 *
 * Hides the Apple p8 signing key on the server side and forwards push
 * payloads to api.push.apple.com. Clients never see the key.
 *
 * Privacy note (post Sprint B' pivot 2026-05-14):
 *   Push payloads SHOULD already be encrypted by the caller for any
 *   user-derived content. We never decrypt or log payload bodies on
 *   this worker — payload content is a passthrough to APNs.
 *
 * Endpoint:
 *   POST /push        body: { deviceToken: string, payload: object,
 *                              userId?: string,   // for per-user rate-limit key
 *                              topic?: string }   // overrides bundle id
 *
 * Rate-limit: 5 req/sec per user via Cloudflare KV (RATE_KV).
 */

export interface Env {
  // Secrets — set via `wrangler secret put`.
  APPLE_AUTH_KEY: string;   // -----BEGIN PRIVATE KEY----- … (p8 PEM)
  APPLE_KEY_ID: string;     // 10-char Apple Key ID
  APPLE_TEAM_ID: string;    // 10-char Apple Team ID
  APPLE_BUNDLE_ID: string;  // e.g. app.ollie.ollie

  // Shared secret — callers (cron) MUST send `Authorization: Bearer
  // <APNS_INTERNAL_SECRET>`. Fails CLOSED when unset: without it /push
  // is an open relay that lets anyone push to any device token and burn
  // the Apple cert. Same pattern as cron's CRON_TRIGGER_SECRET.
  APNS_INTERNAL_SECRET: string;

  // Bindings — set in wrangler.toml.
  RATE_KV: KVNamespace;
}

interface PushBody {
  deviceToken: string;
  payload: Record<string, unknown>;
  userId?: string;
  topic?: string;
}

// ─── JWT cache (token is valid up to 1 hour per Apple spec) ────────────────────

interface CachedJwt {
  token: string;
  exp: number;
}

let __jwtCache: CachedJwt | null = null;

// ─── handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== 'POST' || url.pathname !== '/push') {
      return json({ error: 'not_found' }, 404);
    }

    // Auth: require the internal shared secret. Fail CLOSED when the
    // secret is unconfigured so a misdeploy can never expose an open
    // push relay.
    const auth = req.headers.get('authorization') ?? '';
    if (
      !env.APNS_INTERNAL_SECRET ||
      !auth.startsWith('Bearer ') ||
      auth.slice('Bearer '.length) !== env.APNS_INTERNAL_SECRET
    ) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body: PushBody;
    try {
      body = (await req.json()) as PushBody;
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    if (!body.deviceToken || typeof body.deviceToken !== 'string') {
      return json({ error: 'missing_deviceToken' }, 400);
    }
    // Validate the token shape before interpolating it into the APNs URL
    // (audit #2). APNs tokens are hex; reject anything else so a malformed or
    // hostile token cannot inject path segments into the request.
    if (!/^[0-9a-fA-F]{32,200}$/.test(body.deviceToken)) {
      return json({ error: 'invalid_deviceToken' }, 400);
    }
    if (!body.payload || typeof body.payload !== 'object') {
      return json({ error: 'missing_payload' }, 400);
    }

    // Rate-limit: 5 req/sec per user (or per-device-token if no userId).
    const rateKey = `rl:apns:${body.userId ?? body.deviceToken}`;
    const allowed = await checkRate(env.RATE_KV, rateKey, 5, 1);
    if (!allowed) {
      return json({ error: 'rate_limited' }, 429);
    }

    // Sign or reuse cached JWT.
    let jwt: string;
    try {
      jwt = await getApnsJwt(env);
    } catch (err) {
      return json({ error: 'jwt_sign_failed', detail: String(err) }, 500);
    }

    const topic = body.topic ?? env.APPLE_BUNDLE_ID;
    const apnsUrl = `https://api.push.apple.com/3/device/${body.deviceToken}`;

    const apnsResp = await fetch(apnsUrl, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body.payload),
    });

    // Apple returns empty body on success, JSON `{reason}` on failure.
    const text = await apnsResp.text();
    return new Response(text || '{}', {
      status: apnsResp.status,
      headers: { 'content-type': 'application/json' },
    });
  },
};

// ─── rate-limit helper (KV-backed token bucket) ────────────────────────────────

async function checkRate(
  kv: KVNamespace,
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const slot = `${key}:${Math.floor(now / windowSec)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= max) return false;
  // expirationTtl: clean up after 2× window so we don't leak keys.
  await kv.put(slot, String(count + 1), { expirationTtl: windowSec * 2 + 1 });
  return true;
}

// ─── JWT signing (ES256 / Apple p8) ────────────────────────────────────────────

async function getApnsJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Apple recommends regenerating no more than once every 20 minutes,
  // and the token is valid for 1 hour. We reuse for 45 minutes.
  if (__jwtCache && __jwtCache.exp - now > 900) {
    return __jwtCache.token;
  }

  const header = { alg: 'ES256', kid: env.APPLE_KEY_ID };
  const claims = { iss: env.APPLE_TEAM_ID, iat: now };

  const encoder = new TextEncoder();
  const headerB64 = b64url(encoder.encode(JSON.stringify(header)));
  const claimsB64 = b64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  const keyBytes = pemToBinary(env.APPLE_AUTH_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const sigRaw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(signingInput),
  );

  const token = `${signingInput}.${b64url(new Uint8Array(sigRaw))}`;
  __jwtCache = { token, exp: now + 3600 };
  return token;
}

function pemToBinary(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ─── tiny helpers ──────────────────────────────────────────────────────────────

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
