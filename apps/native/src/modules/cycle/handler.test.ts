/**
 * Cycle module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_symptom` removes the cycle_events row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateCycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  cycleRepo: {
    logPeriodStart: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logPeriodEnd: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logSymptom: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logPill: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { cycleRepo } from './repo';
import { cycleHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('cycleHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_symptom: undo removes the event row by id', async () => {
    const fragment: Fragment = {
      text: 'cramps today',
      language: 'en',
      module: 'cycle',
      payload: { module: 'cycle', action: 'log_symptom', symptom: 'cramps' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await cycleHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(cycleRepo.remove)).toHaveBeenCalledWith('ev-id');
  });
});
