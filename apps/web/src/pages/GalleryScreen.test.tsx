/**
 * GalleryScreen · achievement gallery · behavioral tests
 *
 * Covers:
 *   1. empty state when no goals are completed (hide-not-lie)
 *   2. a goal with status 'done' appears in the completed-goals shelf
 *   3. an active (status 'active') goal is NOT shown
 *   4. a milestone with completed_at appears in the milestones shelf
 *   5. an open milestone (completed_at null) is NOT shown
 *   6. back button calls onNavigate('home')
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeData = new Map<string, unknown>();

vi.mock('../store', () => ({
  store: {
    get: vi.fn((mod: string, key: string, fallback: unknown) => {
      const k = `${mod}:${key}`;
      return storeData.has(k) ? storeData.get(k) : fallback;
    }),
  },
  useStoreSlice: vi.fn(
    <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const val = (storeData.has(k) ? storeData.get(k) : defaultValue) as T;
      return [val, () => {}];
    },
  ),
}));

import { GalleryScreen } from './GalleryScreen';

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

describe('GalleryScreen', () => {
  it('shows the empty state when nothing is finished', () => {
    act(() => { root.render(<GalleryScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('nothing finished here yet');
  });

  it('shows a completed goal in the shelf', () => {
    storeData.set('goals:items', [
      { id: 'g1', title: 'learn to swim', status: 'done', status_at: Date.now() },
    ]);
    act(() => { root.render(<GalleryScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('learn to swim');
    expect(container.textContent).toContain('completed goals');
  });

  it('does not show an active goal', () => {
    storeData.set('goals:items', [
      { id: 'g1', title: 'still working on this', status: 'active' },
    ]);
    act(() => { root.render(<GalleryScreen onNavigate={() => {}} />); });
    expect(container.textContent).not.toContain('still working on this');
    expect(container.textContent).toContain('nothing finished here yet');
  });

  it('shows a completed milestone', () => {
    storeData.set('goals:items', [
      {
        id: 'g1',
        title: 'big goal',
        status: 'active',
        milestones: [{ id: 'm1', title: 'first step', completed_at: Date.now() }],
      },
    ]);
    act(() => { root.render(<GalleryScreen onNavigate={() => {}} />); });
    expect(container.textContent).toContain('first step');
    expect(container.textContent).toContain('completed milestones');
  });

  it('does not show an open milestone', () => {
    storeData.set('goals:items', [
      {
        id: 'g1',
        title: 'big goal',
        status: 'active',
        milestones: [{ id: 'm1', title: 'not done yet', completed_at: null }],
      },
    ]);
    act(() => { root.render(<GalleryScreen onNavigate={() => {}} />); });
    expect(container.textContent).not.toContain('not done yet');
  });

  it('back button calls onNavigate("home")', () => {
    const onNavigate = vi.fn();
    act(() => { root.render(<GalleryScreen onNavigate={onNavigate} />); });
    const back = container.querySelector('button[aria-label="home"]') as HTMLButtonElement;
    click(back);
    expect(onNavigate).toHaveBeenCalledWith('home');
  });
});
