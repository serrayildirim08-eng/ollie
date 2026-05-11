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
} from '@ollie/logic/goals';
import type {
  Goal,
  GoalSession,
  GoalReview,
  DumpEntry,
  GoalsHistory,
  DumpHistory,
} from '@ollie/logic/goals';
import type { Orchestrator } from './types';

const DEBOUNCE_MS = 500;

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

export function createGoalsOrchestrator(
  store: Store,
  {
    now: nowFn,
    getConsent,
  }: { now?: () => number; getConsent?: () => boolean } = {},
): Orchestrator & { recomputePatterns(): void } {
  const getNow = nowFn ?? (() => Date.now());
  const consentFn = getConsent ?? (() => true);

  let initialized = false;
  const unsubs: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recomputePatterns(); }, DEBOUNCE_MS);
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    unsubs.push(store.subscribeKey('goals', 'items', schedule));
    unsubs.push(store.subscribeKey('goals', 'sessions', schedule));
    unsubs.push(store.subscribeKey('goals', 'reviews', schedule));
    unsubs.push(store.subscribeKey('goals', 'dumps', schedule));
    unsubs.push(store.subscribeKey('shared', 'actionLog', schedule));

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
