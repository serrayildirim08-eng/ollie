/**
 * @ollie/logic · cycle syndrome-pattern detection
 *
 * Separate from cycle/flags (which fires per-cycle run-length flags
 * — long-cycles, short-cycles, etc.). This detector aggregates across
 * the user's full cycle + symptom history and surfaces *syndrome*
 * patterns: PCOS, endometriosis, PMDD, missed periods, unusual bleeding.
 *
 * Never diagnostic. Each flag explicitly says "not a diagnosis" and
 * points to a clinician conversation.
 *
 * Like cycle/flags, `now` is an explicit argument to stay pure.
 */

import type { CycleRecord, SymptomEvent } from './types';
import { DAY_MS } from './constants';

export type SyndromeKey =
  | 'missed-period'
  | 'irregular'
  | 'pcos-pattern'
  | 'endo-pattern'
  | 'pmdd-pattern'
  | 'unusual-bleeding';

export type SyndromeSeverity = 'watch' | 'discuss';

export interface SyndromeFlag {
  key: SyndromeKey;
  severity: SyndromeSeverity;
  title: string;
  body: string;
  evidence: string[];
}

export function detectSyndromePatterns(
  cycles: readonly CycleRecord[] | undefined | null,
  symptomEvents: readonly SymptomEvent[] | undefined | null,
  now: number,
): SyndromeFlag[] {
  const flags: SyndromeFlag[] = [];
  const starts = (cycles || [])
    .map((c) => c?.cycleStartTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b);
  if (starts.length === 0) return flags;
  const events = symptomEvents || [];

  const lastStart = starts[starts.length - 1];
  const daysSinceLast = Math.floor((now - lastStart) / DAY_MS);

  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    gaps.push(Math.round((starts[i] - starts[i - 1]) / DAY_MS));
  }
  const recent = gaps.slice(-6);

  if (daysSinceLast >= 45) {
    flags.push({
      key: 'missed-period',
      severity: 'watch',
      title: "period hasn't started yet",
      body: `it's been ${daysSinceLast} days since your last period. a 45+ day gap is worth noting — could be normal for you, could be worth a clinician visit.`,
      evidence: [
        `last period: ${new Date(lastStart).toLocaleDateString()}`,
        `days since: ${daysSinceLast}`,
      ],
    });
  }

  if (recent.length >= 3) {
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const stdev = Math.sqrt(recent.reduce((s, x) => s + (x - mean) ** 2, 0) / recent.length);
    const outOfRange = recent.filter((g) => g < 21 || g > 35).length;
    if (stdev > 9 || outOfRange >= 2) {
      flags.push({
        key: 'irregular',
        severity: 'watch',
        title: 'your cycles vary a lot',
        body: `cycle length has ranged from ${Math.min(...recent)} to ${Math.max(...recent)} days. normal is 21–35. not a diagnosis — just something to mention to a clinician.`,
        evidence: [`last ${recent.length} cycles: ${recent.join(', ')}d`, `stdev: ${stdev.toFixed(1)}d`],
      });
    }
  }

  const findCycle = (ts: number): number => {
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= ts && (i === starts.length - 1 || starts[i + 1] > ts)) return i;
    }
    return -1;
  };

  // PCOS
  const pcosSig: string[] = [];
  const longCycles = gaps.filter((g) => g > 40).length;
  if (longCycles >= 2) pcosSig.push(`${longCycles} cycles longer than 40 days`);
  if (daysSinceLast > 45) pcosSig.push('currently overdue for period');
  const acneCount = events.filter((s) => /acne|breakout|pimple/i.test(s.text || '')).length;
  if (acneCount >= 5) pcosSig.push(`acne logged ${acneCount} times`);
  const hairCount = events.filter((s) =>
    /hair (thin|loss|fall|growth)|facial hair|body hair/i.test(s.text || ''),
  ).length;
  if (hairCount >= 2) pcosSig.push('hair changes logged');
  const weightCount = events.filter((s) => /weight (gain|loss|fluctu)/i.test(s.text || '')).length;
  if (weightCount >= 2) pcosSig.push('weight fluctuations logged');
  if (pcosSig.length >= 3) {
    flags.push({
      key: 'pcos-pattern',
      severity: 'discuss',
      title: 'some patterns look similar to pcos',
      body: 'several signals in your data match what pcos can look like. this is not a diagnosis — pcos needs bloodwork and clinical evaluation. worth bringing to a doctor.',
      evidence: pcosSig,
    });
  }

  // Endometriosis
  const endoSig: string[] = [];
  const severeCrampCycles = new Set<number>();
  for (const s of events) {
    if (
      typeof s.ts === 'number' &&
      /severe cramp|bad cramp|terrible cramp|awful cramp|worst cramp|debilitating/i.test(s.text || '')
    ) {
      const idx = findCycle(s.ts);
      if (idx >= 0) severeCrampCycles.add(idx);
    }
  }
  if (severeCrampCycles.size >= 3) endoSig.push(`severe cramps across ${severeCrampCycles.size} cycles`);
  if (events.some((s) => /pain (during|with) sex|painful sex|dyspareunia/i.test(s.text || '')))
    endoSig.push('pain with sex logged');
  if (events.some((s) => /pain (during|with) (bowel|pooping)|painful bowel/i.test(s.text || '')))
    endoSig.push('pain with bowel movements');
  if (events.filter((s) => /pelvic pain|pelvis pain/i.test(s.text || '')).length >= 2)
    endoSig.push('pelvic pain outside period');
  if (events.filter((s) => /diarrhea|constipation|nausea|bloat/i.test(s.text || '')).length >= 5)
    endoSig.push('GI symptoms cluster');
  if (endoSig.length >= 3) {
    flags.push({
      key: 'endo-pattern',
      severity: 'discuss',
      title: 'some patterns look similar to endometriosis',
      body: 'several signals match patterns often seen with endometriosis. this is not a diagnosis — endo can only be confirmed through imaging or laparoscopy. worth bringing to a clinician.',
      evidence: endoSig,
    });
  }

  // PMDD
  const pmddCycles = new Set<number>();
  const severeMoodRe = /hopeless|rage|suicidal|can'?t cope|panic attack|overwhelming rage|crying uncontrollably/i;
  for (const s of events) {
    if (typeof s.ts !== 'number' || !severeMoodRe.test(s.text || '')) continue;
    const idx = findCycle(s.ts);
    if (idx < 0 || idx >= starts.length - 1) continue;
    const daysBeforeNext = Math.round((starts[idx + 1] - s.ts) / DAY_MS);
    if (daysBeforeNext <= 7 && daysBeforeNext >= 0) pmddCycles.add(idx);
  }
  if (pmddCycles.size >= 3) {
    flags.push({
      key: 'pmdd-pattern',
      severity: 'discuss',
      title: 'severe mood symptoms cluster before your period',
      body: "you've logged severe mood symptoms in the late luteal phase across multiple cycles. this pattern can be pmdd — treatable, often missed. worth a clinician conversation.",
      evidence: [`${pmddCycles.size} cycles with severe late-luteal mood symptoms`],
    });
  }

  // Unusual bleeding
  const breakthroughCount = events.filter((s) =>
    /spotting|breakthrough|between period|mid.?cycle bleed/i.test(s.text || ''),
  ).length;
  const heavyClotCount = events.filter((s) =>
    /heavy (flow|bleed)|clot|soaking/i.test(s.text || ''),
  ).length;
  if (breakthroughCount >= 3 || heavyClotCount >= 2) {
    const sig: string[] = [];
    if (breakthroughCount >= 3) sig.push(`breakthrough/spotting logged ${breakthroughCount} times`);
    if (heavyClotCount >= 2) sig.push(`heavy flow/clots logged ${heavyClotCount} times`);
    flags.push({
      key: 'unusual-bleeding',
      severity: 'watch',
      title: 'some unusual bleeding patterns',
      body: 'breakthrough bleeding, spotting between periods, or consistently heavy flow with clots can have several causes. worth checking with a clinician.',
      evidence: sig,
    });
  }

  return flags;
}
