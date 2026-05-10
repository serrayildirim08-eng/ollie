import { describe, it, expect } from 'vitest';
import {
  detectSyndromePatterns,
  detectBoundaries,
  DAY_MS,
  type CycleItem,
  type SymptomEvent,
  type SyndromeFlag,
} from '../src/cycle';

const day = (n: number): number => n * DAY_MS;
const startEvents = (offsets: readonly number[]): CycleItem[] =>
  offsets.map((d) => ({ ts: day(d), action: 'started' as const }));

const has = (flags: SyndromeFlag[], key: SyndromeFlag['key']): boolean =>
  flags.some((f) => f.key === key);

describe('detectSyndromePatterns', () => {
  it('returns [] when the user has no logged starts', () => {
    expect(detectSyndromePatterns([], [], 0)).toEqual([]);
  });

  it('raises missed-period after 45+ days', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56]));
    const now = day(56) + 50 * DAY_MS;
    const flags = detectSyndromePatterns(cycles, [], now);
    expect(has(flags, 'missed-period')).toBe(true);
  });

  it('raises irregular when cycle gaps vary widely', () => {
    const cycles = detectBoundaries(startEvents([0, 22, 60, 88, 140, 168]));
    const now = day(180);
    const flags = detectSyndromePatterns(cycles, [], now);
    expect(has(flags, 'irregular')).toBe(true);
  });

  it('raises pcos-pattern when 3+ signals align', () => {
    const cycles = detectBoundaries(startEvents([0, 50, 100, 160, 220]));
    const now = day(290);
    const events: SymptomEvent[] = [
      { ts: day(40), text: 'acne breakout' },
      { ts: day(60), text: 'massive acne' },
      { ts: day(80), text: 'acne pimple' },
      { ts: day(120), text: 'acne flare' },
      { ts: day(150), text: 'acne again' },
      { ts: day(170), text: 'hair thinning' },
      { ts: day(200), text: 'hair loss' },
    ];
    const flags = detectSyndromePatterns(cycles, events, now);
    expect(has(flags, 'pcos-pattern')).toBe(true);
  });

  it('raises pmdd-pattern when severe mood symptoms cluster in late luteal', () => {
    const cycles = detectBoundaries(startEvents([0, 28, 56, 84, 112]));
    const now = day(120);
    const events: SymptomEvent[] = [
      { ts: day(25), text: 'hopeless and crying uncontrollably' },
      { ts: day(53), text: 'overwhelming rage' },
      { ts: day(81), text: 'panic attack' },
      { ts: day(109), text: 'cant cope' },
    ];
    const flags = detectSyndromePatterns(cycles, events, now);
    expect(has(flags, 'pmdd-pattern')).toBe(true);
  });

  it('every flag includes title, body, and at least one evidence string', () => {
    const cycles = detectBoundaries(startEvents([0, 22, 60, 88, 140, 168]));
    const now = day(180);
    const flags = detectSyndromePatterns(cycles, [], now);
    for (const f of flags) {
      expect(f.title).toBeTruthy();
      expect(f.body).toBeTruthy();
      expect(Array.isArray(f.evidence)).toBe(true);
    }
  });

  it('never returns a diagnostic verb in the body copy', () => {
    const cycles = detectBoundaries(startEvents([0, 50, 100, 160, 220]));
    const now = day(290);
    const events: SymptomEvent[] = [
      { ts: day(40), text: 'severe cramp' },
      { ts: day(80), text: 'bad cramp' },
      { ts: day(110), text: 'worst cramp' },
      { ts: day(140), text: 'pain with sex' },
      { ts: day(180), text: 'pelvic pain' },
      { ts: day(220), text: 'pelvic pain again' },
    ];
    const flags = detectSyndromePatterns(cycles, events, now);
    for (const f of flags) {
      expect(f.body).toMatch(/not a diagnosis|not a diagnosis,|worth (a |checking|raising)/i);
    }
  });
});
