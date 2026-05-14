/**
 * WindDownChecklist · unit tests
 *
 * Covers:
 *   - pure helpers: parseHHMM, dayKey, isWithinWindow, itemsForTonight
 *   - items render in order (5 when no supplements, 6 when supplements present)
 *   - only the next item is tappable (future items aria-disabled)
 *   - completing item N enables item N+1
 *   - completing all items emits sleep:wind_down_completed with correct payload
 *   - day-boundary reset clears stale persisted state
 *   - supplement step skipped when body.supplements is empty
 *   - dismiss mid-flow emits sleep:wind_down_skipped + collapses
 *   - outside wind-down window → renders null
 *   - opted-out of sleep module → renders null
 *   - on completion, card collapses to "rest well."
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ────────────────────────────────────────────────────────────
// The real apps/web/src/store.ts pulls in the full app bootstrap (orchestrator,
// reminder scheduler, astrology). For unit tests we shadow it with an in-memory
// map + React-state-backed slice so updates trigger re-renders.

const __storeData = new Map<string, unknown>();
const __sliceListeners = new Set<() => void>();

vi.mock('../../store', async () => {
  const ReactMod = await import('react');
  return {
    store: {
      set: (mod: string, key: string, value: unknown) => {
        __storeData.set(`${mod}:${key}`, value);
        __sliceListeners.forEach((fn) => fn());
      },
      get: (mod: string, key: string, fallback: unknown) => {
        const k = `${mod}:${key}`;
        return __storeData.has(k) ? __storeData.get(k) : fallback;
      },
      subscribe: () => () => {},
    },
    useStoreSlice: <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const [, force] = ReactMod.useState(0);
      ReactMod.useEffect(() => {
        const listener = (): void => force((n) => n + 1);
        __sliceListeners.add(listener);
        return () => { __sliceListeners.delete(listener); };
      }, []);
      const val = (__storeData.has(k) ? __storeData.get(k) : defaultValue) as T;
      const setter = (v: T): void => {
        __storeData.set(k, v);
        __sliceListeners.forEach((fn) => fn());
      };
      return [val, setter];
    },
  };
});

import {
  WindDownChecklist,
  parseHHMM,
  dayKey,
  isWithinWindow,
  itemsForTonight,
} from './WindDownChecklist';
import { store } from '../../store';
import * as events from '@ollie/events';

// ─── test harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

function reset(): void {
  __storeData.clear();
  // Wipe the relevant store namespaces so each test starts clean.
  store.set('sleep', 'wind_down_state', {
    date: '', completed: [], startedAt: null, finished: false, dismissed: false,
  });
  store.set('sleep', 'settings', { target_bedtime: '23:00' });
  store.set('body', 'supplements', []);
  store.set('shared', 'consent.modules', {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  reset();
  events._clearAllHandlers();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

// Fixed "now" inside the wind-down window for bedtime=23:00 → 22:30 local.
function nowInWindow(): Date {
  return new Date(2026, 4, 14, 22, 30, 0, 0);
}
// Fixed "now" outside the wind-down window (mid-afternoon).
function nowOutsideWindow(): Date {
  return new Date(2026, 4, 14, 15, 0, 0, 0);
}

function mount(nowFn: () => Date = nowInWindow): void {
  act(() => {
    root.render(<WindDownChecklist nowFn={nowFn} />);
  });
}

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('parseHHMM', () => {
  it('parses well-formed times', () => {
    expect(parseHHMM('23:00')).toBe(23 * 60);
    expect(parseHHMM('06:30')).toBe(6 * 60 + 30);
    expect(parseHHMM('00:00')).toBe(0);
  });
  it('rejects malformed', () => {
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('12:99')).toBeNull();
    expect(parseHHMM('garbage')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
  });
});

describe('dayKey', () => {
  it('returns YYYY-MM-DD for a given local date', () => {
    expect(dayKey(new Date(2026, 4, 14, 23, 30))).toBe('2026-05-14');
    expect(dayKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('isWithinWindow', () => {
  it('opens 60 minutes before bedtime', () => {
    // bedtime 23:00 → window starts 22:00
    expect(isWithinWindow(22 * 60, 23 * 60)).toBe(true);
    expect(isWithinWindow(21 * 60 + 59, 23 * 60)).toBe(false);
  });
  it('stays open well past bedtime (for late-bedtime users)', () => {
    expect(isWithinWindow(23 * 60 + 30, 23 * 60)).toBe(true);
    expect(isWithinWindow(2 * 60, 23 * 60)).toBe(true);   // 02:00 — wrap
  });
  it('closes during the day', () => {
    expect(isWithinWindow(15 * 60, 23 * 60)).toBe(false);
    expect(isWithinWindow(10 * 60, 23 * 60)).toBe(false);
  });
});

describe('itemsForTonight', () => {
  it('returns 6 items when supplements scheduled', () => {
    const items = itemsForTonight(true);
    expect(items).toHaveLength(6);
    expect(items[0].id).toBe('phone_away');
    expect(items.map((i) => i.id)).toContain('supplement');
    expect(items[5].id).toBe('into_bed');
  });
  it('returns 5 items when no supplements', () => {
    const items = itemsForTonight(false);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.id)).not.toContain('supplement');
    expect(items[0].id).toBe('phone_away');
    expect(items[4].id).toBe('into_bed');
  });
});

// ─── component: render gating ──────────────────────────────────────────────

describe('WindDownChecklist · visibility', () => {
  it('renders nothing outside the wind-down window', () => {
    mount(nowOutsideWindow);
    expect(container.querySelector('[aria-label="wind-down checklist"]')).toBeNull();
  });

  it('renders nothing when user opted out of sleep', () => {
    store.set('shared', 'consent.modules', { sleep: false });
    mount();
    expect(container.querySelector('[aria-label="wind-down checklist"]')).toBeNull();
  });

  it('renders the card inside the window', () => {
    mount();
    expect(container.querySelector('[aria-label="wind-down checklist"]')).not.toBeNull();
  });
});

// ─── component: items + sequential tap ────────────────────────────────────

describe('WindDownChecklist · items', () => {
  it('renders 5 items when no supplements scheduled', () => {
    mount();
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(5);
    const text = container.textContent ?? '';
    expect(text).toContain('phone away');
    expect(text).toContain('drink water');
    expect(text).not.toContain('supplement');
    expect(text).toContain('lights low');
    expect(text).toContain('breath / journal');
    expect(text).toContain('into bed');
  });

  it('renders 6 items when supplements scheduled', () => {
    store.set('body', 'supplements', [
      { id: 's1', name: 'magnesium', dose: '200mg', added_at: Date.now() },
    ]);
    mount();
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(6);
    expect(container.textContent ?? '').toContain('supplement');
  });

  it('items render in canonical order', () => {
    store.set('body', 'supplements', [
      { id: 's1', name: 'magnesium', dose: null, added_at: Date.now() },
    ]);
    mount();
    const labels = Array.from(container.querySelectorAll('li')).map((li) =>
      (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    // Each li ends with a 2-digit index — sanity-check first/last
    expect(labels[0].startsWith('phone away')).toBe(true);
    expect(labels[labels.length - 1].startsWith('into bed')).toBe(true);
  });

  it('only the next item is tappable (others aria-disabled)', () => {
    mount();
    const buttons = Array.from(
      container.querySelectorAll('button[aria-pressed]'),
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(5);
    // Index 0 enabled, 1..4 disabled.
    expect(buttons[0].getAttribute('aria-disabled')).toBe('false');
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i].getAttribute('aria-disabled')).toBe('true');
      expect(buttons[i].disabled).toBe(true);
    }
  });

  it('completing item N enables item N+1', () => {
    mount();
    const btns = () =>
      Array.from(
        container.querySelectorAll('button[aria-pressed]'),
      ) as HTMLButtonElement[];

    // Tap item 0
    act(() => {
      btns()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const after = btns();
    expect(after[0].getAttribute('aria-pressed')).toBe('true');
    expect(after[1].getAttribute('aria-disabled')).toBe('false');
    expect(after[1].disabled).toBe(false);
    expect(after[2].getAttribute('aria-disabled')).toBe('true');
  });

  it('tapping a non-next item is a no-op', () => {
    mount();
    const buttons = Array.from(
      container.querySelectorAll('button[aria-pressed]'),
    ) as HTMLButtonElement[];
    // Try to tap a disabled future button programmatically; persisted state
    // must remain empty.
    act(() => {
      buttons[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const state = store.get<{ completed: string[] }>('sleep', 'wind_down_state', { completed: [] });
    expect(state?.completed ?? []).toHaveLength(0);
  });
});

// ─── component: events ────────────────────────────────────────────────────

describe('WindDownChecklist · events', () => {
  it('emits sleep:wind_down_started on first tap', () => {
    const started = vi.fn();
    events.on('sleep:wind_down_started', started);

    mount();
    const first = container.querySelector(
      'button[aria-pressed]',
    ) as HTMLButtonElement;
    act(() => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(started).toHaveBeenCalledTimes(1);
    const payload = started.mock.calls[0][0] as { ts: number };
    expect(typeof payload.ts).toBe('number');
  });

  it('emits sleep:wind_down_completed after the final item is checked', () => {
    const completed = vi.fn();
    events.on('sleep:wind_down_completed', completed);

    mount(); // no supplements → 5 items
    for (let i = 0; i < 5; i++) {
      const btns = Array.from(
        container.querySelectorAll('button[aria-pressed]'),
      ) as HTMLButtonElement[];
      act(() => {
        btns[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    expect(completed).toHaveBeenCalledTimes(1);
    const payload = completed.mock.calls[0][0] as {
      ts: number; durationMs: number; itemsCompleted: number;
    };
    expect(payload.itemsCompleted).toBe(5);
    expect(typeof payload.durationMs).toBe('number');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);

    // Card collapses to "rest well." copy.
    expect((container.textContent ?? '').toLowerCase()).toContain('rest well.');
  });

  it('emits sleep:wind_down_skipped when dismissed mid-flow', () => {
    const skipped = vi.fn();
    events.on('sleep:wind_down_skipped', skipped);

    mount();
    // Complete one item, then dismiss.
    const first = container.querySelector('button[aria-pressed]') as HTMLButtonElement;
    act(() => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dismiss = container.querySelector(
      'button[aria-label="dismiss wind-down checklist for tonight"]',
    ) as HTMLButtonElement;
    act(() => {
      dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(skipped).toHaveBeenCalledTimes(1);
    const payload = skipped.mock.calls[0][0] as { itemsCompleted: number };
    expect(payload.itemsCompleted).toBe(1);

    // After dismiss, the card is gone.
    expect(container.querySelector('[aria-label="wind-down checklist"]')).toBeNull();
  });

  it('does NOT re-emit completed on remount (persisted finished state)', () => {
    const completed = vi.fn();
    events.on('sleep:wind_down_completed', completed);

    mount();
    for (let i = 0; i < 5; i++) {
      const btns = Array.from(
        container.querySelectorAll('button[aria-pressed]'),
      ) as HTMLButtonElement[];
      act(() => {
        btns[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    expect(completed).toHaveBeenCalledTimes(1);

    // Simulate a reload by unmount + mount.
    act(() => { root.unmount(); });
    root = createRoot(container);
    mount();

    // Still just one emission. Collapsed "rest well." card is rendered.
    expect(completed).toHaveBeenCalledTimes(1);
    expect((container.textContent ?? '').toLowerCase()).toContain('rest well.');
  });
});

// ─── component: day boundary ──────────────────────────────────────────────

describe('WindDownChecklist · day boundary', () => {
  it('resets stale persisted state from a previous date', () => {
    // Pre-seed yesterday's run (3 completed, not finished).
    store.set('sleep', 'wind_down_state', {
      date:      '2026-05-13',
      completed: ['phone_away', 'drink_water', 'lights_low'],
      startedAt: Date.now() - 86_400_000,
      finished:  false,
      dismissed: false,
    });

    mount();

    // After mount, the component should snap state to today; cursor = 0,
    // first button enabled, all others disabled.
    const buttons = Array.from(
      container.querySelectorAll('button[aria-pressed]'),
    ) as HTMLButtonElement[];
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[0].getAttribute('aria-disabled')).toBe('false');
    expect(buttons[1].getAttribute('aria-disabled')).toBe('true');

    const state = store.get<{ date: string; completed: string[] }>(
      'sleep', 'wind_down_state', { date: '', completed: [] },
    );
    expect(state?.date).toBe(dayKey(nowInWindow()));
    expect(state?.completed ?? []).toHaveLength(0);
  });
});

// ─── banned-phrase smoke check ────────────────────────────────────────────

describe('WindDownChecklist · banned-phrase audit (smoke)', () => {
  it('all visible copy is lowercase + restrained', () => {
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    // Cheerleading bans (mirrors banned-phrases.cjs subset)
    expect(text).not.toContain('great');
    expect(text).not.toContain('awesome');
    expect(text).not.toContain('good job');
    // notif-scope-allow — testing absence of the banned word
    expect(text).not.toContain('streak');
    expect(text).not.toContain('keep going');
    // Visual restraint — no exclamation marks anywhere in user copy.
    expect(text).not.toContain('!');
  });
});
