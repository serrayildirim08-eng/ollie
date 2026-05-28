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

export type CycleEventKind = 'period_start' | 'period_end' | 'symptom' | 'pill';

/** One logged event. Symptom text lives in `data` as JSON to keep the
 *  table single-shape; future kinds can add structured detail there too. */
export interface CycleEvent {
  id: string;
  kind: CycleEventKind;
  /** Free-form symptom label for `symptom` events; null otherwise. */
  symptom: string | null;
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
