/**
 * aging · boundary tests.
 *
 * Every band edge, plus the null-shelf-life "unknown item never ages" rule,
 * plus the malformed-input rules (NaN / Infinity / 0 / negative shelfLife).
 */

import { describe, expect, it } from 'vitest';
import { ageOf } from './aging';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

describe('ageOf', () => {
  it("returns 'fresh' for elapsed < 1.0 × shelf", () => {
    expect(ageOf(T0, 7, T0 + 6.99 * DAY)).toBe('fresh');
    expect(ageOf(T0, 7, T0)).toBe('fresh');
    expect(ageOf(T0, 7, T0 - 100 * DAY)).toBe('fresh'); // negative elapsed
  });

  it("returns 'faded' at exactly 1.0 × shelf", () => {
    // boundary graduates to 'faded' — half-open interval [1.0, 1.5)
    expect(ageOf(T0, 7, T0 + 7 * DAY)).toBe('faded');
  });

  it("returns 'faded' inside [1.0, 1.5) × shelf", () => {
    expect(ageOf(T0, 7, T0 + 8 * DAY)).toBe('faded');
    expect(ageOf(T0, 7, T0 + 10.49 * DAY)).toBe('faded'); // just under 1.5×
  });

  it("returns 'still_here_prompt' at exactly 1.5 × shelf", () => {
    expect(ageOf(T0, 7, T0 + 10.5 * DAY)).toBe('still_here_prompt');
  });

  it("returns 'still_here_prompt' inside [1.5, 2.0) × shelf", () => {
    expect(ageOf(T0, 7, T0 + 11 * DAY)).toBe('still_here_prompt');
    expect(ageOf(T0, 7, T0 + 13.99 * DAY)).toBe('still_here_prompt'); // just under 2.0×
  });

  it("returns 'should_archive' at exactly 2.0 × shelf", () => {
    expect(ageOf(T0, 7, T0 + 14 * DAY)).toBe('should_archive');
  });

  it("returns 'should_archive' for any elapsed ≥ 2.0 × shelf", () => {
    expect(ageOf(T0, 7, T0 + 21 * DAY)).toBe('should_archive');
    expect(ageOf(T0, 7, T0 + 365 * DAY)).toBe('should_archive');
  });

  it("treats null shelfLifeDays as 'unknown' — always fresh", () => {
    expect(ageOf(T0, null, T0 + 365 * DAY)).toBe('fresh');
    expect(ageOf(T0, null, T0)).toBe('fresh');
  });

  it("treats 0 / negative / NaN / Infinity shelfLifeDays as 'unknown'", () => {
    expect(ageOf(T0, 0, T0 + 365 * DAY)).toBe('fresh');
    expect(ageOf(T0, -3, T0 + 365 * DAY)).toBe('fresh');
    expect(ageOf(T0, Number.NaN, T0 + 365 * DAY)).toBe('fresh');
    expect(ageOf(T0, Number.POSITIVE_INFINITY, T0 + 365 * DAY)).toBe('fresh');
  });

  it('scales with shelfLifeDays — long-shelf items age slowly', () => {
    // Rice: 365 days. 200 days in → still fresh.
    expect(ageOf(T0, 365, T0 + 200 * DAY)).toBe('fresh');
    // 366 days in → faded.
    expect(ageOf(T0, 365, T0 + 366 * DAY)).toBe('faded');
    // 548 days in (1.5×) → still here prompt.
    expect(ageOf(T0, 365, T0 + 548 * DAY)).toBe('still_here_prompt');
    // 730 days in (2.0×) → archive.
    expect(ageOf(T0, 365, T0 + 730 * DAY)).toBe('should_archive');
  });

  it('handles fractional shelf-life days (e.g. lettuce 3.5d)', () => {
    expect(ageOf(T0, 3.5, T0 + 3 * DAY)).toBe('fresh');
    expect(ageOf(T0, 3.5, T0 + 4 * DAY)).toBe('faded');
    expect(ageOf(T0, 3.5, T0 + 5.5 * DAY)).toBe('still_here_prompt'); // 1.57×
    expect(ageOf(T0, 3.5, T0 + 7 * DAY)).toBe('should_archive'); // exactly 2×
  });
});
