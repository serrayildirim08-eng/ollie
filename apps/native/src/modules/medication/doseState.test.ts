import { describe, it, expect } from 'vitest';
import { doseStateForIndex } from './doseState';

describe('doseStateForIndex', () => {
  const none = { taken: 0, skipped: 0, later: 0 };

  it('is due when nothing has happened', () => {
    expect(doseStateForIndex(0, none)).toBe('due');
    expect(doseStateForIndex(1, none)).toBe('due');
  });

  it('marks the earliest slots taken', () => {
    const c = { taken: 1, skipped: 0, later: 0 };
    expect(doseStateForIndex(0, c)).toBe('taken');
    expect(doseStateForIndex(1, c)).toBe('due');
  });

  it('orders taken → skipped → later → due', () => {
    const c = { taken: 1, skipped: 1, later: 1 };
    expect(doseStateForIndex(0, c)).toBe('taken');
    expect(doseStateForIndex(1, c)).toBe('skipped');
    expect(doseStateForIndex(2, c)).toBe('later');
    expect(doseStateForIndex(3, c)).toBe('due');
  });

  it('handles skip without taken', () => {
    const c = { taken: 0, skipped: 1, later: 0 };
    expect(doseStateForIndex(0, c)).toBe('skipped');
    expect(doseStateForIndex(1, c)).toBe('due');
  });
});
