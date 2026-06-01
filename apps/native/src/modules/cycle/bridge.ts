/**
 * apps/native · modules/cycle/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The cycle Layer-2 watcher (packages/orchestrator/src/cycle.ts; also read by
 * body / habits / finance / sleep / patterns for cross-module correlation)
 * reads these store keys; native captures into SQLite (cycle/repo.ts) and
 * never writes them. This fills syncToStore().
 *
 * Store keys written here:
 *   cycle.items             — raw log items as @ollie/logic CycleItem[]
 *                             ({ ts, action, text? }). Mapped from cycle_events:
 *                               period_start → action 'started'
 *                               period_end   → action 'ended'
 *                               symptom      → action 'symptom', text=label
 *                               pill         → action 'pill'
 *                               bleeding     → action 'symptom',
 *                                              text='bleeding: <intensity>',
 *                                              + extended `intensity` field
 *                             so existing symptom-clustering buckets the flow
 *                             tag today, and a future flow-clustering detector
 *                             can read the structured `intensity` directly.
 *                             Sorted ascending by ts (boundary detection +
 *                             the watcher's lastStartTs scan both assume order
 *                             but stay correct regardless; ascending is the
 *                             natural shape the logic was authored against).
 *   cycle.cycles            — detectBoundaries(items): the cross-module phase
 *                             key everyone else (finance/sleep/habits/body)
 *                             reads for luteal windows + phase correlation.
 *                             We pre-compute it so cross-module bridges that
 *                             read cycle.cycles directly light up immediately,
 *                             not only after the cycle orchestrator's own
 *                             recompute tick.
 *   cycle.lastEditedByCycle — edit-recency map (cycleStartTs → ts of last
 *                             edit). SQLite has no per-cycle edit-tracking
 *                             column, so this is written as `{}` — the health
 *                             flags' 72h "recently edited" suppression is
 *                             simply never triggered (fail-open, the same as
 *                             the orchestrator's own default). See gap note.
 *
 * (cycle.prediction / phaseName / stats / flags / correlations / insights /
 *  adherence / fertileWindow / healthFlags / currentDay / cycleCount + cycle._*
 *  are OUTPUT keys the watcher writes — never written here.)
 *
 * GAPS (out of scope — noted, not built):
 *   - lastEditedByCycle is always `{}` (no edit-recency column in SQLite).
 *   - bleeding-intensity flow-clustering has NO logic consumer yet: the
 *     @ollie/logic CycleItem shape carries only `text`, so we feed the tag two
 *     ways — (1) as a normal `symptom` item ('bleeding: heavy') the existing
 *     symptom-clustering already buckets, and (2) as an extended `intensity`
 *     field on the item, persisted so a future flow-clustering detector can
 *     read structured flow directly without a re-capture. The structured field
 *     is inert until such a detector exists.
 *   - cycle SQLite is plaintext (encryption gap) — not this bridge's concern;
 *     it would be fixed in repo.ts, not here.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { detectBoundaries, type CycleItem } from '@ollie/logic/cycle';
import { cycleRepo } from './repo';
import type { CycleEvent } from './types';

/**
 * CycleItem plus the extended bleeding-intensity tag. The logic layer ignores
 * the extra field today (no consumer yet); it round-trips through the store so
 * a future flow-clustering detector can read it.
 */
type CycleItemExt = CycleItem & { intensity?: string };

/** Map one SQLite cycle_events row to the logic-layer CycleItem shape. */
function toItem(ev: CycleEvent): CycleItemExt | null {
  switch (ev.kind) {
    case 'period_start':
      return { ts: ev.occurredAt, action: 'started' };
    case 'period_end':
      return { ts: ev.occurredAt, action: 'ended' };
    case 'symptom':
      return { ts: ev.occurredAt, action: 'symptom', text: ev.symptom ?? undefined };
    case 'pill':
      return { ts: ev.occurredAt, action: 'pill' };
    case 'bleeding':
      // Fed as a symptom so existing symptom-clustering buckets the flow tag;
      // the structured `intensity` rides along for a future flow detector.
      return ev.intensity
        ? {
            ts: ev.occurredAt,
            action: 'symptom',
            text: `bleeding: ${ev.intensity}`,
            intensity: ev.intensity,
          }
        : null;
    default:
      return null;
  }
}

export async function syncToStore(store: Store): Promise<void> {
  // Pull the whole stream (kind-agnostic). The Box only ever reads small
  // capped slices; the watcher needs the full history to detect boundaries
  // and correlate symptoms, so we read generously here.
  const rows = await cycleRepo.list(undefined, 5000);

  const items: CycleItemExt[] = rows
    .map(toItem)
    .filter((i): i is CycleItemExt => i !== null)
    .sort((a, b) => a.ts - b.ts);

  store.set('cycle', 'items', items);
  store.set('cycle', 'cycles', detectBoundaries(items));
  // No per-cycle edit-recency in SQLite — fail-open, same as the watcher default.
  store.set('cycle', 'lastEditedByCycle', {});
}
