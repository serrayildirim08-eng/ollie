/**
 * Grocery · shelf-life table cache.
 *
 * Loads the 721-item shelf-life reference table from `/shelf-life/all` once
 * per app boot, persists it in the app-level KV (Tauri store / localStorage),
 * and exposes a synchronous `lookupDays(name)` helper for the pantry aging
 * surface. ETag-aware: on every load we send `If-None-Match` and short-circuit
 * on 304.
 *
 * Surface:
 *   - `loadShelfLifeTable()` — idempotent. First call hydrates from KV +
 *     fires a background refresh. Subsequent calls return the in-memory
 *     table. Never throws; returns an empty table on network failure so
 *     the UI degrades gracefully (every item reads as 'fresh').
 *   - `lookupDays(name)` — synchronous after `loadShelfLifeTable()` has
 *     resolved at least once. Returns `null` for unknown items.
 *
 * Empty-table degradation is correct behaviour, not a bug: until the
 * backend pod's endpoint ships, the UI shows the pantry with no aging,
 * which is identical to today.
 */

import { getShelfLifeAll } from '../../api/workers';
import type { ShelfLifeEntry } from '../../api/types';
import { kv } from '../../storage';

// v2: the table now stores rich entries ({ days, category }) instead of a flat
// number map. Bumping the key drops any v1 disk cache (wrong shape) so the
// first boot refetches cleanly.
const TABLE_KEY = 'ollie:shelflife:v2';
const ETAG_KEY = 'ollie:shelflife:etag';

/** What we keep in memory + on disk. */
export interface ShelfLifeTable {
  items: Record<string, ShelfLifeEntry>;
  aliases: Record<string, string>;
  version: number;
}

const EMPTY_TABLE: ShelfLifeTable = { items: {}, aliases: {}, version: 0 };

// In-memory cache. Module-level so every caller sees the same table.
let memo: ShelfLifeTable | null = null;
let hydratePromise: Promise<ShelfLifeTable> | null = null;

/**
 * Hydrate from KV if available, then fire-and-forget a network refresh.
 * Idempotent: concurrent callers share the same promise; subsequent
 * callers after first resolution return the memo synchronously-via-Promise.
 */
export function loadShelfLifeTable(): Promise<ShelfLifeTable> {
  if (memo) return Promise.resolve(memo);
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    // 1. Hydrate from disk first — the network refresh happens in the
    //    background and shouldn't block first paint.
    const fromDisk = await kv.get<ShelfLifeTable>(TABLE_KEY).catch(() => null);
    if (fromDisk && isShelfLifeTable(fromDisk)) {
      memo = fromDisk;
    } else {
      memo = EMPTY_TABLE;
    }

    // 2. Kick the refresh. We don't await it — the caller already has
    //    a usable table from disk (or empty). Background refresh updates
    //    the memo + disk so the next read sees fresh data.
    void refresh();

    return memo;
  })();

  return hydratePromise;
}

/**
 * Force-refresh the table from the worker. Used on app boot after the
 * disk hydrate, and exposed for tests. Errors are swallowed — degrading
 * to the existing memo is the right behaviour.
 */
export async function refresh(): Promise<void> {
  const etag = await kv.get<string>(ETAG_KEY).catch(() => null);
  const result = await getShelfLifeAll({ ifNoneMatch: etag ?? undefined });
  if (!result.ok) return; // network/timeout/http err → keep existing memo
  if (result.status === 304) {
    // Server says our cached version is current. Persist any rotated
    // etag the worker may have sent (rare but cheap).
    if (result.etag && result.etag !== etag) {
      await kv.set(ETAG_KEY, result.etag).catch(() => undefined);
    }
    return;
  }
  // 200 — replace memo + disk.
  const next: ShelfLifeTable = {
    items: result.data.items,
    aliases: result.data.aliases,
    version: result.data.version,
  };
  memo = next;
  await kv.set(TABLE_KEY, next).catch(() => undefined);
  if (result.etag) {
    await kv.set(ETAG_KEY, result.etag).catch(() => undefined);
  }
}

/**
 * Synchronous lookup. Returns `null` if:
 *   - the table hasn't been loaded yet (caller should `loadShelfLifeTable()`
 *     on app boot — the pantry surface treats null as "no aging")
 *   - the item is unknown after alias resolution
 *
 * Names are normalised (lowercase + trim) before lookup so `"Whole Milk"`
 * and `"  whole milk "` resolve identically.
 */
export function lookupDays(rawName: string): number | null {
  const entry = resolveEntry(rawName);
  return entry ? entry.days : null;
}

/**
 * Synchronous category lookup — the pantry aisle grouping reads this. Returns
 * the worker ShelfCategory string (e.g. "dairy", "personal_care") or `null`
 * when the table hasn't loaded or the item is unknown (the aisle categoriser
 * then falls back to its keyword map).
 */
export function lookupCategory(rawName: string): string | null {
  const entry = resolveEntry(rawName);
  return entry ? entry.category : null;
}

/** Resolve a raw name to its rich entry: direct canonical hit, else alias. */
function resolveEntry(rawName: string): ShelfLifeEntry | null {
  if (!memo) return null;
  const key = normalise(rawName);
  if (!key) return null;
  const direct = memo.items[key];
  if (direct) return direct;
  const canonical = memo.aliases[key];
  if (canonical) {
    const aliased = memo.items[canonical];
    if (aliased) return aliased;
  }
  return null;
}

/** Test-only escape hatch. NEVER call from production code. */
export function __resetForTests(): void {
  memo = null;
  hydratePromise = null;
}

function normalise(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

function isShelfLifeTable(x: unknown): x is ShelfLifeTable {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.items === 'object' &&
    obj.items !== null &&
    typeof obj.aliases === 'object' &&
    obj.aliases !== null &&
    typeof obj.version === 'number'
  );
}
