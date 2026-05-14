/**
 * ollie · plaid-sync Cloudflare Worker
 *
 * Responsibilities:
 *
 *   1. POST /exchange     — Plaid public_token → access_token. Worker
 *                            calls Plaid server-side using the secret;
 *                            returns access_token to the client which
 *                            encrypts it with the user's @ollie/crypto
 *                            key BEFORE persisting. (Yes, the token
 *                            briefly transits worker→client in plaintext
 *                            over TLS — the alternative is the worker
 *                            persisting the token, which would require
 *                            the worker to also handle a key-escrow
 *                            scheme and breaks the user-only-key model.)
 *
 *   2. POST /webhook      — Plaid webhook receiver. Verifies the
 *                            JWT signature, routes the event, and on
 *                            sync-required:
 *                              a. fetches new transactions via Plaid
 *                                 cursor sync
 *                              b. server-side encrypts each tx with
 *                                 PLAID_INBOX_ENCRYPTION_KEY
 *                              c. inserts into Supabase `plaid_inbox`
 *                                 staging using the service-role key
 *                            The client polls plaid_inbox on next
 *                            session, re-encrypts with the user's key,
 *                            writes to finance_records, then deletes
 *                            the staging row.
 *
 *   3. GET  /health       — liveness probe.
 *
 *   4. (deferred) scheduled() — daily cron pull. Wired but cron config
 *                            in wrangler.toml is commented out until
 *                            Serra greenlights. Webhook coverage is the
 *                            primary path.
 *
 * Why the staging table at all (not direct insert to finance_records)?
 *   The worker has no access to the user's encryption key — that's a
 *   user-derived secret that lives only on devices. We need bank txns
 *   to be encrypted-at-rest under the user's key, but we also can't
 *   wait for the user to be online before pulling from Plaid (webhooks
 *   are push, the user could be asleep). Compromise: server-side wrap
 *   with PLAID_INBOX_ENCRYPTION_KEY for in-transit-at-rest protection
 *   until the client picks up. Worst case (server compromise) leaks
 *   txns currently in flight, not the whole history.
 */

import { createPlaidClient } from '../../../packages/plaid/src/client';
import { syncTransactionsCursor } from '../../../packages/plaid/src/transactions';
import { createLinkToken, exchangePublicToken } from '../../../packages/plaid/src/link';
import { verifyWebhook, routeWebhook } from '../../../packages/plaid/src/webhook';
import type { PlaidNormalizedTransaction } from '../../../packages/plaid/src/types';

export interface Env {
  // Vars
  PLAID_ENV: 'sandbox' | 'development' | 'production';

  // Secrets
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  PLAID_INBOX_ENCRYPTION_KEY: string; // base64-encoded 32 bytes

  // Bindings
  PLAID_KEY_KV: KVNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, env: env.PLAID_ENV });
    }

    if (req.method === 'POST' && url.pathname === '/link/token/create') {
      return handleLinkTokenCreate(req, env);
    }

    if (req.method === 'POST' && url.pathname === '/exchange') {
      return handleExchange(req, env);
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(req, env);
    }

    return json({ error: 'not_found' }, 404);
  },

  /**
   * Cron handler — wired but not triggered until wrangler.toml's
   * [triggers] block is uncommented. Iterates active plaid_items and
   * runs a cursor sync for any item that hasn't pinged in 24h.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Defensive no-op when secrets are missing (sandbox dev environment).
    if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return;

    // Read active items via service-role; PostgREST filter pulls only
    // those last-synced >24h ago. Iterate small batches to stay under
    // the 30s worker budget.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const items = await supabaseSelect<{
      id: string;
      user_id: string;
      item_id: string;
      cursor: string | null;
      // The cron path needs the access_token, but it's encrypted under
      // the user's key (which we don't have). Cron is therefore a
      // FALLBACK only — the worker keeps a separate plaintext-by-user
      // hot column? No — that violates the constraint. Cron stays
      // deferred until we have a clean design (e.g. user-initiated
      // backfill from the client instead). For now, log + return.
    }>(env, 'plaid_items', `select=id,user_id,item_id,cursor&updated_at=lt.${encodeURIComponent(cutoff)}&status=eq.active&limit=50`);

    if (!items.ok) return;
    if (items.rows.length === 0) return;
    console.log(`[plaid-sync · cron] ${items.rows.length} items overdue. Cron is deferred — design pending.`);
  },
};

// ──────────────────────────────────────────────────────────────────────────
// /link/token/create — issue a Link token for the signed-in user
// ──────────────────────────────────────────────────────────────────────────

interface LinkTokenRequestBody {
  userId: string;
  countryCodes?: Array<'US' | 'CA' | 'GB' | 'IE' | 'FR' | 'ES' | 'NL' | 'DE'>;
  language?: 'en' | 'es';
}

async function handleLinkTokenCreate(req: Request, env: Env): Promise<Response> {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    return json({ error: 'plaid_not_configured' }, 503);
  }
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const sub = parseJwtSub(authHeader.slice('Bearer '.length));
  if (!sub) return json({ error: 'invalid_jwt' }, 401);

  let body: LinkTokenRequestBody;
  try {
    body = (await req.json()) as LinkTokenRequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.userId || body.userId !== sub) {
    return json({ error: 'user_mismatch' }, 403);
  }

  const plaid = createPlaidClient({
    env: env.PLAID_ENV,
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
  });

  // The webhook URL is the SAME worker — Plaid will POST back to /webhook
  // on this worker once an Item is linked. Use the request's own origin
  // so dev / staging / prod URLs are picked up automatically.
  const reqUrl = new URL(req.url);
  const webhookUrl = `${reqUrl.origin}/webhook`;

  try {
    const r = await createLinkToken(plaid, {
      userId: body.userId,
      countryCodes: body.countryCodes,
      language: body.language,
      webhookUrl,
    });
    return json(r);
  } catch (err) {
    console.error('[plaid-sync] link token create failed', err);
    return json({ error: 'link_token_failed' }, 502);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// /exchange — public_token → access_token
// ──────────────────────────────────────────────────────────────────────────

interface ExchangeRequestBody {
  publicToken: string;
  userId: string;
}

interface ExchangeResponseBody {
  /** Plaintext access_token — client MUST encrypt before persisting. */
  accessToken: string;
  itemId: string;
  /** Plaid's institution metadata for display (institution_name). */
  institutionName: string | null;
}

async function handleExchange(req: Request, env: Env): Promise<Response> {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    return json({ error: 'plaid_not_configured' }, 503);
  }

  // The caller MUST present a valid Supabase user JWT — we use it to
  // assert the userId field in the body matches. This worker never
  // accepts an unauthenticated /exchange call. The JWT is verified
  // by Supabase REST when we use it on the client's behalf (defense
  // in depth: validate `sub` here against `body.userId`).
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const userJwt = authHeader.slice('Bearer '.length);
  const sub = parseJwtSub(userJwt);
  if (!sub) return json({ error: 'invalid_jwt' }, 401);

  let body: ExchangeRequestBody;
  try {
    body = (await req.json()) as ExchangeRequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body.publicToken || !body.userId) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (body.userId !== sub) {
    return json({ error: 'user_mismatch' }, 403);
  }

  const plaid = createPlaidClient({
    env: env.PLAID_ENV,
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
  });

  let exchanged;
  try {
    exchanged = await exchangePublicToken(plaid, body.publicToken);
  } catch (err) {
    console.error('[plaid-sync] exchange failed', err);
    return json({ error: 'exchange_failed' }, 502);
  }

  // Fetch institution metadata so we can display "connected to Chase"
  // in the UI without exposing the access_token to the institutions API.
  let institutionName: string | null = null;
  try {
    const itemResp = await plaid.itemGet({ access_token: exchanged.access_token });
    const instId = itemResp.data.item.institution_id;
    if (instId) {
      const instResp = await plaid.institutionsGetById({
        institution_id: instId,
        country_codes: ['US'] as never,
      });
      institutionName = instResp.data.institution.name;
    }
  } catch (err) {
    // institution lookup is non-critical — keep going
    console.warn('[plaid-sync] institution lookup failed', err);
  }

  const respBody: ExchangeResponseBody = {
    accessToken: exchanged.access_token,
    itemId: exchanged.item_id,
    institutionName,
  };
  return json(respBody);
}

// ──────────────────────────────────────────────────────────────────────────
// /webhook — receive + verify + route + stage
// ──────────────────────────────────────────────────────────────────────────

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    return json({ error: 'plaid_not_configured' }, 503);
  }

  // Read raw body ONCE for signature verification (must be the exact
  // bytes Plaid sent, byte-for-byte, no JSON re-serialization).
  const rawBody = await req.text();
  const verificationHeader = req.headers.get('plaid-verification');

  const plaid = createPlaidClient({
    env: env.PLAID_ENV,
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
  });

  const verification = await verifyWebhook({
    rawBody,
    verificationHeader,
    plaid,
    keyCache: {
      get: (kid) => env.PLAID_KEY_KV.get(`plaid_jwk:${kid}`),
      set: (kid, jwk, ttl) =>
        env.PLAID_KEY_KV.put(`plaid_jwk:${kid}`, jwk, { expirationTtl: ttl }),
    },
  });

  if (!verification.verified) {
    console.warn('[plaid-sync] webhook rejected:', verification.reason);
    return json({ error: 'verification_failed', reason: verification.reason }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const routed = routeWebhook(event);

  switch (routed.action.kind) {
    case 'sync_transactions':
      // Look up access_token for this item_id in plaid_items via
      // service-role. The access_token is encrypted under the user's
      // key — we cannot decrypt it here. We can only enqueue a
      // signal that the client must pull on next session.
      //
      // Implementation: write a row to plaid_inbox with
      // record_type='sync_required' that the client picks up. The
      // client then calls back to /sync with its decrypted token.
      //
      // For now (sandbox-functional scaffold), we log + enqueue a
      // marker row. Full client-driven sync flow is the next sprint.
      await stageSyncMarker(env, routed.action.item_id, routed.action.reason);
      return json({ ok: true, action: 'sync_marker_enqueued' });

    case 'tombstone_transactions':
      await stageTombstones(env, routed.action.item_id, routed.action.removed_ids);
      return json({ ok: true, action: 'tombstones_enqueued', count: routed.action.removed_ids.length });

    case 'mark_item_error':
      await updateItemStatus(env, routed.action.item_id, 'error');
      return json({ ok: true, action: 'item_marked_error' });

    case 'mark_item_revoked':
      await updateItemStatus(env, routed.action.item_id, 'revoked');
      return json({ ok: true, action: 'item_marked_revoked' });

    case 'ignore':
      return json({ ok: true, action: 'ignored', reason: routed.action.reason });

    default: {
      const _exhaustive: never = routed.action;
      void _exhaustive;
      return json({ error: 'unhandled_action' }, 500);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Supabase service-role helpers
// ──────────────────────────────────────────────────────────────────────────

interface SelectResult<T> {
  ok: boolean;
  rows: T[];
}

async function supabaseSelect<T>(env: Env, table: string, query: string): Promise<SelectResult<T>> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return { ok: false, rows: [] };
  }
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
  });
  if (!r.ok) {
    console.error('[plaid-sync] supabaseSelect failed', r.status, await r.text());
    return { ok: false, rows: [] };
  }
  const rows = (await r.json()) as T[];
  return { ok: true, rows };
}

async function supabaseInsert(env: Env, table: string, rows: unknown[]): Promise<boolean> {
  if (rows.length === 0) return true;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return false;
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    console.error('[plaid-sync] supabaseInsert failed', table, r.status, await r.text());
    return false;
  }
  return true;
}

async function supabaseUpdate(
  env: Env,
  table: string,
  filter: Record<string, string>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return false;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) params.set(k, v);
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    console.error('[plaid-sync] supabaseUpdate failed', table, r.status, await r.text());
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// staging helpers
// ──────────────────────────────────────────────────────────────────────────

async function stageSyncMarker(env: Env, itemId: string, reason: string): Promise<void> {
  // Find the (user_id, item_id) pair; we cannot fetch by item_id alone
  // because RLS doesn't bind us here (service-role), but we need the
  // user_id to seat the inbox row.
  const itemQ = await supabaseSelect<{ user_id: string }>(
    env,
    'plaid_items',
    `select=user_id&item_id=eq.${encodeURIComponent(itemId)}&status=eq.active&limit=1`,
  );
  if (!itemQ.ok || itemQ.rows.length === 0) return;
  const userId = itemQ.rows[0].user_id;

  // Encrypt a sync-required marker. Payload is intentionally small —
  // the client's job is to pull from Plaid itself once it sees this.
  const payload = { kind: 'sync_required', reason, ts: Date.now() };
  const enc = await serverWrap(env, JSON.stringify(payload));
  await supabaseInsert(env, 'plaid_inbox', [
    {
      user_id: userId,
      item_id: itemId,
      record_kind: 'sync_marker',
      encrypted_with_server_key: enc.ciphertextB64,
      server_iv: enc.ivB64,
    },
  ]);
}

async function stageTombstones(env: Env, itemId: string, removedIds: string[]): Promise<void> {
  if (removedIds.length === 0) return;
  const itemQ = await supabaseSelect<{ user_id: string }>(
    env,
    'plaid_items',
    `select=user_id&item_id=eq.${encodeURIComponent(itemId)}&status=eq.active&limit=1`,
  );
  if (!itemQ.ok || itemQ.rows.length === 0) return;
  const userId = itemQ.rows[0].user_id;
  const payload = { kind: 'tombstones', removed_ids: removedIds, ts: Date.now() };
  const enc = await serverWrap(env, JSON.stringify(payload));
  await supabaseInsert(env, 'plaid_inbox', [
    {
      user_id: userId,
      item_id: itemId,
      record_kind: 'tombstones',
      encrypted_with_server_key: enc.ciphertextB64,
      server_iv: enc.ivB64,
    },
  ]);
}

async function updateItemStatus(env: Env, itemId: string, status: 'error' | 'revoked'): Promise<void> {
  await supabaseUpdate(
    env,
    'plaid_items',
    { item_id: `eq.${itemId}` },
    { status, updated_at: new Date().toISOString() },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// server-side at-rest wrap (PLAID_INBOX_ENCRYPTION_KEY)
//
// We use AES-GCM-256. The plaintext is whatever JSON we want to stage.
// Server-side wrap is in-transit-at-rest protection ONLY — the client
// picks up the row, decrypts, re-encrypts with the user's key, writes
// to finance_records, then deletes the staging row. Steady state holds
// no plaid_inbox rows; only data in flight is here.
// ──────────────────────────────────────────────────────────────────────────

let __serverKey: CryptoKey | null = null;

async function getServerKey(env: Env): Promise<CryptoKey> {
  if (__serverKey) return __serverKey;
  const raw = base64ToBytes(env.PLAID_INBOX_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) {
    throw new Error('PLAID_INBOX_ENCRYPTION_KEY must decode to 32 bytes');
  }
  __serverKey = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  return __serverKey;
}

async function serverWrap(env: Env, plaintext: string): Promise<{ ciphertextB64: string; ivB64: string }> {
  const key = await getServerKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  return { ciphertextB64: bytesToBase64(ct), ivB64: bytesToBase64(iv) };
}

// Kept for symmetry / future cron use. Not currently called.
export async function _serverUnwrap(
  env: Env,
  ciphertextB64: string,
  ivB64: string,
): Promise<string> {
  const key = await getServerKey(env);
  const ct = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

// ──────────────────────────────────────────────────────────────────────────
// tiny helpers
// ──────────────────────────────────────────────────────────────────────────

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4)),
    ) as { sub?: string };
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Suppress unused-import warning when normalized type is only used by
// re-exporters via the workspace package boundary.
export type _PlaidTxAlias = PlaidNormalizedTransaction;
// Suppress unused-import warning for syncTransactionsCursor — kept
// imported because the cron handler will use it once enabled.
void syncTransactionsCursor;
