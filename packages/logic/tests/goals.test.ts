/**
 * @ollie/logic · goals tests
 *
 * 20 cases across all phases.
 */

import { describe, it, expect } from 'vitest';
import {
  tokens,
  resolveNow,
  detectLowMood,
  detectObstacleEcho,
  detectPreMortemEcho,
  retrieveUlyssesContract,
  getUlyssesText,
  detectActiveCap,
  detectResearchAsProgress,
  detectIdentityDrift,
  detectSunkCostFlag,
  classifyPacing,
  detectPacingBreach,
  detectContagion,
  isIncubating,
  classifyAnchor,
  detectMissingAnchorPair,
  detectFloatingGoal,
  detectMissingConstrual,
  construalFrameForState,
  detectAntiGoalInDump,
  detectGoalInterference,
  detectExperimentCandidate,
} from '../src/goals';

const NOW = 1_700_000_000_000; // fixed epoch for determinism
const DAY = 86_400_000;

// ─── helpers ─────────────────────────────────────────────────────────

describe('tokens', () => {
  it('strips stop-words and short tokens', () => {
    const result = tokens('i want to become a writer because i love it');
    expect(result).toContain('writer');
    expect(result).toContain('become');
    expect(result).not.toContain('the');
    expect(result).not.toContain('i');
  });

  it('returns empty for empty string', () => {
    expect(tokens('')).toEqual([]);
  });
});

describe('resolveNow', () => {
  it('prefers opts.now over history.now', () => {
    expect(resolveNow({ now: 1000 }, { now: 2000 })).toBe(2000);
  });
  it('falls back to history.now if no opts.now', () => {
    expect(resolveNow({ now: 1234 }, {})).toBe(1234);
  });
});

// ─── phase 1 ─────────────────────────────────────────────────────────

describe('detectLowMood', () => {
  it('returns null when no dumps', () => {
    expect(detectLowMood({ dumps: [] }, { now: NOW })).toBeNull();
  });

  it('fires when ≥3 low-mood dumps in 7d', () => {
    const dumps = [
      { ts: NOW - 1 * DAY, text: 'i feel exhausted today' },
      { ts: NOW - 2 * DAY, text: 'feeling hopeless again' },
      { ts: NOW - 3 * DAY, text: 'completely numb, done with everything' },
    ];
    const result = detectLowMood({ dumps }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result?.signal).toBe('goals_low_mood');
    expect(result?.lock_until_ts).toBeGreaterThan(NOW);
  });

  it('does not fire with 2 low-mood dumps in 7d and only 1 in 48h', () => {
    const dumps = [
      { ts: NOW - 5 * DAY, text: 'i am exhausted' },
      { ts: NOW - 4 * DAY, text: 'feeling hopeless' },
    ];
    expect(detectLowMood({ dumps }, { now: NOW })).toBeNull();
  });

  it('fires at min48h=2 when 2 matches in 48h', () => {
    const dumps = [
      { ts: NOW - 1 * DAY + 1000, text: 'completely numb and empty' },
      { ts: NOW - 10 * 3600 * 1000, text: 'crashing, bittim' },
    ];
    const result = detectLowMood({ dumps }, { now: NOW, min7d: 999 });
    expect(result?.signal).toBe('goals_low_mood');
  });
});

describe('detectObstacleEcho', () => {
  it('returns null with no goals', () => {
    expect(detectObstacleEcho({ goals: [], dumps: [] }, { now: NOW })).toBeNull();
  });

  it('returns matches when obstacle tokens appear in dump', () => {
    const goals = [{
      id: 'g1', status: 'active',
      obstacle: 'procrastination fear deadline',
    }];
    const dumps = [{ ts: NOW - 1 * DAY, text: 'procrastination is killing this deadline progress fear' }];
    const result = detectObstacleEcho({ goals, dumps }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].goal_id).toBe('g1');
    expect(result![0].matches).toBeGreaterThanOrEqual(2);
  });
});

describe('detectPreMortemEcho', () => {
  it('ignores dumps within 30 days of goal creation', () => {
    const goals = [{
      id: 'g1', status: 'active',
      premortem: 'procrastination burnout deadline failure',
      created_at: NOW - 10 * DAY,
    }];
    const dumps = [{ ts: NOW - 2 * DAY, text: 'procrastination burnout deadline failure spiral' }];
    // dump is only 8d after creation, which is < 30d minAgeDays
    expect(detectPreMortemEcho({ goals, dumps }, { now: NOW })).toBeNull();
  });

  it('surfaces echo after 30d incubation', () => {
    const created_at = NOW - 60 * DAY;
    const goals = [{
      id: 'g1', status: 'active',
      premortem: 'procrastination burnout deadline failure',
      created_at,
    }];
    const dumps = [{ ts: NOW - 2 * DAY, text: 'procrastination burnout deadline failure spiral' }];
    const result = detectPreMortemEcho({ goals, dumps }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_premortem_echo');
  });
});

describe('retrieveUlyssesContract', () => {
  const goal = { id: 'g1', ulysses_contract: 'remember why you started' };

  it('returns null if action is not delete or pause', () => {
    expect(retrieveUlyssesContract({}, { now: NOW, goal, action: 'delete' })).not.toBeNull();
    // @ts-expect-error intentional bad action
    expect(retrieveUlyssesContract({}, { now: NOW, goal, action: 'edit' })).toBeNull();
  });

  it('returns contract text on delete action', () => {
    const result = retrieveUlyssesContract({}, { now: NOW, goal, action: 'delete' });
    expect(result?.contract_text).toBe('remember why you started');
    expect(result?.copy).toContain('delete');
  });

  it('returns null for empty contract', () => {
    expect(retrieveUlyssesContract({}, { now: NOW, goal: { id: 'g1', ulysses_contract: '' }, action: 'delete' })).toBeNull();
  });
});

describe('getUlyssesText', () => {
  it('returns text for goal with contract', () => {
    expect(getUlyssesText({ id: 'g1', ulysses_contract: 'stay the course' })?.text).toBe('stay the course');
  });
  it('returns null for goal without contract', () => {
    expect(getUlyssesText({ id: 'g1' })).toBeNull();
  });
});

// ─── phase 2 ─────────────────────────────────────────────────────────

describe('detectActiveCap', () => {
  it('returns null when ≤5 active goals', () => {
    const goals = Array.from({ length: 5 }, (_, i) => ({ id: String(i), status: 'active' }));
    expect(detectActiveCap({ goals }, { now: NOW })).toBeNull();
  });

  it('fires when >5 active goals', () => {
    const goals = Array.from({ length: 6 }, (_, i) => ({ id: String(i), status: 'active' }));
    const result = detectActiveCap({ goals }, { now: NOW });
    expect(result?.signal).toBe('goals_active_cap_exceeded');
    expect(result?.active_count).toBe(6);
  });
});

describe('classifyPacing', () => {
  it('classifies explicit sprint', () => {
    expect(classifyPacing({ id: 'g1', pacing: 'sprint' }, { now: NOW }).pacing).toBe('sprint');
  });

  it('infers marathon from 3-month span', () => {
    const result = classifyPacing({
      id: 'g1',
      created_at: NOW - 90 * DAY,
      target_date_ts: NOW,
    }, { now: NOW });
    expect(result.pacing).toBe('marathon');
  });

  it('defaults to rolling with no target', () => {
    expect(classifyPacing({ id: 'g1' }, { now: NOW }).pacing).toBe('rolling');
  });

  it('rolling has null dormancy threshold', () => {
    expect(classifyPacing({ id: 'g1', pacing: 'rolling' }, { now: NOW }).dormancy_threshold_days).toBeNull();
  });
});

describe('detectPacingBreach', () => {
  it('returns null with no goals', () => {
    expect(detectPacingBreach({ goals: [] }, { now: NOW })).toBeNull();
  });

  it('fires for sprint goal with no doing in 8 days', () => {
    const goals = [{ id: 'g1', status: 'active', pacing: 'sprint' as const }];
    const sessions = [{ ts: NOW - 8 * DAY, goal_id: 'g1', type: 'doing' }];
    const result = detectPacingBreach({ goals, sessions }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_pacing_breach');
  });

  it('does not fire when doing is recent', () => {
    const goals = [{ id: 'g1', status: 'active', pacing: 'sprint' as const }];
    const sessions = [{ ts: NOW - 3 * DAY, goal_id: 'g1', type: 'doing' }];
    expect(detectPacingBreach({ goals, sessions }, { now: NOW })).toBeNull();
  });
});

// ─── phase 3 ─────────────────────────────────────────────────────────

describe('detectContagion', () => {
  it('returns null with no dumps', () => {
    expect(detectContagion({ dumps: [] }, { now: NOW })).toBeNull();
  });

  it('fires on social trigger language', () => {
    const dumps = [{ ts: NOW - 1 * DAY, text: 'i saw a post about running and now inspired by it all' }];
    const result = detectContagion({ dumps }, { now: NOW });
    expect(result?.signal).toBe('goals_contagion');
  });
});

describe('isIncubating', () => {
  it('returns true when incubation_until is future', () => {
    expect(isIncubating({ incubation_until: NOW + DAY }, { now: NOW })).toBe(true);
  });
  it('returns false when incubation_until is past', () => {
    expect(isIncubating({ incubation_until: NOW - DAY }, { now: NOW })).toBe(false);
  });
  it('returns false when field absent', () => {
    expect(isIncubating({}, { now: NOW })).toBe(false);
  });
});

describe('detectMissingAnchorPair', () => {
  it('returns null for goal without anchor_type', () => {
    const goals = [{ id: 'g1', status: 'active' }];
    expect(detectMissingAnchorPair({ goals }, { now: NOW })).toBeNull();
  });

  it('flags identity goal missing concrete', () => {
    const goals = [{ id: 'g1', status: 'active', anchor_type: 'identity' as const }];
    const result = detectMissingAnchorPair({ goals }, { now: NOW });
    expect(result![0].missing).toBe('concrete');
  });

  it('flags metric goal missing abstract', () => {
    const goals = [{ id: 'g1', status: 'active', anchor_type: 'metric' as const }];
    const result = detectMissingAnchorPair({ goals }, { now: NOW });
    expect(result![0].missing).toBe('abstract');
  });
});

describe('detectFloatingGoal', () => {
  it('returns null for goal with no why_chain', () => {
    const goals = [{ id: 'g1', status: 'active', why_chain: [] }];
    expect(detectFloatingGoal({ goals }, { now: NOW })).toBeNull();
  });

  it('flags shallow chain (1 entry, needs 3)', () => {
    const goals = [{ id: 'g1', status: 'active', label: 'run marathon', why_chain: ['i want to be fit'] }];
    const result = detectFloatingGoal({ goals }, { now: NOW });
    expect(result![0].reason).toBe('shallow');
  });

  it('flags dead-end chain with idk', () => {
    const goals = [{ id: 'g1', status: 'active', label: 'run marathon', why_chain: ['to be fit', 'idk why', 'something'] }];
    const result = detectFloatingGoal({ goals }, { now: NOW });
    expect(result![0].reason).toBe('dead-end');
  });
});

describe('construalFrameForState', () => {
  const goal = { id: 'g1', construal_abstract: 'become healthy', construal_concrete: 'run 1km today' };

  it('returns abstract frame for low EF', () => {
    expect(construalFrameForState(goal, 'low')?.frame).toBe('abstract');
  });
  it('returns concrete frame for high EF', () => {
    expect(construalFrameForState(goal, 'high')?.frame).toBe('concrete');
  });
  it('returns null for unknown EF state', () => {
    expect(construalFrameForState(goal, 'medium')).toBeNull();
  });
});

describe('detectGoalInterference', () => {
  it('returns null with fewer than 2 active goals', () => {
    const goals = [{ id: 'g1', status: 'active', interference_tags: ['spend'] }];
    expect(detectGoalInterference({ goals }, { now: NOW })).toBeNull();
  });

  it('fires when two goals have opposing tags', () => {
    const goals = [
      { id: 'g1', status: 'active', interference_tags: ['spend'] },
      { id: 'g2', status: 'active', interference_tags: ['save'] },
    ];
    const result = detectGoalInterference({ goals }, { now: NOW });
    expect(result?.signal).toBe('goals_interference');
    expect(result?.conflicts).toHaveLength(1);
  });
});

describe('detectExperimentCandidate', () => {
  it('returns null when goal has recent doing', () => {
    const goals = [{ id: 'g1', status: 'active', created_at: NOW - 60 * DAY }];
    const sessions = [{ ts: NOW - 1 * DAY, goal_id: 'g1', type: 'doing' }];
    expect(detectExperimentCandidate({ goals, sessions }, { now: NOW })).toBeNull();
  });

  it('fires for goal with 5+ weeks of silence', () => {
    const goals = [{ id: 'g1', status: 'active', label: 'write book', created_at: NOW - 60 * DAY }];
    const sessions: never[] = [];
    const result = detectExperimentCandidate({ goals, sessions }, { now: NOW });
    expect(result![0].signal).toBe('goals_experiment_candidate');
    expect(result![0].weeks_stuck).toBeGreaterThanOrEqual(5);
  });
});
