/**
 * @ollie/logic · work · pomodoro break tracking (Phase 3 · feature 2)
 *
 * Cycle logic layered on top of the existing focus timer + work.focus_log.
 * Counts completed focus blocks in the current local day and works out
 * whether a short or long break is earned.
 *
 * Classic pomodoro cadence: a short break after each focus block, a
 * longer break after every Nth block (default 4). We do NOT prescribe
 * exact break minutes here — the UI owns copy + display. This module
 * only answers "where are you in the cycle, and what break is earned".
 *
 * Pure: inputs → outputs. No DOM, no store reads, no Date.now() inside
 * (the caller passes `now`).
 *
 * A "completed" block = a focus_log entry whose actual elapsed time
 * reached the COMPLETION_RATIO threshold of its planned duration. A
 * session stopped at 4 of 25 minutes is not a finished block and does
 * not advance the cycle.
 */

import type { FocusLogEntry } from './types';

/** Blocks per long-break cycle. Classic pomodoro = 4. */
export const DEFAULT_BLOCKS_PER_LONG_BREAK = 4;

/**
 * Fraction of the planned duration a session must reach to count as a
 * completed block. 0.9 ⇒ a 25-min block needs ≥ 22.5 real minutes.
 */
export const COMPLETION_RATIO = 0.9;

const MIN_MS = 60_000;

export interface PomodoroBreakOptions {
  /** ms epoch — defines "today" and bounds the scan. Required for determinism. */
  now: number;
  /** Override the long-break cadence (default 4). */
  blocksPerLongBreak?: number;
  /**
   * Override the completion threshold ratio (default 0.9). Clamped to
   * (0, 1]. Values outside the range fall back to COMPLETION_RATIO.
   */
  completionRatio?: number;
}

export interface PomodoroBreakState {
  /** Completed focus blocks logged in the local calendar day of `now`. */
  blocks_today: number;
  /**
   * Completed blocks since the last long break — i.e. blocks_today mod
   * blocksPerLongBreak. 0 immediately after a long break is earned.
   */
  blocks_in_cycle: number;
  /** Cadence in effect for this computation. */
  blocks_per_long_break: number;
  /**
   * 'long'  — the most recent completed block landed on the cadence
   *           boundary; a long break is earned now.
   * 'short' — at least one block done, not on the boundary.
   * 'none'  — no completed blocks today; nothing earned.
   */
  earned_break: 'none' | 'short' | 'long';
  /** Completed blocks still needed before the next long break is earned. */
  blocks_until_long_break: number;
  /** ms epoch of the most recent completed block's start, or null. */
  last_block_ts: number | null;
}

/** Local calendar-day key (YYYY-M-D). Mirrors orchestrator/work helper. */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * A focus_log entry counts as a completed block when its real elapsed
 * time reached `ratio` of the planned duration. Legacy rows that omit
 * `duration_ms` are treated as complete (the old timer only logged on
 * natural finish).
 */
function isCompletedBlock(e: FocusLogEntry, ratio: number): boolean {
  if (!e || typeof e.ts !== 'number') return false;
  if (typeof e.duration_min !== 'number' || e.duration_min <= 0) return false;
  if (typeof e.duration_ms !== 'number') return true; // legacy: logged only on finish
  const planned = e.duration_min * MIN_MS;
  return e.duration_ms >= planned * ratio;
}

/**
 * Derive the current pomodoro break state from the focus log.
 *
 * Only blocks started on the local calendar day of `now` count toward
 * the cycle — the cadence resets each day.
 */
export function computePomodoroBreakState(
  focusLog: FocusLogEntry[] | null | undefined,
  opts: PomodoroBreakOptions,
): PomodoroBreakState {
  const now = opts.now;
  const cadence =
    typeof opts.blocksPerLongBreak === 'number' && opts.blocksPerLongBreak >= 1
      ? Math.floor(opts.blocksPerLongBreak)
      : DEFAULT_BLOCKS_PER_LONG_BREAK;
  const ratio =
    typeof opts.completionRatio === 'number' &&
    opts.completionRatio > 0 &&
    opts.completionRatio <= 1
      ? opts.completionRatio
      : COMPLETION_RATIO;

  const todayKey = localDayKey(now);
  const log = Array.isArray(focusLog) ? focusLog : [];

  let blocksToday = 0;
  let lastBlockTs: number | null = null;
  for (const e of log) {
    if (!isCompletedBlock(e, ratio)) continue;
    if (e.ts > now) continue; // ignore future-dated rows
    if (localDayKey(e.ts) !== todayKey) continue;
    blocksToday += 1;
    if (lastBlockTs === null || e.ts > lastBlockTs) lastBlockTs = e.ts;
  }

  const blocksInCycle = blocksToday % cadence;

  let earnedBreak: PomodoroBreakState['earned_break'];
  if (blocksToday === 0) {
    earnedBreak = 'none';
  } else if (blocksInCycle === 0) {
    // Landed exactly on the cadence boundary ⇒ long break earned.
    earnedBreak = 'long';
  } else {
    earnedBreak = 'short';
  }

  // Blocks still needed before the next long break. 0 when one is
  // earned right now.
  const blocksUntilLongBreak = blocksInCycle === 0 ? 0 : cadence - blocksInCycle;

  return {
    blocks_today: blocksToday,
    blocks_in_cycle: blocksInCycle,
    blocks_per_long_break: cadence,
    earned_break: earnedBreak,
    blocks_until_long_break: blocksUntilLongBreak,
    last_block_ts: lastBlockTs,
  };
}
