/**
 * @ollie/orchestrator · medication (E1 + E7)
 *
 * Derives:
 *   medication.dueSlots         DueSlot[]            refreshed every 60s
 *   medication.adherence        Record<id, AdherenceReport>
 *   medication.lastRecomputeAt  number
 *
 * Emits:
 *   medication:overdue_detected   first time a slot becomes overdue
 *   medication:adherence_drift    when drift transitions false→true
 *   medication:logged             when a `taken` entry appended
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  adherenceReport,
  dueSlotsToday,
  type AdherenceReport,
  type DueSlot,
  type MedicationItem,
} from '@ollie/logic/medication';
import type { Orchestrator } from './types';

export interface MedicationOrchestratorOptions {
  now?: () => number;
}

export function createMedicationOrchestrator(
  store: Store,
  opts: MedicationOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let tick: ReturnType<typeof setInterval> | null = null;

  function items(): MedicationItem[] {
    return store.get<MedicationItem[]>('medication', 'items', []) ?? [];
  }

  function recompute(): void {
    const now = nowFn();
    const list = items();

    const prevSlots = store.get<DueSlot[]>('medication', 'dueSlots', []) ?? [];
    const prevSlotKey = new Set(prevSlots.filter((s) => s.overdue).map((s) => `${s.item_id}:${s.slot_hhmm}`));

    const dueSlots: DueSlot[] = [];
    const adherence: Record<string, AdherenceReport | null> = {};

    for (const it of list) {
      const slots = dueSlotsToday(it, now);
      dueSlots.push(...slots);
      for (const s of slots) {
        const key = `${s.item_id}:${s.slot_hhmm}`;
        if (s.overdue && !prevSlotKey.has(key)) {
          try {
            events.emit('medication:overdue_detected', {
              item_id: it.id, name: it.name, slot_hhmm: s.slot_hhmm, ts: now,
            });
          } catch { /* registry warn ok */ }
        }
      }
      const a = adherenceReport(it, now);
      adherence[it.id] = a;
      if (a?.drift) {
        const prev = store.get<Record<string, AdherenceReport | null>>('medication', 'adherence', {})?.[it.id];
        if (!prev?.drift) {
          try {
            events.emit('medication:adherence_drift', {
              item_id: it.id, name: it.name, ratio: a.ratio, ts: now,
            });
          } catch { /* registry warn ok */ }
        }
      }
    }

    store.set('medication', 'dueSlots', dueSlots);
    store.set('medication', 'adherence', adherence);
    store.set('medication', 'lastRecomputeAt', now);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;
    unsubs.push(store.subscribeKey('medication', 'items', () => recompute()));
    tick = setInterval(() => recompute(), 60_000);
    recompute();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* noop */ } });
    if (tick) { clearInterval(tick); tick = null; }
    initialized = false;
  }

  return { init, teardown };
}
