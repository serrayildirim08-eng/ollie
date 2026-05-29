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

vi.mock('./repo', () => ({
  goals: {
    ensure: vi.fn().mockResolvedValue({ id: 'goal-id', name: 'spanish', why: null, createdAt: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    add: vi.fn().mockResolvedValue({ id: 'ev-id', goalId: 'goal-id', kind: 'progress', text: '', loggedAt: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { events } from './repo';
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
