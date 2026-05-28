/**
 * Pets module · domain types.
 *
 * One household has a handful of pets (Tontin + Pinpon — the guinea pigs —
 * are the named anchors). Every brain-dump fragment that mentions them
 * lands as a `PetEvent` in a single events table, distinguished by `kind`.
 *
 * Kept narrow on purpose: the router emits a small action vocabulary
 * (care / observation / vet / feed / supplement) and the UI groups by
 * the same kinds. Kind-specific fields live inside the `data` JSON blob
 * so we don't need a column-explosion as new pet behaviours are tracked.
 */

export type PetEventKind = 'care' | 'observation' | 'vet' | 'feed' | 'supplement';

/**
 * A single logged moment for a pet. `petName` is nullable because the
 * router doesn't always know who the dump refers to ("fed them") — we
 * still want the row recorded.
 */
export interface PetEvent {
  id: string;
  petName: string | null;     // normalised (lowercase) — null when unknown
  kind: PetEventKind;
  data: PetEventData;         // parsed JSON; see union below
  loggedAt: number;           // ms since epoch
}

/** Kind-specific payload, parsed out of the SQLite text column. */
export type PetEventData =
  | { kind: 'care'; what: string }
  | { kind: 'observation'; note: string }
  | { kind: 'vet'; reason: string | null }
  | { kind: 'feed' }
  | { kind: 'supplement'; supplement: string; dose: string | null };

export const PET_EVENT_KINDS: PetEventKind[] = [
  'care',
  'observation',
  'vet',
  'feed',
  'supplement',
];

/**
 * Normalise a pet name into a stable, case-insensitive key. Empty / null
 * input collapses to `null` so the repo can store unknowns explicitly.
 */
export function normalisePetName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalise a supplement key. We recognise the three the router emits
 * explicitly and pass any other free string through (lowercased), so the
 * scurvy-critical `vitamin_c` always matches regardless of casing.
 */
export function normaliseSupplement(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, '_');
}

/** Display label for a supplement key — UI shouldn't show snake_case. */
export function supplementLabel(key: string): string {
  switch (key) {
    case 'vitamin_c':
      return 'vitamin C';
    case 'vitamin_d':
      return 'vitamin D';
    case 'calcium':
      return 'calcium';
    default:
      return key.replace(/_/g, ' ');
  }
}

/** Display label for a pet name — Title-cases the stored lowercase key. */
export function petNameLabel(name: string | null): string {
  if (!name) return 'unknown';
  return name
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
