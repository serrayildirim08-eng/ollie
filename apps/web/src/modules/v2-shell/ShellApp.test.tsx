/**
 * v2-shell · ShellApp — navigation integration tests
 *
 * Mounts the real shell against the real app store (the same stores the
 * 12 `*-v2` modules and the live app use). Verifies the navigation model
 * from DIRECTION.md:
 *   - the capture deck opens on Throw and the 4-dot indicator tracks it
 *   - a deck-dot tap jumps between the four capture screens
 *   - throwing a thought routes it (applyDump) and lands on Caught
 *   - the 4-modules view pushes a module homepage; a submodule card
 *     mounts the real `*-v2` app; the handle pops back
 *   - money is special — its room mounts the money app directly
 *   - Find opens from every screen and closes again
 *   - the Safe dot invokes the host's onSafe
 *
 * The store is empty per-test (vitest.setup clears localStorage), so the
 * mounted modules exercise their calm empty states deterministically.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ShellApp } from './ShellApp';

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

describe('ShellApp · the capture deck', () => {
  it('opens on Throw — the input + mic, the deck floor', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    expect(q('[data-testid="v2-shell"]')).not.toBeNull();
    expect(q('#v2-throw-field')).not.toBeNull();
    expect(q('[aria-label="voice capture"]')).not.toBeNull();
    // the 4-dot indicator: Throw (dot 1) is selected
    const dots = container.querySelectorAll('[role="tab"][aria-label]');
    const throwDot = Array.from(dots).find((d) => d.getAttribute('aria-label') === 'throw');
    expect(throwDot?.getAttribute('aria-selected')).toBe('true');
  });

  it('a deck-dot tap jumps to the 4-modules view', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    const modulesDot = Array.from(
      container.querySelectorAll('[role="tab"]'),
    ).find((d) => d.getAttribute('aria-label') === 'modules') as HTMLButtonElement;
    act(() => modulesDot.click());
    // the four rooms are now reachable
    for (const room of ['money', 'body', 'home', 'work']) {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === room,
      );
      expect(btn).toBeDefined();
    }
  });

  it('Caught shows its calm empty line before anything is thrown', () => {
    act(() => {
      root.render(<ShellApp now={NOW} initialDeck="caught" />);
    });
    expect(container.textContent).toContain('nothing caught yet');
  });

  it('Noticed shows its calm empty line when no pattern is found', () => {
    act(() => {
      root.render(<ShellApp now={NOW} initialDeck="noticed" />);
    });
    expect(container.textContent).toContain("ollie hasn't noticed anything yet");
  });

  it('throwing a thought routes it and lands on Caught', () => {
    const thrown: string[] = [];
    act(() => {
      root.render(<ShellApp now={NOW} onThrow={(t) => thrown.push(t)} />);
    });
    const field = q('#v2-throw-field') as HTMLTextAreaElement;
    act(() => {
      // React-controlled textarea: set value via the native setter
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'buy oat milk');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = field.closest('form') as HTMLFormElement;
    act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    // the real brain-dump pipeline was invoked
    expect(thrown).toEqual(['buy oat milk']);
    // the deck slid to Caught and shows the thrown thought
    expect(container.textContent).toContain('buy oat milk');
  });
});

describe('ShellApp · the push stack', () => {
  function gotoModules() {
    const modulesDot = Array.from(
      container.querySelectorAll('[role="tab"]'),
    ).find((d) => d.getAttribute('aria-label') === 'modules') as HTMLButtonElement;
    act(() => modulesDot.click());
  }

  function room(name: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === name,
    ) as HTMLButtonElement;
  }

  it('the body room pushes the body homepage with its 5 submodule cards', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    gotoModules();
    act(() => room('body').click());
    // the body homepage — 5 submodule rows
    for (const sub of ['cycle', 'sleep', 'body', 'medication', 'habits']) {
      expect(container.textContent?.toLowerCase()).toContain(sub);
    }
  });

  it('a submodule card mounts the real *-v2 app, and the handle pops back', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    gotoModules();
    act(() => room('body').click());
    // open the sleep submodule — mounts the real SleepApp
    const sleepCard = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'open sleep',
    ) as HTMLButtonElement;
    act(() => sleepCard.click());
    // the real sleep app rendered (its chrome carries a back handle)
    const back = q('[aria-label="back"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    // popping returns to the body homepage
    act(() => back.click());
    expect(container.textContent?.toLowerCase()).toContain('medication');
  });

  it('money is special — its room mounts the money app directly', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    gotoModules();
    act(() => room('money').click());
    // the money-v2 face mounted directly (no intermediate homepage)
    expect(container.textContent).toContain('safe to spend');
  });
});

describe('ShellApp · always-on Find & Safe', () => {
  it('Find opens from the deck and closes again', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    const find = q('[aria-label="find"]') as HTMLButtonElement;
    act(() => find.click());
    expect(q('[data-testid="v2-find"]')).not.toBeNull();
    const close = q('[aria-label="close find"]') as HTMLButtonElement;
    act(() => close.click());
    expect(q('[data-testid="v2-find"]')).toBeNull();
  });

  it('Find searches the submodule index by name', () => {
    act(() => {
      root.render(<ShellApp now={NOW} />);
    });
    act(() => (q('[aria-label="find"]') as HTMLButtonElement).click());
    const input = q('#v2-find-field') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'sleep');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('across the notebook');
    expect(container.textContent).toContain('jump to submodule');
  });

  it('the Safe dot invokes the host onSafe', () => {
    let safe = false;
    act(() => {
      root.render(<ShellApp now={NOW} onSafe={() => { safe = true; }} />);
    });
    act(() => (q('[aria-label="safe"]') as HTMLButtonElement).click());
    expect(safe).toBe(true);
  });
});
