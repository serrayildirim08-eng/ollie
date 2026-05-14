/**
 * @ollie/logic · body · correlation registry
 *
 * Audit surprise (audits/AUDIT_body_v2.md, infra D): Spearman + Pearson
 * primitives ship in body/math.ts but no orchestrator pass ever runs them
 * across the user's cross-module data. caffeine-sleep landed in P3 as
 * the exemplar. This file is the registry that wires the rest.
 *
 * IMPORTANT: PENDING entries return `detected: false` + `copy: null`. We
 * NEVER fake math. Better to ship 3 real correlators than 6 fake ones.
 *
 * No I/O. No DOM.
 */

import {
  correlateCaffeineAndSleep,
  inferCaffeineFromTransactions,
} from './caffeine-sleep';
import { correlateLutealAndSpending } from './correlations/luteal-spending';
import { correlateWorkoutSkipAndMood } from './correlations/workout-skip-mood';
import { correlateWaterAndFocus } from './correlations/water-focus';
import { correlateSleepDebtAndHabits } from './correlations/sleep-debt-habits';
import { correlateEveningMatchaAndSleep } from './correlations/evening-matcha-sleep';

import type { FinanceRecord } from '../finance/types';
import type { BrainDumpEntry } from '../finance/subscription-dormancy';
import type { SleepRecord as SleepRecordCanonical } from '../sleep/types';
import type {
  Habit,
  DumpEntry,
  SleepRecord as HabitsSleepRecord,
} from '../habits/types';
import type { CycleRecord } from '../cycle/types';
import type { WaterEntry } from './types';

// ─── Public types ────────────────────────────────────────────────────────

export type CorrelationName =
  | 'caffeine_sleep'
  | 'luteal_spending'
  | 'workout_skip_mood'
  | 'water_focus'
  | 'sleep_debt_habits'
  | 'evening_matcha_sleep';

export interface CorrelationEntry {
  name: CorrelationName;
  threshold: number;
  minSampleSize: number;
  description: string;
  implemented: boolean;
  reason?: string;
}

export interface UserDataSnapshot {
  now: number;
  finance: readonly FinanceRecord[];
  brainDumps: readonly BrainDumpEntry[];
  dumps: readonly DumpEntry[];
  sleepRecords: readonly SleepRecordCanonical[];
  cycles: readonly CycleRecord[];
  habits: readonly Habit[];
  waterLog: readonly WaterEntry[];
  sleepTargetHours?: number;
}

export interface CorrelationRunResult {
  name: CorrelationName;
  correlation: number | null;
  sampleSize: number;
  copy: string | null;
  detected: boolean;
  implemented: boolean;
  ts: number;
}

// ─── Registry ────────────────────────────────────────────────────────────

export const CORRELATION_REGISTRY: readonly CorrelationEntry[] = [
  {
    name: 'caffeine_sleep',
    threshold: 0.30,
    minSampleSize: 14,
    description: 'caffeine timing → sleep quality',
    implemented: true,
  },
  {
    name: 'luteal_spending',
    threshold: 0.30,
    minSampleSize: 14,
    description: 'luteal phase day-index → daily outflow',
    implemented: true,
  },
  {
    name: 'workout_skip_mood',
    threshold: 0.25,
    minSampleSize: 10,
    description: 'workout skip → next-day overwhelmed-lexicon ratio',
    implemented: true,
  },
  {
    name: 'water_focus',
    threshold: 0.30,
    minSampleSize: 14,
    description: 'daily water cups → brain-dump clarity ratio (Option B proxy)',
    implemented: true,
  },
  {
    name: 'sleep_debt_habits',
    threshold: 0.30,
    minSampleSize: 14,
    description: 'rolling 7d sleep debt → daily habit completion pct',
    implemented: true,
  },
  {
    name: 'evening_matcha_sleep',
    threshold: 0.30,
    minSampleSize: 14,
    description: 'matcha consumed after 5pm → sleep quality',
    implemented: true,
  },
];

// ─── Snapshot helper ─────────────────────────────────────────────────────

export interface SnapshotStoreLike {
  get<T>(namespace: string, key: string, fallback?: T): T | undefined;
}

export function takeUserDataSnapshot(
  store: SnapshotStoreLike,
  now: number = Date.now(),
): UserDataSnapshot {
  const finance =
    store.get<FinanceRecord[]>('finance', 'records', []) ?? [];

  const dumpItems =
    store.get<Array<{ ts?: number; text?: string }>>('dump', 'items', []) ?? [];
  const brainDumps: BrainDumpEntry[] = [];
  for (const d of dumpItems) {
    if (!d || typeof d.ts !== 'number') continue;
    if (typeof d.text !== 'string') continue;
    brainDumps.push({ ts: d.ts, text: d.text });
  }

  const actionLog =
    store.get<Array<{ ts?: number; rawText?: string; undone?: boolean }>>(
      'shared',
      'actionLog',
      [],
    ) ?? [];
  const dumps: DumpEntry[] = [];
  for (const e of actionLog) {
    if (!e || e.undone) continue;
    if (typeof e.ts !== 'number') continue;
    if (typeof e.rawText !== 'string') continue;
    dumps.push({ ts: e.ts, rawText: e.rawText });
  }
  for (const d of dumpItems) {
    if (!d || typeof d.ts !== 'number') continue;
    if (typeof d.text !== 'string') continue;
    dumps.push({ ts: d.ts, text: d.text, rawText: d.text });
  }

  const sleepRecords =
    store.get<SleepRecordCanonical[]>('sleep', 'records', []) ?? [];
  const cycles = store.get<CycleRecord[]>('cycle', 'cycles', []) ?? [];
  const habits = store.get<Habit[]>('shared', 'habits_v2', []) ?? [];
  const waterLog = store.get<WaterEntry[]>('body', 'water_log', []) ?? [];

  const sleepSettings = store.get<{ target_hours?: number }>('sleep', 'settings', {});
  const sleepTargetHours =
    typeof sleepSettings?.target_hours === 'number' ? sleepSettings.target_hours : 7.5;

  return {
    now,
    finance,
    brainDumps,
    dumps,
    sleepRecords,
    cycles,
    habits,
    waterLog,
    sleepTargetHours,
  };
}

// ─── runAllCorrelations ──────────────────────────────────────────────────

function sleepCanonicalToHabits(records: readonly SleepRecordCanonical[]): HabitsSleepRecord[] {
  const out: HabitsSleepRecord[] = [];
  for (const r of records) {
    if (!r) continue;
    out.push({
      ts: r.created_at,
      night_of: r.night_of,
      tst_min: r.tst_min ?? undefined,
      is_skipped: r.is_skipped,
    });
  }
  return out;
}

export function runAllCorrelations(snapshot: UserDataSnapshot): CorrelationRunResult[] {
  const now = snapshot.now;
  const out: CorrelationRunResult[] = [];

  for (const entry of CORRELATION_REGISTRY) {
    if (!entry.implemented) {
      out.push({
        name: entry.name,
        correlation: null,
        sampleSize: 0,
        copy: null,
        detected: false,
        implemented: false,
        ts: now,
      });
      continue;
    }

    try {
      switch (entry.name) {
        case 'caffeine_sleep': {
          const caffeine = inferCaffeineFromTransactions(
            snapshot.finance as FinanceRecord[],
            snapshot.brainDumps as BrainDumpEntry[],
          );
          const r = correlateCaffeineAndSleep(
            caffeine,
            snapshot.sleepRecords as SleepRecordCanonical[],
            {
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        case 'luteal_spending': {
          const r = correlateLutealAndSpending(
            snapshot.cycles,
            snapshot.finance,
            {
              now,
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        case 'workout_skip_mood': {
          const r = correlateWorkoutSkipAndMood(
            snapshot.habits,
            snapshot.dumps,
            {
              now,
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        case 'sleep_debt_habits': {
          const r = correlateSleepDebtAndHabits(
            sleepCanonicalToHabits(snapshot.sleepRecords),
            snapshot.habits,
            {
              now,
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
              targetHours: snapshot.sleepTargetHours,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        case 'evening_matcha_sleep': {
          const r = correlateEveningMatchaAndSleep(
            snapshot.finance,
            snapshot.brainDumps,
            snapshot.sleepRecords,
            {
              now,
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        case 'water_focus': {
          const r = correlateWaterAndFocus(
            snapshot.waterLog,
            snapshot.dumps,
            {
              now,
              minSampleSize: entry.minSampleSize,
              thresholdRho: entry.threshold,
            },
          );
          out.push({
            name: entry.name,
            correlation: r.correlation,
            sampleSize: r.sampleSize,
            copy: r.copy || null,
            detected: !!r.copy,
            implemented: true,
            ts: now,
          });
          break;
        }
        default: {
          const _exhaustive: never = entry.name;
          void _exhaustive;
        }
      }
    } catch (err) {
      console.warn(
        '[body/correlations] correlator failed:',
        entry.name,
        err instanceof Error ? err.message : err,
      );
      out.push({
        name: entry.name,
        correlation: null,
        sampleSize: 0,
        copy: null,
        detected: false,
        implemented: entry.implemented,
        ts: now,
      });
    }
  }

  return out;
}
