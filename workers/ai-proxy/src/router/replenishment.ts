/**
 * GET /replenishment/:user — adaptive replenishment estimates per canonical.
 *
 * Reads per-user purchase cadence from `grocery_purchase_history` (via
 * `grocery_replenishment_estimates(uuid)` SQL function, owned by
 * backend-junior-1) and returns one ReplenishmentEstimate per canonical
 * the user has bought at least once.
 *
 * Confidence tiering:
 *   sample_size === 1  → 'low-data'  (static shelf-life used as cadence)
 *   sample_size >= 2   → 'observed'  (user's median interval)
 *   sample_size === 0  → row omitted; frontend falls back to STATIC_SHELF_LIFE
 *
 * Auth:
 *   - JWT enforced when T0_JWT_ENFORCED === '1' (mirrors /route/:module).
 *   - `:user` path param MUST equal the verified Clerk sub claim; cross-user
 *     reads return 403 regardless of the JWT enforcement gate (defence in
 *     depth: even when the gate is off, we never serve someone else's data).
 *
 * Cache: Cache-Control: private, max-age=60 — purchase writes invalidate
 *        client-side (frontend re-fetches after POST /grocery/purchase).
 *
 * Spec: docs/handoffs/grocery-routing/05-ADAPTIVE-REPLENISHMENT.md
 */

import { json, upstreamError } from '@ollie/worker-http';
import { verifyClerkJwt } from '../clerk-verify';
import { SHELF_LIFE_MAP } from '../modules/grocery.config';

// ─── env ─────────────────────────────────────────────────────────────────────

export interface ReplenishmentEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  T0_JWT_ENFORCED?: string;
  /** 'production' on prod — refuses the x-user-id dev bypass there (audit #25). */
  ENVIRONMENT?: string;
  CLERK_ISSUER?: string;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type ReplenishmentConfidence = 'static' | 'low-data' | 'observed';

export interface ReplenishmentEstimate {
  canonical: string;
  daysLeft: number;
  confidence: ReplenishmentConfidence;
  sampleSize: number;
  medianIntervalDays: number;
  lastPurchaseTs: number;
}

export interface ReplenishmentResponse {
  estimates: ReplenishmentEstimate[];
}

/**
 * Shape returned by the SQL function `grocery_replenishment_estimates`.
 * Each row is one (user_id, canonical) bucket. JSON keys mirror PostgREST
 * default snake_case.
 */
interface RpcRow {
  canonical: string;
  sample_size: number;
  median_interval_days: number | null;
  last_purchase_ts: string; // ISO timestamptz
}

// ─── constants ───────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const STATIC_FALLBACK_DAYS = 14; // unknown canonical, default ~2 weeks

/** Accepts UUIDs (legacy) AND Clerk user IDs (user_xxx). Real auth boundary
 *  is the downstream Clerk JWT ownership check; this regex only blocks
 *  injection-shaped garbage. */
const UUID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// ─── handler ─────────────────────────────────────────────────────────────────

export async function handleReplenishment(
  req: Request,
  env: ReplenishmentEnv,
  pathUserId: string,
): Promise<Response> {
  // 1. Path param sanity — even when JWT is disabled, malformed ids 400.
  if (!UUID_RE.test(pathUserId)) {
    return json({ error: 'invalid_user_id' }, 400);
  }

  // 2. Auth + ownership — fail CLOSED unless dev (T0_JWT_ENFORCED==='0') AND not
  //    production (audit #25: prod refuses the spoofable x-user-id bypass).
  if (env.T0_JWT_ENFORCED !== '0' || env.ENVIRONMENT === 'production') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const verified = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!verified) {
      return json({ error: 'invalid_jwt' }, 401);
    }
    if (verified !== pathUserId) {
      return json({ error: 'forbidden' }, 403);
    }
  } else {
    // Open mode: x-user-id header must match path param. Belt + suspenders so
    // the open dev mode can never serve another user's cadence.
    const headerUser = req.headers.get('x-user-id');
    if (!headerUser) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (headerUser !== pathUserId) {
      return json({ error: 'forbidden' }, 403);
    }
  }

  // 3. Call the SQL RPC
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/grocery_replenishment_estimates`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      },
      body: JSON.stringify({ p_user: pathUserId }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return upstreamError('replenishment_rpc_failed', 502, detail);
  }

  if (!res.ok) {
    // 404 = RPC not deployed yet (junior-1 migration pending). Return empty
    // list so the frontend gracefully falls back to STATIC_SHELF_LIFE.
    if (res.status === 404) {
      return jsonWithCache({ estimates: [] });
    }
    const detail = await res.text().catch(() => '');
    return upstreamError('replenishment_rpc_failed', 502, detail, {
      status: res.status,
    });
  }

  let rows: RpcRow[];
  try {
    rows = (await res.json()) as RpcRow[];
  } catch {
    return upstreamError('replenishment_rpc_failed', 502, 'unparseable body');
  }
  if (!Array.isArray(rows)) {
    return jsonWithCache({ estimates: [] });
  }

  const now = Date.now();
  const estimates: ReplenishmentEstimate[] = [];
  for (const row of rows) {
    const est = projectEstimate(row, now);
    if (est) estimates.push(est);
  }

  return jsonWithCache({ estimates });
}

// ─── projection ──────────────────────────────────────────────────────────────

/**
 * Turn one RPC row into a ReplenishmentEstimate. Returns null when the row
 * is malformed (defensive — SQL function should never emit these) so the
 * response stays well-typed.
 */
function projectEstimate(row: RpcRow, now: number): ReplenishmentEstimate | null {
  if (!row || typeof row.canonical !== 'string' || row.canonical.length === 0) {
    return null;
  }
  const sampleSize = Number(row.sample_size);
  if (!Number.isFinite(sampleSize) || sampleSize < 1) {
    return null;
  }
  const lastTsMs = Date.parse(row.last_purchase_ts);
  if (!Number.isFinite(lastTsMs)) {
    return null;
  }

  const daysSinceLast = Math.max(0, (now - lastTsMs) / DAY_MS);

  let medianIntervalDays: number;
  let confidence: ReplenishmentConfidence;
  if (sampleSize >= 2 && typeof row.median_interval_days === 'number' && row.median_interval_days > 0) {
    medianIntervalDays = row.median_interval_days;
    confidence = 'observed';
  } else {
    medianIntervalDays = SHELF_LIFE_MAP[row.canonical] ?? STATIC_FALLBACK_DAYS;
    confidence = 'low-data';
  }

  const daysLeft = Math.max(0, medianIntervalDays - daysSinceLast);

  return {
    canonical: row.canonical,
    daysLeft: round1(daysLeft),
    confidence,
    sampleSize,
    medianIntervalDays: round1(medianIntervalDays),
    lastPurchaseTs: lastTsMs,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function jsonWithCache(body: ReplenishmentResponse): Response {
  return json(body, 200, {
    'cache-control': 'private, max-age=60',
  });
}
