/**
 * habits-v2 · HabitsApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `shared.habits_v2` slice the live module uses). Verifies:
 *   - first-run face renders the calm cold-start state — the 6 seeded
 *     habits give the day a shape, never a blank page
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the tap-circle checks a real habit into the live store
 *   - the add leaf commits a real habit, cue-gated
 *   - the all-habits leaf is reachable and renders its framing note
 *   - the "see the rest" patterns leaf is reachable
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *
 * The store is empty per-test (vitest.setup clears localStorage), so the
 * `shared.habits_v2` slice resolves to the 6 seeded defaults — this
 * exercises the cold-start branch deterministically. Mirrors
 * medication-v2/MedicationApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { HabitsApp } from './HabitsApp';

const NOW = new Date('2026-05-18T09:00:00').getTime();

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

describe('HabitsApp', () => {
  it('first run renders the calm cold-start habits face — never blank', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} />);
    });
    // cold-state copy from habits-cold.html — the 6 seeded habits
    expect(container.textContent).toContain('first up, when you can');
    expect(container.textContent).toContain('brush teeth');
    expect(container.textContent).toContain('6 small habits to start with');
    expect(container.textContent).toContain('add a habit');
    // the drill rows are present even when cold
    expect(container.textContent).toContain('all habits');
    expect(container.textContent).toContain('see the rest');
    // the dry no-streaks closing line
    expect(container.textContent).toContain('no streaks wait');
  });

  it('the tap-circle checks the next habit into the live store', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} />);
    });
    // none done yet — the centre reads the calm cold label
    expect(container.textContent).toContain("the day's ahead");
    const tap = container.querySelector(
      'button[aria-label^="check in"]',
    ) as HTMLButtonElement;
    expect(tap).not.toBeNull();
    act(() => tap.click());
    // one is now done — the hero advances to the next seeded habit
    expect(container.textContent).toContain('done today');
    expect(container.textContent).not.toContain('first up, when you can');
  });

  it('opening the add deep-link mounts that leaf with a back affordance', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('one small thing');
    expect(container.textContent).toContain('add it');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the add leaf is cue-gated and commits a real habit into the live store', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} initialRoute="add" />);
    });
    const setValue = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const nameInput = container.querySelector(
      'input[aria-label="habit name"]',
    ) as HTMLInputElement;
    const cueInput = container.querySelector(
      'input[aria-label="habit cue"]',
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(cueInput).not.toBeNull();

    const addBtn = () =>
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'add it',
      ) as HTMLButtonElement;

    // name only — cue still missing → the commit is gated (disabled)
    act(() => setValue(nameInput, 'read a page'));
    expect(addBtn().disabled).toBe(true);

    // cue filled → the commit unlocks
    act(() => setValue(cueInput, 'after coffee'));
    expect(addBtn().disabled).toBe(false);
    act(() => addBtn().click());
    // the dry confirmation lands
    expect(container.textContent).toContain('noted.');
  });

  it('the all-habits leaf is reachable and renders its framing note', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} initialRoute="all" />);
    });
    // the seeded habits are listed under cue-time sections
    expect(container.textContent).toContain('brush teeth');
    expect(container.textContent).toContain('evening');
    // the screen-only framing note
    expect(container.textContent?.toLowerCase()).toContain(
      'no streaks, no score',
    );
  });

  it('the see-the-rest patterns leaf is reachable and honest about examples', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    // with no orchestrator patterns on file it labels the set as examples
    expect(container.textContent).toContain('example patterns');
    // the screen-only promise
    expect(container.textContent?.toLowerCase()).toContain(
      'ever sent as a notification',
    );
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<HabitsApp now={NOW} />);
    });
    const reelLink = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('what habits sends'),
    ) as HTMLButtonElement | undefined;
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from habits-notifications.html
    expect(container.textContent).toContain('you missed');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <HabitsApp
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
      root.render(<HabitsApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('one small thing');
    const backBtn = container.querySelector(
      '[aria-label="back"]',
    ) as HTMLButtonElement;
    act(() => backBtn.click());
    // back on the habits face — its drill rows are present, the add lead gone
    expect(container.textContent).toContain('all habits');
    expect(container.textContent).not.toContain('one small thing');
  });
});
