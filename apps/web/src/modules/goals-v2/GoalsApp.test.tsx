/**
 * goals-v2 · GoalsApp — integration smoke test
 *
 * Mounts the real preview module against the real app store (the same
 * `goals.*` slices the live module uses). Verifies:
 *   - the cold-start face renders the calm clean-slate state, never blank
 *   - a seeded goal renders the focus hero with its progress + milestone
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the add leaf writes a real goal into the live `goals.items` store
 *   - the goal-detail leaf ticks a milestone (a real store mutation)
 *   - the notifications reel is reachable from the face
 *   - the Safe dot invokes its handler
 *
 * The store is a module-level singleton with an in-memory cache that
 * `localStorage.clear()` does NOT reset — so each test re-seeds the
 * `goals.*` namespace before mounting. Mirrors admin-v2/AdminApp.test.tsx
 * + work-v2/WorkApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { GoalsApp } from './GoalsApp';
import { store } from '../../store';
import type { GoalItem } from './selectors';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();

const SPANISH: GoalItem = {
  id: 'g1',
  title: 'learn spanish',
  label: 'learn spanish',
  category: 'learning',
  status: 'active',
  created_at: NOW - 60 * 86_400_000,
  pacing: 'marathon',
  obstacle: 'the speaking part scares me',
  milestones: [
    { id: 'm1', title: 'finish the first 10 lessons', completed_at: NOW - 20 * 86_400_000 },
    { id: 'm2', title: 'learn 200 everyday words', completed_at: NOW - 10 * 86_400_000 },
    { id: 'm3', title: 'hold a 5-minute conversation', completed_at: null },
    { id: 'm4', title: 'watch a film without subtitles', completed_at: null },
    { id: 'm5', title: 'read a short story end to end', completed_at: null },
  ],
};

let container: HTMLDivElement;
let root: Root;

function seed(goals: GoalItem[]) {
  store.set('goals', 'items', goals);
  store.set('goals', 'sessions', []);
  store.set('goals', 'reviews', []);
  store.set('goals', 'dumps', []);
}

beforeEach(() => {
  seed([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function btnContaining(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

describe('GoalsApp', () => {
  it('first run renders the calm cold-start goals face — never a blank page', () => {
    act(() => {
      root.render(<GoalsApp now={NOW} />);
    });
    // cold-state copy from goals-cold.html
    expect(container.textContent).toContain('no goals yet');
    expect(container.textContent).toContain('a clean slate');
    expect(container.textContent).toContain('nothing growing yet');
    // the amber action is always present
    expect(container.textContent).toContain('add your first');
    // the worked example keeps the page from being barren
    expect(container.textContent).toContain('the kinds of things that live here');
  });

  it('a seeded goal renders the focus hero with its progress and next milestone', () => {
    seed([SPANISH]);
    act(() => {
      root.render(<GoalsApp now={NOW} />);
    });
    expect(container.textContent).toContain('learn spanish');
    // 2 of 5 milestones done = 40%
    expect(container.textContent).toContain('40%');
    expect(container.textContent).toContain('hold a 5-minute conversation');
    expect(container.textContent).toContain('open this goal');
  });

  it('the add leaf offers the name field and the six categories', () => {
    act(() => {
      root.render(<GoalsApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('name one thing');
    expect(container.textContent).toContain('learning');
    expect(container.textContent).toContain('creative');
    expect(container.textContent).toContain('add it');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('adding a goal on the add leaf writes a real row into the live store', () => {
    act(() => {
      root.render(<GoalsApp now={NOW} initialRoute="add" />);
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'run a half marathon');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const addBtn = btnContaining('add it');
    expect(addBtn).toBeDefined();
    act(() => addBtn!.click());
    // the dry confirmation appears — a real goal has been committed
    expect(container.textContent).toContain('noted.');
    // and the live store now carries it
    const stored = store.get('goals', 'items', []) as GoalItem[];
    expect(stored.some((g) => g.label === 'run a half marathon')).toBe(true);
  });

  it('the goal-detail leaf ticks a milestone — a real store mutation', () => {
    seed([SPANISH]);
    act(() => {
      root.render(<GoalsApp now={NOW} initialRoute="goal" />);
    });
    // open the focus goal first so the detail screen has a goal id
    // (initialRoute=goal has no selected id; open it via the face instead)
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(<GoalsApp now={NOW} />);
    });
    const openBtn = btnContaining('open this goal');
    expect(openBtn).toBeDefined();
    act(() => openBtn!.click());
    // the detail screen shows the milestone list
    expect(container.textContent).toContain('milestones');
    expect(container.textContent).toContain('the block you saw coming');
    // tick the next open milestone
    const tick = container.querySelector(
      '[aria-label="mark \\"hold a 5-minute conversation\\" done"]',
    ) as HTMLButtonElement | null;
    expect(tick).not.toBeNull();
    act(() => tick!.click());
    // the live store now records the completion → 3 of 5 done
    const stored = store.get('goals', 'items', []) as GoalItem[];
    const g = stored.find((x) => x.id === 'g1')!;
    const done = (g.milestones ?? []).filter((m) => m && m.completed_at).length;
    expect(done).toBe(3);
  });

  it('the review leaf renders the un-graded check-in prompt', () => {
    seed([SPANISH]);
    act(() => {
      root.render(<GoalsApp now={NOW} />);
    });
    const checkIn = btnContaining('a check-in');
    expect(checkIn).toBeDefined();
    act(() => checkIn!.click());
    expect(container.textContent).toContain('does it still feel like yours');
    expect(container.textContent).toContain('still want it');
    expect(container.textContent).toContain('carrying it from before');
  });

  it('the patterns leaf renders the honest example banner when nothing is live', () => {
    seed([SPANISH]);
    act(() => {
      root.render(<GoalsApp now={NOW} initialRoute="patterns" />);
    });
    expect(container.textContent).toContain('what ollie noticed');
    expect(container.textContent).toContain('example observations');
  });

  it('the notifications reel is reachable from the face', () => {
    act(() => {
      root.render(<GoalsApp now={NOW} />);
    });
    const reelLink = btnContaining('what goals sends');
    expect(reelLink).toBeDefined();
    act(() => reelLink!.click());
    // the closing screen-only promise from goals-notifications.html
    expect(container.textContent).toContain('goals pushes only');
  });

  it('the in-module nav stack pops a leaf back to the face', () => {
    act(() => {
      root.render(<GoalsApp now={NOW} initialRoute="add" />);
    });
    expect(container.textContent).toContain('name one thing');
    const back = container.querySelector('[aria-label="back"]') as HTMLButtonElement;
    act(() => back.click());
    // back on the face — the cold-start copy is showing again
    expect(container.textContent).toContain('no goals yet');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(<GoalsApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
