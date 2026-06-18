/**
 * Work module · handler unit tests
 *
 * Coverage:
 *   1. cross-route: log_focus_session with `skipped_meals: true` mirrors to
 *      body.log_hunger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('./migrate', () => ({
  migrateWork: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  tasks: {
    add: vi.fn().mockResolvedValue({ id: 'task-mock-id', text: 'send invoice' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    addFocus: vi.fn().mockResolvedValue({ id: 'focus-mock-id' }),
    addMeeting: vi.fn().mockResolvedValue({ id: 'meeting-mock-id' }),
    addDistraction: vi.fn().mockResolvedValue({ id: 'distraction-mock-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../body/migrate', () => ({
  migrateBody: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../body/repo', () => ({
  events: {
    add: vi.fn().mockResolvedValue({ id: 'body-mock-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../notify/systemNotify', () => ({
  scheduleAt: vi.fn(() => ({ cancel: () => {} })),
  sendSystemNotification: vi.fn(),
}));

vi.mock('../../notify/serverReminder', () => ({
  scheduleServerReminder: vi.fn(),
}));

// ─── imports after mocks ───────────────────────────────────────────────────────

import { events as workEvents } from './repo';
import { events as bodyEvents } from '../body/repo';
import { scheduleAt } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';
import { workHandler } from './handler';
import type { Fragment } from '../../router/schema';

const mockAddFocus = vi.mocked(workEvents.addFocus);
const mockBodyAdd = vi.mocked(bodyEvents.add);

// ─── tests ────────────────────────────────────────────────────────────────────

describe('workHandler — cross-route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_focus_session with `skipped_meals: true` mirrors to body.log_hunger', async () => {
    const fragment: Fragment = {
      text: "hyperfocused all morning, didn't eat",
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'log_focus_session',
        durationMin: 180,
        skipped_meals: true,
      },
      confidence: 0.9,
      source: 'ai',
    };

    const result = await workHandler.apply(fragment);

    // Primary write — focus session recorded.
    expect(mockAddFocus).toHaveBeenCalledOnce();

    // Secondary write — body hunger event mirrored.
    expect(mockBodyAdd).toHaveBeenCalledOnce();
    expect(mockBodyAdd).toHaveBeenCalledWith({ kind: 'hunger', data: {} });

    expect(result.ok).toBe(true);
  });

  it('log_focus_session without `skipped_meals` does NOT call body', async () => {
    const fragment: Fragment = {
      text: '90 min deep work on atelier',
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'log_focus_session',
        durationMin: 90,
        project: 'atelier',
      },
      confidence: 0.9,
      source: 'ai',
    };

    await workHandler.apply(fragment);

    expect(mockAddFocus).toHaveBeenCalledOnce();
    expect(mockBodyAdd).not.toHaveBeenCalled();
  });

  it('log_focus_session with `skipped_meals`: undo removes BOTH focus + body rows', async () => {
    const fragment: Fragment = {
      text: 'hyperfocused, forgot to eat',
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'log_focus_session',
        durationMin: 120,
        skipped_meals: true,
      },
      confidence: 0.9,
      source: 'ai',
    };

    const result = await workHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();

    expect(vi.mocked(workEvents.remove)).toHaveBeenCalledWith('focus-mock-id');
    expect(vi.mocked(bodyEvents.remove)).toHaveBeenCalledWith('body-mock-id');
  });
});

describe('workHandler — time-deferred reminder (remindIn)', () => {
  // Pin the device clock so the #92 re-derivation (Date.now() + amount*unit)
  // is deterministic and matches the worker stamp set to the same delta.
  const NOW = 1_700_000_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('create_task with remindIn schedules a "to do · text" notification at scheduledAtMs', async () => {
    const fireAt = Date.now() + 600_000;
    const fragment: Fragment = {
      text: 'remind me to ping boran in 10 minutes',
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'create_task',
        text: 'ping boran',
        remindIn: { amount: 10, unit: 'min', scheduledAtMs: fireAt },
      },
      confidence: 0.92,
      source: 'ai',
    };

    await workHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).toHaveBeenCalledOnce();
    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      fireAt,
      {
        title: 'to do',
        body: 'ping boran',
        actionTypeId: 'OLLIE_REMINDER',
        extra: { module: 'work', refId: 'task-mock-id' },
      },
      'reminder:task-mock-id',
    );
    // Durable app-closed path fires too, same fireAt + stable dedupe_key.
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      {
        title: 'to do',
        body: 'ping boran',
        category: 'REMINDER',
        dedupe_key: 'reminder:task-mock-id',
        action_url: 'ollie://box/work',
        notification_category: 'OLLIE_REMINDER',
      },
      fireAt,
    );
  });

  it('create_task WITHOUT remindIn does NOT schedule anything', async () => {
    const fragment: Fragment = {
      text: 'write the PRD',
      language: 'en',
      module: 'work',
      payload: { module: 'work', action: 'create_task', text: 'write the PRD' },
      confidence: 0.92,
      source: 'ai',
    };

    await workHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });

  // ── #92: work handler had the SAME worker-trust pattern the prior attempt
  //         missed — re-derive + bounds-check here too. ──────────────────────

  it('#92 re-derives the fire time from amount/unit, ignoring a skewed (past) worker stamp', async () => {
    const skewedStamp = NOW - 10 * 60_000; // worker says 10min ago
    const fragment: Fragment = {
      text: 'remind me to ping boran in 10 minutes',
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'create_task',
        text: 'ping boran',
        remindIn: { amount: 10, unit: 'min', scheduledAtMs: skewedStamp },
      },
      confidence: 0.92,
      source: 'ai',
    };

    await workHandler.apply(fragment);

    const expectedFireAt = NOW + 10 * 60_000;
    expect(vi.mocked(scheduleAt)).toHaveBeenCalledWith(
      expectedFireAt,
      expect.objectContaining({ title: 'to do', body: 'ping boran' }),
      'reminder:task-mock-id',
    );
    expect(vi.mocked(scheduleServerReminder)).toHaveBeenCalledWith(
      expect.objectContaining({ dedupe_key: 'reminder:task-mock-id' }),
      expectedFireAt,
    );
  });

  it('#92 rejects a past worker stamp with no usable amount — schedules NOTHING', async () => {
    const fragment: Fragment = {
      text: 'reminder',
      language: 'en',
      module: 'work',
      payload: {
        module: 'work',
        action: 'create_task',
        text: 'thing',
        remindIn: { amount: 0, unit: 'min', scheduledAtMs: NOW - 60_000 },
      },
      confidence: 0.9,
      source: 'ai',
    };

    await workHandler.apply(fragment);

    expect(vi.mocked(scheduleAt)).not.toHaveBeenCalled();
    expect(vi.mocked(scheduleServerReminder)).not.toHaveBeenCalled();
  });
});
