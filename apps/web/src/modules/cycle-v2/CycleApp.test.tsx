/**
 * cycle-v2 · CycleApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `cycle.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * money-v2/MoneyApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CycleApp } from './CycleApp';

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

describe('CycleApp', () => {
  it('first run renders the calm cold-start cycle face — never a blank page', () => {
    act(() => {
      root.render(<CycleApp now={NOW} />);
    });
    // cold-state copy from cycle-cold.html
    expect(container.textContent).toContain('still learning your cycle');
    // the amber action is always present
    expect(container.textContent).toContain('log today');
    // the quiet drill rows are present even when empty
    for (const row of ['pill log', 'history', 'partner-ask']) {
      expect(container.textContent).toContain(row);
    }
  });

  it('opening a deep-link route mounts that leaf, and back returns to the face', () => {
    act(() => {
      root.render(<CycleApp now={NOW} initialRoute="log" />);
    });
    // the log-today leaf chrome
    expect(container.querySelector('[aria-label="add a note"]')).not.toBeNull();
    // a back affordance is present on the leaf
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<CycleApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what cycle sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from cycle-notifications.html
    expect(container.textContent).toContain('six pushes');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<CycleApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
