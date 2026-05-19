/**
 * goals-v2 · selectors — unit tests
 *
 * Pure view-model tests over hand-built `GoalsSlices`. No DOM, no store —
 * just `slices` in, view-models out. Mirrors admin-v2/selectors.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  faceVM,
  goalDetailVM,
  reviewVM,
  patternsVM,
  patternSummary,
  notificationsVM,
  progressPct,
  progressCaption,
  nextMilestone,
  goalName,
  isActive,
  isRested,
  focusGoalVM,
  CATEGORY_OPTIONS,
  REVIEW_TAGS,
  type GoalsSlices,
  type GoalItem,
} from './selectors';

const NOW = new Date('2026-05-19T12:00:00Z').getTime();

function slices(partial: Partial<GoalsSlices>): GoalsSlices {
  return {
    goals: [],
    sessions: [],
    reviews: [],
    dumps: [],
    ...partial,
  };
}

const SPANISH: GoalItem = {
  id: 'g1',
  title: 'learn spanish',
  label: 'learn spanish',
  category: 'learning',
  status: 'active',
  created_at: NOW - 60 * 86_400_000,
  pacing: 'marathon',
  obstacle: 'the speaking part scares me',
  ulysses_contract: 'give it one more honest week before deciding',
  milestones: [
    { id: 'm1', title: 'finish the first 10 lessons', completed_at: NOW - 20 * 86_400_000 },
    { id: 'm2', title: 'learn 200 everyday words', completed_at: NOW - 10 * 86_400_000 },
    { id: 'm3', title: 'hold a 5-minute conversation', completed_at: null },
    { id: 'm4', title: 'watch a film without subtitles', completed_at: null },
    { id: 'm5', title: 'read a short story end to end', completed_at: null },
  ],
};

describe('goals-v2 selectors · resolvers', () => {
  it('goalName prefers label, falls back to title, then a calm default', () => {
    expect(goalName({ id: 'x', label: 'run' })).toBe('run');
    expect(goalName({ id: 'x', title: 'walk' })).toBe('walk');
    expect(goalName({ id: 'x' })).toBe('a goal');
    expect(goalName(null)).toBe('a goal');
  });

  it('isActive / isRested resolve goal status', () => {
    expect(isActive({ id: 'x', status: 'active' })).toBe(true);
    expect(isActive({ id: 'x' })).toBe(true); // default = active
    expect(isActive({ id: 'x', status: 'paused' })).toBe(false);
    expect(isRested({ id: 'x', status: 'paused' })).toBe(true);
    expect(isRested({ id: 'x', status: 'dropped' })).toBe(true);
    expect(isRested({ id: 'x', status: 'active' })).toBe(false);
  });

  it('the add screen carries exactly the six logic categories', () => {
    expect(CATEGORY_OPTIONS.map((c) => c.value).sort()).toEqual(
      ['career', 'creative', 'finance', 'health', 'learning', 'relationship'],
    );
  });

  it('the review screen offers exactly two soft, non-shaming tags', () => {
    expect(REVIEW_TAGS).toHaveLength(2);
    expect(REVIEW_TAGS.map((t) => t.value).sort()).toEqual(['invested', 'want']);
  });
});

describe('goals-v2 selectors · progress', () => {
  it('progressPct computes done / total from milestones', () => {
    // 2 of 5 done = 40%
    expect(progressPct(SPANISH)).toBe(40);
  });

  it('progressPct falls back to the stored manual progress with no milestones', () => {
    expect(progressPct({ id: 'x', progress: 65 })).toBe(65);
    expect(progressPct({ id: 'x' })).toBe(0);
    expect(progressPct({ id: 'x', progress: 999 })).toBe(100);
  });

  it('progressCaption reads a calm "n of m" line, never a grade', () => {
    expect(progressCaption(SPANISH)).toBe('2 of 5 milestones done');
    expect(progressCaption({ id: 'x' })).toBe('progress, your way');
  });

  it('nextMilestone returns the first open milestone', () => {
    expect(nextMilestone(SPANISH)?.id).toBe('m3');
    // all done → null
    const allDone: GoalItem = {
      id: 'x',
      milestones: [{ id: 'a', title: 'a', completed_at: NOW }],
    };
    expect(nextMilestone(allDone)).toBeNull();
  });
});

describe('goals-v2 selectors · faceVM', () => {
  it('a cold start has no goal and no pattern line', () => {
    const vm = faceVM(slices({}), NOW);
    expect(vm.hasAnyGoal).toBe(false);
    expect(vm.deck).toHaveLength(0);
    expect(vm.reviewLine).toBeNull();
    expect(vm.patternLine).toBeNull();
  });

  it('builds a focus deck of active goals, ignoring rested ones', () => {
    const vm = faceVM(
      slices({
        goals: [
          SPANISH,
          { id: 'g2', label: 'run a 10k', status: 'active' },
          { id: 'g3', label: 'old goal', status: 'dropped' },
        ],
      }),
      NOW,
    );
    expect(vm.hasAnyGoal).toBe(true);
    expect(vm.deck).toHaveLength(2);
    expect(vm.deck[0].name).toBe('learn spanish');
    expect(vm.reviewLine).toContain('learn spanish');
  });

  it('focusGoalVM carries the percent, category and next milestone', () => {
    const fg = focusGoalVM(SPANISH);
    expect(fg.pct).toBe(40);
    expect(fg.category).toBe('learning');
    expect(fg.nextLabel).toBe('hold a 5-minute conversation');
  });
});

describe('goals-v2 selectors · goalDetailVM', () => {
  it('reports a missing goal honestly', () => {
    const vm = goalDetailVM(slices({}), 'nope', NOW);
    expect(vm.exists).toBe(false);
  });

  it('builds the full detail view-model from a real goal', () => {
    const vm = goalDetailVM(slices({ goals: [SPANISH] }), 'g1', NOW);
    expect(vm.exists).toBe(true);
    expect(vm.name).toBe('learn spanish');
    expect(vm.meta).toBe('learning · marathon pace');
    expect(vm.pct).toBe(40);
    expect(vm.progressCaption).toBe('2 of 5 milestones done');
    expect(vm.milestones).toHaveLength(5);
    // the third milestone is the next open one
    expect(vm.milestones[2].isNext).toBe(true);
    expect(vm.milestones[0].done).toBe(true);
    expect(vm.obstacle).toBe('the speaking part scares me');
    expect(vm.contract).toBe('give it one more honest week before deciding');
    expect(vm.contractWhen).not.toBeNull();
    expect(vm.rested).toBe(false);
  });

  it('marks a paused goal as rested', () => {
    const vm = goalDetailVM(
      slices({ goals: [{ ...SPANISH, status: 'paused' }] }),
      'g1',
      NOW,
    );
    expect(vm.rested).toBe(true);
  });
});

describe('goals-v2 selectors · reviewVM', () => {
  it('reports a missing goal honestly', () => {
    expect(reviewVM(slices({}), 'nope').exists).toBe(false);
  });

  it('carries the goal name and no drift signal with few check-ins', () => {
    const vm = reviewVM(slices({ goals: [SPANISH] }), 'g1');
    expect(vm.exists).toBe(true);
    expect(vm.name).toBe('learn spanish');
    expect(vm.driftSignal).toBe(false);
  });

  it('raises a drift signal when the last 2 check-ins were all "invested"', () => {
    const vm = reviewVM(
      slices({
        goals: [SPANISH],
        reviews: [
          { goal_id: 'g1', alive_flag: 'invested', ts: NOW - 7 * 86_400_000 },
          { goal_id: 'g1', alive_flag: 'invested', ts: NOW - 14 * 86_400_000 },
        ],
      }),
      'g1',
    );
    expect(vm.driftSignal).toBe(true);
  });

  it('does not raise drift when a recent check-in still "wants" it', () => {
    const vm = reviewVM(
      slices({
        goals: [SPANISH],
        reviews: [
          { goal_id: 'g1', alive_flag: 'want', ts: NOW - 1 * 86_400_000 },
          { goal_id: 'g1', alive_flag: 'invested', ts: NOW - 14 * 86_400_000 },
        ],
      }),
      'g1',
    );
    expect(vm.driftSignal).toBe(false);
  });
});

describe('goals-v2 selectors · patternsVM', () => {
  it('falls back to the honest example gallery when nothing is observed', () => {
    const vm = patternsVM(slices({ goals: [SPANISH] }), NOW);
    expect(vm.isExample).toBe(true);
    expect(vm.groups.length).toBeGreaterThan(0);
    // every example line carries a citation
    for (const g of vm.groups) {
      for (const line of g.lines) {
        expect(line.cite.length).toBeGreaterThan(0);
      }
    }
  });

  it('surfaces a live group when two goals genuinely interfere', () => {
    // 'spend' vs 'save' is a real CONFLICT_PAIR the G12 detector matches
    const vm = patternsVM(
      slices({
        goals: [
          { id: 'g1', label: 'travel more', status: 'active', interference_tags: ['spend'] },
          { id: 'g2', label: 'save money', status: 'active', interference_tags: ['save'] },
        ],
      }),
      NOW,
    );
    expect(vm.isExample).toBe(false);
    expect(vm.groups.some((g) => g.key === 'pull')).toBe(true);
  });

  it('patternSummary is null on a cold start', () => {
    expect(patternSummary(slices({}), NOW)).toBeNull();
  });
});

describe('goals-v2 selectors · notificationsVM', () => {
  it('returns exactly the five gentle, non-shaming pushes from the mockup', () => {
    const vm = notificationsVM(NOW);
    expect(vm.cards).toHaveLength(5);
    expect(vm.cards.map((c) => c.glyph)).toEqual([
      'milestone', 'review', 'obstacle', 'interference', 'weekly',
    ]);
    // no push ever scolds — the copy is forward and kind
    for (const c of vm.cards) {
      expect(c.title).not.toMatch(/haven't|failed|behind/i);
      expect(c.body.length).toBeGreaterThan(0);
    }
  });
});
