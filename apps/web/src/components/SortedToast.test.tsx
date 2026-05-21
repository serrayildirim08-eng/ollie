/**
 * SortedToast · layout selection + 9-fixture smoke render.
 *
 * Each fixture from `groceryRoutingMock` is rendered inline (no portal)
 * so we can assert layout + accessibility surface. The full event-bus
 * dance is tested in useGroceryRouting.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SortedToast } from './SortedToast';
import { GROCERY_ROUTING_FIXTURES, FIXTURE_KEYS } from '../devtools/groceryRoutingMock';
import type { GroceryRoutingResult } from '../hooks/useGroceryRouting';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function resultFromFixture(key: string): GroceryRoutingResult {
  const f = GROCERY_ROUTING_FIXTURES[key];
  return {
    idempotency_key: 'test_' + key,
    raw: f.raw,
    items: f.items,
    source: f.source,
    latency_ms: f.latencyMs,
    ts: Date.now(),
    ...(f.error !== undefined ? { error: f.error } : {}),
  };
}

function mount(node: React.ReactNode) {
  const container = document.createElement('div');
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    unmount() {
      act(() => root?.unmount());
    },
  };
}

describe('SortedToast · layout selection', () => {
  it('single item → layout=single', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('single')} ttl={0} inline />,
    );
    const el = container.querySelector('[data-grocery-sorted-toast]');
    expect(el?.getAttribute('data-layout')).toBe('single');
    unmount();
  });

  it('2 same-target items → layout=short', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('duo')} ttl={0} inline />,
    );
    expect(
      container.querySelector('[data-grocery-sorted-toast]')?.getAttribute('data-layout'),
    ).toBe('short');
    unmount();
  });

  it('3+ same-target → layout=bulk', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('bulk')} ttl={0} inline />,
    );
    expect(
      container.querySelector('[data-grocery-sorted-toast]')?.getAttribute('data-layout'),
    ).toBe('bulk');
    unmount();
  });

  it('mixed pantry+shopping → layout=split (DEFAULT per spec)', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('mixed_pantry_shop')} ttl={0} inline />,
    );
    expect(
      container.querySelector('[data-grocery-sorted-toast]')?.getAttribute('data-layout'),
    ).toBe('split');
    unmount();
  });

  it('recipe expansion with mixed targets → split', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('recipe_split')} ttl={0} inline />,
    );
    expect(
      container.querySelector('[data-grocery-sorted-toast]')?.getAttribute('data-layout'),
    ).toBe('split');
    // recipe parent name should appear
    expect(container.textContent).toContain('spaghetti bolognese');
    unmount();
  });

  it('fallback source surfaces "offline sort" caption', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('fallback')} ttl={0} inline />,
    );
    expect(container.textContent?.toLowerCase()).toContain('offline');
    unmount();
  });

  it('error string surfaces "ai unavailable" caption', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('error')} ttl={0} inline />,
    );
    expect(container.textContent?.toLowerCase()).toContain('ai unavailable');
    unmount();
  });

  it('onUndo button surfaces only when handler is provided', () => {
    const noUndo = mount(
      <SortedToast result={resultFromFixture('single')} ttl={0} inline />,
    );
    expect(noUndo.container.querySelector('button')).toBeNull();
    noUndo.unmount();

    const withUndo = mount(
      <SortedToast
        result={resultFromFixture('single')}
        onUndo={() => {}}
        ttl={0}
        inline
      />,
    );
    expect(withUndo.container.querySelector('button')).not.toBeNull();
    withUndo.unmount();
  });

  it('role=status + aria-live=polite for SR announcement', () => {
    const { container, unmount } = mount(
      <SortedToast result={resultFromFixture('single')} ttl={0} inline />,
    );
    const el = container.querySelector('[data-grocery-sorted-toast]');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
    unmount();
  });
});

describe('SortedToast · 9-fixture smoke render', () => {
  for (const key of FIXTURE_KEYS) {
    it(`renders fixture "${key}" without throwing`, () => {
      const { container, unmount } = mount(
        <SortedToast result={resultFromFixture(key)} ttl={0} inline />,
      );
      const el = container.querySelector('[data-grocery-sorted-toast]');
      expect(el).not.toBeNull();
      unmount();
    });
  }
});
