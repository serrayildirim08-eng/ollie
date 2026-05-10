/**
 * @ollie/logic · sleep · pattern detectors
 *
 * Phase 1: detectRevengeBedtime, detectCaffeineCutoff,
 *          detectSleepOnsetGap, detectWeekendRecoveryIllusion,
 *          detectBedtimeMindRacing
 * Phase 2: detectWindDownFriction, detectMedicationTimingDrift,
 *          detectChronotherapyProgress
 * Phase 3: detectSleepCyclePattern, detectSleepFocusPattern,
 *          detectSleepDumpMoodPattern
 * Phase 4: detectCyclePhaseSleepCoupling, detectStimulantSleepDebt
 *
 * All functions pure — no I/O, no DOM, no wall-clock reads.
 */

import type {
  SleepRecord,
  RevengeBedtimePattern,
  CaffeineCutoffPattern,
  SleepOnsetGapPattern,
  WeekendRecoveryIllusionPattern,
  BedtimeMindRacingPattern,
  WindDownFrictionPattern,
  MedicationTimingDriftPattern,
  ChronotherapyProgressPattern,
  SleepCyclePhaseShiftPattern,
  SleepFocusShiftPattern,
  SleepDumpMoodShiftPattern,
  CyclePhaseSleepCouplingPattern,
  StimulantSleepDebtPattern,
  RevengeBedtimeHistory,
  CaffeineCutoffHistory,
  WindDownFrictionHistory,
  MedicationTimingDriftHistory,
  ChronotherapyProgressHistory,
  SleepCycleHistory,
  SleepFocusHistory,
  SleepMoodHistory,
  CyclePhaseSleepHistory,
  StimulantSleepHistory,
  BaseHistory,
  RevengeBedtimeOpts,
  CaffeineCutoffOpts,
  SleepOnsetGapOpts,
  WeekendRecoveryOpts,
  BedtimeMindRacingOpts,
  WindDownFrictionOpts,
  MedicationTimingDriftOpts,
  ChronotherapyProgressOpts,
  CyclePhaseSleepOpts,
  SleepFocusOpts,
  SleepMoodOpts,
  CyclePhaseSleepCouplingOpts,
  StimulantSleepDebtOpts,
} from './types';
import {
  parseTimeOfDay,
  bedtimeRelativeMinutes,
  minutesInBed,
  formatTime,
  isoDate,
  _mean,
  _stdev,
  _median,
  bedtimeEpochFor,
} from './helpers';
import {
  CAFFEINE_RE,
  STIMULANT_RE,
  RUMINATIVE_LEXICON,
  OVERWHELMED_LEXICON,
} from './constants';

// ─── Phase 1 ──────────────────────────────────────────────────────────

export function detectRevengeBedtime(
  history: RevengeBedtimeHistory,
  opts?: RevengeBedtimeOpts,
): RevengeBedtimePattern | null {
  if (!history || typeof history !== 'object') return null;
  if (typeof history.now !== 'number' || !isFinite(history.now)) return null;
  if (!Array.isArray(history.actionLog) || history.actionLog.length === 0) return null;
  if (!Array.isArray(history.sleepRecords) || history.sleepRecords.length === 0) return null;
  const targetMin = parseTimeOfDay(history.targetBedtime);
  if (targetMin == null) return null;

  const o = opts || {};
  const W = typeof o.window_nights === 'number' ? o.window_nights : 14;
  const REVENGE_MIN = typeof o.revenge_min_minutes === 'number' ? o.revenge_min_minutes : 30;
  const RUN_FLOOR = typeof o.run_length_floor === 'number' ? o.run_length_floor : 7;
  const SUSTAINED_GAP_MS = 5 * 60 * 1000;
  const FALLBACK_BEDTIME_CAP_MS = 6 * 3600 * 1000;

  const events = history.actionLog
    .filter((e) => e && typeof e.ts === 'number' && isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);
  if (events.length === 0) return null;

  const targetEpochForNight = (nightOf: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nightOf || '');
    if (!m) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
    const hh = Math.floor(targetMin / 60), mm = targetMin % 60;
    const t = new Date(y, mo, d, hh, mm, 0, 0).getTime();
    return isFinite(t) ? t : null;
  };

  const bedtimeEpoch = (nightOf: string, bedtimeStr: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nightOf || '');
    if (!m) return null;
    const btMin = parseTimeOfDay(bedtimeStr);
    if (btMin == null) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
    const hh = Math.floor(btMin / 60), mm = btMin % 60;
    const isAfterMidnight = btMin < 12 * 60;
    const t = new Date(y, mo, d + (isAfterMidnight ? 1 : 0), hh, mm, 0, 0).getTime();
    return isFinite(t) ? t : null;
  };

  const sorted = history.sleepRecords
    .filter((r) => r && typeof r.night_of === 'string')
    .slice()
    .sort((a, b) => a.night_of.localeCompare(b.night_of));
  const cutoff = history.now - W * 86400000;
  const windowed = sorted
    .filter((r) => {
      const t = targetEpochForNight(r.night_of);
      return t != null && t >= cutoff && t <= history.now;
    })
    .slice(-W);

  if (windowed.length < W) return null;

  const delays: number[] = [];
  let nRevenge = 0;
  let nTotal = 0;

  for (const r of windowed) {
    const tTarget = targetEpochForNight(r.night_of);
    if (tTarget == null) continue;
    nTotal++;
    const tBed = r.bedtime ? bedtimeEpoch(r.night_of, r.bedtime) : null;
    const tCap =
      tBed != null && tBed > tTarget ? tBed : tTarget + FALLBACK_BEDTIME_CAP_MS;
    const winEvents = [];
    for (const e of events) {
      if (e.ts >= tTarget && e.ts <= tCap) winEvents.push(e);
      else if (e.ts > tCap) break;
    }
    if (winEvents.length < 2) continue;
    let activeMs = 0;
    for (let i = 0; i < winEvents.length - 1; i++) {
      const gap = winEvents[i + 1].ts - winEvents[i].ts;
      if (gap <= SUSTAINED_GAP_MS) activeMs += gap;
    }
    const activeMin = activeMs / 60000;
    if (activeMin >= REVENGE_MIN) {
      nRevenge++;
      delays.push(Math.round(activeMin));
    }
  }

  if (nTotal < W) return null;
  if (nRevenge < RUN_FLOOR) return null;
  const medDelay = _median(delays);
  if (medDelay == null || medDelay < 30) return null;
  const confidence = nRevenge >= 9 ? 'high' : 'medium';
  const medRound = Math.round(medDelay);
  return {
    pattern: 'revenge_bedtime',
    n_revenge_nights: nRevenge,
    n_total_nights: nTotal,
    median_delay_min: medRound,
    confidence,
    copy:
      'son iki haftada ' +
      nRevenge +
      ' gece, yatış hedefinden ortalama ' +
      medRound +
      ' dakika sonra hâlâ buradaydın. revenge bedtime denilen şey bu. ne ilaç, ne karakter.',
    source: {
      citation:
        'Kroese et al. 2014, Frontiers in Psychology — Bedtime procrastination: introducing a new area of procrastination',
      url: 'https://www.frontiersin.org/articles/10.3389/fpsyg.2014.00611/full',
    },
  };
}

export function detectCaffeineCutoff(
  history: CaffeineCutoffHistory,
  opts?: CaffeineCutoffOpts,
): CaffeineCutoffPattern | null {
  if (!history || !Array.isArray(history.dumps) || !Array.isArray(history.sleepRecords))
    return null;
  if (typeof history.now !== 'number') return null;
  const o = opts || {};
  const windowDays = o.window_days != null ? o.window_days : 30;
  const gapThreshold = o.gap_threshold_hours != null ? o.gap_threshold_hours : 6;
  const minViolations = o.min_violation_nights != null ? o.min_violation_nights : 5;

  const cutoff = history.now - windowDays * 86400000;
  const latestCaffeineByNight = new Map<string, number>();
  for (const d of history.dumps) {
    if (!d || typeof d.ts !== 'number' || typeof d.text !== 'string') continue;
    if (d.ts < cutoff || d.ts > history.now) continue;
    if (!CAFFEINE_RE.test(d.text)) continue;
    const dt = new Date(d.ts);
    const dayDate = new Date(dt.getTime());
    if (dt.getHours() < 4) dayDate.setDate(dayDate.getDate() - 1);
    const nightOf = isoDate(dayDate.getTime());
    const cur = latestCaffeineByNight.get(nightOf);
    if (cur == null || d.ts > cur) latestCaffeineByNight.set(nightOf, d.ts);
  }

  const pairs: Array<{ gap_hours: number; onset_latency_min: number | null }> = [];
  for (const r of history.sleepRecords) {
    if (!r || r.is_skipped) continue;
    if (!r.night_of || !r.bedtime) continue;
    const lastCaf = latestCaffeineByNight.get(r.night_of);
    if (lastCaf == null) continue;
    const bedMs = bedtimeEpochFor(r.night_of, r.bedtime);
    if (bedMs == null) continue;
    if (bedMs < cutoff || bedMs > history.now + 86400000) continue;
    const gap = (bedMs - lastCaf) / 3600000;
    if (!isFinite(gap) || gap < 0) continue;
    pairs.push({
      gap_hours: gap,
      onset_latency_min:
        typeof r.onset_latency_min === 'number' ? r.onset_latency_min : null,
    });
  }
  if (pairs.length < 14) return null;

  const gaps = pairs.map((p) => p.gap_hours);
  const medGap = _median(gaps);
  if (medGap == null || medGap >= gapThreshold) return null;

  const violations = pairs.filter((p) => p.gap_hours < gapThreshold);
  if (violations.length < minViolations) return null;

  const violOnset = violations
    .map((p) => p.onset_latency_min)
    .filter((x): x is number => x != null);
  const baselineOnset = pairs
    .filter((p) => p.gap_hours >= gapThreshold)
    .map((p) => p.onset_latency_min)
    .filter((x): x is number => x != null);
  let onsetDelta: number | null = null;
  if (violOnset.length >= 3 && baselineOnset.length >= 3) {
    const d = _median(violOnset)! - _median(baselineOnset)!;
    if (d >= 30) onsetDelta = Math.round(d);
  }

  const confidence = violations.length >= 10 ? 'high' : 'medium';
  const nViol = violations.length;
  const hRound = Number(medGap.toFixed(1));
  let copy = `son ay ${nViol} gün, yatıştan ${hRound} saat öncesinde kafein gördük.`;
  if (onsetDelta != null) {
    copy += ` 6 saat sınırın altı uyku başlangıcını ortalama ${onsetDelta} dk geciktiriyor.`;
  }
  return {
    pattern: 'caffeine_cutoff',
    n_violation_days: nViol,
    median_gap_hours: hRound,
    onset_delta_min: onsetDelta,
    confidence,
    copy,
    source: {
      citation:
        'Drake et al. 2013, Journal of Clinical Sleep Medicine — Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed',
      url: 'https://pubmed.ncbi.nlm.nih.gov/24235903/',
    },
  };
}

export function detectSleepOnsetGap(
  history: BaseHistory,
  opts?: SleepOnsetGapOpts,
): SleepOnsetGapPattern | null {
  if (!history || !Array.isArray(history.sleepRecords)) return null;
  if (typeof history.now !== 'number') return null;
  const o = opts || {};
  const windowNights = o.window_nights != null ? o.window_nights : 14;
  const effFloor = o.efficiency_floor != null ? o.efficiency_floor : 0.85;
  const onsetFloor = o.onset_floor_min != null ? o.onset_floor_min : 30;
  const minViol = o.min_violation_nights != null ? o.min_violation_nights : 5;

  const valid = history.sleepRecords
    .filter(
      (r) =>
        r &&
        !r.is_skipped &&
        typeof r.tst_min === 'number' &&
        typeof r.time_in_bed_min === 'number' &&
        (r.time_in_bed_min as number) > 0 &&
        typeof r.onset_latency_min === 'number',
    )
    .slice(-windowNights);
  if (valid.length < windowNights) return null;

  const efficiencies = valid.map((r) => (r.tst_min as number) / (r.time_in_bed_min as number));
  const onsets = valid.map((r) => r.onset_latency_min as number);
  const lowEffNights = efficiencies.filter((e) => e < effFloor).length;
  const medOnset = _median(onsets);
  if (lowEffNights < minViol) return null;
  if (medOnset == null || medOnset < onsetFloor) return null;
  const medEff = _median(efficiencies)!;
  const confidence = lowEffNights >= 7 ? 'high' : 'medium';
  const copy = `son ${valid.length} gecede ${lowEffNights} gece, yatağa girişle uyumak arasında medyan ${Math.round(medOnset)} dakika geçiyor. cognitive arousal at bedtime — düşünceler durmadığı zaman olur.`;
  return {
    pattern: 'sleep_onset_gap',
    n_valid_nights: valid.length,
    n_low_efficiency_nights: lowEffNights,
    median_onset_latency_min: Math.round(medOnset),
    median_efficiency: Number(medEff.toFixed(3)),
    confidence,
    copy,
    source: {
      citation: 'Edinger & Wohlgemuth 2001, JAMA — sleep efficiency 85% clinical threshold (CBT-I)',
      url: 'https://pubmed.ncbi.nlm.nih.gov/11308399/',
    },
  };
}

export function detectWeekendRecoveryIllusion(
  history: BaseHistory,
  opts?: WeekendRecoveryOpts,
): WeekendRecoveryIllusionPattern | null {
  if (!history || !Array.isArray(history.sleepRecords)) return null;
  const o = opts || {};
  const W = o.window_nights != null ? o.window_nights : 28;
  const weekdayMaxMin = o.weekday_max_min != null ? o.weekday_max_min : 390;
  const minGapMin = o.min_gap_min != null ? o.min_gap_min : 90;
  const minWeeks = o.min_weeks != null ? o.min_weeks : 3;
  const weekdays = o.weekday_set || ['sun', 'mon', 'tue', 'wed', 'thu'];
  const weekendDays = o.weekend_set || ['fri', 'sat'];
  const weekdaySet = new Set(weekdays.map((d) => d.toLowerCase()));
  const weekendSet = new Set(weekendDays.map((d) => d.toLowerCase()));
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const usable = history.sleepRecords
    .filter((r) => r && !r.is_skipped && r.tst_min != null && r.night_of)
    .slice(-W);
  if (usable.length === 0) return null;
  const weekdayTst: number[] = [], weekendTst: number[] = [];
  for (const r of usable) {
    const d = new Date(r.night_of + 'T12:00:00');
    const name = dayNames[d.getDay()];
    if (weekdaySet.has(name)) weekdayTst.push(r.tst_min as number);
    else if (weekendSet.has(name)) weekendTst.push(r.tst_min as number);
  }
  if (weekdayTst.length < 9 || weekendTst.length < 4) return null;
  const wdMean = _mean(weekdayTst)!;
  const weMean = _mean(weekendTst)!;
  const gap = weMean - wdMean;
  const nWeeks = Math.floor(weekdayTst.length / 5);
  if (wdMean >= weekdayMaxMin) return null;
  if (gap < minGapMin) return null;
  if (nWeeks < minWeeks) return null;
  const wdH = Number((wdMean / 60).toFixed(1));
  const weH = Number((weMean / 60).toFixed(1));
  const confidence = nWeeks >= 4 ? 'high' : 'medium';
  const fmtH = (h: number) => `${h.toFixed(1)}h`;
  const copy = `hafta içi ortalama ${fmtH(wdH)}, hafta sonu ${fmtH(weH)}. recovery diye düşündüğün şeyi vücudun böyle saymıyor.`;
  return {
    pattern: 'weekend_recovery_illusion',
    weekday_mean_h: wdH,
    weekend_mean_h: weH,
    gap_min: Math.round(gap),
    n_weekday_nights: weekdayTst.length,
    n_weekend_nights: weekendTst.length,
    n_weeks_estimated: nWeeks,
    confidence,
    copy,
    source: {
      citation:
        'Depner et al. 2019, Current Biology — Ad libitum weekend recovery sleep fails to prevent metabolic dysregulation during repeated insufficient sleep',
      url: 'https://pubmed.ncbi.nlm.nih.gov/30827911/',
    },
  };
}

export function detectBedtimeMindRacing(
  history: CaffeineCutoffHistory,
  opts?: BedtimeMindRacingOpts,
): BedtimeMindRacingPattern | null {
  if (
    !history ||
    !Array.isArray(history.sleepRecords) ||
    !Array.isArray(history.dumps)
  )
    return null;
  const o = opts || {};
  const W = o.window_nights != null ? o.window_nights : 14;
  const winMs = (o.window_minutes != null ? o.window_minutes : 90) * 60 * 1000;
  const threshold = o.score_threshold != null ? o.score_threshold : 0.3;
  const minMatchNights = o.min_match_nights != null ? o.min_match_nights : 7;

  const usable = history.sleepRecords
    .filter((r) => r && !r.is_skipped && r.bedtime && r.night_of)
    .slice(-W);
  if (usable.length < W) return null;

  const nights: Array<{ bedtimeMs: number; night_of: string }> = [];
  for (const r of usable) {
    const btMin = parseTimeOfDay(r.bedtime);
    if (btMin == null) continue;
    const baseDate = new Date(r.night_of + 'T12:00:00');
    if (btMin < 720) baseDate.setDate(baseDate.getDate() + 1);
    const y = baseDate.getFullYear();
    const mo = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    const hh = String(Math.floor(btMin / 60)).padStart(2, '0');
    const mm = String(btMin % 60).padStart(2, '0');
    const bedtimeMs = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00`).getTime();
    nights.push({ bedtimeMs, night_of: r.night_of });
  }
  if (nights.length < W) return null;

  const phraseCount = new Map<string, number>();
  const perNightScores: Array<number | null> = [];
  let nightsWithDumps = 0;
  let nightsHigh = 0;

  for (const n of nights) {
    const inWindow = history.dumps.filter(
      (dp) => dp && typeof dp.ts === 'number' && Math.abs(dp.ts - n.bedtimeMs) <= winMs,
    );
    if (inWindow.length === 0) {
      perNightScores.push(null);
      continue;
    }
    nightsWithDumps++;
    const concat = inWindow.map((d) => String(d.text || '')).join(' \n ');
    const lower = concat.toLowerCase();
    let matchCount = 0;
    for (const phrase of RUMINATIVE_LEXICON) {
      if (lower.includes(phrase.toLowerCase())) {
        matchCount++;
        phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
      }
    }
    const sepMatches = concat.match(/[.!?\n]/g);
    const sentenceCount = Math.max(1, (sepMatches ? sepMatches.length : 0) + 1);
    const score = matchCount / sentenceCount;
    perNightScores.push(score);
    if (score >= threshold) nightsHigh++;
  }

  if (nightsWithDumps < 10) return null;
  if (nightsHigh < minMatchNights) return null;

  const validScores = perNightScores.filter((s): s is number => s != null);
  const med = _median(validScores)!;
  const topPhrases = Array.from(phraseCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p]) => p);
  const confidence = nightsHigh >= 10 ? 'high' : 'medium';
  const copy = `son 14 gece içinde ${nightsHigh} gece, yatış civarı dump'ında 'kafamda dön' + 'susmuyo' + 'kapanmıyor' kalıpları yoğun. bedtime mind racing.`;
  return {
    pattern: 'bedtime_mind_racing',
    n_high_score_nights: nightsHigh,
    n_window_nights_with_dumps: nightsWithDumps,
    median_score: Number(med.toFixed(2)),
    top_phrases: topPhrases,
    confidence,
    copy,
    source: {
      citation:
        'Harvey 2002, Behaviour Research and Therapy — A cognitive model of insomnia; Van Veen et al. 2010, Biological Psychiatry — ADHD bedtime cognitive arousal',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12186352/',
    },
  };
}

// ─── Phase 2 ──────────────────────────────────────────────────────────

export function detectWindDownFriction(
  history: WindDownFrictionHistory,
  opts?: WindDownFrictionOpts,
): WindDownFrictionPattern | null {
  if (!history || typeof history !== 'object') return null;
  if (history.opted_in !== true) return null;
  const o = opts || {};
  const W = typeof o.window_nights === 'number' ? o.window_nights : 14;
  const minTotal = typeof o.min_total_minutes === 'number' ? o.min_total_minutes : 60;
  const minNights = typeof o.min_nights === 'number' ? o.min_nights : 10;

  const log = Array.isArray(history.windDownLog) ? history.windDownLog : [];
  const records = Array.isArray(history.sleepRecords) ? history.sleepRecords : [];
  const target = parseTimeOfDay(history.targetBedtime);
  if (target == null) return null;
  if (!log.length || !records.length) return null;

  const now = typeof history.now === 'number' ? history.now : null;
  const cutoff = now != null ? now - W * 86400000 : -Infinity;

  const eventsByNight = new Map<string, typeof log>();
  for (const e of log) {
    if (!e || typeof e.ts !== 'number' || !isFinite(e.ts)) continue;
    if (!e.step_id || !e.action) continue;
    if (e.action !== 'checked' && e.action !== 'unchecked') continue;
    const d = new Date(e.ts);
    let key = isoDate(e.ts);
    if (d.getHours() < 12) {
      const prior = new Date(e.ts);
      prior.setDate(prior.getDate() - 1);
      key = isoDate(prior.getTime());
    }
    if (!eventsByNight.has(key)) eventsByNight.set(key, []);
    eventsByNight.get(key)!.push(e);
  }

  const totals: number[] = [];
  const stepStats = new Map<string, { label: string | null; perNight: number[] }>();
  let usableNights = 0;

  for (const r of records.slice(-W * 2)) {
    if (!r || !r.night_of || !r.bedtime) continue;
    if (now != null) {
      const ts = new Date(r.night_of + 'T12:00:00').getTime();
      if (ts < cutoff) continue;
    }
    const ev = eventsByNight.get(r.night_of);
    if (!ev || ev.length === 0) continue;
    const dayStart = new Date(r.night_of + 'T00:00:00').getTime();
    const targetEpoch =
      target >= 720 ? dayStart + target * 60000 : dayStart + 86400000 + target * 60000;
    const btMin = parseTimeOfDay(r.bedtime);
    if (btMin == null) continue;
    const bedtimeEp =
      btMin >= 720 ? dayStart + btMin * 60000 : dayStart + 86400000 + btMin * 60000;
    if (!isFinite(bedtimeEp) || !isFinite(targetEpoch)) continue;
    if (bedtimeEp <= targetEpoch) continue;
    const sorted = ev.slice().sort((a, b) => a.ts - b.ts);
    const firstAfter = sorted.find((x) => x.ts > targetEpoch && x.ts <= bedtimeEp);
    if (!firstAfter) continue;
    const totalMin = (bedtimeEp - firstAfter.ts) / 60000;
    if (!isFinite(totalMin) || totalMin <= 0) continue;
    totals.push(totalMin);
    const inWindow = sorted.filter((x) => x.ts >= firstAfter.ts && x.ts <= bedtimeEp);
    const nightStepTime = new Map<string, { label: string | null; minutes: number }>();
    for (let i = 0; i < inWindow.length; i++) {
      const cur = inWindow[i];
      if (cur.action !== 'checked') continue;
      const nextTs = i + 1 < inWindow.length ? inWindow[i + 1].ts : bedtimeEp;
      let dur = (nextTs - cur.ts) / 60000;
      if (!isFinite(dur) || dur <= 0) continue;
      if (dur > 30) dur = 30;
      const slot = nightStepTime.get(cur.step_id) || {
        label: cur.step_label || cur.step_id,
        minutes: 0,
      };
      slot.minutes += dur;
      if (cur.step_label) slot.label = cur.step_label;
      nightStepTime.set(cur.step_id, slot);
    }
    for (const [stepId, agg] of nightStepTime.entries()) {
      if (!stepStats.has(stepId)) stepStats.set(stepId, { label: agg.label, perNight: [] });
      const slot = stepStats.get(stepId)!;
      if (agg.label) slot.label = agg.label;
      slot.perNight.push(agg.minutes);
    }
    usableNights++;
  }

  if (usableNights < minNights) return null;
  const medTotal = _median(totals);
  if (medTotal == null || medTotal < minTotal) return null;

  let stuckId: string | null = null;
  let stuckLabel: string | null = null;
  let stuckMed = -1;
  for (const [stepId, slot] of stepStats.entries()) {
    if (slot.perNight.length < 3) continue;
    const m = _median(slot.perNight);
    if (m == null) continue;
    if (m > stuckMed) {
      stuckMed = m;
      stuckId = stepId;
      stuckLabel = slot.label;
    }
  }
  if (!stuckId) return null;

  const confidence = usableNights >= 12 ? 'high' : 'medium';
  const medTotalInt = Math.round(medTotal);
  const stuckMedInt = Math.round(stuckMed);
  return {
    pattern: 'wind_down_friction',
    median_total_minutes: medTotalInt,
    stuck_step_id: stuckId,
    stuck_step_label: stuckLabel,
    median_stuck_minutes: stuckMedInt,
    n_nights: usableNights,
    confidence,
    copy: `yatağa 'gitmek istediğin' saatten gerçek yatış arası medyan ${medTotalInt} dakika. en sık takıldığın adım: '${stuckLabel}'. yorgunluk değil, task-switching cost.`,
    source: {
      citation:
        'Hvolby 2015, ADHD Atten Defic Hyperact Disord — Associations of sleep disturbance with ADHD: implications for treatment',
      url: 'https://pubmed.ncbi.nlm.nih.gov/25127644/',
    },
  };
}

export function detectMedicationTimingDrift(
  history: MedicationTimingDriftHistory,
  opts?: MedicationTimingDriftOpts,
): MedicationTimingDriftPattern | null {
  if (!history || history.opted_in !== true) return null;
  const o = opts || {};
  const windowDays = o.window_days || 21;
  const minPaired = o.min_paired_nights || 14;
  const driftThresholdHours = o.drift_threshold_hours || 1;

  const medsLog = Array.isArray(history.medsLog) ? history.medsLog : null;
  const sleepRecords = Array.isArray(history.sleepRecords) ? history.sleepRecords : null;
  const now = typeof history.now === 'number' ? history.now : null;
  if (!medsLog || !sleepRecords || now == null) return null;

  const medsByDay: Record<string, number> = {};
  for (const e of medsLog) {
    if (!e || typeof e.ts !== 'number' || !isFinite(e.ts)) continue;
    const day = isoDate(e.ts);
    if (medsByDay[day] == null || e.ts > medsByDay[day]) medsByDay[day] = e.ts;
  }

  const cutoff = now - windowDays * 86400000;
  const pairs: Array<{ ts: number; gap: number }> = [];
  for (const r of sleepRecords) {
    if (!r || r.is_skipped || !r.bedtime || !r.night_of) continue;
    const btMin = parseTimeOfDay(r.bedtime);
    if (btMin == null) continue;
    const nightDate = new Date(r.night_of + 'T12:00:00');
    if (isNaN(nightDate.getTime())) continue;
    const bedtimeDate = new Date(nightDate.getTime());
    if (btMin < 720) bedtimeDate.setDate(bedtimeDate.getDate() + 1);
    bedtimeDate.setHours(Math.floor(btMin / 60), btMin % 60, 0, 0);
    const bedtimeEp = bedtimeDate.getTime();
    if (bedtimeEp < cutoff || bedtimeEp > now) continue;
    const medsTs = medsByDay[r.night_of];
    if (medsTs == null) continue;
    if (medsTs >= bedtimeEp) continue;
    const gapHours = (bedtimeEp - medsTs) / 3600000;
    if (gapHours <= 0 || gapHours > 24) continue;
    pairs.push({ ts: bedtimeEp, gap: gapHours });
  }
  if (pairs.length < minPaired) return null;
  pairs.sort((a, b) => a.ts - b.ts);

  const rolling: Array<{ x: number; y: number }> = [];
  for (let i = 6; i < pairs.length; i++) {
    const win = pairs.slice(i - 6, i + 1).map((p) => p.gap);
    rolling.push({ x: i, y: _median(win)! });
  }
  if (rolling.length < 2) return null;

  const xs = rolling.map((p) => p.x);
  const ys = rolling.map((p) => p.y);
  const xMean = _mean(xs)!, yMean = _mean(ys)!;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const driftAcrossWindow = Math.abs(slope) * 7;
  if (driftAcrossWindow < driftThresholdHours) return null;

  const half = Math.floor(pairs.length / 2);
  const priorGaps = pairs.slice(0, half).map((p) => p.gap);
  const recentGaps = pairs.slice(pairs.length - half).map((p) => p.gap);
  const priorMed = _median(priorGaps);
  const recentMed = _median(recentGaps);
  if (priorMed == null || recentMed == null) return null;

  const driftHours = Number((recentMed - priorMed).toFixed(1));
  const direction = driftHours < 0 ? 'narrowing' : 'widening';
  const recent1 = Number(recentMed.toFixed(1));
  const prior1 = Number(priorMed.toFixed(1));
  const confidence = pairs.length >= 18 ? 'high' : 'medium';
  const copy =
    direction === 'narrowing'
      ? `son 3 hafta, ilaç ile yatış arası ortalama ${prior1} saatten ${recent1} saate inmiş. doktoruna gösterebileceğin bir desen.`
      : `son 3 hafta, ilaç ile yatış arası ortalama ${prior1} saatten ${recent1} saate çıkmış. doktoruna gösterebileceğin bir desen.`;
  return {
    pattern: 'medication_timing_drift',
    recent_3wk_median_gap_hours: recent1,
    prior_3wk_median_gap_hours: prior1,
    drift_hours: Number(Math.abs(driftHours).toFixed(1)),
    direction,
    n_paired_nights: pairs.length,
    confidence,
    copy,
    prescriber_link_copy: 'doktoruna gösterebileceğin bir desen',
    source: {
      citation:
        'Stein et al. 2012, J Clin Sleep Med — Methylphenidate dosing in children with ADHD and sleep onset delay; Kidwell et al. 2015, Pediatrics — stimulant timing meta-analysis',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3441938/',
    },
  };
}

export function detectChronotherapyProgress(
  history: ChronotherapyProgressHistory,
  opts?: ChronotherapyProgressOpts,
): ChronotherapyProgressPattern | null {
  if (!history || history.opted_in !== true) return null;
  const ch = history.chronotherapy;
  if (!ch || ch.active !== true) return null;
  if (typeof ch.target_bedtime !== 'string' || !ch.target_bedtime) return null;
  const targetMin = parseTimeOfDay(ch.target_bedtime);
  if (targetMin == null) return null;

  const o = opts || {};
  const W = o.window_nights || 21;
  const minN = o.min_nights || 14;
  const minMove = o.min_movement_minutes != null ? o.min_movement_minutes : 5;

  if (!Array.isArray(history.sleepRecords)) return null;
  const usable = history.sleepRecords.filter((r) => r && r.bedtime).slice(-W);
  if (usable.length < minN) return null;

  const targetRel = bedtimeRelativeMinutes(targetMin)!;
  const offsets: number[] = [];
  for (const r of usable) {
    const m = parseTimeOfDay(r.bedtime);
    if (m == null) continue;
    let d = bedtimeRelativeMinutes(m)! - targetRel;
    if (d > 720) d -= 1440;
    else if (d <= -720) d += 1440;
    offsets.push(d);
  }
  if (offsets.length < minN) return null;

  const first7 = offsets.slice(0, 7);
  const last7 = offsets.slice(-7);
  if (first7.length < 7 || last7.length < 7) return null;

  const m1 = _median(first7)!;
  const m2 = _median(last7)!;
  const movementMin = Math.round(m1 - m2);
  const absMove = Math.abs(movementMin);

  let direction: 'forward' | 'back' | 'flat';
  if (absMove < minMove) direction = 'flat';
  else if (movementMin > 0) direction = 'forward';
  else direction = 'back';

  const toClock = (offset: number): string => {
    let m = (targetMin + offset) % 1440;
    if (m < 0) m += 1440;
    return formatTime(Math.round(m));
  };
  const first7Clock = toClock(m1);
  const last7Clock = toClock(m2);
  const nNights = offsets.length;
  const confidence = nNights >= 18 ? 'high' : 'medium';

  let copy: string;
  if (direction === 'forward') {
    copy = `hedef: ${ch.target_bedtime}. son 21 gecenin median yatışı ${first7Clock}'ten ${last7Clock}'ye kaydı. ${absMove} dakika öne. yön doğru.`;
  } else if (direction === 'back') {
    copy = `hedef: ${ch.target_bedtime}. son 21 gecenin median yatışı ${first7Clock}'ten ${last7Clock}'ye kaydı. ${absMove} dakika geriye.`;
  } else {
    copy = `hedef: ${ch.target_bedtime}. son 21 gecenin median yatışı ${first7Clock} civarında. ne öne ne geriye.`;
  }

  return {
    pattern: 'chronotherapy_progress',
    target_bedtime: ch.target_bedtime,
    median_bedtime_first_7: first7Clock,
    median_bedtime_last_7: last7Clock,
    movement_minutes: movementMin,
    direction,
    n_nights: nNights,
    confidence,
    copy,
    source: {
      citation:
        'Saxvig et al. 2014, Sleep Medicine — A randomized controlled trial with bright light and melatonin for delayed sleep phase disorder',
      url: 'https://doi.org/10.1016/j.sleep.2013.11.787',
    },
  };
}

// ─── Phase 3 ──────────────────────────────────────────────────────────

export function detectSleepCyclePattern(
  history: SleepCycleHistory,
  opts?: CyclePhaseSleepOpts,
): SleepCyclePhaseShiftPattern | null {
  if (!history || history.opted_in !== true) return null;
  const sleepRecords = history.sleepRecords;
  const cycles = history.cycles;
  if (!Array.isArray(sleepRecords) || !Array.isArray(cycles)) return null;
  const o = opts || {};
  const minCycles = o.window_cycles != null ? o.window_cycles : 3;
  const minOverlap = o.min_overlap_nights != null ? o.min_overlap_nights : 14;

  const phaseFor = (nightOfStr: string): 'luteal' | 'follicular' | null => {
    const d = new Date(nightOfStr + 'T12:00:00').getTime();
    if (!isFinite(d)) return null;
    for (const c of cycles) {
      if (!c || !c.start_date || typeof c.length_days !== 'number') continue;
      const start = new Date(c.start_date + 'T12:00:00').getTime();
      if (!isFinite(start)) continue;
      const end = start + c.length_days * 86400000;
      if (d < start || d >= end) continue;
      const dayInCycle = Math.floor((d - start) / 86400000) + 1;
      const ov = c.ovulation_day || Math.round(c.length_days / 2);
      return dayInCycle > ov ? 'luteal' : 'follicular';
    }
    return null;
  };

  if (cycles.length < minCycles) return null;

  const lutealRel: number[] = [], follicularRel: number[] = [];
  let nLuteal = 0, nFollicular = 0;
  for (const r of sleepRecords) {
    if (!r || r.is_skipped || !r.bedtime || !r.night_of) continue;
    const phase = phaseFor(r.night_of);
    if (!phase) continue;
    const min = parseTimeOfDay(r.bedtime);
    if (min == null) continue;
    const rel = bedtimeRelativeMinutes(min);
    if (rel == null) continue;
    if (phase === 'luteal') { lutealRel.push(rel); nLuteal++; }
    else { follicularRel.push(rel); nFollicular++; }
  }

  if (nLuteal + nFollicular < minOverlap) return null;
  if (nLuteal < 5 || nFollicular < 5) return null;

  const lutMed = _median(lutealRel);
  const folMed = _median(follicularRel);
  if (lutMed == null || folMed == null) return null;
  const shift = Math.round(lutMed - folMed);
  if (Math.abs(shift) < 30) return null;

  const fmtRel = (rel: number): string => {
    const clock = ((rel + 1440) % 1440 + 1440) % 1440;
    return formatTime(Math.round(clock));
  };
  const direction = shift > 0 ? 'luteal_later' : 'luteal_earlier';
  const shiftAbs = Math.abs(shift);
  const confidence =
    cycles.length >= 5 && Math.min(nLuteal, nFollicular) >= 10 ? 'high' : 'medium';
  return {
    pattern: 'sleep_cycle_phase_shift',
    luteal_median_bedtime: fmtRel(lutMed),
    follicular_median_bedtime: fmtRel(folMed),
    shift_minutes: shiftAbs,
    direction,
    n_cycles: cycles.length,
    n_luteal_nights: nLuteal,
    n_follicular_nights: nFollicular,
    confidence,
    copy:
      'luteal fazda yatış ' +
      shiftAbs +
      ' dk ' +
      (direction === 'luteal_later' ? 'geç' : 'erken') +
      '. ' +
      cycles.length +
      ' cycle üzerinden gözlem.',
    source: {
      citation:
        'Baker & Driver 2007, Sleep Medicine Reviews — Circadian rhythms, sleep, and the menstrual cycle',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17383933/',
    },
  };
}

export function detectSleepFocusPattern(
  history: SleepFocusHistory,
  opts?: SleepFocusOpts,
): SleepFocusShiftPattern | null {
  if (!history || history.opted_in !== true) return null;
  const sleepRecords = history.sleepRecords;
  const focusLog = history.focusLog;
  if (!Array.isArray(sleepRecords) || !Array.isArray(focusLog)) return null;
  const o = opts || {};
  const shortH = o.short_sleep_threshold_h != null ? o.short_sleep_threshold_h : 5;
  const minShort = o.min_short_nights != null ? o.min_short_nights : 5;
  const minBase = o.min_baseline_nights != null ? o.min_baseline_nights : 10;
  const shortMin = shortH * 60;

  const tstByNight = new Map<string, number>();
  for (const r of sleepRecords) {
    if (!r || r.is_skipped || r.tst_min == null || !r.night_of) continue;
    tstByNight.set(r.night_of, r.tst_min as number);
  }
  if (tstByNight.size === 0) return null;

  const priorNightOf = (atMs: number): string | null => {
    if (typeof atMs !== 'number' || !isFinite(atMs)) return null;
    const d = new Date(atMs);
    d.setDate(d.getDate() - 1);
    return isoDate(d.getTime());
  };

  const shortHours: number[] = [], normalHours: number[] = [];
  for (const s of focusLog) {
    if (!s || typeof s.at !== 'number') continue;
    const night = priorNightOf(s.at);
    if (!night) continue;
    const tst = tstByNight.get(night);
    if (tst == null) continue;
    const hr = new Date(s.at).getHours();
    if (!isFinite(hr)) continue;
    if (tst < shortMin) shortHours.push(hr);
    else normalHours.push(hr);
  }

  if (shortHours.length < minShort || normalHours.length < minBase) return null;

  const peakOf = (arr: number[]): number => {
    const counts = new Map<number, number>();
    for (const h of arr) counts.set(h, (counts.get(h) || 0) + 1);
    let best = -1, bestCount = -1;
    for (const [h, c] of counts) {
      if (c > bestCount || (c === bestCount && h < best)) {
        best = h;
        bestCount = c;
      }
    }
    return best;
  };
  const shortPeak = peakOf(shortHours);
  const normalPeak = peakOf(normalHours);
  if (shortPeak < 0 || normalPeak < 0) return null;
  const shift = shortPeak - normalPeak;
  if (Math.abs(shift) < 2) return null;

  const confidence =
    shortHours.length >= 10 && normalHours.length >= 20 ? 'high' : 'medium';
  return {
    pattern: 'sleep_focus_shift',
    short_sleep_peak_hour: shortPeak,
    normal_sleep_peak_hour: normalPeak,
    hour_shift: Math.abs(shift),
    direction: shift > 0 ? 'later' : 'earlier',
    n_post_short_sessions: shortHours.length,
    n_post_normal_sessions: normalHours.length,
    confidence,
    copy:
      '5 saatten az uyuduğun ertesi günler, deep-focus saatin ' +
      normalPeak +
      ":00'dan " +
      shortPeak +
      ":00'a kayıyor.",
    source: {
      citation:
        'Walker 2009, Annual Review of Neuroscience — The role of sleep in cognition and emotion; Lim & Dinges 2010, Psychological Bulletin meta-analysis',
      url: 'https://pubmed.ncbi.nlm.nih.gov/20438143/',
    },
  };
}

export function detectSleepDumpMoodPattern(
  history: SleepMoodHistory,
  opts?: SleepMoodOpts,
): SleepDumpMoodShiftPattern | null {
  if (!history || history.opted_in !== true) return null;
  const sleepRecords = history.sleepRecords;
  const dumps = history.dumps;
  if (!Array.isArray(sleepRecords) || !Array.isArray(dumps)) return null;
  const o = opts || {};
  const poorH = o.poor_sleep_threshold_h != null ? o.poor_sleep_threshold_h : 6;
  const lookback = o.lookback_hours_window != null ? o.lookback_hours_window : 24;
  const minPairs = o.min_pairs != null ? o.min_pairs : 10;
  const poorMin = poorH * 60;
  const normalMin = 7 * 60;

  const sortedDumps = dumps
    .filter((d) => d && typeof d.ts === 'number' && typeof d.text === 'string')
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (sortedDumps.length === 0) return null;

  const matchCount = (text: string): number => {
    const lower = text.toLowerCase();
    let m = 0;
    for (const phrase of OVERWHELMED_LEXICON) {
      const re = new RegExp(
        '\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
        'i',
      );
      if (re.test(lower)) m++;
    }
    return m;
  };
  const sentenceCount = (text: string): number => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const parts = trimmed.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
    return Math.max(1, parts.length);
  };

  const poorRatios: number[] = [], normalRatios: number[] = [];
  for (const r of sleepRecords) {
    if (!r || r.is_skipped || r.tst_min == null || !r.night_of || !r.bedtime) continue;
    const isPoor = (r.tst_min as number) < poorMin;
    const isNormal = (r.tst_min as number) >= normalMin;
    if (!isPoor && !isNormal) continue;
    const btMin = parseTimeOfDay(r.bedtime);
    if (btMin == null) continue;
    const baseDate = new Date(r.night_of + 'T00:00:00').getTime();
    if (!isFinite(baseDate)) continue;
    const bedtimeMs = baseDate + btMin * 60000 + (btMin < 720 ? 86400000 : 0);
    const winStart = bedtimeMs + 24 * 3600000;
    const winEnd = winStart + lookback * 3600000;
    for (const d of sortedDumps) {
      if (d.ts < winStart) continue;
      if (d.ts >= winEnd) break;
      const sc = sentenceCount(d.text);
      if (sc === 0) continue;
      const ratio = matchCount(d.text) / sc;
      if (isPoor) poorRatios.push(ratio);
      else normalRatios.push(ratio);
    }
  }

  if (poorRatios.length < minPairs || normalRatios.length < minPairs) return null;
  const poorMean = _mean(poorRatios)!;
  const normalMean = _mean(normalRatios)!;
  if (poorMean < 0.15) return null;
  if (normalMean === 0) {
    if (poorMean < 0.15) return null;
  } else if (poorMean < 1.5 * normalMean) {
    return null;
  }
  const lift = normalMean > 0 ? poorMean / normalMean : 10;
  const confidence =
    poorRatios.length >= 20 && normalRatios.length >= 20 ? 'high' : 'medium';
  return {
    pattern: 'sleep_dump_mood_shift',
    poor_sleep_overwhelm_ratio: Number(poorMean.toFixed(2)),
    normal_sleep_overwhelm_ratio: Number(normalMean.toFixed(2)),
    ratio_lift: Number(lift.toFixed(2)),
    n_poor_sleep_dumps: poorRatios.length,
    n_normal_sleep_dumps: normalRatios.length,
    confidence,
    copy:
      "kötü uykudan 1 gün sonra dump'lar 'overwhelmed' kelime hattında " +
      Number(lift.toFixed(2)) +
      'x daha yoğun. pattern, not cause.',
    source: {
      citation:
        'Yoo et al. 2007, Current Biology — The human emotional brain without sleep — a prefrontal amygdala disconnect',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17956744/',
    },
  };
}

// ─── Phase 4 ──────────────────────────────────────────────────────────

export function detectCyclePhaseSleepCoupling(
  history: CyclePhaseSleepHistory,
  opts?: CyclePhaseSleepCouplingOpts,
): CyclePhaseSleepCouplingPattern | null {
  if (!history || history.opted_in !== true) return null;
  const sleepRecords = history.sleepRecords;
  const cyclePhases = history.cyclePhases;
  if (!Array.isArray(sleepRecords) || !Array.isArray(cyclePhases)) return null;
  const o = opts || {};
  const minLutealNights = o.minLutealNights != null ? o.minLutealNights : 5;
  const minOtherNights = o.minOtherNights != null ? o.minOtherNights : 10;
  const minDeltaMin = o.minDeltaMin != null ? o.minDeltaMin : 8;

  const isoDayKey = (ms: number): string => {
    const d = new Date(ms);
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  };

  const phaseForDay = new Map<string, string>();
  for (const p of cyclePhases) {
    if (
      !p ||
      typeof p.start !== 'number' ||
      typeof p.end !== 'number' ||
      typeof p.name !== 'string'
    )
      continue;
    for (let t = p.start; t <= p.end; t += 86400000)
      phaseForDay.set(isoDayKey(t), p.name);
  }
  if (phaseForDay.size === 0) return null;

  const lutealOnsets: number[] = [], otherOnsets: number[] = [];
  for (const r of sleepRecords) {
    if (!r || r.is_skipped) continue;
    if (typeof r.onset_latency_min !== 'number' || (r.onset_latency_min as number) < 0) continue;
    if (typeof r.night_of !== 'string') continue;
    const phase = phaseForDay.get(r.night_of);
    if (!phase) continue;
    if (phase === 'luteal') lutealOnsets.push(r.onset_latency_min as number);
    else otherOnsets.push(r.onset_latency_min as number);
  }

  if (lutealOnsets.length < minLutealNights || otherOnsets.length < minOtherNights)
    return null;

  const med = (a: number[]): number | null => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const lutealMedian = med(lutealOnsets);
  const otherMedian = med(otherOnsets);
  if (lutealMedian == null || otherMedian == null) return null;
  const delta = lutealMedian - otherMedian;
  if (delta < minDeltaMin) return null;

  const sampleN = lutealOnsets.length + otherOnsets.length;
  const confidence =
    lutealOnsets.length >= 8 && otherOnsets.length >= 14 && delta >= 12
      ? 'high'
      : delta >= 10
      ? 'medium'
      : 'low';
  return {
    pattern: 'cycle_phase_sleep_coupling',
    luteal_onset_median_min: Math.round(lutealMedian),
    other_onset_median_min: Math.round(otherMedian),
    delta_min: Math.round(delta),
    luteal_n: lutealOnsets.length,
    other_n: otherOnsets.length,
    sample_n: sampleN,
    confidence,
    copy:
      'in luteal phase, sleep onset takes ~' +
      Math.round(delta) +
      ' more minutes than the rest of the cycle. pattern, not failure.',
    source: {
      citation: 'Baker & Driver 2007, Sleep Medicine — sleep across the menstrual cycle',
      url: 'https://pubmed.ncbi.nlm.nih.gov/17383933/',
    },
  };
}

export function detectStimulantSleepDebt(
  history: StimulantSleepHistory,
  opts?: StimulantSleepDebtOpts,
): StimulantSleepDebtPattern | null {
  if (!history || history.opted_in !== true) return null;
  const sleepRecords = history.sleepRecords;
  const dumps = history.dumps;
  if (!Array.isArray(sleepRecords) || !Array.isArray(dumps)) return null;
  const o = opts || {};
  const minStimNights = o.minStimNights != null ? o.minStimNights : 5;
  const minBaselineNights = o.minBaselineNights != null ? o.minBaselineNights : 10;
  const minDeltaMin = o.minDeltaMin != null ? o.minDeltaMin : 10;

  const isoDayKey = (ms: number): string => {
    const d = new Date(ms);
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  };

  const stimDays = new Set<string>();
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    const text =
      typeof d.text === 'string' ? d.text : '';
    if (!text || !STIMULANT_RE.test(text)) continue;
    stimDays.add(isoDayKey(d.ts));
  }
  if (stimDays.size === 0) return null;

  const stimOnsets: number[] = [], baselineOnsets: number[] = [];
  for (const r of sleepRecords) {
    if (!r || r.is_skipped) continue;
    if (typeof r.onset_latency_min !== 'number' || (r.onset_latency_min as number) < 0) continue;
    if (typeof r.night_of !== 'string') continue;
    if (stimDays.has(r.night_of)) stimOnsets.push(r.onset_latency_min as number);
    else baselineOnsets.push(r.onset_latency_min as number);
  }

  if (stimOnsets.length < minStimNights || baselineOnsets.length < minBaselineNights)
    return null;

  const med = (a: number[]): number | null => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const stimMedian = med(stimOnsets);
  const baselineMedian = med(baselineOnsets);
  if (stimMedian == null || baselineMedian == null) return null;
  const delta = stimMedian - baselineMedian;
  if (delta < minDeltaMin) return null;

  const sampleN = stimOnsets.length + baselineOnsets.length;
  const confidence =
    stimOnsets.length >= 8 && delta >= 20
      ? 'high'
      : delta >= 15
      ? 'medium'
      : 'low';
  return {
    pattern: 'stimulant_sleep_debt',
    stim_onset_median_min: Math.round(stimMedian),
    baseline_onset_median_min: Math.round(baselineMedian),
    delta_min: Math.round(delta),
    stim_n: stimOnsets.length,
    baseline_n: baselineOnsets.length,
    sample_n: sampleN,
    confidence,
    copy:
      'nights after a stimulant-mention day, onset takes ~' +
      Math.round(delta) +
      ' more minutes. pattern, not prescription.',
    source: {
      citation:
        'Cortese et al. 2012, J Clinical Sleep Medicine — meta-analysis of stimulants on sleep in ADHD',
      url: 'https://pubmed.ncbi.nlm.nih.gov/23204521/',
    },
  };
}
