import { describe, it, expect } from 'vitest';
import { creditForEvents, EVENTS_PER_SEED } from '../src/resources.js';

describe('creditForEvents', () => {
  it('no new events → nothing credited', () => {
    expect(creditForEvents(10, 10)).toEqual({ water: 0, seed: 0 });
  });

  it('credits 1 water per new event', () => {
    expect(creditForEvents(0, 3).water).toBe(3);
    expect(creditForEvents(5, 8).water).toBe(3);
  });

  it('credits a seed every Nth event', () => {
    // events 1..4 → one seed (at event 4)
    expect(creditForEvents(0, 4).seed).toBe(1);
    // events 1..8 → two seeds (at 4 and 8)
    expect(creditForEvents(0, 8).seed).toBe(2);
  });

  it('seed credit does not double-count across calls', () => {
    const a = creditForEvents(0, 4).seed;
    const b = creditForEvents(4, 8).seed;
    expect(a + b).toBe(creditForEvents(0, 8).seed);
  });

  it('a partial run that does not cross N earns no seed', () => {
    expect(creditForEvents(0, EVENTS_PER_SEED - 1).seed).toBe(0);
  });

  it('never returns negative credit when cursor is ahead', () => {
    expect(creditForEvents(10, 4)).toEqual({ water: 0, seed: 0 });
  });
});
