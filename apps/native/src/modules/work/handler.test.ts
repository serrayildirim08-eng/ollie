/**
 * Work module · handler unit tests
 *
 * Coverage:
 *   1. cross-route: log_focus_session with `skipped_meals: true` mirrors to
 *      body.log_hunger
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── imports after mocks ───────────────────────────────────────────────────────

import { events as workEvents } from './repo';
import { events as bodyEvents } from '../body/repo';
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
