/**
 * @ollie/logic · habits phase-2 detectors (tier-2 & tier-4 public)
 *
 * Output shape: { signal, confidence, evidence, copy, copy_es, sources?, ts? }
 * (detectHabitDrift and detectFrictionSignature return arrays)
 *
 * Pure: no store reads, no DOM, no Date.now().
 */

import type { HabitsHistory, HabitsOpts, HabitSignal, Habit } from './types';
import { mean, buildDayCompletionMap } from './helpers';
import { DAY_MS, dayKey } from '../util';

// ─── detectFreshStartCrash ────────────────────────────────────────────

export function detectFreshStartCrash(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 90;
  const minBoundaryCreates = o.minBoundaryCreates ?? 3;
  const minSilentAfter = o.minSilentAfter ?? 2;
  const earlyDays = o.earlyDays ?? 6;
  const silenceDays = o.silenceDays ?? 21;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  if (arr.length === 0) return null;

  const FRESH_RE = /\b(starting over|from monday|this is the last time|new month new me|yeniden|yeni başlangıç|pazartesiden)\b/i;

  const isBoundary = (ts: number): boolean => {
    const d = new Date(ts);
    if (d.getUTCDay() === 1) return true;
    if (d.getUTCDate() === 1) return true;
    return false;
  };

  let boundaryCreates = 0, silentAfter = 0;
  for (const h of arr) {
    if (!h || typeof h.created_at !== 'number') continue;
    if (h.created_at < windowStart || h.created_at > now) continue;
    if (!isBoundary(h.created_at)) continue;
    boundaryCreates++;

    const list = h.completions ?? [];
    const tsList = list
      .filter(e => e && typeof e.ts === 'number')
      .map(e => e.ts)
      .sort((a, b) => a - b);
    const createdAt = h.created_at as number;
    const earlyEnd = createdAt + earlyDays * DAY_MS;
    const earlyHits = tsList.filter(t => t >= createdAt && t <= earlyEnd);
    if (earlyHits.length >= 1 && earlyHits.length <= 6) {
      const lastTs = tsList.length > 0 ? tsList[tsList.length - 1] : h.created_at;
      if (now - lastTs >= silenceDays * DAY_MS) silentAfter++;
    }
  }

  let dumpMarkers = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (FRESH_RE.test(text)) dumpMarkers++;
  }

  if (boundaryCreates < minBoundaryCreates) return null;
  if (silentAfter < minSilentAfter) return null;

  const score =
    (boundaryCreates >= 5 ? 1 : 0) +
    (silentAfter >= 3 ? 1 : 0) +
    (dumpMarkers >= 2 ? 1 : 0);
  const confidence: HabitSignal['confidence'] = score >= 2 ? 'high' : score >= 1 ? 'medium' : 'low';

  return {
    signal: 'habits_fresh_start_crash',
    confidence,
    evidence: [
      'boundary_creates:' + boundaryCreates,
      'silent_after:' + silentAfter,
      'dump_markers:' + dumpMarkers,
    ],
    copy:
      'you create new habits on landmarks, then they go quiet for weeks. '
      + 'landmark dependency, not failure. restart re-entry is the leverage point — when do you usually come back?',
    copy_es:
      'creas hábitos nuevos en fechas hito y después se quedan en silencio semanas. '
      + 'dependencia del hito, no carencia. reentrar después de un parón es la palanca — ¿cuándo sueles volver?',
    sources: [
      { citation: 'Dai, Milkman & Riis 2014, Management Science — fresh start effect', url: 'https://doi.org/10.1287/mnsc.2014.1901' },
      { citation: 'Strohmeier et al. 2016, Psychiatry Research — perfectionism in adult ADHD' },
    ],
    ts: now,
  };
}

// ─── detectIdentityFraming ────────────────────────────────────────────

export function detectIdentityFraming(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 30;
  const minDisavowal = o.minDisavowal ?? 2;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps ?? [];
  if (dumps.length === 0) return null;

  const DISAVOW_EN = /\bi'?m not (?:a |an |the )?\w+/i;
  const DISAVOW_TR = /\b(yapamam|yapamıyorum|olamıyorum)\s+\w+/i;
  const ACTION_EN = /\bi (?:run|write|cook|practice|read|meditate|train|cycle|stretch|journal|study)\b/i;
  const ACTION_TR = /\b(?:koşarım|yazarım|pişiririm|okurum|meditasyon yaparım|çalışıyorum)\b/i;

  let disavowal = 0, actionFraming = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (DISAVOW_EN.test(text) || DISAVOW_TR.test(text)) disavowal++;
    if (ACTION_EN.test(text) || ACTION_TR.test(text)) actionFraming++;
  }

  if (disavowal < minDisavowal) return null;
  if (disavowal <= actionFraming) return null;

  const ratio = actionFraming === 0 ? disavowal : disavowal / actionFraming;
  const confidence: HabitSignal['confidence'] = (ratio >= 4 || disavowal >= 5) ? 'high'
    : (ratio >= 2 ? 'medium' : 'low');

  return {
    signal: 'habits_identity_framing',
    confidence,
    evidence: [
      'disavowal:' + disavowal,
      'action_framing:' + actionFraming,
    ],
    copy:
      'you talked about not being a [thing] more than doing [thing]. '
      + 'role tags can scaffold or sabotage — your call which.',
    copy_es:
      'hablaste de no ser [cosa] más que de hacer [cosa]. '
      + 'las etiquetas de rol pueden andamiar o sabotear — tú decides cuál.',
    sources: [
      { citation: 'Verplanken & Sui 2019, Frontiers in Psychology', url: 'https://doi.org/10.3389/fpsyg.2019.01504' },
      { citation: 'Jones & Hesse 2018, Journal of Attention Disorders' },
      { citation: 'Larsen et al. 2025, PMC11956369' },
    ],
    ts: now,
  };
}

// ─── detectBodyVsCognitive ────────────────────────────────────────────

export function detectBodyVsCognitive(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 28;
  const minPerSide = o.minPerSide ?? 3;
  const minCompletionsPerHabit = o.minCompletionsPerHabit ?? 4;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.4;
  const windowStart = now - windowDays * DAY_MS;

  const BODY_RE = /\b(walk|stretch|water|cold|hydrate|exercise|workout|yoga|sleep|drink|move)\b/i;
  const COG_RE = /\b(meditate|journal|plan|read|think|reflect|study|review)\b/i;

  const arr = history.habits ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0) return null;

  const slotMap = new Map<string, { kind: 'body' | 'cog'; count: number }>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    const tags = [h.category, h.label, h.name].filter(Boolean).join(' ');
    const isBody = BODY_RE.test(tags);
    const isCog = COG_RE.test(tags);
    if (isBody === isCog) continue;
    slotMap.set(h.id, { kind: isBody ? 'body' : 'cog', count: 0 });
  }
  if (slotMap.size === 0) return null;

  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      if (c.ts < windowStart || c.ts > now) continue;
      const slot = c.habit_id ? slotMap.get(c.habit_id) : undefined;
      if (slot) slot.count++;
    }
  } else {
    for (const h of arr) {
      if (!h || !h.id) continue;
      const slot = slotMap.get(h.id);
      if (!slot) continue;
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts < windowStart || e.ts > now) continue;
        slot.count++;
      }
    }
  }

  const bodyRates: number[] = [], cogRates: number[] = [];
  for (const slot of slotMap.values()) {
    if (slot.count < minCompletionsPerHabit) continue;
    const rate = slot.count / windowDays;
    (slot.kind === 'body' ? bodyRates : cogRates).push(rate);
  }
  if (bodyRates.length < minPerSide || cogRates.length < minPerSide) return null;

  const bodyRate = mean(bodyRates);
  const cogRate = mean(cogRates);
  if (cogRate === 0) return null;
  const lift = bodyRate / cogRate;
  if (lift < minLift) return null;

  const confidence: HabitSignal['confidence'] = lift >= 2.0 ? 'high' : lift >= 1.6 ? 'medium' : 'low';
  const bodyPct = Math.round(bodyRate * 100);
  const cogPct = Math.round(cogRate * 100);

  return {
    signal: 'habits_body_vs_cognitive',
    confidence,
    evidence: [
      'body_rate:' + (Math.round(bodyRate * 100) / 100),
      'cog_rate:' + (Math.round(cogRate * 100) / 100),
      'body_n:' + bodyRates.length,
      'cog_n:' + cogRates.length,
    ],
    copy:
      'body habits land at ' + bodyPct + '% / cognitive habits at ' + cogPct + '%. '
      + 'body is the anchor — cognitive habits attach better when stacked onto somatic ones.',
    copy_es:
      'los hábitos corporales aterrizan al ' + bodyPct + '% / los cognitivos al ' + cogPct + '%. '
      + 'el cuerpo es el ancla — los hábitos cognitivos pegan mejor apilados sobre los somáticos.',
    sources: [
      { citation: 'Cerrillo-Urbina et al. 2015, Pediatrics — exercise meta-analysis in ADHD' },
      { citation: 'Christiansen et al. 2019 — catecholamine release in ADHD' },
    ],
    ts: now,
  };
}

// ─── detectHabitDrift ─────────────────────────────────────────────────

export function detectHabitDrift(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal[] | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const halfDays = o.halfDays ?? 14;
  const minExpected = o.minExpected ?? 4;
  const maxRatio = typeof o.maxRatio === 'number' ? o.maxRatio : 0.7;

  const arr = history.habits ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0) return null;

  const recentStart = now - halfDays * DAY_MS;
  const priorStart = now - 2 * halfDays * DAY_MS;

  const perHabit = new Map<string, { habit: Habit; recent: number; prior: number }>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    perHabit.set(h.id, { habit: h, recent: 0, prior: 0 });
  }

  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      const slot = c.habit_id ? perHabit.get(c.habit_id) : undefined;
      if (!slot) continue;
      if (c.ts >= recentStart && c.ts <= now) slot.recent++;
      else if (c.ts >= priorStart && c.ts < recentStart) slot.prior++;
    }
  } else {
    for (const h of arr) {
      if (!h || !h.id) continue;
      const slot = perHabit.get(h.id);
      if (!slot) continue;
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts >= recentStart && e.ts <= now) slot.recent++;
        else if (e.ts >= priorStart && e.ts < recentStart) slot.prior++;
      }
    }
  }

  const out: HabitSignal[] = [];
  for (const slot of perHabit.values()) {
    if (slot.recent < minExpected && slot.prior < minExpected) continue;
    if (slot.prior < minExpected) continue;
    if (slot.prior === 0) continue;
    const recentRate = slot.recent / halfDays;
    const priorRate = slot.prior / halfDays;
    if (priorRate === 0) continue;
    const ratio = recentRate / priorRate;
    if (ratio > maxRatio) continue;
    const dropPct = Math.round((1 - ratio) * 100);
    const recentPct = Math.round(recentRate * 100);
    const priorPct = Math.round(priorRate * 100);
    const label = slot.habit.label ?? slot.habit.name ?? slot.habit.id;
    out.push({
      signal: 'habits_drift',
      habit_id: slot.habit.id,
      recent_rate: Math.round(recentRate * 100) / 100,
      prior_rate: Math.round(priorRate * 100) / 100,
      drop_pct: dropPct,
      confidence: 'medium',
      evidence: ['habit_id:' + slot.habit.id, 'drop_pct:' + dropPct],
      copy:
        label + ' — completing at ' + recentPct + '% these 2 weeks, '
        + 'was ' + priorPct + '% the 2 before. data point, not data trend.',
      copy_es:
        label + ' — cierre al ' + recentPct + '% estas 2 semanas, '
        + 'estaba al ' + priorPct + '% las 2 anteriores. dato, no tendencia.',
      sources: [
        { citation: 'Lally et al. 2010, European Journal of Social Psychology — habit formation', url: 'https://doi.org/10.1002/ejsp.674' },
      ],
      ts: now,
    });
  }
  return out.length > 0 ? out : null;
}

// ─── detectFrictionSignature ──────────────────────────────────────────

export function detectFrictionSignature(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal[] | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minWeeks = o.minWeeks ?? 4;
  const minRatio = typeof o.minRatio === 'number' ? o.minRatio : 1.8;
  const minDiff = typeof o.minDiff === 'number' ? o.minDiff : 0.3;
  const windowDays = o.windowDays ?? (minWeeks * 7);
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0) return null;

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const out: HabitSignal[] = [];

  for (const h of arr) {
    if (!h || !h.id) continue;
    const dowOccurrences = [0, 0, 0, 0, 0, 0, 0];
    for (let t = windowStart; t <= now; t += DAY_MS) {
      dowOccurrences[new Date(t).getUTCDay()]++;
    }
    const dowHits = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    if (flatCompletions) {
      for (const c of flatCompletions) {
        if (!c || c.habit_id !== h.id || typeof c.ts !== 'number') continue;
        if (c.ts < windowStart || c.ts > now) continue;
        dowHits[new Date(c.ts).getUTCDay()]++;
        total++;
      }
    } else {
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts < windowStart || e.ts > now) continue;
        dowHits[new Date(e.ts).getUTCDay()]++;
        total++;
      }
    }
    if (total < minWeeks) continue;

    const rates = dowHits.map((c, i) => dowOccurrences[i] === 0 ? 0 : c / dowOccurrences[i]);
    const max = Math.max(...rates);
    const validMins = rates.filter((_, i) => dowOccurrences[i] > 0);
    if (validMins.length === 0) continue;
    const min = Math.min(...validMins);
    if (min === 0 && max === 0) continue;
    if (min === 0) continue;
    const ratio = max / min;
    const diff = max - min;
    if (ratio < minRatio || diff < minDiff) continue;

    const worstIdx = rates.indexOf(min);
    const bestIdx = rates.indexOf(max);
    const worstDay = DAY_NAMES[worstIdx];
    const worstRate = Math.round(min * 100);
    const bestRate = Math.round(max * 100);
    const label = h.label ?? h.name ?? h.id;
    out.push({
      signal: 'habits_friction_signature',
      habit_id: h.id,
      worst_day: worstDay,
      worst_rate: Math.round(min * 100) / 100,
      best_rate: Math.round(max * 100) / 100,
      best_day: DAY_NAMES[bestIdx],
      confidence: 'medium',
      evidence: ['habit_id:' + h.id, 'worst_day:' + worstDay, 'ratio:' + (Math.round(ratio * 100) / 100)],
      copy:
        label + ' sticks on ' + worstDay + 's — completion drops from '
        + bestRate + '% to ' + worstRate + '%. friction has a shape.',
      copy_es:
        label + ' se atasca los ' + worstDay + 's — el cierre baja del '
        + bestRate + '% al ' + worstRate + '%. la fricción tiene forma.',
      sources: [
        { citation: 'ADHD weekly executive function variability — clinical observation' },
      ],
      ts: now,
    });
  }
  return out.length > 0 ? out : null;
}

// ─── detectSleepHabitCoupling ─────────────────────────────────────────

export function detectSleepHabitCoupling(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minLowSleepN = o.minLowSleepN ?? 7;
  const minNormalN = o.minNormalN ?? 7;
  const lowTstMin = typeof o.lowTstMin === 'number' ? o.lowTstMin : 360;
  const maxRatio = typeof o.maxRatio === 'number' ? o.maxRatio : 0.7;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const sleep = history.sleepRecords ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0 || sleep.length === 0) return null;

  const habitsActive = arr.length;

  const dayCompletions = buildDayCompletionMap(arr, flatCompletions, windowStart, now);

  const lowSleepFollowDays = new Set<string>();
  const normalSleepFollowDays = new Set<string>();
  for (const r of sleep) {
    if (!r || r.is_skipped) continue;
    if (typeof r.tst_min !== 'number') continue;
    // Day-key the sleep record in LOCAL time so the follow-day key shares the
    // same key-space as `dayCompletions` (built with the LOCAL `dayKey`). A
    // date-only `night_of` is anchored at LOCAL noon ('T12:00:00', no 'Z') so
    // a ±12h shift can never cross a calendar boundary — the record maps to
    // exactly that calendar day with no off-by-one.
    let baseTs: number | null = null;
    if (typeof r.ts === 'number') baseTs = r.ts;
    else if (typeof r.night_of === 'string') {
      const t = Date.parse(r.night_of + 'T12:00:00');
      if (!isNaN(t)) baseTs = t;
    }
    if (baseTs == null) continue;
    if (baseTs < windowStart || baseTs > now) continue;
    const followKey = dayKey(baseTs + DAY_MS);
    if (r.tst_min < lowTstMin) lowSleepFollowDays.add(followKey);
    else normalSleepFollowDays.add(followKey);
  }
  if (lowSleepFollowDays.size < minLowSleepN) return null;
  if (normalSleepFollowDays.size < minNormalN) return null;

  let lowComp = 0, lowDays = 0, normalComp = 0, normalDays = 0;
  for (const k of lowSleepFollowDays) {
    lowComp += (dayCompletions.get(k) ?? 0);
    lowDays++;
  }
  for (const k of normalSleepFollowDays) {
    if (lowSleepFollowDays.has(k)) continue;
    normalComp += (dayCompletions.get(k) ?? 0);
    normalDays++;
  }
  if (normalDays < minNormalN) return null;

  const lowRate = lowComp / (lowDays * habitsActive);
  const normalRate = normalComp / (normalDays * habitsActive);
  if (normalRate === 0) return null;
  const ratio = lowRate / normalRate;
  if (ratio > maxRatio) return null;

  const lowPct = Math.round(lowRate * 100);
  const normalPct = Math.round(normalRate * 100);
  const confidence: HabitSignal['confidence'] = ratio < 0.4 ? 'high' : ratio < 0.55 ? 'medium' : 'low';

  return {
    signal: 'habits_sleep_coupling',
    confidence,
    evidence: [
      'low_sleep_n:' + lowDays,
      'normal_n:' + normalDays,
      'low_post_rate:' + (Math.round(lowRate * 100) / 100),
      'normal_post_rate:' + (Math.round(normalRate * 100) / 100),
    ],
    copy:
      'after nights under 6h, habit completion drops to ' + lowPct + '% '
      + '(vs ' + normalPct + '% on normal nights). prosthetic environment beats willpower on those days.',
    copy_es:
      'después de noches de menos de 6h, el cierre de hábitos baja al ' + lowPct + '% '
      + '(vs ' + normalPct + '% en noches normales). el entorno prostético le gana a la fuerza de voluntad esos días.',
    sources: [
      { citation: 'Yoo et al. 2007, Current Biology — sleep deprivation × prefrontal-amygdala' },
      { citation: 'Walker 2017 — Why We Sleep' },
    ],
    ts: now,
  };
}

// ─── detectHabitRebirth ───────────────────────────────────────────────

export function detectHabitRebirth(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 180;
  const minGapDays = o.minGapDays ?? 21;
  const reentryDays = o.reentryDays ?? 14;
  const minRebirths = o.minRebirths ?? 2;
  const windowStart = now - windowDays * DAY_MS;
  const reentryStart = now - reentryDays * DAY_MS;

  const arr = history.habits ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length === 0) return null;

  const perHabitTs = new Map<string, number[]>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    perHabitTs.set(h.id, []);
  }
  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      if (c.ts < windowStart || c.ts > now) continue;
      const list = c.habit_id ? perHabitTs.get(c.habit_id) : undefined;
      if (list) list.push(c.ts);
    }
  } else {
    for (const h of arr) {
      if (!h || !h.id) continue;
      const list = perHabitTs.get(h.id);
      if (!list) continue;
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts < windowStart || e.ts > now) continue;
        list.push(e.ts);
      }
    }
  }

  const rebirthHabits = new Set<string>();
  const gapDays: number[] = [];
  for (const [hid, tsList] of perHabitTs.entries()) {
    if (tsList.length < 2) continue;
    tsList.sort((a, b) => a - b);
    let longest = 0, longestEndTs = 0;
    for (let i = 1; i < tsList.length; i++) {
      const gap = tsList[i] - tsList[i - 1];
      if (gap > longest) { longest = gap; longestEndTs = tsList[i]; }
    }
    const gapD = longest / DAY_MS;
    if (gapD < minGapDays) continue;
    if (longestEndTs < reentryStart) continue;
    rebirthHabits.add(hid);
    gapDays.push(gapD);
  }
  if (rebirthHabits.size < minRebirths) return null;

  const avgGap = Math.round(gapDays.reduce((s, x) => s + x, 0) / gapDays.length);

  return {
    signal: 'habits_rebirth_pattern',
    rebirths_n: rebirthHabits.size,
    confidence: 'medium',
    evidence: [
      'rebirth_count:' + rebirthHabits.size,
      'avg_gap_days:' + avgGap,
    ],
    copy:
      'habits don\'t die for you — they cycle. you\'ve restarted '
      + rebirthHabits.size + ' habits after long pauses. cyclical, not broken.',
    copy_es:
      'los hábitos no se mueren contigo — son cíclicos. has reiniciado '
      + rebirthHabits.size + ' hábitos después de pausas largas. cíclico, no truncado.',
    sources: [
      { citation: 'ADHD habit-formation cyclicity — clinical observation' },
    ],
    ts: now,
  };
}

// ─── detectSelfTalkHabit ──────────────────────────────────────────────

export function detectSelfTalkHabit(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const followDays = o.followDays ?? 3;
  const minEvents = o.minEvents ?? 3;
  const minHabits = o.minHabits ?? 2;
  const maxRatio = typeof o.maxRatio === 'number' ? o.maxRatio : 0.7;
  const windowStart = now - windowDays * DAY_MS;

  const SELF_TALK_RE = /\b(stupid|lazy|useless|worthless|i suck|i'm bad|nothing works|aptal|tembel|işe yaramaz|berbat)\b/i;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  const flatCompletions = history.completions ?? null;
  if (arr.length < minHabits || dumps.length === 0) return null;

  const habitsActive = arr.length;
  const allTs: number[] = [];
  if (flatCompletions) {
    for (const c of flatCompletions) {
      if (!c || typeof c.ts !== 'number') continue;
      if (c.ts < windowStart || c.ts > now) continue;
      allTs.push(c.ts);
    }
  } else {
    for (const h of arr) {
      for (const e of h.completions ?? []) {
        if (!e || typeof e.ts !== 'number') continue;
        if (e.ts < windowStart || e.ts > now) continue;
        allTs.push(e.ts);
      }
    }
  }

  const events: number[] = [];
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (!SELF_TALK_RE.test(text)) continue;
    events.push(d.ts);
  }
  if (events.length < minEvents) return null;

  let dropSum = 0, validEvents = 0;
  for (const ts of events) {
    const preStart = ts - followDays * DAY_MS;
    const postEnd = ts + followDays * DAY_MS;
    const preCount = allTs.filter(t => t >= preStart && t < ts).length;
    const postCount = allTs.filter(t => t > ts && t <= postEnd).length;
    const preExpected = followDays * habitsActive;
    const postExpected = followDays * habitsActive;
    if (preExpected < minHabits || postExpected < minHabits) continue;
    const preRate = preCount / preExpected;
    const postRate = postCount / postExpected;
    if (preRate === 0) continue;
    dropSum += (postRate / preRate);
    validEvents++;
  }
  if (validEvents < minEvents) return null;

  const avgRatio = dropSum / validEvents;
  if (avgRatio > maxRatio) return null;

  const dropPct = Math.round((1 - avgRatio) * 100);
  const confidence: HabitSignal['confidence'] = avgRatio < 0.4 ? 'high' : avgRatio < 0.55 ? 'medium' : 'low';

  return {
    signal: 'habits_self_talk_drop',
    confidence,
    evidence: [
      'self_talk_events:' + validEvents,
      'avg_drop_pct:' + dropPct,
    ],
    copy:
      'after harsh self-talk, completion drops ~' + dropPct + '% for ~'
      + followDays + ' days. the language matters mechanically, not just emotionally.',
    copy_es:
      'después de hablarte duro, el cierre baja ~' + dropPct + '% durante ~'
      + followDays + ' días. el lenguaje importa mecánicamente, no solo emocionalmente.',
    sources: [
      { citation: 'Sirois & Pychyl 2013 — self-compassion × procrastination' },
      { citation: 'Nolen-Hoeksema 1991 — rumination response styles' },
    ],
    ts: now,
  };
}
