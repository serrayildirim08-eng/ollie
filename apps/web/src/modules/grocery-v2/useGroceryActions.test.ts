/**
 * grocery-v2 · useGroceryActions — purchase history callback tests
 *
 * Exercises the recordGroceryPurchase callback injected via opts. Follows the
 * codebase's existing test pattern (createRoot + act — no RTL dep). We mount a
 * thin harness component that exposes the hook's actions to the test via a
 * module-level ref so we can call them imperatively.
 */
import { act, createElement, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { GroceryPurchaseEvent } from '@ollie/orchestrator';
import { useGroceryActions, type GroceryActions } from './useGroceryActions';
import { store } from '../../store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = new Date('2026-05-22T10:00:00Z').getTime();

// Module-level ref so the test can call actions after mount.
let capturedActions: GroceryActions | null = null;

function HookHarness({
  recordGroceryPurchase,
}: {
  recordGroceryPurchase?: (e: GroceryPurchaseEvent) => void;
}) {
  const actions = useGroceryActions(NOW, { recordGroceryPurchase });
  // expose to test via module ref
  useEffect(() => { capturedActions = actions; });
  return null;
}

const ITEM_WITH_CANONICAL = {
  id: 'g_test_1',
  name: 'milk',
  normalizedName: 'milk',
  canonical: 'milk',
  category: 'dairy',
  checked: false,
  addedTs: NOW - 1000,
  ts: NOW - 1000,
  qty: 2,
  unit: 'l',
};

const ITEM_NO_CANONICAL = {
  id: 'g_test_2',
  name: 'olive oil',
  normalizedName: 'olive oil',
  category: 'pantry',
  checked: false,
  addedTs: NOW - 2000,
  ts: NOW - 2000,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  capturedActions = null;
  store._reset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useGroceryActions · checkOff fires recordGroceryPurchase', () => {
  it('checkOff with canonical item fires shop_checked event with canonical field', () => {
    store.set('grocery', 'items', [ITEM_WITH_CANONICAL]);
    store.set('grocery', 'pantry', []);

    const recorded: GroceryPurchaseEvent[] = [];
    const recordGroceryPurchase = (e: GroceryPurchaseEvent) => recorded.push(e);

    act(() => {
      root.render(createElement(HookHarness, { recordGroceryPurchase }));
    });

    expect(capturedActions).not.toBeNull();
    act(() => {
      capturedActions!.checkOff('g_test_1');
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].source).toBe('shop_checked');
    expect(recorded[0].canonical).toBe('milk');
    expect(recorded[0].qty).toBe(2);
    expect(recorded[0].unit).toBe('l');
    expect(recorded[0].ts).toBe(NOW);
  });

  it('checkOff with no canonical falls back to normalizedName', () => {
    store.set('grocery', 'items', [ITEM_NO_CANONICAL]);
    store.set('grocery', 'pantry', []);

    const recorded: GroceryPurchaseEvent[] = [];
    const recordGroceryPurchase = (e: GroceryPurchaseEvent) => recorded.push(e);

    act(() => {
      root.render(createElement(HookHarness, { recordGroceryPurchase }));
    });

    act(() => {
      capturedActions!.checkOff('g_test_2');
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].canonical).toBe('olive oil');
    expect(recorded[0].source).toBe('shop_checked');
  });

  it('checkOff without opts never throws', () => {
    store.set('grocery', 'items', [ITEM_WITH_CANONICAL]);
    store.set('grocery', 'pantry', []);

    act(() => {
      root.render(createElement(HookHarness, {}));
    });

    expect(() => {
      act(() => {
        capturedActions!.checkOff('g_test_1');
      });
    }).not.toThrow();
  });

  it('checkOff with unknown id fires no event (item not found)', () => {
    store.set('grocery', 'items', []);
    store.set('grocery', 'pantry', []);

    const recorded: GroceryPurchaseEvent[] = [];
    const recordGroceryPurchase = (e: GroceryPurchaseEvent) => recorded.push(e);

    act(() => {
      root.render(createElement(HookHarness, { recordGroceryPurchase }));
    });

    act(() => {
      capturedActions!.checkOff('nonexistent_id');
    });

    expect(recorded).toHaveLength(0);
  });

  it('callback that throws does not propagate (fire-and-forget)', () => {
    store.set('grocery', 'items', [ITEM_WITH_CANONICAL]);
    store.set('grocery', 'pantry', []);

    const badCallback = vi.fn().mockImplementation(() => {
      throw new Error('sink exploded');
    });

    act(() => {
      root.render(
        createElement(HookHarness, { recordGroceryPurchase: badCallback }),
      );
    });

    expect(() => {
      act(() => {
        capturedActions!.checkOff('g_test_1');
      });
    }).not.toThrow();

    expect(badCallback).toHaveBeenCalledOnce();
  });
});
