/**
 * CycleModule · pill log UI — behavioral tests
 *
 * Covers:
 *   1. Section hidden when birth_control_enabled === false
 *   2. Section visible when birth_control_enabled === true
 *   3. Tap today → pill action added to cycle.items
 *   4. 7-day strip renders 7 dots with correct filled/outlined state
 *   5. Backdate > 3 days is disabled (button disabled attr)
 *   6. Backdate within 3 days is not disabled
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ──────────────────────────────────────────────────────────────

vi.mock('../../store', () => {
  const data = new Map<string, unknown>();
  return {
    store: {
      set: vi.fn((mod: string, key: string, value: unknown) => {
        data.set(`${mod}:${key}`, value);
      }),
      get: vi.fn((mod: string, key: string, fallback: unknown) => {
        const k = `${mod}:${key}`;
        return data.has(k) ? data.get(k) : fallback;
      }),
      subscribe: vi.fn(() => () => {}),
      __data: data,
    },
    useStoreSlice: vi.fn(
      <T,>(
        mod: string,
        key: string,
        defaultValue: T,
      ): [T, (v: T) => void] => {
        const k = `${mod}:${key}`;
        const val = (data.has(k) ? data.get(k) : defaultValue) as T;
        const setter = (v: T) => data.set(k, v);
        return [val, setter];
      },
    ),
  };
});

// ─── i18n + SourcesLink stubs ────────────────────────────────────────────────

vi.mock('../../i18n', () => ({
  getString: (_locale: string, path: string) => path,
  getPlural: (_locale: string, baseKey: string) => baseKey,
  interpolate: (template: string) => template,
  pluralCategory: (_locale: string, count: number) =>
    count === 1 ? 'one' : 'other',
}));

vi.mock('../../components/SourcesLink', () => ({
  SourcesLink: () => null,
}));

// ─── imports (after mocks) ────────────────────────────────────────────────────

import { CycleModule } from './CycleModule';
import { store } from '../../store';

// ─── helpers ─────────────────────────────────────────────────────────────────

type StoreWithData = typeof store & { __data: Map<string, unknown> };

function seedStore(overrides: {
  birth_control_enabled?: boolean;
  birth_control_type?: 'combined' | 'progestin-only' | 'other';
  items?: unknown[];
} = {}) {
  const s = store as StoreWithData;
  s.__data.clear();
  s.__data.set('cycle:items', overrides.items ?? []);
  s.__data.set('cycle:settings', {
    tracking_for_fertility: false,
    show_dial: false,
    passphrase_hint: '',
    birth_control_enabled: overrides.birth_control_enabled ?? false,
    birth_control_type: overrides.birth_control_type ?? 'combined',
  });
  // birth_control_enabled is now authoritative at shared.settings.birth_control_enabled
  s.__data.set('shared:settings.birth_control_enabled', overrides.birth_control_enabled ?? false);
  s.__data.set('cycle:lastEditedByCycle', {});
  s.__data.set('cycle:asks', []);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // Clear data before each test
  (store as StoreWithData).__data.clear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function mount() {
  act(() => {
    root.render(<CycleModule />);
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('pill log section — gate', () => {
  it('is hidden when birth_control_enabled is false', () => {
    seedStore({ birth_control_enabled: false });
    mount();
    const el = container.querySelector('[aria-label="birth control"]');
    expect(el).toBeNull();
  });

  it('is visible when birth_control_enabled is true', () => {
    seedStore({ birth_control_enabled: true });
    mount();
    const el = container.querySelector('[aria-label="birth control"]');
    expect(el).not.toBeNull();
  });
});

describe('pill log — today button', () => {
  it('adds a pill action to cycle.items on tap', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const btn = container.querySelector(
      '[aria-label="cycle.pill.aria_today_btn"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();

    act(() => {
      btn!.click();
    });

    const s = store as StoreWithData;
    const stored = s.__data.get('cycle:items') as Array<{ action: string; ts: number }>;
    expect(stored).toBeDefined();
    const pillEntry = stored.find(i => i.action === 'pill');
    expect(pillEntry).toBeDefined();
    expect(pillEntry!.action).toBe('pill');
    expect(typeof pillEntry!.ts).toBe('number');
  });

  it('shows today_logged copy after tapping', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const btn = container.querySelector(
      '[aria-label="cycle.pill.aria_today_btn"]',
    ) as HTMLButtonElement | null;

    act(() => {
      btn!.click();
    });

    // Re-render to pick up state update from store
    act(() => {
      root.render(<CycleModule />);
    });

    const text = container.textContent ?? '';
    expect(text).toContain('cycle.pill.today_logged');
  });
});

describe('pill log — 7-day strip', () => {
  it('renders exactly 7 dots', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const group = container.querySelector('[aria-label="pill log — past 7 days"]');
    expect(group).not.toBeNull();
    const dots = group!.querySelectorAll('button');
    expect(dots).toHaveLength(7);
  });

  it('dot for a past logged day is aria-pressed=true', () => {
    const now = Date.now();
    // yesterday noon
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(12, 0, 0, 0);

    const items = [{ ts: d.getTime(), action: 'pill' }];
    seedStore({ birth_control_enabled: true, items });
    mount();

    const group = container.querySelector('[aria-label="pill log — past 7 days"]');
    expect(group).not.toBeNull();
    const pressedDots = Array.from(
      group!.querySelectorAll('button[aria-pressed="true"]'),
    );
    expect(pressedDots.length).toBeGreaterThanOrEqual(1);
  });

  it('dot for an unlogged day is aria-pressed=false', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const group = container.querySelector('[aria-label="pill log — past 7 days"]');
    expect(group).not.toBeNull();
    const allDots = group!.querySelectorAll('button');
    const pressedDots = Array.from(allDots).filter(
      b => b.getAttribute('aria-pressed') === 'true',
    );
    expect(pressedDots.length).toBe(0);
  });
});

describe('pill log — backdate limit', () => {
  it('dots more than 3 days back are disabled when unlogged', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const group = container.querySelector('[aria-label="pill log — past 7 days"]');
    expect(group).not.toBeNull();
    const allDots = Array.from(group!.querySelectorAll('button'));

    // Strip: index 0 = 6 days ago, index 1 = 5 days ago, index 2 = 4 days ago
    // All three exceed the 3-day backdate limit
    const tooOldDots = allDots.slice(0, 3);
    tooOldDots.forEach(dot => {
      expect(dot.hasAttribute('disabled')).toBe(true);
    });
  });

  it('dots within 3 days back are not disabled', () => {
    seedStore({ birth_control_enabled: true, items: [] });
    mount();

    const group = container.querySelector('[aria-label="pill log — past 7 days"]');
    expect(group).not.toBeNull();
    const allDots = Array.from(group!.querySelectorAll('button'));

    // Index 3 = 3 days ago, index 4 = 2 days ago, index 5 = 1 day ago
    const withinLimitDots = allDots.slice(3, 6);
    withinLimitDots.forEach(dot => {
      expect(dot.hasAttribute('disabled')).toBe(false);
    });
  });
});
