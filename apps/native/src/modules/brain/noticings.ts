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

import { selectNoticings } from '@ollie/logic/brain';
import type { NoticingCandidate, ScoredNoticing } from '@ollie/logic/brain';
import type { Store } from '@ollie/store';

import { sql } from '../../storage';
import { migrateBrain } from './migrate';
import { listHarmEvents } from './harm';

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
  'cycle', 'medication',
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

/**
 * Recover the situation facts the Sprint-3 copy + action layers need from a raw
 * pattern card: the item names involved + the headline item's days-past. The
 * replenish ("milk") detector carries `items: [{name, days}]`; other detectors
 * that attach an items list work too. Returns null when there's nothing.
 */
function factsOf(p: RawPattern): { items: string[]; days: number | null } | null {
  const list = Array.isArray(p.items) ? p.items : [];
  const items = list
    .map((it) => (it?.name ?? '').toString().trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  const firstDays = list.find((it) => typeof it?.days === 'number')?.days;
  return { items, days: typeof firstDays === 'number' ? firstDays : null };
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
    const [candidates, exclude] = await Promise.all([
      gatherCandidates(store),
      excludedIds(now),
    ]);
    const capacity = store.get<CapacityState>('shared', 'capacity', {})?.level ?? 'medium';
    return selectNoticings(candidates, now, { capacity, excludeIds: exclude });
  } catch (err) {
    console.error('[brain] selectTodaysNoticings failed (non-fatal):', err);
    return [];
  }
}
