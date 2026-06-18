/**
 * @ollie/logic · habits cross-module detectors (phase 3 & 4)
 *
 * H14 hyperfocus spillover (Hupfeld 2019) — consumes work crash log.
 * Keystone anchor (Wood & Neal 2007) — same-day habit stacking.
 * Med adherence coupling (Cortese 2018) — stimulant-mention lift.
 *
 * Pure: no store reads, no DOM, no Date.now().
 */

import type { HabitsHistory, HabitsOpts, HabitSignal } from './types';
import { dayKey, buildDayCompletionMap } from './helpers';
import { DAY_MS, eachLocalDayKey, addLocalDays } from '../util';

// ─── detectHyperfocusSpillover ────────────────────────────────────────

export function detectHyperfocusSpillover(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const minCrashes = o.minCrashes ?? 3;
  const minDropRatio = typeof o.minDropRatio === 'number' ? o.minDropRatio : 0.7;
  const followDays = o.followDays ?? 2;
  const windowDays = o.windowDays ?? 60;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  const crashLog = history.workCrashLog ?? null;
  if (!crashLog || crashLog.length === 0 || arr.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const crashDays = new Set<string>();
  for (const c of crashLog) {
    if (!c || c.reply !== 'yes') continue;
    const ts = c.session_at ?? c.ts;
    if (typeof ts !== 'number') continue;
    if (ts < windowStart || ts > now) continue;
    crashDays.add(dayKey(ts));
  }
  if (crashDays.size < minCrashes) return null;

  const postSet = new Set<string>();
  for (const k of crashDays) {
    const t = Date.parse(k + 'T12:00:00');
    if (isNaN(t)) continue;
    for (let i = 1; i <= followDays; i++) postSet.add(dayKey(addLocalDays(t, i)));
  }

  let postCompletions = 0, postDays = 0, baselineCompletions = 0, baselineDays = 0;
  for (const k of eachLocalDayKey(windowStart, now)) {
    const cs = dayCompletions.get(k) ?? 0;
    if (postSet.has(k)) { postCompletions += cs; postDays++; }
    else if (!crashDays.has(k)) { baselineCompletions += cs; baselineDays++; }
  }
  if (postDays < followDays || baselineDays < 7) return null;

  const postRate = postCompletions / (postDays * habitsActive);
  const baselineRate = baselineCompletions / (baselineDays * habitsActive);
  if (baselineRate === 0) return null;
  const ratio = postRate / baselineRate;
  if (ratio >= minDropRatio) return null;

  const dropPct = Math.round((1 - ratio) * 100);
  return {
    pattern: 'hyperfocus-spillover',
    signal: 'hyperfocus-spillover',
    confidence: ratio < 0.4 ? 'high' : 'medium',
    sample_n: postDays + baselineDays,
    crash_count: crashDays.size,
    drop_percent: dropPct,
    evidence: ['crash_days:' + crashDays.size, 'drop_pct:' + dropPct, 'strong-theory'],
    copy: `long-focus days have cost about ${dropPct}% of next-day habit completion across ${crashDays.size} crashes. crash and recovery, not failure.`,
    copy_es: `los días de foco largo cuestan ~${dropPct}% del cierre de hábitos del día siguiente en ${crashDays.size} bajones. bajón y recuperación, no carencia.`,
    sources: [
      {
        citation: 'Hupfeld, Abagis & Shah 2019, ADHD Atten Defic Hyperact Disord — hyperfocus dimension',
        url: 'https://doi.org/10.1007/s12402-018-0272-y',
      },
    ],
  };
}

// ─── detectKeystoneAnchor ─────────────────────────────────────────────

export function detectKeystoneAnchor(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minOverlap = o.minOverlap ?? 6;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.5;
  const minBaselineRate = typeof o.minBaselineRate === 'number' ? o.minBaselineRate : 0.15;
  const windowStart = now - windowDays * DAY_MS;

  const arr = history.habits ?? [];
  if (arr.length < 2) return null;

  const perHabitDays = new Map<string, { habit: typeof arr[0]; days: Set<string> }>();
  for (const h of arr) {
    if (!h || !h.id) continue;
    const set = new Set<string>();
    for (const e of h.completions ?? []) {
      if (!e || typeof e.ts !== 'number' || e.ts < windowStart || e.ts > now) continue;
      set.add(dayKey(e.ts));
    }
    perHabitDays.set(h.id, { habit: h, days: set });
  }

  const totalDays = windowDays;
  let best: {
    anchor_name: string; follower_name: string;
    anchor_days: number; follower_days: number;
    overlap_days: number; cond_rate: number;
    baseline_rate: number; lift: number;
  } | null = null;

  const ids = Array.from(perHabitDays.keys());
  for (const aId of ids) {
    const a = perHabitDays.get(aId)!;
    if (a.days.size < minOverlap) continue;
    for (const bId of ids) {
      if (aId === bId) continue;
      const b = perHabitDays.get(bId)!;
      const baselineRate = b.days.size / totalDays;
      if (baselineRate < minBaselineRate) continue;
      let inter = 0;
      for (const k of a.days) if (b.days.has(k)) inter++;
      if (inter < Math.min(a.days.size, 4)) continue;
      const condRate = inter / a.days.size;
      if (baselineRate === 0) continue;
      const lift = condRate / baselineRate;
      if (lift < minLift) continue;
      if (!best || lift > best.lift) {
        best = {
          anchor_name: a.habit?.name ?? aId,
          follower_name: b.habit?.name ?? bId,
          anchor_days: a.days.size,
          follower_days: b.days.size,
          overlap_days: inter,
          cond_rate: condRate,
          baseline_rate: baselineRate,
          lift,
        };
      }
    }
  }
  if (!best) return null;

  const confidence: HabitSignal['confidence'] = (best.overlap_days >= 10 && best.lift >= 2.0) ? 'high'
    : (best.lift >= 1.7 ? 'medium' : 'low');

  return {
    signal: 'keystone_anchor',
    pattern: 'keystone-anchor',
    confidence,
    sample_n: totalDays,
    anchor: best.anchor_name,
    follower: best.follower_name,
    lift: Number(best.lift.toFixed(2)),
    cond_rate: Number(best.cond_rate.toFixed(2)),
    baseline_rate: Number(best.baseline_rate.toFixed(2)),
    overlap_days: best.overlap_days,
    evidence: [
      'anchor:' + best.anchor_name,
      'follower:' + best.follower_name,
      'lift:' + Number(best.lift.toFixed(2)),
      'overlap_days:' + best.overlap_days,
    ],
    copy: 'on days "' + best.anchor_name + '" happens, "' + best.follower_name + '" happens ' + Math.round(best.lift * 100 - 100) + '% more often than baseline. pattern, not rule.',
    copy_es: 'los días en que pasa "' + best.anchor_name + '", "' + best.follower_name + '" pasa ' + Math.round(best.lift * 100 - 100) + '% más que en línea base. patrón, no regla.',
    sources: [
      { citation: 'Wood & Neal 2007, Psychological Review — context-cue habit stacking', url: 'https://doi.org/10.1037/0033-295X.114.4.843' },
    ],
  };
}

// ─── detectMedAdherenceCoupling ───────────────────────────────────────

export function detectMedAdherenceCoupling(
  history: HabitsHistory,
  opts?: HabitsOpts,
): HabitSignal | null {
  const o = opts ?? {};
  const now = typeof o.now === 'number' ? o.now
    : typeof history.now === 'number' ? history.now
    : Date.now();
  const windowDays = o.windowDays ?? 60;
  const minMedDays = o.minMedDays ?? 5;
  const minBaselineDays = o.minBaselineDays ?? 10;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.3;
  const windowStart = now - windowDays * DAY_MS;

  const STIM_RE = /\b(vyvanse|adderall|ritalin|methylphenidate|dexedrine|elvanse|concerta|focalin|stratter|atomoxetine|wellbutrin|bupropion|stimulant|adhd\s+med|adhd\s+pill|took\s+(?:my\s+)?meds?|took\s+the\s+pill)\b/i;

  const arr = history.habits ?? [];
  const dumps = history.dumps ?? [];
  if (arr.length === 0 || dumps.length === 0) return null;

  const habitsActive = arr.length;
  const dayCompletions = buildDayCompletionMap(arr, history.completions ?? null, windowStart, now);

  const medDays = new Set<string>();
  const observedDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const k = dayKey(d.ts);
    observedDays.add(k);
    const text = String(d.rawText ?? d.text ?? '');
    if (STIM_RE.test(text)) medDays.add(k);
  }
  if (medDays.size < minMedDays) return null;

  const baselineDaysSet = new Set<string>();
  for (const k of observedDays) if (!medDays.has(k)) baselineDaysSet.add(k);
  if (baselineDaysSet.size < minBaselineDays) return null;

  let medCompletions = 0, baseCompletions = 0;
  for (const k of medDays) medCompletions += (dayCompletions.get(k) ?? 0);
  for (const k of baselineDaysSet) baseCompletions += (dayCompletions.get(k) ?? 0);

  const medRate = medCompletions / (medDays.size * habitsActive);
  const baseRate = baseCompletions / (baselineDaysSet.size * habitsActive);

  if (baseRate === 0) {
    if (medRate < 0.2) return null;
  } else {
    if (medRate / baseRate < minLift) return null;
  }

  const lift = baseRate === 0 ? null : medRate / baseRate;
  const confidence: HabitSignal['confidence'] = (medDays.size >= 8 && (lift == null || lift >= 1.6)) ? 'high'
    : (lift == null || lift >= 1.4) ? 'medium' : 'low';

  return {
    signal: 'med_adherence_coupling',
    pattern: 'med-adherence-coupling',
    confidence,
    sample_n: medDays.size + baselineDaysSet.size,
    med_days: medDays.size,
    baseline_days: baselineDaysSet.size,
    med_rate: Number(medRate.toFixed(2)),
    baseline_rate: Number(baseRate.toFixed(2)),
    lift: lift == null ? null : Number(lift.toFixed(2)),
    evidence: [
      'med_days:' + medDays.size,
      'baseline_days:' + baselineDaysSet.size,
      'med_rate:' + Number(medRate.toFixed(2)),
      'lift:' + (lift == null ? 'n/a' : Number(lift.toFixed(2))),
    ],
    copy: 'on days you mention meds, habit completion rate runs ' + Math.round((lift ?? 1.4) * 100 - 100) + '% above baseline days. pattern, not prescription.',
    copy_es: 'los días que mencionas la medicación, el cierre de hábitos sube ' + Math.round((lift ?? 1.4) * 100 - 100) + '% sobre los días base. patrón, no prescripción.',
    sources: [
      { citation: 'Cortese et al. 2018, Lancet Psychiatry — comparative efficacy of ADHD medications', url: 'https://doi.org/10.1016/S2215-0366(18)30269-4' },
    ],
  };
}
