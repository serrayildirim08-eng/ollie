/**
 * Habits module · handler unit tests
 *
 * Coverage:
 *   - undo for `complete` removes the completion row via completions.remove
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateHabits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  registry: {
    ensure: vi.fn().mockResolvedValue({ id: 'habit-id', name: 'yoga', createdAt: 0 }),
  },
  completions: {
    add: vi.fn().mockResolvedValue({ id: 'comp-id', habitId: 'habit-id', completedAt: 0 }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    logStreakBreak: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logIdentity: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { completions } from './repo';
import { habitsHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('habitsHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('complete: undo removes the completion row by id', async () => {
    const fragment: Fragment = {
      text: 'did yoga',
      language: 'en',
      module: 'habits',
      payload: { module: 'habits', action: 'complete', habitName: 'yoga' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await habitsHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(completions.remove)).toHaveBeenCalledWith('comp-id');
  });
});
