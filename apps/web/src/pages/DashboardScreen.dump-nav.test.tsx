/**
 * DashboardScreen · dump-archive navigation entry-point tests
 *
 * The re-audit found #/module/dump orphaned: ModuleScreen dispatches it,
 * but nothing in Home or Dashboard navigated there — the dump stream-
 * archive view was reachable only by typing the URL. The fix adds an
 * "archive" affordance under the inline brain-dump on the Dashboard
 * (the input writes dump entries; this opens their archive).
 *
 * Covers:
 *   1. a labelled archive control is rendered
 *   2. clicking it calls onNavigate('module', 'dump')
 *   3. the archive control is a real keyboard-reachable <button>
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

import { DashboardScreen } from './DashboardScreen';

let container: HTMLDivElement;
let root: Root;

function click(el: Element | null): void {
  if (!el) throw new Error('click target not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function archiveButton(): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="open dump archive"]');
  if (!btn) throw new Error('dump archive button not found');
  return btn as HTMLButtonElement;
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

describe('DashboardScreen — dump archive entry point', () => {
  it('renders a labelled archive control', () => {
    act(() => {
      root.render(<DashboardScreen onNavigate={() => {}} onBrainDump={() => {}} />);
    });
    expect(archiveButton()).not.toBeNull();
    expect(archiveButton().textContent?.toLowerCase()).toContain('archive');
  });

  it('navigates to the dump module when the archive control is clicked', () => {
    const onNavigate = vi.fn();
    act(() => {
      root.render(<DashboardScreen onNavigate={onNavigate} onBrainDump={() => {}} />);
    });
    click(archiveButton());
    expect(onNavigate).toHaveBeenCalledWith('module', 'dump');
  });

  it('exposes the archive control as a real <button> (keyboard-reachable)', () => {
    act(() => {
      root.render(<DashboardScreen onNavigate={() => {}} onBrainDump={() => {}} />);
    });
    expect(archiveButton().tagName).toBe('BUTTON');
    expect(archiveButton().getAttribute('type')).toBe('button');
  });
});
