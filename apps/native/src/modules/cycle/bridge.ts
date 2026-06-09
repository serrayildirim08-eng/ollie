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
 *   cycle.pregnant          — boolean. True while a pregnancy_start has no
 *                             later pregnancy_end (pregnancy PAUSE — not
 *                             tracking). The orchestrator reads this and goes
 *                             dormant: no period prediction, no period/late/
 *                             missed flags. NOTE: pregnancy_start/_end are NOT
 *                             mapped into cycle.items (the @ollie/logic
 *                             CycleItem shape has no pregnancy action) — they
 *                             ride only on these two derived keys.
 *   cycle.pregnancyEndTs    — ms of the most recent pregnancy_end, or null.
 *                             The orchestrator uses it as a fresh-start fence:
 *                             period starts before it belong to a prior
 *                             reproductive epoch and are dropped from the
 *                             prediction window, so the first period AFTER a
 *                             pregnancy ends restarts the cycle instead of
 *                             reading as one absurd ~9-month "late" cycle.
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

  // ── pregnancy pause ──────────────────────────────────────────────────────
  // Derive from the raw rows (pregnancy markers are NOT in `items`). Walk the
  // pregnancy markers in time order: the state after the last one is the
  // current state. `pregnancyEndTs` is the most recent end (fresh-start fence).
  //
  // ORDER MATTERS: set the pregnant keys BEFORE `cycle.items`. store.set is
  // synchronous and the orchestrator recomputes on the `cycle.items` change —
  // so the pregnant flag must already be current when that fires.
  let pregnant = false;
  let pregnancyEndTs: number | null = null;
  const markers = rows
    .filter((r) => r.kind === 'pregnancy_start' || r.kind === 'pregnancy_end')
    .sort((a, b) => a.occurredAt - b.occurredAt);
  for (const m of markers) {
    if (m.kind === 'pregnancy_start') {
      pregnant = true;
    } else {
      pregnant = false;
      pregnancyEndTs = m.occurredAt;
    }
  }
  store.set('cycle', 'pregnant', pregnant);
  store.set('cycle', 'pregnancyEndTs', pregnancyEndTs);

  store.set('cycle', 'cycles', detectBoundaries(items));
  // No per-cycle edit-recency in SQLite — fail-open, same as the watcher default.
  store.set('cycle', 'lastEditedByCycle', {});
  // Set last so the orchestrator's items-subscriber recompute sees the
  // already-current pregnant flag + fence above.
  store.set('cycle', 'items', items);
}
