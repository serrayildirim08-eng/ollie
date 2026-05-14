/**
 * @ollie/orchestrator · sleep
 *
 * Ported from window.VOID.orchestrator.sleep in void-app.html (~lines 26762–27097).
 * The only caller of @ollie/logic/sleep stats + pattern functions.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "sleep"):
 *   stats                  SleepStats | null from deriveSleepStats
 *   debt                   SleepDebt from computeSleepDebt
 *   drift                  BedtimeDriftResult | null from detectBedtimeDrift
 *   chronotype             ChronotypeResult | null from estimateChronotype
 *   socialJetlag           SocialJetlagResult | null from computeSocialJetlag
 *   dspsFlag               DSPSResult | null from detectDSPSPattern
 *   shortSleepRun          ShortSleepRunResult | null from detectShortSleepRun
 *   tonightForecast        ForecastResult | null from forecastTonightTST
 *   patterns               AnySleepPattern[] (Phase 1–4 detectors)
 *   patternsLastComputedAt timestamp of most recent recompute
 *   lastRecomputeAt        timestamp of most recent recompute (alias)
 *
 * Subscriptions:
 *   sleep.records          → schedule recompute
 *   sleep.items            → processBacklog (legacy applyRoute path)
 *   dump.items             → processBacklog
 *   cycle.cycles           → schedule recompute (luteal coupling)
 *   void:braindump:submitted event → process sleep items + recompute
 *   body:pattern_detected  event  → schedule recompute (cross-feed)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import {
  parseSleepDump,
  mergeRecord,
  resolveTarget,
  deriveSleepStats,
  computeSleepDebt,
  detectBedtimeDrift,
  estimateChronotype,
  computeSocialJetlag,
  detectDSPSPattern,
  detectShortSleepRun,
  forecastTonightTST,
  detectRevengeBedtime,
  detectCaffeineCutoff,
  detectSleepOnsetGap,
  detectWeekendRecoveryIllusion,
  detectBedtimeMindRacing,
  detectWindDownFriction,
  detectMedicationTimingDrift,
  detectChronotherapyProgress,
  detectSleepCyclePattern,
  detectSleepFocusPattern,
  detectSleepDumpMoodPattern,
  detectCyclePhaseSleepCoupling,
  detectStimulantSleepDebt,
} from '@ollie/logic/sleep';
import type {
  SleepRecord,
  SleepSettings,
  AnySleepPattern,
  CyclePhaseWindow,
} from '@ollie/logic/sleep';
import { computePhaseForDate } from '@ollie/logic/cycle';
import {
  inferCaffeineFromTransactions,
  correlateCaffeineAndSleep,
} from '@ollie/logic/body';
import type { CaffeineSleepResult } from '@ollie/logic/body';
import type { FinanceRecord } from '@ollie/logic/finance';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;
const MAX_DUMP_LEN = 4000;

// Extended settings type — augments SleepSettings with orchestrator-level
// show_* flags and the chronotherapy block that aren't part of the core logic type.
interface SleepOrchestratorSettings extends SleepSettings {
  target_bedtime: string | null;
  // UX-preference show flags (not privacy gates).
  show_chronotype: boolean;
  show_social_jetlag: boolean;
  show_sleep_debt: boolean;
  show_correlations: boolean;
  show_revenge_bedtime: boolean;
  show_caffeine_cutoff: boolean;
  show_sleep_onset_gap: boolean;
  show_weekend_recovery: boolean;
  show_bedtime_mind_racing: boolean;
  show_wind_down_friction: boolean;
  show_medication_timing: boolean;
  show_chronotherapy_progress: boolean;
  show_cross_cycle: boolean;
  show_cross_focus: boolean;
  show_cross_mood: boolean;
  show_cycle_phase_coupling: boolean;
  show_stimulant_sleep_debt: boolean;
  chronotherapy: { active: boolean; target_bedtime: string | null };
  correlation_tokens: Record<string, string[]>;
}

const DEFAULT_SETTINGS: SleepOrchestratorSettings = {
  target_hours: 7.5,
  target_bedtime: null,
  weekday_set: ['sun', 'mon', 'tue', 'wed', 'thu'],
  weekend_set: ['fri', 'sat'],
  show_chronotype: true,
  show_social_jetlag: true,
  show_sleep_debt: true,
  show_correlations: true,
  show_revenge_bedtime: true,
  show_caffeine_cutoff: true,
  show_sleep_onset_gap: true,
  show_weekend_recovery: true,
  show_bedtime_mind_racing: true,
  show_wind_down_friction: true,
  show_medication_timing: true,
  show_chronotherapy_progress: true,
  show_cross_cycle: true,
  show_cross_focus: true,
  show_cross_mood: true,
  show_cycle_phase_coupling: false,
  show_stimulant_sleep_debt: false,
  chronotherapy: { active: false, target_bedtime: null },
  correlation_tokens: {
    caffeine: ['coffee', 'espresso', 'caffeine', 'latte', 'matcha', 'tea'],
    meds: ['adderall', 'vyvanse', 'ritalin', 'concerta', 'focalin'],
    screens: ['phone', 'scrolling', 'tiktok', 'instagram', 'screen', 'netflix', 'youtube'],
    alcohol: ['wine', 'beer', 'drink', 'alcohol', 'drunk'],
    exercise: ['gym', 'run', 'workout', 'exercise', 'lifted'],
  },
};

export interface SleepOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** APNs push scheduler; no-op when omitted. */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

export function createSleepOrchestrator(
  store: Store,
  opts: SleepOrchestratorOptions = {},
): Orchestrator & { recomputeDerived(): void; processBacklog(): void } {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function getSettings(): SleepOrchestratorSettings {
    const s = store.get<Partial<SleepOrchestratorSettings> | null>('sleep', 'settings', undefined) ?? null;
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  }

  function getRecords(): SleepRecord[] {
    return store.get<SleepRecord[]>('sleep', 'records', []) ?? [];
  }

  function setRecords(v: SleepRecord[]): void {
    store.set('sleep', 'records', v);
  }

  function setKey(k: string, v: unknown): void {
    store.set('sleep', k, v);
  }

  // Build a step-function phase array from cycle.cycles for detectCyclePhaseSleepCoupling.
  function buildSleepCyclePhases(
    cycles: unknown[],
    fromTs: number,
    toTs: number,
  ): CyclePhaseWindow[] {
    if (!Array.isArray(cycles) || cycles.length === 0) return [];
    const out: CyclePhaseWindow[] = [];
    let curStart = fromTs;
    let curName: string | null = null;
    for (let t = fromTs; t <= toTs; t += 86_400_000) {
      let phase: string | null = null;
      try {
        phase = computePhaseForDate(
          cycles as Parameters<typeof computePhaseForDate>[0],
          t,
        );
      } catch {
        phase = null;
      }
      if (curName === null) { curName = phase; curStart = t; continue; }
      if (phase !== curName) {
        if (curName) out.push({ start: curStart, end: t - 86_400_000, name: curName });
        curName = phase; curStart = t;
      }
    }
    if (curName) out.push({ start: curStart, end: toTs, name: curName });
    return out;
  }

  // ── processDump ──────────────────────────────────────────────────────────

  function processDump(dumpItem: { ts?: number; text?: string; data?: string }): { ok: boolean; reason?: string; night_of?: string } {
    if (!dumpItem || !dumpItem.ts) return { ok: false, reason: 'no-ts' };
    const raw = dumpItem.text ?? dumpItem.data ?? '';
    if (!raw || raw.length > MAX_DUMP_LEN) return { ok: false, reason: 'empty-or-too-long' };
    const settings = getSettings();
    const keywords = settings.correlation_tokens ?? DEFAULT_SETTINGS.correlation_tokens;
    const parsed = parseSleepDump(raw, dumpItem.ts, keywords);
    if (!parsed || !parsed.record) return { ok: false, reason: 'no-sleep-content' };

    const records = getRecords();
    const existing = records.find((r) => r.night_of === parsed.record!.night_of) ?? null;
    const next = { ...parsed.record, raw_source_id: String(dumpItem.ts) };
    const merged = mergeRecord(existing, next as SleepRecord, dumpItem.ts);
    const nextRecords = existing
      ? records.map((r) => r.night_of === merged.night_of ? merged : r)
      : [...records, merged].sort((a, b) => (a.night_of ?? '').localeCompare(b.night_of ?? ''));
    setRecords(nextRecords);

    try {
      events.emit('sleep:record_updated', { night_of: merged.night_of, is_partial: merged.is_partial });
    } catch { /* non-fatal */ }

    return { ok: true, night_of: merged.night_of };
  }

  // ── recomputeDerived ─────────────────────────────────────────────────────

  function recomputeDerived(): void {
    try {
      const now = getNow();
      const records = getRecords();
      const settings = getSettings();
      const target = resolveTarget(settings);

      setKey('stats', deriveSleepStats(records));
      const debt = computeSleepDebt(records, target, 14, now);
      setKey('debt', debt);

      // ── sleep:debt_accumulated · 7d shortage > 4h ─────────────────────
      // Once per UTC day, gated on ≥5 logged nights.
      try {
        const last7 = records
          .filter((r) => r && !r.is_skipped && typeof r.tst_min === 'number')
          .slice(-7);
        if (last7.length >= 5) {
          const totalHours = last7.reduce((s, r) => s + (r.tst_min ?? 0), 0) / 60;
          const targetTotal = target * 7;
          const shortage = targetTotal - totalHours;
          if (shortage > 4) {
            const todayKey = new Date(now).toISOString().slice(0, 10);
            const lastEmittedDay = store.get<string>('sleep', '_debtAccumulatedDay', '') ?? '';
            if (lastEmittedDay !== todayKey) {
              const baseBedtimeMin = 22 * 60 + 30;
              const pullForwardMin = Math.min(120, Math.round((shortage / 7) * 60));
              const idealMin = baseBedtimeMin - pullForwardMin;
              const idealHHMM = `${String(Math.floor(idealMin / 60) % 24).padStart(2, '0')}:${String(idealMin % 60).padStart(2, '0')}`;
              try {
                events.emit('sleep:debt_accumulated', {
                  debtHours: Math.round(shortage * 10) / 10,
                  targetHours: target,
                  idealBedtimeHHMM: idealHHMM,
                  ts: now,
                });
              } catch { /* non-fatal */ }
              store.set('sleep', '_debtAccumulatedDay', todayKey);
            }
          }
        }
      } catch { /* non-fatal */ }

      // ── sleep:wind_down_window · 60min before target bedtime ──────────
      try {
        const targetBedtime = (getSettings().target_bedtime ?? '').trim();
        if (/^\d{2}:\d{2}$/.test(targetBedtime)) {
          const [bh, bm] = targetBedtime.split(':').map(Number);
          const todayMidnight = new Date(now);
          todayMidnight.setHours(0, 0, 0, 0);
          const bedtimeTs = todayMidnight.getTime() + (bh * 60 + bm) * 60_000;
          const minutesUntil = (bedtimeTs - now) / 60_000;
          if (minutesUntil <= 60 && minutesUntil > 0) {
            const todayKey = new Date(now).toISOString().slice(0, 10);
            const lastEmittedDay = store.get<string>('sleep', '_windDownWindowDay', '') ?? '';
            if (lastEmittedDay !== todayKey) {
              try {
                events.emit('sleep:wind_down_window', {
                  bedtimeTs,
                  ts: now,
                });
              } catch { /* non-fatal */ }
              store.set('sleep', '_windDownWindowDay', todayKey);
            }
          }
        }
      } catch { /* non-fatal */ }
      setKey('drift', detectBedtimeDrift(records, now));
      setKey('chronotype', estimateChronotype(records, now));
      setKey('socialJetlag', computeSocialJetlag(records, settings));
      setKey('dspsFlag', detectDSPSPattern(records, now));
      const shortRun = detectShortSleepRun(records, 5, 5, now);
      setKey('shortSleepRun', shortRun);
      // Credibility audit NC2: emit the source event on transition →
      // cross-module router routes it to finance spending caution.
      try {
        const prevShort = store.get<{ ts?: number; nights?: number } | null>('sleep', '_shortRunEmittedAt', null);
        if (shortRun && shortRun.runNights >= 3 && (!prevShort || prevShort.nights !== shortRun.runNights)) {
          events.emit('sleep:short_sleep_run_detected', {
            nights: shortRun.runNights,
            mean_hours: shortRun.meanTst / 60,
            ts: now,
          });
          store.set('sleep', '_shortRunEmittedAt', { ts: now, nights: shortRun.runNights });
        }
        // Pacing breach = sleep debt above 4h sustained → emit once per
        // 24h cooldown so we don't spam habits + work modules.
        const debt = store.get<{ debt_hours?: number } | null>('sleep', 'debt', null);
        const prevPacingTs = store.get<number>('sleep', '_pacingBreachEmittedAt', 0) ?? 0;
        const debtHrs = debt?.debt_hours ?? 0;
        if (debtHrs >= 4 && now - prevPacingTs > 24 * 3600_000) {
          events.emit('sleep:pacing_breach_detected', {
            severity: debtHrs >= 8 ? 'watch' : 'info',
            run_length: shortRun?.runNights ?? 0,
            ts: now,
          });
          store.set('sleep', '_pacingBreachEmittedAt', now);
        }
      } catch { /* non-fatal */ }
      // forecastTonightTST requires a PredictApi integration layer; pass null
      // so the function's own guard returns null until the layer is wired.
      setKey('tonightForecast', forecastTonightTST(records, null as never));

      // Build cross-module inputs.
      const actionLog = store.get<Array<{ ts: number; rawText?: string; undone?: boolean }>>('shared', 'actionLog', []) ?? [];
      const dumpsForCorrelation = actionLog
        .filter((e) => e && !e.undone && typeof e.ts === 'number' && typeof e.rawText === 'string')
        .map((e) => ({ ts: e.ts, text: e.rawText as string }));

      const rawCycles = store.get<unknown[]>('cycle', 'cycles', []) ?? [];
      const cyclePhases = buildSleepCyclePhases(rawCycles, now - 90 * 86_400_000, now);

      const focusLog = store.get<Array<{ at: number }>>('work', 'focus_log', []) ?? [];
      const dumpsRaw = store.get<Array<{ ts: number; text?: string }>>('dump', 'items', []) ?? [];
      const targetBedtime = settings.target_bedtime ?? null;

      // tryRun: run detector if settings flag is true, swallow errors.
      function tryRun<T>(flag: string, fn: (args: unknown) => T | null, args: unknown): T | null {
        const s = settings as unknown as Record<string, unknown>;
        if (s[flag] !== true) return null;
        try { return fn(args); }
        catch (err) { console.warn('[orchestrator/sleep]', flag, 'failed:', err); return null; }
      }

      const cycleRecords = Array.isArray(rawCycles)
        ? (rawCycles as Array<{ start_date: string; length_days: number; ovulation_day?: number }>)
        : [];

      const windDownLog = store.get<Array<{ ts: number; step_id: string; step_label?: string; action: string }>>('sleep', 'windDownLog', []) ?? [];
      const medsLog = store.get<Array<{ ts: number }>>('sleep', 'medsLog', []) ?? [];

      const patterns: AnySleepPattern[] = [
        tryRun('show_revenge_bedtime', (a) => detectRevengeBedtime(a as Parameters<typeof detectRevengeBedtime>[0]), {
          actionLog, sleepRecords: records, targetBedtime, now,
        }),
        tryRun('show_caffeine_cutoff', (a) => detectCaffeineCutoff(a as Parameters<typeof detectCaffeineCutoff>[0]), {
          dumps: dumpsForCorrelation, sleepRecords: records, now,
        }),
        tryRun('show_sleep_onset_gap', (a) => detectSleepOnsetGap(a as Parameters<typeof detectSleepOnsetGap>[0]), {
          sleepRecords: records, now,
        }),
        tryRun('show_weekend_recovery', (a) => detectWeekendRecoveryIllusion(a as Parameters<typeof detectWeekendRecoveryIllusion>[0]), {
          sleepRecords: records, now,
        }),
        tryRun('show_bedtime_mind_racing', (a) => detectBedtimeMindRacing(a as Parameters<typeof detectBedtimeMindRacing>[0]), {
          dumps: dumpsForCorrelation, sleepRecords: records, now,
        }),
        tryRun('show_wind_down_friction', (a) => detectWindDownFriction(a as Parameters<typeof detectWindDownFriction>[0]), {
          opted_in: true as const,
          windDownLog, sleepRecords: records, targetBedtime, now,
        }),
        tryRun('show_medication_timing', (a) => detectMedicationTimingDrift(a as Parameters<typeof detectMedicationTimingDrift>[0]), {
          opted_in: true as const,
          medsLog, sleepRecords: records, now,
        }),
        tryRun('show_chronotherapy_progress', (a) => detectChronotherapyProgress(a as Parameters<typeof detectChronotherapyProgress>[0]), {
          opted_in: true as const,
          chronotherapy: settings.chronotherapy,
          sleepRecords: records, now,
        }),
        tryRun('show_cross_cycle', (a) => detectSleepCyclePattern(a as Parameters<typeof detectSleepCyclePattern>[0]), {
          opted_in: true as const,
          sleepRecords: records, cycles: cycleRecords, now,
        }),
        tryRun('show_cross_focus', (a) => detectSleepFocusPattern(a as Parameters<typeof detectSleepFocusPattern>[0]), {
          opted_in: true as const,
          sleepRecords: records, focusLog, now,
        }),
        tryRun('show_cross_mood', (a) => detectSleepDumpMoodPattern(a as Parameters<typeof detectSleepDumpMoodPattern>[0]), {
          opted_in: true as const,
          sleepRecords: records,
          dumps: dumpsRaw.filter((d) => d && typeof d.ts === 'number' && typeof d.text === 'string') as Array<{ ts: number; text: string }>,
          now,
        }),
        tryRun('show_cycle_phase_coupling', (a) => detectCyclePhaseSleepCoupling(a as Parameters<typeof detectCyclePhaseSleepCoupling>[0]), {
          opted_in: settings.show_cycle_phase_coupling === true,
          sleepRecords: records, cyclePhases, now,
        }),
        tryRun('show_stimulant_sleep_debt', (a) => detectStimulantSleepDebt(a as Parameters<typeof detectStimulantSleepDebt>[0]), {
          opted_in: settings.show_stimulant_sleep_debt === true,
          sleepRecords: records, dumps: dumpsForCorrelation, now,
        }),
      ].filter((p): p is AnySleepPattern => p != null);

      const prev = store.get<AnySleepPattern[]>('sleep', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => p?.pattern).filter(Boolean),
      );

      setKey('patterns', patterns);
      setKey('patternsLastComputedAt', now);
      setKey('lastRecomputeAt', now);

      for (const p of patterns) {
        if (p?.pattern && !prevKeys.has(p.pattern)) {
          try {
            events.emit('sleep:pattern_detected', {
              pattern: p.pattern,
              confidence: (p as { confidence?: string }).confidence ?? 'medium',
              sample_n: (p as { sample_n?: number }).sample_n ?? 0,
              ts: now,
            });
          } catch { /* non-fatal */ }
        }
      }

      // ── caffeine→sleep correlator (Drake 2013) ────────────────────────
      // Cross-module: finance.records (coffee txns) + dump.items (mentions)
      // paired to sleep.records. Result stored under sleep.caffeineSleep
      // for UI consumption. Emit `pattern:caffeine_sleep_detected` only
      // when correlation crosses threshold (non-empty copy), once per 24h
      // cooldown per threshold-hour bucket.
      try {
        const financeRecords = store.get<FinanceRecord[]>('finance', 'records', []) ?? [];
        const braindumps = dumpsForCorrelation; // {ts,text}[] already shaped
        const caffeine = inferCaffeineFromTransactions(financeRecords, braindumps);
        const result: CaffeineSleepResult = correlateCaffeineAndSleep(caffeine, records);
        setKey('caffeineSleep', result);

        if (result.copy && result.threshold) {
          const cooldownKey = '_caffeineSleepEmittedAt';
          const last = store.get<{ ts?: number; hours?: number } | null>(
            'sleep', cooldownKey, null,
          );
          const lastTs = last?.ts ?? 0;
          const lastH = last?.hours ?? -1;
          const sameBucket = lastH === result.threshold.hours;
          if (!sameBucket || now - lastTs > 24 * 3600_000) {
            events.emit('pattern:caffeine_sleep_detected', {
              correlation: result.correlation,
              threshold: result.threshold,
              sampleSize: result.sampleSize,
              copy: result.copy,
              ts: now,
            });
            store.set('sleep', cooldownKey, { ts: now, hours: result.threshold.hours });
          }
        }
      } catch (err) {
        console.warn('[orchestrator/sleep] caffeine-sleep correlator failed:', err);
      }
    } catch (e) {
      console.error('[orchestrator/sleep] recomputeDerived failed:', e);
    }
  }

  // ── processBacklog ───────────────────────────────────────────────────────

  function processBacklog(): void {
    try {
      const dumps = store.get<Array<{ ts?: number; text?: string; data?: string }>>('dump', 'items', []) ?? [];
      const legacy = store.get<Array<{ ts?: number; text?: string; data?: string }>>('sleep', 'items', []) ?? [];
      const merged = [...dumps, ...legacy].filter((d) => d && d.ts);

      const records = getRecords();
      const seen = new Set(records.map((r) => r.raw_source_id).filter(Boolean));
      const unprocessed = merged.filter((d) => !seen.has(String(d.ts)));
      const batch = unprocessed.slice(-40);

      for (const d of batch) {
        try { processDump(d); }
        catch (err) { console.warn('[orchestrator/sleep] processDump failed for dump', d?.ts, err); }
      }
      recomputeDerived();
    } catch (e) {
      console.error('[orchestrator/sleep] processBacklog failed:', e);
    }
  }

  // ── schedule (debounced recompute) ───────────────────────────────────────

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputeDerived(); }, DEBOUNCE_MS);
  }

  // ── init / teardown ──────────────────────────────────────────────────────

  function init(): void {
    if (initialized) return;
    initialized = true;

    // Seed default settings if missing.
    if (!store.get('sleep', 'settings', null)) {
      setKey('settings', DEFAULT_SETTINGS);
    }

    unsubs.push(store.subscribeKey('dump', 'items', () => {
      try { processBacklog(); } catch (err) { console.error('[orchestrator/sleep] dump.items tick failed', err); }
    }));
    // Legacy sleep.items path — written by applyRoute before v:2 braindump event.
    unsubs.push(store.subscribeKey('sleep', 'items', () => {
      try { processBacklog(); } catch (err) { console.error('[orchestrator/sleep] sleep.items tick failed', err); }
    }));
    unsubs.push(store.subscribeKey('sleep', 'records', () => {
      try { schedule(); } catch (err) { console.error('[orchestrator/sleep] sleep.records tick failed', err); }
    }));
    // Phase 4 cross-module: cycle phases shift → luteal coupling recompute.
    unsubs.push(store.subscribeKey('cycle', 'cycles', () => {
      try { schedule(); } catch (err) { console.error('[orchestrator/sleep] cycle.cycles tick failed', err); }
    }));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string; text?: string }>; ts?: number; raw?: string; text?: string };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'sleep');
            if (myItems.length === 0) {
              // v:2 with no sleep items — still recompute in case other state shifted.
              recomputeDerived();
              return;
            }
            const ts = p.ts ?? getNow();
            for (const it of myItems) {
              processDump({ ts, text: it.text ?? p.raw ?? p.text ?? '' });
            }
            recomputeDerived();
            return;
          }
          processBacklog();
        } catch (err) {
          console.error('[orchestrator/sleep] braindump tick failed', err);
        }
      }),
    );

    // body:pattern_detected → cross-feed recompute.
    unsubs.push(
      events.on('body:pattern_detected', () => {
        try { schedule(); } catch (err) { console.error('[orchestrator/sleep] body:pattern_detected tick failed', err); }
      }),
    );

    // ── APNs push subscribers (body-v2 wiring) ──────────────────────────
    if (scheduleNotification) {
      // sleep:wind_down_window
      unsubs.push(events.on('sleep:wind_down_window', (raw) => {
        try {
          const p = (raw ?? {}) as { bedtimeTs?: number };
          if (typeof p.bedtimeTs !== 'number') return;
          const dayKey = new Date(p.bedtimeTs).toISOString().slice(0, 10);
          scheduleNotification(
            {
              title: 'wind-down in 60 min. or whenever.',
              category: 'REMINDER',
              dedupe_key: `sleep:wind_down_window:${dayKey}`,
              action_url: '/sleep',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));

      // pattern:caffeine_sleep_detected (re-use of P3's event)
      unsubs.push(events.on('pattern:caffeine_sleep_detected', (raw) => {
        try {
          const p = (raw ?? {}) as { copy?: string; threshold?: { hours?: number } | null; ts?: number };
          const dynamic = typeof p.copy === 'string' && p.copy.trim().length > 0;
          const title = dynamic ? p.copy! : 'coffee after 3pm. heads up — sleep usually dips.';
          const hourBucket = p.threshold?.hours ?? 0;
          const ts = typeof p.ts === 'number' ? p.ts : getNow();
          const dayKey = new Date(ts).toISOString().slice(0, 10);
          scheduleNotification(
            {
              title,
              category: 'PATTERN_ALERT',
              dedupe_key: `sleep:caffeine_late_warning:${dayKey}:${hourBucket}`,
              action_url: '/sleep',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));

      // sleep:debt_accumulated
      unsubs.push(events.on('sleep:debt_accumulated', (raw) => {
        try {
          const p = (raw ?? {}) as { debtHours?: number; idealBedtimeHHMM?: string; ts?: number };
          if (typeof p.debtHours !== 'number' || typeof p.idealBedtimeHHMM !== 'string') return;
          const [hh, mm] = p.idealBedtimeHHMM.split(':').map(Number);
          const period = hh >= 12 ? 'pm' : 'am';
          const h12 = hh % 12 === 0 ? 12 : hh % 12;
          const friendly = `${h12}:${String(mm).padStart(2, '0')}${period}`;
          const debtRounded = Math.round(p.debtHours);
          const ts = typeof p.ts === 'number' ? p.ts : getNow();
          const dayKey = new Date(ts).toISOString().slice(0, 10);
          scheduleNotification(
            {
              title: `you're ${debtRounded}h short this week. ideal bedtime tonight: ${friendly}.`,
              category: 'PATTERN_ALERT',
              dedupe_key: `sleep:debt_accumulated:${dayKey}`,
              action_url: '/sleep',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));
    }

    // Cold start — backfill + initial derived compute.
    try { processBacklog(); } catch (err) { console.error('[orchestrator/sleep] first-run backfill failed', err); }
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    if (timer) { clearTimeout(timer); timer = null; }
    initialized = false;
  }

  return { init, teardown, recomputeDerived, processBacklog };
}
