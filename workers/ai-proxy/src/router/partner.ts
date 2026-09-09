/**
 * /partner/* — bilateral sync for the Partner "intimate window".
 *
 *   POST /partner/code      → mint a short-lived 6-digit pairing code for me
 *   POST /partner/pair      → { code } : claim a partner's code → form the pair
 *   GET  /partner/snapshot  → { paired, partnerId, snapshot } (the OTHER side)
 *   POST /partner/snapshot  → upsert MY interpreted snapshot (consent-filtered)
 *   POST /partner/unpair    → clean break (decision 13)
 *
 * Privacy: only interpreted soft state is ever stored (decision 10). Raw mood /
 * cycle / energy / focus numbers never reach the server. Auth: Clerk JWT (the
 * `sub` is the user id); fail CLOSED unless T0_JWT_ENFORCED === '0' (dev).
 */

import { json, upstreamError, exceedsContentLength, payloadTooLarge } from '@ollie/worker-http';
import { verifyClerkJwt } from '../clerk-verify';

export interface PartnerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  T0_JWT_ENFORCED?: string;
  /** 'production' on prod — refuses the x-user-id dev bypass there (audit #30). */
  ENVIRONMENT?: string;
  CLERK_ISSUER?: string;
}

const CODE_TTL_SEC = 30 * 60;
/** Snapshot bounds (audit #38, #154). A snapshot is ≤5 short phrases + a word;
 *  cap the whole body and each phrase so an oversized payload neither reaches
 *  worker memory nor lands ≤5 arbitrarily large strings on the partner. */
const MAX_SNAPSHOT_BODY_BYTES = 16 * 1024;
const MAX_PHRASE_LEN = 200;
const MAX_PHRASES = 5;

interface Snapshot {
  phrases: string[];
  self_word: string | null;
  crisis: boolean;
  gone_dark: boolean;
  updated_at?: string;
}

async function resolveUser(req: Request, env: PartnerEnv): Promise<string | null> {
  // x-user-id dev bypass is refused on production even if T0_JWT_ENFORCED='0' (audit #30).
  if (env.T0_JWT_ENFORCED !== '0' || env.ENVIRONMENT === 'production') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return await verifyClerkJwt(auth.slice('Bearer '.length), env);
  }
  return req.headers.get('x-user-id');
}

/** Thin Supabase REST helper (service-role). */
async function sb(
  env: PartnerEnv,
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<Response> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    ...(init.prefer ? { prefer: init.prefer } : {}),
  };
  return fetch(url, { ...init, headers });
}

function sixDigit(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return `${buf[0] % 1_000_000}`.padStart(6, '0');
}

/** Dispatch on the sub-path after /partner/. */
export async function handlePartner(req: Request, env: PartnerEnv, action: string): Promise<Response> {
  const me = await resolveUser(req, env);
  if (!me) return json({ error: 'unauthorized' }, 401);

  if (action === 'code' && req.method === 'POST') return mintCode(env, me);
  if (action === 'pair' && req.method === 'POST') return pair(req, env, me);
  if (action === 'snapshot' && req.method === 'GET') return getSnapshot(env, me);
  if (action === 'snapshot' && req.method === 'POST') return putSnapshot(req, env, me);
  if (action === 'unpair' && req.method === 'POST') return unpair(env, me);
  return json({ error: 'not_found' }, 404);
}

async function mintCode(env: PartnerEnv, me: string): Promise<Response> {
  // Clear any prior codes for me, then insert a fresh one.
  await sb(env, `partner_codes?user_id=eq.${encodeURIComponent(me)}`, { method: 'DELETE' });
  const code = sixDigit();
  const expires = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
  const res = await sb(env, 'partner_codes', {
    method: 'POST',
    body: JSON.stringify({ code, user_id: me, expires_at: expires }),
    prefer: 'return=minimal',
  });
  if (!res.ok) return upstreamError('mint_failed', 502, await res.text(), { endpoint: 'partner' });
  return json({ code, expiresInSec: CODE_TTL_SEC });
}

async function pair(req: Request, env: PartnerEnv, me: string): Promise<Response> {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const code = (body.code ?? '').trim();
  if (!/^\d{4,6}$/.test(code)) return json({ error: 'bad_code' }, 400);

  const lookup = await sb(
    env,
    `partner_codes?code=eq.${encodeURIComponent(code)}&select=user_id,expires_at`,
  );
  const rows = (await lookup.json().catch(() => [])) as Array<{ user_id: string; expires_at: string }>;
  const row = rows[0];
  if (!row) return json({ error: 'code_not_found' }, 404);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'code_expired' }, 410);
  const partnerId = row.user_id;
  if (partnerId === me) return json({ error: 'cannot_pair_self' }, 400);

  // One pairing per side — clear any existing pair for me first (clean swap).
  await dropPairsFor(env, me);
  const [lo, hi] = me < partnerId ? [me, partnerId] : [partnerId, me];
  const create = await sb(env, 'partner_pairs', {
    method: 'POST',
    body: JSON.stringify({ user_lo: lo, user_hi: hi }),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
  if (!create.ok) return upstreamError('pair_failed', 502, await create.text(), { endpoint: 'partner' });
  // Burn the used code.
  await sb(env, `partner_codes?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE' });
  return json({ partnerId });
}

async function findPartner(env: PartnerEnv, me: string): Promise<string | null> {
  const q = encodeURIComponent(me);
  const res = await sb(
    env,
    `partner_pairs?or=(user_lo.eq.${q},user_hi.eq.${q})&select=user_lo,user_hi&limit=1`,
  );
  const rows = (await res.json().catch(() => [])) as Array<{ user_lo: string; user_hi: string }>;
  const row = rows[0];
  if (!row) return null;
  return row.user_lo === me ? row.user_hi : row.user_lo;
}

async function dropPairsFor(env: PartnerEnv, me: string): Promise<void> {
  const q = encodeURIComponent(me);
  await sb(env, `partner_pairs?or=(user_lo.eq.${q},user_hi.eq.${q})`, { method: 'DELETE' });
}

async function getSnapshot(env: PartnerEnv, me: string): Promise<Response> {
  const partnerId = await findPartner(env, me);
  if (!partnerId) return json({ paired: false, partnerId: null, snapshot: null });
  const res = await sb(
    env,
    `partner_snapshots?user_id=eq.${encodeURIComponent(partnerId)}&select=phrases,self_word,crisis,gone_dark,updated_at`,
  );
  const rows = (await res.json().catch(() => [])) as Snapshot[];
  return json({ paired: true, partnerId, snapshot: rows[0] ?? null });
}

async function putSnapshot(req: Request, env: PartnerEnv, me: string): Promise<Response> {
  // Memory-DoS guard (audit #38).
  if (exceedsContentLength(req, MAX_SNAPSHOT_BODY_BYTES)) {
    return payloadTooLarge('body_too_large');
  }
  let body: Partial<Snapshot>;
  try {
    body = (await req.json()) as Partial<Snapshot>;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const row = {
    user_id: me,
    // audit #154: cap EACH phrase to MAX_PHRASE_LEN (not just the count) so the
    // partner never receives ≤5 arbitrarily large strings.
    phrases: Array.isArray(body.phrases)
      ? body.phrases
          .filter((p): p is string => typeof p === 'string')
          .slice(0, MAX_PHRASES)
          .map((p) => p.slice(0, MAX_PHRASE_LEN))
      : [],
    self_word: typeof body.self_word === 'string' ? body.self_word.slice(0, 40) : null,
    crisis: body.crisis === true,
    gone_dark: body.gone_dark === true,
    updated_at: new Date().toISOString(),
  };
  const res = await sb(env, 'partner_snapshots', {
    method: 'POST',
    body: JSON.stringify(row),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
  if (!res.ok) return upstreamError('snapshot_failed', 502, await res.text(), { endpoint: 'partner' });
  return json({ ok: true });
}

async function unpair(env: PartnerEnv, me: string): Promise<Response> {
  await dropPairsFor(env, me);
  return json({ ok: true });
}
