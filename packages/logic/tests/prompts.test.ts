import { describe, it, expect } from 'vitest';
import { prompts } from '../src/index';

const { buildCandidates, pick, recordShown, FALLBACK } = prompts;

// Pick a fixed timestamp at 3pm local to keep time-of-day rules stable.
const at = (hour: number, minute = 0): number =>
  new Date(2026, 4, 10, hour, minute, 0, 0).getTime();

describe('buildCandidates', () => {
  it('always includes the FALLBACK candidate', () => {
    const out = buildCandidates({ now: at(15) });
    expect(out.some((c) => c.id === 'fallback')).toBe(true);
    expect(out[out.length - 1]).toEqual(FALLBACK);
  });

  it('adds sleep-gap when last sleep was > 48h ago', () => {
    const now = at(15);
    const out = buildCandidates({
      now,
      sleepSessions: [{ ts: now - 50 * 3_600_000 }],
    });
    expect(out.some((c) => c.id === 'sleep-gap')).toBe(true);
  });

  it('adds cycle-approaching when prediction lands within 3 days', () => {
    const now = at(15);
    const out = buildCandidates({
      now,
      prediction: { nextPeriodTs: now + 2 * 86_400_000 },
    });
    expect(out.some((c) => c.id === 'cycle-approaching')).toBe(true);
  });

  it('adds pets-overdue when any pet has non-ok severity', () => {
    const out = buildCandidates({
      now: at(15),
      petGaps: [{ severity: 'amber' }],
    });
    expect(out.some((c) => c.id === 'pets-overdue')).toBe(true);
  });

  it('adds water-gap only after 2pm when fewer than 3 glasses', () => {
    const beforeNoon = buildCandidates({ now: at(11), waterLog: [] });
    expect(beforeNoon.some((c) => c.id === 'water-gap')).toBe(false);

    const afternoon = buildCandidates({ now: at(15), waterLog: [] });
    expect(afternoon.some((c) => c.id === 'water-gap')).toBe(true);
  });

  it('adds morning-plan between 6am and 11am', () => {
    expect(buildCandidates({ now: at(8) }).some((c) => c.id === 'morning-plan')).toBe(true);
    expect(buildCandidates({ now: at(15) }).some((c) => c.id === 'morning-plan')).toBe(false);
  });

  it('adds evening-reflect at 8pm or later', () => {
    expect(buildCandidates({ now: at(21) }).some((c) => c.id === 'evening-reflect')).toBe(true);
  });

  it('adds ritual-moment when current hour matches a peak within 1h', () => {
    const out = buildCandidates({
      now: at(8, 30),
      ritualPeaks: [{ hour: 8, strength: 1 }],
    });
    expect(out.some((c) => c.id === 'ritual-moment')).toBe(true);
  });
});

describe('pick', () => {
  const candidates = [
    { id: 'morning-plan', text: 'a', priority: 0.4 },
    { id: 'water-gap', text: 'b', priority: 0.55 },
    FALLBACK,
  ];

  it('returns null on empty input', () => {
    expect(pick([], [], at(15))).toBeNull();
    expect(pick(null, null, at(15))).toBeNull();
  });

  it('picks the highest-priority eligible candidate', () => {
    expect(pick(candidates, [], at(15))?.id).toBe('water-gap');
  });

  it('respects the 6h rate-limit on previously-shown ids', () => {
    const now = at(15);
    const hist = [{ id: 'water-gap', shownAt: now - 3 * 3_600_000 }]; // 3h ago — within limit
    expect(pick(candidates, hist, now)?.id).not.toBe('water-gap');
  });

  it('falls back to FALLBACK when everything else is rate-limited', () => {
    const now = at(15);
    const hist = [
      { id: 'morning-plan', shownAt: now - 1000 },
      { id: 'water-gap', shownAt: now - 1000 },
    ];
    expect(pick(candidates, hist, now)?.id).toBe('fallback');
  });
});

describe('recordShown', () => {
  it('appends a new entry', () => {
    const next = recordShown([], 'water-gap', 123);
    expect(next).toEqual([{ id: 'water-gap', shownAt: 123 }]);
  });

  it('caps history at 20 entries (keeps newest)', () => {
    let h = [] as ReturnType<typeof recordShown>;
    for (let i = 0; i < 25; i++) h = recordShown(h, `id-${i}`, i);
    expect(h).toHaveLength(20);
    expect(h[h.length - 1].id).toBe('id-24');
  });
});
