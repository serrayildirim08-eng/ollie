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
 *
 * Consumes (when scheduleNotification injected — mirrors sleep.ts APNs wiring):
 *   medication:overdue_detected   → REMINDER push ("you haven't logged X")
 *     A missed-dose nudge is an ADHD-critical use case — without the push
 *     the overdue signal only surfaces if the user happens to open the app.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
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
  /**
   * APNs push scheduler — injected by the app boot layer. Omit in tests
   * and contexts without APNs (desktop, web). When omitted the overdue
   * push subscriber is not attached.
   */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

export function createMedicationOrchestrator(
  store: Store,
  opts: MedicationOrchestratorOptions = {},
): Orchestrator {
  const nowFn = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;
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

    // medication:overdue_detected → REMINDER push. dedupe_key scopes one
    // push per item+slot+day so a 60s recompute loop can't re-fire it; the
    // notifications budget layer dedupes against this key. Mirrors the
    // sleep.ts APNs subscriber idiom.
    if (scheduleNotification) {
      unsubs.push(events.on('medication:overdue_detected', (raw: unknown) => {
        try {
          const p = (raw ?? {}) as {
            item_id?: string;
            name?: string;
            slot_hhmm?: string;
            ts?: number;
          };
          if (typeof p.item_id !== 'string' || typeof p.slot_hhmm !== 'string') return;
          const ts = typeof p.ts === 'number' ? p.ts : nowFn();
          const dayKey = new Date(ts).toISOString().slice(0, 10);
          const name = typeof p.name === 'string' && p.name.trim().length > 0
            ? p.name.trim()
            : 'a dose';
          scheduleNotification(
            {
              title: `${name} — ${p.slot_hhmm} dose not logged yet.`,
              category: 'REMINDER',
              dedupe_key: `medication:overdue:${p.item_id}:${p.slot_hhmm}:${dayKey}`,
              action_url: '/medication',
            },
            ts,
          );
        } catch { /* non-fatal */ }
      }));
    }

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
