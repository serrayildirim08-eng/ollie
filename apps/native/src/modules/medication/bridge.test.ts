/**
 * Medication bridge · SQLite → store mirror, with the real watcher.
 *
 * Proves the great-rewiring contract for medication: registry + dose events
 * captured in SQLite are mirrored by syncToStore() into medication.items in
 * the @ollie/logic MedicationItem shape, and the REAL medication orchestrator
 * recomputes over that mirrored data (writes lastRecomputeAt + dueSlots).
 *
 * SCHEMA GAP (asserted, not hidden): native captures no structured schedule,
 * so the mirrored items carry schedule:[]. The watcher therefore produces
 * NO due-slots and CANNOT fire overdue_detected / adherence_drift — this test
 * pins that honest behaviour so a future schema build is an intentional change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createMedicationOrchestrator } from '@ollie/orchestrator';
import type { MedicationItem } from '@ollie/logic/medication';

const NOW = 1_700_000_000_000;
const DOSE_TS = NOW - 3 * 60 * 60 * 1000; // 3h ago

// vi.mock is hoisted above top-level consts, so the factory inlines literals:
//   NOW = 1_700_000_000_000, DOSE_TS = NOW - 3h = 1_699_989_200_000,
//   createdAt = NOW - 5d = 1_699_568_000_000.
vi.mock('./repo', () => ({
  medications: {
    list: vi.fn().mockResolvedValue([
      { id: 'med-1', name: 'adderall', createdAt: 1_699_568_000_000 },
    ]),
  },
  events: {
    listByKindSince: vi.fn().mockResolvedValue([
      { id: 'e1', medId: 'med-1', kind: 'dose', dose: '20mg', note: null, loggedAt: 1_699_989_200_000, medName: 'adderall' },
    ]),
  },
}));

import { syncToStore } from './bridge';

describe('medication bridge → watcher', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(createMemoryAdapter());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors registry + dose events → medication.items in MedicationItem shape', async () => {
    await syncToStore(store);
    const items = store.get<MedicationItem[]>('medication', 'items', []);
    expect(items).toHaveLength(1);
    const med = items[0]!;
    expect(med.id).toBe('med-1');
    expect(med.name).toBe('adderall');
    expect(med.dose).toBe('20mg');
    expect(med.schedule).toEqual([]); // schema gap — no structured times
    expect(med.taken).toHaveLength(1);
    expect(med.taken[0]!.ts).toBe(DOSE_TS);
  });

  it('the real medication watcher recomputes over mirrored items', async () => {
    const orch = createMedicationOrchestrator(store, { now: () => NOW });

    await syncToStore(store);
    orch.init(); // reads medication.items, recomputes

    // Recompute ran over the mirrored item.
    expect(store.get<number>('medication', 'lastRecomputeAt', 0)).toBe(NOW);

    // Schema gap is honest: the watcher iterated the mirrored item but,
    // with schedule:[], dueSlotsToday() → [] and adherenceReport() → null.
    // No due slots, no adherence ratio (and so no overdue/drift events).
    expect(store.get('medication', 'dueSlots', [] as unknown[])).toEqual([]);
    expect(store.get<Record<string, unknown>>('medication', 'adherence', {})).toEqual({
      'med-1': null,
    });

    orch.teardown();
  });
});
