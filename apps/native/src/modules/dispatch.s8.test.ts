/**
 * apps/native · dispatch — audit S8 wiring (gap 1 + gap 3 pets)
 *
 * Gap 1: dispatching a dump must emit `void:braindump:submitted` (v:2) so the
 *        per-module orchestrator dump handlers fire. We assert the event lands
 *        on the SAME bus the orchestrators subscribe to (re-exported from
 *        @ollie/orchestrator), with the applied items, and that a subscriber
 *        actually runs.
 *
 * Gap 3 (pets): dispatching a dump that mentions a pet must append a
 *        CoregulationEntry to pets.coregulation_log (the detector's input,
 *        previously never written).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onEvent, type Unsubscribe } from '@ollie/orchestrator';
import type { CoregulationEntry } from '@ollie/logic/pets';

// Mock '../store' with a real in-memory store created INSIDE the factory (so it
// dodges the vi.mock hoist TDZ). coregulation reads/writes this same instance;
// other post-dispatch side-effects are stubbed so the test stays focused.
vi.mock('../store', async () => {
  const { createStore, createMemoryAdapter } = await import('@ollie/store');
  return { store: createStore(createMemoryAdapter()) };
});
vi.mock('../bridge', () => ({ runAllSyncs: async () => {} }));
vi.mock('./brain', () => ({ recomputeBrain: async () => {} }));
vi.mock('../bridge/mood', () => ({ recordMoodFromDump: async () => {} }));
vi.mock('../notify/datelessLadder', () => ({ sweepDatelessLadders: async () => {} }));

import { store as testStore } from '../store';
import { dispatchRouterOutput } from './index';
import type { Fragment, RouterOutput } from '../router/schema';

function out(fragments: Fragment[]): RouterOutput {
  return {
    schemaVersion: '1.0',
    originalDump: 'took my pills and fed the guinea pig',
    dumpId: 'dump-s8',
    timestamp: 1_700_000_000_000,
    language: 'en',
    fragments,
    summary: { moduleCount: {}, cacheHitRate: 0, aiCalls: 0, durationMs: 0 },
  };
}

const okHandler = (label: string) => ({
  apply: vi.fn(async (_f: Fragment) => ({ ok: true, note: `wrote ${label}`, undo: async () => {} })),
});

const handlers = {
  admin: okHandler('admin'),
  pets: okHandler('pets'),
};

const unsubs: Unsubscribe[] = [];

beforeEach(() => {
  testStore.set('pets', 'coregulation_log', []);
});

afterEach(() => {
  unsubs.splice(0).forEach((u) => u());
});

describe('dispatch · S8 gap 1 — void:braindump:submitted', () => {
  it('emits v:2 with applied items and runs a subscriber', async () => {
    const received: Array<{ v?: number; items?: Array<{ module?: string }>; route_path?: string }> = [];
    unsubs.push(onEvent('void:braindump:submitted', (p) => received.push(p as never)));

    const adminFrag: Fragment = {
      text: 'mail the tax form',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'mail the tax form' } as never,
      confidence: 0.9,
      source: 'ai',
    };

    await dispatchRouterOutput(out([adminFrag]), { handlers });

    expect(received.length).toBe(1);
    expect(received[0]?.v).toBe(2);
    expect(received[0]?.route_path).toBe('native:dispatch');
    expect(received[0]?.items?.some((i) => i.module === 'admin')).toBe(true);
  });

  it('does not include unapplied (draft) fragments as items', async () => {
    const received: Array<{ items?: Array<{ module?: string }> }> = [];
    unsubs.push(onEvent('void:braindump:submitted', (p) => received.push(p as never)));

    const draftFrag: Fragment = {
      text: 'maybe call someone',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'maybe call someone' } as never,
      confidence: 0.7,
      needsConfirm: true,
      source: 'ai',
    };

    await dispatchRouterOutput(out([draftFrag]), { handlers });

    expect(received.length).toBe(1);
    expect(received[0]?.items?.length).toBe(0);
  });
});

describe('dispatch · S8 gap 3 — pets.coregulation_log', () => {
  it('appends a CoregulationEntry with pet_present when a pet fragment is dispatched', async () => {
    const petFrag: Fragment = {
      text: 'fed the guinea pig',
      language: 'en',
      module: 'pets',
      payload: { module: 'pets', action: 'log_feed', petName: 'Tontin' } as never,
      confidence: 0.9,
      source: 'ai',
    };

    await dispatchRouterOutput(out([petFrag]), { handlers });

    const log = testStore.get<CoregulationEntry[]>('pets', 'coregulation_log', []) ?? [];
    expect(log.length).toBe(1);
    expect(log[0]?.pet_present).toBe(true);
    expect(log[0]?.pet_id).toBe('pet:tontin');
    expect(['calm', 'neutral', 'agitated']).toContain(log[0]?.sentiment);
  });

  it('marks pet_present false for a dump with no pet fragment', async () => {
    const adminFrag: Fragment = {
      text: 'pay rent',
      language: 'en',
      module: 'admin',
      payload: { module: 'admin', action: 'create_task', text: 'pay rent' } as never,
      confidence: 0.9,
      source: 'ai',
    };

    await dispatchRouterOutput(out([adminFrag]), { handlers });

    const log = testStore.get<CoregulationEntry[]>('pets', 'coregulation_log', []) ?? [];
    expect(log.length).toBe(1);
    expect(log[0]?.pet_present).toBe(false);
    expect(log[0]?.pet_id).toBeUndefined();
  });
});
