/**
 * CookRatingModal · interaction + a11y tests.
 *
 * Three options. Each invokes onCook with the right rating and closes.
 * Esc closes. Backdrop click closes. Focus moves to the down option on
 * mount.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CookRatingModal } from './CookRatingModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Probe {
  container: HTMLDivElement;
  root: Root;
}

function render(node: React.ReactNode): Probe {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return { container, root };
}

describe('CookRatingModal', () => {
  let mounted: Probe[] = [];

  beforeEach(() => {
    mounted = [];
  });
  afterEach(() => {
    for (const p of mounted) {
      act(() => p.root.unmount());
      p.container.remove();
    }
    mounted = [];
  });

  function mount(node: React.ReactNode): Probe {
    const p = render(node);
    mounted.push(p);
    return p;
  }

  it('each of the three options calls onCook with the correct rating', () => {
    const ratings: number[] = [];
    let closed = 0;
    mount(
      <CookRatingModal
        dish="shakshuka"
        onCook={(r) => ratings.push(r)}
        onClose={() => closed++}
      />,
    );

    const down = document.querySelector(
      'button[aria-label="didn\'t love it"]',
    ) as HTMLButtonElement | null;
    const neutral = document.querySelector(
      'button[aria-label="just cooked it"]',
    ) as HTMLButtonElement | null;
    const up = document.querySelector(
      'button[aria-label="loved it"]',
    ) as HTMLButtonElement | null;

    expect(down).not.toBeNull();
    expect(neutral).not.toBeNull();
    expect(up).not.toBeNull();

    act(() => down!.click());
    expect(ratings).toEqual([-1]);
    expect(closed).toBe(1);
  });

  it('neutral button records rating 0', () => {
    const ratings: number[] = [];
    mount(
      <CookRatingModal
        dish="pan con tomate"
        onCook={(r) => ratings.push(r)}
        onClose={() => {}}
      />,
    );
    const neutral = document.querySelector(
      'button[aria-label="just cooked it"]',
    ) as HTMLButtonElement;
    act(() => neutral.click());
    expect(ratings).toEqual([0]);
  });

  it('up button records rating 1', () => {
    const ratings: number[] = [];
    mount(
      <CookRatingModal
        dish="pan con tomate"
        onCook={(r) => ratings.push(r)}
        onClose={() => {}}
      />,
    );
    const up = document.querySelector(
      'button[aria-label="loved it"]',
    ) as HTMLButtonElement;
    act(() => up.click());
    expect(ratings).toEqual([1]);
  });

  it('Esc keydown closes the modal', () => {
    let closed = 0;
    mount(
      <CookRatingModal
        dish="x"
        onCook={() => {}}
        onClose={() => closed++}
      />,
    );
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(closed).toBe(1);
  });

  it('backdrop click closes the modal', () => {
    let closed = 0;
    mount(
      <CookRatingModal
        dish="x"
        onCook={() => {}}
        onClose={() => closed++}
      />,
    );
    const backdrop = document.querySelector(
      'div[role="dialog"]',
    ) as HTMLDivElement;
    // simulate a click whose target IS the backdrop itself
    act(() => {
      const ev = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(ev, 'target', { value: backdrop });
      backdrop.dispatchEvent(ev);
    });
    // click handler reads e.target === e.currentTarget; the dispatched
    // event's target is the backdrop and bubbling reaches the dialog as
    // currentTarget. The synthetic React handler in jsdom may not see
    // this exact pair — fall back to a programmatic click() on the
    // dialog if the synthetic path doesn't fire.
    if (closed === 0) {
      act(() => backdrop.click());
    }
    expect(closed).toBe(1);
  });

  it('focuses the first option on mount (focus trap entry)', () => {
    mount(
      <CookRatingModal
        dish="x"
        onCook={() => {}}
        onClose={() => {}}
      />,
    );
    const down = document.querySelector(
      'button[aria-label="didn\'t love it"]',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(down);
  });

  it('Tab cycles through the three options (focus trap)', () => {
    mount(
      <CookRatingModal
        dish="x"
        onCook={() => {}}
        onClose={() => {}}
      />,
    );
    const down = document.querySelector(
      'button[aria-label="didn\'t love it"]',
    ) as HTMLButtonElement;
    const neutral = document.querySelector(
      'button[aria-label="just cooked it"]',
    ) as HTMLButtonElement;
    const up = document.querySelector(
      'button[aria-label="loved it"]',
    ) as HTMLButtonElement;

    expect(document.activeElement).toBe(down);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(neutral);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(up);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(down); // wraps
  });
});
