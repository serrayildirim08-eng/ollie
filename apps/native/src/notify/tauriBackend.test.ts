/**
 * apps/native · notify/tauriBackend — audit S8 · gap 2
 *
 * The cadence-scanner fires overdue cues through @ollie/notifications.notify().
 * apps/native never installed a backend, so notify() hit the NOOP backend and
 * nothing reached the device. This test pins that installing tauriBackend makes
 * notify() deliver a cadence-style cue through the REAL Tauri OS path
 * (systemNotify), not NOOP — and that schedule() takes ownership of the fire so
 * the dispatcher doesn't double-arm a fallback timer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  installBackend,
  installStore,
  notify,
  _resetForTests,
  _inspect,
  type NotificationSpec,
} from '@ollie/notifications';

// Stub the OS hand-off so we can assert the backend routed to it.
vi.mock('./systemNotify', () => ({
  sendSystemNotification: vi.fn(async () => {}),
  scheduleAt: vi.fn(() => ({ cancel: () => {} })),
  requestNotificationPermission: vi.fn(async () => true),
  checkNotificationPermission: vi.fn(async () => 'granted'),
}));

import { tauriBackend } from './tauriBackend';
import * as systemNotify from './systemNotify';

describe('tauriBackend · S8 gap 2 (cadence cue → real backend)', () => {
  beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
  });

  it('notify() delivers a cadence cue through Tauri, not noop', async () => {
    installBackend(tauriBackend);
    installStore(createStore(createMemoryAdapter()));
    expect(_inspect().backend).toBe('tauri');

    const res = await notify({
      title: 'running low on coffee',
      category: 'PATTERN_ALERT',
      dedupe_key: 'cadence:grocery:coffee:2026-06-25',
      action_url: '/grocery',
    });

    expect(res.delivered).toBe(true);
    expect(systemNotify.sendSystemNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(systemNotify.sendSystemNotification).mock.calls[0]?.[0]?.title).toBe(
      'running low on coffee',
    );
  });

  it('schedule() hands off to scheduleAt and returns a truthy id (no double-fire)', () => {
    const spec = {
      title: 'bill due',
      category: 'REMINDER',
      dedupe_key: 'finance:bill:rent',
    } as NotificationSpec;
    const id = tauriBackend.schedule(spec, Date.now() + 60_000);
    expect(id).toBe('finance:bill:rent');
    expect(systemNotify.scheduleAt).toHaveBeenCalledTimes(1);
  });
});
