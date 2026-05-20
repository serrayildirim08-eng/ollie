/**
 * v2-shell · DesktopShell — the wide-viewport shell, focused tests
 *
 * DesktopShell is the "thin spine" desktop layout — the alternative to the
 * phone `ShellApp`, picked by the router at `window.innerWidth >= 900`. It
 * shares `ShellAppProps`. These tests cover the load-bearing structure:
 *   - the spine renders with its glyphs
 *   - the throw canvas is the default focus
 *   - selecting the modules glyph swaps the canvas to the airy grid
 *   - throwing a thought routes it through the real pipeline
 *
 * Light but real — it mounts the actual component against the real store
 * (vitest.setup clears localStorage, so module faces hit their empty
 * states deterministically).
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DesktopShell } from './DesktopShell';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function q(sel: string): HTMLElement | null {
  return container.querySelector(sel);
}

function glyph(label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  ) as HTMLButtonElement;
}

describe('DesktopShell · the thin spine', () => {
  it('renders the spine with its glyphs and the throw canvas by default', () => {
    act(() => {
      root.render(<DesktopShell now={NOW} />);
    });
    // the shell + the spine
    expect(q('[data-testid="v2-desktop-shell"]')).not.toBeNull();
    expect(q('[data-testid="desktop-spine"]')).not.toBeNull();
    // the four canvas glyphs + safe all rendered in the spine
    for (const g of ['throw', 'modules', 'noticed', 'find', 'safe']) {
      expect(glyph(g)).toBeDefined();
    }
    // the default focus is the throw canvas
    expect(q('[data-testid="desktop-throw-field"]')).not.toBeNull();
    // the throw glyph reads as active
    expect(glyph('throw').getAttribute('aria-current')).toBe('page');
  });

  it('selecting the modules glyph swaps the canvas to the grid', () => {
    act(() => {
      root.render(<DesktopShell now={NOW} />);
    });
    expect(q('[data-testid="desktop-modules-grid"]')).toBeNull();
    act(() => glyph('modules').click());
    // the airy module grid is now the focus
    expect(q('[data-testid="desktop-modules-grid"]')).not.toBeNull();
    // all twelve modules are reachable from the grid
    for (const mod of [
      'cycle', 'sleep', 'body', 'medication', 'habits',
      'admin', 'pets', 'grocery', 'work', 'goals', 'partner', 'money',
    ]) {
      expect(glyph(mod)).toBeDefined();
    }
  });

  it('throwing a thought routes it through the real pipeline', () => {
    const thrown: string[] = [];
    act(() => {
      root.render(<DesktopShell now={NOW} onThrow={(t) => thrown.push(t)} />);
    });
    const field = q('[data-testid="desktop-throw-field"]') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'reschedule the dentist');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = field.closest('form') as HTMLFormElement;
    act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(thrown).toEqual(['reschedule the dentist']);
  });

  it('the safe glyph invokes the host onSafe', () => {
    let safe = false;
    act(() => {
      root.render(<DesktopShell now={NOW} onSafe={() => { safe = true; }} />);
    });
    act(() => glyph('safe').click());
    expect(safe).toBe(true);
  });
});
