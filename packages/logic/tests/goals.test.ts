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
  classifyPacing,
  detectPacingBreach,
  detectContagion,
  isIncubating,
  detectMissingAnchorPair,
  detectFloatingGoal,
  detectMissingConstrual,
  construalFrameForState,
  detectGoalInterference,
  detectExperimentCandidate,
  detectResearchAsProgress,
  detectIdentityDrift,
  detectSunkCostFlag,
  classifyAnchor,
  detectAntiGoalOpportunity,
  detectAntiGoalInDump,
  detectGoalVelocityByCategory,
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

// ─── consent gate ─────────────────────────────────────────────────────────────
// Verifies _consentOnGoals is wired: consent=false → null; absent → fires.

describe('consent gate (opts.consent)', () => {
  const goals = [{ id: 'g1', status: 'active', label: 'write book', created_at: NOW - 60 * DAY }];
  const sessions: never[] = [];

  it('detectPacingBreach returns null when consent=false', () => {
    expect(detectPacingBreach({ goals, sessions }, { now: NOW, consent: false })).toBeNull();
  });

  it('detectPacingBreach fires when consent=true', () => {
    const result = detectPacingBreach({ goals, sessions }, { now: NOW, consent: true });
    expect(result).not.toBeNull();
  });

  it('detectPacingBreach defaults to true when consent omitted', () => {
    const result = detectPacingBreach({ goals, sessions }, { now: NOW });
    expect(result).not.toBeNull();
  });

  it('detectContagion returns null when consent=false', () => {
    const dumps = [{ ts: NOW - 1 * DAY, text: 'i saw a post and now inspired by it' }];
    expect(detectContagion({ dumps }, { now: NOW, consent: false })).toBeNull();
  });

  it('detectFloatingGoal returns null when consent=false', () => {
    const g = [{ id: 'g1', status: 'active', label: 'x', why_chain: ['idk'] }];
    expect(detectFloatingGoal({ goals: g }, { now: NOW, consent: false })).toBeNull();
  });

  it('detectMissingConstrual returns null when consent=false', () => {
    const g = [{ id: 'g1', status: 'active' }];
    expect(detectMissingConstrual({ goals: g }, { now: NOW, consent: false })).toBeNull();
  });

  it('construalFrameForState returns null when consent=false', () => {
    const goal = { id: 'g1', construal_abstract: 'become healthy', construal_concrete: 'run 1km' };
    expect(construalFrameForState(goal, 'low', { consent: false })).toBeNull();
  });

  it('detectExperimentCandidate returns null when consent=false', () => {
    expect(detectExperimentCandidate({ goals, sessions }, { now: NOW, consent: false })).toBeNull();
  });

  it('detectGoalInterference returns null when consent=false', () => {
    const g = [
      { id: 'g1', status: 'active', interference_tags: ['spend'] },
      { id: 'g2', status: 'active', interference_tags: ['save'] },
    ];
    expect(detectGoalInterference({ goals: g }, { now: NOW, consent: false })).toBeNull();
  });
});

// ─── phase 2 — previously-untested detectors ─────────────────────────

describe('detectResearchAsProgress', () => {
  it('returns null with no goals or no sessions', () => {
    expect(detectResearchAsProgress({ goals: [], sessions: [] }, { now: NOW })).toBeNull();
    expect(detectResearchAsProgress(
      { goals: [{ id: 'g1', status: 'active' }], sessions: [] },
      { now: NOW },
    )).toBeNull();
  });

  it('fires when an active goal has only thinking sessions (>=5, contiguous)', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      ts: NOW - (i + 1) * DAY, goal_id: 'g1', type: 'thinking',
    }));
    const result = detectResearchAsProgress(
      { goals: [{ id: 'g1', status: 'active' }], sessions },
      { now: NOW },
    );
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_research_as_progress');
    expect(result![0].thinking_count).toBe(5);
  });

  it('does NOT fire when any doing session exists', () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) => ({ ts: NOW - (i + 2) * DAY, goal_id: 'g1', type: 'thinking' })),
      { ts: NOW - 1 * DAY, goal_id: 'g1', type: 'doing' },
    ];
    expect(detectResearchAsProgress(
      { goals: [{ id: 'g1', status: 'active' }], sessions },
      { now: NOW },
    )).toBeNull();
  });

  it('threshold: 4 thinking sessions (one below minThinking=5) → null', () => {
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      ts: NOW - (i + 1) * DAY, goal_id: 'g1', type: 'thinking',
    }));
    expect(detectResearchAsProgress(
      { goals: [{ id: 'g1', status: 'active' }], sessions },
      { now: NOW },
    )).toBeNull();
  });

  it('ignores non-active goals', () => {
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      ts: NOW - (i + 1) * DAY, goal_id: 'g1', type: 'thinking',
    }));
    expect(detectResearchAsProgress(
      { goals: [{ id: 'g1', status: 'archived' }], sessions },
      { now: NOW },
    )).toBeNull();
  });
});

describe('detectIdentityDrift', () => {
  it('returns null with no goals', () => {
    expect(detectIdentityDrift({ goals: [] }, { now: NOW })).toBeNull();
  });

  it('fires when a role goal has zero role-aligned activity in 30d', () => {
    const result = detectIdentityDrift(
      { goals: [{ id: 'g1', status: 'active', role: 'writer' }], dumps: [], sessions: [] },
      { now: NOW },
    );
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_identity_drift');
    expect(result![0].role).toBe('writer');
  });

  it('does NOT fire when a dump mentions the role', () => {
    const result = detectIdentityDrift(
      {
        goals: [{ id: 'g1', status: 'active', role: 'writer' }],
        dumps: [{ ts: NOW - 2 * DAY, text: 'felt like a real writer today' }],
        sessions: [],
      },
      { now: NOW },
    );
    expect(result).toBeNull();
  });

  it('does NOT fire when a doing session touched the goal', () => {
    const result = detectIdentityDrift(
      {
        goals: [{ id: 'g1', status: 'active', role: 'writer' }],
        dumps: [],
        sessions: [{ ts: NOW - 3 * DAY, goal_id: 'g1', type: 'doing' }],
      },
      { now: NOW },
    );
    expect(result).toBeNull();
  });

  it('ignores goals with no role', () => {
    expect(detectIdentityDrift(
      { goals: [{ id: 'g1', status: 'active' }], dumps: [], sessions: [] },
      { now: NOW },
    )).toBeNull();
  });
});

describe('detectSunkCostFlag', () => {
  it('returns null with no goals or no reviews', () => {
    expect(detectSunkCostFlag({ goals: [], reviews: [] }, { now: NOW })).toBeNull();
    expect(detectSunkCostFlag(
      { goals: [{ id: 'g1' }], reviews: [] },
      { now: NOW },
    )).toBeNull();
  });

  it('fires when last 3 reviews are all "invested"', () => {
    const reviews = [
      { ts: NOW - 1 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 10 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 20 * DAY, goal_id: 'g1', alive_flag: 'invested' },
    ];
    const result = detectSunkCostFlag({ goals: [{ id: 'g1' }], reviews }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_sunk_cost_flag');
  });

  it('does NOT fire when the most recent review is "still want"', () => {
    const reviews = [
      { ts: NOW - 1 * DAY, goal_id: 'g1', alive_flag: 'still_want' },
      { ts: NOW - 10 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 20 * DAY, goal_id: 'g1', alive_flag: 'invested' },
    ];
    expect(detectSunkCostFlag({ goals: [{ id: 'g1' }], reviews }, { now: NOW })).toBeNull();
  });

  it('threshold: 2 reviews (below minRun=3) → null', () => {
    const reviews = [
      { ts: NOW - 1 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 10 * DAY, goal_id: 'g1', alive_flag: 'invested' },
    ];
    expect(detectSunkCostFlag({ goals: [{ id: 'g1' }], reviews }, { now: NOW })).toBeNull();
  });

  it('ignores reviews outside the 60d window', () => {
    const reviews = [
      { ts: NOW - 1 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 10 * DAY, goal_id: 'g1', alive_flag: 'invested' },
      { ts: NOW - 90 * DAY, goal_id: 'g1', alive_flag: 'invested' },
    ];
    expect(detectSunkCostFlag({ goals: [{ id: 'g1' }], reviews }, { now: NOW })).toBeNull();
  });
});

// ─── phase 3 — previously-untested detectors ─────────────────────────

describe('classifyAnchor', () => {
  it('returns the anchor type for a valid identity goal', () => {
    expect(classifyAnchor({ id: 'g1', anchor_type: 'identity' })).toBe('identity');
  });
  it('returns the anchor type for a valid metric goal', () => {
    expect(classifyAnchor({ id: 'g1', anchor_type: 'metric' })).toBe('metric');
  });
  it('returns null for an unknown anchor type', () => {
    // @ts-expect-error intentional invalid anchor
    expect(classifyAnchor({ id: 'g1', anchor_type: 'vibes' })).toBeNull();
  });
  it('returns null for a goal with no anchor', () => {
    expect(classifyAnchor({ id: 'g1' })).toBeNull();
  });
  it('returns null for null / undefined', () => {
    expect(classifyAnchor(null)).toBeNull();
    expect(classifyAnchor(undefined)).toBeNull();
  });
});

describe('detectAntiGoalOpportunity', () => {
  it('returns null with no goals', () => {
    expect(detectAntiGoalOpportunity({ goals: [] }, { now: NOW })).toBeNull();
  });

  it('fires in "avoidance" mode when a stuck goal has an anti_goal', () => {
    const result = detectAntiGoalOpportunity(
      {
        goals: [{ id: 'g1', status: 'active', label: 'ship app', anti_goal: 'become a perfectionist' }],
        sessions: [],
      },
      { now: NOW },
    );
    expect(result).not.toBeNull();
    expect(result![0].mode).toBe('avoidance');
  });

  it('fires in "suggest" mode when a stuck goal has no anti_goal', () => {
    const result = detectAntiGoalOpportunity(
      { goals: [{ id: 'g1', status: 'active', label: 'ship app' }], sessions: [] },
      { now: NOW },
    );
    expect(result).not.toBeNull();
    expect(result![0].mode).toBe('suggest');
  });

  it('does NOT fire when a recent doing session keeps the goal un-stuck', () => {
    const result = detectAntiGoalOpportunity(
      {
        goals: [{ id: 'g1', status: 'active', label: 'ship app' }],
        sessions: [{ ts: NOW - 2 * DAY, goal_id: 'g1', type: 'doing' }],
      },
      { now: NOW },
    );
    expect(result).toBeNull();
  });

  it('threshold: doing session just inside 14d window → not stuck → null', () => {
    const result = detectAntiGoalOpportunity(
      {
        goals: [{ id: 'g1', status: 'active', label: 'ship app' }],
        sessions: [{ ts: NOW - 13 * DAY, goal_id: 'g1', type: 'doing' }],
      },
      { now: NOW },
    );
    expect(result).toBeNull();
  });

  it('threshold: doing session just outside 14d window → stuck → fires', () => {
    const result = detectAntiGoalOpportunity(
      {
        goals: [{ id: 'g1', status: 'active', label: 'ship app' }],
        sessions: [{ ts: NOW - 15 * DAY, goal_id: 'g1', type: 'doing' }],
      },
      { now: NOW },
    );
    expect(result).not.toBeNull();
  });

  it('returns null when consent=false', () => {
    expect(detectAntiGoalOpportunity(
      { goals: [{ id: 'g1', status: 'active' }], sessions: [] },
      { now: NOW, consent: false },
    )).toBeNull();
  });
});

describe('detectAntiGoalInDump', () => {
  it('returns null with no dumps', () => {
    expect(detectAntiGoalInDump({ dumps: [] }, { now: NOW })).toBeNull();
  });

  it('fires when a recent dump contains avoidance language', () => {
    const result = detectAntiGoalInDump(
      { dumps: [{ ts: NOW - 1 * DAY, text: "i don't want to become my burnt-out boss" }] },
      { now: NOW },
    );
    expect(result).not.toBeNull();
    expect(result!.signal).toBe('goals_anti_goal_in_dump');
    expect(result!.excerpt.length).toBeGreaterThan(0);
  });

  it('does NOT fire on a neutral dump', () => {
    expect(detectAntiGoalInDump(
      { dumps: [{ ts: NOW - 1 * DAY, text: 'had a good productive day' }] },
      { now: NOW },
    )).toBeNull();
  });

  it('ignores dumps outside the 7d window', () => {
    expect(detectAntiGoalInDump(
      { dumps: [{ ts: NOW - 30 * DAY, text: "i don't want to become my boss" }] },
      { now: NOW },
    )).toBeNull();
  });

  it('returns null when consent=false', () => {
    expect(detectAntiGoalInDump(
      { dumps: [{ ts: NOW - 1 * DAY, text: "i don't want to become my boss" }] },
      { now: NOW, consent: false },
    )).toBeNull();
  });
});

describe('detectGoalVelocityByCategory', () => {
  it('returns null with no goals', () => {
    expect(detectGoalVelocityByCategory({ goals: [] }, { now: NOW })).toBeNull();
  });

  it('returns null when all categories are below minSample (3)', () => {
    const goals = [
      { id: 'g1', category: 'learning' as const, status: 'done', created_at: NOW - 10 * DAY, status_at: NOW - 5 * DAY },
      { id: 'g2', category: 'learning' as const, status: 'active', created_at: NOW - 10 * DAY },
    ];
    expect(detectGoalVelocityByCategory({ goals }, { now: NOW })).toBeNull();
  });

  it('emits a signal per category with >=3 goals in the window', () => {
    const goals = [
      { id: 'g1', category: 'learning' as const, status: 'done', created_at: NOW - 20 * DAY, status_at: NOW - 10 * DAY },
      { id: 'g2', category: 'learning' as const, status: 'done', created_at: NOW - 20 * DAY, status_at: NOW - 12 * DAY },
      { id: 'g3', category: 'learning' as const, status: 'active', created_at: NOW - 20 * DAY },
    ];
    const result = detectGoalVelocityByCategory({ goals }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result![0].signal).toBe('goals_velocity_pattern');
    expect(result![0].category).toBe('learning');
    expect(result![0].total).toBe(3);
    expect(result![0].completed).toBe(2);
    expect(result![0].velocity).toBeCloseTo(0.67, 2);
  });

  it('computes velocity_gap when two categories pass threshold', () => {
    const goals = [
      // learning: 3/3 done → velocity 1.0
      ...Array.from({ length: 3 }, (_, i) => ({
        id: 'L' + i, category: 'learning' as const, status: 'done',
        created_at: NOW - 30 * DAY, status_at: NOW - 20 * DAY,
      })),
      // career: 1/3 done → velocity ~0.33
      { id: 'C1', category: 'career' as const, status: 'done', created_at: NOW - 30 * DAY, status_at: NOW - 25 * DAY },
      { id: 'C2', category: 'career' as const, status: 'active', created_at: NOW - 30 * DAY },
      { id: 'C3', category: 'career' as const, status: 'active', created_at: NOW - 30 * DAY },
    ];
    const result = detectGoalVelocityByCategory({ goals }, { now: NOW });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].velocity_gap).toBeGreaterThan(1);
  });

  it('returns null when consent=false', () => {
    const goals = Array.from({ length: 3 }, (_, i) => ({
      id: 'g' + i, category: 'learning' as const, status: 'done',
      created_at: NOW - 20 * DAY, status_at: NOW - 10 * DAY,
    }));
    expect(detectGoalVelocityByCategory({ goals }, { now: NOW, consent: false })).toBeNull();
  });
});
