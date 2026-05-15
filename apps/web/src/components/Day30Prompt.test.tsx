/**
 * Day30Prompt · unit tests
 *
 * Behavior:
 *   - not rendered by default
 *   - renders when void:retention:d30_returned fires (and not dismissed)
 *   - dismiss button hides it + writes localStorage key
 *   - does not re-render if localStorage key is already set
 *   - does not show when void:crisis:detected fired in the same session
 *   - share button calls navigator.share (or clipboard fallback)
 *   - feedback link has correct mailto href
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { emit, _clearAllHandlers } from '@ollie/events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock localStorage — the jsdom test runner receives --localstorage-file
// without a valid path, which disables the native storage API. Provide a
// simple Map-backed stub so tests run reliably.
const _lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => _lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { _lsStore.set(k, v); },
  removeItem: (k: string) => { _lsStore.delete(k); },
  clear: () => { _lsStore.clear(); },
  get length() { return _lsStore.size; },
  key: (i: number) => Array.from(_lsStore.keys())[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

import { Day30Prompt } from './Day30Prompt';

let container: HTMLDivElement;
let root: Root;

const DISMISS_KEY = 'ollie:d30_prompt:dismissed';

function mount(): void {
  act(() => {
    root.render(<Day30Prompt />);
  });
}

function fire(name: string, payload: unknown = {}): void {
  act(() => {
    emit(name, payload);
  });
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  _clearAllHandlers();
  _lsStore.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  _clearAllHandlers();
  _lsStore.clear();
  vi.restoreAllMocks();
});

describe('Day30Prompt · initial state', () => {
  it('renders nothing before the event fires', () => {
    mount();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Day30Prompt · event triggers render', () => {
  it('shows the card when void:retention:d30_returned fires', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('renders kicker text "a month in"', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    expect(container.textContent).toContain('a month in');
  });

  it('renders body copy about telling a friend', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    expect(container.textContent).toContain('telling a friend');
  });
});

describe('Day30Prompt · dismiss', () => {
  it('hides the card when dismiss button is clicked', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="dismiss"]');
    expect(btn).not.toBeNull();
    click(btn!);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('writes dismiss key to localStorage on dismiss', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="dismiss"]');
    click(btn!);
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });

  it('does not show card if dismiss key already set', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Day30Prompt · crisis suppression', () => {
  it('does not show when void:crisis:detected fired before d30_returned', () => {
    mount();
    fire('void:crisis:detected', { text: 'test', matchedLine: 'test', ts: Date.now() });
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Day30Prompt · share action', () => {
  it('renders share button with aria-label "share ollie"', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const shareBtn = container.querySelector<HTMLButtonElement>('button[aria-label="share ollie"]');
    expect(shareBtn).not.toBeNull();
  });

  it('calls navigator.share when share button is clicked and share is available', () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareMock,
      configurable: true,
      writable: true,
    });
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const shareBtn = container.querySelector<HTMLButtonElement>('button[aria-label="share ollie"]');
    click(shareBtn!);
    expect(shareMock).toHaveBeenCalledTimes(1);
    const [data] = shareMock.mock.calls[0] as [ShareData];
    expect(data.url).toBe('https://ollie.app');
  });

  it('calls clipboard.writeText as fallback when navigator.share is absent', async () => {
    // Remove navigator.share
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const clipboardMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardMock },
      configurable: true,
      writable: true,
    });
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const shareBtn = container.querySelector<HTMLButtonElement>('button[aria-label="share ollie"]');
    click(shareBtn!);
    // Wait for async share/clipboard
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(clipboardMock).toHaveBeenCalledWith('https://ollie.app');
  });
});

describe('Day30Prompt · feedback link', () => {
  it('renders feedback link with mailto href', () => {
    mount();
    fire('void:retention:d30_returned', { installed_at: 0, returned_at: 1, days: 30 });
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="tell us what\'s missing"]');
    expect(link).not.toBeNull();
    expect(link?.href).toContain('mailto:support@ollie.app');
    expect(link?.href).toContain('feedback');
  });
});
