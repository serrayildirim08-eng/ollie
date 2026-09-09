/**
 * @ollie/orchestrator · cycle
 *
 * Ported from window.VOID.orchestrator in void-app.html (~lines 23712–23928).
 * The only caller of @ollie/logic/cycle (+ symptoms / flags sub-exports).
 * UI reads derived keys from the store — it never calls logic directly.
 *
 * Derived keys written (namespace: "cycle"):
 *   cycles           CycleRecord[] from detectBoundaries
 *   prediction       EWMA prediction object
 *   insights         symptom correlations (top 2)
 *   healthFlags      rule-based flags
 *   stats            deriveCycleStats output
 *   adherence        detectAdherenceIssue output
 *   fertileWindow    6-day fertile range (null when suppressed)
 *   correlations     per-tag correlation results (top 2)
 *   phaseName        current phase string (refreshed every 60s)
 *   flags            detectHealthFlags output (refreshed every 60s)
 *   currentDay       cycle day integer or null (refreshed every 60s)
 *   lastRecomputeAt  timestamp of most recent full recompute
 *
 * Events emitted (prediction-driven body-v2 wiring):
 *   cycle:period_logged          on a newly logged "started" item
 *   cycle:luteal_phase_entered   on phase transition into luteal (kept for D2)
 *   cycle:period_approaching     5 days before predicted nextTs
 *   cycle:period_imminent        1 day before predicted nextTs
 *   cycle:period_late            3 days past predicted nextTs (no new period)
 *   cycle:luteal_starting        3 days before luteal start
 *   cycle:ovulation_imminent     1 day before predicted ovulation (opt-in)
 *   cycle:pill_missed            next day after a missed pill log
 *
 * Pregnancy pause (NOT pregnancy tracking):
 *   The bridge writes `cycle.pregnant` (boolean) + `cycle.pregnancyEndTs`
 *   (ms of the most recent pregnancy_end, or null). While `cycle.pregnant`
 *   is true the watcher goes DORMANT — prediction returns null, period /
 *   late / missed-period flags are cleared, and NO prediction/pill events
 *   fire. When it resolves, `pregnancyEndTs` fences off the pre-pregnancy
 *   period starts so the first period after the end restarts the cycle as a
 *   fresh start rather than reading as one ~9-month "late" cycle.
 *
 * Push subscribers (APNs):
 *   The 6 cycle prediction events above wire to scheduleNotification
 *   when injected. Omit the callback in tests / desktop to no-op.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import type { NotificationSpec } from '@ollie/notifications';
import * as cycle from '@ollie/logic/cycle';
import type { CycleItem, CycleRecord } from '@ollie/logic/cycle';
import type { Orchestrator } from './types';
import { appendCapped } from './dedup-store';

const CORRELATION_TAGS = ['cramps', 'bloating', 'headache', 'fatigue', 'mood swings'] as const;
const DAY_MS = 86_400_000;
const LUTEAL_DAYS = 14; // mirror of @ollie/logic/cycle/constants

export interface CycleOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** APNs push scheduler; no-op when omitted (desktop, web, tests). */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
  /** Opt-in for ovulation notifications. Defaults to false. */
  ovulationOptIn?: boolean;
}

export function createCycleOrchestrator(
  store: Store,
  opts: CycleOrchestratorOptions = {},
): Orchestrator & {
  recomputeCycle(): void;
} {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;
  const ovulationOptIn = opts.ovulationOptIn === true;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];

  // ── time-dependent derived values ────────────────────────────────────────
  function recomputeCycleTime(
    cycles?: CycleRecord[],
    stats?: ReturnType<typeof cycle.deriveCycleStats>,
    items?: CycleItem[],
    pregnantArg?: boolean,
  ): void {
    const now = getNow();
    // Pregnancy pause: when this runs off the 60s tick / lastEdited subscriber
    // (no arg passed) read the flag from the store so the dormant state holds
    // between full recomputes.
    const pregnant =
      pregnantArg ?? (store.get<boolean>('cycle', 'pregnant', false) === true);
    const lastEdited = store.get<Record<string, number>>('cycle', 'lastEditedByCycle', {}) ?? {};
    const resolvedItems = items ?? store.get<CycleItem[]>('cycle', 'items', []);
    const symptomEvents = resolvedItems.filter(
      (i) => i && (i.action === 'symptom' || i.action === 'log'),
    );
    const cs = cycles ?? store.get<CycleRecord[]>('cycle', 'cycles', []);
    const st = stats ?? store.get<ReturnType<typeof cycle.deriveCycleStats>>('cycle', 'stats', {
      cycles_logged_count: 0, mean_length: null, sd_length: 0,
      mean_bleed: null, irregular_flag: false, last_period_start: null,
    });

    const phaseName = pregnant ? 'unknown' : cycle.computePhaseForDate(cs, now);
    // Dormant: clear the period/late/missed health flags while paused.
    const flags = pregnant ? [] : cycle.detectHealthFlags(cs, symptomEvents, now, lastEdited);
    // No "currentDay" cycle counter while paused — the ring/day number should
    // not keep ticking through a pregnancy.
    const currentDay =
      !pregnant && st && st.last_period_start != null
        ? Math.floor((now - st.last_period_start) / DAY_MS) + 1
        : null;

    try {
      const prevPhase = store.get<string | null>('cycle', 'phaseName', null);
      if (phaseName === 'luteal' && prevPhase !== 'luteal') {
        events.emit('cycle:luteal_phase_entered', { ts: now });
      }
    } catch { /* non-fatal */ }
    store.set('cycle', 'phaseName', phaseName);
    store.set('cycle', 'flags', flags);
    store.set('cycle', 'currentDay', currentDay);
  }

  // ── prediction-window event emission ────────────────────────────────────
  function emitPredictionEvents(
    prediction: ReturnType<typeof cycle.predictNextPeriod> | null,
    items: CycleItem[],
  ): void {
    if (!prediction || typeof prediction.nextTs !== 'number') return;
    const now = getNow();
    const nextTs = prediction.nextTs;
    const lutealStartTs = nextTs - LUTEAL_DAYS * DAY_MS;
    const ovulationTs = nextTs - LUTEAL_DAYS * DAY_MS;

    let lastStartTs = 0;
    for (const it of items) {
      if (it && it.action === 'started' && typeof it.ts === 'number' && it.ts > lastStartTs) {
        lastStartTs = it.ts;
      }
    }

    const emitted = new Set(store.get<string[]>('cycle', '_predictionEmittedKeys', []) ?? []);
    const fresh: string[] = [];

    function tryEmit(name: string, key: string, payload: Record<string, unknown>): void {
      if (emitted.has(key)) return;
      fresh.push(key);
      try { events.emit(name, payload); } catch { /* non-fatal */ }
    }

    // 1) period_approaching · 5 days before predicted period
    {
      const diff = nextTs - now;
      if (diff > 4 * DAY_MS && diff <= 5 * DAY_MS) {
        tryEmit('cycle:period_approaching', `period_approaching:${nextTs}`, {
          predictedTs: nextTs,
          daysUntil: Math.round(diff / DAY_MS),
          ts: now,
        });
      }
    }

    // 2) period_imminent · 1 day before predicted period
    {
      const diff = nextTs - now;
      if (diff > 0 && diff <= DAY_MS) {
        tryEmit('cycle:period_imminent', `period_imminent:${nextTs}`, {
          predictedTs: nextTs,
          ts: now,
        });
      }
    }

    // 3) period_late · 3 days past predicted (and no recent period start)
    {
      const overdueMs = now - nextTs;
      if (overdueMs >= 3 * DAY_MS) {
        const recentStart = lastStartTs > nextTs - DAY_MS;
        if (!recentStart) {
          tryEmit('cycle:period_late', `period_late:${nextTs}`, {
            predictedTs: nextTs,
            daysLate: Math.round(overdueMs / DAY_MS),
            ts: now,
          });
        }
      }
    }

    // 4) luteal_starting · 3 days before luteal phase begins
    {
      const diff = lutealStartTs - now;
      if (diff > 2 * DAY_MS && diff <= 3 * DAY_MS) {
        tryEmit('cycle:luteal_starting', `luteal_starting:${lutealStartTs}`, {
          lutealStartTs,
          daysUntil: Math.round(diff / DAY_MS),
          ts: now,
        });
      }
    }

    // 5) ovulation_imminent · 1 day before (opt-in)
    if (ovulationOptIn) {
      const diff = ovulationTs - now;
      if (diff > 0 && diff <= DAY_MS) {
        tryEmit('cycle:ovulation_imminent', `ovulation_imminent:${ovulationTs}`, {
          ovulationTs,
          ts: now,
        });
      }
    }

    if (fresh.length) {
      // Cap the persisted dedup array (audit #8) — it grew unbounded.
      store.set('cycle', '_predictionEmittedKeys', appendCapped([...emitted], fresh));
    }
  }

  // ── pill-missed detection ────────────────────────────────────────────────
  function emitPillMissed(items: CycleItem[]): void {
    const now = getNow();
    const yesterdayStart = (() => {
      const d = new Date(now); d.setUTCHours(0, 0, 0, 0);
      return d.getTime() - DAY_MS;
    })();
    const todayStart = yesterdayStart + DAY_MS;
    const yesterdayKey = new Date(yesterdayStart).toISOString().slice(0, 10);

    const pillEvents = items.filter(
      (i) => i && (i as { action?: string }).action === 'pill' && typeof i.ts === 'number',
    );
    if (pillEvents.length === 0) return;

    const firstPillTs = pillEvents.reduce((m, p) => Math.min(m, p.ts ?? Infinity), Infinity);
    if (firstPillTs > now - 2 * DAY_MS) return;

    const yLogged = pillEvents.some(
      (p) => typeof p.ts === 'number' && p.ts >= yesterdayStart && p.ts < todayStart,
    );
    if (yLogged) return;

    const emitted = new Set(store.get<string[]>('cycle', '_pillMissedEmittedDates', []) ?? []);
    if (emitted.has(yesterdayKey)) return;

    try {
      events.emit('cycle:pill_missed', {
        missedDate: yesterdayKey,
        ts: now,
      });
    } catch { /* non-fatal */ }
    store.set('cycle', '_pillMissedEmittedDates', appendCapped([...emitted], [yesterdayKey]));
  }

  // ── full recompute ────────────────────────────────────────────────────────
  function recomputeCycle(): void {
    const rawItems = store.get<CycleItem[]>('cycle', 'items', []);
    const pregnant = store.get<boolean>('cycle', 'pregnant', false) === true;
    const pregnancyEndTs = store.get<number | null>('cycle', 'pregnancyEndTs', null);

    // Fresh-start fence: once a pregnancy has ended, the period starts that
    // predate the end belong to a prior reproductive epoch. Drop them so the
    // FIRST period after the end restarts the cycle rather than pairing with a
    // pre-pregnancy start into one absurd ~9-month "late" cycle. Non-start
    // items (symptoms, pills) are kept regardless — only the prediction/
    // boundary spine is fenced.
    const items =
      typeof pregnancyEndTs === 'number'
        ? rawItems.filter(
            (i) => !(i && i.action === 'started' && typeof i.ts === 'number' && i.ts < pregnancyEndTs),
          )
        : rawItems;

    const symptomEvents = items.filter(
      (i) => i && (i.action === 'symptom' || i.action === 'log'),
    );
    const prevCycles = store.get<CycleRecord[]>('cycle', 'cycles', []);

    // While pregnant the period_logged event is irrelevant; still advance the
    // high-water mark so it doesn't fire retroactively on resume. But suppress
    // the emit itself.
    const prevHighTs = store.get<number>('cycle', '_periodLoggedHighTs', 0) ?? 0;
    let highTs = prevHighTs;
    for (const it of items) {
      if (!it || it.action !== 'started' || typeof it.ts !== 'number') continue;
      if (it.ts <= prevHighTs) continue;
      if (!pregnant) {
        try {
          events.emit('cycle:period_logged', {
            ts: it.ts,
            source: (it as { source?: 'user' | 'braindump' | 'import' }).source ?? 'user',
          });
        } catch { /* non-fatal */ }
      }
      if (it.ts > highTs) highTs = it.ts;
    }
    if (highTs > prevHighTs) {
      store.set('cycle', '_periodLoggedHighTs', highTs);
    }

    const cycles = cycle.detectBoundaries(items);

    // Pregnancy pause: cycle is dormant. Prediction is the empty cold-start
    // shape (nextTs null), period/late/missed health flags are cleared, and
    // no prediction/pill events fire. Symptom insights/correlations + stats
    // stay computed (harmless, non-period-predicting) so the surface keeps any
    // historical context.
    const prediction = pregnant
      ? cycle.predictNextPeriod([])
      : cycle.predictNextPeriod(cycles);
    const insights = cycle.findCorrelations(symptomEvents, cycles);
    const lastEdited = store.get<Record<string, number>>('cycle', 'lastEditedByCycle', {}) ?? {};
    const healthFlags = pregnant
      ? []
      : cycle.detectHealthFlags(cycles, symptomEvents, getNow(), lastEdited);

    const stats = cycle.deriveCycleStats(cycles);
    const adherence = pregnant ? { hasIssue: false } : cycle.detectAdherenceIssue(cycles);
    const fertileWin = pregnant ? null : cycle.fertileWindow(cycles);
    const correlations = CORRELATION_TAGS
      .map((tag) => {
        const r = cycle.correlateSymptom(cycles, symptomEvents, tag);
        return r && r.hasPattern ? { tag, ...r } : null;
      })
      .filter(Boolean)
      .slice(0, 2);

    store.set('cycle', 'cycles', cycles);
    store.set('cycle', 'prediction', prediction);
    store.set('cycle', 'insights', insights);
    store.set('cycle', 'healthFlags', healthFlags);
    store.set('cycle', 'stats', stats);
    store.set('cycle', 'adherence', adherence);
    store.set('cycle', 'fertileWindow', fertileWin);
    store.set('cycle', 'correlations', correlations);
    store.set('cycle', 'lastRecomputeAt', getNow());

    recomputeCycleTime(cycles, stats, items, pregnant);

    if (!pregnant) {
      try { emitPredictionEvents(prediction, items); } catch { /* non-fatal */ }
      try { emitPillMissed(items); } catch { /* non-fatal */ }
    }

    if (cycles.length > prevCycles.length) {
      store.set('cycle', 'cycleCount', cycles.length);
    }
  }

  // ── APNs push subscribers ────────────────────────────────────────────────
  function wireCyclePushSubscribers(): void {
    if (!scheduleNotification) return;

    // 1) period_approaching → static deadpan copy
    unsubs.push(events.on('cycle:period_approaching', (raw) => {
      try {
        const p = (raw ?? {}) as { predictedTs?: number };
        if (typeof p.predictedTs !== 'number') return;
        scheduleNotification(
          {
            title: 'period probably this weekend. flagging the calendar.',
            category: 'REMINDER',
            dedupe_key: `cycle:period_approaching:${p.predictedTs}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));

    // 2) period_imminent
    unsubs.push(events.on('cycle:period_imminent', (raw) => {
      try {
        const p = (raw ?? {}) as { predictedTs?: number };
        if (typeof p.predictedTs !== 'number') return;
        scheduleNotification(
          {
            title: 'period due tomorrow. supplies are in your grocery list.',
            category: 'REMINDER',
            dedupe_key: `cycle:period_imminent:${p.predictedTs}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));

    // 3) period_late
    unsubs.push(events.on('cycle:period_late', (raw) => {
      try {
        const p = (raw ?? {}) as { predictedTs?: number; daysLate?: number };
        if (typeof p.predictedTs !== 'number' || typeof p.daysLate !== 'number') return;
        scheduleNotification(
          {
            title: `your period is ${p.daysLate} days late from prediction. just noting.`,
            category: 'PATTERN_ALERT',
            dedupe_key: `cycle:period_late:${p.predictedTs}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));

    // 4) luteal_starting · weekday-substituted
    unsubs.push(events.on('cycle:luteal_starting', (raw) => {
      try {
        const p = (raw ?? {}) as { lutealStartTs?: number };
        if (typeof p.lutealStartTs !== 'number') return;
        const weekday = new Date(p.lutealStartTs).toLocaleString('en-US', {
          weekday: 'long',
          timeZone: 'UTC',
        }).toLowerCase();
        scheduleNotification(
          {
            title: `luteal phase starts ${weekday}. spending tends up 22% for you. energy may dip.`,
            category: 'PATTERN_ALERT',
            dedupe_key: `cycle:luteal_starting:${p.lutealStartTs}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));

    // 5) ovulation_imminent
    unsubs.push(events.on('cycle:ovulation_imminent', (raw) => {
      try {
        const p = (raw ?? {}) as { ovulationTs?: number };
        if (typeof p.ovulationTs !== 'number') return;
        scheduleNotification(
          {
            title: 'ovulation likely tomorrow.',
            category: 'PATTERN_ALERT',
            dedupe_key: `cycle:ovulation_imminent:${p.ovulationTs}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));

    // 6) pill_missed
    unsubs.push(events.on('cycle:pill_missed', (raw) => {
      try {
        const p = (raw ?? {}) as { missedDate?: string };
        if (typeof p.missedDate !== 'string') return;
        scheduleNotification(
          {
            title: 'pill not logged today. yes or no?',
            category: 'REMINDER',
            dedupe_key: `cycle:pill_missed:${p.missedDate}`,
            action_url: '/cycle',
          },
          getNow(),
        );
      } catch { /* non-fatal */ }
    }));
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('cycle', 'items', () => recomputeCycle()));
    unsubs.push(store.subscribeKey('cycle', 'lastEditedByCycle', () => recomputeCycleTime()));

    const tick = setInterval(() => recomputeCycleTime(), 60_000);
    unsubs.push(() => clearInterval(tick));

    wireCyclePushSubscribers();

    recomputeCycle();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    initialized = false;
  }

  return { init, teardown, recomputeCycle };
}
