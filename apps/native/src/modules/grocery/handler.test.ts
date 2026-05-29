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

import { pantry } from './repo';
import { transactions } from '../finance/repo';
import { groceryHandler } from './handler';
import type { Fragment } from '../../router/schema';

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
