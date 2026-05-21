/**
 * grocery-v2 · useGroceryActions — write bridge
 *
 * The handful of mutations the v2 grocery screens perform, written through
 * the SAME `grocery.items` / `grocery.pantry` / `grocery.aliasOverrides`
 * store keys + row shapes the live `GroceryModule` uses. A thing added,
 * checked off, dropped, or taught through the v2 preview is visible to the
 * live module and vice-versa — they share one grocery store.
 *
 *   - `addParsed` mirrors `GroceryModule.onAdd` — a natural-language line is
 *     parsed (`parseGroceryItem`) and the verb routes it: ADD → a new
 *     `grocery.items` row, BOUGHT → straight into `grocery.pantry`, REMOVE →
 *     the matching open list row is dropped.
 *   - `checkOff` mirrors `GroceryModule.checkOff` — a list row flips checked
 *     and a pantry row lands with an alias-table shelf life.
 *   - `dropItem` mirrors `GroceryModule.removeItem`.
 *   - `addMissing` mirrors `GroceryModule.addMissingIngredients` — the
 *     `feed me` "add the N missing" action.
 *   - `teach` mirrors `GroceryModule.teachConfirm` — an unknown word is
 *     pointed at a canonical staple and the override is remembered.
 *
 * `now` is injected so commits are deterministic + testable.
 */
import { useCallback } from 'react';
import { parseGroceryItem, ALIAS_TABLE } from '@ollie/logic/grocery';
import type { ParsedGroceryItem } from '@ollie/logic/grocery';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import type { GroceryPurchaseEvent } from '@ollie/orchestrator';
import type {
  GroceryShoppingItem,
  GroceryStoredPantryItem,
} from './selectors';
import { itemKey } from './selectors';

const DEFAULT_SHELF_DAYS = 14;

export interface GroceryActions {
  /**
   * Parse a natural-language line and commit it. Returns the resulting
   * intent ('ADD' | 'BOUGHT' | 'REMOVE'), or null when nothing committed.
   */
  addParsed: (raw: string) => 'ADD' | 'BOUGHT' | 'REMOVE' | null;
  /** check a shopping-list row off — it moves into the pantry */
  checkOff: (id: string) => void;
  /** drop a shopping-list row entirely */
  dropItem: (id: string) => void;
  /** add a list of missing ingredient names to the shopping list */
  addMissing: (names: string[]) => void;
  /** remember an unknown word maps to a canonical staple */
  teach: (rawWord: string, canonical: string) => void;
}

export interface UseGroceryActionsOptions {
  /**
   * Optional sink for grocery purchase events. When provided, `checkOff`
   * fires this callback fire-and-forget with source='shop_checked'.
   * Injected by the caller (applyRoute shim) so the hook stays testable
   * without a live worker connection.
   */
  recordGroceryPurchase?: (event: GroceryPurchaseEvent) => void;
}

/** the alias-table shelf life for a canonical name, else the default */
function shelfFor(name: string): number {
  return ALIAS_TABLE[name.toLowerCase()]?.shelfLifeDays ?? DEFAULT_SHELF_DAYS;
}

/** parse a line, swallowing any parser throw into a null result */
function safeParse(text: string): ParsedGroceryItem | null {
  try {
    return parseGroceryItem(text);
  } catch {
    return null;
  }
}

export function useGroceryActions(now: number, opts: UseGroceryActionsOptions = {}): GroceryActions {
  const [items, setItems] = useStoreSlice<GroceryShoppingItem[]>(
    'grocery',
    'items',
    [],
  );
  const [pantry, setPantry] = useStoreSlice<GroceryStoredPantryItem[]>(
    'grocery',
    'pantry',
    [],
  );
  const [aliasOverrides, setAliasOverrides] = useStoreSlice<
    Record<string, string>
  >('grocery', 'aliasOverrides', {});

  const itemList = useCallback(
    () => (Array.isArray(items) ? items : []),
    [items],
  );
  const pantryList = useCallback(
    () => (Array.isArray(pantry) ? pantry : []),
    [pantry],
  );

  const addParsed = useCallback(
    (raw: string): 'ADD' | 'BOUGHT' | 'REMOVE' | null => {
      const text = raw.trim();
      if (!text) return null;

      const parsed = safeParse(text);
      if (!parsed || parsed.intent === 'UNKNOWN') return null;

      const overrideCanon = aliasOverrides?.[text.toLowerCase()];

      if (parsed.intent === 'BOUGHT') {
        const name = overrideCanon ?? parsed.name;
        setPantry([
          ...pantryList(),
          {
            id: mkId('g'),
            name,
            normalizedName: name,
            category: parsed.category,
            boughtTs: now,
            qty: parsed.qty,
            shelfLifeDays: shelfFor(name),
          },
        ]);
        return 'BOUGHT';
      }

      if (parsed.intent === 'REMOVE') {
        const target = (
          overrideCanon ??
          parsed.normalizedName ??
          parsed.name ??
          ''
        )
          .toLowerCase()
          .trim();
        setItems(
          itemList().filter(
            (i) => itemKey(i) !== target || Boolean(i.checked),
          ),
        );
        return 'REMOVE';
      }

      // ADD
      const name = overrideCanon ?? parsed.name;
      setItems([
        ...itemList(),
        {
          id: mkId('g'),
          name,
          normalizedName: parsed.normalizedName ?? overrideCanon ?? undefined,
          category: parsed.category ?? 'other',
          addedTs: now,
          ts: now,
          qty: parsed.qty,
          unit: parsed.unit,
          checked: false,
        },
      ]);
      return 'ADD';
    },
    [aliasOverrides, itemList, pantryList, setItems, setPantry, now],
  );

  const checkOff = useCallback(
    (id: string) => {
      const it = itemList().find((i) => i.id === id);
      if (!it) return;
      const name = String(it.normalizedName ?? it.name ?? 'item');
      // canonical: the AI-resolved canonical from the store item (set when
      // AI routing ran) or fall back to normalizedName / raw name.
      const canonical = String(
        (it as { canonical?: string }).canonical ?? it.normalizedName ?? it.name ?? 'item',
      );
      setItems(itemList().filter((i) => i.id !== id));
      setPantry([
        ...pantryList(),
        {
          id: mkId('g'),
          name,
          normalizedName: name,
          category: it.category ?? 'other',
          boughtTs: now,
          qty: it.qty,
          shelfLifeDays: shelfFor(name),
        },
      ]);
      // Purchase history — fire-and-forget, never throw.
      try {
        opts.recordGroceryPurchase?.({
          canonical,
          qty: it.qty,
          unit: it.unit,
          source: 'shop_checked',
          ts: now,
        });
      } catch { /* fire-and-forget */ }
    },
    [itemList, pantryList, setItems, setPantry, now, opts],
  );

  const dropItem = useCallback(
    (id: string) => {
      setItems(itemList().filter((i) => i.id !== id));
    },
    [itemList, setItems],
  );

  const addMissing = useCallback(
    (names: string[]) => {
      const clean = names
        .map((n) => String(n).trim())
        .filter((n) => n.length > 0);
      if (clean.length === 0) return;
      const additions: GroceryShoppingItem[] = clean.map((n) => ({
        id: mkId('g'),
        name: n,
        normalizedName: n,
        category: 'other',
        addedTs: now,
        ts: now,
        checked: false,
      }));
      setItems([...itemList(), ...additions]);
    },
    [itemList, setItems, now],
  );

  const teach = useCallback(
    (rawWord: string, canonical: string) => {
      const word = rawWord.trim().toLowerCase();
      const canon = canonical.trim();
      if (!word || !canon) return;
      setAliasOverrides({ ...(aliasOverrides ?? {}), [word]: canon });
    },
    [aliasOverrides, setAliasOverrides],
  );

  return { addParsed, checkOff, dropItem, addMissing, teach };
}
