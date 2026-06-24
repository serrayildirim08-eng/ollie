/**
 * @ollie/orchestrator · work
 *
 * Fires W0-W17 work detectors on boot and whenever relevant store keys
 * change. UI reads `work.patterns` — it never calls logic directly.
 *
 * Derived keys written (namespace: "work"):
 *   patterns               AnyWorkPattern[] from detectPatterns
 *   patternsLastComputedAt timestamp of most recent recompute
 *   pomodoro               PomodoroBreakState — completed-block cycle +
 *                          earned-break math derived from work.focus_log
 *
 * Subscriptions:
 *   work.tasks             → schedule recompute
 *   work.sessions          → schedule recompute
 *   work.focus_log         → schedule recompute (UI source of truth;
 *                            projected into sessions slice for detectors)
 *   work.meetings          → schedule recompute
 *   work.shutdown_log      → schedule recompute
 *   work.triage_days       → schedule recompute
 *   work.estimation_log    → schedule recompute
 *   work.crash_log         → schedule recompute
 *   work.tab_reports       → schedule recompute
 *   work.notification_tax_log → schedule recompute
 *   work.multitask_log     → schedule recompute
 *   work.rsd_anchor_log    → schedule recompute
 *   sleep.records          → schedule recompute (sleep pacing)
 *   void:braindump:submitted event → schedule recompute (work items, v≥2 guard)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import { detectPatterns, computePomodoroBreakState } from '@ollie/logic/work';
import type {
  AnyWorkPattern,
  WorkState,
  WorkSession,
  Meeting,
  ScheduledFocusBlock,
  FocusLogEntry,
  PomodoroBreakState,
} from '@ollie/logic/work';
import type { NotificationSpec } from '@ollie/notifications';
import type { Orchestrator } from './types';
import { appendCapped } from './dedup-store';

const DEBOUNCE_MS = 500;
const MIN = 60_000;

/**
 * Clock-tick cadence for the cue scan (audit #8). The narrow time-windowed
 * cues — meeting_30m (28–32m, a 4-min window), session_end (~3 min),
 * session_90_warn (85–90m, a 5-min window) — only fired when a store key
 * happened to change inside the window, so they were effectively never
 * delivered. A 60s foreground tick re-evaluates the windows independently
 * of store writes, mirroring cycle.ts's recomputeCycleTime tick. 60s is well
 * under the narrowest 3-min window, so each window is sampled ≥2×.
 */
const CUE_TICK_MS = 60_000;

/**
 * Audit-locked work notification copy. Lowercase, factual, no streak
 * guilt — see CLAUDE.md "Notification Scope". `session_90_warn` uses a
 * typographic apostrophe (’) on purpose; keep it byte-for-byte.
 */
export const WORK_NOTIFICATION_COPY = {
  upcoming_block: 'focus block in 15 min. or skip. either.',
  session_end: '25 min done. 5 min stretch.',
  session_90_warn: '90-min block ends in 5. wind down what you’re on.',
  meeting_30m: 'meeting in 30 min. take a breath.',
  four_blocks_today: 'you’ve had 4 focus blocks today. body says rest.',
} as const;

export interface WorkOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** APNs / local push scheduler; no-op when omitted. */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

/** 12-hour clock label, no leading zero, e.g. "10am" / "3pm". */
function hourLabel(ts: number): string {
  const d = new Date(ts);
  const h24 = d.getHours();
  const period = h24 < 12 ? 'am' : 'pm';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}${period}`;
}

/** "today" / "tomorrow" relative to `now`, local-date compared. */
function dayWord(ts: number, now: number): string {
  const a = new Date(ts);
  const b = new Date(now);
  const aKey = `${a.getFullYear()}-${a.getMonth()}-${a.getDate()}`;
  const bKey = `${b.getFullYear()}-${b.getMonth()}-${b.getDate()}`;
  if (aKey === bKey) return 'today';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tKey = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;
  return aKey === tKey ? 'tomorrow' : 'today';
}

/** Local calendar-day key (YYYY-M-D) for dedupe scoping. */
function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Adapt completed focus_log entries (UI source of truth) into the
 * WorkSession shape the W0/W1/W3 detectors read.
 *
 * work.focus_log is mirrored from the native FocusTimer's SQLite
 * work_events on every sync (apps/native/src/modules/work/bridge.ts —
 * runs on boot + after each dump dispatch); nothing writes to
 * work.sessions on native. Before that bridge, detectors saw an empty
 * sessions array and never matched. Now we project focus_log → sessions
 * at orchestrator-boundary so the existing detector contracts stay
 * pure (still keyed off state.sessions).
 */
function focusLogToSessions(log: FocusLogEntry[]): WorkSession[] {
  const out: WorkSession[] = [];
  for (const e of log) {
    if (!e || typeof e.ts !== 'number') continue;
    const dur =
      typeof e.duration_min === 'number' && e.duration_min > 0 ? e.duration_min : null;
    const elapsedMs = typeof e.duration_ms === 'number' && e.duration_ms > 0 ? e.duration_ms : null;
    out.push({
      id: `focus:${e.ts}`,
      at: e.ts,
      start: e.ts,
      end: e.ts + (elapsedMs ?? (dur ?? 0) * 60_000),
      duration_min: dur ?? (elapsedMs ? elapsedMs / 60_000 : 0),
    });
  }
  return out;
}

export function createWorkOrchestrator(
  store: Store,
  opts: WorkOrchestratorOptions = {},
): Orchestrator & {
  recomputePatterns(): void;
  recomputePomodoro(): void;
  scanCues(): void;
} {
  const getNow = opts.now ?? (() => Date.now());
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cueTimer: ReturnType<typeof setTimeout> | null = null;
  let cueTick: ReturnType<typeof setInterval> | null = null;
  let pomodoroTimer: ReturnType<typeof setTimeout> | null = null;

  // Persisted cue dedupe (audit #96). The in-memory Set gives fast lookups
  // within an instance; it is seeded from — and written back to — the store
  // so a process restart does not re-fire cues that already went out. Keys
  // embed a timestamp or record id, so appendCapped eviction is safe.
  const firedCues = new Set<string>(
    store.get<string[]>('work', '_firedCueKeys', []) ?? [],
  );

  function recomputePatterns(): void {
    try {
      const now = getNow();

      // The native bridge mirrors completed focus sessions (SQLite
      // work_events) into work.focus_log. Detectors read state.sessions.
      // Project the former into the latter at this boundary so legacy seeded
      // `work.sessions` data still works AND real captured activity drives the
      // detectors.
      const rawSessions = store.get<WorkSession[]>('work', 'sessions', []) ?? [];
      const rawFocusLog = store.get<FocusLogEntry[]>('work', 'focus_log', []) ?? [];
      const sessions: WorkSession[] = [...rawSessions, ...focusLogToSessions(rawFocusLog)];

      const workState: WorkState = {
        tasks:                store.get('work', 'tasks', []) ?? [],
        sessions,
        meetings:             store.get('work', 'meetings', []) ?? [],
        recurring_meetings:   store.get('work', 'recurring_meetings', []) ?? [],
        shutdown_log:         store.get('work', 'shutdown_log', []) ?? [],
        triage_days:          store.get('work', 'triage_days', []) ?? [],
        estimation_log:       store.get('work', 'estimation_log', []) ?? [],
        meeting_buffer:       store.get('work', 'meeting_buffer', undefined) ?? undefined,
        one_more_thing_log:   store.get('work', 'one_more_thing_log', []) ?? [],
        crash_log:            store.get('work', 'crash_log', []) ?? [],
        tab_reports:          store.get('work', 'tab_reports', []) ?? [],
        notification_tax_log: store.get('work', 'notification_tax_log', []) ?? [],
        multitask_log:        store.get('work', 'multitask_log', []) ?? [],
        rsd_anchor_log:       store.get('work', 'rsd_anchor_log', []) ?? [],
      };

      const sleepRecords = store.get<Array<{ hours?: number }>>('sleep', 'records', []) ?? [];
      const lastSleep = sleepRecords.length > 0 ? sleepRecords[sleepRecords.length - 1] : null;
      const sleepHours = typeof lastSleep?.hours === 'number' ? lastSleep.hours : null;

      const prev = store.get<AnyWorkPattern[]>('work', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => p?.pattern).filter(Boolean),
      );

      const patterns = detectPatterns(workState, {
        consent: true,
        now,
        sleep: sleepHours !== null ? { hours: sleepHours } : null,
      });

      store.set('work', 'patterns', patterns);
      store.set('work', 'patternsLastComputedAt', now);

      // Credibility audit NC2: hyperfocus = a single sustained session
      // ≥ 3h (180 min) inside the focus log within the last 24h. Emit
      // once per session id; cross-module router routes to body
      // fatigue-warning surface.
      try {
        const focusLog = store.get<Array<{ ts?: number; duration_ms?: number }>>('work', 'focus_log', []) ?? [];
        const cutoff = now - 24 * 3600_000;
        const seenIds = new Set(store.get<string[]>('work', '_hyperfocusEmittedIds', []) ?? []);
        const fresh: string[] = [];
        for (const s of focusLog) {
          if (!s?.ts || !s.duration_ms) continue;
          if (s.ts < cutoff) continue;
          const minutes = s.duration_ms / 60_000;
          if (minutes < 180) continue;
          const id = `${s.ts}`;
          if (seenIds.has(id)) continue;
          events.emit('work:hyperfocus_detected', { minutes: Math.round(minutes), ts: s.ts });
          fresh.push(id);
        }
        if (fresh.length) {
          // Cap the persisted dedup array (audit #8) — it grew unbounded.
          store.set('work', '_hyperfocusEmittedIds', appendCapped([...seenIds], fresh));
        }
      } catch { /* non-fatal */ }

      if (Array.isArray(patterns)) {
        for (const p of patterns) {
          if (p?.pattern && !prevKeys.has(p.pattern)) {
            events.emit('work:pattern_detected', {
              pattern: p.pattern,
              confidence: (p as { confidence?: string }).confidence ?? 'low',
              sample_n: (p as { sample_n?: number }).sample_n ?? 0,
              ts: now,
            });
          }
        }
      }
    } catch (e) {
      console.error('[orchestrator/work] recompute failed:', e);
    }
  }

  /**
   * Phase 3 feature 2 — pomodoro break tracking.
   *
   * Derives the completed-focus-block cycle from work.focus_log and
   * writes it to work.pomodoro for the UI to read. Recomputed whenever
   * focus_log changes (same source key as the cue scan). Independent of
   * recomputePatterns — pomodoro is not a pattern, it is live state.
   */
  function recomputePomodoro(): void {
    try {
      const now = getNow();
      const focusLog = store.get<FocusLogEntry[]>('work', 'focus_log', []) ?? [];
      const state: PomodoroBreakState = computePomodoroBreakState(focusLog, { now });
      store.set('work', 'pomodoro', state);
      store.set('work', 'pomodoroLastComputedAt', now);
    } catch (e) {
      console.error('[orchestrator/work] pomodoro recompute failed:', e);
    }
  }

  // ── notification cues ───────────────────────────────────────────────
  // scanCues() inspects upcoming/just-finished work events and dispatches
  // through scheduleNotification. Each detector is gated by a dedupe key
  // held in `firedCues` so repeated scans never double-fire.
  function fire(spec: NotificationSpec): void {
    if (!scheduleNotification) return;
    if (firedCues.has(spec.dedupe_key)) return;
    firedCues.add(spec.dedupe_key);
    store.set('work', '_firedCueKeys', appendCapped([...firedCues], [spec.dedupe_key]));
    try {
      scheduleNotification(spec, getNow());
    } catch { /* non-fatal */ }
  }

  function scanCues(): void {
    if (!scheduleNotification) return;
    try {
      const now = getNow();

      // #5 meeting_30m — meeting starting in ~30 min (28–32 window).
      const meetings = store.get<Meeting[]>('work', 'meetings', []) ?? [];
      for (const m of meetings) {
        if (!m || typeof m.start_at !== 'number') continue;
        const id = m.id ?? `${m.start_at}`;
        const delta = m.start_at - now;
        if (delta >= 28 * MIN && delta <= 32 * MIN) {
          fire({
            title: WORK_NOTIFICATION_COPY.meeting_30m,
            category: 'REMINDER',
            dedupe_key: `work:meeting_30m:${id}`,
            action_url: '/work',
          });
        }
      }

      // #1 upcoming_block (≤20 min) + #4 deep_work_tomorrow (20–90 min).
      const blocks = store.get<ScheduledFocusBlock[]>('work', 'scheduled_blocks', []) ?? [];
      for (const b of blocks) {
        if (!b || typeof b.start_at !== 'number') continue;
        if (b.cancelled_at) continue;
        const delta = b.start_at - now;
        if (delta > 0 && delta <= 20 * MIN) {
          fire({
            title: WORK_NOTIFICATION_COPY.upcoming_block,
            category: 'REMINDER',
            dedupe_key: `work:focus_block_upcoming:${b.id}`,
            action_url: '/work',
          });
        } else if (delta > 20 * MIN && delta <= 90 * MIN) {
          fire({
            title: `deep work ${dayWord(b.start_at, now)} ${hourLabel(b.start_at)}. heads up.`,
            category: 'REMINDER',
            dedupe_key: `work:deep_work_tomorrow:${b.id}`,
            action_url: '/work',
          });
        }
      }

      // focus_log → #2 session_end, #3 session_90_warn, #7 four_blocks_today.
      const focusLog = store.get<FocusLogEntry[]>('work', 'focus_log', []) ?? [];
      // Count DISTINCT entries by ts (audit #159). A single session can be
      // re-logged (duplicate entry, same ts) — counting raw rows would let
      // four_blocks_today fire on fewer than four real sessions. The ts is the
      // session's identity, mirroring the hyperfocus loop's per-ts dedupe.
      const todaySessionTs = new Set<number>();
      for (const e of focusLog) {
        if (!e || typeof e.ts !== 'number') continue;
        if (localDayKey(e.ts) === localDayKey(now)) todaySessionTs.add(e.ts);

        const sinceStart = now - e.ts;

        if (e.duration_min === 90) {
          // #3 — 90-min running session, 5 min before the 90-min mark.
          if (sinceStart >= 85 * MIN && sinceStart < 90 * MIN) {
            fire({
              title: WORK_NOTIFICATION_COPY.session_90_warn,
              category: 'REMINDER',
              dedupe_key: `work:session_90_warn:${e.ts}`,
              action_url: '/work',
            });
          }
          // 90-min session only counts as "ended" once it has actually run 90 min.
          if (sinceStart >= 90 * MIN && sinceStart <= 93 * MIN) {
            fire({
              title: WORK_NOTIFICATION_COPY.session_end,
              category: 'CONTENT_DELIVERY',
              dedupe_key: `work:session_end:${e.ts}`,
              action_url: '/work',
            });
          }
        } else {
          // #2 — non-90 session that just ended (within last ~3 min).
          const endTime = e.ts + e.duration_min * MIN;
          const sinceEnd = now - endTime;
          if (sinceEnd >= 0 && sinceEnd <= 3 * MIN) {
            fire({
              title: WORK_NOTIFICATION_COPY.session_end,
              category: 'CONTENT_DELIVERY',
              dedupe_key: `work:session_end:${e.ts}`,
              action_url: '/work',
            });
          }
        }
      }

      // #7 — four+ distinct focus blocks logged today.
      if (todaySessionTs.size >= 4) {
        fire({
          title: WORK_NOTIFICATION_COPY.four_blocks_today,
          category: 'PATTERN_ALERT',
          dedupe_key: `work:four_blocks_today:${localDayKey(now)}`,
          action_url: '/work',
        });
      }
    } catch (e) {
      console.error('[orchestrator/work] scanCues failed:', e);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  function scheduleCueScan(): void {
    if (cueTimer) clearTimeout(cueTimer);
    cueTimer = setTimeout(() => { cueTimer = null; scanCues(); }, DEBOUNCE_MS);
  }

  function schedulePomodoro(): void {
    if (pomodoroTimer) clearTimeout(pomodoroTimer);
    pomodoroTimer = setTimeout(() => { pomodoroTimer = null; recomputePomodoro(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('work', 'tasks', schedule));
    unsubs.push(store.subscribeKey('work', 'sessions', schedule));
    // focus_log is the UI's source of truth for completed focus sessions;
    // detectors project it into the sessions slice (see focusLogToSessions).
    unsubs.push(store.subscribeKey('work', 'focus_log', schedule));
    unsubs.push(store.subscribeKey('work', 'meetings', schedule));
    unsubs.push(store.subscribeKey('work', 'shutdown_log', schedule));
    unsubs.push(store.subscribeKey('work', 'triage_days', schedule));
    unsubs.push(store.subscribeKey('work', 'estimation_log', schedule));
    unsubs.push(store.subscribeKey('work', 'crash_log', schedule));
    unsubs.push(store.subscribeKey('work', 'tab_reports', schedule));
    unsubs.push(store.subscribeKey('work', 'notification_tax_log', schedule));
    unsubs.push(store.subscribeKey('work', 'multitask_log', schedule));
    unsubs.push(store.subscribeKey('work', 'rsd_anchor_log', schedule));
    unsubs.push(store.subscribeKey('sleep', 'records', schedule));

    // Cue scan re-runs when the cue source keys change.
    unsubs.push(store.subscribeKey('work', 'meetings', scheduleCueScan));
    unsubs.push(store.subscribeKey('work', 'scheduled_blocks', scheduleCueScan));
    unsubs.push(store.subscribeKey('work', 'focus_log', scheduleCueScan));

    // Clock tick (audit #8). Store-key changes alone never land inside the
    // narrow cue windows (meeting_30m, session_end, session_90_warn), so the
    // tick re-evaluates them on wall-clock time. scanCues is idempotent
    // (firedCues dedupe), so re-running it costs nothing once a cue has fired.
    cueTick = setInterval(() => scanCues(), CUE_TICK_MS);

    // Pomodoro break state recomputes whenever the focus log changes.
    unsubs.push(store.subscribeKey('work', 'focus_log', schedulePomodoro));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'work');
            if (myItems.length > 0) schedule();
            return;
          }
          schedule();
        } catch {
          schedule();
        }
      }),
    );

    // Cold start — populate patterns + pomodoro + scan cues immediately.
    schedule();
    scheduleCueScan();
    schedulePomodoro();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    if (cueTimer) { clearTimeout(cueTimer); cueTimer = null; }
    if (cueTick) { clearInterval(cueTick); cueTick = null; }
    if (pomodoroTimer) { clearTimeout(pomodoroTimer); pomodoroTimer = null; }
    firedCues.clear();
    initialized = false;
  }

  return { init, teardown, recomputePatterns, recomputePomodoro, scanCues };
}
