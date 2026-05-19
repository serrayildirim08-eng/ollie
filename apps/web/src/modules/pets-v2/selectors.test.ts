/**
 * pets-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live `pets.*`
 * slices into the v2 view-models, deriving the care hero, the roster + the
 * 30-day care strip, the pet profile, the species-adaptive add / log /
 * observe options, the health panel and the notification reel through
 * `@ollie/logic/pets`. These tests verify the bridge. Mirrors
 * admin-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtShortDate,
  fmtRelative,
  petInitial,
  taskLabel,
  speciesLabel,
  activePets,
  resolveCareGaps,
  careStrip,
  stripOnCount,
  petsFaceVM,
  petProfileVM,
  speciesOptions,
  speciesCadencePreview,
  careTaskOptions,
  observationTags,
  lastWeight,
  petsHealthVM,
  petsPatternsVM,
  notificationsReelVM,
  weeklyPreface,
} from './selectors';
import type { PetsSlices } from './selectors';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

/** an empty slice set — the cold-start store */
function emptySlices(): PetsSlices {
  return {
    pets: [],
    careLog: [],
    observations: [],
    careGaps: [],
    healthFlags: [],
    milestones: [],
    settings: { guilt_voice: 'on', weekly_letter: 'off', multi_caregiver: false },
    away: { active: false, returning_at: null },
  };
}

/** a populated slice set — Mango (guinea pig, hay overdue) + Tonti (rabbit) */
function populatedSlices(): PetsSlices {
  return {
    pets: [
      {
        id: 'p-mango',
        name: 'Mango',
        species: 'guinea_pig',
        created_at: NOW - 400 * DAY,
        adopted_at: NOW - 400 * DAY,
        archived: false,
      },
      {
        id: 'p-tonti',
        name: 'Tonti',
        species: 'rabbit',
        created_at: NOW - 200 * DAY,
        archived: false,
      },
      {
        id: 'p-old',
        name: 'Pepper',
        species: 'cat',
        created_at: NOW - 100 * DAY,
        archived: true,
      },
    ],
    careLog: [
      // Mango: hay logged 3 days ago — past the 2-day cadence → a gap
      { id: 'c1', pet_id: 'p-mango', task: 'hay_refill', occurred_at: NOW - 3 * DAY },
      // Tonti: fresh hay logged today — current
      { id: 'c2', pet_id: 'p-tonti', task: 'fresh_hay', occurred_at: NOW - 2 * 3600_000 },
    ],
    observations: [
      {
        id: 'o1',
        pet_id: 'p-mango',
        text: 'eating well, very chatty',
        tags: ['vocal'],
        kind: 'note',
        occurred_at: NOW - 2 * DAY,
        created_at: NOW - 2 * DAY,
      },
      {
        id: 'o2',
        pet_id: 'p-mango',
        text: 'weight check',
        tags: [],
        kind: 'weight',
        value_grams: 1040,
        occurred_at: NOW - 5 * DAY,
        created_at: NOW - 5 * DAY,
      },
    ],
    careGaps: [],
    healthFlags: [
      {
        id: 'h1',
        pet_id: 'p-mango',
        flag: 'not_eating',
        run_length: 3,
        last_signal_at: NOW - DAY,
        source_url: 'https://www.rspca.org.uk/x',
        status: 'pending',
        detected_at: NOW - 2 * DAY,
      },
      {
        id: 'h2',
        pet_id: 'p-tonti',
        flag: 'drooling',
        run_length: 2,
        last_signal_at: NOW - 10 * DAY,
        source_url: 'https://rabbit.org/x',
        status: 'pending',
        detected_at: NOW - 12 * DAY,
      },
    ],
    milestones: [
      {
        pet_id: 'p-mango',
        tag: 'popcorn',
        first_seen_at: NOW - 11 * DAY,
        raw_text: 'first popcorn recorded',
      },
    ],
    settings: { guilt_voice: 'on', weekly_letter: 'off', multi_caregiver: false },
    away: { active: false, returning_at: null },
  };
}

describe('pets-v2 selectors · formatters', () => {
  it('fmtShortDate gives a calm short date', () => {
    expect(fmtShortDate(NOW)).toBe('may 18');
  });

  it('fmtRelative gives human day phrases', () => {
    expect(fmtRelative(NOW, NOW)).toBe('today');
    expect(fmtRelative(NOW - DAY, NOW)).toBe('yesterday');
    expect(fmtRelative(NOW - 4 * DAY, NOW)).toBe('4 days ago');
    expect(fmtRelative(NOW - 21 * DAY, NOW)).toBe('3 weeks ago');
  });

  it('petInitial / taskLabel / speciesLabel', () => {
    expect(petInitial({ name: 'Mango' })).toBe('M');
    expect(petInitial(null)).toBe('?');
    expect(taskLabel('hay_refill')).toBe('hay refill');
    expect(speciesLabel('guinea_pig')).toBe('guinea pig');
  });
});

describe('pets-v2 selectors · roster + care gaps', () => {
  it('activePets drops archived pets', () => {
    const active = activePets(populatedSlices());
    expect(active.map((p) => p.id)).toEqual(['p-mango', 'p-tonti']);
  });

  it('resolveCareGaps computes gaps from the live care log', () => {
    const gaps = resolveCareGaps(populatedSlices(), NOW);
    // Mango's hay (cadence 2d, logged 3d ago) is past cadence → not 'ok'
    const hay = gaps.find(
      (g) => g.pet_id === 'p-mango' && g.task === 'hay_refill',
    );
    expect(hay).toBeDefined();
    expect(hay!.severity).not.toBe('ok');
  });

  it('resolveCareGaps prefers the orchestrator-written care_gaps slice', () => {
    const slices = populatedSlices();
    slices.careGaps = [
      {
        pet_id: 'p-mango',
        task: 'vitamin_c',
        last_occurred_at: null,
        days_since: null,
        severity: 'concerned',
        critical: true,
      },
    ];
    const gaps = resolveCareGaps(slices, NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].task).toBe('vitamin_c');
  });
});

describe('pets-v2 selectors · care strip', () => {
  it('careStrip is 30 cells, today rightmost', () => {
    const strip = careStrip('p-mango', NOW - 400 * DAY, [], NOW);
    expect(strip).toHaveLength(30);
  });

  it('a logged day shows "on"; the join cuts off into "gap"', () => {
    const joined = NOW - 5 * DAY;
    const log = [
      { id: 'x', pet_id: 'p-mango', task: 'hay_refill', occurred_at: NOW - DAY },
    ];
    const strip = careStrip('p-mango', joined, log, NOW);
    // the rightmost cell is today (no care) → 'off'
    expect(strip[29]).toBe('off');
    // yesterday had care → 'on'
    expect(strip[28]).toBe('on');
    // the oldest cells are before the join → 'gap'
    expect(strip[0]).toBe('gap');
  });

  it('stripOnCount counts logged days', () => {
    expect(stripOnCount(['on', 'off', 'on', 'gap'])).toBe(2);
  });
});

describe('pets-v2 selectors · petsFaceVM', () => {
  it('cold start — no pets, no hero, hasPets false', () => {
    const vm = petsFaceVM(emptySlices(), NOW);
    expect(vm.hasPets).toBe(false);
    expect(vm.hero).toBeNull();
    expect(vm.roster).toHaveLength(0);
  });

  it('populated — the hero is the most-pressing care gap', () => {
    const vm = petsFaceVM(populatedSlices(), NOW);
    expect(vm.hasPets).toBe(true);
    expect(vm.hero).not.toBeNull();
    // Mango's hay is the overdue task → the hero is Mango
    expect(vm.hero!.petName).toBe('Mango');
    expect(vm.hero!.petInitial).toBe('M');
    expect(vm.hero!.reframe.length).toBeGreaterThan(0);
    // never shaming — the reframe carries no "you forgot" / "you missed"
    expect(vm.hero!.reframe.toLowerCase()).not.toContain('you forgot');
    expect(vm.hero!.reframe.toLowerCase()).not.toContain('you missed');
  });

  it('the roster carries one entry per active pet with a 30-day strip', () => {
    const vm = petsFaceVM(populatedSlices(), NOW);
    expect(vm.roster).toHaveLength(2);
    expect(vm.roster[0].strip).toHaveLength(30);
  });

  it('the health line reflects pending health flags', () => {
    const vm = petsFaceVM(populatedSlices(), NOW);
    expect(vm.healthPendingCount).toBe(2);
    expect(vm.healthLine).toContain('2 things noted');
  });

  it('away mode surfaces the away banner fields', () => {
    const slices = populatedSlices();
    slices.away = { active: true, returning_at: NOW + 3 * DAY };
    const vm = petsFaceVM(slices, NOW);
    expect(vm.away).toBe(true);
    expect(vm.awayUntil).toBe('may 21');
  });
});

describe('pets-v2 selectors · petProfileVM', () => {
  it('returns null for an unknown / archived pet', () => {
    expect(petProfileVM(populatedSlices(), null, NOW)).toBeNull();
    expect(petProfileVM(populatedSlices(), 'p-old', NOW)).toBeNull();
    expect(petProfileVM(populatedSlices(), 'nope', NOW)).toBeNull();
  });

  it('builds the profile from the live slices', () => {
    const vm = petProfileVM(populatedSlices(), 'p-mango', NOW);
    expect(vm).not.toBeNull();
    expect(vm!.petName).toBe('Mango');
    expect(vm!.speciesDisplay).toBe('guinea pig');
    expect(vm!.strip).toHaveLength(30);
    // the two Mango observations come back, newest first
    expect(vm!.observations).toHaveLength(2);
    expect(vm!.observations[0].text).toContain('chatty');
    // the milestone is surfaced
    expect(vm!.milestones).toHaveLength(1);
    expect(vm!.milestones[0].line).toBe('first popcorn recorded');
  });
});

describe('pets-v2 selectors · species-adaptive options', () => {
  it('speciesOptions lists all 10 species', () => {
    const opts = speciesOptions();
    expect(opts).toHaveLength(10);
    expect(opts.some((o) => o.key === 'guinea_pig')).toBe(true);
  });

  it('speciesCadencePreview names the headline cadences', () => {
    const preview = speciesCadencePreview('guinea_pig');
    expect(preview).toContain('daily');
    expect(preview).toContain('vet check yearly');
  });

  it('careTaskOptions adapts to the species', () => {
    const gp = careTaskOptions('guinea_pig').map((t) => t.key);
    const fish = careTaskOptions('betta_fish').map((t) => t.key);
    expect(gp).toContain('hay_refill');
    expect(gp).not.toContain('tank_water_change');
    expect(fish).toContain('tank_water_change');
  });

  it('observationTags adapts to the species', () => {
    expect(observationTags('guinea_pig')).toContain('popcorning');
    expect(observationTags('rabbit')).toContain('binky');
  });

  it('lastWeight reads the latest weight observation in grams', () => {
    expect(lastWeight(populatedSlices(), 'p-mango')).toBe(1040);
    expect(lastWeight(populatedSlices(), 'p-tonti')).toBeNull();
  });
});

describe('pets-v2 selectors · health panel', () => {
  it('petsHealthVM surfaces recent pending flags, drawers old ones', () => {
    const vm = petsHealthVM(populatedSlices(), NOW);
    // h1 (2 days old) is recent; h2 (12 days old) is behind the drawer
    expect(vm.flags).toHaveLength(1);
    expect(vm.flags[0].petName).toBe('Mango');
    expect(vm.olderCount).toBe(1);
  });

  it('a health-flag VM never carries an alarm / verdict tone', () => {
    const vm = petsHealthVM(populatedSlices(), NOW);
    const f = vm.flags[0];
    expect(f.daysLine).toContain('observed across');
    expect(f.vetLine.toLowerCase()).toContain('not because something is wrong');
    expect(f.cite.length).toBeGreaterThan(0);
  });

  it('empty store → no flags, no drawer', () => {
    const vm = petsHealthVM(emptySlices(), NOW);
    expect(vm.flags).toHaveLength(0);
    expect(vm.olderCount).toBe(0);
  });
});

describe('pets-v2 selectors · patterns + notifications + preface', () => {
  it('petsPatternsVM falls back to honestly-labelled examples', () => {
    const vm = petsPatternsVM(populatedSlices(), NOW);
    expect(vm.showingExamples).toBe(true);
    expect(vm.live).toHaveLength(0);
    expect(vm.examples.length).toBeGreaterThan(0);
    // every example carries a research citation
    for (const p of vm.examples) {
      expect(p.cite.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });

  it('notificationsReelVM builds the lead care frame from real data', () => {
    const frames = notificationsReelVM(populatedSlices(), NOW);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames[0].kind).toBe('care');
    // the lead frame names the real hero pet
    expect(frames[0].title).toContain('Mango');
    // a closing-style cold reel still produces frames
    expect(notificationsReelVM(emptySlices(), NOW)[0].kind).toBe('care');
  });

  it('weeklyPreface returns one of the editorial prefaces', () => {
    expect(typeof weeklyPreface(NOW)).toBe('string');
    expect(weeklyPreface(NOW).length).toBeGreaterThan(0);
  });
});
