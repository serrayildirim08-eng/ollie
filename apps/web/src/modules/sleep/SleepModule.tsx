/**
 * SleepModule — paper/ink editorial language.
 * Ported from void-app.html SleepModule (~lines 38816–39427).
 *
 * Visual: Courier New / paper-bone palette. No frosted glass, no sky video.
 * Tone: dry, deadpan, lowercase. No streaks.
 *
 * Wire: reads store 'sleep' slices. Logic via @ollie/logic/sleep (useMemo).
 * Store writes use the store.set path via useStoreSlice setter.
 */

import { useMemo, useState, useCallback } from 'react';
import {
  resolveTarget,
  parseSleepDump,
  deriveSleepStats,
  computeSleepDebt,
  detectBedtimeDrift,
  estimateChronotype,
  computeSocialJetlag,
  detectDSPSPattern,
  detectShortSleepRun,
} from '@ollie/logic/sleep';
import type {
  SleepRecord,
  SleepSettings,
  SleepStats,
  SleepDebt,
  ChronotypeResult,
  SocialJetlagResult,
  BedtimeDriftResult,
  DSPSResult,
  ShortSleepRunResult,
  ForecastResult,
  AnySleepPattern,
  InsomniaSurveyResult,
  EpworthResult,
} from '@ollie/logic/sleep';
import type { CaffeineSleepResult } from '@ollie/logic/body';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';
import { SourcesLink } from '../../components/SourcesLink';
import { SleepSoundPlayer } from '../../components/SleepSoundPlayer';
import { WindDownChecklist } from './WindDownChecklist';
import { InsomniaSurvey } from './InsomniaSurvey';
import { EpworthSurvey } from './EpworthSurvey';

// ─── palette ─────────────────────────────────────────────────────────────────

const C = {
  bone:      '#F2EEE4',
  ink:       '#14130F',
  inkSoft:   '#4B4740',
  inkFaint:  '#7C7770',
  inkGhost:  '#C8C4BA',
  rule:      'rgba(20,19,15,0.10)',
  ruleSoft:  'rgba(20,19,15,0.06)',
  accent:    '#4F6E5B',
  night:     '#3A4E5E',
  warn:      '#B89556',
  concerned: '#8A4B2C',
} as const;

const COURIER = "'Courier New', Courier, monospace";

// ─── pattern meta (observation-only copy + source links) ─────────────────────

interface PatternMeta {
  tag: string;
  group: 'daily' | 'behavioral' | 'cross' | 'classic';
  accent: string;
  copy: (p: AnySleepPattern) => string;
  source: string;
  sourceUrl: string;
}

const PATTERN_META: Partial<Record<string, PatternMeta>> = {
  revenge_bedtime: {
    tag: 'revenge bedtime', group: 'classic', accent: C.warn,
    copy: (p) => {
      const rp = p as Extract<AnySleepPattern, { pattern: 'revenge_bedtime' }>;
      return `post-target-bedtime activity ${rp.n_revenge_nights}/${rp.n_total_nights} nights. "i don't want today to be over."`;
    },
    source: 'kroese 2014, frontiers',
    sourceUrl: 'https://doi.org/10.3389/fpsyg.2014.00611',
  },
  caffeine_cutoff: {
    tag: 'caffeine cutoff', group: 'daily', accent: C.ink,
    copy: (p) => {
      const cp = p as Extract<AnySleepPattern, { pattern: 'caffeine_cutoff' }>;
      return `median caffeine-to-bedtime gap ${cp.median_gap_hours.toFixed(1)}h. under the 6h floor most nights.`;
    },
    source: 'drake 2013, j clin sleep med',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/24235903/',
  },
  sleep_onset_gap: {
    tag: 'onset gap', group: 'daily', accent: C.ink,
    copy: (p) => {
      const sp = p as Extract<AnySleepPattern, { pattern: 'sleep_onset_gap' }>;
      return `in bed avg ${sp.median_onset_latency_min} min before you drop. efficiency ${Math.round(sp.median_efficiency * 100)}%.`;
    },
    source: 'edinger & wohlgemuth 2001',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/11308399/',
  },
  weekend_recovery_illusion: {
    tag: 'weekend recovery illusion', group: 'daily', accent: C.ink,
    copy: (p) => {
      const wp = p as Extract<AnySleepPattern, { pattern: 'weekend_recovery_illusion' }>;
      const gapH = (wp.gap_min / 60).toFixed(1);
      return `weekday avg ${wp.weekday_mean_h.toFixed(1)}h, weekends +${gapH}h. doesn't pay back the debt.`;
    },
    source: 'depner 2019, current biology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/30827911/',
  },
  bedtime_mind_racing: {
    tag: 'bedtime mind racing', group: 'daily', accent: C.ink,
    copy: (p) => {
      const bp = p as Extract<AnySleepPattern, { pattern: 'bedtime_mind_racing' }>;
      return `in bedtime brain dumps, ruminative density ${bp.median_score.toFixed(2)}. mind isn't lying down with you.`;
    },
    source: 'harvey 2002, BRT',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/12186352/',
  },
  wind_down_friction: {
    tag: 'wind-down friction', group: 'behavioral', accent: C.accent,
    copy: (p) => {
      const wp = p as Extract<AnySleepPattern, { pattern: 'wind_down_friction' }>;
      return `total wind-down avg ${wp.median_total_minutes} min. stuck step looks like "${wp.stuck_step_label ?? 'phone before bed'}".`;
    },
    source: 'hvolby 2015',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/25127644/',
  },
  medication_timing_drift: {
    tag: 'medication timing drift', group: 'behavioral', accent: C.accent,
    copy: (p) => {
      const mp = p as Extract<AnySleepPattern, { pattern: 'medication_timing_drift' }>;
      const sign = mp.drift_hours > 0 ? '+' : '';
      return `your med gap drifted ${sign}${mp.drift_hours.toFixed(1)}h over recent weeks. a pattern your doctor might want to see.`;
    },
    source: 'stein 2012, neurotherapeutics',
    sourceUrl: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3441938/',
  },
  chronotherapy_progress: {
    tag: 'chronotherapy progress', group: 'behavioral', accent: C.accent,
    copy: (p) => {
      const cp = p as Extract<AnySleepPattern, { pattern: 'chronotherapy_progress' }>;
      return `first 7 nights median ${cp.median_bedtime_first_7}, last 7 ${cp.median_bedtime_last_7}. direction: ${cp.direction}. no streaks.`;
    },
    source: 'saxvig 2014',
    sourceUrl: 'https://doi.org/10.1016/j.sleep.2013.11.787',
  },
  sleep_cycle_phase_shift: {
    tag: 'sleep × cycle', group: 'cross', accent: '#B86A8A',
    copy: (p) => {
      const sp = p as Extract<AnySleepPattern, { pattern: 'sleep_cycle_phase_shift' }>;
      return `in luteal phase, your bedtime shifts +${sp.shift_minutes} min later.`;
    },
    source: 'baker & driver 2007',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/17383933/',
  },
  sleep_focus_shift: {
    tag: 'sleep × focus', group: 'cross', accent: '#B86A8A',
    copy: (p) => {
      const sp = p as Extract<AnySleepPattern, { pattern: 'sleep_focus_shift' }>;
      return `after nights under 5h, your deep-focus peak shifts from ${sp.normal_sleep_peak_hour}:00 → ${sp.short_sleep_peak_hour}:30.`;
    },
    source: 'lim & dinges 2010',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/20438143/',
  },
  sleep_dump_mood_shift: {
    tag: 'sleep × dump mood', group: 'cross', accent: '#B86A8A',
    copy: (p) => {
      const sp = p as Extract<AnySleepPattern, { pattern: 'sleep_dump_mood_shift' }>;
      return `after poor-sleep nights, next-day overwhelm density ${sp.poor_sleep_overwhelm_ratio.toFixed(1)}× baseline.`;
    },
    source: 'yoo 2007, current biology',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/17956744/',
  },
  cycle_phase_sleep_coupling: {
    tag: 'sleep × luteal phase', group: 'cross', accent: '#B86A8A',
    copy: (p) => {
      const cp = p as Extract<AnySleepPattern, { pattern: 'cycle_phase_sleep_coupling' }>;
      return `in luteal phase, onset takes ~${cp.delta_min} more minutes than the rest of your cycle. pattern, not failure.`;
    },
    source: 'baker & driver 2007',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/17383933/',
  },
  stimulant_sleep_debt: {
    tag: 'sleep × stimulant', group: 'cross', accent: '#B86A8A',
    copy: (p) => {
      const sp = p as Extract<AnySleepPattern, { pattern: 'stimulant_sleep_debt' }>;
      return `nights after stim-mention days, onset takes ~${sp.delta_min} more minutes. pattern, not prescription.`;
    },
    source: 'cortese 2012, j clin sleep med',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/23204521/',
  },
};

// ─── settings flags ───────────────────────────────────────────────────────────

const SETTINGS_FLAGS: { key: keyof SleepSettings; name: string; sub: string }[] = [
  { key: 'show_cross_cycle', name: 'sleep × cycle', sub: 'cross-module' },
  { key: 'show_cross_focus', name: 'sleep × focus', sub: 'cross-module' },
  { key: 'show_cross_mood', name: 'sleep × dump mood', sub: 'cross-module' },
];

// ─── sub-components ───────────────────────────────────────────────────────────

interface PatternRowProps {
  p: AnySleepPattern;
  meta: PatternMeta;
}
function PatternRow({ p, meta }: PatternRowProps) {
  return (
    <div style={{ padding: '14px 0', borderBottom: `1px solid ${C.ruleSoft}` }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: meta.accent, marginBottom: 6, fontWeight: 700, fontFamily: COURIER,
      }}>
        {meta.tag}
      </div>
      <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, fontFamily: COURIER }}>
        {meta.copy(p)}
      </div>
      <div style={{ marginTop: 6 }}>
        <SourcesLink sources={[meta.sourceUrl]} label={meta.source} />
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface SleepModuleProps {
  onBack?: () => void;
}

export function SleepModule({ onBack }: SleepModuleProps) {
  // ── store slices ──────────────────────────────────────────────────────────
  const [records, setRecords] = useStoreSlice<SleepRecord[]>('sleep', 'records', []);
  const [settings, setSettings] = useStoreSlice<SleepSettings>('sleep', 'settings', {});
  // sessions / sounds: referenced in spec — kept as store slices even if not surfaced yet
  const [_sessions] = useStoreSlice<unknown[]>('sleep', 'sessions', []);
  const [_sounds] = useStoreSlice<unknown[]>('sleep', 'sounds', []);

  // ── local UI state ────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sayMoreOpen, setSayMoreOpen] = useState(false);
  const [sayMoreText, setSayMoreText] = useState('');
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [epworthOpen, setEpworthOpen] = useState(false);

  // "Go deeper" insomnia survey — orchestrator-scored result, if the user
  // has taken it before. Drives the drawer line's sub-copy.
  const [insomniaResult] = useStoreSlice<InsomniaSurveyResult | null>(
    'sleep', 'insomnia_survey_result', null,
  );
  // "Go deeper" Epworth scale — orchestrator-scored result, if taken before.
  const [epworthResult] = useStoreSlice<EpworthResult | null>(
    'sleep', 'epworth_result', null,
  );

  // ── derived (useMemo — pure logic only) ──────────────────────────────────
  const target = useMemo(() => resolveTarget(settings), [settings]);

  const safeRecords = useMemo(
    () => (Array.isArray(records) ? records : []),
    [records],
  );

  const last: SleepRecord | null = useMemo(
    () => safeRecords.slice().reverse().find((r) => r && !r.is_skipped) ?? null,
    [safeRecords],
  );

  const recent14: SleepRecord[] = useMemo(
    () =>
      safeRecords
        .filter((r) => r && !r.is_skipped && typeof r.tst_min === 'number')
        .slice(-14),
    [safeRecords],
  );

  const stats: SleepStats | null = useMemo(
    () => (safeRecords.length >= 3 ? deriveSleepStats(safeRecords) : null),
    [safeRecords],
  );

  const debt: SleepDebt | null = useMemo(
    () => (safeRecords.length >= 3 ? computeSleepDebt(safeRecords, target) : null),
    [safeRecords, target],
  );

  const drift: BedtimeDriftResult | null = useMemo(
    () => (safeRecords.length >= 5 ? detectBedtimeDrift(safeRecords) : null),
    [safeRecords],
  );

  const chronotype: ChronotypeResult | null = useMemo(
    () => (safeRecords.length >= 7 ? estimateChronotype(safeRecords) : null),
    [safeRecords],
  );

  const socialJetlag: SocialJetlagResult | null = useMemo(
    () => (safeRecords.length >= 7 ? computeSocialJetlag(safeRecords) : null),
    [safeRecords],
  );

  const dspsFlag: DSPSResult | null = useMemo(
    () => (safeRecords.length >= 14 ? detectDSPSPattern(safeRecords) : null),
    [safeRecords],
  );

  const shortSleepRun: ShortSleepRunResult | null = useMemo(
    () => (safeRecords.length >= 3 ? detectShortSleepRun(safeRecords) : null),
    [safeRecords],
  );

  // tonightForecast is written by the orchestrator (forecastTonightHeuristic);
  // read from store directly. Defensively validated below before render —
  // a malformed orchestrator write must never crash the spread.
  const [tonightForecastRaw] = useStoreSlice<ForecastResult | null>('sleep', 'tonightForecast', null);
  const tonightForecast = useMemo<ForecastResult | null>(() => {
    const f = tonightForecastRaw;
    if (
      !f ||
      typeof f.mean_h !== 'number' ||
      !Number.isFinite(f.mean_h) ||
      !Array.isArray(f.ci95_h) ||
      f.ci95_h.length !== 2 ||
      typeof f.ci95_h[0] !== 'number' ||
      typeof f.ci95_h[1] !== 'number' ||
      !Number.isFinite(f.ci95_h[0]) ||
      !Number.isFinite(f.ci95_h[1])
    ) {
      return null;
    }
    return f;
  }, [tonightForecastRaw]);

  // Patterns stored in store (orchestrator writes them)
  const [storedPatterns] = useStoreSlice<AnySleepPattern[]>('sleep', 'patterns', []);
  const safePatterns = useMemo(
    () => (Array.isArray(storedPatterns) ? storedPatterns : []),
    [storedPatterns],
  );

  // Caffeine→sleep correlator result (Drake 2013, 6h half-life). Written by
  // the sleep orchestrator. When `copy` is non-empty AND sampleSize >= 14
  // we render it INSTEAD of the static caffeine_cutoff blurb.
  const [caffeineSleep] = useStoreSlice<CaffeineSleepResult | null>(
    'sleep', 'caffeineSleep', null,
  );

  // ── synthesize fixed + dynamic patterns ─────────────────────────────────
  type AnnotatedPattern = AnySleepPattern & { _meta: PatternMeta };

  const allPatterns = useMemo<AnnotatedPattern[]>(() => {
    const out: AnnotatedPattern[] = [];

    if (drift) {
      out.push({
        pattern: 'revenge_bedtime',
        n_revenge_nights: 0,
        n_total_nights: drift.n_nights,
        median_delay_min: 0,
        confidence: 'low',
        copy: `bedtime is drifting ${drift.direction} over the last ${drift.n_nights} nights (r² = ${drift.r2}).`,
        source: { citation: 'roenneberg 2003 (mctq)', url: 'https://pubmed.ncbi.nlm.nih.gov/12568247/' },
        _meta: {
          tag: 'drift', group: 'classic', accent: C.ink,
          copy: () => `bedtime is drifting ${drift.direction} over the last ${drift.n_nights} nights (r² = ${drift.r2}).`,
          source: 'roenneberg 2003 (mctq)',
          sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/12568247/',
        },
      } as AnnotatedPattern);
    }
    if (socialJetlag) {
      out.push({
        pattern: 'revenge_bedtime',
        n_revenge_nights: 0,
        n_total_nights: socialJetlag.nWeekdayNights + socialJetlag.nWeekendNights,
        median_delay_min: 0,
        confidence: 'low',
        copy: `weekend mid-sleep is ${socialJetlag.hours}h ${socialJetlag.direction} of weekday.`,
        source: { citation: 'wittmann 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/16687322/' },
        _meta: {
          tag: 'social jetlag', group: 'classic', accent: C.warn,
          copy: () => `weekend mid-sleep is ${socialJetlag.hours}h ${socialJetlag.direction} of weekday.`,
          source: 'wittmann 2006',
          sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/16687322/',
        },
      } as AnnotatedPattern);
    }
    if (dspsFlag) {
      out.push({
        pattern: 'revenge_bedtime',
        n_revenge_nights: dspsFlag.runWeeks,
        n_total_nights: dspsFlag.nNights,
        median_delay_min: 0,
        confidence: 'medium',
        copy: `late-bedtime pattern for ${dspsFlag.runWeeks}+ weeks — median bedtime ${dspsFlag.medianBedtime}, wake ${dspsFlag.medianWake}. pattern, not diagnosis.`,
        source: { citation: 'aasm guideline', url: 'https://aasm.org/clinical-resources/practice-standards/' },
        _meta: {
          tag: 'DSPS pattern', group: 'classic', accent: C.concerned,
          copy: () => `late-bedtime pattern for ${dspsFlag.runWeeks}+ weeks — median bedtime ${dspsFlag.medianBedtime}, wake ${dspsFlag.medianWake}. pattern, not diagnosis.`,
          source: 'aasm guideline',
          sourceUrl: 'https://aasm.org/clinical-resources/practice-standards/',
        },
      } as AnnotatedPattern);
    }
    if (shortSleepRun) {
      out.push({
        pattern: 'revenge_bedtime',
        n_revenge_nights: shortSleepRun.runNights,
        n_total_nights: shortSleepRun.runNights,
        median_delay_min: 0,
        confidence: 'medium',
        copy: `${shortSleepRun.runNights}-night run of short sleep — mean ${(shortSleepRun.meanTst / 60).toFixed(1)}h.`,
        source: { citation: 'aasm guideline', url: 'https://aasm.org/' },
        _meta: {
          tag: 'short-sleep run', group: 'classic', accent: C.warn,
          copy: () => `${shortSleepRun.runNights}-night run of short sleep — mean ${(shortSleepRun.meanTst / 60).toFixed(1)}h.`,
          source: 'aasm guideline',
          sourceUrl: 'https://aasm.org/',
        },
      } as AnnotatedPattern);
    }

    for (const p of safePatterns) {
      const meta = PATTERN_META[p.pattern];
      if (!meta) continue;
      // Drake 2013 placeholder replacement: when the caffeine-sleep
      // correlator has a non-empty copy + sampleSize >= 14, render the
      // dynamic copy in place of the static "under 6h floor" blurb.
      if (
        p.pattern === 'caffeine_cutoff' &&
        caffeineSleep &&
        typeof caffeineSleep.copy === 'string' &&
        caffeineSleep.copy.length > 0 &&
        caffeineSleep.sampleSize >= 14
      ) {
        const dynamicMeta: PatternMeta = {
          ...meta,
          copy: () => caffeineSleep.copy,
        };
        out.push({ ...p, _meta: dynamicMeta });
        continue;
      }
      out.push({ ...p, _meta: meta });
    }

    return out;
  }, [drift, socialJetlag, dspsFlag, shortSleepRun, safePatterns, caffeineSleep]);

  const groups = useMemo(() => ({
    daily:      allPatterns.filter((p) => p._meta.group === 'daily'),
    behavioral: allPatterns.filter((p) => p._meta.group === 'behavioral'),
    cross:      allPatterns.filter((p) => p._meta.group === 'cross'),
    classic:    allPatterns.filter((p) => p._meta.group === 'classic'),
  }), [allPatterns]);

  // ── actions ───────────────────────────────────────────────────────────────
  const logFeel = useCallback((quality: number) => {
    const today = new Date().toISOString().slice(0, 10);
    const existing = safeRecords.find((r) => r.night_of === today) ?? null;
    const base: SleepRecord = existing ?? {
      night_of: today,
      bedtime: null, wake_time: null,
      onset_latency_min: null,
      wakings_count: null, wakings_total_min: null,
      tokens: [], tst_min: null, efficiency: null,
      is_skipped: false, is_partial: true, is_disputed: false,
      quality: null, quality_text: null, notes: null,
    };
    const rec: SleepRecord = {
      ...base,
      quality,
      last_edited_at: Date.now(),
      raw_source_id: existing?.raw_source_id ?? `feel-${Date.now()}`,
    };
    const merged = safeRecords
      .filter((r) => r.night_of !== today)
      .concat([rec])
      .sort((a, b) => a.night_of.localeCompare(b.night_of));
    setRecords(merged);
  }, [safeRecords, setRecords]);

  const submitSayMore = useCallback(() => {
    if (!sayMoreText.trim()) return;
    try {
      const parsed = parseSleepDump(sayMoreText, Date.now());
      if (parsed?.record) {
        const r = parsed.record;
        const merged = safeRecords
          .filter((existing) => existing.night_of !== r.night_of)
          .concat([{
            ...r,
            tst_min: null,
            time_in_bed_min: null,
            efficiency: null,
            id: `dump-${Date.now()}`,
            created_at: Date.now(),
          } satisfies SleepRecord])
          .sort((a, b) => a.night_of.localeCompare(b.night_of));
        setRecords(merged);
      }
    } catch {
      // parse errors are non-fatal
    }
    setSayMoreText('');
    setSayMoreOpen(false);
  }, [sayMoreText, safeRecords, setRecords]);

  const toggleSetting = useCallback((key: keyof SleepSettings) => {
    setSettings({ ...settings, [key]: !settings[key] });
  }, [settings, setSettings]);

  // ── display helpers ───────────────────────────────────────────────────────
  const lastH = last?.tst_min != null ? Math.floor(last.tst_min / 60) : null;
  const lastM = last?.tst_min != null ? Math.round(last.tst_min % 60) : null;
  const debtMin = debt?.totalDeficitHours ? Math.round(Math.abs(debt.totalDeficitHours) * 60) : 0;
  const debtSurplus = (debt?.totalDeficitHours ?? 0) < 0;

  const feelButtons = [
    { feel: 'solid', q: 5, accent: C.accent },
    { feel: 'ok',    q: 4, accent: C.ink },
    { feel: 'rough', q: 2, accent: C.warn },
    { feel: 'bad',   q: 1, accent: C.concerned },
  ] as const;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', minHeight: '100vh', background: C.bone, color: C.ink,
      fontFamily: COURIER, fontWeight: 700, letterSpacing: 0,
      WebkitFontSmoothing: 'antialiased', overflowY: 'auto', overflowX: 'hidden',
    }}>
      {/* ── back ── */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            position: 'fixed', top: 'calc(28px + env(safe-area-inset-top))', left: 'clamp(20px, 5vw, 32px)', zIndex: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: COURIER, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.18em', color: C.inkSoft, textTransform: 'lowercase',
            minHeight: 44, display: 'flex', alignItems: 'center',
          }}
          aria-label="back to dashboard"
        >
          ← sleep
        </button>
      )}

      {/* ── header ── */}
      <div style={{
        position: 'fixed', top: 'calc(32px + env(safe-area-inset-top))', right: 'clamp(20px, 5vw, 32px)', zIndex: 4,
        textAlign: 'right', display: 'flex', alignItems: 'flex-start', gap: 14,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>
            issue n° 218 / sleep
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.10em', color: C.inkSoft, marginTop: 4, fontWeight: 400 }}>
            chapter ii · the rhythm
          </div>
        </div>
        <ModuleHelp moduleId="sleep" />
      </div>

      {/* ── main ── */}
      <main style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        padding: 'calc(96px + env(safe-area-inset-top)) clamp(20px, 5vw, 56px) calc(96px + env(safe-area-inset-bottom))',
        gap: 36, position: 'relative', zIndex: 2,
      }}>

        {/* ── empty state ── */}
        {!last && (
          <div style={{ maxWidth: 540, textAlign: 'center' }}>
            <div style={{ fontSize: 'clamp(28px, 3.4vw, 44px)', lineHeight: 1.2, color: C.ink }}>
              no nights logged yet.
            </div>
            <div style={{
              marginTop: 16, fontSize: 16, color: C.inkSoft,
              fontStyle: 'italic', fontWeight: 400, lineHeight: 1.55,
            }}>
              log a night below, or brain-dump "slept 8 hours" from home.
              the module wakes after a few nights.
            </div>
            <div className="sleep-feel-grid" style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {feelButtons.map((b) => (
                <button
                  key={b.feel}
                  type="button"
                  onClick={() => logFeel(b.q)}
                  aria-label={`how did you sleep? ${b.feel}`}
                  style={{
                    background: 'none', border: `1.5px solid ${C.rule}`,
                    padding: '16px 12px', fontFamily: COURIER, cursor: 'pointer',
                    fontWeight: 700, fontSize: 16, color: C.ink, minHeight: 44,
                  }}
                >
                  {b.feel}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── happy path ── */}
        {last && (
          <div
            className="sleep-spread"
            style={{
              display: 'grid', gridTemplateColumns: '1.05fr 1fr',
              gap: 'clamp(48px, 7vw, 112px)',
              width: 'min(1280px, 92vw)', alignItems: 'start',
            }}
          >
            {/* left col — last night */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.24em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>
                last night
              </div>

              {/* big number */}
              <div style={{
                fontSize: 'clamp(96px, 14vw, 184px)', lineHeight: 0.92,
                color: C.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
              }}>
                {lastH != null ? lastH : '—'}
                <span style={{ color: C.inkSoft, fontSize: '0.45em', margin: '0 0.04em', fontWeight: 700 }}>h</span>
                {lastM != null ? String(lastM).padStart(2, '0') : '—'}
                <span style={{ color: C.inkSoft, fontSize: '0.45em', margin: '0 0.04em', fontWeight: 700 }}>m</span>
              </div>

              {/* debt copy */}
              <div style={{ fontSize: 'clamp(20px, 2.2vw, 28px)', fontStyle: 'italic', fontWeight: 400, color: C.inkSoft, lineHeight: 1.35 }}>
                {debtMin === 0
                  ? 'on target this week.'
                  : debtSurplus
                  ? <>you're <span style={{ color: C.accent, fontStyle: 'normal', fontWeight: 700 }}>{debtMin} min over</span> this week.</>
                  : <>you're <span style={{ color: C.warn, fontStyle: 'normal', fontWeight: 700 }}>{debtMin} min short</span> this week.</>}
              </div>

              {/* tonight forecast — written by orchestrator forecastTonightHeuristic */}
              {tonightForecast && (
                <div style={{ padding: '18px 0', borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>
                  <div style={{
                    fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase',
                    color: C.inkSoft, fontWeight: 700, marginBottom: 8,
                  }}>
                    tonight's estimate
                  </div>
                  <div style={{ fontSize: 'clamp(16px, 1.7vw, 20px)', fontWeight: 700, color: C.ink, lineHeight: 1.45 }}>
                    likely <strong style={{ color: C.accent }}>{tonightForecast.mean_h}h</strong>{' '}
                    <span style={{ color: C.inkSoft, fontWeight: 400 }}>
                      ({tonightForecast.ci95_h[0]}–{tonightForecast.ci95_h[1]}h).
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontStyle: 'italic', color: C.inkSoft, fontWeight: 400, marginTop: 6 }}>
                    {tonightForecast.tier === 'low'
                      ? `early read — ${tonightForecast.nights_counted} nights so far.`
                      : `from your last ${tonightForecast.nights_counted} nights.`}
                  </div>
                </div>
              )}

              {/* feel buttons */}
              <div className="sleep-feel-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, width: '100%' }}>
                {feelButtons.map((b) => (
                  <button
                    key={b.feel}
                    type="button"
                    onClick={() => logFeel(b.q)}
                    aria-label={`log sleep quality: ${b.feel}`}
                    style={{
                      background: 'none', border: `1.5px solid ${C.rule}`,
                      padding: '18px 12px', fontFamily: COURIER, cursor: 'pointer',
                      fontWeight: 700, fontSize: 16, color: C.ink, textAlign: 'center',
                      minHeight: 44,
                    }}
                  >
                    {b.feel}
                  </button>
                ))}
              </div>

              {/* say more */}
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setSayMoreOpen(true)}
                  style={{
                    background: 'none', border: 'none', padding: '6px 0',
                    fontFamily: COURIER, cursor: 'pointer', fontSize: 13,
                    color: C.inkSoft, fontWeight: 700, letterSpacing: '0.04em',
                    borderBottom: `1px solid ${C.rule}`, minHeight: 44,
                  }}
                >
                  say more, parse it for me <span style={{ color: C.accent, marginLeft: 4 }}>→</span>
                </button>
              </div>
            </div>

            {/* right col — chronotype + chart */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 14, fontWeight: 700 }}>
                  who you are · sleep-wise
                </div>
                {chronotype ? (
                  <div style={{ border: `1px solid ${C.rule}`, background: 'rgba(58,78,94,0.04)', padding: '22px 24px' }}>
                    <div style={{ fontSize: 'clamp(24px, 2.6vw, 32px)', lineHeight: 1, color: C.night, marginBottom: 6 }}>
                      {chronotype.category}
                    </div>
                    <div style={{ fontSize: 12, color: C.inkSoft, fontStyle: 'italic', fontWeight: 400, marginBottom: 16 }}>
                      {chronotype.nNights} nights of data · MCTQ-style
                    </div>
                    {chronotype.msfScFormatted && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 13 }}>
                        <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>mid-sleep</span>
                        <span style={{ fontSize: 14, color: C.ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{chronotype.msfScFormatted}</span>
                      </div>
                    )}
                    {stats?.tst_mean_min != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 13 }}>
                        <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>avg duration</span>
                        <span style={{ fontSize: 14, color: C.ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{(stats.tst_mean_min / 60).toFixed(1)}h</span>
                      </div>
                    )}
                    {debt != null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontSize: 13 }}>
                        <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.inkSoft, fontWeight: 700 }}>14d debt</span>
                        <span style={{ fontSize: 14, color: debt.totalDeficitHours > 1 ? C.warn : C.ink, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {debt.totalDeficitHours > 0 ? '+' : ''}{debt.totalDeficitHours}h
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${C.rule}`, padding: '22px 24px', background: 'rgba(58,78,94,0.02)' }}>
                    <div style={{ fontSize: 14, color: C.inkSoft, fontStyle: 'italic', fontWeight: 400, lineHeight: 1.5 }}>
                      log a few more nights and i'll start telling you who you are.
                    </div>
                  </div>
                )}
              </div>

              {/* bar chart */}
              {recent14.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 14, fontWeight: 700 }}>
                    last {recent14.length} nights
                  </div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 130, paddingTop: 10 }} role="img" aria-label="bar chart of recent sleep duration">
                    {recent14.map((r, i) => {
                      const h = ((r.tst_min ?? 0) / 60);
                      const heightPx = Math.max(8, (h / 10) * 110);
                      const dt = new Date(r.night_of);
                      const dow = dt.getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const poor = h < 5.5;
                      const bad = h < 4.5;
                      const bgc = bad ? C.concerned : poor ? C.warn : isWeekend ? C.night : C.inkSoft;
                      const op = bad ? 0.75 : poor ? 0.7 : isWeekend ? 0.6 : 0.5;
                      const isLast = i === recent14.length - 1;
                      return (
                        <div key={r.night_of + String(i)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <div
                            title={`${r.night_of} · ${h.toFixed(1)}h`}
                            style={{
                              width: '100%', height: heightPx, background: bgc, opacity: op, borderRadius: 1,
                              boxShadow: isLast ? `inset 0 -3px 0 ${C.accent}` : 'none',
                            }}
                          />
                          <div style={{ fontSize: 10, color: C.inkSoft, letterSpacing: '0.04em', fontWeight: 700 }}>
                            {['s','m','t','w','t','f','s'][dow]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11,
                    color: C.inkSoft, fontWeight: 400, marginTop: 12,
                    paddingTop: 12, borderTop: `1px solid ${C.ruleSoft}`,
                  }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5, verticalAlign: 'middle', background: C.inkSoft, opacity: 0.5 }} />weekday</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5, verticalAlign: 'middle', background: C.night, opacity: 0.6 }} />weekend</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5, verticalAlign: 'middle', background: C.warn }} />rough</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, marginRight: 5, verticalAlign: 'middle', background: C.concerned }} />bad</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── wind down ── */}
            <div>
              <div style={{
                fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase',
                color: C.inkSoft, marginBottom: 14, fontWeight: 700,
              }}>
                wind down
              </div>
              {/* Sequential 6-item ritual. Self-gates on bedtime-60min window,
                  so it renders null outside the wind-down hour. */}
              <div style={{ marginBottom: 18 }}>
                <WindDownChecklist />
              </div>
              <SleepSoundPlayer />
            </div>
          </div>
        )}

        {/* ── top pattern teaser ── */}
        {allPatterns.length > 0 && (
          <div style={{
            width: 'min(1280px, 92vw)', padding: '14px 0',
            borderTop: `1px solid ${C.ruleSoft}`, textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontStyle: 'italic', color: C.inkSoft, fontWeight: 400, lineHeight: 1.6 }}>
              btw <span style={{ color: C.inkFaint, margin: '0 8px' }}>·</span>
              {allPatterns[0]._meta.copy(allPatterns[0])}
            </div>
          </div>
        )}
      </main>

      {/* ── see more trigger ── */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        style={{
          position: 'fixed', bottom: 'calc(28px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)',
          background: 'none', border: 'none', fontFamily: COURIER, cursor: 'pointer',
          fontSize: 12, color: C.inkSoft, fontWeight: 700, letterSpacing: '0.10em',
          textTransform: 'lowercase', padding: '4px 0', minHeight: 44,
          borderBottom: `1px solid ${C.rule}`, zIndex: 5,
        }}
        aria-label="open patterns and history drawer"
      >
        see the rest <span style={{ color: C.accent, marginLeft: 4 }}>→</span>
      </button>

      {/* ── brand mark ── */}
      <div style={{
        position: 'fixed', bottom: 'calc(28px + env(safe-area-inset-bottom))', left: 'clamp(20px, 5vw, 32px)', zIndex: 4,
        fontSize: 11, letterSpacing: '0.18em', color: C.inkSoft,
        textTransform: 'lowercase', fontFamily: COURIER, fontWeight: 700,
      }}>
        ollie<span style={{ color: C.accent }}>.</span>
      </div>

      {/* ── say more modal ── */}
      {sayMoreOpen && (
        <>
          <div
            role="button"
            aria-label="close panel"
            tabIndex={0}
            onClick={() => setSayMoreOpen(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setSayMoreOpen(false); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,15,0.20)', zIndex: 80 }}
          />
          <div style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            background: C.bone, border: `1px solid ${C.rule}`, padding: '36px 40px',
            width: 'min(640px, 92vw)', boxSizing: 'border-box', zIndex: 90,
            boxShadow: '0 32px 80px rgba(20,20,15,0.10)',
          }}
            role="dialog"
            aria-modal="true"
            aria-label="log last night in your own words"
          >
            <div style={{ fontSize: 22, marginBottom: 6, color: C.ink, fontWeight: 700 }}>last night</div>
            <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 22, fontWeight: 700 }}>
              say it however · ollie parses
            </div>
            <textarea
              value={sayMoreText}
              onChange={(e) => setSayMoreText(e.target.value)}
              autoFocus
              placeholder="went to bed 23:48, woke 6:30, took an hour to drop, two coffees yesterday..."
              style={{
                width: '100%', background: '#fff', border: `1px solid ${C.rule}`,
                padding: '18px 20px', fontFamily: COURIER, fontWeight: 700, fontSize: 16,
                lineHeight: 1.5, color: C.ink, caretColor: C.accent, resize: 'none',
                minHeight: 120, outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 12, fontSize: 12, fontStyle: 'italic', color: C.inkSoft, fontWeight: 400 }}>
              say times if you remember. don't if you don't.
            </div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'flex-end', marginTop: 22 }}>
              <button
                type="button"
                onClick={() => setSayMoreOpen(false)}
                style={{
                  background: 'none', border: 'none', padding: '4px 0', fontFamily: COURIER,
                  cursor: 'pointer', fontSize: 13, letterSpacing: '0.08em', color: C.ink,
                  fontWeight: 700, textTransform: 'lowercase', borderBottom: `1px solid ${C.rule}`,
                  minHeight: 44,
                }}
              >
                cancel
              </button>
              <button
                type="button"
                onClick={submitSayMore}
                style={{
                  background: 'none', border: 'none', padding: '4px 0', fontFamily: COURIER,
                  cursor: 'pointer', fontSize: 13, letterSpacing: '0.08em', color: C.accent,
                  fontWeight: 700, textTransform: 'lowercase', borderBottom: `2px solid ${C.accent}`,
                  minHeight: 44,
                }}
              >
                save <span style={{ color: C.accent, marginLeft: 4 }}>→</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── insomnia survey ("go deeper" lite survey) ── */}
      {surveyOpen && <InsomniaSurvey onClose={() => setSurveyOpen(false)} />}

      {/* ── epworth sleepiness scale ("go deeper") ── */}
      {epworthOpen && <EpworthSurvey onClose={() => setEpworthOpen(false)} />}

      {/* ── drawer backdrop ── */}
      {drawerOpen && (
        <div
          role="button"
          aria-label="close drawer"
          tabIndex={0}
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setDrawerOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,15,0.20)', zIndex: 80 }}
        />
      )}

      {/* ── drawer ── */}
      <aside
        style={{
          position: 'fixed', top: 0, right: 0,
          width: 'clamp(360px, 42vw, 600px)', height: '100vh', boxSizing: 'border-box',
          background: C.bone, borderLeft: `1px solid ${C.rule}`,
          transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 480ms cubic-bezier(0.2,0,0,1)',
          padding: '80px 40px 40px', zIndex: 95, overflowY: 'auto',
          boxShadow: '-32px 0 64px rgba(20,20,15,0.06)', fontFamily: COURIER,
        }}
        aria-label="sleep patterns and settings"
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'absolute', top: 32, right: 36,
            background: 'none', border: 'none', fontFamily: COURIER, cursor: 'pointer',
            fontSize: 11, letterSpacing: '0.18em', textTransform: 'lowercase',
            color: C.inkSoft, fontWeight: 700,
          }}
          aria-label="close drawer"
        >
          close
        </button>

        <h2 style={{ fontSize: 26, marginBottom: 6, color: C.ink, fontWeight: 700 }}>the rest</h2>
        <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 32, fontWeight: 700 }}>
          {recent14.length} nights of context · {safeRecords.filter((r) => !r.is_skipped).length} nights of data
        </div>

        {/* pattern groups */}
        {([
          { key: 'daily',      label: 'daily patterns',        color: C.ink },
          { key: 'behavioral', label: 'behavioral patterns',   color: C.accent },
          { key: 'cross',      label: 'cross-module patterns', color: '#B86A8A' },
          { key: 'classic',    label: 'classic flags',         color: C.warn },
        ] as const).map((g) => {
          const list = groups[g.key];
          if (!list || list.length === 0) return null;
          return (
            <div key={g.key} style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase',
                color: g.color, fontWeight: 700,
                padding: '10px 0', borderBottom: `1px solid ${C.rule}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8,
              }}>
                <span>{g.label}</span>
                <span style={{ fontWeight: 400, fontStyle: 'italic', color: C.inkFaint, fontSize: 11 }}>
                  {list.length} active
                </span>
              </div>
              {list.map((p, i) => (
                <PatternRow key={p.pattern + String(i)} p={p} meta={p._meta} />
              ))}
            </div>
          );
        })}

        {allPatterns.length === 0 && (
          <div style={{ marginBottom: 28, padding: '14px 0', fontSize: 14, color: C.inkSoft, fontStyle: 'italic', fontWeight: 400 }}>
            no patterns yet — log a few more nights.
          </div>
        )}

        {/* go deeper */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 12, fontWeight: 700 }}>
            go deeper
          </div>

          {/* insomnia check — the live "lite" survey (Serra decision 2026-05-15) */}
          <button
            type="button"
            onClick={() => { setDrawerOpen(false); setSurveyOpen(true); }}
            style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              width: '100%', boxSizing: 'border-box', textAlign: 'left', background: 'none', cursor: 'pointer',
              border: 'none', borderBottom: `1px solid ${C.rule}`,
              padding: '14px 4px', fontFamily: COURIER,
            }}
            aria-label="open the insomnia check survey"
          >
            <span style={{ fontSize: 13, color: C.ink, fontWeight: 700 }}>
              insomnia check
              <span style={{ fontStyle: 'italic', fontWeight: 400, color: C.inkFaint, marginLeft: 6 }}>
                {insomniaResult
                  ? `last score ${insomniaResult.score}/28 · retake`
                  : '7 questions · about 2 min'}
              </span>
            </span>
            <span style={{ fontSize: 12, color: C.accent, fontWeight: 700, marginLeft: 12, flexShrink: 0 }}>
              start
            </span>
          </button>
        </div>

        {/* settings toggles */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 12, fontWeight: 700 }}>
            what to surface · settings
          </div>
          {SETTINGS_FLAGS.map((f) => (
            <div key={f.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '9px 0', borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 13,
            }}>
              <div style={{ flex: 1, color: C.ink, fontWeight: 700 }}>
                {f.name}
                <em style={{ fontStyle: 'italic', color: C.inkFaint, fontWeight: 400, fontSize: 11, display: 'block', marginTop: 2 }}>
                  {f.sub}
                </em>
              </div>
              <div
                role="switch"
                aria-checked={!!settings[f.key]}
                aria-label={`toggle ${f.name}`}
                tabIndex={0}
                onClick={() => toggleSetting(f.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSetting(f.key); } }}
                style={{
                  width: 28, height: 16,
                  background: settings[f.key] ? C.accent : C.inkFaint,
                  borderRadius: 8, position: 'relative', cursor: 'pointer',
                  transition: 'background 240ms ease', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: 2, width: 12, height: 12,
                  background: '#fff', borderRadius: '50%',
                  transform: settings[f.key] ? 'translateX(12px)' : 'translateX(0)',
                  transition: 'transform 240ms ease',
                }} />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── responsive ── */}
      <style>{`
        @media (max-width: 880px) {
          .sleep-spread { grid-template-columns: 1fr !important; gap: 40px !important; }
        }
        @media (max-width: 640px) {
          .sleep-feel-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
