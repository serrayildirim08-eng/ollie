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

const pluginMock = {
  isPermissionGranted: vi.fn(() => Promise.resolve(false)),
  requestPermission: vi.fn(
    () => Promise.resolve('default' as 'granted' | 'denied' | 'default'),
  ),
  sendNotification: vi.fn((_opts: { title: string; body?: string }) => undefined),
};

vi.mock('@tauri-apps/plugin-notification', () => pluginMock);

// ─── imports after mocks ───────────────────────────────────────────────────

import {
  requestNotificationPermission,
  checkNotificationPermission,
  sendSystemNotification,
  installNotifyListener,
  scheduleSystemNotification,
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
    expect(pluginMock.sendNotification).toHaveBeenCalledWith({ title: 'hi', body: 'there' });
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
      expect(pluginMock.sendNotification).toHaveBeenCalledWith({
        title: 'focus done',
        body: '25 min',
      });
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
      expect(pluginMock.sendNotification).toHaveBeenCalledWith({
        title: 'overdue',
        body: undefined,
      });
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
      expect(pluginMock.sendNotification).toHaveBeenCalledWith({
        title: 'soon',
        body: 'in a bit',
      });
    });
  });
});
