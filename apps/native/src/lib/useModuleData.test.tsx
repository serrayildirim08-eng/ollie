/**
 * useModuleData · lifecycle + migration-once-guard tests (audit #35, #133)
 *
 * Verifies:
 *  - migrate runs before refresh, then `ready` flips true
 *  - the migration runs AT MOST ONCE per module per session even across
 *    remounts (#133 — StrictMode/route flips previously re-ran it)
 *  - a FAILED migration is not cached as done — the next mount retries
 *  - the poll interval + window-focus both trigger refresh
 *  - onFirstLoad fires once, after the first load
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import {
  useModuleData,
  _resetModuleMigrations,
  POLL_MS,
} from './useModuleData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  _resetModuleMigrations();
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function Harness(props: Parameters<typeof useModuleData>[0]): JSX.Element {
  const { ready } = useModuleData(props);
  return React.createElement('span', null, ready ? 'ready' : 'loading');
}

async function flush() {
  // Let the queued microtasks (the async migrate→refresh chain) settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useModuleData', () => {
  it('runs migrate then refresh then flips ready', async () => {
    const order: string[] = [];
    const migrate = vi.fn(async () => {
      order.push('migrate');
    });
    const refresh = vi.fn(async () => {
      order.push('refresh');
    });

    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'm1', migrate, refresh }));
    });
    await flush();

    expect(order).toEqual(['migrate', 'refresh']);
    expect(container.textContent).toBe('ready');
  });

  it('runs the migration at most once per module across remounts (#133)', async () => {
    const migrate = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});

    // First mount.
    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'once', migrate, refresh }));
    });
    await flush();

    // Unmount + remount (simulates a route flip / StrictMode double-invoke).
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'once', migrate, refresh }));
    });
    await flush();

    expect(migrate).toHaveBeenCalledTimes(1); // guard held
    // refresh still runs on every mount.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT cache a failed migration — next mount retries (#133)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient lock'))
      .mockResolvedValue(undefined);
    const refresh = vi.fn(async () => {});

    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'retry', migrate, refresh }));
    });
    await flush();
    // First migration rejected → never reached refresh → not ready.
    expect(container.textContent).toBe('loading');

    // Remount: the rejection must NOT have been cached, so migrate runs again.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'retry', migrate, refresh }));
    });
    await flush();

    expect(migrate).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('ready');
    errSpy.mockRestore();
  });

  it('polls refresh on the interval and on window focus', async () => {
    const migrate = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});

    await act(async () => {
      root.render(React.createElement(Harness, { migrationKey: 'poll', migrate, refresh }));
    });
    await flush();
    const afterMount = refresh.mock.calls.length; // initial load

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(refresh.mock.calls.length).toBe(afterMount + 1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh.mock.calls.length).toBe(afterMount + 2);
  });

  it('fires onFirstLoad once, after the first load', async () => {
    const migrate = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    const onFirstLoad = vi.fn();

    await act(async () => {
      root.render(
        React.createElement(Harness, { migrationKey: 'fl', migrate, refresh, onFirstLoad }),
      );
    });
    await flush();

    expect(onFirstLoad).toHaveBeenCalledTimes(1);
    // It receives a cancelled() probe that is false while mounted.
    const probe = onFirstLoad.mock.calls[0][0] as () => boolean;
    expect(probe()).toBe(false);
  });
});
