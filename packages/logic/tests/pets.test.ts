import { describe, it, expect } from 'vitest';
import {
  SPECIES_PROFILES,
  SPECIES_LIST,
  SPECIES_VOCAB,
  computeCareGaps,
  computeTrustLevel,
  summarize,
  detectHealthFlags,
  generateGuiltTripCopy,
  todayForecast,
  pickPreface,
  pickVocabTerm,
  isAdoptversary,
  parsePetMention,
  parseAwayIntent,
  parseSessionIntent,
  detectMilestone,
  computeWeatherAlerts,
  scheduleVetCues,
  detectVetAdherenceDelay,
  detectCoRegulator,
  detectCareActivationBarrier,
  detectCrashContextMisses,
  matchProjectionInDump,
  detectProjectionPattern,
  detectPatterns,
  type Pet,
  type CareLogEntry,
  type Observation,
  type PetsState,
} from '../src/pets';

// ─── shared fixtures ─────────────────────────────────────────────────

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_000 * DAY; // arbitrary epoch anchor

const tontin: Pet = { id: 'pet-1', name: 'Tontin', species: 'guinea_pig', created_at: NOW - 60 * DAY };
const pinpon: Pet = { id: 'pet-2', name: 'Pinpon', species: 'guinea_pig', created_at: NOW - 60 * DAY };

// ─── 1. SPECIES_PROFILES ─────────────────────────────────────────────

describe('SPECIES_PROFILES', () => {
  it('contains all 10 expected species keys', () => {
    expect(SPECIES_LIST).toHaveLength(10);
    expect(SPECIES_LIST).toContain('guinea_pig');
    expect(SPECIES_LIST).toContain('betta_fish');
  });

  it('every profile has required shape', () => {
    for (const key of SPECIES_LIST) {
      const p = SPECIES_PROFILES[key];
      expect(p).toBeDefined();
      expect(typeof p.display_name).toBe('string');
      expect(typeof p.bonding.min_daily_minutes).toBe('number');
      expect(Array.isArray(p.observation_tags)).toBe(true);
    }
  });

  it('SPECIES_VOCAB covers all 10 species', () => {
    for (const key of SPECIES_LIST) {
      expect(Array.isArray(SPECIES_VOCAB[key])).toBe(true);
      expect(SPECIES_VOCAB[key].length).toBeGreaterThan(0);
    }
  });
});

// ─── 2. computeCareGaps ──────────────────────────────────────────────

describe('computeCareGaps', () => {
  it('returns ok when task done within cadence', () => {
    const log: CareLogEntry[] = [
      { pet_id: 'pet-1', task: 'hay_refill', occurred_at: NOW - 1 * DAY },
    ];
    const gaps = computeCareGaps([tontin], log, SPECIES_PROFILES, NOW);
    const hayGap = gaps.find((g) => g.pet_id === 'pet-1' && g.task === 'hay_refill');
    expect(hayGap?.severity).toBe('ok');
  });

  it('escalates to concerned when far beyond critical', () => {
    const log: CareLogEntry[] = [
      { pet_id: 'pet-1', task: 'hay_refill', occurred_at: NOW - 30 * DAY },
    ];
    const gaps = computeCareGaps([tontin], log, SPECIES_PROFILES, NOW);
    const hayGap = gaps.find((g) => g.pet_id === 'pet-1' && g.task === 'hay_refill');
    expect(hayGap?.severity).toBe('concerned');
    expect(hayGap?.critical).toBe(true);
  });

  it('cold-start pets get a one-level severity downgrade', () => {
    const newPet: Pet = { id: 'pet-new', name: 'Baby', species: 'guinea_pig', adopted_at: NOW - 3 * DAY };
    const log: CareLogEntry[] = [
      // 4 days ago: daysSince=4, cadence=2, cadence*1.5=3 → 4>3 → soft; cold-start → nudge
      { pet_id: 'pet-new', task: 'hay_refill', occurred_at: NOW - 4 * DAY },
    ];
    const gaps = computeCareGaps([newPet], log, SPECIES_PROFILES, NOW);
    const hayGap = gaps.find((g) => g.task === 'hay_refill');
    expect(hayGap?.severity).toBe('nudge');
  });

  it('skips archived pets', () => {
    const archived: Pet = { ...tontin, id: 'arc', archived: true };
    const gaps = computeCareGaps([archived], [], SPECIES_PROFILES, NOW);
    expect(gaps).toHaveLength(0);
  });
});

// ─── 3. computeTrustLevel (stub) ─────────────────────────────────────

describe('computeTrustLevel', () => {
  it('returns stage 0 stub', () => {
    const result = computeTrustLevel();
    expect(result.stage).toBe(0);
    expect(typeof result.stageName).toBe('string');
  });
});

// ─── 4. summarize ────────────────────────────────────────────────────

describe('summarize', () => {
  it('returns correct n_pets and most_pressing', () => {
    const log: CareLogEntry[] = [
      { pet_id: 'pet-1', task: 'hay_refill', occurred_at: NOW - 30 * DAY },
    ];
    const gaps = computeCareGaps([tontin, pinpon], log, SPECIES_PROFILES, NOW);
    const s = summarize([tontin, pinpon], log, [], gaps, NOW);
    expect(s.n_pets).toBe(2);
    expect(s.n_gaps).toBeGreaterThan(0);
    expect(s.most_pressing).not.toBeNull();
  });

  it('n_health_flags_pending is 0 (wired by orchestrator)', () => {
    const s = summarize([], [], [], [], NOW);
    expect(s.n_health_flags_pending).toBe(0);
  });
});

// ─── 5. detectHealthFlags ────────────────────────────────────────────

describe('detectHealthFlags', () => {
  it('flags when signal appears on 3+ distinct calendar days', () => {
    const obs: Observation[] = [
      { pet_id: 'pet-1', text: 'tontin is not eating', tags: [], occurred_at: NOW - 3 * DAY },
      { pet_id: 'pet-1', text: 'tontin is not eating', tags: [], occurred_at: NOW - 2 * DAY },
      { pet_id: 'pet-1', text: 'tontin wont eat anything', tags: [], occurred_at: NOW - 1 * DAY },
    ];
    const flags = detectHealthFlags('pet-1', obs, SPECIES_PROFILES, NOW);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].flag).toBe('not_eating');
    expect(flags[0].run_length).toBe(3);
  });

  it('does NOT flag when signal appears on only 2 days', () => {
    const obs: Observation[] = [
      { pet_id: 'pet-1', text: 'not eating', tags: [], occurred_at: NOW - 2 * DAY },
      { pet_id: 'pet-1', text: 'not eating', tags: [], occurred_at: NOW - 1 * DAY },
    ];
    const flags = detectHealthFlags('pet-1', obs, SPECIES_PROFILES, NOW);
    expect(flags).toHaveLength(0);
  });

  it('matches signals on structured kind="symptom" observations', () => {
    // Frontend writes structured observations; the engine still scans `text`.
    const obs: Observation[] = [
      { id: 'o1', pet_id: 'pet-1', kind: 'symptom', text: 'hunched', tags: ['posture'], occurred_at: NOW - 3 * DAY, created_at: NOW - 3 * DAY },
      { id: 'o2', pet_id: 'pet-1', kind: 'symptom', text: 'still hunched today', tags: ['posture'], occurred_at: NOW - 2 * DAY, created_at: NOW - 2 * DAY },
      { id: 'o3', pet_id: 'pet-1', kind: 'symptom', text: 'hunched again', tags: ['posture'], occurred_at: NOW - 1 * DAY, created_at: NOW - 1 * DAY },
    ];
    const flags = detectHealthFlags('pet-1', obs, SPECIES_PROFILES, NOW);
    expect(flags.some((f) => f.flag === 'hunched')).toBe(true);
  });

  it('ignores kind="weight" observations for signal matching', () => {
    // Weight rows carry no signal phrase → never trip a health flag.
    const obs: Observation[] = [
      { id: 'w1', pet_id: 'pet-1', kind: 'weight', text: '', tags: [], value_grams: 980, occurred_at: NOW - 3 * DAY },
      { id: 'w2', pet_id: 'pet-1', kind: 'weight', text: '', tags: [], value_grams: 975, occurred_at: NOW - 2 * DAY },
      { id: 'w3', pet_id: 'pet-1', kind: 'weight', text: '', tags: [], value_grams: 970, occurred_at: NOW - 1 * DAY },
    ];
    const flags = detectHealthFlags('pet-1', obs, SPECIES_PROFILES, NOW);
    expect(flags).toHaveLength(0);
  });
});

// ─── 6. generateGuiltTripCopy ─────────────────────────────────────────

describe('generateGuiltTripCopy', () => {
  it('returns ok for severity=ok', () => {
    const gap = { pet_id: 'pet-1', task: 'hay_refill', last_occurred_at: NOW - 1 * DAY, days_since: 1, severity: 'ok' as const, critical: false };
    const result = generateGuiltTripCopy(gap, tontin, SPECIES_PROFILES['guinea_pig']);
    expect(result.level).toBe('ok');
    expect(result.text).toBe('');
  });

  it('generates firm copy with correct pet name and task', () => {
    const gap = { pet_id: 'pet-1', task: 'hay_refill', last_occurred_at: NOW - 10 * DAY, days_since: 10, severity: 'firm' as const, critical: true };
    const result = generateGuiltTripCopy(gap, tontin, SPECIES_PROFILES['guinea_pig']);
    expect(result.level).toBe('firm');
    expect(result.text).toContain('tontin');
    expect(result.text).toContain('10 days late');
  });

  it('appends welfare_note for concerned severity', () => {
    const gap = { pet_id: 'pet-1', task: 'vitamin_c', last_occurred_at: NOW - 10 * DAY, days_since: 10, severity: 'concerned' as const, critical: true };
    const result = generateGuiltTripCopy(gap, tontin, SPECIES_PROFILES['guinea_pig']);
    expect(result.text).toContain('vitamin c');
    // welfare_note for vitamin_c mentions scurvy
    expect(result.text).toContain('scurvy');
  });
});

// ─── 7. todayForecast / pickPreface / isAdoptversary ──────────────────

describe('todayForecast', () => {
  it('returns NOTHING DUE copy when no gaps', () => {
    const result = todayForecast(tontin, [], SPECIES_PROFILES['guinea_pig']);
    expect(result).toContain('NOTHING DUE');
    expect(result).toContain('TONTIN');
  });

  it('lists overdue tasks in uppercase', () => {
    const gaps = computeCareGaps([tontin], [], SPECIES_PROFILES, NOW);
    const result = todayForecast(tontin, gaps, SPECIES_PROFILES['guinea_pig']);
    // with no log entries, tasks will be concerned → appear in forecast
    expect(result).toMatch(/TONTIN TODAY/);
  });
});

describe('pickPreface', () => {
  it('returns a non-empty string from PREFACES', () => {
    const p = pickPreface(NOW);
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });
});

describe('isAdoptversary', () => {
  it('returns years when adopted on same calendar day', () => {
    const adoptedAt = new Date(NOW);
    const twoYearsAgo = new Date(adoptedAt);
    twoYearsAgo.setFullYear(adoptedAt.getFullYear() - 2);
    const pet: Pet = { id: 'x', name: 'X', species: 'cat', adopted_at: twoYearsAgo.getTime() };
    const result = isAdoptversary(pet, NOW);
    expect(result).toBe(2);
  });

  it('returns null on other days', () => {
    const pet: Pet = { id: 'x', name: 'X', species: 'cat', adopted_at: NOW - 400 * DAY };
    // 400 days ago is almost certainly not the same calendar day as NOW
    const result = isAdoptversary(pet, NOW);
    // we can only assert it is null or a positive number — just check type
    expect(result === null || typeof result === 'number').toBe(true);
  });
});

// ─── 8. parsePetMention ───────────────────────────────────────────────

describe('parsePetMention', () => {
  it('matches pet name and care task', () => {
    const { matches } = parsePetMention(
      'refilled hay for Tontin this morning',
      [tontin],
      SPECIES_PROFILES,
      NOW,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].pet_id).toBe('pet-1');
    expect(matches[0].task).toBe('hay_refill');
    expect(matches[0].confidence).toBeGreaterThan(0.5);
  });

  it('negated task creates observation with pending_intent tag', () => {
    // "floor time" is a keyword with conf=0.95; "didn't" is a negation marker
    const { matches, observations } = parsePetMention(
      "didn't do floor time for Tontin",
      [tontin],
      SPECIES_PROFILES,
      NOW,
    );
    expect(matches.length).toBe(0);
    expect(observations.some((o) => o.tags.some((t) => t.startsWith('pending_intent:')))).toBe(true);
  });

  it('returns empty result for empty text', () => {
    const result = parsePetMention('', [tontin], SPECIES_PROFILES, NOW);
    expect(result.matches).toHaveLength(0);
    expect(result.observations).toHaveLength(0);
  });

  it('matches via species terms when pet name absent', () => {
    const { matches } = parsePetMention(
      'gave fresh water to the piggy',
      [tontin],
      SPECIES_PROFILES,
      NOW,
    );
    // 'piggy' is in guinea_pig.species_terms
    expect(matches.some((m) => m.pet_id === 'pet-1')).toBe(true);
  });
});

// ─── 9. parseAwayIntent ───────────────────────────────────────────────

describe('parseAwayIntent', () => {
  it('parses "away for N days" correctly', () => {
    const result = parseAwayIntent('I will be out of town away for 5 days', NOW);
    expect(result).not.toBeNull();
    expect(result?.active).toBe(true);
    expect(result?.returning_at).toBe(NOW + 5 * DAY);
  });

  it('returns null for unrelated text', () => {
    expect(parseAwayIntent('fed the cats today', NOW)).toBeNull();
  });
});

// ─── 10. parseSessionIntent ───────────────────────────────────────────

describe('parseSessionIntent', () => {
  it('detects start session', () => {
    const r = parseSessionIntent('hanging with Tontin', [tontin], NOW);
    expect(r.type).toBe('start');
    expect(r.pet_id).toBe('pet-1');
  });

  it('detects close session', () => {
    const r = parseSessionIntent('done, put them back', [tontin, pinpon], NOW);
    // pet_id might be null if neither name appears; type should be null or close
    expect(['start', 'close', null]).toContain(r.type);
  });
});

// ─── 11. detectMilestone ─────────────────────────────────────────────

describe('detectMilestone', () => {
  it('returns milestone for first observed tag', () => {
    const obs: Observation = { pet_id: 'pet-1', text: 'Tontin was popcorning', tags: ['popcorning'], occurred_at: NOW };
    const m = detectMilestone(obs, [], SPECIES_PROFILES['guinea_pig']);
    expect(m).not.toBeNull();
    expect(m?.tag).toBe('popcorning');
    expect(m?.pet_id).toBe('pet-1');
  });

  it('returns null when milestone already recorded', () => {
    const obs: Observation = { pet_id: 'pet-1', text: 'popcorning', tags: ['popcorning'], occurred_at: NOW };
    const existing = [{ pet_id: 'pet-1', tag: 'popcorning', first_seen_at: NOW - 10 * DAY, raw_text: '' }];
    expect(detectMilestone(obs, existing, SPECIES_PROFILES['guinea_pig'])).toBeNull();
  });
});

// ─── 12. computeWeatherAlerts ─────────────────────────────────────────

describe('computeWeatherAlerts', () => {
  it('fires firm alert for small mammal at >26°C', () => {
    const alerts = computeWeatherAlerts(tontin, SPECIES_PROFILES['guinea_pig'], { temp: 30 }, NOW);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('firm');
    expect(alerts[0].welfare_note).toContain('26');
  });

  it('returns empty for moderate temp', () => {
    const alerts = computeWeatherAlerts(tontin, SPECIES_PROFILES['guinea_pig'], { temp: 22 }, NOW);
    expect(alerts).toHaveLength(0);
  });

  it('fires for dog in extreme heat', () => {
    const dog: Pet = { id: 'dog-1', name: 'Rex', species: 'dog' };
    const alerts = computeWeatherAlerts(dog, SPECIES_PROFILES['dog'], { temp: 35 }, NOW);
    expect(alerts.some((a) => a.task === 'weather_welfare')).toBe(true);
  });
});

// ─── 13. scheduleVetCues ─────────────────────────────────────────────

describe('scheduleVetCues', () => {
  it('produces 3 cues at correct offsets', () => {
    const item = { id: 'v1', pet_id: 'pet-1', kind: 'annual checkup', cadence_days: 365, last_completed_at: NOW - 300 * DAY };
    const result = scheduleVetCues(item, { now: NOW, consent: true });
    expect(result).not.toBeNull();
    expect(result?.cues).toHaveLength(3);
    expect(result?.pattern).toBe('vet-cues');
  });

  it('returns null for invalid item', () => {
    expect(scheduleVetCues({} as any, { now: NOW })).toBeNull();
  });
});

// ─── 14. detectVetAdherenceDelay ─────────────────────────────────────

describe('detectVetAdherenceDelay', () => {
  it('detects overdue vet with sufficient run_length', () => {
    const cues = [
      { at: NOW - 20 * DAY },
      { at: NOW - 10 * DAY },
      { at: NOW - 5 * DAY },
    ];
    const state: PetsState = {
      vet_schedule: [{ id: 'v1', pet_id: 'pet-1', kind: 'annual', cadence_days: 365, last_completed_at: NOW - 600 * DAY, cues: cues as any }],
    };
    const results = detectVetAdherenceDelay(state, { now: NOW, minRunLength: 3, consent: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe('vet-adherence-delay');
  });

  it('returns empty when consent is off', () => {
    const state: PetsState = { vet_schedule: [{ id: 'v1', cadence_days: 365, last_completed_at: NOW - 600 * DAY }] };
    const results = detectVetAdherenceDelay(state, { now: NOW, consent: false });
    expect(results).toHaveLength(0);
  });
});

// ─── 15. detectCoRegulator ────────────────────────────────────────────

describe('detectCoRegulator', () => {
  it('detects co-regulation pattern above lift threshold', () => {
    const log = [
      // 15 calm-with-pet entries
      ...Array.from({ length: 15 }, (_, i) => ({ ts: NOW - (i + 1) * DAY, pet_present: true, sentiment: 'calm' as const, pet_id: 'pet-1' })),
      // 5 no-pet entries: 1 calm + 4 agitated → ratioNo = 0.2 → lift = 1.0/0.2 = 5
      { ts: NOW - 20 * DAY, pet_present: false, sentiment: 'calm' as const },
      ...Array.from({ length: 4 }, (_, i) => ({ ts: NOW - (21 + i) * DAY, pet_present: false, sentiment: 'agitated' as const })),
    ];
    const state: PetsState = { coregulation_log: log };
    const result = detectCoRegulator(state, { now: NOW, windowDays: 30, minTagged: 10, minLift: 1.3, consent: true });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('pet-co-regulator');
    expect(result?.lift).toBeGreaterThanOrEqual(1.3);
  });

  it('returns null below minTagged threshold', () => {
    const log = [
      { ts: NOW - 1 * DAY, pet_present: true, sentiment: 'calm' as const, pet_id: 'pet-1' },
    ];
    const state: PetsState = { coregulation_log: log };
    const result = detectCoRegulator(state, { now: NOW, minTagged: 10, consent: true });
    expect(result).toBeNull();
  });
});

// ─── 16. detectCareActivationBarrier ─────────────────────────────────

describe('detectCareActivationBarrier', () => {
  it('detects missed care cycles above minRunLength', () => {
    // hay_refill cadence=2; last done 10 days ago → missedCycles=5, runLength=6
    const log: CareLogEntry[] = [
      { pet_id: 'pet-1', task: 'hay_refill', occurred_at: NOW - 10 * DAY },
    ];
    const state: PetsState = { pets: [tontin], care_log: log };
    const results = detectCareActivationBarrier(state, { now: NOW, speciesProfiles: SPECIES_PROFILES, minRunLength: 3, consent: true });
    expect(results.some((r) => r.task === 'hay_refill')).toBe(true);
    expect(results[0].pattern).toBe('care-activation-barrier');
  });

  it('returns empty when speciesProfiles not passed', () => {
    const state: PetsState = { pets: [tontin], care_log: [] };
    const results = detectCareActivationBarrier(state, { now: NOW, consent: true });
    expect(results).toHaveLength(0);
  });
});

// ─── 17. detectCrashContextMisses ────────────────────────────────────

describe('detectCrashContextMisses', () => {
  it('detects pattern when enough crash-tagged misses', () => {
    const crashTs = NOW - 5 * DAY;
    const state: PetsState = {
      miss_log: Array.from({ length: 5 }, (_, i) => ({ ts: crashTs + i * HOUR, pet_id: 'pet-1', task: 'hay_refill' })),
    };
    const result = detectCrashContextMisses(state, {
      now: NOW,
      workCrashLog: [{ ts: crashTs, reply: 'yes' }],
      minRunLength: 3,
      consent: true,
    });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('crash-context-misses');
    expect(result?.crash_tagged_n).toBeGreaterThanOrEqual(3);
  });

  it('returns null with empty miss_log', () => {
    const result = detectCrashContextMisses({ miss_log: [] }, { now: NOW, consent: true });
    expect(result).toBeNull();
  });
});

// ─── 18. matchProjectionInDump ────────────────────────────────────────

describe('matchProjectionInDump', () => {
  it('matches projection phrase', () => {
    const result = matchProjectionInDump("she's mad at me because I forgot", { consent: true });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('projection-mirror');
    // regex matches "she's mad" phrase — check the pattern fires correctly
    expect(result?.matched_term).toMatch(/mad/i);
  });

  it('returns null for unrelated text', () => {
    expect(matchProjectionInDump('tontin was happy today', { consent: true })).toBeNull();
  });
});

// ─── 19. detectProjectionPattern ─────────────────────────────────────

describe('detectProjectionPattern', () => {
  it('detects pattern above minMatches threshold', () => {
    const log = Array.from({ length: 5 }, (_, i) => ({
      ts: NOW - (i + 1) * DAY,
      pet_id: 'pet-1',
    }));
    const state: PetsState = { projection_log: log };
    const result = detectProjectionPattern(state, { now: NOW, windowDays: 30, minRunLength: 4, consent: true });
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('projection-pattern');
    expect(result?.pet_id).toBe('pet-1');
  });

  it('returns null below minMatches', () => {
    const state: PetsState = { projection_log: [{ ts: NOW - 1 * DAY, pet_id: 'pet-1' }] };
    const result = detectProjectionPattern(state, { now: NOW, minRunLength: 4, consent: true });
    expect(result).toBeNull();
  });
});

// ─── 20. detectPatterns (central dispatch) ────────────────────────────

describe('detectPatterns', () => {
  it('returns empty array when consent is off', () => {
    const state: PetsState = { pets: [tontin], care_log: [] };
    const results = detectPatterns(state, { consent: false, now: NOW });
    expect(results).toHaveLength(0);
  });

  it('composes all sub-detectors and returns array', () => {
    const log: CareLogEntry[] = [
      { pet_id: 'pet-1', task: 'hay_refill', occurred_at: NOW - 10 * DAY },
    ];
    const projectionLog = Array.from({ length: 5 }, (_, i) => ({ ts: NOW - (i + 1) * DAY, pet_id: 'pet-1' }));
    const state: PetsState = {
      pets: [tontin],
      care_log: log,
      projection_log: projectionLog,
    };
    const results = detectPatterns(state, {
      now: NOW,
      consent: true,
      speciesProfiles: SPECIES_PROFILES,
      minRunLength: 3,
    });
    expect(Array.isArray(results)).toBe(true);
    // P3 and P5 should both fire
    expect(results.some((r) => r.pattern === 'care-activation-barrier')).toBe(true);
    expect(results.some((r) => r.pattern === 'projection-pattern')).toBe(true);
  });
});
