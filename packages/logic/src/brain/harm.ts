/**
 * @ollie/logic · brain · harm-of-deferral detection
 *
 * The key learning fuel: detect when letting something slide caused REAL
 * harm, derived automatically from world-facts vs outcomes. Pure detection —
 * no I/O, no clock reads (the caller passes `now`). The native writer persists
 * the emitted events into the `brain_harm_events` table.
 *
 * Three harm kinds, one per domain:
 *   - 'spoiled': a pantry item is past its predicted run-out AND still
 *     unarchived → it (probably) spoiled in place.
 *   - 'late':    a recurring bill is past the next expected cycle from when
 *     it was last seen → (probably) paid late / missed a cycle.
 *   - 'missed':  a task / goal / renewal whose deadline passed while it's
 *     still undone → the deadline was missed.
 *
 * Each emitted HarmEvent is identity-stable: the same lapse re-detected
 * yields the same `id` (`{kind}:{refKind}:{refId}`) so the writer can dedupe
 * and never double-count one spoilage. This is OBSERVATION, not blame — there
 * is no copy and no severity here; downstream surfaces stay calm.
 */

const DAY_MS = 86_400_000;

export type HarmKind = 'spoiled' | 'late' | 'missed';

export interface HarmEvent {
  /** Stable id: `{harmKind}:{refKind}:{refId}` — dedupes re-detections. */
  id: string;
  /** The domain row kind, e.g. 'pantry' | 'bill' | 'task' | 'goal' | 'renewal'. */
  refKind: string;
  /** The domain row id. */
  refId: string;
  harmKind: HarmKind;
  /** ms-since-epoch the harm was detected (= the `now` passed in). */
  detectedAt: number;
}

// ─── inputs (tolerant subsets of the real rows) ──────────────────────────

export interface HarmPantryItem {
  id: string;
  name?: string;
  predictedOutAtMs?: number | null;
  archived?: boolean;
}

export interface HarmBill {
  id: string;
  merchant?: string;
  /** ms-since-epoch the bill was last added/seen — the cycle anchor. */
  addedAt: number;
  /** 'weekly' | 'monthly' | 'yearly' | … — drives the expected cycle length. */
  cadence?: string | null;
  /** True when this cycle is already settled (suppresses 'late'). */
  paid?: boolean;
}

export interface HarmDeadlineItem {
  id: string;
  /** Row kind for the ref, e.g. 'task' | 'goal' | 'renewal'. */
  refKind: string;
  /** ms timestamp OR ISO/date string; null → no deadline → never 'missed'. */
  dueDate?: number | string | null;
  done?: boolean;
}

export interface HarmInputs {
  pantry?: HarmPantryItem[];
  bills?: HarmBill[];
  deadlines?: HarmDeadlineItem[];
}

// ─── helpers ─────────────────────────────────────────────────────────────

const CADENCE_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  annually: 365,
  annual: 365,
};

function cadenceDays(cadence: string | null | undefined): number | null {
  if (!cadence) return null;
  const days = CADENCE_DAYS[cadence.toLowerCase().trim()];
  return typeof days === 'number' ? days : null;
}

function toMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function harmId(harmKind: HarmKind, refKind: string, refId: string): string {
  return `${harmKind}:${refKind}:${refId}`;
}

// ─── detection ───────────────────────────────────────────────────────────

/**
 * Detect all harm-of-deferral events across the supplied world-facts. Pure
 * and never throws. Returns a flat, deduped list (stable ids) sorted for
 * deterministic output. The caller persists these via the native writer.
 */
export function detectHarm(inputs: HarmInputs, now: number): HarmEvent[] {
  const out: HarmEvent[] = [];
  if (!Number.isFinite(now) || now <= 0) return out;

  // ── spoiled: pantry past predicted run-out, still unarchived ──────────
  for (const p of inputs.pantry ?? []) {
    if (!p || !p.id) continue;
    if (p.archived === true) continue;
    const out_at = p.predictedOutAtMs;
    if (typeof out_at !== 'number' || !Number.isFinite(out_at)) continue;
    if (out_at > now) continue;
    out.push({
      id: harmId('spoiled', 'pantry', p.id),
      refKind: 'pantry',
      refId: p.id,
      harmKind: 'spoiled',
      detectedAt: now,
    });
  }

  // ── late: recurring bill past its next expected cycle, unsettled ───────
  for (const b of inputs.bills ?? []) {
    if (!b || !b.id) continue;
    if (b.paid === true) continue;
    if (!Number.isFinite(b.addedAt)) continue;
    const days = cadenceDays(b.cadence);
    if (days == null) continue; // one-off / unknown cadence → can't be "late"
    const dueBy = b.addedAt + days * DAY_MS;
    if (dueBy > now) continue;
    out.push({
      id: harmId('late', 'bill', b.id),
      refKind: 'bill',
      refId: b.id,
      harmKind: 'late',
      detectedAt: now,
    });
  }

  // ── missed: task/goal/renewal whose deadline passed while undone ───────
  for (const d of inputs.deadlines ?? []) {
    if (!d || !d.id) continue;
    if (d.done === true) continue;
    const dueMs = toMs(d.dueDate);
    if (dueMs == null || dueMs >= now) continue;
    const refKind = d.refKind || 'task';
    out.push({
      id: harmId('missed', refKind, d.id),
      refKind,
      refId: d.id,
      harmKind: 'missed',
      detectedAt: now,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
