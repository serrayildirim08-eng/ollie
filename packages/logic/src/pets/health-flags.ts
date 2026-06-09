/**
 * @ollie/logic · pets health flags
 *
 * detectHealthFlags — rule-based; run_length ≥ 3 calendar days required.
 * Pure: no I/O, no clock reads.
 */

import type { Observation, SpeciesProfiles, PetHealthFlag } from './types';

import { DAY_MS } from '../util';

/**
 * Scan observations for a pet and surface health flags whose signals
 * appeared on ≥ 3 distinct calendar days.
 *
 * `speciesProfiles` is the full map; the function scans all profiles
 * because caller may not know the pet's species up-front.
 */
export function detectHealthFlags(
  petId: string,
  observations: Observation[] | undefined | null,
  speciesProfiles: SpeciesProfiles,
  _now: number,
): PetHealthFlag[] {
  const out: PetHealthFlag[] = [];
  if (!petId || !Array.isArray(observations)) return out;
  const petObs = observations.filter((o) => o.pet_id === petId);
  if (petObs.length === 0) return out;

  const profiles = Object.values(speciesProfiles ?? {});
  for (const profile of profiles) {
    const flags = profile.health_flags ?? {};
    for (const [flag, config] of Object.entries(flags)) {
      const signals = config.signals ?? [];
      const hits = petObs.filter((o) => {
        const text = (o.text ?? '').toLowerCase();
        return signals.some((s) => text.includes(s));
      });
      if (hits.length === 0) continue;
      // Run length = distinct calendar days (no double-counting within a day)
      const days = new Set(
        hits.map((h) => Math.floor((h.occurred_at ?? 0) / DAY_MS)),
      );
      if (days.size < 3) continue;
      const lastSignal = Math.max(...hits.map((h) => h.occurred_at ?? 0));
      out.push({
        flag,
        run_length: days.size,
        last_signal_at: lastSignal,
        source_url: config.source_url,
      });
    }
  }
  return out;
}
