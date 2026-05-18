/**
 * MedicationModule · back-affordance tests
 *
 * The iPhone PWA has no hardware Back button, so every takeover module
 * must ship an explicit exit. Before the re-audit fix, ModuleScreen
 * rendered <MedicationModule /> bare — a user opening #/module/medication
 * was stranded. These tests pin the back affordance in place.
 *
 * Covers:
 *   1. a labelled back control is rendered
 *   2. clicking it invokes the onBack prop
 *   3. the back control is a real <button> (keyboard-reachable)
 *   4. the module still renders its own content (empty-state copy)
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeData = new Map<string, unknown>();

vi.mock('../../store', () => ({
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
      return [val, (v: T) => { storeData.set(k, v); }];
    },
  ),
}));

import { MedicationModule } from './MedicationModule';

let container: HTMLDivElement;
let root: Root;

function click(el: Element | null): void {
  if (!el) throw new Error('click target not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function backButton(): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="back to dashboard"]');
  if (!btn) throw new Error('back button not found');
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

describe('MedicationModule — back affordance', () => {
  it('renders a labelled back control', () => {
    act(() => { root.render(<MedicationModule onBack={() => {}} />); });
    expect(backButton()).not.toBeNull();
    expect(backButton().textContent?.toLowerCase()).toContain('dashboard');
  });

  it('invokes onBack when the back control is clicked', () => {
    const onBack = vi.fn();
    act(() => { root.render(<MedicationModule onBack={onBack} />); });
    click(backButton());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('exposes the back control as a real <button> (keyboard-reachable)', () => {
    act(() => { root.render(<MedicationModule onBack={() => {}} />); });
    expect(backButton().tagName).toBe('BUTTON');
    expect(backButton().getAttribute('type')).toBe('button');
  });

  it('still renders the module content alongside the back control', () => {
    act(() => { root.render(<MedicationModule onBack={() => {}} />); });
    expect(container.textContent).toContain('medication');
    expect(container.textContent).toContain('no items yet');
  });
});
