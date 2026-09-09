/**
 * apps/native · modules/brain/noticings.ts  —  the selection-discipline wiring
 *
 * Sprint 2. The native half of the cross-life "today" surface:
 *   - GATHER candidates from every noticing source in the @ollie/store
 *     (`<module>.patterns`, `shared.patterns`, the grocery replenish signal,
 *     and the persisted harm events).
 *   - SELECT the top 2–3 via the PURE @ollie/logic/brain selection core,
 *     excluding currently-snoozed + dismissed ids, with the bar raised
 *     moderately when shared.capacity is 'low'.
 *   - PERSIST postpone (snooze) + dismiss in `brain_noticing_state`, and log
 *     every postpone into `brain_deferral_events` as a learning signal.
 *
 * Persistence survives app restarts (SQLite), SUPERSEDING the session-only
 * PatternCards dismissal for this surface. Best-effort throughout: a read
 * failure yields an empty surface rather than throwing into the UI.
 */

import { selectNoticings, copyKindOf } from '@ollie/logic/brain';
import type { NoticingCandidate, ScoredNoticing } from '@ollie/logic/brain';
import type { Store } from '@ollie/store';

import { sql } from '../../storage';
import { migrateBrain } from './migrate';
import { listHarmEvents } from './harm';
import { loadLearnedMap, makeDeferabilityResolver } from './learn';

const DAY_MS = 86_400_000;
/** Default postpone window — a noticing snoozed today comes back tomorrow. */
export const POSTPONE_MS = DAY_MS;

// ─── gather ─────────────────────────────────────────────────────────────────

/**
 * Module namespaces whose orchestrators write a `<ns>.patterns` array. Mirrors
 * the writers in packages/orchestrator (admin/body/goals/grocery/habits/
 * journal/pets/work/sleep/finance). `shared.patterns` is gathered separately.
 */
const PATTERN_NAMESPACES = [
  'admin', 'body', 'goals', 'grocery', 'habits',
  'journal', 'pets', 'work', 'sleep', 'finance',
  'cycle', 'medication', 'chores',
] as const;

/** A tolerant pattern-card row as stored under `<ns>.patterns`. */
interface RawPattern {
  pattern?: string;
  copy?: string;
  body?: string;
  message?: string;
  title?: string;
  category?: string | null;
  module?: string;
  ts?: number;
  /** Time-critical date some detectors attach (deadline / run-out). */
  urgencyAt?: number | null;
  dueAt?: number | string | null;
  dueDate?: number | string | null;
  predictedOutAtMs?: number | null;
  /** Detector-attached item list (replenish/expiration/cascade carry this). */
  items?: Array<{ name?: string; days?: number; count?: number }>;
  [extra: string]: unknown;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function cardCopy(p: RawPattern): string {
  return (p.copy ?? p.body ?? p.message ?? '').toString().trim();
}

/** Coerce a ms-or-date-string into a ms timestamp, or null. */
function toMs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Best-available time-critical date a detector attached, or null. */
function urgencyAtOf(p: RawPattern): number | null {
  return (
    toMs(p.urgencyAt) ??
    toMs(p.dueAt) ??
    toMs(p.dueDate) ??
    toMs(p.predictedOutAtMs)
  );
}

/**
 * Normalise one raw pattern card → a NoticingCandidate. The id is namespaced
 * by module + the detector's stable pattern-id so snooze/dismiss state is
 * stable across recomputes. Returns null when there's no displayable copy.
 */
function toCandidate(p: RawPattern, module: string): NoticingCandidate | null {
  const copy = cardCopy(p);
  if (!copy) return null;
  const detectorId = (p.pattern ?? p.category ?? '').toString().trim();
  const id = `${module}:${detectorId || copy.slice(0, 40)}`;
  return {
    id,
    module,
    copy,
    category: (p.category ?? p.pattern ?? null) as string | null,
    urgencyAt: urgencyAtOf(p),
    createdAt: typeof p.ts === 'number' ? p.ts : null,
    facts: factsOf(p),
  };
}

/** STRING offer fields a detector may attach to a pattern card. */
const OFFER_FACT_KEYS = [
  'actionKind', 'taskText', 'dueDate', 'decisionId', 'decisionWhat',
  // wave 2 — extra string offer facts:
  'taskId', // chronic deferral → the source admin task id (→ sourceTaskId).
  'sourceTaskId', // chronic deferral (synthesized) → same, alternate key.
  'batchLabel', // renewal cluster → the batch block + reminder label.
  'taskModule', // dateless ladder archive → which repo the task lives in.
  'choreId', // chore-due offer → the chores registry id to mark done.
  'choreName', // chore-due offer → the chore name (for copy / traceability).
] as const;

/** ARRAY (string[]) offer fields — wave-2 offers carry id lists. */
const OFFER_FACT_ARRAY_KEYS = [
  'taskIds', // paperwork piling → the stalled admin task ids to surface.
  'renewalIds', // renewal cluster → the renewal ids the block covers.
] as const;

/** NUMERIC offer fields — wave-2 offers carry an absolute fire time. */
const OFFER_FACT_NUMBER_KEYS = [
  'batchFireAtMs', // renewal cluster → when the batch reminder should fire.
] as const;

/**
 * Recover the situation facts the Sprint-3 copy + action layers need from a raw
 * pattern card:
 *   - the item names involved + the headline item's days-past (the replenish
 *     "milk" detector carries `items: [{name, days}]`; the sleep-debt detector
 *     rides its deficit hours in the same `days` slot via a single synthetic
 *     item), AND
 *   - any OFFER fields a C-model detector attached so its noticing can carry an
 *     action (admin renewal → add_admin_task, admin decision → surface_decision):
 *     actionKind / taskText / dueDate / decisionId / decisionWhat.
 *
 * Returns null only when there is NOTHING to carry — i.e. neither item names nor
 * an attached offer action. (A bare offer with no items still yields facts, so
 * the action layer can read its payload — the milk path is unaffected.)
 */
function factsOf(p: RawPattern): Record<string, unknown> | null {
  const list = Array.isArray(p.items) ? p.items : [];
  const items = list
    .map((it) => (it?.name ?? '').toString().trim())
    .filter(Boolean);
  const firstDays = list.find((it) => typeof it?.days === 'number')?.days;

  const offer: Record<string, unknown> = {};
  for (const k of OFFER_FACT_KEYS) {
    const v = (p as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) offer[k] = v.trim();
  }
  // wave 2 — array offer facts (id lists): keep only non-empty trimmed strings.
  for (const k of OFFER_FACT_ARRAY_KEYS) {
    const v = (p as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      const clean = v.map((x) => (x ?? '').toString().trim()).filter(Boolean);
      if (clean.length > 0) offer[k] = clean;
    }
  }
  // wave 2 — numeric offer facts (e.g. an absolute fire time).
  for (const k of OFFER_FACT_NUMBER_KEYS) {
    const v = (p as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) offer[k] = v;
  }
  const hasOffer = Object.keys(offer).length > 0;

  if (items.length === 0 && !hasOffer) return null;
  return {
    items,
    days: typeof firstDays === 'number' ? firstDays : null,
    ...offer,
  };
}

/** Harm-kind → cold-start category the defer map understands. */
function harmCategory(harmKind: string): string {
  // 'missed' (deadline) + 'late' (bill) are protected; 'spoiled' is deferrable.
  return harmKind;
}

function harmCopy(harmKind: string, refKind: string): string {
  switch (harmKind) {
    case 'missed':
      return `a ${refKind} deadline slipped past — want to pick it back up?`;
    case 'late':
      return `a recurring bill looks past its usual date — worth a look?`;
    case 'spoiled':
      return `something in the kitchen probably turned — no rush, just a heads up.`;
    default:
      return `something needs a glance.`;
  }
}

/**
 * Gather every candidate noticing currently in the world: each module's
 * `patterns`, `shared.patterns`, plus the persisted harm events. Returns a
 * flat, normalised list (de-dupe is handled in the pure selector). Never
 * throws.
 */
export async function gatherCandidates(store: Store): Promise<NoticingCandidate[]> {
  const out: NoticingCandidate[] = [];

  // ── per-module + shared pattern arrays ──
  try {
    for (const ns of PATTERN_NAMESPACES) {
      const module = ns === 'journal' ? 'dump' : ns;
      for (const p of asArray<RawPattern>(store.get(ns, 'patterns', []))) {
        const c = p && toCandidate(p, module);
        if (c) out.push(c);
      }
    }
    for (const p of asArray<RawPattern>(store.get('shared', 'patterns', []))) {
      if (!p) continue;
      const module = (p.module ?? 'shared').toString();
      const c = toCandidate(p, module);
      if (c) out.push(c);
    }
  } catch (err) {
    console.error('[brain] gather patterns failed (non-fatal):', err);
  }

  // ── persisted harm events (spoiled / late / missed) ──
  try {
    const harm = await listHarmEvents();
    for (const h of harm) {
      out.push({
        id: `harm:${h.id}`,
        module: h.ref_kind === 'bill' ? 'finance' : h.ref_kind === 'pantry' ? 'grocery' : 'admin',
        copy: harmCopy(h.harm_kind, h.ref_kind),
        category: harmCategory(h.harm_kind),
        // 'missed'/'late' are already-overdue facts → treat as now-urgent so
        // they pull through; 'spoiled' carries no urgency (already happened).
        urgencyAt: h.harm_kind === 'spoiled' ? null : h.detected_at,
        createdAt: h.detected_at,
      });
    }
  } catch (err) {
    console.error('[brain] gather harm failed (non-fatal):', err);
  }

  // NOTE — CHRONIC DEFERRAL (break_down_task offer) is emitted by the admin
  // ORCHESTRATOR (packages/orchestrator/src/admin.ts), not synthesized here: it
  // rides the normal `admin.patterns` → toCandidate pipeline above carrying
  // `actionKind:'break_down_task'` + `taskText` + `taskId`. Keeping it there
  // avoids double-offering the same task from two sources.

  return out;
}

// ─── persisted snooze / dismiss state ───────────────────────────────────────

interface NoticingStateRow {
  noticing_id: string;
  postponed_until_ms: number | null;
  dismissed_at_ms: number | null;
  [col: string]: unknown;
}

/**
 * Ids that must NOT surface right now: permanently dismissed, OR snoozed with
 * an unexpired postpone window. Read from SQLite so it survives app restarts.
 * Best-effort — returns an empty set on any failure.
 */
export async function excludedIds(now: number = Date.now()): Promise<Set<string>> {
  try {
    await migrateBrain();
    const rows = await sql.select<NoticingStateRow>(
      `SELECT noticing_id, postponed_until_ms, dismissed_at_ms
       FROM brain_noticing_state
       WHERE dismissed_at_ms IS NOT NULL
          OR (postponed_until_ms IS NOT NULL AND postponed_until_ms > ?)`,
      [now],
    );
    return new Set(rows.map((r) => r.noticing_id));
  } catch (err) {
    console.error('[brain] excludedIds read failed (non-fatal):', err);
    return new Set();
  }
}

/**
 * POSTPONE / "not now": hide the noticing now, bring it back after the snooze
 * window (default +1 day). NOT lost, NOT a permanent dismiss. Also logs the
 * postpone into brain_deferral_events as a learning signal — she chose to
 * defer this KIND of thing. Best-effort; never throws into the UI.
 */
export async function postponeNoticing(
  noticing: { id: string; module?: string; category?: string | null },
  now: number = Date.now(),
  windowMs: number = POSTPONE_MS,
): Promise<void> {
  const until = now + windowMs;
  try {
    await migrateBrain();
    await sql.execute(
      `INSERT INTO brain_noticing_state (noticing_id, postponed_until_ms, dismissed_at_ms)
       VALUES (?, ?, NULL)
       ON CONFLICT(noticing_id) DO UPDATE SET postponed_until_ms = excluded.postponed_until_ms`,
      [noticing.id, until],
    );
    // Deferral signal — append-only, one row per postpone.
    await sql.execute(
      `INSERT INTO brain_deferral_events (noticing_id, module, category, deferred_at, until_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [noticing.id, noticing.module ?? null, noticing.category ?? null, now, until],
    );
  } catch (err) {
    console.error('[brain] postponeNoticing failed (non-fatal):', err);
  }
}

/**
 * DISMISS / "no thanks": permanently remove the noticing from the surface. A
 * harder gesture than postpone — it never resurfaces. NOT recorded as a
 * deferral signal (a dismiss is a rejection, not a deferral). Best-effort.
 */
export async function dismissNoticing(
  noticingId: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    await migrateBrain();
    await sql.execute(
      `INSERT INTO brain_noticing_state (noticing_id, postponed_until_ms, dismissed_at_ms)
       VALUES (?, NULL, ?)
       ON CONFLICT(noticing_id) DO UPDATE SET dismissed_at_ms = excluded.dismissed_at_ms`,
      [noticingId, now],
    );
  } catch (err) {
    console.error('[brain] dismissNoticing failed (non-fatal):', err);
  }
}

/** Count of recorded postpones (deferral signals). For tests / introspection. */
export async function countDeferralEvents(): Promise<number> {
  try {
    await migrateBrain();
    const rows = await sql.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM brain_deferral_events`,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

// ─── the selection ──────────────────────────────────────────────────────────

/** Capacity read shape mirrored to `shared.capacity` by Sprint 1. */
interface CapacityState {
  level?: 'low' | 'medium' | 'high';
}

/**
 * THE cross-life selection. Gather → exclude snoozed/dismissed → select the
 * top 2–3 above the capacity-adjusted bar. Returns the scored noticings the
 * surface should render (≤ 3, possibly 0). Never throws.
 */
export async function selectTodaysNoticings(
  store: Store,
  now: number = Date.now(),
): Promise<ScoredNoticing[]> {
  try {
    const [candidates, exclude, learnedMap] = await Promise.all([
      gatherCandidates(store),
      excludedIds(now),
      // Sprint 4 — the per-person learned map (verdicts + pins). Cheap read of a
      // persisted snapshot (recomputed on boot / after dump, not here). An empty
      // map → pure cold-start behaviour, which is correct cold-start.
      loadLearnedMap(),
    ]);
    const capacity = store.get<CapacityState>('shared', 'capacity', {})?.level ?? 'medium';
    const selected = selectNoticings(candidates, now, {
      capacity,
      excludeIds: exclude,
      // USER PIN > learned (if confident) > cold-start, applied per candidate.
      resolveDeferability: makeDeferabilityResolver(learnedMap),
    });
    // Drop "generic" noise: a candidate whose category maps to no specific copy
    // kind would only ever render the vague fallback ("something might be worth
    // a glance") — that's not worth a card. Keep one only if it carries a real
    // offered action (then the fallback copy + an accept affordance is useful).
    return selected.filter((n) => {
      if (copyKindOf({ category: n.category, module: n.module }) !== 'generic') return true;
      const ak = (n.facts as { actionKind?: unknown } | null | undefined)?.actionKind;
      return typeof ak === 'string' && ak.length > 0;
    });
  } catch (err) {
    console.error('[brain] selectTodaysNoticings failed (non-fatal):', err);
    return [];
  }
}
