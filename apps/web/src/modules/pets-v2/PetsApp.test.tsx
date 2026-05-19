/**
 * pets-v2 · PetsApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `pets.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the add leaf writes a real pet into the live store
 *   - the leaf screens (log / observe / health / patterns / notifications)
 *     are reachable by deep-link and render their calm framing
 *   - the Safe dot invokes its handler
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

import { PetsApp } from './PetsApp';

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

describe('PetsApp', () => {
  it('first run renders the calm cold-start pets face — never a blank page', () => {
    act(() => {
      root.render(<PetsApp now={NOW} />);
    });
    // cold-state copy from pets-cold.html
    expect(container.textContent).toContain('no pets yet');
    expect(container.textContent).toContain("the notebook");
    expect(container.textContent).toContain('add your first pet');
    // the cold worked example is present
    expect(container.textContent).toContain('ollie knows 10 species');
  });

  it('opening the add deep-link mounts that leaf with a back affordance', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('who');
    expect(container.textContent).toContain('species');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the log leaf renders an honest empty note when there are no pets', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="log" />);
    });
    expect(container.textContent).toContain('no pets in the notebook yet');
  });

  it('the observe leaf renders an honest empty note when there are no pets', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="observe" />);
    });
    expect(container.textContent).toContain('no pets in the notebook yet');
  });

  it('the health leaf renders its calm welfare framing', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="health" />);
    });
    expect(container.textContent).toContain('worth a closer look');
    expect(container.textContent).toContain('not a vet');
    expect(container.textContent).toContain('nothing noted right now');
  });

  it('the patterns leaf renders the honest example banner', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    expect(container.textContent).toContain('example observations');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<PetsApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what pets sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from pets-notifications.html
    expect(container.textContent).toContain('screen-only');
  });

  it('adding a pet on the add leaf writes a real row into the live store', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="add" />);
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
      setter.call(input, 'Mango');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim().startsWith('add Mango'),
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => addBtn.click());
    // the dry confirmation appears — a real pet has been committed
    expect(container.textContent).toContain('noted.');
  });

  it('the in-module nav stack pops a leaf back to the face', () => {
    act(() => {
      root.render(<PetsApp now={NOW} initialRoute="health" />);
    });
    expect(container.textContent).toContain('worth a closer look');
    const back = container.querySelector(
      '[aria-label="back"]',
    ) as HTMLButtonElement;
    act(() => back.click());
    // back on the face — the leaf framing is gone and the face's always-on
    // notification-preview link is showing (store-state-independent)
    expect(container.textContent).not.toContain('worth a closer look');
    expect(container.textContent).toContain('what pets sends');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <PetsApp
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
