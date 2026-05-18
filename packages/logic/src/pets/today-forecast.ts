/**
 * @ollie/logic · pets today-forecast + vocab + preface + adoptversary
 *
 * Pure: no I/O, no clock reads (now is always a parameter).
 */

import type { Pet, CareGap, SpeciesProfile, VocabTerm } from './types';
import { TASK_DISPLAY, PREFACES } from './constants';
import { SPECIES_VOCAB } from './species-profiles';
import { DAY_MS } from '../util';

/**
 * One-liner forecast for a pet's day.
 * Example: "TONTIN TODAY — HAY REFILL, FLOOR TIME · 20 MIN FLOOR TIME"
 */
export function todayForecast(
  pet: Pet | undefined | null,
  careGaps: CareGap[] | undefined | null,
  profile: SpeciesProfile | undefined | null,
): string {
  if (!pet || !profile) return '';
  const petName = (pet.name ?? '').toUpperCase();
  const gapsForPet = (careGaps ?? []).filter(
    (g) => g.pet_id === pet.id && g.severity !== 'ok',
  );
  if (gapsForPet.length === 0) {
    return `${petName} TODAY — NOTHING DUE · JUST HANG OUT`;
  }
  const display = gapsForPet.slice(0, 3).map((g) => {
    const name = (TASK_DISPLAY[g.task] ?? g.task.replace(/_/g, ' ')).toUpperCase();
    return name;
  });
  const bondMin = profile.bonding?.min_daily_minutes ?? 0;
  const trailing = bondMin > 0 ? ` · ${bondMin} MIN FLOOR TIME` : '';
  return `${petName} TODAY — ${display.join(', ')}${trailing}`;
}

/**
 * Pick a species vocab term, rotating deterministically by ISO week
 * and skipping recently shown terms.
 */
export function pickVocabTerm(
  pet: Pet | undefined | null,
  vocabShown: Record<string, string[]> | undefined | null,
  _profile: SpeciesProfile | undefined | null,
  now: number,
): VocabTerm | null {
  if (!pet) return null;
  const vocab = SPECIES_VOCAB[pet.species] ?? [];
  if (vocab.length === 0) return null;
  const weekOfYear = Math.floor(
    (now - new Date(new Date(now).getFullYear(), 0, 1).getTime()) / (7 * DAY_MS),
  );
  let h = 0;
  const key = (pet.id ?? '') + ':' + weekOfYear;
  for (let i = 0; i < key.length; i++) h = ((h * 31 + key.charCodeAt(i)) >>> 0);
  const recent = (vocabShown && vocabShown[pet.id]) ?? [];
  for (let i = 0; i < vocab.length; i++) {
    const candidate = vocab[(h + i) % vocab.length];
    if (!recent.includes(candidate.term)) return candidate;
  }
  return vocab[h % vocab.length];
}

/**
 * Pick the weekly rotating editorial preface.
 */
export function pickPreface(now: number): string {
  const week = Math.floor(
    (now - new Date(new Date(now).getFullYear(), 0, 1).getTime()) / (7 * DAY_MS),
  );
  return PREFACES[((week % PREFACES.length) + PREFACES.length) % PREFACES.length];
}

/**
 * Return the number of whole years since adoption if today is the
 * adopt-anniversary, otherwise null.
 */
export function isAdoptversary(
  pet: Pet | undefined | null,
  now: number,
): number | null {
  if (!pet || !pet.adopted_at) return null;
  const adopted = new Date(pet.adopted_at);
  const today = new Date(now);
  if (
    adopted.getMonth() !== today.getMonth() ||
    adopted.getDate() !== today.getDate()
  )
    return null;
  const years = today.getFullYear() - adopted.getFullYear();
  return years > 0 ? years : null;
}
