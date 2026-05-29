/**
 * Body module · handler unit tests
 *
 * Coverage:
 *   1. dump_only fragment → routeModule called → log_symptom action used
 *   2. routeModule error → original Layer 1 action falls through unchanged
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
  migrateBody: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./repo', () => ({
  events: {
    add: vi.fn().mockResolvedValue({ id: 'mock-id' }),
  },
}));

vi.mock('../pets/migrate', () => ({
  migratePets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../pets/repo', () => ({
  events: {
    logCare: vi.fn().mockResolvedValue({ id: 'pet-mock-id' }),
  },
}));

// ─── imports after mocks ───────────────────────────────────────────────────────

import { routeModule } from '../../api/workers';
import { events } from './repo';
import { events as petsEvents } from '../pets/repo';
import { bodyHandler } from './handler';
import type { Fragment } from '../../router/schema';

const mockRouteModule = vi.mocked(routeModule);
const mockEventsAdd = vi.mocked(events.add);
const mockPetsLogCare = vi.mocked(petsEvents.logCare);

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function makeBodyFragmentNeedsConfirm(text: string): Fragment {
  return {
    text,
    language: 'en',
    module: 'body',
    payload: {
      module: 'body',
      action: 'log_water',
    },
    confidence: 0.65,
    needsConfirm: true,
    source: 'ai',
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('bodyHandler — Layer 2 re-routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dump_only fragment: calls routeModule → uses log_symptom from response', async () => {
    mockRouteModule.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        actions: [
          {
            module: 'body',
            action: 'log_symptom',
            data: JSON.stringify({ module: 'body', action: 'log_symptom', symptom: 'headache', severity: 2 }),
          },
        ],
      },
    });

    const fragment = makeDumpOnlyFragment('mild headache this morning');
    const result = await bodyHandler.apply(fragment);

    // routeModule must have been called with the right args
    expect(mockRouteModule).toHaveBeenCalledOnce();
    expect(mockRouteModule).toHaveBeenCalledWith('body', 'mild headache this morning', {
      bearer: 'test-bearer-token',
    });

    // repo.events.add must have been called with symptom kind
    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'symptom' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note).toContain('headache');
    }
  });

  it('cross-route: log_movement with `pet` mirrors to pets.log_care', async () => {
    const fragment: Fragment = {
      text: 'walked buddy for 30 min',
      language: 'en',
      module: 'body',
      payload: {
        module: 'body',
        action: 'log_movement',
        type: 'walk',
        duration_min: 30,
        pet: 'buddy',
      },
      confidence: 0.9,
      source: 'ai',
    };

    const result = await bodyHandler.apply(fragment);

    // Primary write — body event recorded.
    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'movement' }),
    );

    // Secondary write — pets.log_care mirrored.
    expect(mockPetsLogCare).toHaveBeenCalledOnce();
    expect(mockPetsLogCare).toHaveBeenCalledWith({
      petName: 'buddy',
      what: 'walk',
    });

    expect(result.ok).toBe(true);
  });

  it('routeModule error: falls back to original Layer 1 action', async () => {
    mockRouteModule.mockResolvedValueOnce({
      ok: false,
      error: { code: 'network', message: 'network error' },
    });

    const fragment = makeBodyFragmentNeedsConfirm('drank two glasses of water');
    const result = await bodyHandler.apply(fragment);

    // routeModule was attempted
    expect(mockRouteModule).toHaveBeenCalledOnce();

    // repo.events.add called with the original water action (Layer 1 fallback)
    expect(mockEventsAdd).toHaveBeenCalledOnce();
    expect(mockEventsAdd).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'water' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note).toContain('mL of water');
    }
  });
});
