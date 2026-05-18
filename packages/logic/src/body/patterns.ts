/**
 * @ollie/logic · body pattern detectors
 *
 * All hydration, symptom, movement, supplement, GI, and cross-module pattern
 * detectors ported from void-app.html window.VOID.logic.body (lines ~8833–10966).
 *
 * Every function is PURE:
 *   - `now` is always read from history.now (never Date.now() in hot path)
 *   - No store / DOM / event reads
 *   - Immutable: never mutates inputs
 */

import {
  dayKey,
  pearson,
  spearman,
  nextDayKey,
} from './math';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../util';

import {
  HEADACHE_RE,
  TUKEN_RE,
  BACK_RE,
  STOMACH_RE,
  JAW_RE,
  NECK_RE,
  NAUSEA_RE,
  VASOMOTOR_RE,
  FOOD_RE,
  CAFFEINE_RE,
  MOVEMENT_RE,
  SYMPTOM_REGEXES,
} from './regexes';

import type {
  BodyHistory,
  BodyPatternOpts,
  WaterEntry,
  HeadacheHydrationPattern,
  InteroceptionDriftPattern,
  HyperfocusDehydrationPattern,
  AfternoonCrashWindowPattern,
  SupplementDriftPattern,
  MultiSymptomRecurrencePattern,
  HungerThirstConfusionPattern,
  CaffeineWaterTradeoffPattern,
  MealSkipPattern,
  GISymptomCyclePhasePattern,
  MovementGapPattern,
  VasomotorPattern,
  SymptomPhaseCouplingPattern,
  SleepDebtSymptomLagPattern,
  AnyBodyPattern,
} from './types';

// ─── Internal helpers ────────────────────────────────────────────────────────

function resolveNow(history: BodyHistory): number {
  return (typeof history.now === 'number') ? history.now : Date.now();
}

function waterTs(entry: WaterEntry): number | null {
  if (typeof entry === 'number') return entry;
  if (entry && typeof entry.ts === 'number') return entry.ts;
  return null;
}

function waterGlasses(entry: WaterEntry): number {
  if (typeof entry === 'number') return 1;
  const g = (entry as { ts: number; glasses?: number }).glasses;
  return (typeof g === 'number' && g > 0) ? g : 1;
}

function phaseAtFn(sortedPhases: Array<{ ts: number; phase: string }>) {
  return (ts: number): string | null => {
    let cur: string | null = null;
    for (const p of sortedPhases) {
      if (p.ts <= ts) cur = p.phase;
      else break;
    }
    return cur;
  };
}

// ─── detectHeadacheHydration ─────────────────────────────────────────────────

export function detectHeadacheHydration(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): HeadacheHydrationPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 60;
  const minSampleDays = o.minSampleDays || 14;
  const minRunLength = o.minRunLength || 3;
  const minAbsR = typeof o.minAbsR === 'number' ? o.minAbsR : 0.3;
  const lowGlasses = typeof o.lowGlassesThreshold === 'number' ? o.lowGlassesThreshold : 2;
  const windowStart = now - windowDays * DAY_MS;

  const byDay: Record<string, { glasses_am: number; glasses_total: number; headache: number; hasData: boolean }> = {};
  const ensure = (k: string) => {
    if (!byDay[k]) byDay[k] = { glasses_am: 0, glasses_total: 0, headache: 0, hasData: false };
    return byDay[k];
  };

  for (const entry of (history.waterLog || [])) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    const k = dayKey(ts);
    const rec = ensure(k);
    rec.glasses_total++;
    if (new Date(ts).getHours() < 12) rec.glasses_am++;
    rec.hasData = true;
  }

  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!HEADACHE_RE.test(text)) continue;
    const rec = ensure(dayKey(ts));
    rec.headache = 1;
    rec.hasData = true;
  }

  const observed = Object.entries(byDay)
    .filter(([, v]) => v.hasData)
    .map(([k, v]) => ({ key: k, glasses: v.glasses_am, headache: v.headache }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const n = observed.length;
  if (n < minSampleDays) return null;

  const cooccur = observed.filter(d => d.headache === 1 && d.glasses < lowGlasses).length;
  if (cooccur < minRunLength) return null;

  const xs = observed.map(d => d.glasses);
  const ys = observed.map(d => d.headache);
  const r = pearson(xs, ys);

  if (!(r <= -minAbsR)) return null;

  const absR = Math.abs(r);
  const confidence = absR >= 0.5 ? 'high' : absR >= 0.4 ? 'medium' : 'low';
  const headacheDays = observed.filter(d => d.headache === 1).length;

  return {
    pattern: 'headache-hydration',
    confidence,
    sample_n: n,
    date_range: { start: observed[0].key, end: observed[n - 1].key },
    r: Number(r.toFixed(3)),
    cooccurrences: cooccur,
    copy:
      `on days with fewer than ${lowGlasses} glasses before noon, you flagged a headache ` +
      `${cooccur} of ${headacheDays} times. ${n} days of data. pattern, not cause.`,
    source: {
      citation: 'Bruton et al. 2025, Psychophysiology — Diminished Interoceptive Accuracy in ADHD: A Systematic Review',
      url: 'https://doi.org/10.1111/psyp.14750',
    },
  };
}

// ─── detectInteroceptionDrift ─────────────────────────────────────────────────

export function detectInteroceptionDrift(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): InteroceptionDriftPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 14;
  const minEntries = o.minEntries || 8;
  const cvThreshold = typeof o.cvThreshold === 'number' ? o.cvThreshold : 1.5;
  const minRunLength = o.minRunLength || 3;
  const windowStart = now - windowDays * DAY_MS;

  const tsList: number[] = [];
  for (const entry of (history.waterLog || [])) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    tsList.push(ts);
  }
  tsList.sort((a, b) => a - b);
  if (tsList.length < minEntries) return null;

  const gaps: number[] = [];
  for (let i = 1; i < tsList.length; i++) gaps.push(tsList[i] - tsList[i - 1]);
  if (gaps.length < minRunLength) return null;

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(mean > 0)) return null;

  let variance = 0;
  for (const g of gaps) variance += (g - mean) * (g - mean);
  variance /= gaps.length;
  const sd = Math.sqrt(variance);
  const cv = sd / mean;
  if (!(cv > cvThreshold)) return null;

  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const mid = sortedGaps.length;
  const medianGap = mid % 2 === 0
    ? (sortedGaps[mid / 2 - 1] + sortedGaps[mid / 2]) / 2
    : sortedGaps[(mid - 1) / 2];

  const minMin = Math.round(Math.min(...gaps) / MINUTE_MS);
  const maxMin = Math.round(Math.max(...gaps) / MINUTE_MS);
  const medianMin = Math.round(medianGap / MINUTE_MS);
  const sampleN = tsList.length;
  const confidence = sampleN >= 25 ? 'high' : sampleN >= 14 ? 'medium' : 'low';

  const maxDescriptor = maxMin >= 60
    ? `${Math.round(maxMin / 60)} saate`
    : `${maxMin} dakikaya`;

  return {
    pattern: 'interoception_drift',
    confidence,
    sample_n: sampleN,
    date_range: { start: tsList[0], end: tsList[tsList.length - 1] },
    cv: Number(cv.toFixed(3)),
    min_gap_min: minMin,
    max_gap_min: maxMin,
    median_gap_min: medianMin,
    copy:
      `son ${windowDays} gün, su içme aralıkların ${minMin} dakikadan ${maxDescriptor} kadar geziyor. ` +
      `düzensiz değilsin — vücudun susuzluğu zamanında söyleyemiyor olabilir. pattern, not cause.`,
    source: {
      citation: 'Bruton et al. 2025, Psychophysiology — Diminished Interoceptive Accuracy in ADHD: A Systematic Review',
      url: 'https://doi.org/10.1111/psyp.14750',
    },
  };
}

// ─── detectHyperfocusDehydration ──────────────────────────────────────────────

export function detectHyperfocusDehydration(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): HyperfocusDehydrationPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 60;
  const minSessions = o.minSessions || 10;
  const ratioThreshold = typeof o.ratioThreshold === 'number' ? o.ratioThreshold : 0.3;
  const windowStart = now - windowDays * DAY_MS;

  const sessions = (history.focusSessions || []).filter(s =>
    s && typeof s.start === 'number' && typeof s.end === 'number' &&
    s.end > s.start && !(s.end < windowStart || s.start > now)
  ).map(s => ({
    start: Math.max(s.start, windowStart),
    end: Math.min(s.end, now),
  })).filter(s => s.end > s.start);

  if (sessions.length < minSessions) return null;

  let inFocusHours = 0;
  for (const s of sessions) inFocusHours += (s.end - s.start) / HOUR_MS;
  if (inFocusHours <= 0) return null;

  let validWaterCount = 0;
  let earliest = Infinity, latest = -Infinity;
  let inFocusGlasses = 0, outFocusGlasses = 0;
  for (const entry of (history.waterLog || [])) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    const glasses = waterGlasses(entry);
    if (glasses <= 0) continue;
    validWaterCount++;
    if (ts < earliest) earliest = ts;
    if (ts > latest) latest = ts;
    const inFocus = sessions.some(s => ts >= s.start && ts <= s.end);
    if (inFocus) inFocusGlasses += glasses;
    else outFocusGlasses += glasses;
  }
  if (validWaterCount === 0) return null;

  const obsSpanMs = Math.max(latest - earliest, 0);
  const outFocusHours = Math.max((obsSpanMs / HOUR_MS) - inFocusHours, 0);
  if (outFocusHours <= 0 || outFocusGlasses === 0) return null;

  const inFocusRate = inFocusGlasses / inFocusHours;
  const outFocusRate = outFocusGlasses / outFocusHours;
  if (outFocusRate === 0) return null;

  const ratio = inFocusRate / outFocusRate;
  if (!(ratio < ratioThreshold)) return null;

  const sampleN = sessions.length;
  const confidence = sampleN >= 25 ? 'high' : sampleN >= 15 ? 'medium' : 'low';
  const startTs = isFinite(earliest) ? earliest : windowStart;
  const endTs = isFinite(latest) ? latest : now;

  return {
    pattern: 'hyperfocus_dehydration',
    confidence,
    sample_n: sampleN,
    date_range: { start: dayKey(startTs), end: dayKey(endTs) },
    in_focus_rate: Number(inFocusRate.toFixed(2)),
    out_focus_rate: Number(outFocusRate.toFixed(2)),
    ratio: Number(ratio.toFixed(2)),
    copy:
      `focus session'larında saatte ${inFocusRate.toFixed(1)} bardak. session arası ${outFocusRate.toFixed(1)}. ` +
      `flow seni susuzluğa karşı sağırlaştırıyor. pattern, not cause.`,
    copy_envelope:
      `focus session'larında saatte ${inFocusRate.toFixed(1)} bardak, session arası ${outFocusRate.toFixed(1)}. ` +
      `interoseptif sinyaller bastırılıyor — bu kapasite ödünç alınmış, geri ödenmesi gerekiyor.`,
    source: {
      citation: 'Hupfeld et al. 2019, ADHD Atten Defic Hyperact Disord — Hyperfocus in ADHD',
      url: 'https://doi.org/10.1007/s12402-018-0272-y',
    },
  };
}

// ─── detectAfternoonCrashWindow ───────────────────────────────────────────────

export function detectAfternoonCrashWindow(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): AfternoonCrashWindowPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 30;
  const minSampleN = typeof o.minSampleN === 'number' ? o.minSampleN : 10;
  const peakShareThreshold = typeof o.peakShareThreshold === 'number' ? o.peakShareThreshold : 0.5;
  const minRunLength = typeof o.minRunLength === 'number' ? o.minRunLength : 3;
  const windowStart = now - windowDays * DAY_MS;

  const crashes: Array<{ ts: number; hour: number; dayKey: string }> = [];
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!TUKEN_RE.test(text)) continue;
    const dt = new Date(ts);
    crashes.push({ ts, hour: dt.getHours(), dayKey: dayKey(ts) });
  }

  const sampleN = crashes.length;
  if (sampleN < minSampleN) return null;

  const hourCounts = new Array(24).fill(0);
  for (const c of crashes) hourCounts[c.hour]++;

  let peakStart = 0, peakSum = -1;
  for (let h = 0; h <= 21; h++) {
    const sum = hourCounts[h] + hourCounts[h + 1] + hourCounts[h + 2];
    if (sum > peakSum) { peakSum = sum; peakStart = h; }
  }
  const peakEnd = peakStart + 3;
  const peakShare = peakSum / sampleN;
  if (peakShare < peakShareThreshold) return null;

  const peakDays = new Set<string>();
  for (const c of crashes) {
    if (c.hour >= peakStart && c.hour < peakEnd) peakDays.add(c.dayKey);
  }
  if (peakDays.size < minRunLength) return null;

  const sortedTs = crashes.map(c => c.ts).sort((a, b) => a - b);
  const confidence = sampleN >= 25 ? 'high' : sampleN >= 15 ? 'medium' : 'low';
  const pad = (h: number) => String(h).padStart(2, '0') + ':00';

  return {
    pattern: 'afternoon_crash_window',
    confidence,
    sample_n: sampleN,
    date_range: { start: dayKey(sortedTs[0]), end: dayKey(sortedTs[sortedTs.length - 1]) },
    peak_block: { start_hour: peakStart, end_hour: peakEnd },
    peak_mentions: peakSum,
    peak_share: Number(peakShare.toFixed(2)),
    unique_days_in_peak: peakDays.size,
    copy:
      `son ay, 'tükendim/yorgun' dump'larının çoğu ${pad(peakStart)}-${pad(peakEnd)} arası. ` +
      `afternoon crash bu vakti seviyor. pattern, not cause.`,
    source: {
      citation: 'Boonstra et al. 2007, Sleep — Hyperactive night and day? Actigraphy studies in adult ADHD',
      url: 'https://doi.org/10.1093/sleep/30.4.433',
    },
  };
}

// ─── detectSupplementDrift ────────────────────────────────────────────────────

export function detectSupplementDrift(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): SupplementDriftPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const dropThreshold = typeof o.dropRatioThreshold === 'number' ? o.dropRatioThreshold : 0.3;
  const priorMinDays = typeof o.priorMinDays === 'number' ? o.priorMinDays : 7;

  const recentStart = now - 14 * DAY_MS;
  const priorStart = now - 28 * DAY_MS;

  const recentDaySet = new Set<string>();
  const priorDaySet = new Set<string>();
  for (const entry of (history.supplementLog || [])) {
    if (!entry || typeof entry.ts !== 'number') continue;
    const ts = entry.ts;
    if (ts > now) continue;
    const k = dayKey(ts);
    if (ts >= recentStart && ts <= now) recentDaySet.add(k);
    else if (ts >= priorStart && ts < recentStart) priorDaySet.add(k);
  }

  const recent_days = recentDaySet.size;
  const prior_days = priorDaySet.size;
  if (prior_days < priorMinDays) return null;

  const drop_ratio = (prior_days - recent_days) / prior_days;
  if (drop_ratio < dropThreshold) return null;

  const confidence = prior_days >= 12 ? 'high' : prior_days >= 9 ? 'medium' : 'low';

  return {
    pattern: 'supplement_drift',
    confidence,
    sample_n: prior_days + recent_days,
    date_range: { start: priorStart, end: now },
    recent_days,
    prior_days,
    drop_ratio: Number(drop_ratio.toFixed(2)),
    copy:
      `son 14 gün, supplement loglarken ${recent_days}/14 günde rutindeydin. ` +
      `önceki 14 gün ${prior_days}/14. routine drift edebilir, kendine kötü hissetme. ` +
      `pattern, not cause.`,
    source: {
      citation: 'Lally et al. 2010, European Journal of Social Psychology — How are habits formed: Modelling habit formation in the real world',
      url: 'https://doi.org/10.1002/ejsp.674',
    },
  };
}

// ─── detectMultiSymptomRecurrence ─────────────────────────────────────────────

export function detectMultiSymptomRecurrence(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): MultiSymptomRecurrencePattern[] {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 60;
  const minSample = typeof o.minSampleDays === 'number' ? o.minSampleDays : 5;
  const standaloneN = typeof o.standaloneN === 'number' ? o.standaloneN : 10;
  const phaseConcThreshold = typeof o.phaseConcThreshold === 'number' ? o.phaseConcThreshold : 0.6;
  const sleepLowMin = typeof o.sleepLowMin === 'number' ? o.sleepLowMin : 360;
  const waterLowCount = typeof o.waterLowCount === 'number' ? o.waterLowCount : 4;
  const crossThreshold = typeof o.crossThreshold === 'number' ? o.crossThreshold : 0.6;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps || [];
  const waterLog = history.waterLog || [];
  const sleepRecords = history.sleepRecords || [];
  const rawPhases = history.cyclePhases || [];

  const symptoms = [
    { key: 'back', re: BACK_RE, tr: 'sırt ağrısı' },
    { key: 'stomach', re: STOMACH_RE, tr: 'mide ağrısı' },
    { key: 'jaw', re: JAW_RE, tr: 'çene sıkma' },
    { key: 'neck', re: NECK_RE, tr: 'boyun ağrısı' },
    { key: 'nausea', re: NAUSEA_RE, tr: 'mide bulantısı' },
  ];

  const perSymptom: Record<string, { days: Record<string, number>; mentions: Array<{ ts: number; dayKey: string }> }> = {};
  for (const s of symptoms) perSymptom[s.key] = { days: {}, mentions: [] };

  for (const d of dumps) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    for (const s of symptoms) {
      if (s.re.test(text)) {
        const k = dayKey(ts);
        if (!perSymptom[s.key].days[k]) {
          perSymptom[s.key].days[k] = ts;
          perSymptom[s.key].mentions.push({ ts, dayKey: k });
        }
      }
    }
  }

  const waterByDay: Record<string, number> = {};
  for (const entry of waterLog) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    const k = dayKey(ts);
    waterByDay[k] = (waterByDay[k] || 0) + 1;
  }
  const sleepByDay: Record<string, number> = {};
  for (const r of sleepRecords) {
    if (!r || typeof r.night_of !== 'string' || typeof r.tst_min !== 'number') continue;
    sleepByDay[r.night_of] = r.tst_min;
  }

  // Step-function cycle phases (CyclePhaseMarker shape only)
  const sortedPhases = (rawPhases as Array<{ ts?: number; phase?: string }>)
    .filter((p): p is { ts: number; phase: string } => p != null && typeof p.ts === 'number' && typeof p.phase === 'string')
    .sort((a, b) => a.ts - b.ts);
  const getPhase = phaseAtFn(sortedPhases);

  const trMap: Record<string, string> = {
    menstrual: 'menstrual',
    follicular: 'foliküler',
    ovulation: 'ovülasyon',
    luteal: 'luteal',
  };

  const records: MultiSymptomRecurrencePattern[] = [];
  for (const s of symptoms) {
    const mentions = perSymptom[s.key].mentions;
    const sampleN = mentions.length;
    if (sampleN < minSample) continue;
    mentions.sort((a, b) => a.ts - b.ts);
    const dateRange = { start: mentions[0].ts, end: mentions[sampleN - 1].ts };

    const correlations: string[] = [];
    let phaseDominant: string | null = null;
    if (sortedPhases.length > 0) {
      const phaseCount: Record<string, number> = {};
      let totalWithPhase = 0;
      for (const m of mentions) {
        const ph = getPhase(m.ts);
        if (ph) { phaseCount[ph] = (phaseCount[ph] || 0) + 1; totalWithPhase++; }
      }
      if (totalWithPhase > 0) {
        let topPhase: string | null = null, topN = 0;
        for (const [ph, n] of Object.entries(phaseCount)) {
          if (n > topN) { topPhase = ph; topN = n; }
        }
        if (topPhase && topN / totalWithPhase >= phaseConcThreshold) {
          correlations.push('phase_concentrated');
          phaseDominant = topPhase;
        }
      }
    }

    if (Object.keys(sleepByDay).length > 0) {
      let lowDays = 0, totalWithSleep = 0;
      for (const m of mentions) {
        const tst = sleepByDay[m.dayKey];
        if (typeof tst === 'number') { totalWithSleep++; if (tst < sleepLowMin) lowDays++; }
      }
      if (totalWithSleep > 0 && lowDays / totalWithSleep >= crossThreshold) correlations.push('sleep_correlated');
    }

    if (Object.keys(waterByDay).length > 0) {
      let lowDays = 0, totalWithWater = 0;
      for (const m of mentions) {
        const cnt = waterByDay[m.dayKey];
        if (typeof cnt === 'number') { totalWithWater++; if (cnt < waterLowCount) lowDays++; }
      }
      if (totalWithWater > 0 && lowDays / totalWithWater >= crossThreshold) correlations.push('hydration_correlated');
    }

    if (correlations.length === 0 && sampleN < standaloneN) continue;
    const confidence = sampleN >= 15 ? 'high' : sampleN >= 10 ? 'medium' : 'low';

    const crossParts: string[] = [];
    for (const c of correlations) {
      if (c === 'phase_concentrated') {
        const phTr = (phaseDominant && trMap[phaseDominant]) || phaseDominant || '';
        crossParts.push(`, çoğu ${phTr} fazında`);
      } else if (c === 'sleep_correlated') crossParts.push(', uykunun kısa olduğu günler');
      else if (c === 'hydration_correlated') crossParts.push(', su azken');
    }
    const copy = `son 2 ay ${s.tr} ${sampleN} gün boyunca dönüp duruyor${crossParts.join('')}. pattern, not cause.`;

    records.push({
      pattern: 'multi_symptom_recurrence',
      symptom: s.key,
      confidence,
      sample_n: sampleN,
      date_range: dateRange,
      correlations,
      phase_dominant: phaseDominant,
      copy,
      source: {
        citation: 'Instanes et al. 2018, J Atten Disord — Adult ADHD and Comorbid Somatic Disease',
        url: 'https://doi.org/10.1177/1087054716669589',
      },
    });
    if (records.length >= 5) break;
  }
  return records;
}

// ─── detectHungerThirstConfusion ──────────────────────────────────────────────

export function detectHungerThirstConfusion(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): HungerThirstConfusionPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 30;
  const burstWindowMs = (o.burstWindowMin || 30) * MINUTE_MS;
  const minBursts = typeof o.minBursts === 'number' ? o.minBursts : 5;
  const windowStart = now - windowDays * DAY_MS;

  const waterTsList: number[] = [];
  for (const entry of (history.waterLog || [])) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    waterTsList.push(ts);
  }
  if (waterTsList.length === 0) return null;
  waterTsList.sort((a, b) => a - b);

  const foodTsList: number[] = [];
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!FOOD_RE.test(text)) continue;
    foodTsList.push(ts);
  }
  foodTsList.sort((a, b) => a - b);

  let burstCount = 0;
  for (const wt of waterTsList) {
    for (let i = 0; i < foodTsList.length; i++) {
      const ft = foodTsList[i];
      if (ft <= wt) continue;
      if (ft > wt + burstWindowMs) break;
      burstCount++;
      break;
    }
  }
  if (burstCount < minBursts) return null;

  const sampleN = waterTsList.length;
  const burstRatio = Number((burstCount / sampleN).toFixed(2));
  const confidence = burstCount >= 12 ? 'high' : burstCount >= 8 ? 'medium' : 'low';

  return {
    pattern: 'hunger_thirst_confusion',
    confidence,
    sample_n: sampleN,
    burst_count: burstCount,
    burst_ratio: burstRatio,
    date_range: { start: waterTsList[0], end: waterTsList[waterTsList.length - 1] },
    copy:
      `son ${windowDays} gün, su içtikten sonra yarım saat içinde ${burstCount} kez ` +
      `'açım' yazmışsın. interoseptif sinyaller karışıyor olabilir — açlık ve ` +
      `susuzluk benzer hissedebilir. pattern, not cause.`,
    source: {
      citation: 'Khalsa et al. 2018, Biological Psychiatry: CNNI — Interoception and mental health: a roadmap',
      url: 'https://doi.org/10.1016/j.bpsc.2017.12.004',
    },
  };
}

// ─── detectCaffeineWaterTradeoff ──────────────────────────────────────────────

export function detectCaffeineWaterTradeoff(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): CaffeineWaterTradeoffPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 30;
  const minDays = typeof o.minDays === 'number' ? o.minDays : 21;
  const rhoThreshold = typeof o.rhoThreshold === 'number' ? o.rhoThreshold : -0.3;
  const windowStart = now - windowDays * DAY_MS;

  const byDay: Record<string, { water: number; caffeine: number }> = {};
  const ensure = (k: string) => {
    if (!byDay[k]) byDay[k] = { water: 0, caffeine: 0 };
    return byDay[k];
  };

  for (const entry of (history.waterLog || [])) {
    const ts = waterTs(entry);
    if (ts === null || ts < windowStart || ts > now) continue;
    ensure(dayKey(ts)).water++;
  }
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!CAFFEINE_RE.test(text)) continue;
    ensure(dayKey(ts)).caffeine++;
  }

  const days = Object.entries(byDay)
    .filter(([, v]) => v.water > 0 && v.caffeine > 0)
    .map(([k, v]) => ({ key: k, water: v.water, caffeine: v.caffeine }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const n = days.length;
  if (n < minDays) return null;

  const xs = days.map(d => d.caffeine);
  const ys = days.map(d => d.water);
  const rho = spearman(xs, ys);
  if (!(rho <= rhoThreshold)) return null;

  const meanCaf = xs.reduce((a, b) => a + b, 0) / n;
  const meanWat = ys.reduce((a, b) => a + b, 0) / n;
  const confidence = n >= 28 ? 'high' : n >= 24 ? 'medium' : 'low';

  return {
    pattern: 'caffeine_water_tradeoff',
    confidence,
    sample_n: n,
    rho: Number(rho.toFixed(3)),
    mean_caffeine: Number(meanCaf.toFixed(1)),
    mean_water: Number(meanWat.toFixed(1)),
    date_range: { start: days[0].key, end: days[n - 1].key },
    copy:
      `caffein ↑ olan günler su ↓ oluyor. son ay ${n} gün veride spearman ρ ` +
      `${Number(rho.toFixed(3))}. caffein hidrasyon trade-off'u, kahve kötü değil — ` +
      `sadece notice. pattern, not cause.`,
    source: {
      citation: 'Maughan & Griffin 2003, Journal of Human Nutrition and Dietetics — Caffeine ingestion and fluid balance: a critical review',
      url: 'https://doi.org/10.1046/j.1365-277X.2003.00477.x',
    },
  };
}

// ─── detectMealSkipPattern ────────────────────────────────────────────────────

export function detectMealSkipPattern(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): MealSkipPattern | null {
  const o = opts || {};
  const settings = history.settings || {};
  const enabled = o.tracking_meal_timing === true || settings.tracking_meal_timing === true;
  if (!enabled) return null;

  const now = resolveNow(history);
  const windowDays = o.windowDays || 14;
  const skipFloor = typeof o.skipFloor === 'number' ? o.skipFloor : 7;
  const cutoffHour = typeof o.cutoffHour === 'number' ? o.cutoffHour : 14;
  const windowStart = now - windowDays * DAY_MS;

  const observedDays = new Set<string>();
  const morningFoodDays = new Set<string>();
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const k = dayKey(ts);
    observedDays.add(k);
    const text = String(d.rawText || d.text || '');
    if (!FOOD_RE.test(text)) continue;
    if (new Date(ts).getHours() < cutoffHour) morningFoodDays.add(k);
  }

  if (observedDays.size < Math.max(7, Math.floor(windowDays / 2))) return null;
  const skipDays = observedDays.size - morningFoodDays.size;
  if (skipDays < skipFloor) return null;

  const confidence = skipDays >= 12 ? 'high' : skipDays >= 9 ? 'medium' : 'low';
  return {
    pattern: 'meal_skip',
    confidence,
    sample_n: observedDays.size,
    skip_days: skipDays,
    morning_food_days: morningFoodDays.size,
    date_range: { start: windowStart, end: now },
    copy:
      `son ${windowDays} gün, ${skipDays}/${windowDays} günde 14:00'tan önce yemek logu yok. ` +
      `kahvaltı ya geçiyor ya hafifte kalıyor — adhd'de yaygın, hafıza-iştah birbirine bağımlı. ` +
      `pattern, not cause.`,
    source: {
      citation: 'Nicolas et al. 2015, Eating Behaviors — Eating attitudes and behaviours in adult ADHD',
      url: 'https://doi.org/10.1016/j.eatbeh.2015.04.001',
    },
  };
}

// ─── detectGISymptomCyclePhase ────────────────────────────────────────────────

export function detectGISymptomCyclePhase(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): GISymptomCyclePhasePattern | null {
  const o = opts || {};
  const settings = history.settings || {};
  const enabled = o.tracking_gi === true || settings.tracking_gi === true;
  if (!enabled) return null;

  const now = resolveNow(history);
  const windowDays = o.windowDays || 90;
  const minMentions = typeof o.minMentions === 'number' ? o.minMentions : 5;
  const minCycles = typeof o.minCycles === 'number' ? o.minCycles : 3;
  const concThreshold = typeof o.concThreshold === 'number' ? o.concThreshold : 0.6;
  const windowStart = now - windowDays * DAY_MS;

  const rawPhases = history.cyclePhases || [];
  if (rawPhases.length === 0) return null;
  const sortedPhases = (rawPhases as Array<{ ts?: number; phase?: string }>)
    .filter((p): p is { ts: number; phase: string } => p != null && typeof p.ts === 'number' && typeof p.phase === 'string')
    .sort((a, b) => a.ts - b.ts);
  const getPhase = phaseAtFn(sortedPhases);

  const phaseCount: Record<string, number> = {};
  let total = 0;
  const cycleStarts = new Set<number>();
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!STOMACH_RE.test(text) && !NAUSEA_RE.test(text)) continue;
    const phase = getPhase(ts);
    if (!phase) continue;
    phaseCount[phase] = (phaseCount[phase] || 0) + 1;
    total++;
    for (const p of sortedPhases) {
      if (p.phase === 'menstrual' && p.ts <= ts) cycleStarts.add(p.ts);
    }
  }

  if (total < minMentions) return null;
  if (cycleStarts.size < minCycles) return null;

  let topPhase: string | null = null, topN = 0;
  for (const [ph, n] of Object.entries(phaseCount)) {
    if (n > topN) { topPhase = ph; topN = n; }
  }
  if (!topPhase || topN / total < concThreshold) return null;

  const trMap: Record<string, string> = {
    menstrual: 'menstrual',
    follicular: 'foliküler',
    ovulation: 'ovülasyon',
    luteal: 'luteal',
  };
  const phaseTr = trMap[topPhase] || topPhase;
  const confidence = total >= 12 ? 'high' : total >= 8 ? 'medium' : 'low';

  return {
    pattern: 'gi_cycle_phase',
    confidence,
    sample_n: total,
    cycles_observed: cycleStarts.size,
    phase_dominant: topPhase,
    phase_share: Number((topN / total).toFixed(2)),
    date_range: { start: windowStart, end: now },
    copy:
      `son ${cycleStarts.size} döngüde mide/bağırsak şikayetlerinin %${Math.round(topN / total * 100)}'i ${phaseTr} fazında. ` +
      `hormonal çakışma normal — pattern, not cause.`,
    source: {
      citation: 'Whitehead et al. 1990, Gastroenterology — Evidence for exacerbation of irritable bowel syndrome during menses',
      url: 'https://pubmed.ncbi.nlm.nih.gov/2338190/',
    },
  };
}

// ─── detectMovementGap ────────────────────────────────────────────────────────

export function detectMovementGap(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): MovementGapPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 14;
  const movementCeiling = typeof o.movementCeiling === 'number' ? o.movementCeiling : 4;
  const minObservedDays = typeof o.minObservedDays === 'number' ? o.minObservedDays : 5;
  const windowStart = now - windowDays * DAY_MS;

  const movementDays = new Set<string>();
  const observedDays = new Set<string>();
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    observedDays.add(dayKey(ts));
    const text = String(d.rawText || d.text || '');
    if (!MOVEMENT_RE.test(text)) continue;
    movementDays.add(dayKey(ts));
  }

  const movementCount = movementDays.size;
  if (movementCount > movementCeiling) return null;
  if (observedDays.size < minObservedDays) return null;

  const confidence = movementCount === 0 ? 'high' : movementCount <= 2 ? 'medium' : 'low';

  return {
    pattern: 'movement_gap',
    confidence,
    sample_n: windowDays,
    movement_days: movementCount,
    date_range: { start: windowStart, end: now },
    copy:
      `son ${windowDays} gün, ${movementCount} günde hareket logu var. ` +
      `tembellik değil — adhd beyni execute etmek için extra step gerektirir. ` +
      `dopaminden değil, planlamadan. pattern, not cause.`,
    source: {
      citation: 'Halperin & Healey 2011, Neuroscience & Biobehavioral Reviews — The influences of environmental enrichment, cognitive enhancement, and physical exercise on brain development',
      url: 'https://doi.org/10.1016/j.neubiorev.2010.07.006',
    },
  };
}

// ─── detectVasomotorPattern ────────────────────────────────────────────────────

export function detectVasomotorPattern(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): VasomotorPattern | null {
  const o = opts || {};
  const settings = history.settings || {};
  if (settings.menstruation !== 'not_anymore') return null;

  const now = resolveNow(history);
  const windowDays = o.windowDays || 30;
  const minDays = typeof o.minDays === 'number' ? o.minDays : 6;
  const windowStart = now - windowDays * DAY_MS;

  const days = new Set<string>();
  for (const d of (history.dumps || [])) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!VASOMOTOR_RE.test(text)) continue;
    days.add(dayKey(ts));
  }
  if (days.size < minDays) return null;
  const confidence = days.size >= 14 ? 'high' : days.size >= 10 ? 'medium' : 'low';

  return {
    pattern: 'vasomotor_pattern',
    confidence,
    sample_n: windowDays,
    symptom_days: days.size,
    date_range: { start: windowStart, end: now },
    copy:
      `son ${windowDays} gün, ${days.size} günde sıcak basma / gece terlemesi yazısı geçti. ` +
      `vasomotor semptomlar peri/post-menopozda yaygın — hipotalamus ısı eşiği daralıyor. ` +
      `pattern, not cause.`,
    source: {
      citation: 'Freedman 2014, J Steroid Biochem Mol Biol — Menopausal hot flashes: mechanisms, endocrinology, treatment',
      url: 'https://doi.org/10.1016/j.jsbmb.2013.06.014',
    },
  };
}

// ─── detectSymptomPhaseCoupling ───────────────────────────────────────────────

export function detectSymptomPhaseCoupling(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): SymptomPhaseCouplingPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 90;
  const minLutealDays = o.minLutealDays || 5;
  const minOtherDays = o.minOtherDays || 10;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.6;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps || [];
  const rawPhases = history.cyclePhases || [];
  if (dumps.length === 0 || rawPhases.length === 0) return null;

  // Build day → phase map from CyclePhaseRange entries
  const phaseForDay = new Map<string, string>();
  for (const p of rawPhases as Array<{ start?: number; end?: number; name?: string }>) {
    if (!p || typeof p.start !== 'number' || typeof p.end !== 'number' || typeof p.name !== 'string') continue;
    const s = Math.max(p.start, windowStart);
    const e = Math.min(p.end, now);
    for (let t = s; t <= e; t += DAY_MS) phaseForDay.set(dayKey(t), p.name);
  }
  if (phaseForDay.size === 0) return null;

  const symptomDaysByPhase = { luteal: new Set<string>(), other: new Set<string>() };
  const totalDaysByPhase = { luteal: new Set<string>(), other: new Set<string>() };
  for (const [k, ph] of phaseForDay.entries()) {
    (ph === 'luteal' ? totalDaysByPhase.luteal : totalDaysByPhase.other).add(k);
  }
  for (const d of dumps) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const k = dayKey(ts);
    const ph = phaseForDay.get(k);
    if (!ph) continue;
    const text = String(d.rawText || d.text || '');
    let hit = false;
    for (const re of SYMPTOM_REGEXES) { if (re.test(text)) { hit = true; break; } }
    if (!hit) continue;
    if (ph === 'luteal') symptomDaysByPhase.luteal.add(k);
    else symptomDaysByPhase.other.add(k);
  }

  const lutealTotal = totalDaysByPhase.luteal.size;
  const otherTotal = totalDaysByPhase.other.size;
  if (lutealTotal < minLutealDays || otherTotal < minOtherDays) return null;

  const lutealRate = symptomDaysByPhase.luteal.size / lutealTotal;
  const otherRate = symptomDaysByPhase.other.size / otherTotal;
  if (otherRate === 0) {
    if (symptomDaysByPhase.luteal.size < 3) return null;
  } else {
    if (lutealRate / otherRate < minLift) return null;
  }

  const lift = otherRate === 0 ? null : lutealRate / otherRate;
  const confidence = (lutealTotal >= 8 && otherTotal >= 14 && (lift == null || lift >= 2)) ? 'high'
    : (lift == null || lift >= 1.7) ? 'medium' : 'low';

  return {
    pattern: 'symptom_phase_coupling',
    luteal_symptom_rate: Number(lutealRate.toFixed(2)),
    other_symptom_rate: Number(otherRate.toFixed(2)),
    lift: lift == null ? null : Number(lift.toFixed(2)),
    luteal_days: lutealTotal,
    other_days: otherTotal,
    sample_n: lutealTotal + otherTotal,
    confidence,
    copy:
      'body symptoms cluster in luteal phase — ' +
      Math.round(lutealRate * 100) + '% of luteal days vs ' +
      Math.round(otherRate * 100) + '% of other days. pattern, not cause.',
    source: {
      citation: 'Eisenlohr-Moul et al. 2020, Psychological Medicine — temporal subtypes of premenstrual dysphoric disorder via group-based trajectory modeling',
      url: 'https://doi.org/10.1017/S0033291719000849',
    },
  };
}

// ─── detectSleepDebtSymptomLag ────────────────────────────────────────────────

export function detectSleepDebtSymptomLag(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): SleepDebtSymptomLagPattern | null {
  const o = opts || {};
  const now = resolveNow(history);
  const windowDays = o.windowDays || 60;
  const shortMinutes = typeof o.shortMinutes === 'number' ? o.shortMinutes : 360;
  const minShortNights = o.minShortNights || 5;
  const minBaselineNights = o.minBaselineNights || 10;
  const minLift = typeof o.minLift === 'number' ? o.minLift : 1.5;
  const windowStart = now - windowDays * DAY_MS;

  const dumps = history.dumps || [];
  const sleepRecords = history.sleepRecords || [];
  if (dumps.length === 0 || sleepRecords.length === 0) return null;

  const shortFollow = new Set<string>();
  const baselineFollow = new Set<string>();
  for (const r of sleepRecords) {
    if (!r || r.is_skipped) continue;
    if (typeof r.tst_min !== 'number' || typeof r.night_of !== 'string') continue;
    const t = Date.parse(r.night_of + 'T12:00:00');
    if (!isFinite(t) || t < windowStart || t > now) continue;
    const follow = nextDayKey(r.night_of);
    if (!follow) continue;
    if (r.tst_min < shortMinutes) shortFollow.add(follow);
    else if (r.tst_min >= 7 * 60) baselineFollow.add(follow);
  }
  if (shortFollow.size < minShortNights || baselineFollow.size < minBaselineNights) return null;

  let shortHits = 0, baselineHits = 0;
  const seenShort = new Set<string>(), seenBaseline = new Set<string>();
  for (const d of dumps) {
    const ts = d.ts;
    if (ts < windowStart || ts > now) continue;
    const text = String(d.rawText || d.text || '');
    let hit = false;
    for (const re of SYMPTOM_REGEXES) { if (re.test(text)) { hit = true; break; } }
    if (!hit) continue;
    const k = dayKey(ts);
    if (shortFollow.has(k) && !seenShort.has(k)) { shortHits++; seenShort.add(k); }
    else if (baselineFollow.has(k) && !seenBaseline.has(k)) { baselineHits++; seenBaseline.add(k); }
  }

  const shortRate = shortHits / shortFollow.size;
  const baselineRate = baselineHits / baselineFollow.size;
  if (baselineRate === 0) {
    if (shortHits < 3) return null;
  } else {
    if (shortRate / baselineRate < minLift) return null;
  }

  const lift = baselineRate === 0 ? null : shortRate / baselineRate;
  const confidence = (lift == null || lift >= 2.0) && shortFollow.size >= 8 ? 'high'
    : (lift == null || lift >= 1.6) ? 'medium' : 'low';

  return {
    pattern: 'sleep_debt_symptom_lag',
    short_symptom_rate: Number(shortRate.toFixed(2)),
    baseline_symptom_rate: Number(baselineRate.toFixed(2)),
    lift: lift == null ? null : Number(lift.toFixed(2)),
    short_nights: shortFollow.size,
    baseline_nights: baselineFollow.size,
    sample_n: shortFollow.size + baselineFollow.size,
    confidence,
    copy:
      'days after under-' + (shortMinutes / 60).toFixed(0) + 'h nights, body symptom mentions hit ' +
      Math.round(shortRate * 100) + '% vs ' + Math.round(baselineRate * 100) + '% on baseline days. pattern, not cause.',
    source: {
      citation: 'Krause et al. 2019, Journal of Neuroscience — sleep loss amplifies pain processing',
      url: 'https://doi.org/10.1523/JNEUROSCI.2408-18.2018',
    },
  };
}

// ─── envelopeCopy ─────────────────────────────────────────────────────────────
// Resolves copy that has two variants: a dry default and an envelope-aware
// alternative. Mirrors void-app.html VOID.logic.body.envelopeCopy (line 9938).
// The original read window.VOID.settings; here the caller injects
// energy_envelope_on directly so the function stays pure.
//
// Usage: envelopeCopy({ dry: 'short copy', envelope: 'longer pacing copy' }, isOn)
//        envelopeCopy('plain string', isOn) → returns the string unchanged.

export type EnvelopeCopyInput =
  | string
  | { dry?: string; envelope?: string }
  | null
  | undefined;

export function envelopeCopy(
  input: EnvelopeCopyInput,
  energy_envelope_on: boolean,
): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && ('dry' in input || 'envelope' in input)) {
    return energy_envelope_on
      ? String(input.envelope ?? input.dry ?? '')
      : String(input.dry ?? input.envelope ?? '');
  }
  return '';
}

// ─── detectPatterns (top-level) ───────────────────────────────────────────────

export function detectPatterns(
  history: BodyHistory,
  opts?: BodyPatternOpts,
): AnyBodyPattern[] {
  const out: AnyBodyPattern[] = [];
  const h = detectHeadacheHydration(history, opts);
  if (h) out.push(h);
  const i = detectInteroceptionDrift(history, opts);
  if (i) out.push(i);
  const hf = detectHyperfocusDehydration(history, opts);
  if (hf) out.push(hf);
  const c = detectAfternoonCrashWindow(history, opts);
  if (c) out.push(c);
  const sd = detectSupplementDrift(history, opts);
  if (sd) out.push(sd);
  const ms = detectMultiSymptomRecurrence(history, opts);
  for (const r of ms) out.push(r);
  const htc = detectHungerThirstConfusion(history, opts);
  if (htc) out.push(htc);
  const cwt = detectCaffeineWaterTradeoff(history, opts);
  if (cwt) out.push(cwt);
  const mp = detectMealSkipPattern(history, opts);
  if (mp) out.push(mp);
  const gi = detectGISymptomCyclePhase(history, opts);
  if (gi) out.push(gi);
  const mg = detectMovementGap(history, opts);
  if (mg) out.push(mg);
  const vm = detectVasomotorPattern(history, opts);
  if (vm) out.push(vm);
  const spc = detectSymptomPhaseCoupling(history, opts);
  if (spc) out.push(spc);
  const sds = detectSleepDebtSymptomLag(history, opts);
  if (sds) out.push(sds);
  return out;
}
