/**
 * POST /cook-history — event ingestion for Feed Me v2 adaptive learning.
 *
 * Writes one row into `cook_history` per call. Three trigger sources, all
 * converging here:
 *   - rating = -1  → "didn't love it"   (suppress similar dishes in future)
 *   - rating =  0  → "just cooked it"   (recent signal, no rating bias)
 *   - rating =  1  → "loved it"         (boost similar cuisine in future)
 *
 * Auth: gated by env.T0_JWT_ENFORCED. Same shape as /grocery/purchase — when
 *       "1", a valid Clerk session JWT is required and its `sub` claim is the
 *       verified user_id. Otherwise the `x-user-id` header is accepted (dev
 *       parity until T0 lands everywhere).
 *
 * Body contract (frozen with frontend-senior):
 *   {
 *     dish: string,                     // canonical dish name
 *     cuisine?: string,
 *     diet?: string[],                  // e.g. ['vegetarian', 'mediterranean']
 *     rating: -1 | 0 | 1,
 *     feedTarget: 'user' | 'pet',
 *     petName?: string | null,          // required when feedTarget === 'pet'
 *     ingredientsUsed?: Array<{ name: string; canonical: string | null }>,
 *     cookedAt?: number                 // epoch ms; defaults to server NOW
 *   }
 *
 * Spec: docs/handoffs/feed-me/00-SPEC.md
 * Table + RPC: backend-junior-1's 20260522000002_cook_history migration.
 */

import { json, upstreamError } from '@ollie/worker-http';
import { verifyClerkJwt } from '../clerk-verify';

// ─── env ─────────────────────────────────────────────────────────────────────

export interface CookHistoryEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  /** Set to "1" to enforce Clerk JWT auth. Mirrors PurchaseEnv. */
  T0_JWT_ENFORCED?: string;
  CLERK_ISSUER?: string;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type CookRating = -1 | 0 | 1;
export type CookFeedTarget = 'user' | 'pet';

export interface CookEvent {
  dish: string;
  cuisine?: string;
  diet?: string[];
  rating: CookRating;
  feedTarget: CookFeedTarget;
  petName?: string | null;
  ingredientsUsed?: Array<{ name: string; canonical: string | null }>;
  cookedAt?: number;
}

interface CookInsertResponse {
  inserted: true;
  id?: string;
}

// ─── constants ───────────────────────────────────────────────────────────────

const ALLOWED_RATINGS: ReadonlySet<number> = new Set([-1, 0, 1]);
const ALLOWED_TARGETS: ReadonlySet<CookFeedTarget> = new Set(['user', 'pet']);

/** Same TZ-slop tolerance as /grocery/purchase. */
const TS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TS_MAX_FUTURE_MS = 1 * 24 * 60 * 60 * 1000;

// ─── handler ─────────────────────────────────────────────────────────────────

export async function handleCookHistory(
  req: Request,
  env: CookHistoryEnv,
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
    userId = req.headers.get('x-user-id');
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  // 2. Parse + validate body
  let body: CookEvent;
  try {
    body = (await req.json()) as CookEvent;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const validationError = validateEvent(body);
  if (validationError) {
    return json({ error: validationError }, 400);
  }

  // 3. Build the insert row. `cooked_at` defaults to NOW on the DB side when
  //    omitted; we only pass it through if the client tagged a specific epoch.
  const row: Record<string, unknown> = {
    user_id: userId,
    dish: body.dish.trim(),
    cuisine: body.cuisine?.trim() || null,
    diet: Array.isArray(body.diet) ? body.diet : null,
    rating: body.rating,
    feed_target: body.feedTarget,
    pet_name: body.feedTarget === 'pet' ? (body.petName ?? null) : null,
    ingredients_used: body.ingredientsUsed ?? null,
  };
  if (typeof body.cookedAt === 'number') {
    row.cooked_at = new Date(body.cookedAt).toISOString();
  }

  // 4. Insert via Supabase REST (service-role policy `cook_history_service_write`)
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/cook_history`;
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
    return upstreamError('cook_history_insert_failed', 502, detail);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return upstreamError('cook_history_insert_failed', 502, detail, {
      status: res.status,
    });
  }

  let insertedId: string | undefined;
  try {
    const rows = (await res.json()) as Array<{ id?: string }>;
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].id === 'string') {
      insertedId = rows[0].id;
    }
  } catch {
    // empty body — tolerate
  }

  const respBody: CookInsertResponse = insertedId
    ? { inserted: true, id: insertedId }
    : { inserted: true };
  return json(respBody, 201);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function validateEvent(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'bad_body';
  }
  const e = body as Record<string, unknown>;

  if (typeof e.dish !== 'string' || e.dish.trim().length === 0) {
    return 'missing_dish';
  }
  if (e.dish.length > 200) {
    return 'dish_too_long';
  }

  if (typeof e.rating !== 'number' || !ALLOWED_RATINGS.has(e.rating)) {
    return 'invalid_rating';
  }

  if (typeof e.feedTarget !== 'string' || !ALLOWED_TARGETS.has(e.feedTarget as CookFeedTarget)) {
    return 'invalid_feed_target';
  }

  if (e.feedTarget === 'pet') {
    if (typeof e.petName !== 'string' || e.petName.trim().length === 0) {
      return 'pet_target_requires_name';
    }
    if ((e.petName as string).length > 80) {
      return 'pet_name_too_long';
    }
  }

  if (e.cuisine !== undefined && (typeof e.cuisine !== 'string' || e.cuisine.length > 80)) {
    return 'invalid_cuisine';
  }

  if (e.diet !== undefined) {
    if (!Array.isArray(e.diet)) return 'invalid_diet';
    if (e.diet.some((d) => typeof d !== 'string' || d.length > 40)) return 'invalid_diet';
    if (e.diet.length > 8) return 'invalid_diet';
  }

  if (e.ingredientsUsed !== undefined) {
    if (!Array.isArray(e.ingredientsUsed)) return 'invalid_ingredients';
    if (e.ingredientsUsed.length > 50) return 'invalid_ingredients';
    for (const ing of e.ingredientsUsed) {
      if (!ing || typeof ing !== 'object') return 'invalid_ingredients';
      const i = ing as Record<string, unknown>;
      if (typeof i.name !== 'string' || i.name.length === 0 || i.name.length > 80) {
        return 'invalid_ingredients';
      }
      if (i.canonical !== null && typeof i.canonical !== 'string') {
        return 'invalid_ingredients';
      }
    }
  }

  if (e.cookedAt !== undefined) {
    if (typeof e.cookedAt !== 'number' || !Number.isFinite(e.cookedAt)) {
      return 'invalid_cooked_at';
    }
    const now = Date.now();
    if (e.cookedAt < now - TS_MAX_AGE_MS || e.cookedAt > now + TS_MAX_FUTURE_MS) {
      return 'cooked_at_out_of_range';
    }
  }

  return null;
}
