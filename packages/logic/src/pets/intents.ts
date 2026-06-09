/**
 * @ollie/logic · pets intents
 *
 * parsePetMention, parseAwayIntent, parseSessionIntent,
 * detectMilestone, computeWeatherAlerts.
 *
 * Pure: no I/O, no clock reads (now is always a parameter).
 */

import type {
  Pet,
  SpeciesProfiles,
  PetMentionResult,
  PetMentionMatch,
  Observation,
  AwayIntent,
  SessionIntent,
  Milestone,
  WeatherInput,
  WeatherAlert,
} from './types';
import { NEGATION_WINDOW, NEGATION_MARKERS } from './constants';
import { DAY_MS, HOUR_MS } from '../util';

// ─── parsePetMention ────────────────────────────────────────────────────

/**
 * Scan a brain-dump string for pet names / species terms + care-task keywords.
 * Returns matched care-log entries and free-text observations.
 */
export function parsePetMention(
  text: string,
  pets: Pet[],
  speciesProfiles: SpeciesProfiles,
  now: number,
): PetMentionResult {
  const matches: PetMentionMatch[] = [];
  const observations: Observation[] = [];
  if (!text || !Array.isArray(pets) || pets.length === 0)
    return { matches, observations };

  const lower = String(text).toLowerCase().trim();
  if (!lower) return { matches, observations };

  const sentences = lower.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/);

    // Temporal offset
    let tsOffsetMs = 0;
    if (/\byesterday\b/.test(sentence)) tsOffsetMs = 24 * HOUR_MS;
    else if (/\blast night\b/.test(sentence)) tsOffsetMs = 12 * HOUR_MS;
    else if (/\bthis morning\b|\bearlier\b/.test(sentence)) tsOffsetMs = 6 * HOUR_MS;
    const occurred_at = now - tsOffsetMs;

    // Candidate pets in this sentence
    const matchedPets: Pet[] = [];
    const seenPetIds = new Set<string>();
    const addPet = (pet: Pet) => {
      if (!seenPetIds.has(pet.id)) {
        matchedPets.push(pet);
        seenPetIds.add(pet.id);
      }
    };

    // Direct name / nickname match
    for (const pet of pets) {
      if (pet.archived) continue;
      const name = (pet.name ?? '').toLowerCase();
      const nick = (pet.nickname ?? '').toLowerCase();
      if (name && sentence.includes(name)) addPet(pet);
      if (nick && sentence.includes(nick)) addPet(pet);
    }
    // Species-generic terms fallback
    if (matchedPets.length === 0) {
      for (const pet of pets) {
        if (pet.archived) continue;
        const terms =
          (speciesProfiles[pet.species]?.species_terms) ?? [];
        if (terms.some((t) => sentence.includes(t))) addPet(pet);
      }
    }
    if (matchedPets.length === 0) continue;

    // Task keyword scan per matched pet (by species, deduplicated)
    const taskHitsBySpecies: Record<
      string,
      Array<{ task: string; conf: number; kw: string; negated: boolean }>
    > = {};

    for (const pet of matchedPets) {
      const species = pet.species;
      const profile = speciesProfiles[species];
      if (!profile || taskHitsBySpecies[species]) continue;
      const keywords = profile.parser_keywords ?? {};
      const hits: Array<{ task: string; conf: number; kw: string; negated: boolean }> = [];
      for (const [task, list] of Object.entries(keywords)) {
        for (const { kw, conf } of list) {
          const idx = sentence.indexOf(kw);
          if (idx < 0) continue;
          const kwFirstToken = sentence.slice(0, idx).split(/\s+/).length - 1;
          const windowStart = Math.max(0, kwFirstToken - NEGATION_WINDOW);
          const windowTokens = tokens.slice(windowStart, kwFirstToken);
          const windowText = ' ' + windowTokens.join(' ') + ' ';
          const negated = NEGATION_MARKERS.some((m) =>
            windowText.includes(' ' + m + ' '),
          );
          hits.push({ task, conf, kw, negated });
        }
      }
      taskHitsBySpecies[species] = hits;
    }

    for (const pet of matchedPets) {
      const hits = taskHitsBySpecies[pet.species] ?? [];
      const seenTask = new Set<string>();
      for (const hit of hits) {
        if (seenTask.has(hit.task)) continue;
        seenTask.add(hit.task);
        if (hit.negated) {
          observations.push({
            pet_id: pet.id,
            text: sentence,
            tags: ['pending_intent:' + hit.task],
          });
          continue;
        }
        matches.push({
          pet_id: pet.id,
          task: hit.task,
          confidence: hit.conf,
          raw_text: sentence,
          occurred_at,
        });
      }
    }

    // Observation tags (species-specific positive signals)
    for (const pet of matchedPets) {
      const profile = speciesProfiles[pet.species];
      if (!profile) continue;
      const tags = (profile.observation_tags ?? []).filter((t) =>
        sentence.includes(t),
      );
      if (tags.length > 0) {
        observations.push({ pet_id: pet.id, text: sentence, tags });
      }
    }
  }

  return { matches, observations };
}

// ─── parseAwayIntent ─────────────────────────────────────────────────────

/**
 * Detect "I'll be away for N days" phrases and return a structured away intent.
 */
export function parseAwayIntent(
  text: string,
  now: number,
): AwayIntent | null {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const hasAway =
    /\b(out of town|on vacation|traveling|travelling|away for (\d+)\s*days?|away until)\b/.test(
      lower,
    );
  if (!hasAway) return null;
  const m = lower.match(/away for (\d+)\s*days?/);
  const days = m ? parseInt(m[1], 10) : 3;
  return { active: true, returning_at: now + days * DAY_MS };
}

// ─── parseSessionIntent ─────────────────────────────────────────────────

/**
 * Detect "hanging with <pet>" / "done with <pet>" session start/close phrases.
 */
export function parseSessionIntent(
  text: string,
  pets: Pet[],
  now: number,
): SessionIntent {
  if (!text || !Array.isArray(pets) || pets.length === 0)
    return { type: null, pet_id: null, at: now };
  const lower = String(text).toLowerCase();
  const match = pets.find(
    (p) =>
      !p.archived &&
      ((p.name && lower.includes(p.name.toLowerCase())) ||
        (p.nickname && lower.includes(p.nickname.toLowerCase()))),
  );
  if (!match) return { type: null, pet_id: null, at: now };
  const startRe =
    /\b(hanging with|gonna spend time with|lap time with|about to hang with)\b/;
  const closeRe =
    /\b(done|put (them|him|her) back|was with .* for|back in the cage)\b/;
  if (startRe.test(lower)) return { type: 'start', pet_id: match.id, at: now };
  if (closeRe.test(lower)) return { type: 'close', pet_id: match.id, at: now };
  return { type: null, pet_id: match.id, at: now };
}

// ─── detectMilestone ─────────────────────────────────────────────────────

/**
 * Return a Milestone if the observation contains a known observation tag
 * not yet recorded for this pet.
 */
export function detectMilestone(
  observation: Observation | undefined | null,
  existingMilestones: Milestone[] | undefined | null,
  profile: { observation_tags?: string[] } | undefined | null,
): Milestone | null {
  if (!observation || !profile) return null;
  const tags = (observation.tags ?? []).filter(
    (t) => !String(t).startsWith('pending_intent:'),
  );
  if (tags.length === 0) return null;
  const known = profile.observation_tags ?? [];
  for (const tag of tags) {
    if (!known.includes(tag)) continue;
    const already = (existingMilestones ?? []).some(
      (m) => m.pet_id === observation.pet_id && m.tag === tag,
    );
    if (!already) {
      return {
        pet_id: observation.pet_id,
        tag,
        first_seen_at: observation.occurred_at ?? 0,
        raw_text: observation.text ?? '',
      };
    }
  }
  return null;
}

// ─── computeWeatherAlerts ────────────────────────────────────────────────

/**
 * Return welfare alerts based on current outdoor temperature.
 * Thresholds are Celsius (research-backed).
 * Display formatting (°C / °F) is left to the UI layer.
 */
export function computeWeatherAlerts(
  pet: Pet | undefined | null,
  profile: { display_name?: string } | undefined | null,
  weather: WeatherInput | undefined | null,
  _now: number,
): WeatherAlert[] {
  const out: WeatherAlert[] = [];
  if (!pet || !profile || !weather) return out;
  const temp = typeof weather.temp === 'number' ? weather.temp : null;
  const species = pet.species;
  // Small-mammal heat warning
  if (
    ['guinea_pig', 'rabbit', 'hamster', 'rat'].includes(species) &&
    temp !== null &&
    temp > 26
  ) {
    out.push({
      task: 'weather_welfare',
      severity: 'firm',
      welfare_note: `it's ${temp}°C — small mammals cannot thermoregulate above 26°C. check that the enclosure is cool.`,
    });
  }
  // Dog extreme-weather warning
  if (species === 'dog' && temp !== null && (temp > 32 || temp < -5)) {
    out.push({
      task: 'weather_welfare',
      severity: 'soft',
      welfare_note: `temp ${temp}°C — keep walks short and watch paws.`,
    });
  }
  return out;
}
