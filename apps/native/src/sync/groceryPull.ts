/**
 * Grocery pantry sync-down (A6b client side, shadow/dual-write).
 *
 * On app open/focus, pull grocery_pantry rows the server has that the device
 * doesn't (e.g. a dump that arrived via Siri while the app was CLOSED), and
 * merge them into local SQLite. Device-local writes remain the source of truth;
 * this only ADDS/updates rows by name (LWW-ish via the repo's name upsert).
 *
 * Gated by SERVER_APPLY: a no-op unless the env flag is on, so it ships dark.
 */

import { urls } from '../api/workers';

const FLAG = (import.meta.env?.VITE_SERVER_APPLY as string | undefined) === '1';
const CURSOR_KEY = 'ollie.serverApply.groceryPullCursor';

interface PantryPullRow {
  id: string;
  payload: { item?: string; name?: string; action?: string };
  updated_at: string;
  deleted: boolean;
}

/** Pull server pantry rows since the last cursor and merge into local SQLite. */
export async function pullGroceryPantry(getBearer: () => Promise<string | null>): Promise<number> {
  if (!FLAG) return 0;
  let bearer: string | null = null;
  try {
    bearer = await getBearer();
  } catch {
    return 0;
  }
  if (!bearer) return 0;

  const since = localStorage.getItem(CURSOR_KEY);
  const url = new URL(`${urls.aiProxy}/sync/grocery-pantry`);
  if (since) url.searchParams.set('since', since);

  let rows: PantryPullRow[];
  try {
    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as { rows?: PantryPullRow[] };
    rows = body.rows ?? [];
  } catch {
    return 0;
  }
  if (rows.length === 0) return 0;

  const { pantry } = await import('../modules/grocery');
  let merged = 0;
  let newestCursor = since ?? '';
  for (const row of rows) {
    const name = (row.payload.item ?? row.payload.name ?? '').trim();
    // Tombstones (deleted) are skipped in the pilot — the demo path is
    // pantry_add (item appears). Depletion sync is a follow-up.
    if (name && !row.deleted) {
      try {
        await pantry.add({ name });
        merged++;
      } catch {
        /* one bad row shouldn't abort the merge */
      }
    }
    if (row.updated_at > newestCursor) newestCursor = row.updated_at;
  }
  if (newestCursor) localStorage.setItem(CURSOR_KEY, newestCursor);
  return merged;
}
