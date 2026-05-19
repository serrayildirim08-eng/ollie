/**
 * body-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `body.*` / `shared.*` slices into the v2 view-models. These tests verify
 * the bridge, including the two face foci (water vs an open episode) the v2
 * body face depends on. Mirrors sleep-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import { openEpisode, logSeverity, logMed, closeEpisode, newTreatmentPlan } from '@ollie/logic/body';
import {
  isoDay,
  weekdayShort,
  clockOf,
  waterCountToday,
  resolveWaterTarget,
  suppTakenToday,
  fmtReminder,
  faceVM,
  intakeVM,
  symptomsVM,
  episodeVM,
  conditionsVM,
  treatmentVM,
  doctorSummaryVM,
  patternsVM,
  patternSummary,
  patternGroupLabel,
  elapsedDaysLabel,
  type BodySlices,
} from './selectors';

const NOW = new Date('2026-05-18T12:00:00Z').getTime();
const DAY = 86_400_000;

function emptySlices(): BodySlices {
  return {
    waterLog: [],
    waterTarget: 8,
    supplements: [],
    suppChecks: {},
    episodes: [],
    treatmentPlans: [],
    patterns: [],
    protectiveCards: [],
    conditions: [],
    userName: null,
  };
}

describe('formatters', () => {
  it('isoDay returns a local YYYY-MM-DD', () => {
    expect(isoDay(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('weekdayShort returns a 3-letter day', () => {
    expect(weekdayShort(NOW)).toHaveLength(3);
  });

  it('clockOf formats a 12h clock', () => {
    expect(clockOf(new Date('2026-05-18T14:10:00').getTime())).toBe('2:10pm');
    expect(clockOf(new Date('2026-05-18T00:30:00').getTime())).toBe('12:30am');
  });

  it('fmtReminder parses HH:MM to a 12h string, null on garbage', () => {
    expect(fmtReminder('09:00')).toBe('9:00am');
    expect(fmtReminder('20:30')).toBe('8:30pm');
    expect(fmtReminder('nope')).toBeNull();
    expect(fmtReminder(undefined)).toBeNull();
  });

  it('resolveWaterTarget clamps to 1..16', () => {
    expect(resolveWaterTarget(0)).toBe(8);
    expect(resolveWaterTarget(99)).toBe(16);
    expect(resolveWaterTarget(6)).toBe(6);
  });
});

describe('waterCountToday', () => {
  it('counts only today’s glasses', () => {
    const log = [NOW, NOW - 100, NOW - 2 * DAY];
    expect(waterCountToday(log, NOW)).toBe(2);
  });

  it('is defensive against non-arrays', () => {
    expect(waterCountToday(null as unknown as number[], NOW)).toBe(0);
  });
});

describe('suppTakenToday', () => {
  it('counts supplements checked off today', () => {
    const today = isoDay(NOW);
    const supps = [
      { id: 'a', name: 'd', dose: null, added_at: NOW },
      { id: 'b', name: 'mag', dose: null, added_at: NOW },
    ];
    const checks = { [today]: { a: true, b: false } };
    expect(suppTakenToday(supps, checks, NOW)).toBe(1);
  });
});

describe('faceVM', () => {
  it('cold first run focuses water with the cold invitation', () => {
    const vm = faceVM(emptySlices(), NOW);
    expect(vm.focus).toBe('water');
    expect(vm.hasAnyData).toBe(false);
    expect(vm.waterCount).toBe(0);
    expect(vm.patternLine).toBeNull();
    expect(vm.symptomsCold).toBe(true);
    expect(vm.doctorCold).toBe(true);
  });

  it('with water logged, the water hero is warm', () => {
    const s = emptySlices();
    s.waterLog = [NOW, NOW - 100];
    const vm = faceVM(s, NOW);
    expect(vm.focus).toBe('water');
    expect(vm.waterCount).toBe(2);
    expect(vm.hasAnyData).toBe(true);
  });

  it('an open episode switches the face focus to the episode', () => {
    const s = emptySlices();
    let ep = openEpisode('headache', 'acute', { now: NOW - DAY });
    ep = logSeverity(ep, 3, { now: NOW - DAY });
    ep = logSeverity(ep, 4, { now: NOW });
    s.episodes = [ep];
    const vm = faceVM(s, NOW);
    expect(vm.focus).toBe('episode');
    expect(vm.episode?.label).toBe('headache');
    expect(vm.episodeDay).toBe('day 2');
    expect(vm.lastSeverity).toBe(4);
    expect(vm.severityArc).toEqual([3, 4]);
  });

  it('surfaces the pattern line when a body pattern is observed', () => {
    const s = emptySlices();
    s.patterns = [
      {
        pattern: 'headache-hydration',
        confidence: 'medium',
        sample_n: 9,
        date_range: { start: '2026-05-01', end: '2026-05-18' },
        r: 0.6,
        cooccurrences: 6,
        copy: 'on low-water mornings a headache shows up 6 of 9 times',
      },
    ];
    const vm = faceVM(s, NOW);
    expect(vm.patternLine).not.toBeNull();
  });
});

describe('intakeVM', () => {
  it('maps supplements + their checked state for today', () => {
    const s = emptySlices();
    const today = isoDay(NOW);
    s.supplements = [
      { id: 'd', name: 'vitamin d', dose: null, added_at: NOW, reminder_hhmm: '09:00' },
      { id: 'm', name: 'magnesium', dose: null, added_at: NOW },
    ];
    s.suppChecks = { [today]: { d: true } };
    s.waterLog = [NOW, NOW, NOW, NOW];
    const vm = intakeVM(s, NOW);
    expect(vm.waterCount).toBe(4);
    expect(vm.waterFill).toBe(0.5);
    expect(vm.supplements).toHaveLength(2);
    expect(vm.supplements[0]).toMatchObject({ name: 'vitamin d', when: '9:00am', taken: true });
    expect(vm.supplements[1]).toMatchObject({ name: 'magnesium', when: null, taken: false });
  });
});

describe('symptomsVM', () => {
  it('separates the open episode from closed ones, newest closed first', () => {
    const s = emptySlices();
    const open = openEpisode('migraine', 'chronic', { now: NOW });
    const closedA = closeEpisode(
      openEpisode('flu', 'acute', { now: NOW - 10 * DAY }),
      { now: NOW - 8 * DAY },
    );
    const closedB = closeEpisode(
      openEpisode('cold', 'acute', { now: NOW - 5 * DAY }),
      { now: NOW - 3 * DAY },
    );
    s.episodes = [closedA, open, closedB];
    const vm = symptomsVM(s);
    expect(vm.open?.label).toBe('migraine');
    expect(vm.closed.map((e) => e.label)).toEqual(['cold', 'flu']);
  });
});

describe('episodeVM', () => {
  it('builds the day line, the check-ins and the recap from a real episode', () => {
    let ep = openEpisode('headache', 'acute', { now: NOW - DAY });
    ep = logSeverity(ep, 3, { now: NOW - DAY });
    ep = logSeverity(ep, 4, { now: NOW });
    ep = logMed(ep, 'ibuprofen', { now: NOW, dose: '400mg' });
    const vm = episodeVM(ep, NOW);
    expect(vm.exists).toBe(true);
    expect(vm.name).toBe('headache');
    expect(vm.dayLine).toContain('day 2');
    expect(vm.checkIns.map((c) => c.severity)).toEqual([3, 4]);
    expect(vm.meds[0]).toMatchObject({ name: 'ibuprofen', dose: '400mg' });
    expect(vm.recap.checkIns).toBe(2);
    expect(vm.recap.peak).toBe(4);
    expect(vm.recap.meds).toBe(1);
  });

  it('returns a non-existent vm for a null episode', () => {
    expect(episodeVM(null, NOW).exists).toBe(false);
  });
});

describe('treatmentVM + conditionsVM', () => {
  it('positions a multi-cycle plan', () => {
    const plan = newTreatmentPlan('chemotherapy', {
      now: NOW - 50 * DAY,
      cycle_length_days: 21,
      total_cycles: 6,
      cycle_starts: [NOW - 50 * DAY, NOW - 25 * DAY, NOW - 4 * DAY],
    });
    const vm = treatmentVM(plan, NOW);
    expect(vm.currentCycle).toBe(3);
    expect(vm.totalCycles).toBe(6);
    expect(vm.track).toHaveLength(6);
    expect(vm.track[0].state).toBe('done');
    expect(vm.track[2].state).toBe('now');
    expect(vm.track[3].state).toBe('ahead');
    expect(vm.positionLine).toContain('cycle 3 of 6');
  });

  it('conditionsVM passes through tracked conditions + plans', () => {
    const s = emptySlices();
    s.conditions = ['migraine', 'ibs'];
    s.treatmentPlans = [newTreatmentPlan('allergy shots', { now: NOW })];
    const vm = conditionsVM(s, NOW);
    expect(vm.conditions).toEqual(['migraine', 'ibs']);
    expect(vm.plans).toHaveLength(1);
  });
});

describe('doctorSummaryVM', () => {
  it('does not exist with no episodes', () => {
    expect(doctorSummaryVM(emptySlices(), NOW).exists).toBe(false);
  });

  it('builds a real brief from the open episode', () => {
    const s = emptySlices();
    let ep = openEpisode('headache', 'acute', { now: NOW - DAY });
    ep = logSeverity(ep, 3, { now: NOW - DAY });
    ep = logSeverity(ep, 4, { now: NOW });
    s.episodes = [ep];
    const vm = doctorSummaryVM(s, NOW);
    expect(vm.exists).toBe(true);
    expect(vm.episodeLabel).toBe('headache');
    expect(vm.markdown).toContain('headache');
    expect(vm.tldr).toContain('headache');
    expect(vm.severityArc).toEqual([3, 4]);
  });
});

describe('patternsVM', () => {
  it('groups orchestrator patterns and pairs a reframe', () => {
    const s = emptySlices();
    s.patterns = [
      {
        pattern: 'headache-hydration',
        confidence: 'medium',
        sample_n: 9,
        date_range: { start: '2026-05-01', end: '2026-05-18' },
        r: 0.6,
        cooccurrences: 6,
        copy: 'water → headache copy',
      },
      {
        pattern: 'symptom_phase_coupling',
        luteal_symptom_rate: 0.7,
        other_symptom_rate: 0.3,
        lift: 2.3,
        luteal_days: 8,
        other_days: 20,
        sample_n: 28,
        confidence: 'medium',
        copy: 'luteal symptom copy',
      },
    ];
    const vm = patternsVM(s);
    expect(vm.patterns).toHaveLength(2);
    expect(vm.patterns[0].group).toBe('intake');
    expect(vm.patterns[1].group).toBe('cross');
    expect(vm.patterns[0].frame.length).toBeGreaterThan(0);
  });

  it('patternSummary is null when nothing is observed', () => {
    expect(patternSummary(emptySlices())).toBeNull();
  });

  it('patternGroupLabel maps every group', () => {
    expect(patternGroupLabel('intake')).toBeTruthy();
    expect(patternGroupLabel('cross')).toBeTruthy();
  });
});

describe('elapsedDaysLabel', () => {
  it('labels an open episode by day', () => {
    const ep = openEpisode('x', 'acute', { now: NOW - DAY });
    expect(elapsedDaysLabel(ep, NOW)).toBe('day 2');
  });

  it('labels a closed episode by its run length', () => {
    const ep = closeEpisode(
      openEpisode('x', 'acute', { now: NOW - 3 * DAY }),
      { now: NOW },
    );
    expect(elapsedDaysLabel(ep, NOW, true)).toBe('ran 3 days');
  });
});
