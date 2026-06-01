/**
 * apps/native · modules/medication/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The medication Layer-2 watcher (packages/orchestrator/src/medication.ts — 3
 * detectors / adherence) reads `medication.items` as @ollie/logic
 * MedicationItem[]. Native captures into SQLite (medications_registry +
 * medications_events) and never writes that key. This fills syncToStore().
 *
 * Store key written here:
 *   medication.items — one MedicationItem per registry row:
 *       id          ← registry id
 *       name        ← registry name (already normalised)
 *       kind        ← 'prescription' (DEFAULT — see schema gap; kind is a
 *                     type field only, no detector branches on it)
 *       schedule    ← []  (SCHEMA GAP — native captures no structured times)
 *       taken[]     ← every `dose` event for that med, as { date, time, ts }
 *       created_at  ← registry createdAt
 *       dose        ← the most recent logged free-text dose ("20mg"), if any
 *
 * (medication.adherence / dueSlots / lastRecomputeAt are OUTPUT keys the
 *  watcher writes — never written here.)
 *
 * SCHEMA GAP (audit, confirmed): native medication is name + free-text-dose
 * only. There is NO structured `schedule` (daily HH:mm slots) and NO `kind`
 * captured. Consequences for the watcher, fed honestly (NOT fabricated):
 *   - schedule = []  ⇒  dueSlotsToday() returns []  ⇒  NO overdue_detected
 *     event, NO "remaining doses today".
 *   - schedule = []  ⇒  adherenceReport() returns null  ⇒  NO adherence_drift
 *     event, NO adherence ratio.
 * So the medication orchestrator RECOMPUTES over real items (and the Box's
 * dose log + last-dose surface are live), but its two notification detectors
 * stay dark until structured schedule/kind capture is built in the repo —
 * that is a separate schema task, deliberately not faked here.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import type { MedicationItem } from '@ollie/logic/medication';
import { medications, events as eventsRepo } from './repo';

/** Local YYYY-MM-DD / HH:mm split of a dose timestamp — matches the
 *  `{ date, time, ts }` shape MedicationItem.taken[] expects, in the same
 *  local-day convention the logic's isoDate/dueSlots use. */
function splitLocal(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

// A generous lookback for the dose log. The adherence window is 14 days but
// the Box + cross-module reads benefit from a fuller `taken[]`; 180 days
// keeps the mirror bounded without truncating anything the watcher needs.
const DOSE_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

export async function syncToStore(store: Store): Promise<void> {
  const meds = await medications.list();
  const sinceMs = Date.now() - DOSE_LOOKBACK_MS;
  const doseEvents = await eventsRepo.listByKindSince('dose', sinceMs);

  // Bucket dose events by med id once, newest-first preserved from the repo.
  const dosesByMed = new Map<string, typeof doseEvents>();
  for (const ev of doseEvents) {
    const bucket = dosesByMed.get(ev.medId);
    if (bucket) bucket.push(ev);
    else dosesByMed.set(ev.medId, [ev]);
  }

  const items: MedicationItem[] = meds.map((med) => {
    const doses = dosesByMed.get(med.id) ?? [];
    const taken = doses.map((d) => ({ ...splitLocal(d.loggedAt), ts: d.loggedAt }));
    // listByKindSince returns newest-first, so the first dose is the latest.
    const latestDose = doses[0]?.dose ?? undefined;
    return {
      id: med.id,
      name: med.name,
      kind: 'prescription', // schema gap: no kind captured; inert default
      schedule: [], // schema gap: no structured times captured
      taken,
      created_at: med.createdAt,
      ...(latestDose ? { dose: latestDose } : {}),
    };
  });

  store.set('medication', 'items', items);
}
