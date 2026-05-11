/**
 * ollie-notifications · Cloudflare Worker
 *
 * Two endpoints:
 *   POST /register-token   — iOS client posts its APNs device token here
 *                            after Capacitor PushNotifications fires
 *                            the `registration` listener.
 *   POST /send             — server-side trigger that pushes a
 *                            NotificationSpec to one or more device
 *                            tokens via APNs.
 *
 * The worker signs an APNs JWT (ES256) using a .p8 auth key stored as a
 * worker secret. JWTs are cached in-process for 50 minutes (Apple's
 * max is 60). The HTTP/2 fan-out is one request per token via the
 * standard `fetch` API — Cloudflare's fetch supports HTTP/2 to Apple.
 *
 * Apple Developer setup (Serra one-time):
 *   1. Apple Developer → Certificates, Identifiers & Profiles → Keys
 *   2. + → "Apple Push Notifications service (APNs)" → Continue
 *   3. Name: "ollie · APNs key" → Register → Download → AuthKey_XXX.p8
 *      Save the 10-char key id shown on screen — never shown again.
 *   4. Note the Team ID from Membership page.
 *   5. Make sure the iOS app's bundle id (app.ollie.ollie) has Push
 *      Notifications capability enabled in the App ID config.
 *   6. Wrangler secrets:
 *        wrangler secret put APNS_KEY_ID
 *        wrangler secret put APNS_TEAM_ID
 *        wrangler secret put APNS_BUNDLE_ID         # app.ollie.ollie
 *        wrangler secret put APNS_AUTH_KEY < AuthKey_XXX.p8
 *        wrangler secret put REGISTER_SHARED_SECRET
 *   7. wrangler kv:namespace create DEVICE_TOKENS
 *      (paste the returned id into wrangler.toml)
 *   8. wrangler deploy
 */

import type { NotificationSpec } from '@ollie/notifications';

export interface Env {
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_AUTH_KEY: string;
  APNS_USE_SANDBOX: string;
  REGISTER_SHARED_SECRET: string;
  DEVICE_TOKENS: KVNamespace;
}

// ──────────────────────────────────────────────────────────────────────────
// Routing
// ──────────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/register-token') {
      return handleRegister(req, env);
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      return handleSend(req, env);
    }
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  },
};

// ──────────────────────────────────────────────────────────────────────────
// /register-token
// ──────────────────────────────────────────────────────────────────────────

interface RegisterBody {
  token: string;
  platform: 'ios' | 'macos';
  device_id?: string;
  user_id?: string;
}

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.REGISTER_SHARED_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let body: RegisterBody;
  try { body = (await req.json()) as RegisterBody; }
  catch { return new Response('bad json', { status: 400 }); }

  if (!body.token || !body.platform) {
    return new Response('missing fields', { status: 400 });
  }
  const key = body.user_id ? `user:${body.user_id}` : `token:${body.token}`;
  await env.DEVICE_TOKENS.put(
    key,
    JSON.stringify({
      token: body.token,
      platform: body.platform,
      device_id: body.device_id,
      user_id: body.user_id,
      registered_at: Date.now(),
    }),
  );
  return Response.json({ ok: true });
}

// ──────────────────────────────────────────────────────────────────────────
// /send
// ──────────────────────────────────────────────────────────────────────────

interface SendBody {
  /** One or more device tokens to push to. */
  tokens?: string[];
  /** OR a user_id whose tokens are looked up in KV. */
  user_id?: string;
  /** The notification spec. */
  spec: NotificationSpec;
}

async function handleSend(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.REGISTER_SHARED_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  let body: SendBody;
  try { body = (await req.json()) as SendBody; }
  catch { return new Response('bad json', { status: 400 }); }
  if (!body.spec || !body.spec.title || !body.spec.category) {
    return new Response('missing spec', { status: 400 });
  }

  const tokens = body.tokens?.length
    ? body.tokens
    : await tokensForUser(env, body.user_id);
  if (!tokens.length) {
    return Response.json({ ok: false, reason: 'no_tokens' }, { status: 200 });
  }

  const jwt = await getApnsJwt(env);
  const results = await Promise.all(
    tokens.map((t) => sendApns(env, jwt, t, body.spec)),
  );
  const ok = results.filter((r) => r.ok).length;
  return Response.json({ ok: true, delivered: ok, total: tokens.length, results });
}

async function tokensForUser(env: Env, userId?: string): Promise<string[]> {
  if (!userId) return [];
  const raw = await env.DEVICE_TOKENS.get(`user:${userId}`);
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { token?: string };
    return j.token ? [j.token] : [];
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// APNs JWT (ES256). Cached in-process for 50 min.
// ──────────────────────────────────────────────────────────────────────────

let __jwtCache: { jwt: string; expiresAt: number } | null = null;

async function getApnsJwt(env: Env): Promise<string> {
  const now = Date.now();
  if (__jwtCache && __jwtCache.expiresAt > now + 60_000) return __jwtCache.jwt;
  const jwt = await signApnsJwt(env);
  __jwtCache = { jwt, expiresAt: now + 50 * 60_000 };
  return jwt;
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function signApnsJwt(env: Env): Promise<string> {
  const header = { alg: 'ES256', kid: env.APNS_KEY_ID };
  const claims = {
    iss: env.APNS_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
  };
  const payload = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const keyData = pemToPkcs8(env.APNS_AUTH_KEY);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64UrlEncode(sig)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// APNs HTTP/2 send
// ──────────────────────────────────────────────────────────────────────────

interface ApnsResult {
  ok: boolean;
  status: number;
  apns_id?: string;
  reason?: string;
}

async function sendApns(
  env: Env,
  jwt: string,
  deviceToken: string,
  spec: NotificationSpec,
): Promise<ApnsResult> {
  const host = env.APNS_USE_SANDBOX === '1'
    ? 'api.sandbox.push.apple.com'
    : 'api.push.apple.com';
  const url = `https://${host}/3/device/${deviceToken}`;

  // APNs payload. `alert` is the user-visible bit; everything else
  // (dedupe_key, category, action_url) goes in the custom keys.
  const payload = {
    aps: {
      alert: { title: spec.title, body: spec.body ?? '' },
      'thread-id': spec.aggregation_group ?? spec.category,
      'mutable-content': 1,
    },
    ollie: {
      dedupe_key: spec.dedupe_key,
      category: spec.category,
      action_url: spec.action_url,
      ...spec.extra,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': spec.category === 'REMINDER' ? 'alert' : 'alert',
      'apns-priority': '10',
      'apns-collapse-id': spec.dedupe_key.slice(0, 64),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const apnsId = res.headers.get('apns-id') ?? undefined;
  if (res.ok) return { ok: true, status: res.status, apns_id: apnsId };
  let reason: string | undefined;
  try {
    const j = (await res.json()) as { reason?: string };
    reason = j.reason;
  } catch { /* noop */ }
  return { ok: false, status: res.status, apns_id: apnsId, reason };
}
