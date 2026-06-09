/**
 * Grocery module · repository.
 *
 * Thin typed wrapper over the SQLite layer. Repository functions are the
 * ONLY place SQL strings live for grocery — handlers and screens call
 * these and stay query-agnostic.
 *
 * Conventions:
 *   - All `add*` functions upsert by normalised name: a second "add milk"
 *     after the first bumps the quantity instead of producing two rows.
 *   - All times are ms-since-epoch integers (SQLite INTEGER).
 *   - `lowFlag` is stored as 0/1.
 */

import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import { sql } from '../../storage';
import { isCriticalReminderLocal } from './criticalReminder';
import { predictOutAt } from './predict';
import { lookupDays } from './shelfLifeCache';
import {
  normaliseName,
  normaliseUnit,
  type PantryItem,
  type ShoppingItem,
  type Unit,
} from './types';

// Index signature satisfies the sql<T extends ShimRow>() constraint; the
// strongly-typed properties still win in autocomplete + narrowing.
interface PantryRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  added_at: number;
  low_flag: number;
  archived_at_ms: number | null;
  predicted_out_at_ms: number | null;
  remind_me: number;
  pushed_at_ms: number | null;
  [col: string]: unknown;
}

interface ShoppingRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  added_at: number;
  [col: string]: unknown;
}

interface PurchaseLogRow {
  id: string;
  name: string;
  logged_at: number;
  [col: string]: unknown;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── pantry ───────────────────────────────────────────────────────────────

export const pantry = {
  /**
   * Active pantry rows — anything not archived. Archived rows are still
   * in the table (so "bring back" can resurface them) but are excluded
   * from the default UI list + cross-module signals. Most callers want
   * this; reach for `listArchived()` only when rendering the collapsed
   * archived section.
   *
   * Naming kept as `list()` for backward compat with existing callers
   * (the GroceryBox + cadence scanner enumerator). Both already meant
   * "live pantry"; archiving makes the implicit semantics explicit.
   */
  async list(): Promise<PantryItem[]> {
    const rows = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag, archived_at_ms,
              predicted_out_at_ms, remind_me, pushed_at_ms
       FROM grocery_pantry
       WHERE archived_at_ms IS NULL
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToPantryItem);
  },

  /**
   * Aliased name for clarity at call sites where archived-vs-active is
   * load-bearing in the caller's logic. Identical to `list()`.
   */
  async listActive(): Promise<PantryItem[]> {
    return pantry.list();
  },

  /**
   * Archived rows ordered most-recently-archived first. The Pantry tab
   * renders these inside a collapsed section ("n archived"). Empty
   * result means the section doesn't render at all.
   */
  async listArchived(): Promise<PantryItem[]> {
    const rows = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag, archived_at_ms,
              predicted_out_at_ms, remind_me, pushed_at_ms
       FROM grocery_pantry
       WHERE archived_at_ms IS NOT NULL
       ORDER BY archived_at_ms DESC`,
    );
    return rows.map(rowToPantryItem);
  },

  /**
   * Add or bump pantry item. If a row with the same normalised name
   * already exists, the quantity is added on (when both old + new have
   * numeric quantities and matching units) and the timestamp refreshes.
   * Otherwise a new row is inserted.
   *
   * If the matched row was archived, re-adding it clears the archive
   * flag (the user obviously has it again) — this is the "I bought it
   * again" → resurface path. `nowMs` is injectable for tests.
   */
  async add(input: {
    name: string;
    quantity?: number | null;
    unit?: string | null;
    nowMs?: number;
    /**
     * Initial reminder state. Backend's `isCriticalReminder()` is the
     * authority on the default (meds / tampons / contact solution / baby
     * formula / pet meds → true, else false); the handler calls add()
     * with the computed bool. Defaults to false here so direct repo
     * callers (tests, screens) don't accidentally opt the user in.
     */
    remindMe?: boolean;
  }): Promise<PantryItem> {
    const name = normaliseName(input.name);
    const unit = normaliseUnit(input.unit ?? null);
    const quantity = input.quantity ?? null;
    const now = input.nowMs ?? Date.now();
    // Critical-category default: meds / tampons / contact solution / baby
    // formula / pet meds → remind by default; everything else → silent.
    // Caller may override (handler path or test) by passing remindMe
    // explicitly; the explicit value always wins over the default gate.
    const remindMe = input.remindMe ?? isCriticalReminderLocal(name);

    const existing = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag, archived_at_ms,
              predicted_out_at_ms, remind_me, pushed_at_ms
       FROM grocery_pantry WHERE name = ? LIMIT 1`,
      [name],
    );

    if (existing.length > 0) {
      const row = existing[0]!;
      const canMerge =
        row.archived_at_ms == null &&
        row.unit === (unit ?? row.unit) &&
        row.quantity != null &&
        quantity != null;
      const mergedQty = canMerge ? (row.quantity ?? 0) + (quantity ?? 0) : (quantity ?? row.quantity);
      const mergedUnit = unit ?? row.unit;
      // Re-adding doesn't overwrite the user's remind toggle — once they've
      // flipped it we honour it across restocks. Same for predicted_out:
      // clear it on restock because the cadence prediction needs to recompute
      // against the new "out" baseline.
      await sql.execute(
        `UPDATE grocery_pantry
           SET quantity = ?, unit = ?, added_at = ?, low_flag = 0,
               archived_at_ms = NULL,
               predicted_out_at_ms = NULL,
               pushed_at_ms = NULL
         WHERE id = ?`,
        [mergedQty, mergedUnit, now, row.id],
      );
      await logPurchase(name, now);
      return {
        id: row.id,
        name: row.name,
        quantity: mergedQty,
        unit: (mergedUnit as Unit | null) ?? null,
        addedAt: now,
        lowFlag: false,
        archivedAtMs: null,
        predictedOutAtMs: null,
        remindMe: row.remind_me === 1,
        pushedAtMs: null,
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO grocery_pantry
         (id, name, quantity, unit, added_at, low_flag, archived_at_ms,
          predicted_out_at_ms, remind_me, pushed_at_ms)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL)`,
      [id, name, quantity, unit, now, remindMe ? 1 : 0],
    );
    await logPurchase(name, now);
    return {
      id,
      name,
      quantity,
      unit,
      addedAt: now,
      lowFlag: false,
      archivedAtMs: null,
      predictedOutAtMs: null,
      remindMe,
      pushedAtMs: null,
    };
  },

  /**
   * Reset the aging clock on a row — the "yes, still here" reply to a
   * "still here?" prompt. Internally just refreshes `added_at` so the
   * row is treated as fresh again.
   */
  async touch(id: string, nowMs?: number): Promise<void> {
    const ts = nowMs ?? Date.now();
    await sql.execute(
      `UPDATE grocery_pantry
         SET added_at = ?, archived_at_ms = NULL
       WHERE id = ?`,
      [ts, id],
    );
  },

  /**
   * Move a row out of the active list. The row stays in the table so the
   * user can "bring it back" from the archived section — we never lose
   * data here. Auto-archive (≥ shelf × 2.0) and the "gone" reply both
   * call this.
   */
  async archive(id: string, nowMs?: number): Promise<void> {
    const ts = nowMs ?? Date.now();
    await sql.execute(
      `UPDATE grocery_pantry SET archived_at_ms = ? WHERE id = ?`,
      [ts, id],
    );
  },

  /**
   * Bring an archived row back to the active list. Resets the aging
   * clock at the same time — if the user explicitly resurfaces an item
   * they're claiming it's current.
   */
  async unarchive(id: string, nowMs?: number): Promise<void> {
    const ts = nowMs ?? Date.now();
    await sql.execute(
      `UPDATE grocery_pantry
         SET archived_at_ms = NULL, added_at = ?
       WHERE id = ?`,
      [ts, id],
    );
  },

  /**
   * Mark a pantry item as used. Either pass an explicit `delta` quantity
   * or omit it to remove the row entirely (we used it up).
   */
  async use(input: { name: string; delta?: number }): Promise<void> {
    const name = normaliseName(input.name);
    if (input.delta == null) {
      await sql.execute(`DELETE FROM grocery_pantry WHERE name = ?`, [name]);
      return;
    }
    const existing = await sql.select<PantryRow>(
      `SELECT id, quantity FROM grocery_pantry WHERE name = ? LIMIT 1`,
      [name],
    );
    if (existing.length === 0) return;
    const row = existing[0]!;
    if (row.quantity == null) {
      await sql.execute(`DELETE FROM grocery_pantry WHERE id = ?`, [row.id]);
      return;
    }
    const next = row.quantity - input.delta;
    if (next <= 0) {
      await sql.execute(`DELETE FROM grocery_pantry WHERE id = ?`, [row.id]);
    } else {
      await sql.execute(`UPDATE grocery_pantry SET quantity = ? WHERE id = ?`, [next, row.id]);
    }
  },

  /** Mark an item as running low — soft cue, doesn't move to shopping. */
  async flagLow(name: string): Promise<void> {
    const n = normaliseName(name);
    const existing = await sql.select<PantryRow>(
      `SELECT id FROM grocery_pantry WHERE name = ? LIMIT 1`,
      [n],
    );
    if (existing.length === 0) {
      // We've never seen this item — record a flagged placeholder so the
      // user still sees the cue. Quantity null, low_flag true.
      await sql.execute(
        `INSERT INTO grocery_pantry (id, name, quantity, unit, added_at, low_flag, archived_at_ms)
         VALUES (?, ?, NULL, NULL, ?, 1, NULL)`,
        [newId(), n, Date.now()],
      );
      return;
    }
    await sql.execute(
      `UPDATE grocery_pantry SET low_flag = 1 WHERE id = ?`,
      [existing[0]!.id],
    );
  },

  async clearLow(name: string): Promise<void> {
    await sql.execute(
      `UPDATE grocery_pantry SET low_flag = 0 WHERE name = ?`,
      [normaliseName(name)],
    );
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM grocery_pantry WHERE id = ?`, [id]);
  },

  // ─── replenishment (Plan B · 2026-05-30) ────────────────────────────────
  //
  // The UI surface (Shop "≈ likely needed" + per-row remind toggle) reads
  // through these helpers. Backend pod wires the prediction logic + push
  // gate against the same column set; both sides stay query-agnostic.

  /**
   * Toggle the per-row push opt-in. The Pantry tab's `remind` / `silent`
   * smcp text-button calls this; no chrome, no badge — the toggle text IS
   * the indicator. Backend's notifier checks remind_me === 1 + push gate
   * before firing.
   */
  async setRemindMe(id: string, remindMe: boolean): Promise<void> {
    await sql.execute(
      `UPDATE grocery_pantry SET remind_me = ? WHERE id = ?`,
      [remindMe ? 1 : 0, id],
    );
  },

  /**
   * Update the predicted out-of-stock timestamp. The cadence layer (or the
   * backend pod's predictOutAt()) calls this; pass `null` to clear (e.g.
   * when we drop below the low-data threshold again).
   *
   * Setting a new prediction clears `pushed_at_ms` so the push gate gets
   * one fresh shot per prediction window.
   */
  async setPredictedOut(id: string, predictedOutAtMs: number | null): Promise<void> {
    await sql.execute(
      `UPDATE grocery_pantry
         SET predicted_out_at_ms = ?, pushed_at_ms = NULL
       WHERE id = ?`,
      [predictedOutAtMs, id],
    );
  },

  /**
   * Record that we fired the prediction push for this row. The notifier
   * sets `pushed_at_ms = now` on success so the gate doesn't fire twice
   * for the same prediction window.
   */
  async markPushed(id: string, nowMs?: number): Promise<void> {
    const ts = nowMs ?? Date.now();
    await sql.execute(
      `UPDATE grocery_pantry SET pushed_at_ms = ? WHERE id = ?`,
      [ts, id],
    );
  },

  /**
   * User said "still have it" on a Shop "≈ likely needed" row. Bumps the
   * prediction forward by 7 days so the row vanishes from the section
   * until the new prediction date — silent, no acknowledgement.
   *
   * NOTE: backend pod will own the *cadence* bump (its own helper may
   * also lengthen the median interval). This helper just shifts the
   * timestamp so the UI behaviour is correct in isolation; landing the
   * cadence-aware version on top is additive, not breaking.
   */
  async dismissPrediction(id: string, nowMs?: number): Promise<void> {
    const ts = nowMs ?? Date.now();
    const SEVEN_DAYS_MS = 7 * 86_400_000;
    await sql.execute(
      `UPDATE grocery_pantry
         SET predicted_out_at_ms = ?, pushed_at_ms = NULL
       WHERE id = ?`,
      [ts + SEVEN_DAYS_MS, id],
    );
  },

  /**
   * The rows that should appear in Shop as "≈ likely needed":
   *   - have a `predicted_out_at_ms` that has passed
   *   - aren't archived
   *
   * The caller (GroceryBox) filters the result against the active shopping
   * list by canonical name to avoid double-rendering an item that's already
   * on the explicit list. We don't do that JOIN here because the shopping
   * table is small enough to filter in JS, and the test surface stays
   * straightforward (a single source SELECT, dedupe in component land).
   *
   * Sorted by `predicted_out_at_ms ASC` — the one that went predicted-out
   * longest ago lands at the top of the section, matching "the oldest miss
   * is the most likely true positive" intuition.
   */
  async listPredictedOut(nowMs?: number): Promise<PantryItem[]> {
    const now = nowMs ?? Date.now();
    const rows = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag, archived_at_ms,
              predicted_out_at_ms, remind_me, pushed_at_ms
       FROM grocery_pantry
       WHERE archived_at_ms IS NULL
         AND predicted_out_at_ms IS NOT NULL
         AND predicted_out_at_ms <= ?
       ORDER BY predicted_out_at_ms ASC`,
      [now],
    );
    return rows.map(rowToPantryItem);
  },

  /**
   * Recompute + persist `predicted_out_at_ms` for a single pantry row from
   * its replenishment signals. This is the wire that makes the Shop
   * "≈ likely needed" section + the out-of-stock push populate — call it
   * after a purchase is logged (pantry.add) or a use is recorded so the
   * prediction tracks the latest "out" baseline.
   *
   * Signal priority (delegated to predictOutAt, locked 2026-05-30):
   *   1. observed cadence — median interval from grocery_purchase_log
   *      (sampleSize >= 2 → confidence !== 'low-data')
   *   2. static shelf life — lookupDays() from the /shelf-life cache
   *   3. null — neither signal available; the row carries no prediction.
   *
   * We never fabricate: when cadence is low-data AND the shelf-life table
   * has no entry for this canonical, predictOutAt returns null and we clear
   * the column. `lastPurchaseMs` is the row's `added_at` (the upsert refreshes
   * it on every restock, so it is the true "last bought" anchor).
   *
   * `nowMs`/cadence are derived from persisted state, not the wall clock, so
   * this is deterministic for a given DB; tests drive it through pantry.add.
   */
  async refreshPrediction(id: string): Promise<number | null> {
    const rows = await sql.select<PantryRow>(
      `SELECT id, name, added_at FROM grocery_pantry WHERE id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;

    // Observed cadence from the purchase log for this canonical. Only a
    // non-low-data estimate yields a usable cadence interval; below 2
    // samples the median is 0 and we fall through to shelf life.
    const estimate = await cadence.getCadenceFor(row.name);
    const cadenceDays =
      estimate.confidence !== 'low-data' && estimate.medianIntervalMs > 0
        ? estimate.medianIntervalMs / (24 * 60 * 60 * 1000)
        : null;

    // Static shelf life from the loaded reference table (null when the
    // table hasn't loaded yet OR the canonical is unknown — both correct
    // "no static signal" states).
    const shelfLifeDays = lookupDays(row.name);

    const predicted = predictOutAt({
      lastPurchaseMs: row.added_at,
      cadenceDays,
      shelfLifeDays,
    });

    // Persist (null clears) — setPredictedOut also resets pushed_at_ms so
    // the push gate gets a fresh shot for the new prediction window.
    await pantry.setPredictedOut(id, predicted);
    return predicted;
  },
};

// ─── shopping list ────────────────────────────────────────────────────────

export const shopping = {
  async list(): Promise<ShoppingItem[]> {
    const rows = await sql.select<ShoppingRow>(
      `SELECT id, name, quantity, unit, added_at
       FROM grocery_shopping
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToShoppingItem);
  },

  /** Dedupe by name — second "add pasta" just refreshes the timestamp. */
  async add(input: {
    name: string;
    quantity?: number | null;
    unit?: string | null;
  }): Promise<ShoppingItem> {
    const name = normaliseName(input.name);
    const unit = normaliseUnit(input.unit ?? null);
    const quantity = input.quantity ?? null;
    const now = Date.now();

    const existing = await sql.select<ShoppingRow>(
      `SELECT id, name FROM grocery_shopping WHERE name = ? LIMIT 1`,
      [name],
    );
    if (existing.length > 0) {
      const row = existing[0]!;
      await sql.execute(
        `UPDATE grocery_shopping
           SET quantity = ?, unit = ?, added_at = ?
         WHERE id = ?`,
        [quantity, unit, now, row.id],
      );
      return { id: row.id, name: row.name, quantity, unit, addedAt: now };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO grocery_shopping (id, name, quantity, unit, added_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, quantity, unit, now],
    );
    return { id, name, quantity, unit, addedAt: now };
  },

  async remove(id: string): Promise<void> {
    await sql.execute(`DELETE FROM grocery_shopping WHERE id = ?`, [id]);
  },

  async removeByName(name: string): Promise<void> {
    await sql.execute(`DELETE FROM grocery_shopping WHERE name = ?`, [normaliseName(name)]);
  },

  /**
   * Open shopping rows for the cross-module /todo aggregate. The shopping
   * list table is itself "things still to buy" — there is no `purchased`
   * column — so every row is open. Thin alias over `list()` so the
   * cross-module aggregator can read consistently across modules.
   */
  async listOpen(): Promise<ShoppingItem[]> {
    return shopping.list();
  },

  /**
   * Mark a shopping row purchased — semantically the row leaving the
   * shopping list IS the "done" state. Alias for `remove(id)` named for
   * the /todo screen's intent.
   */
  async markPurchased(id: string): Promise<void> {
    await sql.execute(`DELETE FROM grocery_shopping WHERE id = ?`, [id]);
  },
};

// ─── row mappers ──────────────────────────────────────────────────────────

function rowToPantryItem(r: PantryRow): PantryItem {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    unit: (r.unit as Unit | null) ?? null,
    addedAt: r.added_at,
    lowFlag: r.low_flag === 1,
    archivedAtMs: r.archived_at_ms ?? null,
    predictedOutAtMs: r.predicted_out_at_ms ?? null,
    remindMe: r.remind_me === 1,
    pushedAtMs: r.pushed_at_ms ?? null,
  };
}

function rowToShoppingItem(r: ShoppingRow): ShoppingItem {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    unit: (r.unit as Unit | null) ?? null,
    addedAt: r.added_at,
  };
}

// ─── cadence ──────────────────────────────────────────────────────────────
//
// Every time the user restocks a pantry item we append a row to
// `grocery_purchase_log`. The local cadence layer reads that log and
// turns the per-canonical timestamp stream into a CadenceEstimate.
//
// The pantry table can only ever hold the LATEST restock (rows upsert
// by name), so we can't recover cadence from it after the fact. The
// log is the source of truth for "how often do I buy X".

async function logPurchase(name: string, ts: number): Promise<void> {
  await sql.execute(
    `INSERT INTO grocery_purchase_log (id, name, logged_at) VALUES (?, ?, ?)`,
    [newId(), name, ts],
  );
}

// ─── cook history (local cache for the Feed Me view) ─────────────────────
//
// Mirror table for cook events written through the /cook-history worker.
// The cloud row is source of truth for adaptive recipe learning; this local
// table is purely the "made recently" strip cache so the UI can render
// without a round-trip on every mount. Best-effort: a failed `add` here
// just means the strip lags one entry on this device.

export interface CookHistoryEntry {
  id: string;
  recipeName: string;
  ingredients: Array<{ name: string; canonical: string | null }>;
  cookedAtMs: number;
}

interface CookHistoryRow {
  id: string;
  recipe_name: string;
  ingredients: string | null;
  cooked_at_ms: number;
  [col: string]: unknown;
}

function parseIngredientsJson(raw: string | null): CookHistoryEntry['ingredients'] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CookHistoryEntry['ingredients'] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (typeof i.name !== 'string') continue;
      out.push({
        name: i.name,
        canonical: typeof i.canonical === 'string' ? i.canonical : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export const cookHistory = {
  /** Most-recent-first cook entries for the "made recently" strip. */
  async listRecent(limit = 10): Promise<CookHistoryEntry[]> {
    const rows = await sql.select<CookHistoryRow>(
      `SELECT id, recipe_name, ingredients, cooked_at_ms
       FROM grocery_cook_history
       ORDER BY cooked_at_ms DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      recipeName: r.recipe_name,
      ingredients: parseIngredientsJson(r.ingredients),
      cookedAtMs: r.cooked_at_ms,
    }));
  },

  /**
   * Append a cook entry. Called after the /cook-history worker write resolves
   * so the local strip reflects the same event the cloud row records. The
   * caller may pass an explicit `cookedAtMs` (mirrors the request body the
   * worker received); we default to NOW when omitted.
   */
  async add(input: {
    recipeName: string;
    ingredients?: Array<{ name: string; canonical: string | null }>;
    cookedAtMs?: number;
  }): Promise<CookHistoryEntry> {
    const id = newId();
    const cookedAtMs = input.cookedAtMs ?? Date.now();
    const ingredients = input.ingredients ?? [];
    await sql.execute(
      `INSERT INTO grocery_cook_history (id, recipe_name, ingredients, cooked_at_ms)
       VALUES (?, ?, ?, ?)`,
      [id, input.recipeName, JSON.stringify(ingredients), cookedAtMs],
    );
    return {
      id,
      recipeName: input.recipeName,
      ingredients,
      cookedAtMs,
    };
  },
};

export const cadence = {
  /**
   * Cadence estimate for one canonical (e.g. "milk"). Returns a
   * 'low-data' estimate when fewer than 2 restocks have been logged.
   *
   * Caller normalises the name themselves OR passes the raw label —
   * we normalise defensively so screen + handler can both call this.
   */
  async getCadenceFor(canonical: string): Promise<CadenceEstimate> {
    const name = normaliseName(canonical);
    const rows = await sql.select<PurchaseLogRow>(
      `SELECT id, name, logged_at
       FROM grocery_purchase_log
       WHERE name = ?
       ORDER BY logged_at ASC`,
      [name],
    );
    return computeCadence(rows.map((r) => ({ ts: r.logged_at, label: r.name })));
  },
};
