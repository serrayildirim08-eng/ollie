import { describe, it, expect } from 'vitest';
import {
  EPWORTH_LENGTH,
  EPWORTH_QUESTIONS,
  EPWORTH_OPTIONS,
  epworthSleepinessBand,
  scoreEpworth,
} from '../src/sleep';

describe('epworth — questions', () => {
  it('has 8 questions matching EPWORTH_LENGTH', () => {
    expect(EPWORTH_LENGTH).toBe(8);
    expect(EPWORTH_QUESTIONS).toHaveLength(8);
  });

  it('every question carries a stable id and a prompt', () => {
    for (const q of EPWORTH_QUESTIONS) {
      expect(typeof q.id).toBe('string');
      expect(q.id.length).toBeGreaterThan(0);
      expect(typeof q.prompt).toBe('string');
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it('question ids are unique', () => {
    const ids = EPWORTH_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers exactly four dozing-likelihood options', () => {
    expect(EPWORTH_OPTIONS).toHaveLength(4);
  });
});

describe('epworth — epworthSleepinessBand', () => {
  it('maps 0–10 to normal', () => {
    expect(epworthSleepinessBand(0)).toBe('normal');
    expect(epworthSleepinessBand(10)).toBe('normal');
  });

  it('maps 11–12 to mild', () => {
    expect(epworthSleepinessBand(11)).toBe('mild');
    expect(epworthSleepinessBand(12)).toBe('mild');
  });

  it('maps 13–15 to moderate', () => {
    expect(epworthSleepinessBand(13)).toBe('moderate');
    expect(epworthSleepinessBand(15)).toBe('moderate');
  });

  it('maps 16–24 to high', () => {
    expect(epworthSleepinessBand(16)).toBe('high');
    expect(epworthSleepinessBand(24)).toBe('high');
  });
});

describe('epworth — scoreEpworth', () => {
  const ZEROES = new Array(8).fill(0);
  const MAXED = new Array(8).fill(3);

  it('sums an all-zero survey to 0 / normal', () => {
    const r = scoreEpworth(ZEROES, 1000);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0);
    expect(r!.band).toBe('normal');
    expect(r!.answered).toBe(8);
    expect(r!.scored_at).toBe(1000);
  });

  it('sums a maxed survey to 24 / high', () => {
    const r = scoreEpworth(MAXED, 2000);
    expect(r!.score).toBe(24);
    expect(r!.band).toBe('high');
  });

  it('sums a mixed survey correctly', () => {
    // 3+3+2+1+0+0+1+1 = 11 → mild
    const r = scoreEpworth([3, 3, 2, 1, 0, 0, 1, 1], 0);
    expect(r!.score).toBe(11);
    expect(r!.band).toBe('mild');
  });

  it('returns null for a wrong-length array', () => {
    expect(scoreEpworth([0, 0, 0], 0)).toBeNull();
    expect(scoreEpworth(new Array(9).fill(0), 0)).toBeNull();
  });

  it('returns null for an out-of-range answer', () => {
    expect(scoreEpworth([0, 0, 0, 0, 0, 0, 0, 4], 0)).toBeNull();
    expect(scoreEpworth([0, 0, 0, 0, 0, 0, 0, -1], 0)).toBeNull();
  });

  it('returns null for non-integer answers', () => {
    expect(scoreEpworth([0, 0, 0, 0, 0, 0, 0, 1.5], 0)).toBeNull();
  });

  it('returns null for null / undefined', () => {
    expect(scoreEpworth(null, 0)).toBeNull();
    expect(scoreEpworth(undefined, 0)).toBeNull();
  });

  it('normalises a non-finite now to 0', () => {
    const r = scoreEpworth(ZEROES, Infinity);
    expect(r!.scored_at).toBe(0);
  });
});
