/**
 * createReminderScheduler
 *
 * Manages setTimeout handles for future reminders.
 * On fire: emits void:toast, updates status in store.
 */

import type { Store } from '@ollie/store';
import * as events from '@ollie/events';
import type { Reminder } from './types';

const REMINDERS_MOD = 'reminders';
const REMINDERS_KEY = 'items';

/**
 * setTimeout stores its delay in a signed 32-bit int. Any delay above
 * 2^31-1 ms (~24.8 days) overflows and the timer fires IMMEDIATELY.
 * For longer reminders we arm a timer at the max safe delay, then
 * re-schedule on wake until the remaining delay fits in one timer.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

function readReminders(store: Store): Reminder[] {
  return store.get<Reminder[]>(REMINDERS_MOD, REMINDERS_KEY, []);
}

function writeReminders(store: Store, reminders: Reminder[]): void {
  store.set(REMINDERS_MOD, REMINDERS_KEY, reminders);
}

export interface ReminderScheduler {
  init(): void;
  add(reminder: Reminder): void;
  cancel(id: string): void;
  teardown(): void;
}

export function createReminderScheduler(store: Store, evts: typeof events): ReminderScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function fire(reminder: Reminder): void {
    timers.delete(reminder.id);

    // Update status in store.
    const all = readReminders(store);
    const updated = all.map((r) =>
      r.id === reminder.id ? { ...r, status: 'fired' as const } : r,
    );
    writeReminders(store, updated);

    evts.emit('void:toast', { message: reminder.body, module: reminder.module });
  }

  function schedule(reminder: Reminder): void {
    if (reminder.status !== 'scheduled') return;
    const delay = reminder.datetime - Date.now();
    if (delay <= 0) {
      // Already past; fire asynchronously so callers see the add() return first.
      const t = setTimeout(() => fire(reminder), 0);
      timers.set(reminder.id, t);
      return;
    }
    if (delay > MAX_TIMEOUT_MS) {
      // Delay exceeds the 32-bit setTimeout ceiling — a raw setTimeout here
      // would overflow and fire instantly. Arm a re-arming timer at the max
      // safe delay; on wake, recompute the remaining delay and schedule
      // again. The reminder's status is unchanged, so the re-arm just
      // re-enters this function until the remaining delay fits one timer.
      const t = setTimeout(() => {
        timers.delete(reminder.id);
        // Re-read the reminder so a cancel/edit during the long wait wins.
        const current = readReminders(store).find((r) => r.id === reminder.id);
        if (current && current.status === 'scheduled') schedule(current);
      }, MAX_TIMEOUT_MS);
      timers.set(reminder.id, t);
      return;
    }
    const t = setTimeout(() => fire(reminder), delay);
    timers.set(reminder.id, t);
  }

  return {
    init(): void {
      const all = readReminders(store);
      for (const r of all) {
        if (r.status === 'scheduled') {
          schedule(r);
        }
      }
    },

    add(reminder: Reminder): void {
      const all = readReminders(store);
      writeReminders(store, [...all, reminder]);
      schedule(reminder);
    },

    cancel(id: string): void {
      const t = timers.get(id);
      if (t !== undefined) {
        clearTimeout(t);
        timers.delete(id);
      }
      const all = readReminders(store);
      const updated = all.map((r) =>
        r.id === id ? { ...r, status: 'cancelled' as const } : r,
      );
      writeReminders(store, updated);
    },

    teardown(): void {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
