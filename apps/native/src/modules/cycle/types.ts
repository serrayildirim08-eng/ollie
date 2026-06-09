/**
 * Cycle module · domain types.
 *
 * One table, one event stream: each row is a discrete thing that happened —
 * a period started, a period ended, a symptom logged, a pill taken. The UI
 * derives "current cycle day" from this stream at read time.
 *
 * Sensitive surface; we keep the vocabulary neutral on purpose — no
 * "fertility window", no risk scoring, no warnings.
 */

export type CycleEventKind =
  | 'period_start'
  | 'period_end'
  | 'symptom'
  | 'pill'
  | 'bleeding'
  // Pregnancy pause — NOT pregnancy tracking. Two bare markers only:
  //   pregnancy_start  the user declared they're pregnant → cycle goes dormant.
  //   pregnancy_end    the pregnancy ended by ANY path (birth / miscarriage /
  //                    termination) → cycle resumes from that point.
  // "currently pregnant" is derived: a pregnancy_start with no later
  // pregnancy_end. There is deliberately no due date, trimester, kind-of-end,
  // weight, or any other pregnancy field — the end event is the sole resume
  // trigger and carries no clinical detail.
  | 'pregnancy_start'
  | 'pregnancy_end';

/**
 * Bleeding-intensity tags — the brief's 9 editorial flow descriptors. These
 * are deliberately descriptive, never clinical-alarming. Ordered loosely
 * light→heavy with the colour/character tags after; a future flow-clustering
 * detector can map these to a numeric weight if it ever needs to.
 *
 * brief 7: spotting · light · medium · heavy · clots · brown · pink
 * + 2 mapped sensibly: flooding (beyond heavy) · none (a tracked dry day).
 */
export type BleedingIntensity =
  | 'spotting'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'flooding'
  | 'clots'
  | 'brown'
  | 'pink'
  | 'none';

export const BLEEDING_INTENSITIES: readonly BleedingIntensity[] = [
  'spotting',
  'light',
  'medium',
  'heavy',
  'flooding',
  'clots',
  'brown',
  'pink',
  'none',
];

/** One logged event. Symptom text + bleeding intensity live in `data` as
 *  JSON to keep the table single-shape; future kinds add detail there too. */
export interface CycleEvent {
  id: string;
  kind: CycleEventKind;
  /** Free-form symptom label for `symptom` events; null otherwise. */
  symptom: string | null;
  /** Bleeding-intensity tag for `bleeding` events; null otherwise. */
  intensity: BleedingIntensity | null;
  occurredAt: number; // ms since epoch
}

/** Derived view: where we are right now relative to the last period.
 *  `null` means we have no period_start on record at all. */
export interface CurrentCycle {
  /** ms since epoch of the most recent period_start event. */
  startedAt: number;
  /** Whole days since that start (0 = today). */
  daysSinceStart: number;
  /** True if the period appears to still be ongoing — no period_end has
   *  landed in the < 8-day window after the start. */
  bleeding: boolean;
}

export function normaliseSymptom(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
