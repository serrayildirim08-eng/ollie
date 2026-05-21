/**
 * <ReplenishmentBadge> · render-state tests.
 *
 * The badge encodes two orthogonal axes:
 *   • confidence (static / low-data / observed) — drives weight, color, prefix
 *   • daysLeft   (urgent / days / weeks / months / due-now)  — drives unit
 *
 * Plus the prefers-reduced-motion contract (no transitions when reduced).
 * Every probe is created via a manual createRoot + IS_REACT_ACT_ENVIRONMENT
 * so the test can assert the DOM directly without rendering libraries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReplenishmentBadge } from './ReplenishmentBadge';
import type { ReplenishmentEstimate } from '../hooks/useReplenishment';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(estimate: ReplenishmentEstimate): {
  el: HTMLElement;
  root: Root;
  container: HTMLDivElement;
} {
  const container = document.createElement('div');
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(<ReplenishmentBadge estimate={estimate} />);
  });
  const span = container.querySelector('span');
  if (!span) throw new Error('badge did not render');
  return { el: span as HTMLElement, root: root!, container };
}

function unmount(root: Root) {
  act(() => root.unmount());
}

function mkEstimate(over: Partial<ReplenishmentEstimate> = {}): ReplenishmentEstimate {
  return {
    canonical: 'milk',
    daysLeft: 5,
    confidence: 'observed',
    sampleSize: 5,
    medianIntervalDays: 7,
    lastPurchaseTs: 0,
    ...over,
  };
}

// stub matchMedia to a no-reduced-motion default
function stubMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce') ? reduced : false,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })),
  });
}

describe('<ReplenishmentBadge> · confidence states', () => {
  beforeEach(() => stubMatchMedia(false));

  it('renders static with italic + mute color + ~ prefix + cold-start tooltip', () => {
    const { el, root } = render(mkEstimate({ confidence: 'static', daysLeft: 7 }));
    expect(el.dataset.confidence).toBe('static');
    expect(el.style.fontStyle).toBe('italic');
    expect(el.textContent?.startsWith('~')).toBe(true);
    expect(el.title).toContain('typical shelf life');
    unmount(root);
  });

  it('renders low-data with regular weight + ink + ~ prefix + still-learning tooltip', () => {
    const { el, root } = render(mkEstimate({ confidence: 'low-data', daysLeft: 5 }));
    expect(el.dataset.confidence).toBe('low-data');
    expect(el.style.fontStyle).toBe('normal');
    expect(el.textContent?.startsWith('~')).toBe(true);
    expect(el.title).toContain('still learning');
    unmount(root);
  });

  it('renders observed with solid weight + accent color + no prefix + every-X-days tooltip', () => {
    const { el, root } = render(
      mkEstimate({ confidence: 'observed', sampleSize: 8, medianIntervalDays: 4, daysLeft: 3 }),
    );
    expect(el.dataset.confidence).toBe('observed');
    expect(el.style.fontWeight).toBe('600');
    expect(el.textContent?.startsWith('~')).toBe(false);
    expect(el.title).toMatch(/last 8 purchases/);
    expect(el.title).toMatch(/every 4 days/);
    unmount(root);
  });
});

describe('<ReplenishmentBadge> · daysLeft buckets', () => {
  beforeEach(() => stubMatchMedia(false));

  it('renders "due now" for negative daysLeft', () => {
    const { el, root } = render(mkEstimate({ daysLeft: -3 }));
    expect(el.textContent).toContain('due now');
    expect(el.dataset.urgent).toBe('true');
    unmount(root);
  });

  it('renders "today" for daysLeft === 0', () => {
    const { el, root } = render(mkEstimate({ daysLeft: 0 }));
    expect(el.textContent).toContain('today');
    expect(el.dataset.urgent).toBe('true');
    unmount(root);
  });

  it('renders "{N} days left" + urgent flag for daysLeft < 3', () => {
    const { el, root } = render(mkEstimate({ daysLeft: 2 }));
    expect(el.textContent).toContain('2 days left');
    expect(el.dataset.urgent).toBe('true');
    unmount(root);
  });

  it('renders "{N} days left" for daysLeft 3..13', () => {
    const { el, root } = render(mkEstimate({ daysLeft: 5 }));
    expect(el.textContent).toContain('5 days left');
    expect(el.dataset.urgent).toBe('false');
    unmount(root);
  });

  it('renders "{N} weeks left" for daysLeft 14..59', () => {
    const { el, root } = render(mkEstimate({ daysLeft: 21 }));
    expect(el.textContent).toContain('3 weeks left');
    unmount(root);
  });

  it('renders "{N} months left" for daysLeft >= 60', () => {
    const { el, root } = render(mkEstimate({ daysLeft: 90 }));
    expect(el.textContent).toContain('3 months left');
    unmount(root);
  });
});

describe('<ReplenishmentBadge> · motion contract', () => {
  it('emits no transition when prefers-reduced-motion is on', () => {
    stubMatchMedia(true);
    const { el, root } = render(mkEstimate());
    expect(el.style.transition).toBe('none');
    unmount(root);
  });

  it('emits a sub-300ms ease-out transition when motion is allowed', () => {
    stubMatchMedia(false);
    const { el, root } = render(mkEstimate());
    expect(el.style.transition).toMatch(/180ms/);
    expect(el.style.transition).toMatch(/ease-out/);
    unmount(root);
  });
});

describe('<ReplenishmentBadge> · a11y', () => {
  beforeEach(() => stubMatchMedia(false));

  it('exposes the tooltip via aria-label so SR users get the same context', () => {
    const { el, root } = render(
      mkEstimate({ confidence: 'observed', sampleSize: 5, medianIntervalDays: 7 }),
    );
    expect(el.getAttribute('aria-label')).toMatch(/last 5 purchases/);
    expect(el.getAttribute('aria-label')).toContain(el.textContent ?? '');
    unmount(root);
  });
});
