/**
 * sleep-v2 · useSleepSlices — live store bridge
 *
 * Subscribes to the EXISTING `sleep.*` slices (the same keys the live
 * `SleepModule` reads + writes) and returns them as one `SleepSlices`
 * object for the v2 selectors. Read-only here; mutations go through
 * `useSleepActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes.
 */
import { useStoreSlice } from '../../store';
import type {
  SleepRecord,
  SleepSettings,
  ForecastResult,
  AnySleepPattern,
  InsomniaSurveyResult,
  EpworthResult,
} from '@ollie/logic/sleep';
import type { SleepSlices, WindDownState } from './selectors';

export const DEFAULT_SLEEP_SETTINGS: SleepSettings = {};

export function useSleepSlices(): SleepSlices {
  const [records] = useStoreSlice<SleepRecord[]>('sleep', 'records', []);
  const [settings] = useStoreSlice<SleepSettings>(
    'sleep',
    'settings',
    DEFAULT_SLEEP_SETTINGS,
  );
  const [tonightForecast] = useStoreSlice<ForecastResult | null>(
    'sleep',
    'tonightForecast',
    null,
  );
  const [patterns] = useStoreSlice<AnySleepPattern[]>('sleep', 'patterns', []);
  const [windDown] = useStoreSlice<WindDownState | null>(
    'sleep',
    'wind_down_state',
    null,
  );
  const [insomniaResult] = useStoreSlice<InsomniaSurveyResult | null>(
    'sleep',
    'insomnia_survey_result',
    null,
  );
  const [epworthResult] = useStoreSlice<EpworthResult | null>(
    'sleep',
    'epworth_result',
    null,
  );

  return {
    records: Array.isArray(records) ? records : [],
    settings: settings ?? DEFAULT_SLEEP_SETTINGS,
    tonightForecast: validForecast(tonightForecast),
    patterns: Array.isArray(patterns) ? patterns : [],
    windDown: windDown ?? null,
    insomniaResult: insomniaResult ?? null,
    epworthResult: epworthResult ?? null,
  };
}

/**
 * Defensively validate the orchestrator-written forecast — a malformed
 * write must never crash a screen. Mirrors the live `SleepModule` guard.
 */
function validForecast(f: ForecastResult | null): ForecastResult | null {
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
}
