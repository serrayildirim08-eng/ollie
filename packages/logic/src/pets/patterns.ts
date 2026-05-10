/**
 * @ollie/logic · pets behavioral pattern detectors (P1–P5)
 *
 * Spec: research/pets-module-research-2026-05-07.md
 * Mirrors tools/pets_patterns.js — keep behavior identical.
 *
 *   P1 vet-adherence delay       (Lue 2008 JAVMA)
 *   P2 pet-as-co-regulator       (Allen 2002 Psychosomatic Medicine)
 *   P3 care-task activation barrier (Steel 2007 Psych Bull)
 *   P4 schedule lapse during ef crash (Barkley 2012 Guilford)
 *   P5 anthropomorphic projection (Topál 2009 Science)
 *
 * Pure: no I/O, no window.* globals, no clock reads (now is always explicit).
 * Consent gate is a plain boolean in opts — caller resolves from store.
 */

import type {
  PetsState,
  PatternOpts,
  VetScheduleItem,
  VetCueSchedule,
  VetCue,
  VetAdherenceDelayPattern,
  CoRegulatorPattern,
  CareActivationBarrierPattern,
  CrashContextMissesPattern,
  ProjectionMatchPattern,
  ProjectionPatternResult,
  AnyPattern,
  HabitsState,
  SpeciesProfiles,
} from './types';
import { DAY, HOUR, VET_CUE_OFFSETS_DAYS, DEFAULT_EVENT_SUGGESTIONS, PROJECTION_RE } from './constants';

// ─── Consent helper ───────────────────────────────────────────────────

function consentOn(opts: PatternOpts): boolean {
  if (opts && typeof opts.consent === 'boolean') return opts.consent;
  return true; // default-on when consent layer absent
}

// ─── P1 helpers ────────────────────────────────────────────────────────

function suggestLinkedEvent(habitsState: HabitsState | undefined | null): string {
  if (habitsState && Array.isArray(habitsState.habits) && habitsState.habits.length > 0) {
    for (const h of habitsState.habits) {
      if (!h) continue;
      if (typeof h.external_cue === 'string' && h.external_cue.trim().length > 0)
        return 'after ' + h.external_cue.trim();
      if (typeof h.name === 'string' && h.name.trim().length > 0)
        return 'after ' + h.name.trim();
    }
  }
  return DEFAULT_EVENT_SUGGESTIONS[0];
}

function vetCueAction(
  d: number,
  kind: string,
): { next_action: string; copy: string } {
  const k = kind.trim() || 'vet visit';
  if (d === 14)
    return {
      next_action: 'put a hold on the calendar for the ' + k + '. one minute, then close it.',
      copy: k + ' due in two weeks. holding the slot first costs less than booking later.',
    };
  if (d === 3)
    return {
      next_action: 'confirm or rebook the ' + k + ' slot.',
      copy: k + ' coming up in 3 days. confirming or moving it now is cheaper than the day-of scramble.',
    };
  if (d === 0)
    return {
      next_action: 'go, or rebook today.',
      copy: k + ' day. going or rebooking are both fine — staying suspended is the expensive option.',
    };
  return {
    next_action: 'one move toward the ' + k + '.',
    copy: k + ' approaching. one move today.',
  };
}

// ─── P1 — vet-cue schedule ────────────────────────────────────────────

export function scheduleVetCues(
  item: VetScheduleItem,
  opts: PatternOpts = {},
): VetCueSchedule | null {
  if (!consentOn(opts)) return null;
  if (!item || typeof item !== 'object') return null;
  if (typeof item.cadence_days !== 'number' || item.cadence_days <= 0) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const anchor =
    typeof item.last_completed_at === 'number'
      ? item.last_completed_at
      : typeof item.created_at === 'number'
        ? item.created_at
        : now;
  const dueAt = anchor + item.cadence_days * DAY;
  const suggested =
    typeof item.linked_event === 'string' && item.linked_event.trim().length > 0
      ? item.linked_event.trim()
      : suggestLinkedEvent(opts.habitsState);
  const kind = typeof item.kind === 'string' ? item.kind : 'annual';
  const cues: VetCue[] = (VET_CUE_OFFSETS_DAYS as readonly number[]).map((d) => {
    const action = vetCueAction(d, kind);
    return {
      offset_days: -d,
      stage: d + 'd',
      at: dueAt - d * DAY,
      linked_event: suggested,
      next_action: action.next_action,
      copy: action.copy,
    };
  });
  return {
    pattern: 'vet-cues',
    vet_id: item.id ?? null,
    pet_id: item.pet_id ?? null,
    kind,
    due_at: dueAt,
    suggested_event: suggested,
    cues,
    source: {
      citation: 'Lue, Pantenburg & Crawford 2008, JAVMA — owner-pet and client-veterinarian bond on care',
      url: 'https://doi.org/10.2460/javma.232.4.531',
    },
  };
}

// ─── P1 — vet adherence delay ─────────────────────────────────────────

export function detectVetAdherenceDelay(
  state: PetsState,
  opts: PatternOpts = {},
): VetAdherenceDelayPattern[] {
  if (!consentOn(opts)) return [];
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const minRunLength = typeof opts.minRunLength === 'number' ? opts.minRunLength : 3;
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 72 * HOUR;
  const lastSurfaced =
    opts.lastSurfacedAt && typeof opts.lastSurfacedAt === 'object' && !('valueOf' in (opts.lastSurfacedAt as object) && typeof opts.lastSurfacedAt === 'number')
      ? (opts.lastSurfacedAt as Record<string, number>)
      : {};
  const items = Array.isArray(state?.vet_schedule) ? state.vet_schedule : [];
  const out: VetAdherenceDelayPattern[] = [];
  for (const v of items) {
    if (!v || typeof v.cadence_days !== 'number' || v.cadence_days <= 0) continue;
    const anchor =
      typeof v.last_completed_at === 'number'
        ? v.last_completed_at
        : typeof v.created_at === 'number'
          ? v.created_at
          : null;
    if (anchor === null) continue;
    const dueAt = anchor + v.cadence_days * DAY;
    if (now < dueAt + v.cadence_days * DAY * 0.5) continue;
    const cuesPassed = Array.isArray(v.cues)
      ? v.cues.filter((c) => c && typeof c.at === 'number' && c.at <= now).length
      : 0;
    const runLength = cuesPassed + 1;
    if (runLength < minRunLength) continue;
    const last = typeof lastSurfaced === 'object' ? (lastSurfaced as Record<string, number>)[v.id ?? ''] ?? 0 : 0;
    if (last && now - last < cooldownMs) continue;
    const daysOverdue = Math.floor((now - dueAt) / DAY);
    const kind = typeof v.kind === 'string' ? v.kind : 'vet visit';
    out.push({
      pattern: 'vet-adherence-delay',
      vet_id: v.id,
      pet_id: v.pet_id ?? null,
      kind,
      days_overdue: daysOverdue,
      run_length: runLength,
      confidence: runLength >= 4 ? 'high' : 'medium',
      copy:
        kind +
        ' is ' +
        daysOverdue +
        ' days past cadence. vet care runs on time-cued reminders. yours runs on event-cued ones. that is not avoidance — it is how time-blind brains route around time.',
      next_action:
        'pick one event already in your day to anchor a 60-second booking call to.',
      source: {
        citation:
          'Lue, Pantenburg & Crawford 2008, JAVMA — owner-pet and client-veterinarian bond on care',
        url: 'https://doi.org/10.2460/javma.232.4.531',
      },
    });
  }
  return out;
}

// ─── P2 — co-regulator ────────────────────────────────────────────────

export function detectCoRegulator(
  state: PetsState,
  opts: PatternOpts = {},
): CoRegulatorPattern | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 30;
  const minTagged = typeof opts.minTagged === 'number' ? opts.minTagged : 10;
  const minLift = typeof opts.minLift === 'number' ? opts.minLift : 1.3;
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 72 * HOUR;
  if (
    typeof opts.lastSurfacedAt === 'number' &&
    opts.lastSurfacedAt > 0 &&
    now - opts.lastSurfacedAt < cooldownMs
  )
    return null;
  const log = Array.isArray(state?.coregulation_log) ? state.coregulation_log : [];
  const windowStart = now - windowDays * DAY;
  const inWindow = log.filter(
    (e) =>
      e &&
      typeof e.ts === 'number' &&
      e.ts >= windowStart &&
      e.ts <= now &&
      (e.sentiment === 'calm' || e.sentiment === 'neutral' || e.sentiment === 'agitated'),
  );
  const calmWithPet = inWindow.filter(
    (e) => e.pet_present && (e.sentiment === 'calm' || e.sentiment === 'neutral'),
  ).length;
  const totalWithPet = inWindow.filter((e) => e.pet_present).length;
  const calmNoPet = inWindow.filter(
    (e) => !e.pet_present && (e.sentiment === 'calm' || e.sentiment === 'neutral'),
  ).length;
  const totalNoPet = inWindow.filter((e) => !e.pet_present).length;
  if (totalWithPet < minTagged) return null;
  const ratioWith = calmWithPet / totalWithPet;
  const ratioNo = totalNoPet > 0 ? calmNoPet / totalNoPet : 0;
  if (ratioNo === 0) return null;
  const lift = ratioWith / ratioNo;
  if (lift < minLift) return null;
  const counts: Record<string, number> = Object.create(null);
  for (const e of inWindow) {
    if (!e.pet_present || !(e.sentiment === 'calm' || e.sentiment === 'neutral')) continue;
    if (!e.pet_id) continue;
    counts[e.pet_id] = (counts[e.pet_id] ?? 0) + 1;
  }
  let topPetId: string | null = null,
    topCount = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] > topCount) {
      topCount = counts[k];
      topPetId = k;
    }
  }
  return {
    pattern: 'pet-co-regulator',
    pet_id: topPetId,
    sample_n: totalWithPet,
    calm_with_pet: calmWithPet,
    calm_without_pet: calmNoPet,
    lift: Math.round(lift * 10) / 10,
    confidence: lift >= 1.6 ? 'high' : 'medium',
    copy:
      'in the last ' +
      windowDays +
      ' days, your calmer dumps landed alongside the pet ' +
      Math.round(lift * 10) / 10 +
      'x more often than without. regulation outside the body costs less than regulation inside it. pattern, not advice.',
    source: {
      citation:
        'Allen, Blascovich & Mendes 2002, Psychosomatic Medicine — cardiovascular reactivity with pets, friends, spouses',
      url: 'https://doi.org/10.1097/01.psy.0000024236.11538.41',
    },
  };
}

// ─── P3 — care-task activation barrier ───────────────────────────────

export function detectCareActivationBarrier(
  state: PetsState,
  opts: PatternOpts = {},
): CareActivationBarrierPattern[] {
  if (!consentOn(opts)) return [];
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 72 * HOUR;
  const minRunLength = typeof opts.minRunLength === 'number' ? opts.minRunLength : 3;
  const speciesProfiles: SpeciesProfiles | null =
    opts.speciesProfiles && typeof opts.speciesProfiles === 'object'
      ? opts.speciesProfiles
      : null;
  const lastSurfaced =
    opts.lastSurfacedAt && typeof opts.lastSurfacedAt === 'object' && !('valueOf' in (opts.lastSurfacedAt as object) && typeof opts.lastSurfacedAt === 'number')
      ? (opts.lastSurfacedAt as Record<string, number>)
      : {};
  const pets = Array.isArray(state?.pets) ? state.pets : [];
  const careLog = Array.isArray(state?.care_log) ? state.care_log : [];
  const microSteps = Array.isArray(state?.micro_steps) ? state.micro_steps : [];
  if (!speciesProfiles) return [];
  const out: CareActivationBarrierPattern[] = [];
  for (const pet of pets) {
    if (!pet || pet.archived) continue;
    const profile = speciesProfiles[pet.species];
    if (!profile?.care_tasks) continue;
    for (const taskKey of Object.keys(profile.care_tasks)) {
      const task = profile.care_tasks[taskKey];
      if (!task || typeof task.cadence_days !== 'number' || task.cadence_days <= 0)
        continue;
      const lastDone = careLog
        .filter(
          (e) =>
            e &&
            e.pet_id === pet.id &&
            e.task === taskKey &&
            typeof e.occurred_at === 'number',
        )
        .reduce((acc, e) => Math.max(acc, e.occurred_at), 0);
      if (lastDone === 0) continue;
      const daysSince = (now - lastDone) / DAY;
      const missedCycles = Math.floor(daysSince / task.cadence_days);
      if (missedCycles < 2) continue;
      const runLength = missedCycles + 1;
      if (runLength < minRunLength) continue;
      const hasMicro = microSteps.some(
        (m) =>
          m &&
          m.pet_id === pet.id &&
          m.task === taskKey &&
          typeof m.micro_step === 'string' &&
          m.micro_step.length > 0,
      );
      if (hasMicro) continue;
      const cdKey = pet.id + ':' + taskKey;
      const last = (lastSurfaced as Record<string, number>)[cdKey] ?? 0;
      if (last && now - last < cooldownMs) continue;
      out.push({
        pattern: 'care-activation-barrier',
        pet_id: pet.id,
        task: taskKey,
        days_since: Math.floor(daysSince),
        run_length: runLength,
        cadence_days: task.cadence_days,
        prompt: 'what is the 30-second first move on this one?',
        copy:
          'starting is the most expensive minute of ' +
          taskKey.replace(/_/g, ' ') +
          ' day. once moving, the cost falls. naming the smallest move is chemistry, not softness.',
        source: {
          citation: 'Steel 2007, Psychological Bulletin — meta-analysis of procrastination',
          url: 'https://doi.org/10.1037/0033-2909.133.1.65',
        },
      });
    }
  }
  return out;
}

// ─── P4 — crash-context misses ────────────────────────────────────────

export function detectCrashContextMisses(
  state: PetsState,
  opts: PatternOpts = {},
): CrashContextMissesPattern | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 60;
  const joinWindowMs = typeof opts.joinWindowMs === 'number' ? opts.joinWindowMs : 72 * HOUR;
  const minRunLength = typeof opts.minRunLength === 'number' ? opts.minRunLength : 3;
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 72 * HOUR;
  if (
    typeof opts.lastSurfacedAt === 'number' &&
    opts.lastSurfacedAt > 0 &&
    now - opts.lastSurfacedAt < cooldownMs
  )
    return null;
  const windowStart = now - windowDays * DAY;
  const misses = (Array.isArray(state?.miss_log) ? state.miss_log : []).filter(
    (m) => m && typeof m.ts === 'number' && m.ts >= windowStart && m.ts <= now,
  );
  if (misses.length === 0) return null;
  const crashLog = Array.isArray(opts.workCrashLog) ? opts.workCrashLog : [];
  const sleepEvents = Array.isArray(opts.bodySleepDebtEvents) ? opts.bodySleepDebtEvents : [];
  const lutealMarkers = Array.isArray(opts.cycleLutealMarkers) ? opts.cycleLutealMarkers : [];
  const isCrashTs = (ts: number) =>
    crashLog.some(
      (c) => c && typeof c.ts === 'number' && c.reply === 'yes' && Math.abs(ts - c.ts) <= joinWindowMs,
    );
  const isSleepDebtTs = (ts: number) =>
    sleepEvents.some(
      (e) => e && typeof e.ts === 'number' && Math.abs(ts - e.ts) <= joinWindowMs,
    );
  const isLutealTs = (ts: number) =>
    lutealMarkers.some(
      (m) => m && typeof m.ts === 'number' && Math.abs(ts - m.ts) <= joinWindowMs,
    );
  const taggedMisses: Array<{
    ts: number;
    pet_id?: string;
    task?: string;
    crash_kinds: string[];
  }> = [];
  for (const m of misses) {
    const kinds: string[] = [];
    if (isCrashTs(m.ts)) kinds.push('hyperfocus_crash');
    if (isSleepDebtTs(m.ts)) kinds.push('sleep_debt');
    if (isLutealTs(m.ts)) kinds.push('luteal');
    if (kinds.length > 0) taggedMisses.push({ ts: m.ts, pet_id: m.pet_id, task: m.task, crash_kinds: kinds });
  }
  if (taggedMisses.length < minRunLength) return null;
  const totalMisses = misses.length;
  const ratio = taggedMisses.length / totalMisses;
  return {
    pattern: 'crash-context-misses',
    sample_n: totalMisses,
    crash_tagged_n: taggedMisses.length,
    ratio: Math.round(ratio * 100) / 100,
    run_length: taggedMisses.length,
    confidence: taggedMisses.length >= 5 ? 'high' : 'medium',
    copy:
      'your last ' +
      taggedMisses.length +
      ' care misses landed on days you also flagged a crash, sleep debt, or luteal day. pet care does not break first because pets matter least — it breaks first because it is the most goal-directed task in the day.',
    suggestion:
      'optional: turn on low-ef mode on those days — smaller micro-step + permission to skip optional items.',
    source: {
      citation: 'Barkley 2012, Executive Functions — self-directed action across time (Guilford Press)',
      url: 'https://www.guilford.com/books/Executive-Functions/Russell-Barkley/9781462505357',
    },
  };
}

// ─── P5 — projection match (single dump) ─────────────────────────────

export function matchProjectionInDump(
  text: string,
  opts: PatternOpts = {},
): ProjectionMatchPattern | null {
  if (!consentOn(opts)) return null;
  if (typeof text !== 'string' || !text.trim()) return null;
  const m = PROJECTION_RE.exec(text);
  if (!m) return null;
  const matchedTerm = m[0];
  const start = Math.max(0, m.index - 30);
  const end = Math.min(text.length, m.index + matchedTerm.length + 30);
  const snippet = text.slice(start, end).trim();
  return {
    pattern: 'projection-mirror',
    matched_term: matchedTerm,
    snippet,
    copy: 'pets run on present cues, not grudges. the brain that loves hard reads rejection where there is not any — that is a sensitivity, not a flaw.',
    source: {
      citation:
        'Topál, Gergely, Erdőhegyi, Csibra & Miklósi 2009, Science — differential sensitivity in dogs, wolves, infants',
      url: 'https://doi.org/10.1126/science.1176960',
    },
  };
}

// ─── P5 — projection pattern (log-based) ─────────────────────────────

export function detectProjectionPattern(
  state: PetsState,
  opts: PatternOpts = {},
): ProjectionPatternResult | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 30;
  const minMatches = typeof opts.minRunLength === 'number' ? opts.minRunLength : 4;
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 72 * HOUR;
  if (
    typeof opts.lastSurfacedAt === 'number' &&
    opts.lastSurfacedAt > 0 &&
    now - opts.lastSurfacedAt < cooldownMs
  )
    return null;
  const log = Array.isArray(state?.projection_log) ? state.projection_log : [];
  const windowStart = now - windowDays * DAY;
  const inWindow = log.filter(
    (e) => e && typeof e.ts === 'number' && e.ts >= windowStart && e.ts <= now,
  );
  if (inWindow.length < minMatches) return null;
  const counts: Record<string, number> = Object.create(null);
  for (const e of inWindow) {
    if (!e.pet_id) continue;
    counts[e.pet_id] = (counts[e.pet_id] ?? 0) + 1;
  }
  let topPetId: string | null = null,
    topCount = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] > topCount) {
      topCount = counts[k];
      topPetId = k;
    }
  }
  return {
    pattern: 'projection-pattern',
    pet_id: topPetId,
    sample_n: inWindow.length,
    window_days: windowDays,
    run_length: inWindow.length,
    confidence: inWindow.length >= 6 ? 'high' : 'medium',
    copy:
      'the "she is mad at me" frame showed up ' +
      inWindow.length +
      ' times this month. pets do not construct narratives of being-wronged. that is a cognitive-architecture mismatch, not a verdict.',
    source: {
      citation:
        'Topál, Gergely, Erdőhegyi, Csibra & Miklósi 2009, Science — differential sensitivity in dogs, wolves, infants',
      url: 'https://doi.org/10.1126/science.1176960',
    },
  };
}

// ─── Central dispatch ─────────────────────────────────────────────────

/**
 * Run all pattern detectors and return matching patterns.
 * Caller must pass `speciesProfiles` in opts for P3 to work.
 */
export function detectPatterns(
  state: PetsState,
  opts: PatternOpts = {},
): AnyPattern[] {
  if (!consentOn(opts)) return [];
  const out: AnyPattern[] = [];
  for (const r of detectVetAdherenceDelay(state, opts)) out.push(r);
  const p2 = detectCoRegulator(state, opts);
  if (p2) out.push(p2);
  for (const r of detectCareActivationBarrier(state, opts)) out.push(r);
  const p4 = detectCrashContextMisses(state, opts);
  if (p4) out.push(p4);
  const p5 = detectProjectionPattern(state, opts);
  if (p5) out.push(p5);
  return out;
}
