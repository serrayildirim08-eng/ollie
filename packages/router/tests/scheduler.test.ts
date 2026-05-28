/**
 * @ollie/router · reminder scheduler tests
 *
 * Focus: audit item #2 — setTimeout's 32-bit (2^31-1 ms ≈ 24.8 day)
 * delay ceiling. A raw setTimeout with a larger delay fires IMMEDIATELY;
 * the scheduler must clamp + re-arm instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter, type Store } from '@ollie/store';
import * as events from '@ollie/events';
import { createReminderScheduler } from '../src/scheduler';
import type { Reminder } from '../src/types';

const FIXED_NOW = new Date('2026-05-18T12:00:00Z').getTime();
const MAX_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    module: 'dump',
    action: 'remind',
    datetime: FIXED_NOW + 60_000,
    body: 'do the thing',
    status: 'scheduled',
    ...over,
  };
}

describe('@ollie/router · reminder scheduler', () => {
  let store: Store;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    events._clearAllHandlers();
    vi.useRealTimers();
  });

  it('fires a normal near-future reminder at its datetime', () => {
    const sched = createReminderScheduler(store, events);
    let fired = '';
    events.on('void:toast', (p) => { fired = (p as { message: string }).message; });

    sched.add(reminder({ datetime: FIXED_NOW + 60_000, body: 'soon' }));
    expect(fired).toBe('');
    vi.advanceTimersByTime(60_000);
    expect(fired).toBe('soon');
    sched.teardown();
  });

  it('does NOT fire a >24.8-day reminder immediately (overflow clamp)', () => {
    const sched = createReminderScheduler(store, events);
    let fired = false;
    events.on('void:toast', () => { fired = true; });

    // 40 days out — well past the 2^31-1 ms ceiling.
    const fortyDays = 40 * 86_400_000;
    sched.add(reminder({ datetime: FIXED_NOW + fortyDays }));

    // A raw setTimeout(delay) here would have fired on the next tick.
    vi.advanceTimersByTime(1000);
    expect(fired).toBe(false);

    // Still not fired even after a full max-timeout window.
    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(fired).toBe(false);
    sched.teardown();
  });

  it('eventually fires a >24.8-day reminder after re-arming', () => {
    const sched = createReminderScheduler(store, events);
    let fired = false;
    events.on('void:toast', () => { fired = true; });

    const fortyDays = 40 * 86_400_000;
    sched.add(reminder({ datetime: FIXED_NOW + fortyDays }));

    // Advance the whole 40 days; the scheduler re-arms once at the
    // ceiling, then fires the remaining ~15.2-day delay.
    vi.advanceTimersByTime(fortyDays);
    expect(fired).toBe(true);
    sched.teardown();
  });

  it('a long reminder cancelled mid-wait does NOT fire on re-arm', () => {
    const sched = createReminderScheduler(store, events);
    let fired = false;
    events.on('void:toast', () => { fired = true; });

    const fortyDays = 40 * 86_400_000;
    sched.add(reminder({ id: 'long', datetime: FIXED_NOW + fortyDays }));

    // Cancel before the first re-arm window elapses.
    vi.advanceTimersByTime(1_000_000);
    sched.cancel('long');

    vi.advanceTimersByTime(fortyDays);
    expect(fired).toBe(false);
    sched.teardown();
  });

  it('fires a reminder exactly at the max-timeout boundary in one timer', () => {
    const sched = createReminderScheduler(store, events);
    let fired = false;
    events.on('void:toast', () => { fired = true; });

    // Exactly the ceiling — must still be a single timer, not re-armed,
    // and must not fire early.
    sched.add(reminder({ datetime: FIXED_NOW + MAX_TIMEOUT_MS }));
    vi.advanceTimersByTime(MAX_TIMEOUT_MS - 1);
    expect(fired).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fired).toBe(true);
    sched.teardown();
  });
});
