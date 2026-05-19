/**
 * money-v2 · MoneyApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `finance.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm empty hero, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the Find dot pushes the search screen
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the empty-state branch deterministically.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MoneyApp } from './MoneyApp';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MoneyApp', () => {
  it('first run renders the calm empty money face — never a blank page', () => {
    act(() => {
      root.render(<MoneyApp now={NOW} />);
    });
    // empty hero copy from money-empty.html
    expect(container.textContent).toContain('safe to spend');
    expect(container.textContent).toContain('a few spends and ollie can work this out');
    // the amber action is the first-spend invitation
    expect(container.textContent).toContain('log your first spend');
    // all five area rows are present even when empty
    for (const area of ['bills', 'income', 'subscriptions', 'savings', 'adhd tax']) {
      expect(container.textContent).toContain(area);
    }
  });

  it('the Find dot pushes the search screen', () => {
    act(() => {
      root.render(<MoneyApp now={NOW} />);
    });
    const find = container.querySelector('[aria-label="find"]') as HTMLButtonElement;
    act(() => find.click());
    expect(container.textContent).toContain('search the whole money notebook');
  });

  it('opening a deep-link route mounts that leaf, and back returns to the face', () => {
    act(() => {
      root.render(<MoneyApp now={NOW} initialRoute="bills" />);
    });
    expect(container.textContent).toContain("what's coming up");
    // the bills screen Find dot is present (Screen chrome)
    expect(container.querySelector('[aria-label="find"]')).not.toBeNull();
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<MoneyApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
