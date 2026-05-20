/**
 * money-v2 · v2 primitives — render tests
 *
 * Surface tests for the shared v2 design primitives (Screen, HeroNumber,
 * AreaCard, AmberButton). These are the components body / home / work
 * will reuse, so their contract is locked here:
 *   - Screen always renders the Find + Safe dots
 *   - HeroNumber masks to a non-numeric block when `masked`
 *   - AreaCard's expand toggle drives `aria-expanded` + reveals detail
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Screen } from './Screen';
import { HeroNumber } from './HeroNumber';
import { AreaCard } from './AreaCard';
import { AmberButton } from './AmberButton';

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

describe('Screen', () => {
  it('renders the always-on Find and Safe dots', () => {
    act(() => {
      root.render(
        <Screen label="money">
          <div>body</div>
        </Screen>,
      );
    });
    expect(container.querySelector('[aria-label="find"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="safe"]')).not.toBeNull();
    expect(container.textContent).toContain('money');
  });

  it('Find dot calls onFind', () => {
    let found = false;
    act(() => {
      root.render(
        <Screen label="money" onFind={() => { found = true; }}>
          <div />
        </Screen>,
      );
    });
    const find = container.querySelector('[aria-label="find"]') as HTMLButtonElement;
    act(() => find.click());
    expect(found).toBe(true);
  });

  it('drops the phone chrome on a wide viewport', () => {
    // vitest.setup pins a 390px phone viewport; widen it past the 900px
    // desktop floor + fire a resize so `useIsWideViewport()` flips.
    const original = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', {
        value: 1280,
        writable: true,
        configurable: true,
      });
      act(() => {
        window.dispatchEvent(new Event('resize'));
        root.render(
          <Screen label="money" onFind={() => {}} onSafe={() => {}}>
            <div>body</div>
          </Screen>,
        );
      });
      // desktop mode: the editorial page, no phone Find/Safe corner dots
      expect(container.querySelector('[data-testid="v2-screen-desktop"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="find"]')).toBeNull();
      expect(container.querySelector('[aria-label="safe"]')).toBeNull();
      // the who label + body still render
      expect(container.textContent).toContain('money');
      expect(container.textContent).toContain('body');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: original,
        writable: true,
        configurable: true,
      });
      act(() => window.dispatchEvent(new Event('resize')));
    }
  });
});

describe('HeroNumber', () => {
  it('shows the figure when not masked', () => {
    act(() => {
      root.render(<HeroNumber lead="safe to spend" value="312" />);
    });
    expect(container.textContent).toContain('312');
  });

  it('masks the figure — never renders the number — when masked', () => {
    act(() => {
      root.render(<HeroNumber lead="safe to spend" value="312" masked />);
    });
    expect(container.textContent).not.toContain('312');
    expect(container.querySelector('[aria-label="hidden"]')).not.toBeNull();
  });
});

describe('AreaCard', () => {
  it('toggles aria-expanded and reveals detail on open', () => {
    let open = false;
    const render = () =>
      act(() => {
        root.render(
          <AreaCard
            areaKey="bills"
            value="rent $1,200"
            open={open}
            onToggle={() => { open = !open; render(); }}
            detail={[{ k: 'rent', v: '$1,200' }]}
          />,
        );
      });
    render();
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    act(() => btn.click());
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('$1,200');
  });

  it('masks the value line when masked', () => {
    act(() => {
      root.render(
        <AreaCard
          areaKey="bills"
          value="rent $1,200"
          masked
          open={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(container.textContent).not.toContain('1,200');
  });
});

describe('AmberButton', () => {
  it('is a real button and fires onClick', () => {
    let clicked = false;
    act(() => {
      root.render(<AmberButton onClick={() => { clicked = true; }}>spend</AmberButton>);
    });
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toContain('spend');
    act(() => btn.click());
    expect(clicked).toBe(true);
  });
});
