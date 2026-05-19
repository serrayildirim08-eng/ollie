/**
 * body-v2 · useBodyActions — write bridge
 *
 * The handful of mutations the v2 body screens perform, written through the
 * SAME `body.*` / `shared.*` store keys + shapes the live `BodyModule` uses.
 * A glass logged, an episode opened, a med logged through the v2 preview is
 * visible to the live module and vice-versa — they share one body store.
 *
 *   - `addGlass` / `removeGlass` mirror `BodyModule.addGlass/removeGlass`:
 *     a timestamp appended to / removed from `body.water_log`.
 *   - `setWaterTarget` writes `body.water_target`.
 *   - `toggleSupplement` mirrors `BodyModule.toggleSupp` — it writes BOTH the
 *     per-day `body.supp_checks` render slice AND mirrors `checked_dates` on
 *     the supplement object (the slice the orchestrator's reminder reads), so
 *     the checkbox and the reminder never disagree (audit #14).
 *   - `addSupplement` / `removeSupplement` write `body.supplements`.
 *   - `startEpisode` / `logSeverity` / `logMed` / `closeEpisode` write
 *     `body.episodes` through the pure `@ollie/logic/body` helpers.
 *   - `addCondition` / `removeCondition` write `shared.settings.chronic_conditions`.
 *   - `addPlan` / `advancePlan` write `body.treatment_plans`.
 *   - `setPostureEnabled` writes `body.posture_settings` via the live module's
 *     own pure `nextPostureSettings` merge helper.
 */
import { useCallback } from 'react';
import {
  openEpisode,
  logSeverity as logSeverityFn,
  logMed as logMedFn,
  closeEpisode as closeEpisodeFn,
  newTreatmentPlan,
  addCycleStart,
} from '@ollie/logic/body';
import type { Episode, EpisodeKind, TreatmentPlan } from '@ollie/logic/body';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import {
  nextPostureSettings,
  type PostureSettings,
} from '../body/BodyModule';
import { isoDay } from './selectors';
import type {
  Supplement,
  SuppChecks,
  BodySharedSettings,
} from './selectors';

export interface BodyActions {
  /** log one glass of water now */
  addGlass: () => void;
  /** remove the most-recent glass logged today */
  removeGlass: () => void;
  /** set the daily water target (1..16) */
  setWaterTarget: (target: number) => void;
  /** toggle a supplement's checked-off state for today */
  toggleSupplement: (id: string) => void;
  /** add a new tracked supplement */
  addSupplement: (name: string, dose?: string) => void;
  /** remove a tracked supplement */
  removeSupplement: (id: string) => void;
  /** open a new symptom episode and return it */
  startEpisode: (
    label: string,
    kind: EpisodeKind | string,
    firstSeverity?: number | null,
  ) => Episode | null;
  /** log a severity check-in (1..5) onto the open episode */
  logSeverity: (episodeId: string, severity: number) => void;
  /** log a med taken onto the open episode */
  logMed: (episodeId: string, name: string, dose?: string) => void;
  /** close (resolve) an episode */
  closeEpisode: (episodeId: string) => void;
  /** add a tracked chronic condition */
  addCondition: (name: string) => void;
  /** remove a tracked chronic condition by index */
  removeCondition: (index: number) => void;
  /** add a treatment plan */
  addPlan: (label: string, cycleLenDays: number, totalCycles: number) => void;
  /** advance a treatment plan to its next cycle (stamps a new cycle start) */
  advancePlan: (planId: string) => void;
  /** enable / disable the posture reminder */
  setPostureEnabled: (enabled: boolean) => void;
}

export function useBodyActions(now: number): BodyActions {
  const [waterLog, setWaterLog] = useStoreSlice<number[]>(
    'body',
    'water_log',
    [],
  );
  const [, setWaterTargetSlice] = useStoreSlice<number>(
    'body',
    'water_target',
    8,
  );
  const [supplements, setSupplements] = useStoreSlice<Supplement[]>(
    'body',
    'supplements',
    [],
  );
  const [suppChecks, setSuppChecks] = useStoreSlice<SuppChecks>(
    'body',
    'supp_checks',
    {},
  );
  const [episodes, setEpisodes] = useStoreSlice<Episode[]>(
    'body',
    'episodes',
    [],
  );
  const [plans, setPlans] = useStoreSlice<TreatmentPlan[]>(
    'body',
    'treatment_plans',
    [],
  );
  const [sharedSettings, setSharedSettings] =
    useStoreSlice<BodySharedSettings>('shared', 'settings', {});
  const [postureSettings, setPostureSettings] =
    useStoreSlice<PostureSettings | null>('body', 'posture_settings', null);

  const addGlass = useCallback(() => {
    const list = Array.isArray(waterLog) ? waterLog : [];
    setWaterLog([...list, now]);
  }, [waterLog, setWaterLog, now]);

  const removeGlass = useCallback(() => {
    const list = Array.isArray(waterLog) ? waterLog : [];
    const today = isoDay(now);
    const todays = list.filter((ts) => isoDay(ts) === today);
    if (todays.length === 0) return;
    const lastTs = todays[todays.length - 1];
    // remove only the single most-recent matching timestamp
    let removed = false;
    setWaterLog(
      list.filter((ts) => {
        if (!removed && ts === lastTs) {
          removed = true;
          return false;
        }
        return true;
      }),
    );
  }, [waterLog, setWaterLog, now]);

  const setWaterTarget = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(16, Math.round(target) || 8));
      setWaterTargetSlice(clamped);
    },
    [setWaterTargetSlice],
  );

  const toggleSupplement = useCallback(
    (id: string) => {
      const today = isoDay(now);
      const dayChecks = suppChecks?.[today] ?? {};
      const next = !dayChecks[id];

      // (1) per-day render slice — source of truth for the checkbox UI
      setSuppChecks({
        ...(suppChecks ?? {}),
        [today]: { ...dayChecks, [id]: next },
      });

      // (2) mirror into `checked_dates` — the slice the orchestrator reads
      const list = Array.isArray(supplements) ? supplements : [];
      setSupplements(
        list.map((s) => {
          if (!s || s.id !== id) return s;
          const dates = new Set(
            Array.isArray(s.checked_dates) ? s.checked_dates : [],
          );
          if (next) dates.add(today);
          else dates.delete(today);
          return { ...s, checked_dates: Array.from(dates).sort() };
        }),
      );
    },
    [now, suppChecks, setSuppChecks, supplements, setSupplements],
  );

  const addSupplement = useCallback(
    (name: string, dose?: string) => {
      const n = name.trim();
      if (!n) return;
      const list = Array.isArray(supplements) ? supplements : [];
      const s: Supplement = {
        id: mkId('sup'),
        name: n,
        dose: dose && dose.trim() ? dose.trim() : null,
        added_at: now,
      };
      setSupplements([...list, s]);
    },
    [supplements, setSupplements, now],
  );

  const removeSupplement = useCallback(
    (id: string) => {
      const list = Array.isArray(supplements) ? supplements : [];
      setSupplements(list.filter((s) => s && s.id !== id));
    },
    [supplements, setSupplements],
  );

  const startEpisode = useCallback(
    (label: string, kind: EpisodeKind | string, firstSeverity?: number | null) => {
      const lbl = label.trim();
      if (!lbl) return null;
      let ep = openEpisode(lbl, kind, { now });
      if (typeof firstSeverity === 'number' && firstSeverity > 0) {
        ep = logSeverityFn(ep, firstSeverity, { now });
      }
      const list = Array.isArray(episodes) ? episodes : [];
      setEpisodes([...list, ep]);
      return ep;
    },
    [episodes, setEpisodes, now],
  );

  const logSeverity = useCallback(
    (episodeId: string, severity: number) => {
      const list = Array.isArray(episodes) ? episodes : [];
      setEpisodes(
        list.map((e) =>
          e && e.id === episodeId ? logSeverityFn(e, severity, { now }) : e,
        ),
      );
    },
    [episodes, setEpisodes, now],
  );

  const logMed = useCallback(
    (episodeId: string, name: string, dose?: string) => {
      const n = name.trim();
      if (!n) return;
      const list = Array.isArray(episodes) ? episodes : [];
      const opts: { now: number; dose?: string } = { now };
      if (dose && dose.trim()) opts.dose = dose.trim();
      setEpisodes(
        list.map((e) => (e && e.id === episodeId ? logMedFn(e, n, opts) : e)),
      );
    },
    [episodes, setEpisodes, now],
  );

  const closeEpisode = useCallback(
    (episodeId: string) => {
      const list = Array.isArray(episodes) ? episodes : [];
      setEpisodes(
        list.map((e) =>
          e && e.id === episodeId ? closeEpisodeFn(e, { now }) : e,
        ),
      );
    },
    [episodes, setEpisodes, now],
  );

  const addCondition = useCallback(
    (name: string) => {
      const v = name.trim().toLowerCase();
      if (!v) return;
      const current = Array.isArray(sharedSettings?.chronic_conditions)
        ? (sharedSettings.chronic_conditions as string[])
        : [];
      if (current.some((c) => typeof c === 'string' && c.toLowerCase() === v)) {
        return;
      }
      setSharedSettings({
        ...sharedSettings,
        chronic_conditions: [...current, v],
      });
    },
    [sharedSettings, setSharedSettings],
  );

  const removeCondition = useCallback(
    (index: number) => {
      const current = Array.isArray(sharedSettings?.chronic_conditions)
        ? (sharedSettings.chronic_conditions as string[])
        : [];
      setSharedSettings({
        ...sharedSettings,
        chronic_conditions: current.filter((_, i) => i !== index),
      });
    },
    [sharedSettings, setSharedSettings],
  );

  const addPlan = useCallback(
    (label: string, cycleLenDays: number, totalCycles: number) => {
      const lbl = label.trim();
      if (!lbl) return;
      const list = Array.isArray(plans) ? plans : [];
      const plan = newTreatmentPlan(lbl, {
        now,
        cycle_length_days: Math.max(1, Math.round(cycleLenDays) || 21),
        total_cycles: Math.max(1, Math.round(totalCycles) || 6),
      });
      setPlans([...list, plan]);
    },
    [plans, setPlans, now],
  );

  const advancePlan = useCallback(
    (planId: string) => {
      const list = Array.isArray(plans) ? plans : [];
      setPlans(
        list.map((p) => (p && p.id === planId ? addCycleStart(p, now) : p)),
      );
    },
    [plans, setPlans, now],
  );

  const setPostureEnabled = useCallback(
    (enabled: boolean) => {
      setPostureSettings(nextPostureSettings(postureSettings, enabled));
    },
    [postureSettings, setPostureSettings],
  );

  return {
    addGlass,
    removeGlass,
    setWaterTarget,
    toggleSupplement,
    addSupplement,
    removeSupplement,
    startEpisode,
    logSeverity,
    logMed,
    closeEpisode,
    addCondition,
    removeCondition,
    addPlan,
    advancePlan,
    setPostureEnabled,
  };
}
