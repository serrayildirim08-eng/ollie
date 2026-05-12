/**
 * @ollie/notifications · dispatcher + budget + aggregator tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  notify,
  cancel,
  installBackend,
  installStore,
  _resetForTests,
  _flushAggregator,
  _inspect,
  DEFAULT_BUDGET,
} from '../src/index';
import type { NotificationBackend, NotificationSpec } from '../src/types';

function makeRecordingBackend(): NotificationBackend & { calls: NotificationSpec[]; scheduled: Array<{ spec: NotificationSpec; fireAt: number }>; cancelled: string[] } {
  const calls: NotificationSpec[] = [];
  const scheduled: Array<{ spec: NotificationSpec; fireAt: number }> = [];
  const cancelled: string[] = [];
  return {
    name: 'web',
    calls,
    scheduled,
    cancelled,
    deliver(spec) { calls.push(spec); return spec.dedupe_key; },
    schedule(spec, fireAt) { scheduled.push({ spec, fireAt }); return spec.dedupe_key; },
    cancel(key) { cancelled.push(key); },
  };
}

let store: ReturnType<typeof createStore>;
let backend: ReturnType<typeof makeRecordingBackend>;

beforeEach(() => {
  vi.useFakeTimers();
  store = createStore(createMemoryAdapter());
  backend = makeRecordingBackend();
  installBackend(backend);
  installStore(store);
});

afterEach(() => {
  _resetForTests();
  vi.useRealTimers();
});

describe('notify · basic delivery', () => {
  it('delivers an immediate notification', async () => {
    const r = await notify({
      title: 'rent due in 3 days',
      category: 'REMINDER',
      dedupe_key: 'rent-1',
    });
    expect(r.delivered).toBe(true);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].title).toBe('rent due in 3 days');
  });

  it('rejects unknown categories at runtime', async () => {
    const r = await notify({
      title: 'x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      category: 'ENGAGEMENT' as any,
      dedupe_key: 'x',
    });
    expect(r.delivered).toBe(false);
    expect(backend.calls).toHaveLength(0);
  });

  it('rejects missing dedupe_key', async () => {
    const r = await notify({
      title: 'x',
      category: 'REMINDER',
      dedupe_key: '',
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('dedupe');
  });
});

describe('notify · dedupe', () => {
  it('drops the second call within 24h with the same dedupe_key', async () => {
    await notify({ title: 'a', category: 'REMINDER', dedupe_key: 'k' });
    const r = await notify({ title: 'a', category: 'REMINDER', dedupe_key: 'k' });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('dedupe');
    expect(backend.calls).toHaveLength(1);
  });
});

describe('notify · budget', () => {
  it('enforces default daily cap', async () => {
    for (let i = 0; i < DEFAULT_BUDGET.daily_cap; i++) {
      await notify({ title: `r${i}`, category: 'REMINDER', dedupe_key: `r${i}` });
    }
    const r = await notify({ title: 'overflow', category: 'REMINDER', dedupe_key: 'overflow' });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('budget');
  });

  it('respects per-category mute', async () => {
    store.set('shared', 'settings.notification_budget', {
      ...DEFAULT_BUDGET,
      muted_categories: ['PATTERN_ALERT'],
    });
    const r = await notify({
      title: 'canva — $20 monthly for 3 months. cancel?',
      category: 'PATTERN_ALERT',
      dedupe_key: 'sub-canva',
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('muted');
  });
});

describe('notify · scheduling', () => {
  it('schedules a future notification — backend owns the fire when it returns a platformId (NC6)', async () => {
    const fireAt = Date.now() + 5_000;
    const r = await notify({
      title: 'vet med 5am',
      category: 'REMINDER',
      dedupe_key: 'med-1',
      schedule_at: fireAt,
    });
    expect(r.reason).toBe('scheduled');
    expect(backend.scheduled).toHaveLength(1);
    // Credibility audit NC6: when the backend returns a truthy platform
    // id (modeled by our fake), the JS in-process timer is skipped to
    // avoid double-firing on Capacitor / Electron.
    expect(_inspect().scheduledCount).toBe(0);
    expect(backend.calls.length).toBe(0);
  });

  it('falls back to in-process timer when the backend returns no platform id', async () => {
    // Replace the schedule mock so it returns undefined → fallback path.
    backend.schedule = () => undefined;
    const fireAt = Date.now() + 5_000;
    await notify({
      title: 'fallback fire',
      category: 'REMINDER',
      dedupe_key: 'fb-1',
      schedule_at: fireAt,
    });
    expect(_inspect().scheduledCount).toBe(1);
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    expect(backend.calls.length).toBe(1);
    expect(backend.calls[0].title).toBe('fallback fire');
  });

  it('cancel() removes a pending scheduled notification', async () => {
    // Use fallback path so the in-process timer is present to cancel.
    backend.schedule = () => undefined;
    await notify({
      title: 'x',
      category: 'REMINDER',
      dedupe_key: 'c1',
      schedule_at: Date.now() + 10_000,
    });
    expect(_inspect().scheduledCount).toBe(1);
    cancel('c1');
    expect(_inspect().scheduledCount).toBe(0);
    expect(backend.cancelled).toContain('c1');
  });
});

describe('notify · aggregation', () => {
  it('coalesces multiple items with the same aggregation_group into one digest', async () => {
    await notify({
      title: 'doctor 14:30',
      category: 'REMINDER',
      dedupe_key: 'doc',
      aggregation_group: 'morning',
    });
    await notify({
      title: 'regl 2-3 gün içinde',
      category: 'PATTERN_ALERT',
      dedupe_key: 'cyc',
      aggregation_group: 'morning',
    });
    await notify({
      title: 'canva $20 dün çekildi',
      category: 'PATTERN_ALERT',
      dedupe_key: 'sub',
      aggregation_group: 'morning',
    });
    // Buffered, not yet delivered:
    expect(backend.calls.length).toBe(0);
    expect(_inspect().bufferedCount).toBe(3);

    _flushAggregator();
    await Promise.resolve();

    expect(backend.calls.length).toBe(1);
    expect(backend.calls[0].title).toMatch(/today:/);
    expect(backend.calls[0].title).toMatch(/doctor 14:30/);
    expect(backend.calls[0].extra?.aggregated_count).toBe(3);
  });

  it('seeds with 8 events same group → still produces 1 digest', async () => {
    for (let i = 0; i < 8; i++) {
      await notify({
        title: `event ${i}`,
        category: 'REMINDER',
        dedupe_key: `e${i}`,
        aggregation_group: 'window-1',
      });
    }
    _flushAggregator();
    await Promise.resolve();
    expect(backend.calls.length).toBe(1);
  });
});

describe('notify · constitutional category enforcement', () => {
  it('accepts only REMINDER / PATTERN_ALERT / CONTENT_DELIVERY', async () => {
    for (const cat of ['REMINDER', 'PATTERN_ALERT', 'CONTENT_DELIVERY'] as const) {
      const r = await notify({ title: cat, category: cat, dedupe_key: cat });
      expect(r.delivered).toBe(true);
    }
    expect(backend.calls.length).toBe(3);
  });
});

describe('notify · Fix 4 astrology consent gate', () => {
  it('drops daily-reading delivery when consent.astrology is false', async () => {
    // Default: consent.astrology is false (never set).
    const r = await notify({
      title: 'today, the moon is in capricorn',
      category: 'CONTENT_DELIVERY',
      dedupe_key: 'daily-reading-2026-05-12',
      extra: { feature: 'daily-reading' },
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('muted');
    expect(backend.calls.length).toBe(0);
  });

  it('delivers daily-reading when consent.astrology is true', async () => {
    store.set('shared', 'consent.astrology', true);
    const r = await notify({
      title: 'today, the moon is in capricorn',
      category: 'CONTENT_DELIVERY',
      dedupe_key: 'daily-reading-2026-05-12',
      extra: { feature: 'daily-reading' },
    });
    expect(r.delivered).toBe(true);
    expect(backend.calls.length).toBe(1);
  });

  it('does NOT gate non-astrology CONTENT_DELIVERY (e.g. morning digest)', async () => {
    // consent.astrology stays false — non-astrology feature still goes through.
    const r = await notify({
      title: 'morning digest',
      category: 'CONTENT_DELIVERY',
      dedupe_key: 'morning-digest-2026-05-12',
      extra: { feature: 'morning-digest' },
    });
    expect(r.delivered).toBe(true);
    expect(backend.calls.length).toBe(1);
  });

  it('gates transit-ping feature too', async () => {
    const r = await notify({
      title: 'mars retrograde',
      category: 'CONTENT_DELIVERY',
      dedupe_key: 'transit-mars-retrograde',
      extra: { feature: 'transit-ping' },
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe('muted');
  });
});
