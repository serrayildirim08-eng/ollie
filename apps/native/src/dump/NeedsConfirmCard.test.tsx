/**
 * NeedsConfirmCard · behavior tests
 *
 * 1. Card renders only when needsConfirm is true (inferred via props gate in
 *    DumpScreen — here we test the card directly: renders when mounted,
 *    implies caller only mounts it for needsConfirm entries).
 * 2. Clicking undo fires the onUndo callback.
 * 3. Clicking keep fires onKeep and NOT onUndo.
 *
 * UI/layout deps are stubbed with plain HTML so the test does not require
 * CSS module transforms or Tauri native plugin bindings.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stub layout + ui primitives ───────────────────────────────────────────
// NeedsConfirmCard uses Stack, Row (layout) and Text (ui).
// Replace with thin wrappers that just render children so we can assert on
// text + buttons without pulling in CSS modules or theme tokens at test time.

vi.mock('../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'stack' }, children),
  Row: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'row' }, children),
}));

vi.mock('../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../theme/tokens', () => ({
  colors: {
    paper: '#F4F1E8',
    hairline: 'rgba(20,20,15,0.10)',
    ink: '#14140F',
    inkFaint: '#9C9890',
    inkSoft: '#5A574E',
    sage: '#2E5D43',
  },
}));

import { NeedsConfirmCard } from './NeedsConfirmCard';

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

function render(props: {
  fragmentPreview: string;
  routeLabel: string;
  onKeep: () => void;
  onUndo: () => void;
}): void {
  act(() => {
    root.render(React.createElement(NeedsConfirmCard, props));
  });
}

function clickButton(label: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`button with aria-label="${label}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('NeedsConfirmCard', () => {
  it('renders the fragment preview and route label', () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render({
      fragmentPreview: 'my head hurts a lot',
      routeLabel: 'body · log_symptom',
      onKeep,
      onUndo,
    });
    expect(container.textContent).toContain('my head hurts a lot');
    expect(container.textContent).toContain('body · log_symptom');
  });

  it('renders both keep and undo buttons', () => {
    render({
      fragmentPreview: 'test fragment',
      routeLabel: 'grocery · add_item',
      onKeep: vi.fn(),
      onUndo: vi.fn(),
    });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
  });

  it('clicking undo fires onUndo and NOT onKeep', () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render({
      fragmentPreview: 'test fragment',
      routeLabel: 'grocery · add_item',
      onKeep,
      onUndo,
    });
    clickButton('Undo this routing');
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('clicking keep fires onKeep and NOT onUndo', () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render({
      fragmentPreview: 'test fragment',
      routeLabel: 'grocery · add_item',
      onKeep,
      onUndo,
    });
    clickButton('Keep this routing');
    expect(onKeep).toHaveBeenCalledOnce();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('renders only when mounted — caller gates on needsConfirm', () => {
    // The component itself is always "visible" when mounted.
    // The gate (needsConfirm === true) lives in DumpScreen.
    // This test asserts the card IS present when rendered.
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render({
      fragmentPreview: 'something uncertain',
      routeLabel: 'work · create_task',
      onKeep,
      onUndo,
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});
