/**
 * HabitsModule · unit tests
 *
 * Audit gap #1 — HabitsModule once carried a SECOND "banner" detector layer
 * that was fed hardcoded-empty data (completions/dumps/sleepRecords/goals/
 * cyclePhases all empty), so it could never trigger — dead code. Every signal
 * it could surface is already produced by the orchestrator's 16-detector
 * `detectPatterns` run (real data) and rendered by the primary "noticed"
 * section via the `habits.patterns` store slice. The banner layer was deleted.
 *
 * These tests lock that in:
 *   - the primary "noticed" section renders patterns from habits.patterns
 *   - the empty-state "noticed" copy renders when there are no patterns
 *   - no dead banner detector layer remains (the deleted layer had its own
 *     dismiss buttons keyed by signal — assert they are gone)
 *   - the ledger still renders habits + the marked count
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ────────────────────────────────────────────────────────────

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

import { HabitsModule } from './HabitsModule';
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
  act(() => { root.render(<HabitsModule onBack={() => {}} />); });
}

// ─── primary "noticed" section ─────────────────────────────────────────────

describe('HabitsModule · noticed section', () => {
  it('renders the empty-state copy when habits.patterns is empty', () => {
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('noticed');
    expect(text).toContain('patterns surface around 2 weeks of data');
  });

  it('renders patterns from the habits.patterns store slice', () => {
    // This is the slice the orchestrator's detectPatterns writes with REAL
    // data — the only live source of habit signals.
    store.set('habits', 'patterns', [
      {
        pattern: 'habit-drift',
        confidence: 'medium',
        sample_n: 12,
        copy: 'move — completing less these two weeks. data point, not data trend.',
      },
    ]);
    mount();
    const text = container.textContent ?? '';
    expect(text).toContain('data point, not data trend');
    expect(text.toLowerCase()).toContain('medium confidence');
    expect(text).toContain('12 samples');
  });
});

// ─── dead banner layer is gone ─────────────────────────────────────────────

describe('HabitsModule · no vestigial banner layer', () => {
  it('renders no signal-banner dismiss buttons (the deleted dead layer)', () => {
    // The removed banner layer rendered dismiss buttons with aria-labels of
    // the form "dismiss <signal name>". None must remain.
    mount();
    const dismissBanner = Array.from(
      container.querySelectorAll('button[aria-label^="dismiss "]'),
    ).filter((b) => {
      const label = b.getAttribute('aria-label') ?? '';
      // The water prompt's dismiss button is legitimate; banner ones aren't.
      return label !== 'dismiss water prompt';
    });
    expect(dismissBanner).toHaveLength(0);
  });

  it('renders no banner copy even when habits exist with no completions', () => {
    // The dead layer was fed empty data and so never fired. With it removed,
    // a normal seed render must show only the ledger + empty "noticed" copy.
    store.set('shared', 'habits_v2', [
      { id: 'h1', name: 'walk', cue: 'after lunch', cueTime: 'anytime', completions: [] },
    ]);
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('walk');
    expect(text).toContain('noticed');
    // No banner-only signal labels leak through.
    expect(text).not.toContain('fresh start crash');
    expect(text).not.toContain('identity framing');
    expect(text).not.toContain('body vs cognitive');
  });
});

// ─── ledger still works ────────────────────────────────────────────────────

describe('HabitsModule · ledger', () => {
  it('renders seeded habits and the marked count', () => {
    store.set('shared', 'habits_v2', [
      { id: 'h1', name: 'water', cue: 'before coffee', cueTime: 'morning', completions: [] },
      { id: 'h2', name: 'move', cue: 'before sunset', cueTime: 'anytime', completions: [] },
    ]);
    mount();
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('water');
    expect(text).toContain('move');
    expect(text).toContain('marked');
  });

  it('toggling a habit row marks it done', () => {
    store.set('shared', 'habits_v2', [
      { id: 'h1', name: 'water', cue: 'before coffee', cueTime: 'morning', completions: [] },
    ]);
    mount();
    const row = container.querySelector('[aria-label="toggle habit water"]');
    expect(row).not.toBeNull();
    act(() => {
      (row as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const saved = store.get<Array<{ completions?: unknown[] }>>('shared', 'habits_v2', []);
    expect(saved[0]?.completions?.length).toBe(1);
  });
});
