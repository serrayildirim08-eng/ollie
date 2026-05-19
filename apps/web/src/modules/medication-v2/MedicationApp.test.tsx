/**
 * medication-v2 · MedicationApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `medication.*` slice the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the add leaf commits a real medication into the live store
 *   - the adherence-log leaf is reachable and renders its framing note
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *
 * The store is empty per-test (vitest.setup clears localStorage), so this
 * exercises the cold-start branch deterministically. Mirrors
 * body-v2/BodyApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MedicationApp } from './MedicationApp';

const NOW = new Date('2026-05-18T14:00:00').getTime();

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

describe('MedicationApp', () => {
  it('first run renders the calm cold-start medication face — never blank', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} />);
    });
    // cold-state copy from medication-cold.html
    expect(container.textContent).toContain('nothing on file yet');
    expect(container.textContent).toContain('add your first');
    expect(container.textContent).toContain('no medications yet');
    // the adherence drill row is present even when cold
    expect(container.textContent).toContain('adherence log');
    // the dry no-streaks closing line
    expect(container.textContent).toContain('no streaks');
  });

  it('opening the add deep-link mounts that leaf with a back affordance', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('what are you adding');
    expect(container.textContent).toContain('add it');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the add leaf commits a real medication into the live store', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} initialRoute="add" />);
    });
    const nameInput = container.querySelector(
      'input[aria-label="medication name"]',
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput, 'vitamin d');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const addBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'add it',
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    act(() => addBtn.click());
    // the dry confirmation lands
    expect(container.textContent).toContain('noted.');
  });

  it('the adherence-log leaf is reachable and renders its framing note', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} initialRoute="log" />);
    });
    expect(container.textContent).toContain('what was taken');
    // the screen-only framing promise
    expect(container.textContent?.toLowerCase()).toContain('pattern, not a medical reading');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what medication sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from medication-notifications.html
    expect(container.textContent).toContain('two pushes');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <MedicationApp
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

  it('the back affordance on a leaf pops the stack to the face', () => {
    act(() => {
      root.render(<MedicationApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('what are you adding');
    const backBtn = container.querySelector(
      '[aria-label="back"]',
    ) as HTMLButtonElement;
    act(() => backBtn.click());
    // back on the medication face — its module label + meds list are present,
    // and the add leaf's lead is gone
    expect(container.textContent).toContain('your meds');
    expect(container.textContent).not.toContain('what are you adding');
  });
});
