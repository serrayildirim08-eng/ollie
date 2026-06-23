/**
 * Grocery module · handler unit tests
 *
 * Coverage:
 *   - undo for `pantry_add` removes the pantry row
 *   - composite undo: `pantry_add` WITH price removes BOTH pantry + finance rows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateGrocery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  pantry: {
    add: vi.fn().mockResolvedValue({ id: 'pantry-id', name: 'milk' }),
    use: vi.fn().mockResolvedValue(undefined),
    flagLow: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    refreshPrediction: vi.fn().mockResolvedValue(null),
  },
  shopping: {
    add: vi.fn().mockResolvedValue({ id: 'shop-id', name: 'pasta' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../finance/migrate', () => ({
  migrateFinance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../finance/repo', () => ({
  transactions: {
    add: vi.fn().mockResolvedValue({ id: 'tx-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { pantry, shopping } from './repo';
import { transactions } from '../finance/repo';
import { groceryHandler, splitGroceryList } from './handler';
import type { Fragment } from '../../router/schema';

describe('splitGroceryList', () => {
  it('splits a comma list into items', () => {
    expect(splitGroceryList('rice, tomato paste, olive oil, salt')).toEqual([
      'rice', 'tomato paste', 'olive oil', 'salt',
    ]);
  });
  it('splits on newlines too', () => {
    expect(splitGroceryList('rice\ntomato paste\nsalt')).toEqual(['rice', 'tomato paste', 'salt']);
  });
  it('keeps a single item as one', () => {
    expect(splitGroceryList('frozen fries')).toEqual(['frozen fries']);
  });
  it('does NOT split inside grouped numbers', () => {
    expect(splitGroceryList('$1,500 of steak')).toEqual(['$1,500 of steak']);
    expect(splitGroceryList('1,000 ml milk')).toEqual(['1,000 ml milk']);
  });
  it('drops empty trailing fragments', () => {
    expect(splitGroceryList('milk, eggs,')).toEqual(['milk', 'eggs']);
  });
});

describe('groceryHandler — multi-item itemization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pantry_add list → one pantry.add per item, no finance mirror', async () => {
    const fragment: Fragment = {
      text: 'i have rice, tomato paste, olive oil, salt',
      language: 'en',
      module: 'grocery',
      payload: { module: 'grocery', action: 'pantry_add', item: 'rice, tomato paste, olive oil, salt' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await groceryHandler.apply(fragment);
    expect(vi.mocked(pantry.add)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(pantry.add).mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      'rice', 'tomato paste', 'olive oil', 'salt',
    ]);
    expect(vi.mocked(transactions.add)).not.toHaveBeenCalled();
    expect(result.note).toContain('4 items');
  });

  it('shopping_list_add list → one shopping.add per item', async () => {
    const fragment: Fragment = {
      text: 'buy lettuce, lemons, corn',
      language: 'en',
      module: 'grocery',
      payload: { module: 'grocery', action: 'shopping_list_add', item: 'lettuce, lemons, corn' },
      confidence: 0.9,
      source: 'ai',
    };
    await groceryHandler.apply(fragment);
    expect(vi.mocked(shopping.add)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(shopping.add).mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      'lettuce', 'lemons', 'corn',
    ]);
  });

  it('single item still takes the rich path (pantry_add with price mirrors finance)', async () => {
    const fragment: Fragment = {
      text: 'bought milk for $5',
      language: 'en',
      module: 'grocery',
      payload: {
        module: 'grocery',
        action: 'pantry_add',
        item: 'milk',
        ...({ price: 5, currency: 'USD' } as Record<string, unknown>),
      } as Fragment['payload'],
      confidence: 0.9,
      source: 'ai',
    };
    await groceryHandler.apply(fragment);
    expect(vi.mocked(pantry.add)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transactions.add)).toHaveBeenCalledTimes(1);
  });
});

describe('groceryHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pantry_add (no price): undo removes only the pantry row', async () => {
    const fragment: Fragment = {
      text: 'bought milk',
      language: 'en',
      module: 'grocery',
      payload: { module: 'grocery', action: 'pantry_add', item: 'milk' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await groceryHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(pantry.remove)).toHaveBeenCalledWith('pantry-id');
    expect(vi.mocked(transactions.remove)).not.toHaveBeenCalled();
  });

  it('pantry_add (with price): undo removes BOTH pantry + finance rows', async () => {
    const fragment: Fragment = {
      text: 'bought milk for $5',
      language: 'en',
      module: 'grocery',
      payload: {
        module: 'grocery',
        action: 'pantry_add',
        item: 'milk',
        // price + currency are runtime hints not in the typed payload union
        ...({ price: 5, currency: 'USD' } as Record<string, unknown>),
      } as Fragment['payload'],
      confidence: 0.9,
      source: 'ai',
    };
    const result = await groceryHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(pantry.remove)).toHaveBeenCalledWith('pantry-id');
    expect(vi.mocked(transactions.remove)).toHaveBeenCalledWith('tx-id');
  });
});
