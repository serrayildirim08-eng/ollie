/**
 * Sleep module · handler unit tests
 *
 * Coverage:
 *   1. cross-route: log_insomnia with `med_taken` mirrors to medication.log_dose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('./migrate', () => ({
  migrateSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  sleepRepo: {
    addSleepLog: vi.fn().mockResolvedValue({ id: 'sleep-mock-id', kind: 'sleep', data: { hoursSlept: 7 } }),
    addWindDown: vi.fn().mockResolvedValue({ id: 'sleep-mock-id' }),
    addDream: vi.fn().mockResolvedValue({ id: 'sleep-mock-id' }),
    addInsomnia: vi.fn().mockResolvedValue({ id: 'sleep-mock-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../medication/migrate', () => ({
  migrateMedication: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../medication/repo', () => ({
  events: {
    logDose: vi.fn().mockResolvedValue({ id: 'med-mock-id' }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── imports after mocks ───────────────────────────────────────────────────────

import { sleepRepo } from './repo';
import { events as medEvents } from '../medication/repo';
import { sleepHandler } from './handler';
import type { Fragment } from '../../router/schema';

const mockAddInsomnia = vi.mocked(sleepRepo.addInsomnia);
const mockMedLogDose = vi.mocked(medEvents.logDose);

// ─── tests ────────────────────────────────────────────────────────────────────

describe('sleepHandler — cross-route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log_insomnia with `med_taken` mirrors to medication.log_dose', async () => {
    const fragment: Fragment = {
      text: "couldn't sleep so took 5mg melatonin",
      language: 'en',
      module: 'sleep',
      payload: {
        module: 'sleep',
        action: 'log_insomnia',
        med_taken: 'melatonin',
        med_dose: '5mg',
      },
      confidence: 0.9,
      source: 'ai',
    };

    const result = await sleepHandler.apply(fragment);

    // Primary write — insomnia recorded.
    expect(mockAddInsomnia).toHaveBeenCalledOnce();

    // Secondary write — medication dose mirrored with name + dose.
    expect(mockMedLogDose).toHaveBeenCalledOnce();
    expect(mockMedLogDose).toHaveBeenCalledWith({
      medName: 'melatonin',
      dose: '5mg',
    });

    expect(result.ok).toBe(true);
  });

  it('log_insomnia without `med_taken` does NOT call medication', async () => {
    const fragment: Fragment = {
      text: "couldn't sleep at all, lay there 2 hours",
      language: 'en',
      module: 'sleep',
      payload: {
        module: 'sleep',
        action: 'log_insomnia',
        duration_attempted_min: 120,
      },
      confidence: 0.9,
      source: 'ai',
    };

    await sleepHandler.apply(fragment);

    expect(mockAddInsomnia).toHaveBeenCalledOnce();
    expect(mockMedLogDose).not.toHaveBeenCalled();
  });

  it('exposes undo for wind_down_note that calls sleepRepo.remove with row id', async () => {
    const fragment: Fragment = {
      text: 'read for 20 min before bed',
      language: 'en',
      module: 'sleep',
      payload: { module: 'sleep', action: 'wind_down_note', note: 'read for 20 min before bed' },
      confidence: 0.9,
      source: 'ai',
    };
    const result = await sleepHandler.apply(fragment);
    expect(result.undo).toBeTypeOf('function');
    await result.undo!();
    expect(vi.mocked(sleepRepo.remove)).toHaveBeenCalledWith('sleep-mock-id');
  });
});
