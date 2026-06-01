/**
 * apps/native · modules/goals/bridge.ts  —  SQLite → @ollie/store mirror
 *
 * The goals Layer-2 watcher (packages/orchestrator/src/goals.ts) reads these
 * store keys; native captures into SQLite (goals/repo.ts) and never wrote
 * them. This fills syncToStore().
 *
 * Store keys the goals watcher reads (written here), with the shapes the
 * orchestrator + logic/goals/types expect:
 *   goals.items    — Goal[] in the watcher's shape:
 *                      { id, title, status:'active', obstacle, premortem,
 *                        ulysses_contract, created_at, target_date_ts? }
 *                    (ALSO read by the habits watcher's keystone-anchor detector.)
 *   goals.sessions — GoalSession[] { ts, goal_id, type } — built from
 *                    'progress' events (type 'doing'). Feeds research-as-progress
 *                    + pacing detectors.
 *   goals.reviews  — GoalReview[] { ts, goal_id, alive_flag } — built from
 *                    'milestone' events (a milestone hit IS a review touch:
 *                    it stamps last_review_ts-style activity).
 *   goals.dumps    — DumpEntry[] { ts, text, rawText } — goal-routed notes the
 *                    router didn't attach to a named goal (unassigned events).
 *                    Feeds obstacle/premortem echo + contagion.
 * (goals.patterns / goals._* are OUTPUT — do NOT touch.)
 *
 * LOW-MOOD DELETE LOCK (verified end-to-end here):
 *   The lock lives in repo.canDelete(), which reads the SQLite `goals_mood_log`
 *   table (fed by repo.recordMoodSignal — itself driven by the dump agent's
 *   bridge/mood.ts → recordMoodFromDump). That path is SQLite-only and entirely
 *   independent of this store mirror, so this syncToStore CANNOT clobber
 *   `goals_mood_log`. We deliberately do NOT touch any mood key here. Once a
 *   mood signal exists, canDelete() locks deletion (allowed:false, reason
 *   'low_mood') and GoalsBox shows the gentle hold surface — see repo.test.ts
 *   ("canDelete locks after ≥3 low-mood signals") for the proven path.
 *
 * Edit ONLY this file.
 */

import type { Store } from '@ollie/store';
import { goals as goalsRepo, events as eventsRepo } from './repo';

interface GoalItem {
  id: string;
  title: string;
  status: 'active';
  obstacle?: string;
  premortem?: string;
  ulysses_contract?: string;
  created_at: number;
  target_date_ts?: number;
}

interface GoalSessionEntry {
  ts: number;
  goal_id: string;
  type: 'doing';
}

interface GoalReviewEntry {
  ts: number;
  goal_id: string;
  alive_flag: 'invested';
}

interface DumpEntryShape {
  ts: number;
  text: string;
  rawText: string;
}

export async function syncToStore(store: Store): Promise<void> {
  const list = await goalsRepo.list();

  // ── goals.items — registry in the watcher's Goal shape ────────────────
  // Every native goal is active (no archive flag — see repo.activeCount), so
  // status is always 'active'. nullable SQLite columns map to undefined so the
  // detectors' `typeof === 'string'` guards behave.
  const items: GoalItem[] = list.map((g) => ({
    id: g.id,
    title: g.name,
    status: 'active',
    obstacle: g.obstacle ?? undefined,
    premortem: g.premortem ?? undefined,
    ulysses_contract: g.ulyssesContract ?? undefined,
    created_at: g.createdAt,
    target_date_ts: g.targetDate ?? undefined,
  }));
  store.set('goals', 'items', items);

  // ── derive sessions / reviews / dumps from the event log ──────────────
  const [progress, milestones, unassigned] = await Promise.all([
    eventsRepo.listByKind('progress', 200),
    eventsRepo.listByKind('milestone', 200),
    eventsRepo.listUnassigned(200),
  ]);

  // goals.sessions — a 'progress' note is a "doing" session toward the goal.
  const sessions: GoalSessionEntry[] = progress
    .filter((e) => e.goalId)
    .map((e) => ({ ts: e.loggedAt, goal_id: e.goalId as string, type: 'doing' }));
  store.set('goals', 'sessions', sessions);

  // goals.reviews — a milestone hit is the closest native signal to a review
  // touch ("still alive / still invested"). Drives the dormancy / sunk-cost
  // checks that key off review recency.
  const reviews: GoalReviewEntry[] = milestones
    .filter((e) => e.goalId)
    .map((e) => ({ ts: e.loggedAt, goal_id: e.goalId as string, alive_flag: 'invested' }));
  store.set('goals', 'reviews', reviews);

  // goals.dumps — goal-routed notes the router couldn't pin to a named goal.
  const dumps: DumpEntryShape[] = unassigned.map((e) => ({
    ts: e.loggedAt,
    text: e.text,
    rawText: e.text,
  }));
  store.set('goals', 'dumps', dumps);
}
