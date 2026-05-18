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
 * Auth:
 *   /push is called worker-to-worker by ollie-cron's notification drain
 *   via a service binding — there is no legitimate browser caller. It is
 *   gated by a shared-secret bearer header: the caller must send
 *   `Authorization: Bearer <APNS_INTERNAL_SECRET>`. Without it /push would
 *   let anyone push an arbitrary payload to any device token.
 *   (Same pattern as apps/api/src/worker.ts · REGISTER_SHARED_SECRET.)
 *
 * Rate-limit: 5 req/sec per user via Cloudflare KV (RATE_KV).
 */

import { createApnsJwtSigner } from '@ollie/apns-jwt';
import { json } from '@ollie/worker-http';

/**
 * Cloudflare native Rate Limiting binding. `limit()` is atomic edge-side,
 * which fixes the read-then-write race the KV counter had.
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
  // Shared secret — the cron worker presents this on every /push call.
  // Set the SAME value on ollie-cron as APNS_INTERNAL_SECRET.
  APNS_INTERNAL_SECRET: string;

  // Bindings — set in wrangler.toml.
  RATE_KV: KVNamespace;
  // Native rate-limit binding (item #5). Optional so a deploy that hasn't
  // picked up the wrangler.toml [[ratelimits]] block still type-checks and
  // falls back to the legacy KV counter.
  PUSH_RATE_LIMITER?: RateLimiter;
}

interface PushBody {
  deviceToken: string;
  payload: Record<string, unknown>;
  userId?: string;
  topic?: string;
}

// ─── APNs JWT signer ────────────────────────────────────────────────────────────
// ES256 signing lives in the shared @ollie/apns-jwt package — one copy,
// shared with apps/api/src/worker.ts. The signer caches the token in this
// module's scope (Apple: valid 1h, regenerate ≤ once / 20 min).

const apnsSigner = createApnsJwtSigner();

// ─── handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== 'POST' || url.pathname !== '/push') {
      return json({ error: 'not_found' }, 404);
    }

    // Shared-secret gate — /push is internal (worker-to-worker only).
    // Reject anything that does not present the exact secret. If the
    // secret is unset the endpoint is closed (fail-closed).
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
    if (!body.payload || typeof body.payload !== 'object') {
      return json({ error: 'missing_payload' }, 400);
    }

    // Rate-limit per user (or per-device-token if no userId).
    const rateKey = `rl:apns:${body.userId ?? body.deviceToken}`;
    const allowed = await checkRate(env.PUSH_RATE_LIMITER, env.RATE_KV, rateKey);
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

// ─── rate-limit helper ─────────────────────────────────────────────────────────
//
// Prefers the native Cloudflare Rate Limiting binding (atomic at the edge —
// fixes the read-then-write race the KV counter had). Falls back to the legacy
// KV fixed-window counter when the binding is not present, so a deploy that
// has not yet picked up the [[ratelimits]] config still enforces a limit.

const LEGACY_RATE_MAX = 50;     // 50 requests …
const LEGACY_RATE_WINDOW = 10;  // … per 10 seconds (matches the native limiter)

async function checkRate(
  limiter: RateLimiter | undefined,
  kv: KVNamespace,
  key: string,
): Promise<boolean> {
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return success;
  }
  // Legacy fallback — racy fixed-window KV counter.
  const now = Math.floor(Date.now() / 1000);
  const slot = `${key}:${Math.floor(now / LEGACY_RATE_WINDOW)}`;
  const raw = await kv.get(slot);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= LEGACY_RATE_MAX) return false;
  await kv.put(slot, String(count + 1), { expirationTtl: LEGACY_RATE_WINDOW * 2 + 1 });
  return true;
}

// ─── JWT signing (ES256 / Apple p8) ────────────────────────────────────────────
// Delegates to the shared @ollie/apns-jwt signer. This worker's env uses
// the `APPLE_*` secret names, so we just adapt them to ApnsKeyConfig.

async function getApnsJwt(env: Env): Promise<string> {
  return apnsSigner.getApnsJwt({
    authKey: env.APPLE_AUTH_KEY,
    keyId: env.APPLE_KEY_ID,
    teamId: env.APPLE_TEAM_ID,
  });
}

// `json()` is the shared helper from @ollie/worker-http (imported above).
