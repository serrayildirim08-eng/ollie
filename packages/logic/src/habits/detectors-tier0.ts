/**
 * @ollie/logic · habits tier-0 detectors (legacy _detect* private shape)
 *
 * These mirror the private `_detect*` methods from the IIFE.
 * Output shape: { pattern, confidence, sample_n, copy, copy_es, source? }
 *
 * Pure: no store reads, no DOM, no Date.now() (now is always explicit via
 * history.now or opts.now).
 */

import type { HabitsHistory, HabitsOpts, LegacyPattern } from './types';
import {
  SENSORY_RE,
  NEG_SELF_RE,
  FRESH_START_RE,
  TRAIT_RE,
  ACTION_RE,
  BODY_HABIT_RE,
  COG_HABIT_RE,
} from './constants';
import {
  dayKey,
  mean,
  completionsInWindow,
  buildDayCompletionMap,
} from './helpers';
import { DAY_MS } from '../util';

// ─── externalization-gap ──────────────────────────────────────────────

export function detectExternalizationGap(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 14;
  const minHabitsPerSide = o.minHabitsPerSide ?? 2;
  const minRatioGap = typeof o.minRatioGap === 'number' ? o.minRatioGap : 0.6;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const cued: number[] = [], uncued: number[] = [];
  for (const h of arr) {
    if (!h || !h.id) continue;
    const hasCue = typeof h.cue === 'string' && h.cue.trim().length > 0;
    const completions = completionsInWindow(h, windowStart, now);
    const rate = completions / windowDays;
    (hasCue ? cued : uncued).push(rate);
  }
  if (cued.length < minHabitsPerSide || uncued.length < minHabitsPerSide) return null;

  const cuedMean = mean(cued);
  const uncuedMean = mean(uncued);
  if (cuedMean === 0) return null;
  const ratio = uncuedMean / cuedMean;
  if (ratio >= minRatioGap) return null;

  const gapPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'externalization-gap',
    confidence: ratio < 0.3 ? 'high' : ratio < 0.5 ? 'medium' : 'low',
    sample_n: cued.length + uncued.length,
    cued_count: cued.length,
    uncued_count: uncued.length,
    cued_completion_rate: Math.round(cuedMean * 100) / 100,
    uncued_completion_rate: Math.round(uncuedMean * 100) / 100,
    gap_percent: gapPct,
    copy:
      `habits with a cue complete ${gapPct}% more often than habits without one. ` +
      `pattern, not failure.`,
    copy_es:
      `los hábitos con una señal externa se cumplen un ${gapPct}% más que los que no la tienen. ` +
      `patrón, no carencia.`,
    source: {
      citation: 'Wood & Neal 2007, Psychological Review — A new look at habits and the habit-goal interface',
      url: 'https://doi.org/10.1037/0033-295X.114.4.843',
    },
  };
}

// ─── luteal-collapse (legacy) ─────────────────────────────────────────

export function detectLutealCollapseLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minLutealDays = o.minLutealDays ?? 4;
  const minOtherDays = o.minOtherDays ?? 8;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.7;
  const windowDays = o.windowDays ?? 60;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const phases = history.cyclePhases ?? [];
  if (arr.length === 0 || phases.length === 0) return null;

  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);
  const habitsActive = arr.length;

  const dayPhase = new Map<string, string>();
  for (const p of phases) {
    if (!p) continue;
    if ('start' in p && 'end' in p && 'name' in p) {
      const s = Math.max(p.start, windowStart);
      const e = Math.min(p.end, now);
      for (let t = s; t <= e; t += DAY_MS) dayPhase.set(dayKey(t), p.name);
    }
  }

  let lutealDays = 0, lutealCompletions = 0;
  let otherDays = 0, otherCompletions = 0;
  for (const [k, phase] of dayPhase.entries()) {
    const cs = dayCompletions.get(k) ?? 0;
    if (phase === 'luteal') { lutealDays++; lutealCompletions += cs; }
    else { otherDays++; otherCompletions += cs; }
  }
  if (lutealDays < minLutealDays || otherDays < minOtherDays) return null;

  const lutealRate = lutealCompletions / (lutealDays * habitsActive);
  const otherRate = otherCompletions / (otherDays * habitsActive);
  if (otherRate === 0) return null;
  const ratio = lutealRate / otherRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'luteal-collapse',
    confidence: ratio < 0.4 ? 'high' : ratio < 0.6 ? 'medium' : 'low',
    sample_n: lutealDays + otherDays,
    luteal_days: lutealDays,
    other_days: otherDays,
    luteal_rate: Math.round(lutealRate * 100) / 100,
    other_rate: Math.round(otherRate * 100) / 100,
    drop_percent: dropPct,
    copy:
      `habits drop ~${dropPct}% during luteal phase. estradiol's down — striatal dopamine's down. ` +
      `your brain is different this week.`,
    copy_es:
      `los hábitos bajan ~${dropPct}% en fase lútea. estradiol abajo — dopamina estriatal abajo. ` +
      `tu cerebro está distinto esta semana.`,
    source: {
      citation: 'Eng et al. 2024, Hormones and Behavior — Cycle-phase × executive function in adult women',
      url: 'https://doi.org/10.1016/j.yhbeh.2023.105466',
    },
  };
}

// ─── stress-collapse (legacy) ─────────────────────────────────────────

export function detectStressCollapseLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minStressDays = o.minStressDays ?? 3;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.6;
  const windowDays = o.windowDays ?? 60;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  if (arr.length === 0 || dumps.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const stressDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || d.ts < windowStart || d.ts > now) continue;
    if (typeof d.rawText !== 'string') continue;
    if (SENSORY_RE.test(d.rawText) || /\b(stressed?|overwhelm|anxious|panic|deadline|exhausted)\b/i.test(d.rawText))
      stressDays.add(dayKey(d.ts));
  }
  if (stressDays.size < minStressDays) return null;

  const postStressDays = new Set<string>();
  for (const k of stressDays) {
    const t = Date.parse(k + 'T12:00:00');
    if (isNaN(t)) continue;
    postStressDays.add(dayKey(t + DAY_MS));
  }

  let postCompletions = 0, postDays = 0;
  let baselineCompletions = 0, baselineDays = 0;
  for (let t = windowStart; t <= now; t += DAY_MS) {
    const k = dayKey(t);
    const cs = dayCompletions.get(k) ?? 0;
    if (postStressDays.has(k)) { postCompletions += cs; postDays++; }
    else if (!stressDays.has(k)) { baselineCompletions += cs; baselineDays++; }
  }
  if (postDays < minStressDays || baselineDays < 7) return null;

  const postRate = postCompletions / (postDays * habitsActive);
  const baselineRate = baselineCompletions / (baselineDays * habitsActive);
  if (baselineRate === 0) return null;
  const ratio = postRate / baselineRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'stress-collapse',
    confidence: ratio < 0.3 ? 'high' : ratio < 0.5 ? 'medium' : 'low',
    sample_n: postDays + baselineDays,
    post_stress_days: postDays,
    baseline_days: baselineDays,
    post_rate: Math.round(postRate * 100) / 100,
    baseline_rate: Math.round(baselineRate * 100) / 100,
    drop_percent: dropPct,
    copy:
      `the day after a stress mention, habits drop ~${dropPct}%. ` +
      `dorsolateral striatum takes over under load. expect the dip.`,
    copy_es:
      `el día después de mencionar estrés, los hábitos bajan ~${dropPct}%. ` +
      `el estriado dorsolateral toma el mando bajo carga. cuenta con la bajada.`,
    source: {
      citation: 'Schwabe & Wolf 2009, Journal of Neuroscience — Stress prompts habit behavior in humans',
      url: 'https://doi.org/10.1523/JNEUROSCI.0979-09.2009',
    },
  };
}

// ─── sensory-flag ─────────────────────────────────────────────────────

export function detectSensoryFlag(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minSensoryDays = o.minSensoryDays ?? 3;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.6;
  const windowDays = o.windowDays ?? 60;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  if (arr.length === 0 || dumps.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const sensoryDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || d.ts < windowStart || d.ts > now) continue;
    if (typeof d.rawText !== 'string') continue;
    if (SENSORY_RE.test(d.rawText)) sensoryDays.add(dayKey(d.ts));
  }
  if (sensoryDays.size < minSensoryDays) return null;

  let sensoryCompletions = 0, baselineCompletions = 0, baselineDays = 0;
  for (let t = windowStart; t <= now; t += DAY_MS) {
    const k = dayKey(t);
    const cs = dayCompletions.get(k) ?? 0;
    if (sensoryDays.has(k)) sensoryCompletions += cs;
    else { baselineCompletions += cs; baselineDays++; }
  }
  if (baselineDays < 7) return null;

  const sensoryRate = sensoryCompletions / (sensoryDays.size * habitsActive);
  const baselineRate = baselineCompletions / (baselineDays * habitsActive);
  if (baselineRate === 0) return null;
  const ratio = sensoryRate / baselineRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'sensory-flag',
    confidence: ratio < 0.3 ? 'high' : ratio < 0.5 ? 'medium' : 'low',
    sample_n: sensoryDays.size + baselineDays,
    drop_percent: dropPct,
    copy: `on sensory-load days (travel, loud, sick, jet lag), habits drop ~${dropPct}%. interoceptive bandwidth tax. prescribe the conditions, not the habit.`,
    copy_es: `en días de carga sensorial (viajes, ruido, enfermedad, jet lag), los hábitos bajan ~${dropPct}%. impuesto al ancho de banda interoceptivo. prescribe las condiciones, no el hábito.`,
    source: { citation: 'Bijlenga et al. 2017, European Psychiatry', url: 'https://doi.org/10.1016/j.eurpsy.2017.02.481' },
  };
}

// ─── interest-hijack (legacy) ─────────────────────────────────────────

export function detectInterestHijackLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minHabits = o.minHabits ?? 3;
  const collapseThreshold = typeof o.collapseThreshold === 'number' ? o.collapseThreshold : 0.25;
  const requireRatio = typeof o.requireRatio === 'number' ? o.requireRatio : 0.5;
  const recentWindow = (o.recentDays ?? 7) * DAY_MS;
  const baselineWindow = (o.baselineDays ?? 30) * DAY_MS;

  const arr = history.habits ?? [];
  if (arr.length < minHabits) return null;

  let collapsedCount = 0;
  for (const h of arr) {
    const recent = completionsInWindow(h, now - recentWindow, now);
    const baseline = completionsInWindow(h, now - baselineWindow, now - recentWindow);
    const baselineRate = baseline / ((o.baselineDays ?? 30) - (o.recentDays ?? 7));
    const recentRate = recent / (o.recentDays ?? 7);
    if (baselineRate === 0) continue;
    if (recentRate / baselineRate < collapseThreshold) collapsedCount++;
  }
  if (collapsedCount / arr.length < requireRatio) return null;

  return {
    pattern: 'interest-hijack',
    confidence: collapsedCount / arr.length >= 0.7 ? 'high' : 'medium',
    sample_n: arr.length,
    collapsed_count: collapsedCount,
    copy: `${collapsedCount} of ${arr.length} habits dropped in the same week. usually a new interest is eating attention. pause habits — don't mark them missed.`,
    copy_es: `${collapsedCount} de ${arr.length} hábitos bajaron la misma semana. normalmente un interés nuevo se está comiendo la atención. pausa los hábitos — no los marques como huecos.`,
    source: { citation: 'Hauser et al. 2018, Brain — novelty-driven dopamine in ADHD', url: 'https://doi.org/10.1093/brain/awy066' },
  };
}

// ─── fresh-start-crash (legacy) ───────────────────────────────────────

export function detectFreshStartCrashLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minMentions = o.minMentions ?? 3;
  const windowDays = o.windowDays ?? 90;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps ?? [];
  if (dumps.length === 0) return null;

  let mentions = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || d.ts < windowStart || d.ts > now) continue;
    if (typeof d.rawText !== 'string') continue;
    if (FRESH_START_RE.test(d.rawText)) mentions++;
  }
  if (mentions < minMentions) return null;

  return {
    pattern: 'fresh-start-crash',
    confidence: mentions >= 5 ? 'high' : 'medium',
    sample_n: mentions,
    copy: `you've said "starting over" ${mentions} times in ${windowDays} days. restart re-entry is the highest leverage moment, not failure.`,
    copy_es: `has dicho "empezar de cero" ${mentions} veces en ${windowDays} días. reentrar después de un parón es el momento de más palanca, no carencia.`,
    source: { citation: 'Dai, Milkman & Riis 2014, Management Science — fresh start effect', url: 'https://doi.org/10.1287/mnsc.2014.1901' },
  };
}

// ─── identity-trait-framing (legacy) ─────────────────────────────────

export function detectIdentityTraitFramingLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 30;
  const minTotal = o.minTotal ?? 7;
  const minRatio = typeof o.minRatio === 'number' ? o.minRatio : 2.0;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps ?? [];
  if (dumps.length === 0) return null;

  let trait = 0, action = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || d.ts < windowStart || d.ts > now) continue;
    if (typeof d.rawText !== 'string') continue;
    // When both TRAIT_RE + NEG_SELF_RE match, attribute to neg-self (per 2026-05-07 note)
    if (TRAIT_RE.test(d.rawText) && !NEG_SELF_RE.test(d.rawText)) trait++;
    if (ACTION_RE.test(d.rawText)) action++;
  }
  if (trait + action < minTotal) return null;
  if (action === 0 && trait < minTotal) return null;
  const ratio = action === 0 ? trait : trait / action;
  if (ratio < minRatio) return null;

  return {
    pattern: 'identity-trait-framing',
    confidence: ratio >= 4 ? 'high' : 'medium',
    sample_n: trait + action,
    trait_count: trait,
    action_count: action,
    copy: `you've framed yourself in trait language ${trait} times vs ${action} times in action language. trait framing makes habits feel about who you are, not what you did.`,
    copy_es: `te has descrito en lenguaje de rasgo ${trait} veces vs ${action} en lenguaje de acción. el lenguaje de rasgo convierte el hábito en algo de quién eres, no de lo que hiciste.`,
    source: { citation: 'Verplanken & Sui 2019, Frontiers in Psychology', url: 'https://doi.org/10.3389/fpsyg.2019.01504' },
  };
}

// ─── body-cognitive-gap (legacy) ──────────────────────────────────────

export function detectBodyVsCognitiveLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 28;
  const minPerSide = o.minPerSide ?? 2;
  const minGapPct = typeof o.minGapPct === 'number' ? o.minGapPct : 0.25;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const body: number[] = [], cog: number[] = [];
  for (const h of arr) {
    if (!h || !h.name) continue;
    const isBody = BODY_HABIT_RE.test(h.name);
    const isCog = COG_HABIT_RE.test(h.name);
    if (isBody === isCog) continue;
    const rate = completionsInWindow(h, windowStart, now) / windowDays;
    (isBody ? body : cog).push(rate);
  }
  if (body.length < minPerSide || cog.length < minPerSide) return null;

  const bodyMean = mean(body);
  const cogMean = mean(cog);
  const gap = bodyMean - cogMean;
  if (Math.abs(gap) < minGapPct) return null;

  const stronger = gap > 0 ? 'body' : 'cognitive';
  const weaker = gap > 0 ? 'cognitive' : 'body';
  const gapPct = Math.round(Math.abs(gap) * 100);
  return {
    pattern: 'body-cognitive-gap',
    confidence: Math.abs(gap) >= 0.4 ? 'high' : 'medium',
    sample_n: body.length + cog.length,
    gap_percent: gapPct,
    stronger,
    copy: `${stronger} habits complete ${gapPct}% more than ${weaker} ones. attach the ${weaker} habit to a ${stronger} anchor.`,
    copy_es: `los hábitos de ${stronger} se cumplen un ${gapPct}% más que los de ${weaker}. ancla el hábito de ${weaker} a uno de ${stronger}.`,
    source: { citation: 'Cerrillo-Urbina et al. 2015 — exercise meta-analysis in ADHD', url: 'https://doi.org/10.1111/cch.12255' },
  };
}

// ─── habit-drift (legacy) ─────────────────────────────────────────────

export function detectHabitDriftLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const halfDays = o.halfDays ?? 14;
  const minDropPct = typeof o.minDropPct === 'number' ? o.minDropPct : 0.3;
  const minHabits = o.minHabits ?? 2;

  const arr = history.habits ?? [];
  if (arr.length < minHabits) return null;

  const recentStart = now - halfDays * DAY_MS;
  const priorStart = now - 2 * halfDays * DAY_MS;

  let recentTotal = 0, priorTotal = 0;
  for (const h of arr) {
    recentTotal += completionsInWindow(h, recentStart, now);
    priorTotal += completionsInWindow(h, priorStart, recentStart);
  }
  if (priorTotal === 0) return null;

  const recentRate = recentTotal / (arr.length * halfDays);
  const priorRate = priorTotal / (arr.length * halfDays);
  const dropRatio = 1 - recentRate / priorRate;
  if (dropRatio < minDropPct) return null;

  const dropPct = Math.round(dropRatio * 100);
  return {
    pattern: 'habit-drift',
    confidence: dropRatio >= 0.5 ? 'high' : 'medium',
    sample_n: arr.length,
    drop_percent: dropPct,
    copy: `last ${halfDays} days: ${dropPct}% fewer completions than the ${halfDays} before. data, not failure.`,
    copy_es: `últimos ${halfDays} días: ${dropPct}% menos cierres que los ${halfDays} anteriores. datos, no carencia.`,
  };
}

// ─── friction-signature (legacy) ──────────────────────────────────────

export function detectFrictionSignatureLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 90;
  const minSpread = typeof o.minSpread === 'number' ? o.minSpread : 0.3;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  if (arr.length === 0) return null;

  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  const dowDays = [0, 0, 0, 0, 0, 0, 0];
  for (let t = windowStart; t <= now; t += DAY_MS) {
    dowDays[new Date(t).getDay()]++;
  }
  // Count at most one completion per habit per local day, so the per-weekday
  // rate is a true fraction in [0,1]. Without the dedupe a habit logged twice
  // on one day inflates dowCount and the rate can exceed 1.
  const seenHabitDay = new Set<string>();
  for (let hi = 0; hi < arr.length; hi++) {
    const c = arr[hi].completions ?? [];
    for (const e of c) {
      if (!e || typeof e.ts !== 'number' || e.ts < windowStart || e.ts > now) continue;
      const d = new Date(e.ts);
      const dow = d.getDay();
      const dayKey = `${hi}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (seenHabitDay.has(dayKey)) continue;
      seenHabitDay.add(dayKey);
      dowCount[dow]++;
    }
  }

  // Only weekdays that actually occurred in the window have a defined rate.
  // Resolving peak/valley over the full 0-padded array can otherwise pick a
  // zero-data weekday as the "valley" (rate 0 by construction, not by data).
  const covered: number[] = [];
  for (let i = 0; i < 7; i++) if (dowDays[i] > 0) covered.push(i);
  if (covered.length < 2) return null;
  const dowRate = dowCount.map((c, i) => dowDays[i] === 0 ? 0 : c / (dowDays[i] * arr.length));
  let peakIdx = covered[0];
  let valleyIdx = covered[0];
  for (const i of covered) {
    if (dowRate[i] > dowRate[peakIdx]) peakIdx = i;
    if (dowRate[i] < dowRate[valleyIdx]) valleyIdx = i;
  }
  const max = dowRate[peakIdx];
  const min = dowRate[valleyIdx];
  const spread = max - min;
  if (spread < minSpread) return null;

  const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const peakDow = NAMES[peakIdx];
  const valleyDow = NAMES[valleyIdx];
  return {
    pattern: 'friction-signature',
    confidence: spread >= 0.6 ? 'high' : 'medium',
    sample_n: dowCount.reduce((s, x) => s + x, 0),
    peak: peakDow,
    valley: valleyDow,
    copy: `your habits land best on ${peakDow} and worst on ${valleyDow}. day-of-week friction. plan around it.`,
    copy_es: `tus hábitos aterrizan mejor en ${peakDow} y peor en ${valleyDow}. fricción por día de semana. planifica alrededor.`,
  };
}

// ─── sleep-habit-coupling (legacy) ────────────────────────────────────

export function detectSleepHabitCouplingLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minShortNights = o.minShortNights ?? 7;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.6;
  const shortHoursThreshold = o.shortHoursThreshold ?? 6;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const sleep = history.sleepRecords ?? [];
  if (arr.length === 0 || sleep.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const shortNights = new Set<string>();
  for (const r of sleep) {
    if (!r || typeof r.night_of !== 'string' || typeof r.hours !== 'number') continue;
    if (r.hours >= shortHoursThreshold) continue;
    const t = Date.parse(r.night_of + 'T12:00:00');
    if (isNaN(t) || t < windowStart || t > now) continue;
    shortNights.add(dayKey(t + DAY_MS));
  }
  if (shortNights.size < minShortNights) return null;

  let postCompletions = 0, postDays = 0, baselineCompletions = 0, baselineDays = 0;
  for (let t = windowStart; t <= now; t += DAY_MS) {
    const k = dayKey(t);
    const cs = dayCompletions.get(k) ?? 0;
    if (shortNights.has(k)) { postCompletions += cs; postDays++; }
    else { baselineCompletions += cs; baselineDays++; }
  }
  if (postDays < minShortNights || baselineDays < 7) return null;

  const postRate = postCompletions / (postDays * habitsActive);
  const baselineRate = baselineCompletions / (baselineDays * habitsActive);
  if (baselineRate === 0) return null;
  const ratio = postRate / baselineRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'sleep-habit-coupling',
    confidence: ratio < 0.4 ? 'high' : 'medium',
    sample_n: postDays + baselineDays,
    drop_percent: dropPct,
    copy: `the day after <${shortHoursThreshold}h sleep, habits drop ~${dropPct}%. sleep debt eats EF first.`,
    copy_es: `el día después de dormir <${shortHoursThreshold}h, los hábitos bajan ~${dropPct}%. la deuda de sueño se come la función ejecutiva primero.`,
  };
}

// ─── habit-rebirth (legacy) ───────────────────────────────────────────

export function detectHabitRebirthLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minRestarts = o.minRestarts ?? 3;
  const minGapDays = o.minGapDays ?? 7;
  const windowDays = o.windowDays ?? 60;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  let restarts = 0;
  for (const h of arr) {
    const c = (h.completions ?? [])
      .filter(e => e && typeof e.ts === 'number' && e.ts >= windowStart)
      .map(e => e.ts)
      .sort((a, b) => a - b);
    for (let i = 1; i < c.length; i++) {
      if ((c[i] - c[i - 1]) >= minGapDays * DAY_MS) restarts++;
    }
  }
  if (restarts < minRestarts) return null;

  return {
    pattern: 'habit-rebirth',
    confidence: restarts >= 6 ? 'high' : 'medium',
    sample_n: restarts,
    copy: `${restarts} restarts in ${windowDays} days. you're not bad — you're cyclical. restart is the skill.`,
    copy_es: `${restarts} reinicios en ${windowDays} días. no eres "de los que no pueden" — eres cíclica. reiniciar es la habilidad.`,
  };
}

// ─── self-talk-coupling (legacy) ──────────────────────────────────────

export function detectSelfTalkCouplingLegacy(
  history: HabitsHistory,
  opts?: HabitsOpts,
): LegacyPattern | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minNegDays = o.minNegDays ?? 3;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.7;
  const followDays = o.followDays ?? 3;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  if (arr.length === 0 || dumps.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const negDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number' || d.ts < windowStart || d.ts > now) continue;
    if (typeof d.rawText !== 'string') continue;
    if (NEG_SELF_RE.test(d.rawText)) negDays.add(dayKey(d.ts));
  }
  if (negDays.size < minNegDays) return null;

  const followSet = new Set<string>();
  for (const k of negDays) {
    const t = Date.parse(k + 'T12:00:00');
    if (isNaN(t)) continue;
    for (let i = 1; i <= followDays; i++) followSet.add(dayKey(t + i * DAY_MS));
  }

  let postCompletions = 0, postDays = 0, baselineCompletions = 0, baselineDays = 0;
  for (let t = windowStart; t <= now; t += DAY_MS) {
    const k = dayKey(t);
    const cs = dayCompletions.get(k) ?? 0;
    if (followSet.has(k)) { postCompletions += cs; postDays++; }
    else if (!negDays.has(k)) { baselineCompletions += cs; baselineDays++; }
  }
  if (postDays < followDays || baselineDays < 7) return null;

  const postRate = postCompletions / (postDays * habitsActive);
  const baselineRate = baselineCompletions / (baselineDays * habitsActive);
  if (baselineRate === 0) return null;
  const ratio = postRate / baselineRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'self-talk-coupling',
    confidence: ratio < 0.4 ? 'high' : 'medium',
    sample_n: postDays + baselineDays,
    drop_percent: dropPct,
    copy: `the ${followDays} days after rough self-talk, habits drop ~${dropPct}%. how you talk to you = how you build.`,
    copy_es: `los ${followDays} días después de hablarte feo, los hábitos bajan ~${dropPct}%. cómo te hablas = cómo construyes.`,
  };
}
