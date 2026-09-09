/**
 * HTTP surface for the server-apply pilot (A6b).
 *   POST /apply-inbox          → drain this user's pending inbox → per-domain.
 *   GET  /sync/grocery-pantry  → pull grocery rows updated since ?since=ISO.
 * Both Clerk-JWT-authed (same policy as /route/dump), with the same staging
 * side-door so the closed-app demo can curl with a test bearer.
 */

import { verifyClerkJwt } from '../clerk-verify';
import { checkRate, type RateLimiter } from '../rate-limit';
import { applyInbox, pullGroceryPantry, type ServerApplyEnv } from './server-apply';

interface RoutesEnv extends ServerApplyEnv {
  CLERK_ISSUER?: string;
  STAGING_TEST_BEARER?: string;
  /** 'production' on prod — disables the staging test bearer there (audit #24). */
  ENVIRONMENT?: string;
  /** Per-user rate-limit machinery (shared with index.ts). Optional so a
   *  deploy missing the binding still type-checks + falls back to the KV
   *  counter (TELEM_RATE_LIMITER undefined → KV fixed-window). */
  RATE_KV: KVNamespace;
  TELEM_RATE_LIMITER?: RateLimiter;
}

const STAGING_TEST_USER_ID = 'staging-test-user';

/** req/min per user across both server-apply routes. Generous — an
 *  app-foreground sync drains the inbox once then pulls grocery rows; this
 *  only stops a single account from looping the encrypt/Supabase path. */
const SERVER_APPLY_RATE_MAX = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function authUser(req: Request, env: RoutesEnv): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const bearer = auth.slice('Bearer '.length);
  // Staging test bearer honored only off production (audit #24, mirrors #43).
  if (env.ENVIRONMENT !== 'production' && env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER)
    return STAGING_TEST_USER_ID;
  try {
    return await verifyClerkJwt(bearer, { CLERK_ISSUER: env.CLERK_ISSUER });
  } catch {
    return null;
  }
}

export async function handleApplyInbox(req: Request, env: RoutesEnv): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const userId = await authUser(req, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  if (!(await checkRate(env.TELEM_RATE_LIMITER, env.RATE_KV, `rl:server-apply:${userId}`, SERVER_APPLY_RATE_MAX)))
    return json({ error: 'rate_limited' }, 429);
  const result = await applyInbox(env, userId);
  return json({ ok: true, ...result });
}

export async function handleSyncGroceryPantry(req: Request, env: RoutesEnv): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const userId = await authUser(req, env);
  if (!userId) return json({ error: 'unauthorized' }, 401);
  if (!(await checkRate(env.TELEM_RATE_LIMITER, env.RATE_KV, `rl:server-apply:${userId}`, SERVER_APPLY_RATE_MAX)))
    return json({ error: 'rate_limited' }, 429);
  const since = new URL(req.url).searchParams.get('since');
  const rows = await pullGroceryPantry(env, userId, since);
  return json({ ok: true, rows });
}
