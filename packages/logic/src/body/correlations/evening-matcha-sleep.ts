/**
 * @ollie/logic · body · evening-matcha → sleep correlator
 *
 * Subset of caffeine-sleep: matcha-source caffeine consumed after 17:00.
 * Reuses correlateCaffeineAndSleep + inferCaffeineFromTransactions.
 *
 * Sample ≥ 14 paired nights. Threshold |ρ| > 0.30.
 *
 * No I/O. No DOM.
 */

import {
  correlateCaffeineAndSleep,
  inferCaffeineFromTransactions,
  CAFFEINE_STANDARD_MG,
} from '../caffeine-sleep';
import type {
  CaffeineEntry,
  CaffeineSleepResult,
  CorrelateCaffeineSleepOpts,
} from '../caffeine-sleep';
import type { FinanceRecord } from '../../finance/types';
import type { BrainDumpEntry } from '../../finance/subscription-dormancy';
import type { SleepRecord } from '../../sleep/types';

const EVENING_HOUR_CUTOFF = 17;

export interface EveningMatchaSleepResult {
  correlation: number;
  sampleSize: number;
  copy: string;
  ts: number;
}

export interface CorrelateEveningMatchaOpts extends CorrelateCaffeineSleepOpts {
  eveningHourCutoff?: number;
  now?: number;
}

function filterMatchaEvening(
  entries: readonly CaffeineEntry[],
  hourCutoff: number,
): CaffeineEntry[] {
  const targetMg = CAFFEINE_STANDARD_MG.matcha ?? 70;
  const out: CaffeineEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e.consumedAt !== 'number') continue;
    if (Math.abs(e.amountMg - targetMg) > 10) continue;
    const date = new Date(e.consumedAt);
    const hod = date.getHours() + date.getMinutes() / 60;
    if (hod < hourCutoff) continue;
    out.push(e);
  }
  return out;
}

export function correlateEveningMatchaAndSleep(
  txns: readonly FinanceRecord[] | undefined | null,
  brainDumps: readonly BrainDumpEntry[] | undefined | null,
  sleep: readonly SleepRecord[] | undefined | null,
  opts?: CorrelateEveningMatchaOpts,
): EveningMatchaSleepResult {
  const now = opts?.now ?? Date.now();
  const hourCutoff = opts?.eveningHourCutoff ?? EVENING_HOUR_CUTOFF;

  if (!Array.isArray(txns) && !Array.isArray(brainDumps)) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }
  if (!Array.isArray(sleep) || sleep.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const allCaffeine = inferCaffeineFromTransactions(
    Array.isArray(txns) ? (txns as FinanceRecord[]) : [],
    Array.isArray(brainDumps) ? (brainDumps as BrainDumpEntry[]) : [],
  );

  const matchaEvening = filterMatchaEvening(allCaffeine, hourCutoff);
  if (matchaEvening.length === 0) {
    return { correlation: 0, sampleSize: 0, copy: '', ts: now };
  }

  const subResult: CaffeineSleepResult = correlateCaffeineAndSleep(
    matchaEvening,
    sleep as SleepRecord[],
    opts,
  );

  let copy = '';
  if (subResult.copy && subResult.threshold) {
    const weeks = Math.max(1, Math.round(subResult.sampleSize / 7));
    const weekLabel = weeks === 1 ? '1 week of data' : `${weeks} weeks of data`;
    copy = `evening matcha tracks with lower sleep quality for you · ${weekLabel}`;
  }

  return {
    correlation: subResult.correlation,
    sampleSize: subResult.sampleSize,
    copy,
    ts: now,
  };
}
