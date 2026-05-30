/**
 * GET /shelf-life/all                — full canonical table + alias map
 * GET /shelf-life/lookup/:item       — single-item resolution (alias-aware)
 *
 * Public reference data. No PII, no auth required. The frontend caches the
 * full table once on app boot (localStorage / KV) so pantry items can be
 * aged locally without duplicating the 720+ entry table inside the bundle.
 *
 * Caching:
 *   - Cache-Control: public, max-age=86400 (24h) on both endpoints.
 *   - Strong ETag = SHA-256(SHELF_LIFE_MAP).slice(0,8) on both endpoints.
 *   - If-None-Match → 304 when the version matches.
 *
 * Auth: none — this is public reference data.
 * Rate limit: applied upstream by index.ts on /shelf-life/lookup only.
 */

import { json } from '@ollie/worker-http';
import {
  SHELF_LIFE_MAP,
  SHELF_LIFE_DETAIL,
  ALIAS_MAP,
  lookupShelfLifeDetail,
  type ShelfLifeEntry,
} from '../modules/grocery.config';

// ─── env ─────────────────────────────────────────────────────────────────────

/**
 * Read-only public endpoint — no env bindings required. Declared as an
 * interface (not `Record<string, never>`) so callers can union it with
 * other env shapes without TypeScript complaining.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ShelfLifeEnv {}

// ─── version (ETag) ──────────────────────────────────────────────────────────

const ENCODER = new TextEncoder();

/**
 * Cached version hash — SHA-256(SHELF_LIFE_MAP) truncated to 8 hex chars.
 * Computed lazily on first request and reused for the lifetime of the
 * worker isolate (the table is `const` at module load).
 */
let cachedVersion: string | null = null;

async function getVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  const buf = await crypto.subtle.digest(
    'SHA-256',
    ENCODER.encode(JSON.stringify(SHELF_LIFE_MAP)),
  );
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  cachedVersion = hex;
  return hex;
}

// ─── headers ─────────────────────────────────────────────────────────────────

function cacheHeaders(version: string): Record<string, string> {
  return {
    'cache-control': 'public, max-age=86400',
    etag: `"${version}"`,
  };
}

/**
 * Match an `If-None-Match` header against our version. Browsers wrap the
 * value in double quotes per RFC 7232; we accept both forms.
 */
function ifNoneMatchHit(req: Request, version: string): boolean {
  const inm = req.headers.get('if-none-match');
  if (!inm) return false;
  const trimmed = inm.trim();
  return trimmed === `"${version}"` || trimmed === version;
}

// ─── /shelf-life/all ─────────────────────────────────────────────────────────

interface ShelfLifeAllResponse {
  items: Record<string, ShelfLifeEntry>;
  aliases: Record<string, string>;
  version: string;
}

export async function handleShelfLifeAll(
  req: Request,
  _env: ShelfLifeEnv,
): Promise<Response> {
  const version = await getVersion();

  if (ifNoneMatchHit(req, version)) {
    return new Response(null, {
      status: 304,
      headers: cacheHeaders(version),
    });
  }

  const body: ShelfLifeAllResponse = {
    items: SHELF_LIFE_DETAIL,
    aliases: ALIAS_MAP,
    version,
  };

  return json(body, 200, cacheHeaders(version));
}

// ─── /shelf-life/lookup/:item ────────────────────────────────────────────────

interface ShelfLifeLookupResponse {
  canonical: string;
  days: number;
  category: string;
  openedDays?: number;
}

/**
 * Normalize a raw path-param item the same way `lookupShelfLifeDetail`
 * expects: decodeURI, trim, lowercase, collapse internal whitespace.
 * Returns null when the result is empty (the caller maps to 404).
 */
function normalizeItem(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding — treat as a miss, not a 500.
    return null;
  }
  const norm = decoded.trim().toLowerCase().replace(/\s+/g, ' ');
  return norm.length === 0 ? null : norm;
}

/**
 * Resolve a normalized item back to its canonical key. Mirrors the resolution
 * inside `lookupShelfLifeDetail` but returns the canonical too (the lookup
 * helper only returns the entry, not which key won).
 */
function resolveCanonical(norm: string): string | null {
  if (SHELF_LIFE_DETAIL[norm]) return norm;
  const alias = ALIAS_MAP[norm];
  if (alias && SHELF_LIFE_DETAIL[alias]) return alias;
  return null;
}

export async function handleShelfLifeLookup(
  req: Request,
  _env: ShelfLifeEnv,
  item: string,
): Promise<Response> {
  const version = await getVersion();
  const headers = cacheHeaders(version);

  const norm = normalizeItem(item);
  if (!norm) {
    return json({ error: 'not_found' }, 404, headers);
  }

  const canonical = resolveCanonical(norm);
  if (!canonical) {
    return json({ error: 'not_found' }, 404, headers);
  }

  const entry = lookupShelfLifeDetail(canonical);
  if (!entry) {
    // Shouldn't happen — resolveCanonical already confirmed presence — but
    // belt-and-suspenders so the response stays well-typed.
    return json({ error: 'not_found' }, 404, headers);
  }

  if (ifNoneMatchHit(req, version)) {
    return new Response(null, { status: 304, headers });
  }

  const body: ShelfLifeLookupResponse = {
    canonical,
    days: entry.days,
    category: entry.category,
    ...(typeof entry.openedDays === 'number' ? { openedDays: entry.openedDays } : {}),
  };

  return json(body, 200, headers);
}
