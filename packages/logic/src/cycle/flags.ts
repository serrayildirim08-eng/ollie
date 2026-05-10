/**
 * @ollie/logic · cycle health flags
 *
 * Rule-based — never diagnostic. Each flag fires only when:
 *   - run_length ≥ 3 consecutive cycles match the rule (principle 2.12)
 *   - none of those cycles were edited in the last 72h (principle 2.17)
 *
 * Every flag carries a primary-research source URL (principle 2.16).
 *
 * `now` and `lastEditedByCycle` are explicit arguments so the function
 * stays pure.
 */

import type { CycleRecord, HealthFlag, SymptomEvent } from './types';
import { DAY_MS, HEALTH_FLAG_COOLDOWN_MS } from './constants';

const SEVERE_CRAMP_RE = /severe cramp|bad cramp|debilitating|worst cramp|terrible cramp|awful cramp/i;

export function detectHealthFlags(
  cycles: readonly CycleRecord[] | undefined | null,
  symptomEvents: readonly SymptomEvent[] | undefined | null,
  now: number = 0,
  lastEditedByCycle: Record<number, number> = {},
): HealthFlag[] {
  const safe = Array.isArray(cycles) ? cycles : [];
  const closed = safe.filter(
    (c): c is CycleRecord & { cycleLengthDays: number } =>
      !!c && typeof c.cycleLengthDays === 'number',
  );
  const flags: HealthFlag[] = [];
  if (closed.length < 3) return flags;

  const isRecentlyEdited = (cycle: CycleRecord): boolean => {
    const key = cycle.cycleStartTs;
    const edited = lastEditedByCycle[key];
    return edited !== undefined && now > 0 && now - edited < HEALTH_FLAG_COOLDOWN_MS;
  };

  const tailRun = <T extends CycleRecord>(arr: readonly T[], predicate: (c: T) => boolean): T[] => {
    const run: T[] = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (predicate(arr[i])) run.unshift(arr[i]);
      else break;
    }
    return run;
  };

  // long-cycles: 3+ consecutive ≥35d
  const longRun = tailRun(closed, (c) => c.cycleLengthDays >= 35);
  if (longRun.length >= 3 && !longRun.some(isRecentlyEdited)) {
    const lens = longRun.map((c) => c.cycleLengthDays).join(', ');
    flags.push({
      id: 'long-cycles',
      severity: 'medium',
      observation: `your last ${longRun.length} cycles have been ${lens} days.`,
      reference: 'ACOG defines consistently >35 days as oligomenorrhea.',
      suggestion: 'worth raising with a clinician next visit.',
      sources: ['https://www.acog.org/womens-health/faqs/abnormal-uterine-bleeding'],
    });
  }

  // short-cycles: 3+ consecutive <21d
  const shortRun = tailRun(closed, (c) => c.cycleLengthDays < 21);
  if (shortRun.length >= 3 && !shortRun.some(isRecentlyEdited)) {
    const lens = shortRun.map((c) => c.cycleLengthDays).join(', ');
    flags.push({
      id: 'short-cycles',
      severity: 'medium',
      observation: `your last ${shortRun.length} cycles have been ${lens} days.`,
      reference: 'ACOG reference range for cycle length is 21–35 days.',
      suggestion: 'worth raising with a clinician next visit.',
      sources: ['https://www.acog.org/womens-health/faqs/abnormal-uterine-bleeding'],
    });
  }

  // long-bleed: 3+ consecutive with periodLengthDays > 8
  const longBleedRun = tailRun(
    closed,
    (c) => typeof c.periodLengthDays === 'number' && c.periodLengthDays > 8,
  );
  if (longBleedRun.length >= 3 && !longBleedRun.some(isRecentlyEdited)) {
    const days = longBleedRun.map((c) => c.periodLengthDays).join(', ');
    flags.push({
      id: 'long-bleed',
      severity: 'low',
      observation: `your last ${longBleedRun.length} periods lasted ${days} days.`,
      reference: 'bleeding longer than 7–8 days is considered prolonged menstruation (menorrhagia).',
      suggestion: 'worth raising with a clinician if the pattern continues.',
      sources: ['https://www.acog.org/womens-health/faqs/heavy-menstrual-bleeding'],
    });
  }

  // amenorrhea: no period for 90+ days
  const lastClose = closed[closed.length - 1];
  const lastStart = lastClose?.cycleEndTs ?? null;
  if (now > 0 && lastStart !== null && now - lastStart >= 90 * DAY_MS) {
    flags.push({
      id: 'amenorrhea',
      severity: 'medium',
      observation: `it has been ${Math.floor((now - lastStart) / DAY_MS)} days since your last period.`,
      reference:
        'ACOG defines secondary amenorrhea as the absence of menstruation for 3+ months after a prior cyclic pattern.',
      suggestion: 'worth raising with a clinician.',
      sources: ['https://www.acog.org/womens-health/faqs/amenorrhea'],
    });
  }

  // dysmenorrhea: severe cramps in 3+ consecutive cycles
  const severeCycleIdxs = new Set<number>();
  for (const e of symptomEvents || []) {
    if (!e || typeof e.ts !== 'number' || !SEVERE_CRAMP_RE.test(e.text || '')) continue;
    for (let i = 0; i < closed.length; i++) {
      const s = closed[i].cycleStartTs;
      const endTs = closed[i].cycleEndTs;
      if (s <= e.ts && (endTs === undefined || endTs > e.ts)) {
        severeCycleIdxs.add(i);
        break;
      }
    }
  }
  const orderedSevere = [...severeCycleIdxs].sort((a, b) => a - b);
  let dysmRun = 0;
  for (let i = orderedSevere.length - 1; i >= 0; i--) {
    if (i === orderedSevere.length - 1 || orderedSevere[i + 1] - orderedSevere[i] === 1) dysmRun++;
    else break;
  }
  if (dysmRun >= 3) {
    const affected = orderedSevere.slice(-dysmRun).map((i) => closed[i]);
    if (!affected.some(isRecentlyEdited)) {
      flags.push({
        id: 'dysmenorrhea',
        severity: 'low',
        observation: `you've logged severe cramps in ${dysmRun} consecutive cycles.`,
        reference:
          'dysmenorrhea that regularly interrupts daily life is common but not inevitable, and can have treatable underlying causes.',
        suggestion: 'worth raising with a clinician.',
        sources: ['https://www.acog.org/womens-health/faqs/dysmenorrhea-painful-periods'],
      });
    }
  }

  return flags;
}
