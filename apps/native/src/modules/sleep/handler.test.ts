/**
 * Sleep module · handler unit tests
 *
 * Coverage:
 *   1. cross-route: log_insomnia with `med_taken` mirrors to medication.log_dose
 *   2. Layer 2 re-routing: dump_only fragment → routeModule called →
 *      upgraded action used (mirrors body handler.test.ts pattern).
 *   3. Layer 2 fallback: routeModule error preserves the original Layer 1
 *      action (no silent data loss when /route/sleep is unreachable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../api/workers', () => ({
  routeModule: vi.fn(),
}));

vi.mock('../../api/supabase', () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-bearer-token' } },
      }),
    },
  })),
}));

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

import { routeModule } from '../../api/workers';
import { sleepRepo } from './repo';
import { events as medEvents } from '../medication/repo';
import { sleepHandler } from './handler';
import type { Fragment } from '../../router/schema';

const mockRouteModule = vi.mocked(routeModule);
const mockAddInsomnia = vi.mocked(sleepRepo.addInsomnia);
const mockAddSleepLog = vi.mocked(sleepRepo.addSleepLog);
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

// ─── Layer 2 re-routing tests (mirrors body handler.test.ts) ─────────────────

function makeDumpOnlyFragment(text: string): Fragment {
  return {
    text,
    language: 'en',
    module: 'dump_only',
    payload: { module: 'dump_only', action: 'archive_only', reason: 'low_confidence' },
    confidence: 0.45,
    needsConfirm: false,
    source: 'ai',
  };
}

function makeSleepFragmentNeedsConfirm(text: string): Fragment {
  return {
    text,
    language: 'en',
    module: 'sleep',
    payload: {
      module: 'sleep',
      action: 'log_sleep',
      hours: 7,
    },
    confidence: 0.65,
    needsConfirm: true,
    source: 'ai',
  };
}

describe('sleepHandler — Layer 2 re-routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dump_only fragment: calls routeModule → uses log_insomnia from response', async () => {
    mockRouteModule.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        actions: [
          {
            module: 'sleep',
            action: 'log_insomnia',
            data: JSON.stringify({
              module: 'sleep',
              action: 'log_insomnia',
              duration_attempted_min: 90,
            }),
          },
        ],
      },
    });

    const fragment = makeDumpOnlyFragment('lay there for an hour and a half');
    const result = await sleepHandler.apply(fragment);

    // routeModule must have been called with the right args
    expect(mockRouteModule).toHaveBeenCalledOnce();
    expect(mockRouteModule).toHaveBeenCalledWith(
      'sleep',
      'lay there for an hour and a half',
      { bearer: 'test-bearer-token' },
    );

    // sleepRepo.addInsomnia must have been called (the upgraded action)
    expect(mockAddInsomnia).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it('routeModule error: falls back to original Layer 1 action', async () => {
    mockRouteModule.mockResolvedValueOnce({
      ok: false,
      error: { code: 'network', message: 'network error' },
    });

    const fragment = makeSleepFragmentNeedsConfirm('slept 7 hours');
    const result = await sleepHandler.apply(fragment);

    // routeModule was attempted
    expect(mockRouteModule).toHaveBeenCalledOnce();

    // Original log_sleep action persisted via addSleepLog (Layer 1 fallback)
    expect(mockAddSleepLog).toHaveBeenCalledOnce();
    expect(mockAddInsomnia).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
  });

  it('confident sleep fragment: skips routeModule entirely', async () => {
    const fragment: Fragment = {
      text: '8 saat uyudum iyi',
      language: 'tr',
      module: 'sleep',
      payload: { module: 'sleep', action: 'log_sleep', hours: 8, quality: 4 },
      confidence: 0.95,
      needsConfirm: false,
      source: 'ai',
    };
    await sleepHandler.apply(fragment);
    expect(mockRouteModule).not.toHaveBeenCalled();
    expect(mockAddSleepLog).toHaveBeenCalledOnce();
  });
});
