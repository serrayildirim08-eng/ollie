/**
 * Pets module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_care` removes the pets_events row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migratePets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    logCare: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logObservation: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logVet: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logFeed: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logSupplement: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { events } from './repo';
import { petsHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('petsHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_care: undo removes the event row by id', async () => {
    const fragment: Fragment = {
      text: 'brushed tontin',
      language: 'en',
      module: 'pets',
      payload: { module: 'pets', action: 'log_care', petName: 'tontin', what: 'brushed' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await petsHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(events.remove)).toHaveBeenCalledWith('ev-id');
  });
});
