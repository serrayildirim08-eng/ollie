/**
 * @ollie/logic · cycle boundary detection
 *
 * Converts a chronological list of cycle items (started / ended events,
 * plus symptoms) into closed/open CycleRecords. The medical-impossibility
 * floor (MIN_CYCLE_DAYS) drops rage-tap / double-log artifacts that
 * survived the UI's 12h dedup window.
 */

import type { CycleItem, CycleRecord } from './types';
import { MIN_CYCLE_DAYS, DAY_MS } from './constants';

export function detectBoundaries(cycleItems: readonly CycleItem[] | undefined | null): CycleRecord[] {
  if (!Array.isArray(cycleItems) || cycleItems.length === 0) return [];

  const rawStarts = cycleItems
    .filter((i): i is CycleItem => !!i && i.action === 'started')
    .map((i) => i.ts)
    .sort((a, b) => a - b);

  const starts: number[] = [];
  for (const ts of rawStarts) {
    const last = starts[starts.length - 1];
    if (last === undefined || (ts - last) / DAY_MS >= MIN_CYCLE_DAYS) {
      starts.push(ts);
    }
  }

  const ends = cycleItems
    .filter((i): i is CycleItem => !!i && i.action === 'ended')
    .map((i) => i.ts)
    .sort((a, b) => a - b);

  const records: CycleRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const record: CycleRecord = { cycleStartTs: starts[i] };
    const nextStart = starts[i + 1];
    if (nextStart !== undefined) {
      record.cycleEndTs = nextStart;
      record.cycleLengthDays = Math.round((nextStart - starts[i]) / DAY_MS);
    }
    const periodEnd = ends.find((e) => e >= starts[i] && (nextStart === undefined || e < nextStart));
    if (periodEnd !== undefined) {
      record.periodLengthDays = Math.max(1, Math.round((periodEnd - starts[i]) / DAY_MS));
    }
    records.push(record);
  }
  return records;
}
