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
 *   - cycle.items carries no bleeding-intensity (9-tag) data — symptoms are
 *     free-text only, so flow-intensity clustering can't run.
 *   - cycle SQLite is plaintext (encryption gap) — not this bridge's concern;
 *     it would be fixed in repo.ts, not here.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { detectBoundaries, type CycleItem } from '@ollie/logic/cycle';
import { cycleRepo } from './repo';
import type { CycleEvent } from './types';

/** Map one SQLite cycle_events row to the logic-layer CycleItem shape. */
function toItem(ev: CycleEvent): CycleItem | null {
  switch (ev.kind) {
    case 'period_start':
      return { ts: ev.occurredAt, action: 'started' };
    case 'period_end':
      return { ts: ev.occurredAt, action: 'ended' };
    case 'symptom':
      return { ts: ev.occurredAt, action: 'symptom', text: ev.symptom ?? undefined };
    case 'pill':
      return { ts: ev.occurredAt, action: 'pill' };
    default:
      return null;
  }
}

export async function syncToStore(store: Store): Promise<void> {
  // Pull the whole stream (kind-agnostic). The Box only ever reads small
  // capped slices; the watcher needs the full history to detect boundaries
  // and correlate symptoms, so we read generously here.
  const rows = await cycleRepo.list(undefined, 5000);

  const items: CycleItem[] = rows
    .map(toItem)
    .filter((i): i is CycleItem => i !== null)
    .sort((a, b) => a.ts - b.ts);

  store.set('cycle', 'items', items);
  store.set('cycle', 'cycles', detectBoundaries(items));
  // No per-cycle edit-recency in SQLite — fail-open, same as the watcher default.
  store.set('cycle', 'lastEditedByCycle', {});
}
