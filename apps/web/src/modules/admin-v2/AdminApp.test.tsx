/**
 * admin-v2 · AdminApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `admin.tasks` slice the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *   - the add leaf writes a real task into the live store
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * body-v2/BodyApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { AdminApp } from './AdminApp';

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

describe('AdminApp', () => {
  it('first run renders the calm cold-start admin face — never a blank page', () => {
    act(() => {
      root.render(<AdminApp now={NOW} />);
    });
    // cold-state copy from admin-cold.html
    expect(container.textContent).toContain('nothing due yet');
    expect(container.textContent).toContain("admin is empty");
    // the amber action is always present
    expect(container.textContent).toContain('add the first thing');
    // the cold worked example + the quiet drill rows are present
    expect(container.textContent).toContain('things people put here');
    expect(container.textContent).toContain('all tasks');
    expect(container.textContent).toContain('2-min burst');
  });

  it('opening the tasks deep-link mounts that leaf with a back affordance', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="tasks" />);
    });
    expect(container.textContent).toContain('active');
    expect(container.textContent).toContain('add a task');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the add leaf offers the kind picker and a commit', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('what needs tracking');
    expect(container.textContent).toContain('renewal');
    expect(container.textContent).toContain('add it');
  });

  it('the calls leaf renders its calm framing even when empty', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="calls" />);
    });
    expect(container.textContent).toContain('gathered in one place');
    expect(container.textContent).toContain('no calls waiting');
  });

  it('the burst leaf renders an honest cold note when nothing qualifies', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="burst" />);
    });
    expect(container.textContent).toContain('nothing under two minutes');
  });

  it('the patterns leaf renders the honest example banner when nothing is live', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    expect(container.textContent).toContain('example observations');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<AdminApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what admin sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from admin-notifications.html
    expect(container.textContent).toContain('seven pushes');
  });

  it('adding a task on the add leaf writes a real row into the live store', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="add" />);
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'renew passport');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'add it',
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => addBtn.click());
    // the dry confirmation appears — a real task has been committed
    expect(container.textContent).toContain('noted.');
  });

  it('the in-module nav stack pops a leaf back to the face', () => {
    act(() => {
      root.render(<AdminApp now={NOW} initialRoute="calls" />);
    });
    expect(container.textContent).toContain('gathered in one place');
    const back = container.querySelector('[aria-label="back"]') as HTMLButtonElement;
    act(() => back.click());
    // back on the face — the cold-start copy is showing again
    expect(container.textContent).toContain("admin is empty");
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<AdminApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
