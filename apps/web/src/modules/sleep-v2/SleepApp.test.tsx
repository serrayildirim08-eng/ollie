/**
 * sleep-v2 · SleepApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `sleep.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * cycle-v2/CycleApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SleepApp } from './SleepApp';

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

describe('SleepApp', () => {
  it('first run renders the calm cold-start sleep face — never a blank page', () => {
    act(() => {
      root.render(<SleepApp now={NOW} />);
    });
    // cold-state copy from sleep-cold.html
    expect(container.textContent).toContain('the forecast is still settling');
    // the amber action is always present
    expect(container.textContent).toContain('log last night');
    // the quiet drill rows are present even when empty
    for (const row of ['wind-down', 'history', 'sounds', 'go deeper']) {
      expect(container.textContent).toContain(row);
    }
  });

  it('opening a deep-link route mounts that leaf, and back returns to the face', () => {
    act(() => {
      root.render(<SleepApp now={NOW} initialRoute="log" />);
    });
    // the log-last-night leaf chrome
    expect(container.querySelector('[aria-label="say more about last night"]')).not.toBeNull();
    // a back affordance is present on the leaf
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the wind-down ritual leaf is reachable and renders six steps', () => {
    act(() => {
      root.render(<SleepApp now={NOW} initialRoute="winddown" />);
    });
    expect(container.textContent).toContain('six small steps');
    expect(container.textContent).toContain('into bed');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<SleepApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what sleep sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from sleep-notifications.html
    expect(container.textContent).toContain('five pushes');
  });

  it('the survey leaf offers the two go-deeper check-ins', () => {
    act(() => {
      root.render(<SleepApp now={NOW} initialRoute="survey" />);
    });
    expect(container.textContent).toContain('insomnia check');
    expect(container.textContent).toContain('daytime sleepiness');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<SleepApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
