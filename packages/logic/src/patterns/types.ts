/**
 * @ollie/logic/patterns · types
 */

import type { CycleRecord, SymptomEvent } from '../cycle/types';

export type { CycleRecord, SymptomEvent };

export interface SleepSession {
  ts: number;
  tstMinutes: number;
}

export interface FinanceTransaction {
  ts: number;
  amount?: number;
  category?: string;
  category_l1?: string;
}

export interface DumpEntry {
  ts: number;
  rawText?: string;
  text?: string;
}

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation window' | 'luteal';
export type Confidence = 'low' | 'medium' | 'high';

export interface DetectorOptions {
  lastEditedByCycle?: Record<number, number>;
  now?: number;
}

export interface BasePattern {
  id: string;
  copy: string;
  subcopy: string;
}

export interface SymptomInPhasePattern extends BasePattern {
  type: 'symptom_in_phase';
  cycles: number;
  meta: { tag: string; phase: CyclePhase; share: number; occurrences: number };
}

export interface SleepCycleLagPattern extends BasePattern {
  type: 'sleep_cycle_lag';
  cycles: number;
  meta: { meanDeltaMinutes: number; cyclesWithDrop: number; preWindowDays: number };
}

export interface FinanceCycleSpendPattern extends BasePattern {
  type: 'finance_cycle_spend';
  cycles: number;
  meta: {
    category: string;
    higherPhase: 'luteal' | 'follicular';
    deltaPct: number;
    dailyLuteal: number;
    dailyFoll: number;
    txnCount: number;
  };
}

export interface SleepMoodLagPattern extends BasePattern {
  type: 'sleep_mood_lag';
  pattern: 'sleep-mood-lag';
  confidence: Confidence;
  sample_n: number;
  date_range: { start: string; end: string };
  peak_lag_days: number;
  peak_rho: number;
  ci_90: [number, number];
  tag: 'tired';
  modules: ['sleep', 'journal'];
}

export type PatternResult =
  | SymptomInPhasePattern
  | SleepCycleLagPattern
  | FinanceCycleSpendPattern
  | SleepMoodLagPattern;
