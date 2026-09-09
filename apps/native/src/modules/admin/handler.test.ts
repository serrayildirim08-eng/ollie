/**
 * Admin module · handler unit tests
 *
 * Coverage:
 *   - undo for `create_task` removes the task row by id
 *   - undo for `log_renewal` removes the renewal row by id
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateAdmin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  tasks: {
    add: vi.fn().mockResolvedValue({ id: 'task-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  renewals: {
    add: vi.fn().mockResolvedValue({ id: 'ren-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../notify/systemNotify', () => ({
  scheduleAt: vi.fn(() => ({ cancel: () => {} })),
}));

vi.mock('../../notify/serverReminder', () => ({
  scheduleServerReminder: vi.fn(),
}));

import { tasks, renewals } from './repo';
import { scheduleAt } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';
import { adminHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('adminHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_task: undo removes the task row by id', async () => {
    const fragment: Fragment = {
      text: 'call dentist',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'call dentist' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await adminHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(tasks.remove)).toHaveBeenCalledWith('task-id');
  });

  it('log_renewal: undo removes the renewal row by id', async () => {
    const fragment: Fragment = {
      text: 'passport renewal due march',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'log_renewal', renewal_type: 'passport', due_date: '2027-03-01' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await adminHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(renewals.remove)).toHaveBeenCalledWith('ren-id');
  });
});

describe('adminHandler — time-deferred reminder (remindIn)', () => {
  // Pin the device clock so the #92 re-derivation (Date.now() + amount*unit)
  // is deterministic and the worker's scheduledAtMs (set to the same delta)
  // resolves to the exact same wall-clock instant the tests assert on.
  const NOW = 1_700_000_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('create_phone_task with remindIn schedules a "call · person" notification at scheduledAtMs', async () => {
    const fireAt = Date.now() + 60_000;
    const fragment: Fragment = {
      text: 'remind me to call mama in 1 minute',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_phone_task',
        person: 'mama',
        remindIn: { amount: 1, unit: 'min', scheduledAtMs: fireAt },
      },
      confidence: 0.92,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).toHaveBeenCalledOnce();
    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      fireAt,
      {
        title: 'call',
        body: 'mama',
        actionTypeId: 'OLLIE_REMINDER',
        extra: { module: 'admin', refId: 'task-id' },
      },
      'reminder:task-id',
    );
    // Durable app-closed path fires too, same fireAt + stable dedupe_key.
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      {
        title: 'call',
        body: 'mama',
        category: 'REMINDER',
        dedupe_key: 'reminder:task-id',
        action_url: 'ollie://todo',
        notification_category: 'OLLIE_REMINDER',
      },
      fireAt,
    );
  });

  it('create_phone_task with reason adds " · reason" to the body', async () => {
    const fireAt = Date.now() + 120_000;
    const fragment: Fragment = {
      text: 'remind me to call mama about christmas in 2 minutes',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_phone_task',
        person: 'mama',
        reason: 'christmas',
        remindIn: { amount: 2, unit: 'min', scheduledAtMs: fireAt },
      },
      confidence: 0.92,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      fireAt,
      {
        title: 'call',
        body: 'mama · christmas',
        actionTypeId: 'OLLIE_REMINDER',
        extra: { module: 'admin', refId: 'task-id' },
      },
      'reminder:task-id',
    );
  });

  it('create_task with remindIn schedules a "to do · text" notification', async () => {
    const fireAt = Date.now() + 1_800_000;
    const fragment: Fragment = {
      text: 'remind me to take my zoloft in 30 minutes',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_task',
        text: 'take zoloft',
        remindIn: { amount: 30, unit: 'min', scheduledAtMs: fireAt },
      },
      confidence: 0.91,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      fireAt,
      {
        title: 'to do',
        body: 'take zoloft',
        actionTypeId: 'OLLIE_REMINDER',
        extra: { module: 'admin', refId: 'task-id' },
      },
      'reminder:task-id',
    );
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      {
        title: 'to do',
        body: 'take zoloft',
        category: 'REMINDER',
        dedupe_key: 'reminder:task-id',
        action_url: 'ollie://todo',
        notification_category: 'OLLIE_REMINDER',
      },
      fireAt,
    );
  });

  it('create_phone_task WITHOUT remindIn does NOT schedule anything', async () => {
    const fragment: Fragment = {
      text: 'call dentist',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_phone_task', person: 'dentist' },
      confidence: 0.92,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });

  it('create_task WITHOUT remindIn does NOT schedule anything', async () => {
    const fragment: Fragment = {
      text: 'renew library card',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'renew library card' },
      confidence: 0.92,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });

  // ── #92: don't trust the worker-supplied scheduledAtMs ──────────────────

  it('#92 re-derives the fire time from amount/unit against the DEVICE clock, ignoring a skewed worker stamp', async () => {
    // Worker stamp is wildly skewed (5 minutes in the past), but amount/unit
    // say "in 30 min". We must schedule at NOW + 30min, NOT the bad stamp.
    const skewedStamp = NOW - 5 * 60_000;
    const fragment: Fragment = {
      text: 'remind me to take my zoloft in 30 minutes',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_task',
        text: 'take zoloft',
        remindIn: { amount: 30, unit: 'min', scheduledAtMs: skewedStamp },
      },
      confidence: 0.91,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    const expectedFireAt = NOW + 30 * 60_000;
    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      expectedFireAt,
      expect.objectContaining({ title: 'to do', body: 'take zoloft' }),
      'reminder:task-id',
    );
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      expect.objectContaining({ dedupe_key: 'reminder:task-id' }),
      expectedFireAt,
    );
  });

  it('#92 rejects a past worker stamp when amount/unit are absent — schedules NOTHING (no instant fire)', async () => {
    const pastStamp = NOW - 60_000;
    const fragment: Fragment = {
      text: 'reminder',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_task',
        text: 'thing',
        // amount 0 → unusable intent, falls back to the (past) worker stamp.
        remindIn: { amount: 0, unit: 'min', scheduledAtMs: pastStamp },
      },
      confidence: 0.9,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });

  it('#92 rejects an absurd beyond-1-year fire time — schedules NOTHING', async () => {
    const fragment: Fragment = {
      text: 'remind me in 400 days',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_task',
        text: 'far future',
        remindIn: { amount: 400, unit: 'day', scheduledAtMs: NOW + 400 * 86_400_000 },
      },
      confidence: 0.9,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });
});

describe('adminHandler — manual reminder (remindAt + no-time cascade)', () => {
  // Pin to 9am local so an "at 6pm" reminder resolves to 6pm TODAY.
  const NOW = new Date(2026, 5, 28, 9, 0, 0, 0).getTime();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('create_phone_task with remindAt "18:00" schedules at 6pm TODAY and returns no cascade', async () => {
    const fragment: Fragment = {
      text: 'remind me to call mom at 6pm',
      language: 'en',
      module: 'admin',
      payload: {
        module: 'admin',
        action: 'create_phone_task',
        person: 'mom',
        reminder: true,
        remindAt: '18:00',
      },
      confidence: 0.93,
      source: 'ai',
    };

    const result = await adminHandler.apply(fragment);

    // No "when?" cascade — the time was explicit.
    expect(result.reminderCascade).toBeUndefined();
    expect(vi.mocked(scheduleAt)).toHaveBeenCalledOnce();
    const [fireAt, payload, id] = vi.mocked(scheduleAt).mock.calls[0]!;
    expect(new Date(fireAt as number).getHours()).toBe(18);
    expect(new Date(fireAt as number).getDate()).toBe(28); // today
    expect(fireAt as number).toBeGreaterThan(NOW);
    expect(payload).toMatchObject({ title: 'call', body: 'mom' });
    expect(id).toBe('reminder:task-id');
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      expect.objectContaining({ dedupe_key: 'reminder:task-id' }),
      fireAt,
    );
  });

  it('remindAt in the past today rolls forward to tomorrow (no past schedule)', async () => {
    const fragment: Fragment = {
      text: 'remind me to water plants at 6am',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'water plants', reminder: true, remindAt: '06:00' },
      confidence: 0.9,
      source: 'ai',
    };

    await adminHandler.apply(fragment);

    const [fireAt] = vi.mocked(scheduleAt).mock.calls[0]!;
    expect(new Date(fireAt as number).getHours()).toBe(6);
    expect(new Date(fireAt as number).getDate()).toBe(29); // tomorrow
    expect(fireAt as number).toBeGreaterThan(NOW);
  });

  it('create_phone_task reminder with NO time returns a cascade and schedules NOTHING yet', async () => {
    const fragment: Fragment = {
      text: 'remind me to call mom',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_phone_task', person: 'mom', reminder: true },
      confidence: 0.93,
      source: 'ai',
    };

    const result = await adminHandler.apply(fragment);

    expect(result.reminderCascade).toEqual({ taskId: 'task-id', text: 'call mom', module: 'admin' });
    // Durable to-do exists; the schedule waits for the "when?" answer.
    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });

  it('create_task reminder with NO time returns a cascade keyed on the task text', async () => {
    const fragment: Fragment = {
      text: 'remind me to submit the form',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'submit the form', reminder: true },
      confidence: 0.9,
      source: 'ai',
    };

    const result = await adminHandler.apply(fragment);

    expect(result.reminderCascade).toEqual({ taskId: 'task-id', text: 'submit the form', module: 'admin' });
    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
  });
});
