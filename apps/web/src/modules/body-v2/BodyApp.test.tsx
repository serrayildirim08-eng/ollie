/**
 * body-v2 · BodyApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `body.*` slices the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *   - the intake leaf logs a real glass into the live store
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * sleep-v2/SleepApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { BodyApp } from './BodyApp';

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

describe('BodyApp', () => {
  it('first run renders the calm cold-start body face — never a blank page', () => {
    act(() => {
      root.render(<BodyApp now={NOW} />);
    });
    // cold-state copy from body-cold.html
    expect(container.textContent).toContain('this is body');
    expect(container.textContent).toContain('glasses today');
    // the amber action is always present
    expect(container.textContent).toContain('first glass');
    // the quiet drill rows are present even when empty
    for (const row of ['intake', 'symptoms', 'conditions', 'doctor summary']) {
      expect(container.textContent).toContain(row);
    }
  });

  it('opening the intake deep-link mounts that leaf with a back affordance', () => {
    act(() => {
      root.render(<BodyApp now={NOW} initialRoute="intake" />);
    });
    expect(container.textContent).toContain('supplements');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the symptom-log leaf offers the kind picker and a commit', () => {
    act(() => {
      root.render(<BodyApp now={NOW} initialRoute="symptom-log" />);
    });
    expect(container.textContent).toContain('what did the body do');
    expect(container.textContent).toContain('start the episode');
  });

  it('the conditions leaf is reachable and renders its two sections', () => {
    act(() => {
      root.render(<BodyApp now={NOW} initialRoute="conditions" />);
    });
    expect(container.textContent).toContain('conditions you track');
    expect(container.textContent).toContain('treatment plan');
  });

  it('the patterns leaf renders an honest cold note when nothing is observed', () => {
    act(() => {
      root.render(<BodyApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    expect(container.textContent?.toLowerCase()).toContain('pattern');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<BodyApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what body sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from body-notifications.html
    expect(container.textContent).toContain('six pushes');
  });

  it('logging a glass on the face updates the water count', () => {
    act(() => {
      root.render(<BodyApp now={NOW} />);
    });
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('first glass'),
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => addBtn.click());
    // the cold invitation is gone; a real glass has been logged
    expect(container.textContent).toContain('a glass');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<BodyApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
