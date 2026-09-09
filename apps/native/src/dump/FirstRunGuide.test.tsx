/**
 * FirstRunGuide · behavior tests
 *
 * 1. Renders the three example chips.
 * 2. Tapping a chip fires onPick with that chip's text (so DumpScreen can
 *    seed the dump box).
 *
 * UI/layout deps are stubbed with plain HTML so the test does not require CSS
 * module transforms or theme tokens — same pattern as NeedsConfirmCard.test.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Row: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../theme/tokens', () => ({
  colors: {
    cream: '#EDE7D9',
    ink: '#14140F',
    inkSoft: '#5A574E',
    inkFaint: '#9C9890',
    sage: '#2E5D43',
  },
  shadows: { raisedSm: 'none' },
}));

import { FirstRunGuide } from './FirstRunGuide';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function render(onPick: (t: string) => void): void {
  act(() => {
    root.render(React.createElement(FirstRunGuide, { onPick }));
  });
}

describe('FirstRunGuide', () => {
  it('renders three example chips', () => {
    render(vi.fn());
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(container.textContent).toContain('out of milk');
    expect(container.textContent).toContain('took vitamin d');
    expect(container.textContent).toContain('cancel netflix friday');
  });

  it('tapping a chip fires onPick with that chip text', () => {
    const onPick = vi.fn();
    render(onPick);
    const milk = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'out of milk',
    ) as HTMLButtonElement;
    act(() => {
      milk.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPick).toHaveBeenCalledWith('out of milk');
  });
});
