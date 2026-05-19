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
  Meeting,
  ScheduledFocusBlock,
  FocusLogEntry,
  PomodoroBreakState,
} from '@ollie/logic/work';
import type { NotificationSpec } from '@ollie/notifications';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;
const MIN = 60_000;

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
  let pomodoroTimer: ReturnType<typeof setTimeout> | null = null;

  /** Module-instance dedupe — one dispatch per logical cue. */
  const firedCues = new Set<string>();

  function recomputePatterns(): void {
    try {
      const now = getNow();

      const workState: WorkState = {
        tasks:                store.get('work', 'tasks', []) ?? [],
        sessions:             store.get('work', 'sessions', []) ?? [],
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
          store.set('work', '_hyperfocusEmittedIds', [...seenIds, ...fresh]);
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
      let todayCount = 0;
      for (const e of focusLog) {
        if (!e || typeof e.ts !== 'number') continue;
        if (localDayKey(e.ts) === localDayKey(now)) todayCount += 1;

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

      // #7 — four+ focus blocks logged today.
      if (todayCount >= 4) {
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
    if (pomodoroTimer) { clearTimeout(pomodoroTimer); pomodoroTimer = null; }
    firedCues.clear();
    initialized = false;
  }

  return { init, teardown, recomputePatterns, recomputePomodoro, scanCues };
}
