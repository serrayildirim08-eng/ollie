/**
 * Medication bridge · SQLite → store mirror, with the real watcher.
 *
 * Proves the great-rewiring contract for medication: registry + dose events
 * captured in SQLite are mirrored by syncToStore() into medication.items in
 * the @ollie/logic MedicationItem shape (now carrying the structured `kind`
 * and `schedule` captured in the Box), and the REAL medication orchestrator
 * recomputes over that mirrored data.
 *
 * STRUCTURED CAPTURE (built 2026-06-01): the registry stores kind + a
 * schedule of "HH:MM" slots. This test pins that once a med has a schedule,
 * the mirror carries it through and the watcher's dueSlots / "remaining
 * doses today" path lights up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { createMedicationOrchestrator } from '@ollie/orchestrator';
import {
  dosesRemainingToday,
  dueSlotsToday,
  type MedicationItem,
} from '@ollie/logic/medication';

const NOW = 1_700_000_000_000;
const DOSE_TS = NOW - 3 * 60 * 60 * 1000; // 3h ago

// vi.mock is hoisted above top-level consts, so the factory inlines literals:
//   NOW = 1_700_000_000_000, DOSE_TS = NOW - 3h = 1_699_989_200_000,
//   createdAt = NOW - 5d = 1_699_568_000_000.
// The med carries a 2-slot schedule + kind, mirroring what the Box's editor
// persists via medications.updateProfile().
vi.mock('./repo', () => ({
  medications: {
    list: vi.fn().mockResolvedValue([
      {
        id: 'med-1',
        name: 'adderall',
        createdAt: 1_699_568_000_000,
        kind: 'prescription',
        schedule: ['09:00', '13:00'],
      },
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

  it('mirrors registry + dose events → medication.items carrying kind + schedule', async () => {
    await syncToStore(store);
    const items = store.get<MedicationItem[]>('medication', 'items', []);
    expect(items).toHaveLength(1);
    const med = items[0]!;
    expect(med.id).toBe('med-1');
    expect(med.name).toBe('adderall');
    expect(med.dose).toBe('20mg');
    // Structured capture now rides through the mirror.
    expect(med.kind).toBe('prescription');
    expect(med.schedule).toEqual(['09:00', '13:00']);
    expect(med.taken).toHaveLength(1);
    expect(med.taken[0]!.ts).toBe(DOSE_TS);
  });

  it('with a schedule, the watcher computes dueSlots + remaining doses ("2/4 left" path)', async () => {
    const orch = createMedicationOrchestrator(store, { now: () => NOW });

    await syncToStore(store);
    orch.init(); // reads medication.items, recomputes

    // Recompute ran over the mirrored item.
    expect(store.get<number>('medication', 'lastRecomputeAt', 0)).toBe(NOW);

    // The structured schedule lights up the watcher: two daily slots → two
    // due-slots for this med (no longer the dark schema-gap path).
    const dueSlots = store.get<Array<{ item_id: string; slot_hhmm: string }>>(
      'medication',
      'dueSlots',
      [],
    );
    expect(dueSlots.map((s) => s.slot_hhmm)).toEqual(['09:00', '13:00']);
    expect(dueSlots.every((s) => s.item_id === 'med-1')).toBe(true);

    orch.teardown();
  });

  it('logic helpers see the schedule: dueSlotsToday + dosesRemainingToday non-empty', async () => {
    await syncToStore(store);
    const med = store.get<MedicationItem[]>('medication', 'items', [])[0]!;

    // The "2/4 left" surface lights up: 2 scheduled slots today (vs the old
    // schema-gap [] path), and at least one dose still remaining. Asserted as
    // a range rather than exactly 1 because whether the 3h-ago dose counts as
    // "today" is TZ-dependent near local midnight — the load-bearing claim is
    // that the schedule makes these non-zero at all.
    expect(dueSlotsToday(med, NOW)).toHaveLength(2);
    const remaining = dosesRemainingToday(med, NOW);
    expect(remaining).toBeGreaterThanOrEqual(1);
    expect(remaining).toBeLessThanOrEqual(2);
  });
});
