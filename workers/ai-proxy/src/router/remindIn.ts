/**
 * remindIn — time-deferred reminder side-effect hint (Approach B).
 *
 * Layer 1 may add an optional `remindIn: { amount, unit }` field to the
 * payload of any action it routes (admin.create_task, admin.create_phone_task,
 * work.create_task, etc — see SYSTEM_PROMPT). The worker then computes a
 * concrete `scheduledAtMs` from that hint BEFORE returning the Fragment to
 * the client, keeping the native handler logic free of clock math.
 *
 * Why server-side: the worker has the authoritative `Date.now()` and the
 * conversion is pure, so we shouldn't make every native handler re-derive
 * it. The handler just reads `scheduledAtMs` and asks the OS to fire a
 * notification then.
 *
 * Sanity guard: drop the hint entirely when `unit === 'day'` AND
 * `amount > 30` — protects against "remind me in 5000 days" style noise the
 * LLM might emit on bad inputs. Logged for observability; the row write
 * still happens, only the scheduled push is skipped.
 *
 * NEVER cached: the `scheduledAtMs` field is injected AFTER cache lookup /
 * Voyage embedding, so a cached classification re-used 3 hours later still
 * gets a fresh timestamp computed against the current clock. The remindIn
 * `{ amount, unit }` shape itself is part of the AI payload and IS cached,
 * which matches the semantics ("remind me to call mama in 1 minute" wants
 * the same 1-minute timer every time it's said).
 */

export type RemindUnit = 'sec' | 'min' | 'hr' | 'day';

export interface RemindInHint {
  amount: number;
  unit: RemindUnit;
}

/** Hint shape AFTER the worker injection — includes the absolute fire-time. */
export interface RemindInResolved extends RemindInHint {
  scheduledAtMs: number;
}

const UNIT_TO_MS: Record<RemindUnit, number> = {
  sec: 1_000,
  min: 60_000,
  hr: 3_600_000,
  day: 86_400_000,
};

/** Sanity ceiling: anything longer than 30 days is almost certainly garbage. */
const MAX_DAYS = 30;

/**
 * Pure helper: convert a `{ amount, unit }` hint into an absolute ms
 * timestamp anchored at `now`. Returns `null` when the input fails sanity
 * checks (unrecognised unit, non-positive amount, or > 30 days), in which
 * case callers should DROP the remindIn entirely rather than schedule it.
 */
export function computeScheduledAt(
  amount: number,
  unit: RemindUnit | string,
  now: number,
): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (!(unit in UNIT_TO_MS)) {
    return null;
  }
  const u = unit as RemindUnit;
  if (u === 'day' && amount > MAX_DAYS) {
    return null;
  }
  return now + amount * UNIT_TO_MS[u];
}

/**
 * Narrow type guard for an unknown payload field. The LLM is asked to emit
 * `{ amount: number, unit: "sec"|"min"|"hr"|"day" }` — we re-check at runtime
 * because Groq's JSON mode does not enforce a schema.
 */
function isRemindInHint(v: unknown): v is RemindInHint {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.amount === 'number' && typeof o.unit === 'string';
}

/**
 * Mutating helper: if `payload.remindIn` is a valid hint, attach
 * `scheduledAtMs` to it. If it fails the guard, REMOVE the hint and return a
 * `dropped` reason so the caller can log it. No-op when the payload does not
 * carry a remindIn field at all.
 *
 * Returns a small status object instead of throwing so the upstream pipeline
 * never fails because of a malformed reminder hint — the primary write
 * (admin task / work task / etc) should always still go through.
 */
export function injectScheduledAt(
  payload: Record<string, unknown>,
  now: number,
):
  | { status: 'absent' }
  | { status: 'injected'; scheduledAtMs: number }
  | { status: 'dropped'; reason: 'bad_shape' | 'out_of_range' } {
  const raw = payload.remindIn;
  if (raw === undefined) return { status: 'absent' };

  if (!isRemindInHint(raw)) {
    delete payload.remindIn;
    return { status: 'dropped', reason: 'bad_shape' };
  }

  const scheduledAtMs = computeScheduledAt(raw.amount, raw.unit, now);
  if (scheduledAtMs === null) {
    delete payload.remindIn;
    return { status: 'dropped', reason: 'out_of_range' };
  }

  (payload.remindIn as RemindInResolved).scheduledAtMs = scheduledAtMs;
  return { status: 'injected', scheduledAtMs };
}
