/**
 * body-v2 · useBodySlices — live store bridge
 *
 * Subscribes to the EXISTING `body.*` + `shared.*` slices (the same keys the
 * live `BodyModule` reads + writes) and returns them as one `BodySlices`
 * object for the v2 selectors. Read-only here; mutations go through
 * `useBodyActions`.
 *
 * This is the seam that makes the redesign a UI rebuild, not a fork: the
 * data + logic layer is untouched, only the rendering changes. Mirrors
 * sleep-v2/useSleepSlices.ts.
 */
import { useMemo } from 'react';
import { useStoreSlice } from '../../store';
import type { Episode, TreatmentPlan, AnyBodyPattern } from '@ollie/logic/body';
import type {
  BodySlices,
  Supplement,
  SuppChecks,
  BodySharedSettings,
  ProtectiveCard,
} from './selectors';

/** the live module's age → default-glasses table */
function ageDefaultWater(ageRange: string | undefined): number {
  if (ageRange === '18-25' || ageRange === '26-35') return 6;
  if (ageRange === '36-45' || ageRange === '46-55') return 7;
  return 8;
}

export function useBodySlices(): BodySlices {
  const [sharedSettings] = useStoreSlice<BodySharedSettings>(
    'shared',
    'settings',
    {},
  );
  const ageDefault = ageDefaultWater(sharedSettings?.age_range);

  const [waterLog] = useStoreSlice<number[]>('body', 'water_log', []);
  const [waterTarget] = useStoreSlice<number>(
    'body',
    'water_target',
    ageDefault,
  );
  const [supplements] = useStoreSlice<Supplement[]>('body', 'supplements', []);
  const [suppChecks] = useStoreSlice<SuppChecks>('body', 'supp_checks', {});
  const [episodes] = useStoreSlice<Episode[]>('body', 'episodes', []);
  const [treatmentPlans] = useStoreSlice<TreatmentPlan[]>(
    'body',
    'treatment_plans',
    [],
  );
  const [patterns] = useStoreSlice<AnyBodyPattern[]>('body', 'patterns', []);
  const [protectiveCards] = useStoreSlice<ProtectiveCard[]>(
    'body',
    'protective_cards',
    [],
  );

  return useMemo<BodySlices>(() => {
    const conditions = Array.isArray(sharedSettings?.chronic_conditions)
      ? (sharedSettings.chronic_conditions as string[]).filter(
          (c) => typeof c === 'string',
        )
      : [];
    const name =
      typeof sharedSettings?.name === 'string' && sharedSettings.name.trim()
        ? sharedSettings.name.trim()
        : null;
    return {
      waterLog: Array.isArray(waterLog) ? waterLog : [],
      waterTarget: typeof waterTarget === 'number' ? waterTarget : ageDefault,
      supplements: Array.isArray(supplements) ? supplements : [],
      suppChecks:
        suppChecks && typeof suppChecks === 'object' ? suppChecks : {},
      episodes: Array.isArray(episodes) ? episodes : [],
      treatmentPlans: Array.isArray(treatmentPlans) ? treatmentPlans : [],
      patterns: Array.isArray(patterns) ? patterns : [],
      protectiveCards: Array.isArray(protectiveCards) ? protectiveCards : [],
      conditions,
      userName: name,
    };
  }, [
    waterLog,
    waterTarget,
    ageDefault,
    supplements,
    suppChecks,
    episodes,
    treatmentPlans,
    patterns,
    protectiveCards,
    sharedSettings,
  ]);
}
