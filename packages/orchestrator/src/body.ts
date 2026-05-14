/**
 * @ollie/orchestrator · body
 *
 * Ported from window.VOID.orchestrator.body in void-app.html (~lines 24259–24385).
 * The only caller of @ollie/logic/body detectPatterns.
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "body"):
 *   patterns               AnyBodyPattern[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions:
 *   body.water_log         → schedule recompute
 *   body.supplements       → schedule recompute
 *   body.episodes          → schedule recompute
 *   shared.actionLog       → schedule recompute (dump undo path)
 *   cycle.cycles           → schedule recompute (phase coupling)
 *   sleep.records          → schedule recompute (sleep debt lag)
 *   void:braindump:submitted event → schedule recompute (body items only, v≥2 guard)
 *
 * Events emitted (body-v2 wiring):
 *   body:hydration_drop_detected   from existing water-drop heuristic
 *   body:pattern_detected          from pattern detectors
 *   body:supplement_due            when a supplement's daily reminder window opens
 *   body:posture_nudge             once per hour-bucket inside work-hour window (opt-in)
 *
 * Push subscribers (APNs):
 *   - body:supplement_due (aggregated when multiple fire in same recompute pass)
 *   - body:posture_nudge
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import { detectPatterns } from '@ollie/logic/body';
import type { AnyBodyPattern, CyclePhaseRange, SleepRecord, WaterEntry, SupplementLogEntry } from '@ollie/logic/body';
import { computePhaseForDate } from '@ollie/logic/cycle';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;

// Default supplement reminder window: 8am local. Stored per-supp via
// optional `reminder_hhmm` field on body.supplements entries.
const DEFAULT_SUPPLEMENT_HHMM = '08:00';

// Posture nudge work hours window (local hour-of-day). Configurable via
// body.posture_settings.{start_hour, end_hour, opt_in}; opt_in defaults
// to FALSE — never fires unless user toggles on.
const DEFAULT_POSTURE_START_HOUR = 9;
const DEFAULT_POSTURE_END_HOUR = 17;

interface SupplementShape {
  id: string;
  name: string;
  dose?: string | null;
  added_at?: number;
  reminder_hhmm?: string;
  checked_dates?: string[];
}

interface PostureSettings {
  opt_in?: boolean;
  start_hour?: number;
  end_hour?: number;
}

export interface BodyOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** APNs push scheduler; no-op when omitted. */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

export function createBodyOrchestrator(
  store: Store,
  opts: BodyOrchestratorOptions = {},
): Orchestrator & { recomputePatterns(): void } {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Build a step-function phase array from cycle.cycles covering the past
  // 90 days. Used by detectSymptomPhaseCoupling.
  function buildCyclePhases(cycles: unknown[], fromTs: number, toTs: number): CyclePhaseRange[] {
    if (!Array.isArray(cycles) || cycles.length === 0) return [];
    const out: CyclePhaseRange[] = [];
    let curStart = fromTs;
    let curName: string | null = null;
    for (let t = fromTs; t <= toTs; t += 86_400_000) {
      let phase: string | null = null;
      try { phase = computePhaseForDate(cycles as Parameters<typeof computePhaseForDate>[0], t); } catch { phase = null; }
      if (curName === null) { curName = phase; curStart = t; continue; }
      if (phase !== curName) {
        if (curName) out.push({ start: curStart, end: t - 86_400_000, name: curName });
        curName = phase; curStart = t;
      }
    }
    if (curName) out.push({ start: curStart, end: toTs, name: curName });
    return out;
  }

  // ── supplement_due emission ─────────────────────────────────────────────
  // Reads body.supplements (array of {id, name, reminder_hhmm?, checked_dates?}).
  // For each supplement, fires body:supplement_due when now is inside the
  // 60-min window after reminder_hhmm AND the supp has not been checked
  // off today. Deduped per supplement per UTC day.
  function emitSupplementDue(): void {
    const now = getNow();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const supps = store.get<SupplementShape[]>('body', 'supplements', []) ?? [];
    if (!Array.isArray(supps) || supps.length === 0) return;

    const emitted = new Set(store.get<string[]>('body', '_supplementDueEmittedKeys', []) ?? []);
    const fresh: string[] = [];

    for (const s of supps) {
      if (!s || !s.id || !s.name) continue;
      const dedupKey = `${s.id}:${todayKey}`;
      if (emitted.has(dedupKey)) continue;

      const checked = Array.isArray(s.checked_dates) ? s.checked_dates : [];
      if (checked.includes(todayKey)) continue;

      const hhmm = typeof s.reminder_hhmm === 'string' && /^\d{2}:\d{2}$/.test(s.reminder_hhmm)
        ? s.reminder_hhmm
        : DEFAULT_SUPPLEMENT_HHMM;
      const [hh, mm] = hhmm.split(':').map(Number);
      const todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      const reminderTs = todayMidnight.getTime() + (hh * 60 + mm) * 60_000;
      if (now < reminderTs) continue;
      if (now > reminderTs + 60 * 60_000) continue;

      fresh.push(dedupKey);
      try {
        events.emit('body:supplement_due', {
          supplementId: s.id,
          supplementName: s.name,
          reminderHHMM: hhmm,
          ts: now,
        });
      } catch { /* non-fatal */ }
    }

    if (fresh.length) {
      store.set('body', '_supplementDueEmittedKeys', [...emitted, ...fresh]);
    }
  }

  // ── posture_nudge emission ──────────────────────────────────────────────
  // Opt-in. Fires once per hour-bucket inside work hours.
  function emitPostureNudge(): void {
    const settings = store.get<PostureSettings | null>('body', 'posture_settings', null);
    if (!settings || settings.opt_in !== true) return;

    const now = getNow();
    const startHour = typeof settings.start_hour === 'number' ? settings.start_hour : DEFAULT_POSTURE_START_HOUR;
    const endHour = typeof settings.end_hour === 'number' ? settings.end_hour : DEFAULT_POSTURE_END_HOUR;
    const localHour = new Date(now).getHours();
    if (localHour < startHour || localHour >= endHour) return;

    const todayKey = new Date(now).toISOString().slice(0, 10);
    const bucketKey = `${todayKey}:${localHour}`;
    const emitted = new Set(store.get<string[]>('body', '_postureNudgeEmittedBuckets', []) ?? []);
    if (emitted.has(bucketKey)) return;

    try {
      events.emit('body:posture_nudge', { hourBucket: localHour, ts: now });
    } catch { /* non-fatal */ }
    store.set('body', '_postureNudgeEmittedBuckets', [...emitted, bucketKey]);
  }

  function recomputePatterns(): void {
    try {
      const now = getNow();

      const actionLog = store.get<Array<{ ts: number; rawText?: string; undone?: boolean }>>('shared', 'actionLog', []) ?? [];
      const waterLog = store.get<WaterEntry[]>('body', 'water_log', []) ?? [];
      const supplementLog = store.get<SupplementLogEntry[]>('body', 'supplements', []) ?? [];
      const sleepRecords = store.get<SleepRecord[]>('sleep', 'records', []) ?? [];
      const rawCycles = store.get<unknown[]>('cycle', 'cycles', []) ?? [];

      const dumps = actionLog
        .filter((e) => e && !e.undone && typeof e.ts === 'number' && typeof e.rawText === 'string')
        .map((e) => ({ ts: e.ts, rawText: e.rawText as string }));

      const cyclePhases = buildCyclePhases(rawCycles, now - 90 * 86_400_000, now);

      const prev = store.get<AnyBodyPattern[]>('body', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => p?.pattern).filter(Boolean),
      );

      const patterns = detectPatterns(
        { dumps, waterLog, supplementLog, sleepRecords, cyclePhases, now },
      );

      store.set('body', 'patterns', patterns);
      store.set('body', 'patternsLastComputedAt', now);

      // Credibility audit NC2: hydration drop.
      try {
        const target = store.get<number>('body', 'water_target', 8) ?? 8;
        const dayMs = 86_400_000;
        const todayStart = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
        const entryTs = (w: WaterEntry): number => typeof w === 'number' ? w : (w?.ts ?? 0);
        const todayCount = waterLog.filter((w) => { const t = entryTs(w); return t >= todayStart && t < todayStart + dayMs; }).length;
        const last7Start = todayStart - 7 * dayMs;
        const last7Count = waterLog.filter((w) => { const t = entryTs(w); return t >= last7Start && t < todayStart; }).length;
        const baselineDaily = last7Count / 7;
        const minutesIntoDay = Math.max(1, (now - todayStart) / 60_000);
        const projectedToday = todayCount * (1440 / minutesIntoDay);
        const dropPct = baselineDaily > 0 ? Math.max(0, (1 - projectedToday / baselineDaily) * 100) : 0;
        const lastEmit = store.get<number>('body', '_hydrationEmittedAt', 0) ?? 0;
        if (baselineDaily >= 2 && dropPct >= 30 && projectedToday < target && now - lastEmit > 24 * 3600_000) {
          events.emit('body:hydration_drop_detected', { drop_pct: Math.round(dropPct), ts: now });
          store.set('body', '_hydrationEmittedAt', now);
        }
      } catch { /* non-fatal */ }

      if (Array.isArray(patterns)) {
        for (const p of patterns) {
          if (p?.pattern && !prevKeys.has(p.pattern)) {
            events.emit('body:pattern_detected', {
              pattern: p.pattern,
              confidence: (p as { confidence?: string }).confidence ?? 'low',
              sample_n: (p as { sample_n?: number }).sample_n ?? 0,
              ts: now,
            });
          }
        }
      }

      // body-v2 notification emissions
      try { emitSupplementDue(); } catch { /* non-fatal */ }
      try { emitPostureNudge(); } catch { /* non-fatal */ }
    } catch (e) {
      console.error('[orchestrator/body] recompute failed:', e);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('body', 'water_log', schedule));
    unsubs.push(store.subscribeKey('body', 'supplements', schedule));
    unsubs.push(store.subscribeKey('body', 'episodes', schedule));
    unsubs.push(store.subscribeKey('shared', 'actionLog', schedule));
    unsubs.push(store.subscribeKey('cycle', 'cycles', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'body');
            if (myItems.length > 0) schedule();
            return;
          }
          schedule();
        } catch {
          schedule();
        }
      }),
    );

    // Hourly tick — supplement_due + posture_nudge windows are time-based.
    const HOUR_MS = 60 * 60_000;
    const hourTick = setInterval(() => {
      try { emitSupplementDue(); } catch { /* non-fatal */ }
      try { emitPostureNudge(); } catch { /* non-fatal */ }
    }, HOUR_MS);
    unsubs.push(() => clearInterval(hourTick));

    // ── APNs push subscribers (body-v2 wiring) ──────────────────────────
    if (scheduleNotification) {
      // body:supplement_due → aggregate emits in the same recompute pass
      // into one push. Flush after a short 10ms macrotask delay so any
      // additional emits in the same tick get coalesced.
      let supplementBuffer: Array<{ name: string; id: string; ts: number }> = [];
      let supplementFlushTimer: ReturnType<typeof setTimeout> | null = null;

      function flushSupplements(): void {
        if (supplementBuffer.length === 0) return;
        const items = supplementBuffer.slice();
        supplementBuffer = [];
        supplementFlushTimer = null;
        const dayKey = new Date(items[0].ts).toISOString().slice(0, 10);
        if (items.length === 1) {
          scheduleNotification!(
            {
              title: `${items[0].name}. just a heads up.`,
              category: 'REMINDER',
              dedupe_key: `body:supplement_due:${items[0].id}:${dayKey}`,
              action_url: '/body',
            },
            getNow(),
          );
        } else {
          const list = items.map((i) => i.name).join(', ');
          scheduleNotification!(
            {
              title: `${list}. just a heads up.`,
              category: 'REMINDER',
              dedupe_key: `body:supplement_due:agg:${dayKey}:${items.map((i) => i.id).sort().join(',')}`,
              aggregation_group: `body:supplement_due:${dayKey}`,
              action_url: '/body',
            },
            getNow(),
          );
        }
      }

      unsubs.push(events.on('body:supplement_due', (raw) => {
        try {
          const p = (raw ?? {}) as { supplementId?: string; supplementName?: string; ts?: number };
          if (!p.supplementId || !p.supplementName) return;
          const ts = typeof p.ts === 'number' ? p.ts : getNow();
          supplementBuffer.push({ id: p.supplementId, name: p.supplementName, ts });
          if (supplementFlushTimer) clearTimeout(supplementFlushTimer);
          supplementFlushTimer = setTimeout(flushSupplements, 10);
        } catch { /* non-fatal */ }
      }));
      unsubs.push(() => {
        if (supplementFlushTimer) { clearTimeout(supplementFlushTimer); supplementFlushTimer = null; }
        supplementBuffer = [];
      });

      // body:posture_nudge
      unsubs.push(events.on('body:posture_nudge', (raw) => {
        try {
          const p = (raw ?? {}) as { hourBucket?: number; ts?: number };
          if (typeof p.hourBucket !== 'number') return;
          const ts = typeof p.ts === 'number' ? p.ts : getNow();
          const dayKey = new Date(ts).toISOString().slice(0, 10);
          scheduleNotification(
            {
              title: 'stand up. or sit better. either works.',
              category: 'REMINDER',
              dedupe_key: `body:posture_nudge:${dayKey}:${p.hourBucket}`,
              action_url: '/body',
            },
            getNow(),
          );
        } catch { /* non-fatal */ }
      }));
    }

    // Cold start — populate patterns immediately.
    schedule();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    initialized = false;
  }

  return { init, teardown, recomputePatterns };
}
