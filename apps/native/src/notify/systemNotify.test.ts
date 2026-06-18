/**
 * systemNotify · unit tests
 *
 * Coverage:
 *   1. Tauri plugin available → permission flow + sendNotification fires
 *   2. Permission denied path → sendNotification not called, no throw
 *   3. No Tauri context (no __TAURI_INTERNALS__) → console.log fallback
 *   4. installNotifyListener wires the ollie:notify event
 *   5. Malformed event detail is dropped (no plugin call)
 *   6. scheduleSystemNotification — immediate vs future fireAt
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── plugin mock ───────────────────────────────────────────────────────────

interface SendNotificationOpts {
  title: string;
  body?: string;
  schedule?: unknown;
}

const scheduleAtMock = vi.fn((date: Date) => ({ kind: 'at-schedule', date }));

const pluginMock = {
  isPermissionGranted: vi.fn(() => Promise.resolve(false)),
  requestPermission: vi.fn(
    () => Promise.resolve('default' as 'granted' | 'denied' | 'default'),
  ),
  sendNotification: vi.fn((_opts: SendNotificationOpts) => undefined),
  Schedule: {
    at: scheduleAtMock,
  },
};

vi.mock('@tauri-apps/plugin-notification', () => pluginMock);

// Mock the Tauri event bridge so scheduleAt's durable native path
// (emit 'ollie-schedule-notif' / 'ollie-cancel-notif') is observable without a
// running Tauri shell. The localhost webview's ACL blocks direct invoke() of
// app commands, so the durable path EMITs events the Rust setup listener
// schedules from. Default resolves; individual tests override with
// mockRejectedValue to exercise the setTimeout fallback.
const emitMock = vi.fn((_event: string, _payload?: unknown) =>
  Promise.resolve(undefined),
);

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
}));

// ─── imports after mocks ───────────────────────────────────────────────────

import {
  requestNotificationPermission,
  checkNotificationPermission,
  sendSystemNotification,
  installNotifyListener,
  scheduleSystemNotification,
  scheduleAt,
  loadNotificationPlugin,
  _resetPluginCacheForTests,
  NOTIFY_EVENT,
} from './systemNotify';
import type { NotificationSpec } from '@ollie/notifications';

// ─── helpers ───────────────────────────────────────────────────────────────

function setTauriContext(present: boolean): void {
  if (present) {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      // minimal stub — loadNotificationPlugin only checks truthiness
      ipc: () => {},
    };
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  _resetPluginCacheForTests();
  pluginMock.isPermissionGranted.mockReset();
  pluginMock.requestPermission.mockReset();
  pluginMock.sendNotification.mockReset();
  scheduleAtMock.mockClear();
  scheduleAtMock.mockImplementation((date: Date) => ({ kind: 'at-schedule', date }));
  emitMock.mockReset();
  emitMock.mockImplementation(() => Promise.resolve(undefined));
  setTauriContext(false);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setTauriContext(false);
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('loadNotificationPlugin', () => {
  it('returns null when not in a Tauri context', async () => {
    setTauriContext(false);
    const plugin = await loadNotificationPlugin();
    expect(plugin).toBeNull();
  });

  it('returns the plugin api when in a Tauri context', async () => {
    setTauriContext(true);
    const plugin = await loadNotificationPlugin();
    expect(plugin).not.toBeNull();
    expect(typeof plugin?.sendNotification).toBe('function');
  });

  it('caches the result', async () => {
    setTauriContext(true);
    const a = await loadNotificationPlugin();
    const b = await loadNotificationPlugin();
    expect(a).toBe(b);
  });
});

describe('requestNotificationPermission', () => {
  it('returns false when there is no plugin', async () => {
    setTauriContext(false);
    expect(await requestNotificationPermission()).toBe(false);
  });

  it('returns true without prompting when already granted', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    expect(await requestNotificationPermission()).toBe(true);
    expect(pluginMock.requestPermission).not.toHaveBeenCalled();
  });

  it('prompts when not granted and returns true on grant', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(false);
    pluginMock.requestPermission.mockResolvedValue('granted');
    expect(await requestNotificationPermission()).toBe(true);
    expect(pluginMock.requestPermission).toHaveBeenCalledOnce();
  });

  it('prompts when not granted and returns false on denial', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(false);
    pluginMock.requestPermission.mockResolvedValue('denied');
    expect(await requestNotificationPermission()).toBe(false);
  });

  it('never throws on plugin failure', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockRejectedValue(new Error('boom'));
    expect(await requestNotificationPermission()).toBe(false);
  });
});

describe('checkNotificationPermission', () => {
  it('returns "default" with no plugin', async () => {
    setTauriContext(false);
    expect(await checkNotificationPermission()).toBe('default');
  });

  it('returns "granted" when already granted', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    expect(await checkNotificationPermission()).toBe('granted');
  });

  it('returns "default" when not yet granted (no prompt)', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(false);
    expect(await checkNotificationPermission()).toBe('default');
    expect(pluginMock.requestPermission).not.toHaveBeenCalled();
  });
});

describe('sendSystemNotification', () => {
  it('logs to console when no plugin', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setTauriContext(false);
    await sendSystemNotification({ title: 'hi', body: 'there' });
    expect(logSpy).toHaveBeenCalled();
    const msg = logSpy.mock.calls[0]?.[0];
    expect(typeof msg).toBe('string');
    expect(msg as string).toContain('hi');
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('calls plugin.sendNotification when granted', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    await sendSystemNotification({ title: 'hi', body: 'there' });
    expect(pluginMock.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'hi', body: 'there' }),
    );
  });

  it('drops the notification silently when permission not granted', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(false);
    await sendSystemNotification({ title: 'hi' });
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
  });

  it('never throws when the plugin sendNotification throws', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    pluginMock.sendNotification.mockImplementation(() => {
      throw new Error('native crash');
    });
    await expect(sendSystemNotification({ title: 'hi' })).resolves.toBeUndefined();
  });
});

describe('installNotifyListener', () => {
  it('wires ollie:notify to sendSystemNotification', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const teardown = installNotifyListener();

    window.dispatchEvent(
      new CustomEvent(NOTIFY_EVENT, { detail: { title: 'focus done', body: '25 min' } }),
    );

    // Drain the microtask queue inside the handler.
    await vi.waitFor(() => {
      expect(pluginMock.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'focus done', body: '25 min' }),
      );
    });

    teardown();
  });

  it('teardown removes the listener', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const teardown = installNotifyListener();
    teardown();

    window.dispatchEvent(
      new CustomEvent(NOTIFY_EVENT, { detail: { title: 'after teardown' } }),
    );

    // Give microtasks a chance to run.
    await Promise.resolve();
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
  });

  it('drops malformed events (missing detail.title)', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const teardown = installNotifyListener();

    window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: {} as { title: string } }));
    window.dispatchEvent(new CustomEvent(NOTIFY_EVENT));

    await Promise.resolve();
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
    teardown();
  });
});

describe('scheduleSystemNotification', () => {
  it('fires immediately when fireAt is in the past', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const spec: NotificationSpec = {
      title: 'overdue',
      category: 'PATTERN_ALERT',
      dedupe_key: 'test:overdue',
    };
    scheduleSystemNotification(spec, Date.now() - 1000);

    await vi.waitFor(() => {
      expect(pluginMock.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'overdue' }),
      );
    });
  });

  it('schedules a timer when fireAt is in the future', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const spec: NotificationSpec = {
      title: 'soon',
      body: 'in a bit',
      category: 'REMINDER',
      dedupe_key: 'test:soon',
    };
    scheduleSystemNotification(spec, Date.now() + 5000);

    expect(pluginMock.sendNotification).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5001);

    await vi.waitFor(() => {
      expect(pluginMock.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'soon', body: 'in a bit' }),
      );
    });
  });
});

// ─── scheduleAt (ad-hoc reminders) ────────────────────────────────────────

describe('scheduleAt', () => {
  it('fires immediately when fireAt is now / in the past (no native schedule)', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    scheduleAt(Date.now() - 100, { title: 'gone', body: 'past' }, 'reminder:past');

    await vi.waitFor(() => {
      expect(pluginMock.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'gone', body: 'past' }),
      );
    });
    // Immediate path never touches the OS scheduler or the native plugin sched.
    expect(emitMock).not.toHaveBeenCalled();
    expect(scheduleAtMock).not.toHaveBeenCalled();
  });

  it('hands a future reminder to the OS via the ollie-schedule-notif event in Tauri (no double-fire)', async () => {
    // Durable path: the native listener holds the notification so it fires even
    // after the app quits. We must NOT also arm a setTimeout, or it would
    // double-fire (OS + in-process timer) once the timer elapses.
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const fireAt = Date.now() + 60_000;
    scheduleAt(fireAt, { title: 'call', body: 'mama' }, 'reminder:call-mama');

    // Let the async loader + emit settle.
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith('ollie-schedule-notif', {
        id: 'reminder:call-mama',
        title: 'call',
        body: 'mama',
        fire_at_ms: fireAt,
        category_id: null,
        extra_json: null,
      });
    });

    // Advancing past the fire time must NOT trigger an in-process send — the
    // OS owns delivery, so no setTimeout was armed (no double-fire).
    await vi.advanceTimersByTimeAsync(60_001);
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
    expect(scheduleAtMock).not.toHaveBeenCalled();
  });

  it('falls back to setTimeout outside Tauri (web preview / vitest)', async () => {
    setTauriContext(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    scheduleAt(Date.now() + 3_000, { title: 'remember', body: 'thing' }, 'reminder:remember');

    // No native scheduler reachable — the OS event is never emitted.
    expect(emitMock).not.toHaveBeenCalled();
    expect(scheduleAtMock).not.toHaveBeenCalled();

    // Let the async loader settle so the setTimeout is registered.
    await vi.advanceTimersByTimeAsync(0);
    expect(logSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_001);

    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalled();
      const msg = logSpy.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('remember'));
      expect(msg).toBeDefined();
    });
    expect(emitMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('falls back to setTimeout when the native emit rejects', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    emitMock.mockRejectedValue(new Error('event blocked'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scheduleAt(Date.now() + 4_000, { title: 'fallback', body: 'ping' }, 'reminder:fallback');

    // The native attempt happened and rejected; we should warn and arm a timer.
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        'ollie-schedule-notif',
        expect.objectContaining({ id: 'reminder:fallback' }),
      );
    });

    await vi.advanceTimersByTimeAsync(4_001);
    await vi.waitFor(() => {
      expect(pluginMock.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'fallback', body: 'ping' }),
      );
    });
    warnSpy.mockRestore();
  });

  it('cancel() in the fallback path clears the timer before it fires', async () => {
    setTauriContext(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handle = scheduleAt(Date.now() + 5_000, { title: 'unwanted', body: 'cancel' }, 'reminder:unwanted');

    // Allow the async loader to settle and the setTimeout to be registered.
    await vi.advanceTimersByTimeAsync(0);

    handle.cancel();
    await vi.advanceTimersByTimeAsync(10_000);

    // Nothing fired — the timer was cleared. No native cancel either (fallback).
    const calls = logSpy.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('unwanted'));
    expect(calls).toHaveLength(0);
    expect(emitMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('cancel() emits ollie-cancel-notif in Tauri context', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const handle = scheduleAt(Date.now() + 60_000, { title: 'oops', body: 'cancel' }, 'reminder:oops');

    // Let the schedule emit land so cancel knows it went native.
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        'ollie-schedule-notif',
        expect.objectContaining({ id: 'reminder:oops' }),
      );
    });

    handle.cancel();

    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith('ollie-cancel-notif', 'reminder:oops');
    });

    // Nothing ever fired in-process.
    await vi.advanceTimersByTimeAsync(60_001);
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
    expect(scheduleAtMock).not.toHaveBeenCalled();
  });

  // ── #27: cancel() racing the async native-schedule path ──────────────────

  it('#27 cancel() before the schedule emit commits ABORTS the schedule (no ollie-schedule-notif)', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    // Cancel synchronously, the instant after scheduleAt returns — before the
    // async plugin loader / emit has had a chance to run. The synchronous
    // `cancelled` flag must abort the schedule so the OS never holds it.
    const handle = scheduleAt(Date.now() + 60_000, { title: 'undo me', body: 'fast' }, 'reminder:undo');
    handle.cancel();

    // Drain all pending async work (loader + the cancel's own loader call).
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      // cancel() always emits the idempotent native cancel in a Tauri context.
      expect(emitMock).toHaveBeenCalledWith('ollie-cancel-notif', 'reminder:undo');
    });

    // The schedule must NEVER have been committed — the race was won by cancel.
    const scheduleEmits = emitMock.mock.calls.filter((c) => c[0] === 'ollie-schedule-notif');
    expect(scheduleEmits).toHaveLength(0);

    // And nothing fires after the fire time elapses.
    await vi.advanceTimersByTimeAsync(60_001);
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
  });

  it('#27 cancel() always emits the idempotent native cancel even if cancel beats the loader', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);

    const handle = scheduleAt(Date.now() + 30_000, { title: 'race', body: 'x' }, 'reminder:race');
    // Cancel immediately — before any async settles.
    handle.cancel();

    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith('ollie-cancel-notif', 'reminder:race');
    });
  });

  it('#27 cancel() off-Tauri stays a pure timer-clear — never emits a native cancel', async () => {
    setTauriContext(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handle = scheduleAt(Date.now() + 5_000, { title: 'web', body: 'cancel' }, 'reminder:web');
    await vi.advanceTimersByTimeAsync(0);
    handle.cancel();
    await vi.advanceTimersByTimeAsync(10_000);

    // No native cancel event off-Tauri; the timer clear is sufficient.
    expect(emitMock).not.toHaveBeenCalled();
    const calls = logSpy.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('web'));
    expect(calls).toHaveLength(0);
    logSpy.mockRestore();
  });

  // ── #92: defensive upper-horizon guard ──────────────────────────────────

  it('#92 drops a fire time beyond the 1-year horizon — no emit, no timer', async () => {
    setTauriContext(true);
    pluginMock.isPermissionGranted.mockResolvedValue(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tooFar = Date.now() + 366 * 24 * 60 * 60 * 1000;
    const handle = scheduleAt(tooFar, { title: 'far', body: 'future' }, 'reminder:far');

    await vi.advanceTimersByTimeAsync(0);
    expect(emitMock).not.toHaveBeenCalled();
    expect(pluginMock.sendNotification).not.toHaveBeenCalled();
    // cancel() on the no-op handle is safe.
    expect(() => handle.cancel()).not.toThrow();
    warnSpy.mockRestore();
  });
});
