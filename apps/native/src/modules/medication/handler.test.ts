/**
 * Medication module · handler unit tests
 *
 * Coverage:
 *   - undo for `log_dose` removes the event row by id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./migrate', () => ({
  migrateMedication: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    logDose: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logMissed: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    logSideEffect: vi.fn().mockResolvedValue({ id: 'ev-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { events } from './repo';
import { medicationHandler } from './handler';
import type { Fragment } from '../../router/schema';

describe('medicationHandler — undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_dose: undo removes the event row by id', async () => {
    const fragment: Fragment = {
      text: 'took adderall 20mg',
      language: 'en',
      module: 'medication',
      payload: { module: 'medication', action: 'log_dose', medName: 'adderall', dose: '20mg' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await medicationHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(events.remove)).toHaveBeenCalledWith('ev-id');
  });
});
