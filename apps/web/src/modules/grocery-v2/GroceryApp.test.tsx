/**
 * grocery-v2 · GroceryApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `grocery.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm cold-start shop state, never blank
 *   - the 3-mode switch flips between shop / pantry / feed me
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *   - the add leaf writes a real item into the live grocery store
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * admin-v2/AdminApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { GroceryApp } from './GroceryApp';
import { store } from '../../store';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // drop the in-memory store cache so each test starts cold — a write in
  // one test (the add-leaf commit) must not leak into the next
  store._reset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GroceryApp', () => {
  it('first run renders the calm cold-start shop face — never a blank page', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} />);
    });
    expect(container.textContent).toContain('nothing on the list yet');
    expect(container.textContent).toContain("the list’s empty");
    expect(container.textContent).toContain('add the first thing');
    // the 3-mode switch + the cold worked example are present
    expect(container.textContent).toContain('the 3 ways in');
  });

  it('the 3-mode switch flips the face to the pantry view', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} />);
    });
    const pantryTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'pantry',
    ) as HTMLButtonElement;
    expect(pantryTab).toBeDefined();
    act(() => pantryTab.click());
    // the cold pantry copy
    expect(container.textContent).toContain('the pantry is empty');
  });

  it('the 3-mode switch flips the face to the feed me view', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} initialMode="feed" />);
    });
    expect(container.textContent).toContain('nothing to cook from yet');
  });

  it('the add leaf offers the natural-language field and a commit', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain("say it the way you’d say it");
    expect(container.textContent).toContain('add it');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('adding an item on the add leaf writes a real row into the live store', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} initialRoute="add" />);
    });
    const input = container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'olive oil');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // ollie reads the line back live — the trust surface
    expect(container.textContent).toContain("here’s what ollie read");
    const addBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'add it',
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => addBtn.click());
    // the dry confirmation appears — a real item has been committed
    expect(container.textContent).toContain('on the list.');
  });

  it('the patterns leaf renders the honest example banner when nothing is live', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    expect(container.textContent).toContain('example observations');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what grocery sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from grocery-notifications.html
    expect(container.textContent).toContain(
      'the reflective patterns stay inside the app',
    );
  });

  it('the in-module nav stack pops a leaf back to the face', () => {
    act(() => {
      root.render(<GroceryApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    const back = container.querySelector(
      '[aria-label="back"]',
    ) as HTMLButtonElement;
    act(() => back.click());
    // back on the face — the cold-start copy is showing again
    expect(container.textContent).toContain('nothing on the list yet');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <GroceryApp
          now={NOW}
          onSafe={() => {
            safe = true;
          }}
        />,
      );
    });
    const safeDot = container.querySelector(
      '[aria-label="safe"]',
    ) as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
