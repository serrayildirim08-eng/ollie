/**
 * @ollie/orchestrator · pets orchestrator tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createPetsOrchestrator } from '../src/pets';
import type { Pet, CareLogEntry, CareGap } from '@ollie/logic/pets';

// Fixed wall-clock: 2026-05-09T12:00:00Z
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
// Stale feeding: 10 days ago (well past guinea_pig hay_refill critical_days: 4)
const STALE = NOW - 10 * 86_400_000;

const TONTIN: Pet = {
  id: 'tontin',
  name: 'Tontin',
  species: 'guinea_pig',
  adopted_at: NOW - 90 * 86_400_000,
};

const PINPON: Pet = {
  id: 'pinpon',
  name: 'Pinpon',
  species: 'guinea_pig',
  adopted_at: NOW - 90 * 86_400_000,
};

describe('pets orchestrator', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createPetsOrchestrator>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
    orch = createPetsOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('populates care_gaps after init with stale hay_refill for Tontin', () => {
    store.set('pets', 'pets', [TONTIN, PINPON] as Pet[]);

    // Pinpon has a recent hay refill; Tontin has none in 10 days.
    const careLog: CareLogEntry[] = [
      { pet_id: 'pinpon', task: 'hay_refill', occurred_at: NOW - 1 * 86_400_000 },
    ];
    store.set('pets', 'care_log', careLog);

    orch.init();

    const gaps = store.get<CareGap[]>('pets', 'care_gaps', []);
    expect(gaps).toBeDefined();
    expect(Array.isArray(gaps)).toBe(true);

    const tontinHayGap = gaps!.find(
      (g) => g.pet_id === 'tontin' && g.task === 'hay_refill',
    );
    expect(tontinHayGap).toBeDefined();
    // 10 days >> critical_days 4 → severity should be 'concerned'
    expect(tontinHayGap!.severity).toBe('concerned');
  });

  it('does not flag Pinpon hay_refill when recently done', () => {
    store.set('pets', 'pets', [TONTIN, PINPON] as Pet[]);
    store.set('pets', 'care_log', [
      { pet_id: 'pinpon', task: 'hay_refill', occurred_at: NOW - 1 * 86_400_000},
      { pet_id: 'tontin', task: 'hay_refill', occurred_at: NOW - 1 * 86_400_000},
    ] as CareLogEntry[]);

    orch.init();

    const gaps = store.get<CareGap[]>('pets', 'care_gaps', []);
    const pinponHayGap = gaps!.find(
      (g) => g.pet_id === 'pinpon' && g.task === 'hay_refill',
    );
    // 1 day < cadence_days 2 → ok
    expect(pinponHayGap?.severity).toBe('ok');
  });

  it('recomputes care_gaps when care_log changes', () => {
    store.set('pets', 'pets', [TONTIN] as Pet[]);
    store.set('pets', 'care_log', [] as CareLogEntry[]);

    orch.init();

    const gapsBefore = store.get<CareGap[]>('pets', 'care_gaps', []);
    const beforeHay = gapsBefore!.find(
      (g) => g.pet_id === 'tontin' && g.task === 'hay_refill',
    );
    expect(beforeHay?.severity).not.toBe('ok');

    // Simulate a fresh hay refill.
    store.set('pets', 'care_log', [
      { pet_id: 'tontin', task: 'hay_refill', occurred_at: NOW - 1 * 86_400_000 },
    ] as CareLogEntry[]);

    const gapsAfter = store.get<CareGap[]>('pets', 'care_gaps', []);
    const afterHay = gapsAfter!.find(
      (g) => g.pet_id === 'tontin' && g.task === 'hay_refill',
    );
    expect(afterHay?.severity).toBe('ok');
  });

  it('teardown stops subscriptions', () => {
    store.set('pets', 'pets', [TONTIN] as Pet[]);
    store.set('pets', 'care_log', [] as CareLogEntry[]);

    orch.init();
    orch.teardown();

    // After teardown, manually overwrite care_gaps; updating care_log should NOT reset it.
    store.set('pets', 'care_gaps', [] as CareGap[]);
    store.set('pets', 'care_log', [
      { pet_id: 'tontin', task: 'hay_refill', occurred_at: NOW - 20 * 86_400_000 },
    ] as CareLogEntry[]);

    // The sentinel empty array should remain — no re-compute fired.
    const gaps = store.get<CareGap[]>('pets', 'care_gaps', []);
    expect(gaps).toHaveLength(0);
  });

  it('emits pets:care_gap_detected for a new severity escalation', () => {
    const emitted: Array<{ pet_id: string; task: string; severity: string }> = [];
    const unsub = on('pets:care_gap_detected', (p) => {
      emitted.push(p as { pet_id: string; task: string; severity: string });
    });

    store.set('pets', 'pets', [TONTIN] as Pet[]);
    store.set('pets', 'care_log', [] as CareLogEntry[]);

    orch.init();

    unsub();

    expect(emitted.some((e) => e.pet_id === 'tontin' && e.task === 'hay_refill')).toBe(true);
  });
});
