import { describe, it, expect } from 'vitest';
import { buildTodayPulse } from './todayPulseCopy';

describe('buildTodayPulse', () => {
  it('reads as clear when nothing is due', () => {
    expect(buildTodayPulse({ taskCount: 0, capacity: 'medium' })).toBe(
      "today's clear. nothing needs you yet.",
    );
  });

  it('softens the empty day on low capacity', () => {
    expect(buildTodayPulse({ taskCount: 0, capacity: 'low' })).toBe(
      'a soft day. nothing needs you yet.',
    );
  });

  it('names a single thing without a number', () => {
    expect(buildTodayPulse({ taskCount: 1, capacity: 'high' })).toBe('one thing for today.');
  });

  it('says "a few" for two or three', () => {
    expect(buildTodayPulse({ taskCount: 2, capacity: null })).toBe('a few things for today.');
    expect(buildTodayPulse({ taskCount: 3, capacity: null })).toBe('a few things for today.');
  });

  it('gentles a fuller day and never shows a raw scary count', () => {
    const full = buildTodayPulse({ taskCount: 9, capacity: 'medium' });
    expect(full).toBe('a fuller day today. one at a time.');
    expect(full).not.toMatch(/\d/);
    expect(buildTodayPulse({ taskCount: 9, capacity: 'low' })).toBe(
      'a fuller day. just take the top one.',
    );
  });
});
