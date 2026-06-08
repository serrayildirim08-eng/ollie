import { describe, it, expect } from 'vitest';
import {
  computeDeferral,
  detectHarm,
  computeCapacity,
} from '../src/brain';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

// ─── Deliverable 2 · deferral tracking ────────────────────────────────────

describe('computeDeferral', () => {
  it('counts whole days sitting from created_at to now', () => {
    const sig = computeDeferral({ createdAt: NOW - 3.5 * DAY }, NOW);
    expect(sig.daysSitting).toBe(3);
    expect(sig.overdue).toBe(false);
    expect(sig.deferCount).toBe(0);
  });

  it('marks overdue when a past due date and not done', () => {
    const sig = computeDeferral(
      { createdAt: NOW - 5 * DAY, dueDate: NOW - 1 * DAY },
      NOW,
    );
    expect(sig.overdue).toBe(true);
  });

  it('is never overdue when the task is done', () => {
    const sig = computeDeferral(
      { createdAt: NOW - 5 * DAY, dueDate: NOW - 1 * DAY, done: true },
      NOW,
    );
    expect(sig.overdue).toBe(false);
  });

  it('is never overdue without a due date', () => {
    const sig = computeDeferral({ createdAt: NOW - 10 * DAY }, NOW);
    expect(sig.overdue).toBe(false);
  });

  it('parses ISO / YYYY-MM-DD due strings (admin_tasks shape)', () => {
    const sig = computeDeferral(
      { createdAt: NOW - 5 * DAY, dueDate: '2000-01-01' },
      NOW,
    );
    expect(sig.overdue).toBe(true);
  });

  it('a future due date is not overdue', () => {
    const sig = computeDeferral(
      { createdAt: NOW - 1 * DAY, dueDate: NOW + 2 * DAY },
      NOW,
    );
    expect(sig.overdue).toBe(false);
  });

  it('freezes daysSitting at completion for done tasks', () => {
    const sig = computeDeferral(
      { createdAt: NOW - 10 * DAY, done: true, completedAt: NOW - 8 * DAY },
      NOW,
    );
    expect(sig.daysSitting).toBe(2);
  });

  it('counts deferrals from a snooze array, and from a bare count', () => {
    expect(
      computeDeferral({ createdAt: NOW, snoozes: [NOW - DAY, NOW - 2 * DAY] }, NOW).deferCount,
    ).toBe(2);
    expect(computeDeferral({ createdAt: NOW, snoozes: 4 }, NOW).deferCount).toBe(4);
    expect(computeDeferral({ createdAt: NOW }, NOW).deferCount).toBe(0);
  });
});

// ─── Deliverable 3 · harm-of-deferral detection ───────────────────────────

describe('detectHarm', () => {
  it('flags an unarchived pantry item past predicted run-out as spoiled', () => {
    const events = detectHarm(
      { pantry: [{ id: 'p1', name: 'milk', predictedOutAtMs: NOW - 2 * DAY, archived: false }] },
      NOW,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refKind: 'pantry', refId: 'p1', harmKind: 'spoiled' });
    expect(events[0]!.id).toBe('spoiled:pantry:p1');
    expect(events[0]!.detectedAt).toBe(NOW);
  });

  it('does not flag spoiled when archived or still-fresh', () => {
    const events = detectHarm(
      {
        pantry: [
          { id: 'p1', predictedOutAtMs: NOW - 2 * DAY, archived: true },
          { id: 'p2', predictedOutAtMs: NOW + 2 * DAY },
          { id: 'p3', predictedOutAtMs: null },
        ],
      },
      NOW,
    );
    expect(events).toHaveLength(0);
  });

  it('flags a recurring bill past its cadence cycle as late', () => {
    const events = detectHarm(
      { bills: [{ id: 'b1', merchant: 'netflix', cadence: 'monthly', addedAt: NOW - 40 * DAY }] },
      NOW,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ harmKind: 'late', refKind: 'bill', refId: 'b1' });
  });

  it('does not flag a bill still within its cycle, paid, or cadence-less', () => {
    const events = detectHarm(
      {
        bills: [
          { id: 'b1', cadence: 'monthly', addedAt: NOW - 10 * DAY },
          { id: 'b2', cadence: 'monthly', addedAt: NOW - 40 * DAY, paid: true },
          { id: 'b3', cadence: null, addedAt: NOW - 400 * DAY },
        ],
      },
      NOW,
    );
    expect(events).toHaveLength(0);
  });

  it('flags a task/goal/renewal whose deadline passed while undone as missed', () => {
    const events = detectHarm(
      {
        deadlines: [
          { id: 't1', refKind: 'task', dueDate: NOW - 1 * DAY },
          { id: 'g1', refKind: 'goal', dueDate: '2000-01-01' },
          { id: 'r1', refKind: 'renewal', dueDate: NOW - 1 * DAY, done: true }, // done → skip
          { id: 't2', refKind: 'task', dueDate: NOW + 5 * DAY }, // future → skip
        ],
      },
      NOW,
    );
    expect(events.map((e) => e.id).sort()).toEqual(['missed:goal:g1', 'missed:task:t1']);
  });

  it('re-detection yields identical stable ids (dedupe-safe)', () => {
    const inputs = { pantry: [{ id: 'p1', predictedOutAtMs: NOW - DAY }] };
    const first = detectHarm(inputs, NOW);
    const second = detectHarm(inputs, NOW + DAY);
    expect(first[0]!.id).toBe(second[0]!.id);
  });

  it('returns nothing for an empty world or a clockless call', () => {
    expect(detectHarm({}, NOW)).toHaveLength(0);
    expect(detectHarm({ pantry: [{ id: 'p1', predictedOutAtMs: 1 }] }, 0)).toHaveLength(0);
  });
});

// ─── Deliverable 4 · capacity reading ─────────────────────────────────────

describe('computeCapacity', () => {
  it('poor sleep + low mood + high load → low', () => {
    const read = computeCapacity(
      { lastSleepHours: 4.5, sleepQuality: 1, recentMood: 'low', todayLoad: 9 },
      NOW,
    );
    expect(read.level).toBe('low');
    expect(read.computedAt).toBe(NOW);
  });

  it('good sleep + high mood + light day → high', () => {
    const read = computeCapacity(
      { lastSleepHours: 8, sleepQuality: 5, recentMood: 'high', todayLoad: 1 },
      NOW,
    );
    expect(read.level).toBe('high');
  });

  it('unknown everything → medium (no judgement without signal)', () => {
    const read = computeCapacity({}, NOW);
    expect(read.level).toBe('medium');
  });

  it('a single good night alone lifts to high', () => {
    expect(computeCapacity({ lastSleepHours: 8, sleepQuality: 5 }, NOW).level).toBe('high');
  });

  it('high load alone does NOT pull to low (busy ≠ depleted) — stays medium', () => {
    expect(computeCapacity({ todayLoad: 10 }, NOW).level).toBe('medium');
  });

  it('high load tips to low only with a real depletion signal (poor sleep)', () => {
    expect(computeCapacity({ todayLoad: 10, lastSleepHours: 4 }, NOW).level).toBe('low');
  });

  it('accepts numeric mood valence', () => {
    expect(computeCapacity({ recentMood: -2 }, NOW).level).toBe('low');
    expect(computeCapacity({ recentMood: 3 }, NOW).level).toBe('high');
    expect(computeCapacity({ recentMood: 0 }, NOW).level).toBe('medium');
  });
});
