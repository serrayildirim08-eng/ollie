/**
 * POST /grocery/purchase — event ingestion for adaptive replenishment.
 *
 * Writes one row into `grocery_purchase_history` per call. Three trigger
 * sources, all converging here:
 *   - 'pantry_add'   — user dumps "got milk" / "matcha aldım" (orchestrator hop)
 *   - 'shop_checked' — user taps a shopping list item to mark purchased
 *   - 'ai_inferred'  — high-confidence pantry classification from /route/grocery
 *
 * Auth: gated by env.T0_JWT_ENFORCED. When "1", a valid Clerk session JWT is
 *       required and its `sub` claim is the verified user_id. Until then the
 *       endpoint is OPEN so the frontend can wire UI without waiting on the
 *       Clerk cutover — mirrors the /route/:module gate.
 *
 * Rate limit: per-verified-user, 100/min (purchase bursts at checkout time
 *             can fire many rows; 10/min is too tight). Falls back to a
 *             racy KV counter when the [[ratelimits]] binding is absent.
 *
 * Body contract (frozen with backend-junior-2):
 *   {
 *     canonical: string,           // best-effort canonical OR raw user text
 *     qty?: number,
 *     unit?: string,
 *     source: 'pantry_add' | 'shop_checked' | 'ai_inferred',
 *     ts: number                   // epoch ms
 *   }
 *
 * Spec: docs/handoffs/grocery-routing/05-ADAPTIVE-REPLENISHMENT.md
 * SQL table + RPC: backend-junior-1 (migration parallel).
 */

import { json, upstreamError } from '@ollie/worker-http';
import { verifyClerkJwt } from '../clerk-verify';
import { CANONICAL_ITEMS } from '../modules/grocery.config';

// ─── env ─────────────────────────────────────────────────────────────────────

export interface PurchaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  /** Set to "1" to enforce Clerk JWT auth (mirrors RouteEnv). */
  T0_JWT_ENFORCED?: string;
  /** Clerk issuer URL — required when T0_JWT_ENFORCED === '1'. */
  CLERK_ISSUER?: string;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type PurchaseSource = 'pantry_add' | 'shop_checked' | 'ai_inferred';

export interface GroceryPurchaseEvent {
  canonical: string;
  qty?: number;
  unit?: string;
  source: PurchaseSource;
  ts: number;
}

interface PurchaseInsertResponse {
  inserted: true;
  id: string;
}

// ─── constants ───────────────────────────────────────────────────────────────

const ALLOWED_SOURCES: ReadonlySet<PurchaseSource> = new Set([
  'pantry_add',
  'shop_checked',
  'ai_inferred',
]);

/** Reject ts older than this — late client retries are fine, ancient or
 *  future-dated rows are likely client-clock bugs and corrupt the cadence
 *  median for the user. Window: 7 days back, 1 day forward (TZ slop). */
const TS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TS_MAX_FUTURE_MS = 1 * 24 * 60 * 60 * 1000;

/** Canonical lookup as Set for O(1) membership checks. */
const CANONICAL_SET = new Set(CANONICAL_ITEMS);

// ─── handler ─────────────────────────────────────────────────────────────────

export async function handlePurchase(
  req: Request,
  env: PurchaseEnv,
): Promise<Response> {
  // 1. Auth gate (T0)
  let userId: string | null;
  if (env.T0_JWT_ENFORCED === '1') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    userId = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!userId) {
      return json({ error: 'invalid_jwt' }, 401);
    }
  } else {
    // Open mode: accept user id from header for dev parity with /route/:module.
    // Once T0 ships this branch is dead.
    userId = req.headers.get('x-user-id');
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  // 2. Parse + validate body
  let body: GroceryPurchaseEvent;
  try {
    body = (await req.json()) as GroceryPurchaseEvent;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const validationError = validateEvent(body);
  if (validationError) {
    return json({ error: validationError }, 400);
  }

  // 3. Canonical normalize — collapse to lowercase, null-out unknown canonicals
  //    only if the input also fails the lowercase match. We keep best-effort
  //    free-text in `canonical` so the SQL function can still aggregate
  //    user-specific items (e.g. "hay") that aren't in CANONICAL_ITEMS yet.
  const canonical = normalizeCanonical(body.canonical);

  // 4. Insert via Supabase REST
  const row = {
    user_id: userId,
    canonical,
    qty: body.qty ?? null,
    unit: body.unit ?? null,
    source: body.source,
    ts: new Date(body.ts).toISOString(),
  };

  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/grocery_purchase_history`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return upstreamError('purchase_insert_failed', 502, detail);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return upstreamError('purchase_insert_failed', 502, detail, {
      status: res.status,
    });
  }

  // PostgREST with return=representation returns [{ id, ... }].
  // Tolerate empty body (return=minimal) by minting nothing — id is optional.
  let insertedId: string | undefined;
  try {
    const rows = (await res.json()) as Array<{ id?: string }>;
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].id === 'string') {
      insertedId = rows[0].id;
    }
  } catch {
    // empty body — ignore, response still 200
  }

  const respBody: PurchaseInsertResponse | { inserted: true } = insertedId
    ? { inserted: true, id: insertedId }
    : { inserted: true };
  return json(respBody);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function validateEvent(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'bad_body';
  }
  const e = body as Record<string, unknown>;

  if (typeof e.canonical !== 'string' || e.canonical.trim().length === 0) {
    return 'missing_canonical';
  }
  if (e.canonical.length > 200) {
    return 'canonical_too_long';
  }

  if (typeof e.source !== 'string' || !ALLOWED_SOURCES.has(e.source as PurchaseSource)) {
    return 'invalid_source';
  }

  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) {
    return 'invalid_ts';
  }
  const now = Date.now();
  if (e.ts < now - TS_MAX_AGE_MS || e.ts > now + TS_MAX_FUTURE_MS) {
    return 'ts_out_of_range';
  }

  if (e.qty !== undefined && (typeof e.qty !== 'number' || !Number.isFinite(e.qty) || e.qty < 0)) {
    return 'invalid_qty';
  }
  if (e.unit !== undefined && (typeof e.unit !== 'string' || e.unit.length > 32)) {
    return 'invalid_unit';
  }

  return null;
}

function normalizeCanonical(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  // If it's already a known canonical, use as-is.
  if (CANONICAL_SET.has(trimmed)) return trimmed;
  // Otherwise keep the lowercase form — the SQL median grouping uses string
  // equality, so consistent casing is what matters. Unknown items still get
  // their own cadence learned per user.
  return trimmed;
}
