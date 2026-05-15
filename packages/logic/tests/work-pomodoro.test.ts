/**
 * @ollie/logic · work · pomodoro break tracking tests (Phase 3 · feature 2)
 */

import { describe, it, expect } from 'vitest';
import {
  computePomodoroBreakState,
  DEFAULT_BLOCKS_PER_LONG_BREAK,
  COMPLETION_RATIO,
  type FocusLogEntry,
} from '../src/work';

// Fixed clock — noon on a fixed local day.
const NOW = new Date('2026-05-15T12:00:00').getTime();
const MIN = 60_000;

/** Build a fully-completed focus block (real time == planned time). */
function block(
  startOffsetMin: number,
  durationMin: 15 | 25 | 45 | 90 = 25,
): FocusLogEntry {
  return {
    ts: NOW - startOffsetMin * MIN,
    duration_min: durationMin,
    duration_ms: durationMin * MIN,
  };
}

describe('computePomodoroBreakState', () => {
  it('empty log → none earned, zero blocks', () => {
    const s = computePomodoroBreakState([], { now: NOW });
    expect(s.blocks_today).toBe(0);
    expect(s.blocks_in_cycle).toBe(0);
    expect(s.earned_break).toBe('none');
    expect(s.blocks_until_long_break).toBe(0);
    expect(s.last_block_ts).toBeNull();
    expect(s.blocks_per_long_break).toBe(DEFAULT_BLOCKS_PER_LONG_BREAK);
  });

  it('null / undefined log is handled as empty', () => {
    expect(computePomodoroBreakState(null, { now: NOW }).blocks_today).toBe(0);
    expect(computePomodoroBreakState(undefined, { now: NOW }).blocks_today).toBe(0);
  });

  it('one completed block → short break earned, 3 to go', () => {
    const s = computePomodoroBreakState([block(60)], { now: NOW });
    expect(s.blocks_today).toBe(1);
    expect(s.blocks_in_cycle).toBe(1);
    expect(s.earned_break).toBe('short');
    expect(s.blocks_until_long_break).toBe(3);
  });

  it('4 completed blocks → long break earned, cycle resets', () => {
    const log = [block(240), block(180), block(120), block(60)];
    const s = computePomodoroBreakState(log, { now: NOW });
    expect(s.blocks_today).toBe(4);
    expect(s.blocks_in_cycle).toBe(0);
    expect(s.earned_break).toBe('long');
    expect(s.blocks_until_long_break).toBe(0);
    expect(s.last_block_ts).toBe(NOW - 60 * MIN);
  });

  it('5 completed blocks → back to short, 3 until next long break', () => {
    const log = [block(300), block(240), block(180), block(120), block(60)];
    const s = computePomodoroBreakState(log, { now: NOW });
    expect(s.blocks_today).toBe(5);
    expect(s.blocks_in_cycle).toBe(1);
    expect(s.earned_break).toBe('short');
    expect(s.blocks_until_long_break).toBe(3);
  });

  it('a session stopped short of the completion ratio does not count', () => {
    const partial: FocusLogEntry = {
      ts: NOW - 30 * MIN,
      duration_min: 25,
      duration_ms: 10 * MIN, // only 10 of 25 min — below 0.9 threshold
    };
    const s = computePomodoroBreakState([partial], { now: NOW });
    expect(s.blocks_today).toBe(0);
    expect(s.earned_break).toBe('none');
  });

  it('a session at exactly the completion ratio counts', () => {
    const onThreshold: FocusLogEntry = {
      ts: NOW - 30 * MIN,
      duration_min: 25,
      duration_ms: 25 * MIN * COMPLETION_RATIO,
    };
    const s = computePomodoroBreakState([onThreshold], { now: NOW });
    expect(s.blocks_today).toBe(1);
  });

  it('legacy entries without duration_ms are treated as completed', () => {
    const legacy = {
      ts: NOW - 60 * MIN,
      duration_min: 25,
    } as unknown as FocusLogEntry;
    const s = computePomodoroBreakState([legacy], { now: NOW });
    expect(s.blocks_today).toBe(1);
  });

  it('blocks from a previous day do not count toward today', () => {
    const yesterday: FocusLogEntry = {
      ts: NOW - 26 * 60 * MIN, // 26h ago — previous calendar day
      duration_min: 25,
      duration_ms: 25 * MIN,
    };
    const s = computePomodoroBreakState([yesterday, block(60)], { now: NOW });
    expect(s.blocks_today).toBe(1);
  });

  it('future-dated entries are ignored', () => {
    const future: FocusLogEntry = {
      ts: NOW + 60 * MIN,
      duration_min: 25,
      duration_ms: 25 * MIN,
    };
    const s = computePomodoroBreakState([future, block(60)], { now: NOW });
    expect(s.blocks_today).toBe(1);
  });

  it('respects a custom blocksPerLongBreak cadence', () => {
    const log = [block(120), block(60)];
    const s = computePomodoroBreakState(log, { now: NOW, blocksPerLongBreak: 2 });
    expect(s.blocks_per_long_break).toBe(2);
    expect(s.earned_break).toBe('long');
    expect(s.blocks_until_long_break).toBe(0);
  });

  it('invalid cadence falls back to the default', () => {
    const s = computePomodoroBreakState([block(60)], {
      now: NOW,
      blocksPerLongBreak: 0,
    });
    expect(s.blocks_per_long_break).toBe(DEFAULT_BLOCKS_PER_LONG_BREAK);
  });

  it('respects a custom completionRatio', () => {
    const half: FocusLogEntry = {
      ts: NOW - 30 * MIN,
      duration_min: 25,
      duration_ms: 13 * MIN, // 52% of planned
    };
    const strict = computePomodoroBreakState([half], { now: NOW });
    expect(strict.blocks_today).toBe(0);
    const loose = computePomodoroBreakState([half], {
      now: NOW,
      completionRatio: 0.5,
    });
    expect(loose.blocks_today).toBe(1);
  });

  it('out-of-range completionRatio falls back to the default', () => {
    const partial: FocusLogEntry = {
      ts: NOW - 30 * MIN,
      duration_min: 25,
      duration_ms: 10 * MIN,
    };
    // ratio 2 is invalid → default 0.9 → still does not count
    const s = computePomodoroBreakState([partial], {
      now: NOW,
      completionRatio: 2,
    });
    expect(s.blocks_today).toBe(0);
  });

  it('last_block_ts tracks the most recent completed block, not log order', () => {
    // Out-of-order log: middle entry is the most recent.
    const log = [block(180), block(30), block(120)];
    const s = computePomodoroBreakState(log, { now: NOW });
    expect(s.last_block_ts).toBe(NOW - 30 * MIN);
  });
});
