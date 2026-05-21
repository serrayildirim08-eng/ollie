/**
 * pets-for-feedme — feed-target options for the `feed me` mode.
 *
 * The grocery Feed Me face can plan a meal "for me" or "for <pet>". The pet
 * list comes from the live `pets.pets` store slice when the user has added
 * any; falls back to Serra's hard-coded household (tontin / pinpon / the
 * pigs) when the store is empty so the feature has something to show in the
 * unseeded preview build.
 *
 * v1 keeps this a small, deterministic helper so we don't pull pets-v2
 * selectors into grocery-v2. Per-pet history weighting lives on the backend
 * (see `feed_me_cook_signals(p_user, p_feed_target, p_pet_name)`).
 *
 * The names returned here are **prompt hints** for the Gemini side, not
 * binding identifiers. Per-pet adaptive learning falls back to the literal
 * string match on `cook_history.pet_name`.
 */

export interface FeedTargetOption {
  /** The literal `feedTarget` mode for the endpoint payload. */
  mode: 'user' | 'pet';
  /** The literal `petName` for the endpoint when `mode === 'pet'`. */
  petName: string | null;
  /** The chip label shown in the UI ("for me" / "for tontin"). */
  label: string;
  /** Stable id for React keys + telemetry. */
  id: string;
}

const HARDCODED_PETS: ReadonlyArray<string> = ['tontin', 'pinpon', 'the pigs'];

/**
 * One pet-shape this helper accepts from the live `pets.pets` store slice.
 * Deliberately narrow — we only need the name + archived flag here; the
 * full `StoredPet` shape lives in pets-v2/selectors.ts.
 */
export interface FeedMePetRow {
  name?: string;
  nickname?: string | null;
  archived?: boolean;
}

/**
 * Build the chip row from the live store. Always prepends the "for me"
 * option. When `pets` is empty / undefined, falls back to Serra's
 * hard-coded household.
 *
 * Pets that are archived are skipped. Pets without a name are skipped.
 */
export function buildFeedTargetOptions(
  pets: ReadonlyArray<FeedMePetRow> | null | undefined,
): FeedTargetOption[] {
  const out: FeedTargetOption[] = [
    { mode: 'user', petName: null, label: 'for me', id: 'feed:user' },
  ];

  const live = (pets ?? [])
    .filter((p) => !p?.archived)
    .map((p) => (p.nickname ?? p.name ?? '').trim().toLowerCase())
    .filter((name) => name.length > 0);

  const names = live.length > 0 ? live : HARDCODED_PETS;

  // Deduplicate (Serra's household has 3 guinea pigs we collapse to "the pigs"
  // upstream; on the off-chance the store has dupes we still want a clean list).
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      mode: 'pet',
      petName: name,
      label: `for ${name}`,
      id: `feed:pet:${name.replace(/\s+/g, '_')}`,
    });
  }

  return out;
}

/** test-only — expose the fallback list so fixtures can assert on it */
export const _HARDCODED_PETS_FOR_TEST = HARDCODED_PETS;
