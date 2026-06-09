/**
 * Admin module · handler unit tests
 *
 * Coverage:
 *   - undo for `create_task` removes the task row by id
 *   - undo for `log_renewal` removes the renewal row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  beforeEach(() => {
    vi.clearAllMocks();
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
      { title: 'call', body: 'mama' },
      'reminder:task-id',
    );
    // Durable app-closed path fires too, same fireAt + stable dedupe_key.
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      {
        title: 'call',
        body: 'mama',
        category: 'REMINDER',
        dedupe_key: 'reminder:task-id',
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
      { title: 'call', body: 'mama · christmas' },
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
      { title: 'to do', body: 'take zoloft' },
      'reminder:task-id',
    );
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      {
        title: 'to do',
        body: 'take zoloft',
        category: 'REMINDER',
        dedupe_key: 'reminder:task-id',
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
});
