import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseReminder } from '../src/reminders';
import { createReminderScheduler } from '../src/scheduler';
import { createMemoryAdapter } from '@ollie/store';
import { createStore } from '@ollie/store';
import * as events from '@ollie/events';

// ─── parseReminder ────────────────────────────────────────────────────────────

describe('parseReminder', () => {
  const NOW = 1_700_000_000_000; // fixed epoch for determinism

  it('parses "in 5 minutes"', () => {
    const r = parseReminder('in 5 minutes', NOW);
    expect(r).not.toBeNull();
    expect(r!.datetime).toBeGreaterThanOrEqual(NOW + 5 * 60000);
    expect(r!.status).toBe('scheduled');
    expect(r!.id).toBeTruthy();
  });

  it('parses "in 3 days"', () => {
    const r = parseReminder('pay rent in 3 days', NOW);
    expect(r).not.toBeNull();
    expect(r!.datetime).toBeGreaterThanOrEqual(NOW + 3 * 86400000);
    expect(r!.body).not.toBe('');
  });

  it('parses "tomorrow at 9am"', () => {
    const r = parseReminder('call vet tomorrow at 9am', NOW);
    expect(r).not.toBeNull();
    // datetime should be roughly NOW + ~1 day (within a day's tolerance)
    expect(r!.datetime).toBeGreaterThan(NOW);
    expect(r!.body).toContain('call vet');
  });

  it('parses TR "5 gün sonra" (locale tr)', () => {
    const r = parseReminder('kira 5 gün sonra', NOW, 'tr');
    expect(r).not.toBeNull();
    expect(r!.datetime).toBeGreaterThanOrEqual(NOW + 5 * 86400000);
    expect(r!.body).toBeTruthy();
  });

  it('returns null for bad input', () => {
    expect(parseReminder('', NOW)).toBeNull();
    expect(parseReminder('just a grocery item', NOW)).toBeNull();
    // @ts-expect-error intentional runtime check
    expect(parseReminder(null, NOW)).toBeNull();
  });

  it('generates unique ids', () => {
    const a = parseReminder('in 1 hour', NOW);
    const b = parseReminder('in 1 hour', NOW + 1);
    expect(a!.id).not.toBe(b!.id);
  });

  // ─── #1 chrono-node: explicit time must survive ─────────────────────────────
  // Regression: the old pattern table dropped the time from "next friday at
  // 6pm" and resolved to 09:00. chrono-node keeps the 18:00.
  describe('explicit-time regression (chrono-node)', () => {
    it('"next friday at 6pm" resolves to 18:00, not 09:00', () => {
      const r = parseReminder('call mom next friday at 6pm', NOW);
      expect(r).not.toBeNull();
      const d = new Date(r!.datetime);
      expect(d.getHours()).toBe(18);
      expect(d.getMinutes()).toBe(0);
      expect(d.getDay()).toBe(5); // Friday
      expect(r!.datetime).toBeGreaterThan(NOW);
    });

    it('"next monday at 7:30am" keeps both hour and minute', () => {
      const r = parseReminder('standup next monday at 7:30am', NOW);
      expect(r).not.toBeNull();
      const d = new Date(r!.datetime);
      expect(d.getHours()).toBe(7);
      expect(d.getMinutes()).toBe(30);
      expect(d.getDay()).toBe(1); // Monday
    });

    it('"tomorrow at 6pm" keeps the explicit time', () => {
      const r = parseReminder('vet tomorrow at 6pm', NOW);
      expect(r).not.toBeNull();
      const d = new Date(r!.datetime);
      expect(d.getHours()).toBe(18);
    });
  });

  // ─── #1 hour/minute bounds validation ───────────────────────────────────────
  describe('clock-time bounds validation', () => {
    it('rejects "99:88" — out-of-range hours and minutes', () => {
      expect(parseReminder('remind me at 99:88', NOW)).toBeNull();
    });

    it('rejects "25:00" — out-of-range hours', () => {
      expect(parseReminder('meeting at 25:00', NOW)).toBeNull();
    });

    it('rejects "12:75" — out-of-range minutes', () => {
      expect(parseReminder('lunch at 12:75', NOW)).toBeNull();
    });

    it('still accepts a valid edge time "23:59"', () => {
      const r = parseReminder('wrap up at 23:59', NOW);
      expect(r).not.toBeNull();
      const d = new Date(r!.datetime);
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(59);
    });
  });
});

// ─── scheduler ───────────────────────────────────────────────────────────────

describe('createReminderScheduler', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore(createMemoryAdapter());
    events._clearAllHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
    events._clearAllHandlers();
  });

  it('fires toast and updates status after delay', () => {
    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    const toastPayloads: unknown[] = [];
    events.on('void:toast', (p) => toastPayloads.push(p));

    const NOW = Date.now();
    const reminder = {
      id: 'test-1',
      module: 'finance',
      action: 'remind',
      datetime: NOW + 50,
      body: 'pay rent',
      status: 'scheduled' as const,
    };

    scheduler.add(reminder);
    expect(toastPayloads).toHaveLength(0);

    vi.advanceTimersByTime(100);

    expect(toastPayloads).toHaveLength(1);
    expect((toastPayloads[0] as { message: string }).message).toBe('pay rent');

    // status updated in store
    const items = store.get<typeof reminder[]>('reminders', 'items', []);
    expect(items[0].status).toBe('fired');
  });

  it('cancel removes timer and sets status cancelled', () => {
    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    const toastPayloads: unknown[] = [];
    events.on('void:toast', (p) => toastPayloads.push(p));

    const NOW = Date.now();
    const reminder = {
      id: 'test-2',
      module: 'dump',
      action: 'remind',
      datetime: NOW + 5000,
      body: 'something',
      status: 'scheduled' as const,
    };

    scheduler.add(reminder);
    scheduler.cancel('test-2');

    vi.advanceTimersByTime(10000);
    expect(toastPayloads).toHaveLength(0);

    const items = store.get<typeof reminder[]>('reminders', 'items', []);
    expect(items[0].status).toBe('cancelled');
  });

  it('init reschedules existing future reminders from store', () => {
    const NOW = Date.now();
    const reminder = {
      id: 'test-3',
      module: 'admin',
      action: 'remind',
      datetime: NOW + 200,
      body: 'renew passport',
      status: 'scheduled' as const,
    };
    store.set('reminders', 'items', [reminder]);

    const toastPayloads: unknown[] = [];
    events.on('void:toast', (p) => toastPayloads.push(p));

    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    expect(toastPayloads).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(toastPayloads).toHaveLength(1);
    expect((toastPayloads[0] as { message: string }).message).toBe('renew passport');

    // status updated in store
    const items = store.get<typeof reminder[]>('reminders', 'items', []);
    expect(items[0].status).toBe('fired');
  });
});
