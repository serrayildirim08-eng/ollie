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
  async list(): Promise<PantryItem[]> {
    const rows = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag
       FROM grocery_pantry
       ORDER BY added_at DESC`,
    );
    return rows.map(rowToPantryItem);
  },

  /**
   * Add or bump pantry item. If a row with the same normalised name
   * already exists, the quantity is added on (when both old + new have
   * numeric quantities and matching units) and the timestamp refreshes.
   * Otherwise a new row is inserted.
   */
  async add(input: {
    name: string;
    quantity?: number | null;
    unit?: string | null;
  }): Promise<PantryItem> {
    const name = normaliseName(input.name);
    const unit = normaliseUnit(input.unit ?? null);
    const quantity = input.quantity ?? null;
    const now = Date.now();

    const existing = await sql.select<PantryRow>(
      `SELECT id, name, quantity, unit, added_at, low_flag
       FROM grocery_pantry WHERE name = ? LIMIT 1`,
      [name],
    );

    if (existing.length > 0) {
      const row = existing[0]!;
      const canMerge =
        row.unit === (unit ?? row.unit) &&
        row.quantity != null &&
        quantity != null;
      const mergedQty = canMerge ? (row.quantity ?? 0) + (quantity ?? 0) : (quantity ?? row.quantity);
      const mergedUnit = unit ?? row.unit;
      await sql.execute(
        `UPDATE grocery_pantry
           SET quantity = ?, unit = ?, added_at = ?, low_flag = 0
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
      };
    }

    const id = newId();
    await sql.execute(
      `INSERT INTO grocery_pantry (id, name, quantity, unit, added_at, low_flag)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [id, name, quantity, unit, now],
    );
    await logPurchase(name, now);
    return { id, name, quantity, unit, addedAt: now, lowFlag: false };
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
        `INSERT INTO grocery_pantry (id, name, quantity, unit, added_at, low_flag)
         VALUES (?, ?, NULL, NULL, ?, 1)`,
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
