/**
 * CrisisScreen · boundary surface · behavioral tests
 *
 * Covers:
 *   1. renders the boundary message (EN by default)
 *   2. renders the findahelpline.com link pointing at the real URL
 *   3. ?lang=tr renders the Turkish copy
 *   4. ?lang=es renders the Spanish copy
 *   5. back button calls onClose
 *   6. DOCTRINE: the source imports zero telemetry / network — no
 *      @ollie/events, no fetch reference in the file
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeData = new Map<string, unknown>();

vi.mock('../store', () => ({
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

function render(entry: string, onClose: () => void = () => {}): void {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <CrisisScreen onClose={onClose} />
      </MemoryRouter>,
    );
  });
}

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
  it('renders the boundary message in English by default', () => {
    render('/crisis');
    expect(container.textContent).toContain("i can't help with this");
    expect(container.textContent).toContain("not what i'm here for");
  });

  it('points to findahelpline.com', () => {
    render('/crisis');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://findahelpline.com');
    expect(link.textContent).toContain('findahelpline.com');
  });

  it('renders the Turkish copy for ?lang=tr', () => {
    render('/crisis?lang=tr');
    expect(container.textContent).toContain('bu konuda yardım edemem');
    expect(container.textContent).toContain('findahelpline.com');
  });

  it('renders the Spanish copy for ?lang=es', () => {
    render('/crisis?lang=es');
    expect(container.textContent).toContain('no puedo ayudarte con esto');
  });

  it('back button calls onClose', () => {
    const onClose = vi.fn();
    render('/crisis', onClose);
    const backBtn = container.querySelector('button') as HTMLButtonElement;
    expect(backBtn).not.toBeNull();
    click(backBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('source file contains no telemetry or network calls', () => {
    // Strip comments — the doctrine is documented in prose at the top of
    // the file; we only want to assert against real code.
    const raw = readFileSync(join(__dirname, 'CrisisScreen.tsx'), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/@ollie\/events/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\bSentry\b|\bPostHog\b/);
  });
});
