/**
 * habits-v2 · selectors — unit tests
 *
 * The selectors are the real-data bridge: pure fns turning the live
 * `shared.habits_v2` + `habits.patterns` slices into the v2 view-models.
 * These tests verify the bridge — the cold-vs-warm face, the single
 * next-check-in pick, the day-order waiting dots, the soft recent-day
 * record and the patterns example-vs-real fallback. Mirrors
 * medication-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import {
  cueTimeOf,
  habitName,
  checkedToday,
  lastLabel,
  cueBadge,
  orderedHabits,
  habitsFaceVM,
  allHabitsVM,
  patternsVM,
  DEFAULT_HABITS,
  type HabitsSlices,
  type StoredHabit,
} from './selectors';

const NOW = new Date('2026-05-18T09:00:00').getTime();
const DAY = 86_400_000;

/** a habit with sane defaults */
function habit(over: Partial<StoredHabit>): StoredHabit {
  return {
    id: 'h1',
    name: 'drink water',
    cue: 'after coffee',
    cueTime: 'morning',
    completions: [],
    ...over,
  };
}

/** the seeded-defaults slices (what the empty store resolves to) */
function seedSlices(): HabitsSlices {
  return { habits: DEFAULT_HABITS.map((h) => ({ ...h })), patterns: [] };
}

/** an epoch-ms ts for `daysAgo` from NOW, at noon */
function tsDaysAgo(daysAgo: number): number {
  const d = new Date(NOW - daysAgo * DAY);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

describe('small helpers', () => {
  it('cueTimeOf defaults a missing/odd cueTime to anytime', () => {
    expect(cueTimeOf(habit({ cueTime: 'evening' }))).toBe('evening');
    expect(cueTimeOf(habit({ cueTime: undefined }))).toBe('anytime');
  });

  it('habitName falls back through name → label → a quiet default', () => {
    expect(habitName(habit({ name: 'move' }))).toBe('move');
    expect(habitName(habit({ name: undefined, label: 'read' }))).toBe('read');
    expect(habitName(habit({ name: undefined, label: undefined }))).toBe('a habit');
  });

  it('cueBadge maps a cue-time to its short tag', () => {
    expect(cueBadge('morning')).toBe('MOR');
    expect(cueBadge('anytime')).toBe('ANY');
    expect(cueBadge('evening')).toBe('EVE');
  });

  it('checkedToday is true only for a completion on today', () => {
    expect(
      checkedToday(habit({ completions: [{ ts: NOW }] }), NOW),
    ).toBe(true);
    expect(
      checkedToday(habit({ completions: [{ ts: tsDaysAgo(1) }] }), NOW),
    ).toBe(false);
    expect(checkedToday(habit({ completions: [] }), NOW)).toBe(false);
  });

  it('lastLabel is a calm factual recency note, never a streak', () => {
    expect(lastLabel(habit({ completions: [] }), NOW)).toBe('never');
    expect(lastLabel(habit({ completions: [{ ts: NOW }] }), NOW)).toBe('today');
    expect(
      lastLabel(habit({ completions: [{ ts: tsDaysAgo(1) }] }), NOW),
    ).toBe('yesterday');
    expect(
      lastLabel(habit({ completions: [{ ts: tsDaysAgo(3) }] }), NOW),
    ).toBe('3 days ago');
    expect(
      lastLabel(habit({ completions: [{ ts: tsDaysAgo(14) }] }), NOW),
    ).toBe('2 weeks ago');
  });
});

describe('orderedHabits', () => {
  it('orders morning → anytime → evening', () => {
    const slices: HabitsSlices = {
      habits: [
        habit({ id: 'e', cueTime: 'evening' }),
        habit({ id: 'm', cueTime: 'morning' }),
        habit({ id: 'a', cueTime: 'anytime' }),
      ],
      patterns: [],
    };
    expect(orderedHabits(slices).map((h) => h.id)).toEqual(['m', 'a', 'e']);
  });

  it('is defensive against non-arrays', () => {
    expect(
      orderedHabits({ habits: null as unknown as StoredHabit[], patterns: [] }),
    ).toEqual([]);
  });
});

describe('habitsFaceVM — cold (the seeded defaults)', () => {
  it('first run: 6 seeded habits, none done, the first is the hero', () => {
    const vm = habitsFaceVM(seedSlices(), NOW);
    expect(vm.hasHistory).toBe(false);
    expect(vm.hasNext).toBe(true);
    expect(vm.lead).toBe('first up, when you can');
    expect(vm.nextName).toBe('brush teeth');
    expect(vm.nextCue).toBe('after waking');
    expect(vm.doneCount).toBe(0);
    expect(vm.totalCount).toBe(6);
    expect(vm.centreLabel).toBe("the day's ahead");
    // the first dot is the now-marker, the rest waiting — never a missed mark
    expect(vm.waitDots[0]).toBe('now');
    expect(vm.waitDots.filter((d) => d === 'waiting')).toHaveLength(5);
    expect(vm.waitLine).toContain('no rush');
  });

  it('the patterns row is cold until the orchestrator writes one', () => {
    const vm = habitsFaceVM(seedSlices(), NOW);
    expect(vm.hasPattern).toBe(false);
    expect(vm.patternLine).toContain('warm up');
  });
});

describe('habitsFaceVM — warm', () => {
  it('picks the first un-checked habit, in day order, as the hero', () => {
    // brush teeth (morning) is done → next is drink water (morning)
    const slices = seedSlices();
    slices.habits[0].completions = [{ ts: NOW }];
    const vm = habitsFaceVM(slices, NOW);
    expect(vm.hasHistory).toBe(true);
    expect(vm.lead).toBe('next, when you can');
    expect(vm.nextName).toBe('drink water');
    expect(vm.doneCount).toBe(1);
    expect(vm.waitDots[0]).toBe('done');
    expect(vm.waitDots[1]).toBe('now');
  });

  it('falls back to a calm all-done state when every habit is checked in', () => {
    const slices = seedSlices();
    for (const h of slices.habits) h.completions = [{ ts: NOW }];
    const vm = habitsFaceVM(slices, NOW);
    expect(vm.allDone).toBe(true);
    expect(vm.hasNext).toBe(false);
    expect(vm.nextName).toBe("that's everything for today");
    expect(vm.centreLabel).toBe('done today');
    expect(vm.waitDots.every((d) => d === 'done')).toBe(true);
  });

  it('a live orchestrator pattern lights the see-the-rest row', () => {
    const slices = seedSlices();
    slices.patterns = [
      { pattern: 'keystone', confidence: 'high', sample_n: 12, copy: 'water anchors your day' },
    ];
    const vm = habitsFaceVM(slices, NOW);
    expect(vm.hasPattern).toBe(true);
    expect(vm.patternLine).toContain('noticed');
  });
});

describe('allHabitsVM', () => {
  it('groups habits by cue-time and carries a 7-day soft record', () => {
    const slices = seedSlices();
    // brush teeth checked yesterday + 3 days ago
    slices.habits[0].completions = [
      { ts: tsDaysAgo(1) },
      { ts: tsDaysAgo(3) },
    ];
    const vm = allHabitsVM(slices, NOW);
    expect(vm.hasHabits).toBe(true);
    // morning / anytime / evening sections all present (the 6 seeds span them)
    expect(vm.sections.map((s) => s.cueTime)).toEqual([
      'morning',
      'anytime',
      'evening',
    ]);
    const teeth = vm.sections[0].rows[0];
    expect(teeth.name).toBe('brush teeth');
    expect(teeth.recent).toHaveLength(7);
    // the last slot is always today (an open ring), never a filled mark
    expect(teeth.recent[6]).toBe('today');
    // yesterday + 3-days-ago are filled sage dots
    expect(teeth.recent[5]).toBe('on');
    expect(teeth.recent[3]).toBe('on');
    expect(teeth.last).toBe('yesterday');
  });

  it('is empty + honest with no habits', () => {
    const vm = allHabitsVM({ habits: [], patterns: [] }, NOW);
    expect(vm.hasHabits).toBe(false);
    expect(vm.sections).toEqual([]);
  });
});

describe('patternsVM', () => {
  it('falls back to the canonical example set, flagged as examples', () => {
    const vm = patternsVM({ habits: [], patterns: [] });
    expect(vm.isExample).toBe(true);
    expect(vm.groups.length).toBeGreaterThan(0);
    // every group carries one-line observations + a reframe
    for (const g of vm.groups) {
      expect(g.lines.length).toBeGreaterThan(0);
      for (const l of g.lines) {
        expect(l.line.length).toBeGreaterThan(0);
        expect(l.frame.length).toBeGreaterThan(0);
      }
    }
  });

  it('surfaces real orchestrator patterns as one quiet group', () => {
    const vm = patternsVM({
      habits: [],
      patterns: [
        {
          pattern: 'keystone',
          confidence: 'high',
          sample_n: 12,
          copy: 'on days you drink water, more habits land',
        },
      ],
    });
    expect(vm.isExample).toBe(false);
    expect(vm.groups).toHaveLength(1);
    expect(vm.groups[0].label).toBe('what ollie noticed');
    expect(vm.groups[0].lines[0].line).toBe(
      'on days you drink water, more habits land',
    );
  });

  it('drops patterns with no copy', () => {
    const vm = patternsVM({
      habits: [],
      patterns: [{ pattern: 'x', copy: '' }],
    });
    // no usable real patterns → falls back to examples
    expect(vm.isExample).toBe(true);
  });
});
