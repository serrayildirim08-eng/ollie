/**
 * sleep-v2 · useSleepActions — write bridge
 *
 * The handful of mutations the v2 sleep screens perform, written through
 * the SAME `sleep.*` store keys + `SleepRecord` shape the live
 * `SleepModule` uses. A night logged through the v2 preview is visible to
 * the live module and vice-versa — they share one sleep store.
 *
 *   - `logFeel` / `logFromText` mirror `SleepModule.logFeel` /
 *     `submitSayMore`: a feel-tap or a parsed dump is merged into
 *     `sleep.records` keyed by `night_of` (one record per night).
 *   - `setWindDownStep` advances the persisted `sleep.wind_down_state`,
 *     the same date-keyed run state the live `WindDownChecklist` writes.
 *   - `submitInsomnia` / `submitEpworth` write the raw answers (the slice
 *     the orchestrator scores) AND the scored result via the same pure
 *     `@ollie/logic/sleep` scorer the orchestrator uses — so the preview
 *     shows a real result without depending on the orchestrator loop.
 */
import { useCallback } from 'react';
import {
  parseSleepDump,
  scoreInsomniaSurvey,
  scoreEpworth,
} from '@ollie/logic/sleep';
import type {
  SleepRecord,
  InsomniaSurveyResult,
  EpworthResult,
} from '@ollie/logic/sleep';
import { useStoreSlice } from '../../store';
import { isoDay, WIND_DOWN_STEPS, type WindDownState } from './selectors';

/** a blank record for a night that's only been feel-rated so far */
function blankRecord(nightOf: string): SleepRecord {
  return {
    night_of: nightOf,
    bedtime: null,
    wake_time: null,
    onset_latency_min: null,
    wakings_count: null,
    wakings_total_min: null,
    tokens: [],
    tst_min: null,
    efficiency: null,
    is_skipped: false,
    is_partial: true,
    is_disputed: false,
    quality: null,
    quality_text: null,
    notes: null,
  };
}

export interface SleepActions {
  /** quick-log last night's feel (1–5 quality), merged into today's record */
  logFeel: (quality: number) => void;
  /** log last night from a free-text sentence ollie parses */
  logFromText: (text: string) => void;
  /** advance the wind-down ritual to the given step index */
  setWindDownStep: (toIndex: number) => void;
  /** persist a completed insomnia survey and return the scored result */
  submitInsomnia: (answers: number[]) => InsomniaSurveyResult | null;
  /** persist a completed Epworth survey and return the scored result */
  submitEpworth: (answers: number[]) => EpworthResult | null;
}

export function useSleepActions(now: number): SleepActions {
  const [records, setRecords] = useStoreSlice<SleepRecord[]>(
    'sleep',
    'records',
    [],
  );
  const [windDown, setWindDown] = useStoreSlice<WindDownState | null>(
    'sleep',
    'wind_down_state',
    null,
  );
  const [, setInsomniaAnswers] = useStoreSlice<number[] | null>(
    'sleep',
    'insomnia_survey_answers',
    null,
  );
  const [, setInsomniaResult] = useStoreSlice<InsomniaSurveyResult | null>(
    'sleep',
    'insomnia_survey_result',
    null,
  );
  const [, setEpworthAnswers] = useStoreSlice<number[] | null>(
    'sleep',
    'epworth_answers',
    null,
  );
  const [, setEpworthResult] = useStoreSlice<EpworthResult | null>(
    'sleep',
    'epworth_result',
    null,
  );

  const logFeel = useCallback(
    (quality: number) => {
      const today = isoDay(now);
      const list = Array.isArray(records) ? records : [];
      const existing = list.find((r) => r && r.night_of === today) ?? null;
      const base: SleepRecord = existing ?? blankRecord(today);
      const rec: SleepRecord = {
        ...base,
        quality,
        last_edited_at: now,
        raw_source_id: existing?.raw_source_id ?? `feel-${now}`,
      };
      const merged = list
        .filter((r) => r && r.night_of !== today)
        .concat([rec])
        .sort((a, b) => a.night_of.localeCompare(b.night_of));
      setRecords(merged);
    },
    [records, setRecords, now],
  );

  const logFromText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const parsed = parseSleepDump(text, now);
      if (!parsed || !parsed.record) return;
      const r = parsed.record;
      const list = Array.isArray(records) ? records : [];
      const merged = list
        .filter((existing) => existing && existing.night_of !== r.night_of)
        .concat([
          {
            ...r,
            tst_min: null,
            time_in_bed_min: null,
            efficiency: null,
            id: `dump-${now}`,
            created_at: now,
          } satisfies SleepRecord,
        ])
        .sort((a, b) => a.night_of.localeCompare(b.night_of));
      setRecords(merged);
    },
    [records, setRecords, now],
  );

  const setWindDownStep = useCallback(
    (toIndex: number) => {
      const todayKey = isoDay(now);
      const clamped = Math.max(0, Math.min(WIND_DOWN_STEPS.length, toIndex));
      const completed = WIND_DOWN_STEPS.slice(0, clamped).map((s) => s.id);
      const prev =
        windDown && windDown.date === todayKey ? windDown : null;
      setWindDown({
        date: todayKey,
        completed,
        startedAt: prev?.startedAt ?? (clamped > 0 ? now : null),
        finished: clamped >= WIND_DOWN_STEPS.length,
        dismissed: false,
      });
    },
    [windDown, setWindDown, now],
  );

  const submitInsomnia = useCallback(
    (answers: number[]) => {
      const result = scoreInsomniaSurvey(answers, now);
      if (!result) return null;
      setInsomniaAnswers(answers.slice());
      setInsomniaResult(result);
      return result;
    },
    [setInsomniaAnswers, setInsomniaResult, now],
  );

  const submitEpworth = useCallback(
    (answers: number[]) => {
      const result = scoreEpworth(answers, now);
      if (!result) return null;
      setEpworthAnswers(answers.slice());
      setEpworthResult(result);
      return result;
    },
    [setEpworthAnswers, setEpworthResult, now],
  );

  return {
    logFeel,
    logFromText,
    setWindDownStep,
    submitInsomnia,
    submitEpworth,
  };
}
