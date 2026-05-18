/**
 * @ollie/logic · pets care-gaps
 *
 * computeCareGaps, computeTrustLevel, summarize.
 * Pure: no I/O, no clock reads.
 */

import type {
  Pet,
  CareLogEntry,
  SpeciesProfiles,
  CareGap,
  CareSeverity,
  TrustLevel,
  PetsSummary,
} from './types';
import { SEVERITY_LADDER } from './constants';

import { DAY_MS } from '../util';

/**
 * For every (pet × task) pair, compute how long since the last entry
 * and assign a severity tier.
 */
export function computeCareGaps(
  pets: Pet[] | undefined | null,
  careLog: CareLogEntry[] | undefined | null,
  speciesProfiles: SpeciesProfiles,
  now: number,
): CareGap[] {
  const out: CareGap[] = [];
  const petList = (pets ?? []).filter((p) => !p.archived);
  for (const pet of petList) {
    const profile = speciesProfiles[pet.species];
    if (!profile) continue;
    const adoptedAt = pet.adopted_at ?? pet.created_at ?? 0;
    const coldStart = adoptedAt > 0 && (now - adoptedAt) < 14 * DAY_MS;
    for (const [task, taskProfile] of Object.entries(profile.care_tasks)) {
      const entries = (careLog ?? []).filter(
        (e) => e.pet_id === pet.id && e.task === task,
      );
      const last = entries.length
        ? Math.max(...entries.map((e) => e.occurred_at))
        : null;
      const daysSince = last === null ? Infinity : (now - last) / DAY_MS;
      const cadence = taskProfile.cadence_days;
      const critical = taskProfile.critical_days;

      let severity: CareSeverity;
      if (daysSince <= cadence)             severity = 'ok';
      else if (daysSince <= cadence * 1.5)  severity = 'nudge';
      else if (daysSince <= critical)       severity = 'soft';
      else if (daysSince <= critical * 1.5) severity = 'firm';
      else                                  severity = 'concerned';

      if (coldStart) {
        const idx = SEVERITY_LADDER.indexOf(severity);
        if (idx > 0) severity = SEVERITY_LADDER[idx - 1] as CareSeverity;
      }

      out.push({
        pet_id: pet.id,
        task,
        last_occurred_at: last,
        days_since: daysSince === Infinity ? null : +daysSince.toFixed(2),
        severity,
        critical: daysSince >= critical,
      });
    }
  }
  return out;
}

/** v1 stub — returns a fixed stage-0 result. */
export function computeTrustLevel(): TrustLevel {
  return { stage: 0, progress: 0, stageName: 'getting acquainted' };
}

/** Aggregate care-gap state into a dashboard summary. */
export function summarize(
  pets: Pet[] | undefined | null,
  _careLog: CareLogEntry[] | undefined | null,
  _observations: unknown,
  careGaps: CareGap[] | undefined | null,
  _now: number,
): PetsSummary {
  const active = (pets ?? []).filter((p) => !p.archived);
  const n_pets = active.length;
  const gaps = (careGaps ?? []).filter((g) => g.severity !== 'ok');
  const n_gaps = gaps.length;
  const n_critical = gaps.filter(
    (g) => g.critical || g.severity === 'firm' || g.severity === 'concerned',
  ).length;
  const severityRank: Record<string, number> = {
    nudge: 1, soft: 2, firm: 3, concerned: 4,
  };
  let most: CareGap | null = null;
  for (const g of gaps) {
    if (
      !most ||
      (severityRank[g.severity] ?? 0) > (severityRank[most.severity] ?? 0) ||
      ((severityRank[g.severity] ?? 0) === (severityRank[most.severity] ?? 0) &&
        (g.days_since ?? 0) > (most.days_since ?? 0))
    ) {
      most = g;
    }
  }
  return {
    n_pets,
    n_gaps,
    n_critical,
    n_health_flags_pending: 0, // wired by orchestrator
    most_pressing: most
      ? { pet_id: most.pet_id, task: most.task, severity: most.severity }
      : null,
  };
}
