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

// ─── Mutation mode tests ──────────────────────────────────────────────────────

const NOOP_RESULT: GroceryRoutingResult = {
  idempotency_key: 'noop',
  raw: '',
  items: [],
  source: 'cache',
  latency_ms: 0,
  ts: 0,
};

describe('SortedToast · mutation modes', () => {
  it('mode=removed renders × icon + correct copy', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="removed"
        itemName="pasta"
        slice="shopping"
        ttl={0}
        inline
      />,
    );
    const el = container.querySelector('[data-grocery-sorted-toast]');
    expect(el?.getAttribute('data-mode')).toBe('removed');
    // SVG cross is present (aria-hidden, so check container for the svg)
    expect(container.querySelector('svg')).not.toBeNull();
    // Copy
    expect(container.textContent).toContain('removed');
    expect(container.textContent).toContain('pasta');
    expect(container.textContent).toContain('shopping');
    unmount();
  });

  it('mode=moved renders arrow icon + "moved: X pantry"', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="moved"
        itemName="olive oil"
        ttl={0}
        inline
      />,
    );
    expect(container.querySelector('[data-mode="moved"]')).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('moved');
    expect(container.textContent).toContain('olive oil');
    expect(container.textContent?.toLowerCase()).toContain('pantry');
    unmount();
  });

  it('mode=checked singular: "checked: 1 item off shop"', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="checked"
        itemCount={1}
        ttl={0}
        inline
      />,
    );
    expect(container.textContent).toContain('1 item off shop');
    // must NOT say "items" (plural)
    expect(container.textContent).not.toContain('1 items');
    unmount();
  });

  it('mode=checked plural: "checked: 3 items off shop"', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="checked"
        itemCount={3}
        ttl={0}
        inline
      />,
    );
    expect(container.textContent).toContain('3 items off shop');
    unmount();
  });

  it('mode=undone renders undo icon + description copy', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="undone"
        description="removed: pasta from shopping"
        ttl={0}
        inline
      />,
    );
    expect(container.querySelector('[data-mode="undone"]')).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('undone');
    expect(container.textContent).toContain('removed: pasta from shopping');
    unmount();
  });

  it('mode=sorted (default) — backward compat: existing routing layout', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={resultFromFixture('single')}
        mode="sorted"
        ttl={0}
        inline
      />,
    );
    // routing layout data-layout should be set; data-mode='sorted'
    expect(container.querySelector('[data-mode="sorted"]')).not.toBeNull();
    expect(container.querySelector('[data-layout="single"]')).not.toBeNull();
    unmount();
  });

  it('prefers-reduced-motion: no entrance animation class (inline mode always static)', () => {
    // inline=true means no portal, position=relative — animation does not run.
    // The @media rule is in the style tag; assert it exists in the DOM.
    const { container, unmount } = mount(
      <SortedToast result={NOOP_RESULT} mode="removed" itemName="milk" ttl={0} inline />,
    );
    const styleEl = container.querySelector('style');
    expect(styleEl?.textContent).toContain('prefers-reduced-motion');
    unmount();
  });

  it('aria-label for mode=removed is descriptive', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="removed"
        itemName="eggs"
        slice="shopping"
        ttl={0}
        inline
      />,
    );
    const el = container.querySelector('[data-grocery-sorted-toast]');
    const label = el?.getAttribute('aria-label') ?? '';
    expect(label.toLowerCase()).toContain('eggs');
    expect(label.toLowerCase()).toContain('shopping');
    unmount();
  });

  it('aria-label for mode=moved is descriptive', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="moved"
        itemName="butter"
        ttl={0}
        inline
      />,
    );
    const el = container.querySelector('[data-grocery-sorted-toast]');
    expect(el?.getAttribute('aria-label')?.toLowerCase()).toContain('butter');
    expect(el?.getAttribute('aria-label')?.toLowerCase()).toContain('pantry');
    unmount();
  });

  it('aria-label for mode=checked uses singular/plural correctly', () => {
    const { container: c1, unmount: u1 } = mount(
      <SortedToast result={NOOP_RESULT} mode="checked" itemCount={1} ttl={0} inline />,
    );
    expect(c1.querySelector('[data-grocery-sorted-toast]')?.getAttribute('aria-label')).toContain('1 item');
    u1();

    const { container: c2, unmount: u2 } = mount(
      <SortedToast result={NOOP_RESULT} mode="checked" itemCount={5} ttl={0} inline />,
    );
    expect(c2.querySelector('[data-grocery-sorted-toast]')?.getAttribute('aria-label')).toContain('5 items');
    u2();
  });

  it('aria-label for mode=undone includes description', () => {
    const { container, unmount } = mount(
      <SortedToast
        result={NOOP_RESULT}
        mode="undone"
        description="removed: pasta"
        ttl={0}
        inline
      />,
    );
    expect(
      container.querySelector('[data-grocery-sorted-toast]')?.getAttribute('aria-label'),
    ).toContain('removed: pasta');
    unmount();
  });
});
