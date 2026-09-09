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

export type EventKind = 'dose' | 'missed' | 'side_effect' | 'later' | 'skipped';

/**
 * What kind of thing this is. Mirrors @ollie/logic MedicationKind so the
 * bridge can hand it straight to the watcher with no remap. No detector
 * branches on kind today — it is a classification field for the UI + future
 * surfaces — but it round-trips through the registry.
 */
export type MedicationKind = 'prescription' | 'vitamin' | 'supplement' | 'otc';

export const MEDICATION_KINDS: readonly MedicationKind[] = [
  'prescription',
  'vitamin',
  'supplement',
  'otc',
] as const;

/** One medication in the user's registry. Auto-registered on first mention. */
export interface Medication {
  id: string;
  /** Normalised lowercase form — what we key on. */
  name: string;
  createdAt: number; // ms since epoch
  /** Classification — defaults to 'prescription' for legacy rows. */
  kind: MedicationKind;
  /** Daily dose times as "HH:MM" 24h-local strings. Empty = manual log only. */
  schedule: string[];
}

/** Coerce a stored string into a known MedicationKind, defaulting safely. */
export function coerceKind(raw: unknown): MedicationKind {
  return MEDICATION_KINDS.includes(raw as MedicationKind)
    ? (raw as MedicationKind)
    : 'prescription';
}

/**
 * Parse the stored `schedule` JSON column into a clean, sorted, de-duped
 * array of valid "HH:MM" strings. Tolerates legacy NULL / malformed values.
 */
export function parseSchedule(raw: unknown): string[] {
  let arr: unknown;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  for (const v of arr) {
    const t = normaliseTime(v);
    if (t) seen.add(t);
  }
  return [...seen].sort();
}

/** Normalise a single time value to zero-padded "HH:MM", or null if invalid. */
export function normaliseTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Forgiving parse — accepts "09:00", "9", "9:30", "9am", "9 am", "9:30 pm",
  // "21:00". ADHD-friendly: people type time however feels natural.
  const s = raw.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const mn = m[2] != null ? Number(m[2]) : 0;
  const ap = m[3];
  if (mn < 0 || mn > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h < 0 || h > 23) {
    return null;
  }
  return `${h.toString().padStart(2, '0')}:${mn.toString().padStart(2, '0')}`;
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

// ─── cabinet inventory ──────────────────────────────────────────────────────
//
// The "cabinet" tab is a STOCK view, separate from the schedule (the "today"
// tab). One row per med / supplement the user keeps, grouped BY PURPOSE in the
// UI. The schedule registry (medications_registry) answers "what do I take and
// when"; the cabinet answers "what do I have, and is it running low".
//
// `qty` is optional — when present + a daily schedule is known the low-stock
// logic can auto-count-down; when absent the cabinet degrades to the manual
// `lowFlag` only. See lowStock.ts.

import type { MedPurpose } from './purposeMap';

/** One row in the medication cabinet (stock inventory). */
export interface CabinetItem {
  id: string;
  /** Normalised lowercase name — what we key on (matches registry naming). */
  name: string;
  /** Which purpose bucket the cabinet groups it under. */
  purpose: MedPurpose;
  /** Free-text dose label ("400mg", "2000 IU"), or null. */
  doseLabel: string | null;
  /** Units remaining, or null when the user never entered a count (manual-only). */
  qty: number | null;
  /** Manual "running low" override — wins over the auto count-down. */
  lowFlag: boolean;
  createdAt: number; // ms since epoch
}
