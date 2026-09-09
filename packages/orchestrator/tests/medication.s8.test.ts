/**
 * @ollie/orchestrator · medication — audit S8 · gap 3
 *
 * The audit flagged the medication overdue / adherence detectors as running on
 * empty input. The input key is `medication.items`; apps/native now writes it
 * via modules/medication/bridge.ts (the great rewiring). This test pins the
 * orchestrator end of that contract: given a non-empty, overdue `medication.items`
 * it MUST emit `medication:overdue_detected` and write the overdue dueSlots —
 * i.e. the detector produces its expected output once the bridge feeds it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import { _clearAllHandlers, on } from '@ollie/events';
import { createMedicationOrchestrator } from '../src/medication';
import type { MedicationItem, DueSlot } from '@ollie/logic/medication';

// Fixed wall-clock at 12:00 local so a 09:00 slot is comfortably overdue.
const NOW = new Date('2026-06-25T12:00:00').getTime();

function overdueItem(): MedicationItem {
  return {
    id: 'med-1',
    name: 'sertraline',
    kind: 'prescription',
    schedule: ['09:00'], // due 09:00, now is 12:00, nothing taken → overdue
    taken: [],
    created_at: NOW - 30 * 86_400_000,
  };
}

describe('medication orchestrator · S8 gap 3 (non-empty input → output)', () => {
  let store: ReturnType<typeof createStore>;
  let orch: ReturnType<typeof createMedicationOrchestrator>;

  beforeEach(() => {
    _clearAllHandlers();
    store = createStore(createMemoryAdapter());
    orch = createMedicationOrchestrator(store, { now: () => NOW });
  });

  afterEach(() => {
    orch.teardown();
    _clearAllHandlers();
  });

  it('emits medication:overdue_detected and writes overdue dueSlots', () => {
    const overdueEvents: Array<{ item_id?: string }> = [];
    on('medication:overdue_detected', (p) => overdueEvents.push(p as { item_id?: string }));

    // Seed the input the bridge mirrors, THEN init so recompute sees it.
    store.set('medication', 'items', [overdueItem()]);
    orch.init();

    const slots = store.get<DueSlot[]>('medication', 'dueSlots', []) ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.overdue)).toBe(true);

    expect(overdueEvents.length).toBeGreaterThan(0);
    expect(overdueEvents[0]?.item_id).toBe('med-1');
  });

  it('empty input produces no overdue event (the pre-fix dark state)', () => {
    const overdueEvents: unknown[] = [];
    on('medication:overdue_detected', (p) => overdueEvents.push(p));

    // No medication.items set — mirrors the unbridged state.
    orch.init();

    expect(overdueEvents.length).toBe(0);
    expect(store.get<DueSlot[]>('medication', 'dueSlots', [])).toEqual([]);
  });
});
