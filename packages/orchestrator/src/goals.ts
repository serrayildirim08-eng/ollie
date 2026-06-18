/**
 * @ollie/orchestrator · goals
 *
 * Runs G1–G16 goal detectors on boot and whenever relevant store keys
 * change. UI reads `goals.patterns` — it never calls logic directly.
 *
 * All goals detectors take a GoalsHistory object as first arg.
 * We build one history and pass it to each detector.
 *
 * consent gate: defaults to true (pass getConsent to override).
 *
 * Derived keys written (namespace: "goals"):
 *   patterns               flat array merged from all detectors
 *   patternsLastComputedAt timestamp of most recent recompute
 *
 * Subscriptions:
 *   goals.items            → schedule recompute
 *   goals.sessions         → schedule recompute
 *   goals.reviews          → schedule recompute
 *   goals.dumps            → schedule recompute
 *   shared.actionLog       → schedule recompute (contagion from braindump)
 *   void:braindump:submitted event → schedule recompute (goals items, v≥2 guard)
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import {
  detectLowMood,
  detectObstacleEcho,
  detectPreMortemEcho,
  detectActiveCap,
  detectResearchAsProgress,
  detectIdentityDrift,
  detectSunkCostFlag,
  detectPacingBreach,
  detectContagion,
  detectMissingAnchorPair,
  detectFloatingGoal,
  detectMissingConstrual,
  detectAntiGoalOpportunity,
  detectAntiGoalInDump,
  detectGoalInterference,
  detectExperimentCandidate,
  detectGoalVelocityByCategory,
} from '@ollie/logic/goals';
import type {
  Goal,
  GoalSession,
  GoalReview,
  DumpEntry,
  GoalsHistory,
  DumpHistory,
} from '@ollie/logic/goals';
import type { NotificationSpec } from '@ollie/notifications';
import type { Orchestrator } from './types';
// Single canonical UTC-based week key, shared across detectors (#146).
import { isoWeekKey } from './body-weekly';

const DEBOUNCE_MS = 500;
const DAY = 86_400_000;

/** Minimum top/bottom velocity ratio before the gap cue fires. */
export const VELOCITY_GAP_THRESHOLD = 2;

/**
 * Audit-locked goal notification copy. Lowercase, factual. The
 * `weekly_check_in` string uses a typographic apostrophe (’) — keep
 * it byte-for-byte.
 */
export const GOALS_NOTIFICATION_COPY = {
  weekly_check_in: 'goal check-in. it’s been 7 days.',
  velocity_gap: (top: string, bottom: string, mult: number): string =>
    `${top} goals finish ${mult}x faster than ${bottom}. flagging.`,
} as const;

// Normalize signal key to a stable string for dedup.
function signalKey(p: unknown): string {
  const x = p as Record<string, unknown>;
  return String(x?.signal ?? x?.pattern ?? '');
}

// Flatten a single detector result (may be T | T[] | null) into a flat array.
function flatten<T>(r: T | T[] | null): T[] {
  if (r == null) return [];
  if (Array.isArray(r)) return r.filter((x) => x != null);
  return [r];
}

/** UTC calendar-day key (YYYY-MM-DD) for day-scoped dedupe. */
function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export interface GoalsOrchestratorOptions {
  /** Injected for tests; defaults to Date.now */
  now?: () => number;
  /** Pattern-detection consent gate; defaults to true. */
  getConsent?: () => boolean;
  /** APNs / local push scheduler; no-op when omitted. */
  scheduleNotification?: (spec: NotificationSpec, fireAt: number) => void;
}

export function createGoalsOrchestrator(
  store: Store,
  opts: GoalsOrchestratorOptions = {},
): Orchestrator & { recomputePatterns(): void; scanCues(): void } {
  const getNow = opts.now ?? (() => Date.now());
  const consentFn = opts.getConsent ?? (() => true);
  const scheduleNotification = opts.scheduleNotification ?? null;

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cueTimer: ReturnType<typeof setTimeout> | null = null;

  /** Module-instance dedupe — one dispatch per logical cue. */
  const firedCues = new Set<string>();

  function recomputePatterns(): void {
    try {
      const now = getNow();
      const consent = consentFn();

      const goals = store.get<Goal[]>('goals', 'items', []) ?? [];
      const sessions = store.get<GoalSession[]>('goals', 'sessions', []) ?? [];
      const reviews = store.get<GoalReview[]>('goals', 'reviews', []) ?? [];
      const goalDumps = store.get<DumpEntry[]>('goals', 'dumps', []) ?? [];
      const actionLog = store.get<Array<{ ts: number; rawText?: string; undone?: boolean }>>('shared', 'actionLog', []) ?? [];

      // Merge goal-namespaced dumps with braindump action log entries
      const allDumps: DumpEntry[] = [
        ...goalDumps,
        ...actionLog
          .filter((e) => e && !e.undone && typeof e.ts === 'number')
          .map((e) => ({ ts: e.ts, text: e.rawText ?? '', rawText: e.rawText ?? '' })),
      ];

      const history: GoalsHistory = { goals, dumps: allDumps, sessions, reviews, now };
      const dumpHistory: DumpHistory = { dumps: allDumps, now };
      const opts = { consent, now };

      const out: unknown[] = [];

      // G4 — low mood gate
      try { for (const r of flatten(detectLowMood(dumpHistory, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G6 — obstacle echo
      try { for (const r of flatten(detectObstacleEcho(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G7 — premortem echo
      try { for (const r of flatten(detectPreMortemEcho(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G2 — active cap
      try { for (const r of flatten(detectActiveCap(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G5 — research as progress
      try { for (const r of flatten(detectResearchAsProgress(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G11 — identity drift
      try { for (const r of flatten(detectIdentityDrift(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G13 — sunk cost
      try { for (const r of flatten(detectSunkCostFlag(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G14 — pacing breach
      try { for (const r of flatten(detectPacingBreach(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G1 — contagion
      try { for (const r of flatten(detectContagion(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G3 — missing anchor pair
      try { for (const r of flatten(detectMissingAnchorPair(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G8 — floating goal
      try { for (const r of flatten(detectFloatingGoal(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G9 — missing construal
      try { for (const r of flatten(detectMissingConstrual(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G10 — anti-goal opportunity
      try { for (const r of flatten(detectAntiGoalOpportunity(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G10b — anti-goal in dump
      try { for (const r of flatten(detectAntiGoalInDump(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G12 — goal interference
      try { for (const r of flatten(detectGoalInterference(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }
      // G16 — experiment candidate
      try { for (const r of flatten(detectExperimentCandidate(history, opts))) out.push({ ...r, pattern: r.signal }); } catch { /* swallow */ }

      const prev = store.get<unknown[]>('goals', 'patterns', []) ?? [];
      const prevKeys = new Set(
        (Array.isArray(prev) ? prev : []).map(signalKey).filter(Boolean),
      );

      store.set('goals', 'patterns', out);
      store.set('goals', 'patternsLastComputedAt', now);

      for (const p of out) {
        const key = signalKey(p);
        if (key && !prevKeys.has(key)) {
          const x = p as Record<string, unknown>;
          events.emit('goals:pattern_detected', {
            pattern: key,
            confidence: (x.confidence as string | undefined) ?? 'low',
            sample_n: 0,
            ts: now,
          });
        }
      }
    } catch (e) {
      console.error('[orchestrator/goals] recompute failed:', e);
    }
  }

  // ── notification cues ───────────────────────────────────────────────
  // scanCues() inspects goal review/deadline/dormancy state plus the
  // per-category velocity gap, dispatching through scheduleNotification.
  // Each detector is gated by a dedupe key held in `firedCues`.
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
      const consent = consentFn();
      const goals = store.get<Goal[]>('goals', 'items', []) ?? [];

      // #8 weekly_check_in — Sundays only (UTC, deterministic). Fires when
      // at least one active goal was last reviewed >7 days ago.
      if (new Date(now).getUTCDay() === 0) {
        const stale = goals.some(
          (g) =>
            g &&
            g.status === 'active' &&
            typeof g.last_review_ts === 'number' &&
            now - g.last_review_ts > 7 * DAY,
        );
        if (stale) {
          fire({
            title: GOALS_NOTIFICATION_COPY.weekly_check_in,
            category: 'CONTENT_DELIVERY',
            dedupe_key: `goals:weekly_check_in:${utcDayKey(now)}`,
            action_url: '/goals',
          });
        }
      }

      // #9 deadline_30d — active goal with a target date ~30 days out.
      for (const g of goals) {
        if (!g || g.status !== 'active') continue;
        if (typeof g.target_date_ts !== 'number') continue;
        const delta = g.target_date_ts - now;
        if (delta >= 28 * DAY && delta <= 32 * DAY) {
          const progress = typeof g.progress === 'number' ? g.progress : 0;
          const title = g.title ?? g.label ?? '';
          fire({
            title: `goal ${title} target date in 30 days. progress: ${progress}%.`,
            category: 'REMINDER',
            dedupe_key: `goals:deadline_30d:${g.id}`,
            action_url: '/goals',
          });
        }
      }

      // #10 paused_14d — goal paused 14+ days ago.
      for (const g of goals) {
        if (!g || g.status !== 'paused') continue;
        if (typeof g.paused_at !== 'number') continue;
        if (now - g.paused_at >= 14 * DAY) {
          const title = g.title ?? g.label ?? '';
          fire({
            title: `you paused goal ${title} for 14 days. still relevant?`,
            category: 'REMINDER',
            dedupe_key: `goals:paused_14d:${g.id}`,
            action_url: '/goals',
          });
        }
      }

      // velocity gap — per-category completion velocity, top/bottom ratio.
      const velocity = detectGoalVelocityByCategory({ goals, now }, { consent, now });
      if (velocity && velocity.length > 0) {
        const top = velocity[0];
        const gap = top.velocity_gap;
        if (
          typeof gap === 'number' &&
          gap >= VELOCITY_GAP_THRESHOLD &&
          top.top_category &&
          top.bottom_category
        ) {
          fire({
            title: GOALS_NOTIFICATION_COPY.velocity_gap(
              top.top_category,
              top.bottom_category,
              Math.round(gap),
            ),
            category: 'PATTERN_ALERT',
            dedupe_key: `goals:velocity_${top.top_category}_${top.bottom_category}_${isoWeekKey(now)}`,
            action_url: '/goals',
          });
        }
      }
    } catch (e) {
      console.error('[orchestrator/goals] scanCues failed:', e);
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

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('goals', 'items', schedule));
    unsubs.push(store.subscribeKey('goals', 'sessions', schedule));
    unsubs.push(store.subscribeKey('goals', 'reviews', schedule));
    unsubs.push(store.subscribeKey('goals', 'dumps', schedule));
    unsubs.push(store.subscribeKey('shared', 'actionLog', schedule));

    // Cue scan re-runs when goal items change.
    unsubs.push(store.subscribeKey('goals', 'items', scheduleCueScan));

    unsubs.push(
      events.on('void:braindump:submitted', (payload: unknown) => {
        try {
          if (!payload) return;
          const p = payload as { v?: number; items?: Array<{ module?: string }> };
          if (p.v != null && p.v >= 2 && Array.isArray(p.items)) {
            const myItems = p.items.filter((i) => i?.module === 'goals');
            if (myItems.length > 0) schedule();
            return;
          }
          schedule();
        } catch {
          schedule();
        }
      }),
    );

    // Cold start — populate patterns + scan cues immediately.
    schedule();
    scheduleCueScan();
  }

  function teardown(): void {
    unsubs.splice(0).forEach((fn) => fn());
    if (timer) { clearTimeout(timer); timer = null; }
    if (cueTimer) { clearTimeout(cueTimer); cueTimer = null; }
    firedCues.clear();
    initialized = false;
  }

  return { init, teardown, recomputePatterns, scanCues };
}
