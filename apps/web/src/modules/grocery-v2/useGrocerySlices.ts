/**
 * grocery-v2 · useGrocerySlices — live store bridge
 *
 * Subscribes to the EXISTING `grocery.*` slices (the same keys the live
 * `GroceryModule` reads + writes) and returns them as one `GrocerySlices`
 * object for the v2 selectors. Read-only here; mutations go through
 * `useGroceryActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer (`@ollie/logic/grocery`) is untouched, only the
 * rendering changes. Mirrors admin-v2/useAdminSlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type {
  GroceryShoppingItem,
  GroceryStoredPantryItem,
  GrocerySlices,
} from './selectors';

export function useGrocerySlices(): GrocerySlices {
  const [items] = useStoreSlice<GroceryShoppingItem[]>('grocery', 'items', []);
  const [pantry] = useStoreSlice<GroceryStoredPantryItem[]>(
    'grocery',
    'pantry',
    [],
  );
  const [aliasOverrides] = useStoreSlice<Record<string, string>>(
    'grocery',
    'aliasOverrides',
    {},
  );

  return useMemo<GrocerySlices>(
    () => ({
      items: Array.isArray(items)
        ? items.filter(
            (i): i is GroceryShoppingItem => Boolean(i) && typeof i === 'object',
          )
        : [],
      pantry: Array.isArray(pantry)
        ? pantry.filter(
            (p): p is GroceryStoredPantryItem =>
              Boolean(p) && typeof p === 'object',
          )
        : [],
      aliasOverrides:
        aliasOverrides && typeof aliasOverrides === 'object'
          ? aliasOverrides
          : {},
    }),
    [items, pantry, aliasOverrides],
  );
}
