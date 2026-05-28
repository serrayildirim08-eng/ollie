/**
 * Medication module · domain types.
 *
 * Two concepts: a `Medication` is a row in the registry (the user takes it,
 * once we've seen the name), and an `Event` is a single occurrence — a dose
 * taken, a dose missed, or a side-effect note.
 *
 * Names are normalised (lowercase, collapsed whitespace) so "Adderall" and
 * "adderall " collapse to one registry row. The registry is auto-created
 * the first time the router mentions a medication — there is no "add med"
 * action; the act of logging implies it exists.
 */

export type EventKind = 'dose' | 'missed' | 'side_effect';

/** One medication in the user's registry. Auto-registered on first mention. */
export interface Medication {
  id: string;
  /** Normalised lowercase form — what we key on. */
  name: string;
  createdAt: number; // ms since epoch
}

/**
 * One logged occurrence. `data` holds the kind-specific payload:
 *   - dose         → { dose?: string }   (e.g. "20mg")
 *   - missed       → {}
 *   - side_effect  → { note: string }
 *
 * Kept as a JSON column so we can extend without a migration.
 */
export interface MedicationEvent {
  id: string;
  medId: string;
  kind: EventKind;
  dose: string | null;
  note: string | null;
  loggedAt: number;
}

/**
 * Joined event row surfaced to the UI — carries the medication name so the
 * box doesn't have to re-query the registry per row.
 */
export interface MedicationEventWithName extends MedicationEvent {
  medName: string;
}

export function normaliseName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}
