/**
 * @ollie/logic · habits tier-1 public detectors
 *
 * New-shape output: { signal, confidence, evidence, copy, copy_es, sources?, ts? }
 * These are the public API called by the orchestrator.
 *
 * Pure: no store reads, no DOM, no Date.now() (now resolves from opts/history).
 */

import type {
  HabitsHistory,
  HabitsOpts,
  HabitSignal,
} from './types';
import { mean, buildDayCompletionMap } from './helpers';
import { DAY_MS, dayKey } from '../util';

// ─── detectExternalizationRequirement ────────────────────────────────

export function detectExternalizationRequirement(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 14;
  const minHabitsPerSide = o.minHabitsPerSide ?? 3;
  const minCompletions = o.minCompletions ?? 4;
  const maxRatio = typeof o.maxRatio === 'number' ? o.maxRatio : 0.5;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const flatCompletions = history.completions ?? null;

  const habitMap = new Map<string, { hasCue: boolean; completions: number }>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    const hasCue =
      (typeof h.location === 'string' && h.location.trim().length > 0) ||
      (typeof h.after_action === 'string' && h.after_action.trim().length > 0) ||
      (typeof h.visible_cue === 'string' && h.visible_cue.trim().length > 0) ||
      (typeof h.cue === 'string' && h.cue.trim().length > 0);
    habitMap.set(h.id, { hasCue, completions: 0 });
  }

  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      if (c.ts < windowStart || c.ts > now) continue;
      const slot = c.habit_id ? habitMap.get(c.habit_id) : undefined;
      if (slot) slot.completions++;
    }
  } else {
    for (const h of arr) {
      if (!h || !h.id) continue;
      const slot = habitMap.get(h.id);
      if (!slot) continue;
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts < windowStart || e.ts > now) continue;
        slot.completions++;
      }
    }
  }

  const cuedQualifying: number[] = [];
  const uncuedQualifying: number[] = [];
  for (const slot of habitMap.values()) {
    if (slot.completions < minCompletions) continue;
    (slot.hasCue ? cuedQualifying : uncuedQualifying).push(slot.completions / windowDays);
  }
  if (cuedQualifying.length < minHabitsPerSide || uncuedQualifying.length < minHabitsPerSide) return null;

  const cuedRate = mean(cuedQualifying);
  const uncuedRate = mean(uncuedQualifying);
  if (cuedRate === 0) return null;
  if (uncuedRate >= cuedRate * maxRatio) return null;

  const sampleN = cuedQualifying.length + uncuedQualifying.length;
  const confidence: HabitSignal['confidence'] = sampleN >= 10 ? 'high' : sampleN >= 6 ? 'medium' : 'low';
  const cuedPct = Math.round(cuedRate * 100);
  const uncuedPct = Math.round(uncuedRate * 100);

  return {
    signal: 'externalization_requirement',
    confidence,
    evidence: [
      'cued_rate:' + (Math.round(cuedRate * 100) / 100),
      'uncued_rate:' + (Math.round(uncuedRate * 100) / 100),
      'cued_n:' + cuedQualifying.length,
      'uncued_n:' + uncuedQualifying.length,
    ],
    copy:
      cuedQualifying.length + ' cued habits at ' + cuedPct + '% completion vs '
      + uncuedQualifying.length + ' uncued at ' + uncuedPct + '%. '
      + 'cue your habits — pattern, not failure.',
    copy_es:
      cuedQualifying.length + ' hábitos con señal al ' + cuedPct + '% vs '
      + uncuedQualifying.length + ' sin señal al ' + uncuedPct + '%. '
      + 'pon señales a tus hábitos — patrón, no carencia.',
    sources: [
      { citation: 'Wood & Neal 2007, Psychological Review — A new look at habits and the habit-goal interface', url: 'https://doi.org/10.1037/0033-295X.114.4.843' },
      { citation: 'Barkley 2012, Executive Functions: What They Are, How They Work — prosthetic environment principle' },
    ],
  };
}

// ─── detectLutealCollapse ─────────────────────────────────────────────

export function detectLutealCollapse(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minLutealWindows = o.minLutealWindows ?? 2;
  const maxRatio = typeof o.maxRatio === 'number' ? o.maxRatio : 0.7;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const phases = history.cyclePhases ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0 || phases.length === 0) return null;

  // Local-time day key — matches the local keys used across habit detectors.
  const dKey = dayKey;

  const dayPhase = new Map<string, string>();
  const ranges: Array<{ start: number; end: number; name: string }> = [];
  const markers: Array<{ ts: number; phase: string }> = [];
  for (const p of phases) {
    if (!p) continue;
    if ('start' in p && 'end' in p && 'name' in p) ranges.push(p as { start: number; end: number; name: string });
    else if ('ts' in p && 'phase' in p) markers.push(p as { ts: number; phase: string });
  }
  for (const r of ranges) {
    const s = Math.max(r.start, windowStart);
    const e = Math.min(r.end, now);
    for (let t = s; t <= e; t += DAY_MS) dayPhase.set(dKey(t), r.name);
  }
  if (markers.length > 0) {
    markers.sort((a, b) => a.ts - b.ts);
    for (let t = windowStart; t <= now; t += DAY_MS) {
      let cur: string | null = null;
      for (const m of markers) {
        if (m.ts <= t) cur = m.phase; else break;
      }
      if (cur) dayPhase.set(dKey(t), cur);
    }
  }

  let lutealWindows = 0, inLuteal = false;
  for (let t = windowStart; t <= now; t += DAY_MS) {
    const ph = dayPhase.get(dKey(t));
    if (ph === 'luteal') {
      if (!inLuteal) { lutealWindows++; inLuteal = true; }
    } else {
      inLuteal = false;
    }
  }
  if (lutealWindows < minLutealWindows) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, flatCompletions, windowStart, now);

  let lutealDays = 0, lutealCompletions = 0;
  let otherDays = 0, otherCompletions = 0;
  for (const [k, ph] of dayPhase.entries()) {
    const cs = dayCompletions.get(k) ?? 0;
    if (ph === 'luteal') { lutealDays++; lutealCompletions += cs; }
    else { otherDays++; otherCompletions += cs; }
  }
  if (lutealDays < 4 || otherDays < 8) return null;

  const lutealRate = lutealCompletions / (lutealDays * habitsActive);
  const otherRate = otherCompletions / (otherDays * habitsActive);
  if (otherRate === 0) return null;
  const ratio = lutealRate / otherRate;
  if (ratio > maxRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  const confidence: HabitSignal['confidence'] = ratio < 0.4 ? 'high' : ratio < 0.55 ? 'medium' : 'low';

  return {
    signal: 'luteal_collapse',
    confidence,
    evidence: [
      'luteal_rate:' + (Math.round(lutealRate * 100) / 100),
      'other_rate:' + (Math.round(otherRate * 100) / 100),
      'luteal_days:' + lutealDays,
      'other_days:' + otherDays,
      'luteal_windows:' + lutealWindows,
    ],
    drop_percent: dropPct,
    copy:
      'your brain is different this week — completion drops ~' + dropPct + '% in luteal phase. '
      + 'scaling expectations, not standards.',
    copy_es:
      'tu cerebro está distinto esta semana — el cierre baja ~' + dropPct + '% en fase lútea. '
      + 'escalamos expectativas, no estándares.',
    sources: [
      { citation: 'Roberts, Eisenlohr-Moul & Martel 2018, Psychoneuroendocrinology', url: 'https://doi.org/10.1016/j.psyneuen.2017.11.015' },
      { citation: 'Eng et al. 2024, Hormones and Behavior', url: 'https://doi.org/10.1016/j.yhbeh.2023.105466' },
      { citation: 'Dorani et al. 2021, Journal of Psychiatric Research' },
    ],
  };
}

// ─── detectSensoryPreflight ───────────────────────────────────────────

export function detectSensoryPreflight(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 30;
  const minClusters = o.minClusters ?? 3;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.5;
  const windowStart = now - windowDays * DAY_MS;

  const SENSORY_RE_LOCAL = /\b(loud|hot|cold|sticky|bright|scratchy|nauseous|exhausted|overstimulated|too\s+much\s+noise)\b/i;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0 || dumps.length === 0) return null;

  // Local-time day key — matches the local keys used across habit detectors.
  const dKey = dayKey;

  const dayCompletions = buildDayCompletionMap(arr, flatCompletions, windowStart, now);

  const sensoryDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (SENSORY_RE_LOCAL.test(text)) sensoryDays.add(dKey(d.ts));
  }
  if (sensoryDays.size < minClusters) return null;

  const allDays: string[] = [];
  for (let t = windowStart; t <= now; t += DAY_MS) allDays.push(dKey(t));

  const habitsActive = arr.length;
  const expectedDaily = habitsActive;

  let sensorySkipClusters = 0;
  let sensoryCompletions = 0, sensoryCount = 0;
  let baselineCompletions = 0, baselineCount = 0;
  for (const k of allDays) {
    const cs = dayCompletions.get(k) ?? 0;
    if (sensoryDays.has(k)) {
      sensoryCount++;
      sensoryCompletions += cs;
      if (cs < expectedDaily * 0.5) sensorySkipClusters++;
    } else {
      baselineCount++;
      baselineCompletions += cs;
    }
  }
  if (sensorySkipClusters < minClusters) return null;
  if (sensoryCount === 0 || baselineCount === 0) return null;

  const sensorySkipRate = 1 - (sensoryCompletions / (sensoryCount * habitsActive));
  const baselineSkipRate = 1 - (baselineCompletions / (baselineCount * habitsActive));
  if (baselineSkipRate <= 0) return null;
  const lift = sensorySkipRate / baselineSkipRate;
  if (lift < minLift) return null;

  const confidence: HabitSignal['confidence'] = lift >= 2.5 ? 'high' : lift >= 2 ? 'medium' : 'low';

  return {
    signal: 'sensory_preflight',
    confidence,
    evidence: [
      'skip_clusters:' + sensorySkipClusters,
      'sensory_skip_rate:' + (Math.round(sensorySkipRate * 100) / 100),
      'baseline_skip_rate:' + (Math.round(baselineSkipRate * 100) / 100),
      'lift:' + (Math.round(lift * 100) / 100),
    ],
    copy:
      'before prescribing the habit, prescribe the conditions. '
      + sensorySkipClusters + ' skip days clustered with sensory mentions.',
    copy_es:
      'antes de prescribir el hábito, prescribe las condiciones. '
      + sensorySkipClusters + ' días saltados se agruparon con menciones sensoriales.',
    sources: [
      { citation: 'Bijlenga et al. 2017, European Psychiatry — sensory processing in adult ADHD', url: 'https://doi.org/10.1016/j.eurpsy.2017.02.481' },
      { citation: 'Cermak et al. 2025, Research in Developmental Disabilities — sensory × executive function in adult ADHD' },
    ],
  };
}

// ─── detectInterestHijack ─────────────────────────────────────────────

export function detectInterestHijack(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const recentDays = o.recentDays ?? 7;
  const baselineDays = o.baselineDays ?? 14;
  const goalLookback = o.goalLookback ?? 14;
  const novelLookback = o.novelLookback ?? 30;
  const minHabitsCollapsed = o.minHabitsCollapsed ?? 3;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.5;
  const minNovelMentions = o.minNovelMentions ?? 3;

  const recentStart = now - recentDays * DAY_MS;
  const baselineStart = now - (recentDays + baselineDays) * DAY_MS;
  const baselineEnd = recentStart - 1;
  const novelStart = now - novelLookback * DAY_MS;
  const priorStart = now - (novelLookback + 30) * DAY_MS;
  const priorEnd = novelStart - 1;
  const goalStart = now - goalLookback * DAY_MS;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  const goals = history.goals ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length < minHabitsCollapsed) return null;

  const perHabit = new Map<string, { recent: number; baseline: number }>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    perHabit.set(h.id, { recent: 0, baseline: 0 });
  }

  const accum = (id: string | undefined, ts: number) => {
    if (!id) return;
    const slot = perHabit.get(id);
    if (!slot) return;
    if (ts >= recentStart && ts <= now) slot.recent++;
    else if (ts >= baselineStart && ts <= baselineEnd) slot.baseline++;
  };

  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      accum(c.habit_id, c.ts);
    }
  } else {
    for (const h of arr) {
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        accum(h.id, e.ts);
      }
    }
  }

  let collapsed = 0, observedCount = 0;
  for (const slot of perHabit.values()) {
    const baseRate = slot.baseline / baselineDays;
    const recentRate = slot.recent / recentDays;
    if (baseRate < (3 / baselineDays)) continue;
    observedCount++;
    if (recentRate <= baseRate * minDropRatio) collapsed++;
  }
  if (collapsed < minHabitsCollapsed) return null;

  const stop = new Set(['the','and','for','with','that','this','have','from','about','just','like','what','your','they','their','them','then','some','very','really','today','i','a','an','to','of','in','on','is','it','at','be','my','me','was','are','so','am','do','did','not']);
  const tokens = (text: string): string[] =>
    text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !stop.has(t));

  const recentCounts = new Map<string, number>();
  const priorSet = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (d.ts >= novelStart && d.ts <= now) {
      for (const t of new Set(tokens(text))) recentCounts.set(t, (recentCounts.get(t) ?? 0) + 1);
    } else if (d.ts >= priorStart && d.ts <= priorEnd) {
      for (const t of tokens(text)) priorSet.add(t);
    }
  }

  let novelKeyword: string | null = null;
  let novelMentions = 0;
  for (const [t, c] of recentCounts.entries()) {
    if (priorSet.has(t)) continue;
    if (c >= minNovelMentions && c > novelMentions) { novelKeyword = t; novelMentions = c; }
  }

  const newGoals = goals.filter(g => g && typeof g.created_at === 'number' && g.created_at >= goalStart && g.created_at <= now);
  if (!novelKeyword && newGoals.length === 0) return null;

  const evidence: string[] = [
    'habits_collapsed:' + collapsed,
    'observed_habits:' + observedCount,
  ];
  if (novelKeyword) evidence.push('novel_keyword:' + novelKeyword, 'novel_mentions:' + novelMentions);
  if (newGoals.length > 0) evidence.push('new_goals:' + newGoals.length);

  let confidence: HabitSignal['confidence'] = 'low';
  if (novelKeyword && newGoals.length > 0 && collapsed >= 4) confidence = 'high';
  else if (novelKeyword && (newGoals.length > 0 || collapsed >= 4)) confidence = 'medium';

  return {
    signal: 'interest_hijack',
    confidence,
    evidence,
    habits_affected: collapsed,
    copy:
      'interest capture detected — ' + collapsed + ' habits paused together. '
      + 'pause them officially instead of letting them lapse?',
    copy_es:
      'captura de interés detectada — ' + collapsed + ' hábitos pausados juntos. '
      + '¿los pausamos oficialmente en lugar de dejar que se caigan?',
    sources: [
      { citation: 'Dwyer et al. 2024, Autism — monotropism transdiagnostic', url: 'https://doi.org/10.1177/13623613231200837' },
      { citation: 'Hauser et al. 2018, Brain — novelty-dopamine in ADHD' },
    ],
  };
}

// ─── detectStressCollapse ─────────────────────────────────────────────

export function detectStressCollapse(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const stressLookbackDays = o.stressLookbackDays ?? 7;
  const sleepLookbackNights = o.sleepLookbackNights ?? 5;
  const baselineDays = o.baselineDays ?? 14;
  const minDeadlineMentions = o.minDeadlineMentions ?? 2;
  const maxAvgTstMin = typeof o.maxAvgTstMin === 'number' ? o.maxAvgTstMin : 360;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.7;

  const stressStart = now - stressLookbackDays * DAY_MS;
  const baselineEnd = stressStart - 1;
  const baselineStart = baselineEnd - baselineDays * DAY_MS + 1;
  const sleepStart = now - sleepLookbackNights * DAY_MS;

  const DEADLINE_RE = /\b(deadline|due\s+tomorrow|due\s+today|crunch|son\s+tarih|yetiştirmem)\b/i;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  const sleepRecords = history.sleepRecords ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0) return null;

  let deadlineMentions = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < stressStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (DEADLINE_RE.test(text)) deadlineMentions++;
  }
  if (deadlineMentions < minDeadlineMentions) return null;

  const recentSleep = sleepRecords.filter(s =>
    s && typeof s.ts === 'number' && s.ts >= sleepStart && s.ts <= now && typeof s.tst_min === 'number'
  );
  if (recentSleep.length === 0) return null;
  const avgTst = recentSleep.reduce((sum, s) => sum + (s.tst_min ?? 0), 0) / recentSleep.length;
  if (avgTst >= maxAvgTstMin) return null;

  let recentCompletions = 0, baselineCompletions = 0;
  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      if (c.ts >= stressStart && c.ts <= now) recentCompletions++;
      else if (c.ts >= baselineStart && c.ts <= baselineEnd) baselineCompletions++;
    }
  } else {
    for (const h of arr) {
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts >= stressStart && e.ts <= now) recentCompletions++;
        else if (e.ts >= baselineStart && e.ts <= baselineEnd) baselineCompletions++;
      }
    }
  }
  if (baselineCompletions === 0) return null;

  const recentRate = recentCompletions / (stressLookbackDays * arr.length);
  const baselineRate = baselineCompletions / (baselineDays * arr.length);
  if (baselineRate === 0) return null;
  const ratio = recentRate / baselineRate;
  if (ratio > minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  const avgHours = Math.round(avgTst / 60 * 10) / 10;
  const confidence: HabitSignal['confidence'] = (ratio < 0.4 && deadlineMentions >= 4) ? 'high' : (ratio < 0.55 ? 'medium' : 'low');

  return {
    signal: 'stress_collapse',
    confidence,
    evidence: [
      'deadline_mentions:' + deadlineMentions,
      'avg_tst_min:' + Math.round(avgTst),
      'recent_rate:' + (Math.round(recentRate * 100) / 100),
      'baseline_rate:' + (Math.round(baselineRate * 100) / 100),
      'drop_pct:' + dropPct,
    ],
    copy:
      'stress signature detected. ' + deadlineMentions + ' deadline mentions + '
      + avgHours + 'h avg sleep + drop in habit completion. '
      + 'switch to stress mode (somatic only)?',
    copy_es:
      'firma de estrés detectada. ' + deadlineMentions + ' menciones de plazo + '
      + avgHours + 'h de sueño en promedio + caída en cierres de hábitos. '
      + '¿pasamos a modo estrés (solo somático)?',
    sources: [
      { citation: 'Schwabe & Wolf 2009, Journal of Neuroscience — Stress prompts habit behavior in humans', url: 'https://doi.org/10.1523/JNEUROSCI.0979-09.2009' },
      { citation: 'Pool et al. 2022 — partial replication of stress-habit shift' },
      { citation: 'Corominas 2012, Current Pharmaceutical Design — ADHD allostatic load' },
    ],
  };
}
