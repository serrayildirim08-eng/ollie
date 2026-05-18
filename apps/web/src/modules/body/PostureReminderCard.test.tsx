/**
 * PostureReminderCard · unit tests
 *
 * Audit gap #2 — the posture-reminder orchestrator was complete but its
 * `body.posture_settings.opt_in` flag was stuck false because no UI could
 * turn it on. This card is that enable toggle.
 *
 * Covers:
 *   - pure helper `nextPostureSettings`: opt_in merge + default window stamping
 *   - default render is OFF (orchestrator never fires until opted in)
 *   - tapping the switch writes opt_in:true into body.posture_settings
 *   - the written shape carries a complete window the orchestrator can read
 *   - tapping again turns it back off, window preserved
 *   - aria-checked + role=switch reflect state (a11y)
 *   - all visible copy is restrained (no banned phrases)
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ────────────────────────────────────────────────────────────
// Shadow the real store (which boots the full orchestrator) with an
// in-memory map + React-state-backed slice so updates trigger re-renders.

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
  PostureReminderCard,
  nextPostureSettings,
  POSTURE_DEFAULT_START_HOUR,
  POSTURE_DEFAULT_END_HOUR,
  type PostureSettings,
} from './BodyModule';
import { store } from '../../store';

// ─── test harness ──────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  __storeData.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function mount(): void {
  act(() => { root.render(<PostureReminderCard />); });
}

function getSwitch(): HTMLButtonElement {
  const el = container.querySelector('button[role="switch"]');
  if (!el) throw new Error('posture switch not found');
  return el as HTMLButtonElement;
}

// ─── pure helper ───────────────────────────────────────────────────────────

describe('nextPostureSettings', () => {
  it('stamps the default work-hour window when none exists', () => {
    const next = nextPostureSettings(null, true);
    expect(next.opt_in).toBe(true);
    expect(next.start_hour).toBe(POSTURE_DEFAULT_START_HOUR);
    expect(next.end_hour).toBe(POSTURE_DEFAULT_END_HOUR);
  });

  it('preserves an existing custom window', () => {
    const prev: PostureSettings = { opt_in: false, start_hour: 10, end_hour: 18 };
    const next = nextPostureSettings(prev, true);
    expect(next.opt_in).toBe(true);
    expect(next.start_hour).toBe(10);
    expect(next.end_hour).toBe(18);
  });

  it('can flip opt_in back off without losing the window', () => {
    const on = nextPostureSettings(null, true);
    const off = nextPostureSettings(on, false);
    expect(off.opt_in).toBe(false);
    expect(off.start_hour).toBe(POSTURE_DEFAULT_START_HOUR);
    expect(off.end_hour).toBe(POSTURE_DEFAULT_END_HOUR);
  });

  it('tolerates an undefined / non-object prev', () => {
    expect(nextPostureSettings(undefined, true).opt_in).toBe(true);
  });
});

// ─── component: default state ──────────────────────────────────────────────

describe('PostureReminderCard · default state', () => {
  it('renders OFF when no posture_settings exist', () => {
    mount();
    const sw = getSwitch();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect((container.textContent ?? '').toLowerCase()).toContain('off by default');
  });

  it('does not write anything to the store on mount', () => {
    mount();
    // Orchestrator must never see opt_in until the user acts.
    expect(store.get('body', 'posture_settings', null)).toBeNull();
  });

  it('reflects a pre-enabled setting as ON', () => {
    store.set('body', 'posture_settings', { opt_in: true, start_hour: 9, end_hour: 17 });
    mount();
    expect(getSwitch().getAttribute('aria-checked')).toBe('true');
  });
});

// ─── component: enable flow ────────────────────────────────────────────────

describe('PostureReminderCard · enable flow', () => {
  it('tapping the switch turns the reminder on', () => {
    mount();
    act(() => {
      getSwitch().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const saved = store.get<PostureSettings | null>('body', 'posture_settings', null);
    expect(saved?.opt_in).toBe(true);
    expect(getSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('writes a complete window the orchestrator can read', () => {
    mount();
    act(() => {
      getSwitch().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const saved = store.get<PostureSettings | null>('body', 'posture_settings', null);
    expect(saved).not.toBeNull();
    expect(typeof saved?.start_hour).toBe('number');
    expect(typeof saved?.end_hour).toBe('number');
    expect(saved?.start_hour).toBe(POSTURE_DEFAULT_START_HOUR);
    expect(saved?.end_hour).toBe(POSTURE_DEFAULT_END_HOUR);
  });

  it('tapping again turns it back off', () => {
    mount();
    const sw = getSwitch();
    act(() => { sw.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    act(() => {
      getSwitch().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const saved = store.get<PostureSettings | null>('body', 'posture_settings', null);
    expect(saved?.opt_in).toBe(false);
  });
});

// ─── component: a11y + copy ────────────────────────────────────────────────

describe('PostureReminderCard · a11y + copy', () => {
  it('exposes role=switch with an accessible label', () => {
    mount();
    const sw = getSwitch();
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-label')).toBe('posture reminder');
  });

  it('all visible copy is restrained — no banned phrases', () => {
    store.set('body', 'posture_settings', { opt_in: true });
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('great');
    expect(text).not.toContain('awesome');
    expect(text).not.toContain('streak');
    expect(text).not.toContain('!');
  });
});
