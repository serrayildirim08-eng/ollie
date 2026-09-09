/**
 * FirstDumpWhisper · behavior tests
 *
 * 1. Renders the primary module label (+N for multi-route) and "see it".
 * 2. Tapping navigates to the module box and fires onDone.
 * 3. Auto-dismisses (onDone) after the linger + fade window.
 *
 * UI/layout deps are stubbed with plain HTML — same pattern as
 * FirstRunGuide.test / NeedsConfirmCard.test. react-router's useNavigate is
 * mocked (no Router context in jsdom).
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
    sage: '#2E5D43',
    sageDeep: '#566F33',
    inkSoft: '#5A574E',
  },
}));

const navigateSpy = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('../storage', () => ({
  kv: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  },
}));

import { FirstDumpWhisper } from './FirstDumpWhisper';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  navigateSpy.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

function render(props: { module: string; extraCount?: number; onDone: () => void }): void {
  act(() => {
    root.render(React.createElement(FirstDumpWhisper, props));
  });
}

describe('FirstDumpWhisper', () => {
  it('renders the friendly module label and the SMCP "see it" affordance', () => {
    render({ module: 'grocery', onDone: vi.fn() });
    expect(container.textContent).toContain('groceries');
    expect(container.textContent).toContain('see it');
    expect(container.textContent).toContain('→');
  });

  it('renders "+N" for multi-route dumps', () => {
    render({ module: 'grocery', extraCount: 2, onDone: vi.fn() });
    expect(container.textContent).toContain('groceries +2');
  });

  it('tap navigates to the module box and fires onDone', () => {
    const onDone = vi.fn();
    render({ module: 'medication', onDone });
    const btn = container.querySelector('button')!;
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(navigateSpy).toHaveBeenCalledWith('/box/medication');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the linger + fade window', () => {
    const onDone = vi.fn();
    render({ module: 'grocery', onDone });
    act(() => {
      vi.advanceTimersByTime(10_000 + 450 + 50);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
