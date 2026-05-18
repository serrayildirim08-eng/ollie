/**
 * InsightsScreen · weekly review · behavioral tests
 *
 * Covers:
 *   1. empty state when nothing logged this week (hide-not-lie)
 *   2. a "logged" row appears when a dump entry is within 7 days
 *   3. stale data (>7 days old) does NOT count toward the week
 *   4. back button calls onNavigate('home')
 *   5. completed-goal status_at within the week surfaces a goals row
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeData = new Map<string, unknown>();

vi.mock('../store', () => ({
  store: {
    set: vi.fn((mod: string, key: string, value: unknown) => {
      storeData.set(`${mod}:${key}`, value);
    }),
    get: vi.fn((mod: string, key: string, fallback: unknown) => {
      const k = `${mod}:${key}`;
      return storeData.has(k) ? storeData.get(k) : fallback;
    }),
    subscribeKey: vi.fn(() => () => {}),
  },
  useStoreSlice: vi.fn(
    <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const val = (storeData.has(k) ? storeData.get(k) : defaultValue) as T;
      const setter = (v: T) => storeData.set(k, v);
      return [val, setter];
    },
  ),
}));

import { InsightsScreen } from './InsightsScreen';

const DAY = 86_400_000;

let container: HTMLDivElement;
let root: Root;

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  storeData.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('InsightsScreen', () => {
  it('shows the empty state when nothing was logged this week', () => {
    act(() => { root.render(<InsightsScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('nothing noted yet this week');
  });

  it('surfaces a logged row for a recent dump entry', () => {
    storeData.set('dump:items', [{ ts: Date.now() - DAY, text: 'a thought' }]);
    act(() => { root.render(<InsightsScreen onNavigate={() => {}} />); });
    expect(container.textContent).not.toContain('nothing noted yet this week');
    expect(container.textContent).toContain('what you logged');
  });

  it('ignores dump entries older than 7 days', () => {
    storeData.set('dump:items', [{ ts: Date.now() - 30 * DAY, text: 'old thought' }]);
    act(() => { root.render(<InsightsScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('nothing noted yet this week');
  });

  it('back button calls onNavigate("home")', () => {
    const onNavigate = vi.fn();
    act(() => { root.render(<InsightsScreen onNavigate={onNavigate} />); });
    const back = container.querySelector('button[aria-label="home"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    click(back);
    expect(onNavigate).toHaveBeenCalledWith('home');
  });

  it('counts a goal whose status changed within the week', () => {
    storeData.set('goals:items', [
      { id: 'g1', title: 'ship it', status: 'done', status_at: Date.now() - DAY },
    ]);
    act(() => { root.render(<InsightsScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('what you logged');
  });
});
