/**
 * @ollie/logic · cycle symptom-clustering
 *
 * Different shape from `correlateSymptom` (which takes ONE tag). These
 * helpers bucket free-text symptoms into canonical categories and surface
 * up to 2 strongest cycle-day clusters across ALL symptoms.
 */

import type { CycleRecord, SymptomEvent } from './types';
import { DAY_MS } from './constants';

export const SYMPTOM_BUCKETS: Record<string, RegExp> = {
  cramps: /cramp/,
  headaches: /headache|migraine/,
  bloating: /bloat/,
  acne: /acne|breakout|pimple/,
  fatigue: /tired|fatigue|exhaust|drained/,
  nausea: /nausea|queasy/,
  cravings: /crav/,
  'breast tenderness': /breast|chest (sore|tender)/,
  'back pain': /back (pain|ache|sore)|lower back/,
  'mood swings': /mood|irritab|angry|rage|anxious|anxiety|sad|weepy|cry/,
  'brain fog': /fog|can't focus|cant focus|cant think|brain fog|spacey/,
};

export function bucketSymptom(text: string | undefined | null): string | null {
  const t = (text || '').toLowerCase();
  for (const [bucket, re] of Object.entries(SYMPTOM_BUCKETS)) {
    if (re.test(t)) return bucket;
  }
  return null;
}

export interface CycleInsight {
  bucket: string;
  meanDay: number;
  stdev: string;
  uniqueCycles: number;
  totalCycles: number;
  hitRate: number;
  strength: number;
}

export function findCorrelations(
  symptomEvents: readonly SymptomEvent[] | undefined | null,
  cycles: readonly CycleRecord[] | undefined | null,
): CycleInsight[] {
  const starts = (cycles || [])
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);
  const events = symptomEvents || [];
  if (starts.length < 2 || events.length < 5) return [];
  const totalCycles = starts.length - 1;

  const buckets: Record<string, Array<{ day: number; cycleIdx: number }>> = {};
  for (const s of events) {
    if (!s || typeof s.ts !== 'number') continue;
    const bucket = bucketSymptom(s.text);
    if (!bucket) continue;
    let cycleIdx = -1;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= s.ts) cycleIdx = i;
      else break;
    }
    if (cycleIdx < 0 || cycleIdx >= starts.length - 1) continue;
    const cycleDay = Math.floor((s.ts - starts[cycleIdx]) / DAY_MS) + 1;
    (buckets[bucket] ||= []).push({ day: cycleDay, cycleIdx });
  }

  const insights: CycleInsight[] = [];
  for (const [bucket, entries] of Object.entries(buckets)) {
    if (entries.length < 5) continue;
    const days = entries.map((e) => e.day);
    const mean = days.reduce((a, b) => a + b, 0) / days.length;
    const stdev = Math.sqrt(days.reduce((s, d) => s + (d - mean) ** 2, 0) / days.length);
    if (stdev > 4.5) continue;
    const uniqueCycles = new Set(entries.map((e) => e.cycleIdx)).size;
    const hitRate = uniqueCycles / totalCycles;
    if (hitRate < 0.5) continue;
    insights.push({
      bucket,
      meanDay: Math.round(mean),
      stdev: stdev.toFixed(1),
      uniqueCycles,
      totalCycles,
      hitRate,
      strength: entries.length / (stdev + 1),
    });
  }
  insights.sort((a, b) => b.strength - a.strength);
  return insights.slice(0, 2);
}
