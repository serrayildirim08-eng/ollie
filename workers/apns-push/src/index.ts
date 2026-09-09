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
 * Rate-limit: per-user, enforced by the native Cloudflare Rate Limiting
 * binding (RATE_LIMITER, atomic at the edge) when present, falling back to a
 * best-effort KV fixed-window counter (RATE_KV) when the binding is absent.
 */

import { createApnsJwtSigner } from '@ollie/apns-jwt';

/**
 * Cloudflare native Rate Limiting binding. `limit()` is atomic edge-side,
 * which fixes the read-then-write race the KV counter has under burst.
 */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

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
  // Native Rate Limiting binding — atomic counter, preferred over RATE_KV.
  // Optional so a deploy that has not yet picked up the [[ratelimits]] config
  // still enforces a (racy) limit via the KV fallback.
  RATE_LIMITER?: RateLimiter;
}

interface PushBody {
  deviceToken: string;
  payload: Record<string, unknown>;
  userId?: string;
  topic?: string;
}

// ─── JWT signer (ES256 / Apple p8) ─────────────────────────────────────────────
// Signing lives in the shared @ollie/apns-jwt package — one copy, shared with
// apps/api. The signer caches the token in this module's scope (Apple: valid 1h;
// re-signs ~15 min before expiry, so a token is reused for ~45 min).

const apnsSigner = createApnsJwtSigner();

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

    // Rate-limit per user (or per-device-token if no userId). Prefers the
    // native binding (atomic) and falls back to the KV fixed-window counter.
    const rateKey = `rl:apns:${body.userId ?? body.deviceToken}`;
    const allowed = await checkRate(env.RATE_LIMITER, env.RATE_KV, rateKey, 5, 1);
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

// ─── rate-limit helper ──────────────────────────────────────────────────────────

/**
 * Rate-limit check. Prefers the native Cloudflare Rate Limiting binding, whose
 * `limit()` is atomic at the edge — this fixes the read-then-write race the KV
 * counter has, where N concurrent requests all read the same count and all pass
 * the ceiling under burst.
 *
 * Falls back to the legacy KV fixed-window counter when the binding is absent
 * (e.g. a deploy that has not yet picked up the [[ratelimits]] config). The
 * fallback is best-effort: it is NOT atomic and can over-admit under a
 * concurrent burst — the native binding is the enforced bound.
 */
async function checkRate(
  limiter: RateLimiter | undefined,
  kv: KVNamespace,
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return success;
  }
  // Best-effort fallback — racy fixed-window KV counter.
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

function getApnsJwt(env: Env): Promise<string> {
  return apnsSigner.getApnsJwt({
    authKey: env.APPLE_AUTH_KEY,
    keyId: env.APPLE_KEY_ID,
    teamId: env.APPLE_TEAM_ID,
  });
}

// ─── tiny helpers ──────────────────────────────────────────────────────────────

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
