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

  it('fires event and updates status after delay', () => {
    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    const firedPayloads: unknown[] = [];
    const toastPayloads: unknown[] = [];
    events.on('void:reminder:fired', (p) => firedPayloads.push(p));
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
    expect(firedPayloads).toHaveLength(0);

    vi.advanceTimersByTime(100);

    expect(firedPayloads).toHaveLength(1);
    expect((firedPayloads[0] as { id: string }).id).toBe('test-1');
    expect(toastPayloads).toHaveLength(1);
    expect((toastPayloads[0] as { message: string }).message).toBe('pay rent');

    // status updated in store
    const items = store.get<typeof reminder[]>('reminders', 'items', []);
    expect(items[0].status).toBe('fired');
  });

  it('cancel removes timer and sets status cancelled', () => {
    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    const firedPayloads: unknown[] = [];
    events.on('void:reminder:fired', (p) => firedPayloads.push(p));

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
    expect(firedPayloads).toHaveLength(0);

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

    const firedPayloads: unknown[] = [];
    events.on('void:reminder:fired', (p) => firedPayloads.push(p));

    const scheduler = createReminderScheduler(store, events);
    scheduler.init();

    expect(firedPayloads).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(firedPayloads).toHaveLength(1);
    expect((firedPayloads[0] as { id: string }).id).toBe('test-3');
  });
});
