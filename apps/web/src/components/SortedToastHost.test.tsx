/**
 * SortedToastHost · event subscription + toast lifecycle.
 *
 * Tests the host's reaction to:
 *   1. grocery:routed   → mode='sorted' SortedToast
 *   2. grocery:mutation → mode='removed'|'moved'|'checked'
 *   3. grocery:undone   → mode='undone'
 *   4. Multiple events in sequence → replace-with-fade (one toast at a time)
 *   5. Auto-dismiss after 3.5 s
 *
 * Strategy: mount SortedToastHost inline; fire events via @ollie/events emit;
 * assert DOM state. Timer behaviour uses vi.useFakeTimers().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { emit, _clearAllHandlers } from '@ollie/events';
import { SortedToastHost } from './SortedToastHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mountHost(): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(<SortedToastHost />);
  });
  return {
    container,
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

function emitRouted(): void {
  emit('grocery:routed', {
    idempotency_key: 'test_routed',
    raw: 'milk',
    items: [{ name: 'milk', target: 'shopping' }],
    source: 'cache',
    latency_ms: 10,
    ts: Date.now(),
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearAllHandlers();
});

afterEach(() => {
  _clearAllHandlers();
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SortedToastHost · event subscriptions', () => {
  it('grocery:routed event → mode=sorted SortedToast mounted', () => {
    const { unmount } = mountHost();

    act(() => {
      emitRouted();
    });

    // The toast should now be in the DOM (portaled to document.body)
    const toast = document.body.querySelector('[data-grocery-sorted-toast]');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('data-mode')).toBe('sorted');

    unmount();
  });

  it('grocery:undone event → mode=undone SortedToast mounted', () => {
    const { unmount } = mountHost();

    act(() => {
      emit('grocery:undone', {
        description: 'removed: pasta from shopping',
        mode: 'remove',
        ts: Date.now(),
      });
    });

    const toast = document.body.querySelector('[data-grocery-sorted-toast]');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('data-mode')).toBe('undone');

    unmount();
  });

  it('grocery:mutation event (removed) → mode=removed SortedToast mounted', () => {
    const { unmount } = mountHost();

    act(() => {
      emit('grocery:mutation', {
        mode: 'removed',
        itemName: 'pasta',
        slice: 'shopping',
        ts: Date.now(),
      });
    });

    const toast = document.body.querySelector('[data-grocery-sorted-toast]');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('data-mode')).toBe('removed');

    unmount();
  });

  it('multiple events in sequence → replace-with-fade (only one toast visible)', () => {
    const { unmount } = mountHost();

    // Fire routed first, then immediately a mutation
    act(() => {
      emitRouted();
    });

    act(() => {
      emit('grocery:mutation', {
        mode: 'checked',
        itemCount: 2,
        ts: Date.now(),
      });
    });

    // Only ONE toast should be in the DOM (replace strategy, not stack)
    const toasts = document.body.querySelectorAll('[data-grocery-sorted-toast]');
    expect(toasts.length).toBe(1);
    // The last event wins — mode='checked'
    expect(toasts[0].getAttribute('data-mode')).toBe('checked');

    unmount();
  });

  it('toast auto-dismisses after 3500 ms', () => {
    vi.useFakeTimers();
    const { unmount } = mountHost();

    act(() => {
      emit('grocery:mutation', {
        mode: 'moved',
        itemName: 'olive oil',
        ts: Date.now(),
      });
    });

    // toast visible before timeout
    expect(document.body.querySelector('[data-grocery-sorted-toast]')).not.toBeNull();

    // advance past ttl (3500ms default)
    act(() => {
      vi.advanceTimersByTime(3600);
    });

    // toast should be gone
    expect(document.body.querySelector('[data-grocery-sorted-toast]')).toBeNull();

    unmount();
  });
});
