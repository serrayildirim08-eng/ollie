/**
 * CrisisScreen · calm crisis surface · behavioral tests
 *
 * Covers:
 *   1. renders the title + intro (always available)
 *   2. shows the country-specific hotline (TR → 182)
 *   3. falls back to the INTL directory when country is unknown
 *   4. close button calls onClose
 *   5. DOCTRINE: imports zero telemetry / network — no @ollie/events,
 *      no fetch reference in the source file
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

import { CrisisScreen } from './CrisisScreen';

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

describe('CrisisScreen', () => {
  it('renders title and intro', () => {
    act(() => { root.render(<CrisisScreen onClose={() => {}} />); });
    expect(container.textContent).toContain("you're not alone");
    expect(container.textContent).toContain('nothing leaves this device');
  });

  it('shows the country-specific hotline for TR', () => {
    storeData.set('shared:settings', { country: 'TR' });
    act(() => { root.render(<CrisisScreen onClose={() => {}} />); });
    expect(container.textContent).toContain('182');
  });

  it('falls back to the INTL directory for an unknown country', () => {
    storeData.set('shared:settings', { country: 'XX' });
    act(() => { root.render(<CrisisScreen onClose={() => {}} />); });
    expect(container.textContent).toContain('findahelpline.com');
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    act(() => { root.render(<CrisisScreen onClose={onClose} />); });
    const closeBtn = container.querySelector('button') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('source file contains no telemetry or network calls', () => {
    // Strip comments — the doctrine is also documented in prose at the
    // top of the file, and we only want to assert against real code.
    const raw = readFileSync(join(__dirname, 'CrisisScreen.tsx'), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/@ollie\/events/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\bSentry\b|\bPostHog\b/);
  });
});
