/**
 * @ollie/logic · medication (E1 + E7)
 *
 * One module covers both prescription meds and supplements/vitamins —
 * vitamins are just medications tagged kind:'vitamin'. Pure logic. No
 * store, no events, no wall-clock — `now` injected by callers.
 *
 * Constitutional voice rules:
 *   - "noted." not "great job!"
 *   - NO streaks. adherence is observation, not gamification.
 *   - drift is named, not shamed. cite the principle.
 */

export type MedicationKind = 'prescription' | 'vitamin' | 'supplement' | 'otc';

export interface MedicationItem {
  id: string;
  name: string;
  dose?: string;                  // free text: "500mg", "2 capsules"
  kind: MedicationKind;
  /** Daily times in HH:mm 24h local. Empty = manual log only. */
  schedule: string[];
  /** Hex like "#C97B4B" — pill color used in the UI tile. */
  color_hex?: string;
  /** Append-only log of taken events. */
  taken: Array<{ date: string; time: string; ts: number }>;
  /** ISO ts of when item was added. */
  created_at: number;
  /** Optional notes. */
  notes?: string;
  archived?: boolean;
}

export interface MedicationState {
  items: MedicationItem[];
}

// ──────────────────────────────────────────────────────────────────────────
// daily-state helpers
// ──────────────────────────────────────────────────────────────────────────

export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Has the user logged this medication at least once today? */
export function takenToday(item: MedicationItem, now: number): boolean {
  const date = isoDate(now);
  return (item.taken ?? []).some((t) => t.date === date);
}

/** How many doses on the schedule have been logged today. */
export function takenCountToday(item: MedicationItem, now: number): number {
  const date = isoDate(now);
  return (item.taken ?? []).filter((t) => t.date === date).length;
}

/** Doses still expected today (schedule minus logged). */
export function dosesRemainingToday(item: MedicationItem, now: number): number {
  const sched = item.schedule?.length ?? 0;
  if (sched === 0) return 0;
  const count = takenCountToday(item, now);
  return Math.max(0, sched - count);
}

// ──────────────────────────────────────────────────────────────────────────
// time-based nudge
// ──────────────────────────────────────────────────────────────────────────

/**
 * For each schedule slot today, return the slot ts AND whether it's
 * overdue (now > slot + grace) without a matching log. Used by the
 * cron + foreground nudge.
 *
 * grace: minutes after slot before we consider it a miss. Default 30.
 */
export interface DueSlot {
  item_id: string;
  slot_hhmm: string;
  slot_ts: number;
  overdue: boolean;
}

export function dueSlotsToday(
  item: MedicationItem,
  now: number,
  graceMinutes = 30,
): DueSlot[] {
  if (item.archived) return [];
  const today = startOfDay(now);
  const out: DueSlot[] = [];
  for (const hhmm of item.schedule ?? []) {
    const slotTs = parseHHmmOn(today, hhmm);
    if (slotTs == null) continue;
    const date = isoDate(slotTs);
    const matched = (item.taken ?? []).some((t) => {
      if (t.date !== date) return false;
      const tts = Date.parse(`${t.date}T${t.time}`);
      // Match by being within the same slot window.
      return Math.abs(tts - slotTs) < 60 * 60 * 1000;
    });
    out.push({
      item_id: item.id,
      slot_hhmm: hhmm,
      slot_ts: slotTs,
      overdue: !matched && now > slotTs + graceMinutes * 60_000,
    });
  }
  return out;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseHHmmOn(dayStartTs: number, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return dayStartTs + h * 3600_000 + mn * 60_000;
}

// ──────────────────────────────────────────────────────────────────────────
// adherence drift detector
// ──────────────────────────────────────────────────────────────────────────

/**
 * Across the last `windowDays` (default 14), what fraction of expected
 * doses were actually logged? Returns null when the item has no schedule
 * (manual-only — we can't measure adherence).
 *
 * Fires `drift` when ratio falls below `threshold` (default 0.5) AND
 * the window has been observed for at least 14 days.
 *
 * Constitutional voice: surface as "you've logged X of Y this fortnight.
 * not shaming — just naming." NEVER "you missed!"
 */
export interface AdherenceReport {
  ratio: number;                 // 0..1
  logged: number;
  expected: number;
  windowDays: number;
  drift: boolean;
  copy: string;
}

export function adherenceReport(
  item: MedicationItem,
  now: number,
  opts: { windowDays?: number; threshold?: number } = {},
): AdherenceReport | null {
  const sched = item.schedule?.length ?? 0;
  if (sched === 0) return null;
  const windowDays = opts.windowDays ?? 14;
  const threshold = opts.threshold ?? 0.5;
  if (now - item.created_at < windowDays * 86_400_000) return null;

  const startTs = startOfDay(now) - (windowDays - 1) * 86_400_000;
  const expected = sched * windowDays;
  let logged = 0;
  for (const t of item.taken ?? []) {
    const tts = Date.parse(`${t.date}T${t.time || '12:00'}`);
    if (Number.isFinite(tts) && tts >= startTs && tts <= now) logged++;
  }
  const ratio = expected > 0 ? logged / expected : 0;
  const drift = ratio < threshold;
  const copy = drift
    ? `${item.name} — logged ${logged} of ${expected} this fortnight. pattern, not medical.`
    : `${item.name} — logged ${logged} of ${expected} this fortnight. noted.`;
  return { ratio, logged, expected, windowDays, drift, copy };
}
