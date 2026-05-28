/**
 * Body module · barrel.
 */

import type { CadenceTrackedEntry } from '@ollie/orchestrator';
import { events as eventsRepo, cadence as cadenceRepo } from './repo';
import { getLabel, normaliseLabel } from './types';

export { bodyHandler } from './handler';
export { migrateBody } from './migrate';
export { events, cadence } from './repo';
export { BodyBox } from './BodyBox';
export type { BodyEvent, BodyEventKind, BodySection } from './types';

/**
 * Cadence adapter for the CadenceScanner. Yields one entry per distinct
 * movement activity (yoga / walk / run / …). Water + supplement are
 * intentionally NOT included — those are continuous low-stakes cadences
 * where an "overdue" notification feels nag-shaped. If we surface them
 * later it'll be via a separate per-kind UI toggle, not this scanner.
 */
export async function enumerateCadences(): Promise<CadenceTrackedEntry[]> {
  const list = await eventsRepo.list();
  const activities = new Set<string>();
  for (const e of list) {
    if (e.kind !== 'movement') continue;
    const label = normaliseLabel(getLabel(e));
    if (label) activities.add(label);
  }

  const out: CadenceTrackedEntry[] = [];
  for (const activity of activities) {
    try {
      const estimate = await cadenceRepo.getMovementCadenceFor(activity);
      out.push({
        module: 'body',
        key: activity,
        label: activity,
        estimate,
      });
    } catch {
      /* skip one broken activity, keep scanning */
    }
  }
  return out;
}
