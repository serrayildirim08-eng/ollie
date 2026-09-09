/**
 * Goals module · handler unit tests
 *
 * Coverage:
 *   - undo for `progress_note` removes the goals_events row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateGoals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => {
  class GoalCapError extends Error {
    readonly code = 'goal_cap';
    constructor(message = 'active goal cap reached') {
      super(message);
      this.name = 'GoalCapError';
    }
  }
  return {
    GoalCapError,
    goals: {
      ensure: vi.fn().mockResolvedValue({ id: 'goal-id', name: 'spanish', why: null, createdAt: 0 }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    events: {
      add: vi.fn().mockResolvedValue({ id: 'ev-id', goalId: 'goal-id', kind: 'progress', text: '', loggedAt: 0 }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { events, goals, GoalCapError } from './repo';
import { goalsHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('goalsHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('progress_note: undo removes the event row by id', async () => {
    const fragment: Fragment = {
      text: 'did 30 min of spanish today',
      language: 'en',
      module: 'goals',
      payload: {
        module: 'goals',
        action: 'progress_note',
        goalName: 'spanish',
        note: '30 min today',
      },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await goalsHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(events.remove)).toHaveBeenCalledWith('ev-id');
  });
});

describe('goalsHandler — active-goal cap (audit #69)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_goal: refuses (ok:false, no insert) when ensure throws GoalCapError', async () => {
    vi.mocked(goals.ensure).mockRejectedValueOnce(new GoalCapError());
    const fragment: Fragment = {
      text: 'new goal: learn to surf',
      language: 'en',
      module: 'goals',
      payload: { module: 'goals', action: 'create_goal', what: 'learn to surf' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await goalsHandler.apply(fragment);
    expect(result.ok).toBe(false);
    expect(result.undo).toBeUndefined(); // nothing persisted → nothing to undo
    expect(result.note).toMatch(/goal limit/i);
  });

  it('progress_note: a capped ensure lands the note in the unassigned bucket (goalId null)', async () => {
    vi.mocked(goals.ensure).mockRejectedValueOnce(new GoalCapError());
    const fragment: Fragment = {
      text: 'made progress on french',
      language: 'en',
      module: 'goals',
      payload: { module: 'goals', action: 'progress_note', goalName: 'french', note: 'did 20 min' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await goalsHandler.apply(fragment);
    expect(result.ok).toBe(true);
    // Event still logged, but unassigned (goalId null) rather than breaching the cap.
    expect(vi.mocked(events.add)).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: null, kind: 'progress' }),
    );
  });
});
