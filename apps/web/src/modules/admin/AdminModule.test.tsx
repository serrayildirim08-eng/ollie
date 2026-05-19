/**
 * AdminModule · unit tests — Faz 2 regression coverage
 *
 * Two bugs this file pins down:
 *
 *  1. Smart-notice banners never appeared. The event effect listened on a
 *     phantom `window.VOID.events` bus and bailed at `if (!VOID?.events?.on)`.
 *     The orchestrator emits on the real `@ollie/events` bus. These tests
 *     emit `admin:renewal_cue` / `admin:stale_ball` and assert the banner
 *     and per-task chip surface.
 *
 *  2. Dismissing one "noticed" pattern dismissed all of them. `idOf()` read
 *     a phantom `pattern` field; orchestrator patterns carry `signal`, so
 *     every id collapsed to `'?'` and one entry in `patterns_dismissed`
 *     hid the lot. These tests seed two patterns, dismiss one, assert the
 *     other survives.
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ────────────────────────────────────────────────────────────
// Shadow apps/web/src/store.ts (which boots the full orchestrator) with an
// in-memory map + React-state-backed slice so writes trigger re-renders.

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

import { AdminModule } from './AdminModule';
import { store } from '../../store';
import * as events from '@ollie/events';

// ─── harness ───────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

function render(): void {
  act(() => {
    root.render(<AdminModule onBack={() => {}} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  __storeData.clear();
  events._clearAllHandlers();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

// ─── Bug 1 · event wiring ───────────────────────────────────────────────────

describe('AdminModule · smart-notice event wiring (@ollie/events)', () => {
  it('surfaces a renewal-cue banner when admin:renewal_cue is emitted', () => {
    store.set('admin', 'tasks', [
      { id: 'task-passport', title: 'passport renewal', label: 'passport renewal', state: 'active' },
    ]);
    render();

    expect(container.textContent).not.toContain('start the paperwork now');

    act(() => {
      events.emit('admin:renewal_cue', {
        task_id: 'task-passport',
        stage: 'early',
        days_left: 120,
        ts: Date.now(),
      });
    });

    // cueCopy('passport renewal', 'early', 120, …) → "… — 120d. start the paperwork now."
    expect(container.textContent).toContain('start the paperwork now');
  });

  it('surfaces a stale-ball chip when admin:stale_ball is emitted', () => {
    store.set('admin', 'tasks', [
      { id: 'task-lawyer', title: 'lawyer review', label: 'lawyer review', state: 'active' },
    ]);
    render();

    act(() => {
      events.emit('admin:stale_ball', {
        task_id: 'task-lawyer',
        kind: 'stale_theirs',
        days_overdue: 9,
        ts: Date.now(),
      });
    });

    expect(container.textContent).toContain("they've had it 9d");
  });

  it('ignores a renewal cue for a task that is not in the list', () => {
    store.set('admin', 'tasks', []);
    render();

    act(() => {
      events.emit('admin:renewal_cue', {
        task_id: 'ghost-task',
        stage: 'urgent',
        days_left: 2,
        ts: Date.now(),
      });
    });

    expect(container.textContent).not.toContain('today');
  });
});

// ─── Bug 2 · per-pattern dismiss ────────────────────────────────────────────

describe('AdminModule · AdminNoticed per-pattern dismiss', () => {
  it('renders one noticed card per orchestrator pattern (signal field)', () => {
    store.set('admin', 'patterns', [
      { signal: 'admin_renewal_cue', task_id: 't1', copy: 'first noticed thing', ts: 1 },
      { signal: 'admin_defer_chain', task_id: 't2', copy: 'second noticed thing', ts: 2 },
    ]);
    render();

    expect(container.textContent).toContain('first noticed thing');
    expect(container.textContent).toContain('second noticed thing');
  });

  it('dismissing one pattern leaves the others visible', () => {
    store.set('admin', 'patterns', [
      { signal: 'admin_renewal_cue', task_id: 't1', copy: 'first noticed thing', ts: 1 },
      { signal: 'admin_defer_chain', task_id: 't2', copy: 'second noticed thing', ts: 2 },
    ]);
    render();

    const dismissBtns = Array.from(
      container.querySelectorAll('button[aria-label="dismiss"]'),
    );
    expect(dismissBtns.length).toBe(2);

    act(() => {
      (dismissBtns[0] as HTMLButtonElement).click();
    });

    expect(container.textContent).not.toContain('first noticed thing');
    expect(container.textContent).toContain('second noticed thing');

    // store reflects exactly one dismissed key, not a wildcard
    const dismissed = store.get<Record<string, number>>('admin', 'patterns_dismissed', {});
    expect(Object.keys(dismissed)).toEqual(['admin_renewal_cue:t1']);
  });

  it('keeps two same-signal patterns independently dismissible', () => {
    store.set('admin', 'patterns', [
      { signal: 'admin_renewal_cue', task_id: 'a', copy: 'renew A', ts: 1 },
      { signal: 'admin_renewal_cue', task_id: 'b', copy: 'renew B', ts: 2 },
    ]);
    render();

    const dismissBtns = Array.from(
      container.querySelectorAll('button[aria-label="dismiss"]'),
    );
    act(() => {
      (dismissBtns[1] as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain('renew A');
    expect(container.textContent).not.toContain('renew B');
  });

  it('does not collapse identity-less patterns onto a single dismiss key', () => {
    // Two patterns with no `signal` — must not share one id.
    store.set('admin', 'patterns', [
      { copy: 'orphan one', ts: 1 },
      { copy: 'orphan two', ts: 2 },
    ]);
    render();

    const dismissBtns = Array.from(
      container.querySelectorAll('button[aria-label="dismiss"]'),
    );
    act(() => {
      (dismissBtns[0] as HTMLButtonElement).click();
    });

    expect(container.textContent).not.toContain('orphan one');
    expect(container.textContent).toContain('orphan two');
  });
});
