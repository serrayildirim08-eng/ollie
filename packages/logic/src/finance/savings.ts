/**
 * @ollie/logic · finance · savings tracker (Decision #14, locked 2026-05-11)
 *
 * F1. Tracks dollars saved from cancelled subscriptions.
 *
 * Voice rules (constitutional for this feature):
 *   - frame: "saved" (passive). NEVER "you saved" or "ollie saved you".
 *   - math: actual elapsed months × monthly_amount. NOT annual projection.
 *   - re-subscribe: keep historic count. don't reset.
 *
 * Pure functions only. No store, no events, no wall-clock reads —
 * `now` is injected. UI side fetches `cancellations` + a `now` from the
 * orchestrator's derived slice.
 */

const DAY_MS = 86_400_000;

export interface Cancellation {
  id: string;
  merchant: string;
  monthly_amount: number;
  cancelled_at: number;          // ms epoch
  surfaced_by_ollie: boolean;    // true when user tapped the d3-subscription card
  /** Set only if user re-subscribed AND we want a historical note. */
  resubscribed_at?: number;
}

export interface SavingsEntry {
  cancellation: Cancellation;
  /** Elapsed whole months since cancellation, clamped at re-sub date when set. */
  months_elapsed: number;
  /** months_elapsed × monthly_amount, rounded to cents. */
  saved_amount: number;
}

export interface SavingsTotals {
  /** Total saved this calendar year (Jan 1 → now). */
  year_total: number;
  /** Total saved across all time. */
  all_time_total: number;
  /** Per-cancellation breakdown, sorted by saved_amount desc. */
  entries: SavingsEntry[];
  /** Same as `entries` but only those with months_elapsed > 0 within current year. */
  year_entries: SavingsEntry[];
}

function startOfYear(now: number): number {
  const d = new Date(now);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Calendar-month difference between `cancelled_at` and `until_ts`.
 * Counts the *whole* months that have fully elapsed. Examples:
 *   cancelled 2026-01-15, now 2026-04-14 → 2 (Jan→Feb, Feb→Mar are whole)
 *   cancelled 2026-01-15, now 2026-04-15 → 3
 *   cancelled 2026-01-15, now 2026-01-30 → 0 (less than one month elapsed)
 */
export function monthsBetween(cancelledAt: number, untilTs: number): number {
  if (untilTs <= cancelledAt) return 0;
  const start = new Date(cancelledAt);
  const end = new Date(untilTs);
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  // If the day-of-month hasn't yet reached the cancellation day, the
  // most recent month hasn't fully elapsed yet.
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Pure totals computation. Re-subscribed cancellations stop accruing
 * at `resubscribed_at` but stay in history.
 */
export function computeSavings(
  cancellations: Cancellation[],
  now: number,
): SavingsTotals {
  const yearStart = startOfYear(now);
  const entries: SavingsEntry[] = [];
  let allTime = 0;
  let yearTotal = 0;
  const yearEntries: SavingsEntry[] = [];

  for (const c of cancellations ?? []) {
    if (!c || typeof c.monthly_amount !== 'number' || typeof c.cancelled_at !== 'number') continue;
    const untilAll = typeof c.resubscribed_at === 'number' ? c.resubscribed_at : now;
    const monthsAll = monthsBetween(c.cancelled_at, untilAll);
    const savedAll = round2(monthsAll * c.monthly_amount);

    // Year window: clip cancellation start to max(cancelled_at, yearStart).
    const yearWindowStart = Math.max(c.cancelled_at, yearStart);
    const yearWindowEnd = Math.min(untilAll, now);
    const yearMonths = yearWindowStart < yearWindowEnd
      ? monthsBetween(yearWindowStart, yearWindowEnd)
      : 0;
    const savedYear = round2(yearMonths * c.monthly_amount);

    const entry: SavingsEntry = {
      cancellation: c,
      months_elapsed: monthsAll,
      saved_amount: savedAll,
    };
    entries.push(entry);
    allTime += savedAll;

    if (savedYear > 0) {
      yearTotal += savedYear;
      yearEntries.push({
        cancellation: c,
        months_elapsed: yearMonths,
        saved_amount: savedYear,
      });
    }
  }

  entries.sort((a, b) => b.saved_amount - a.saved_amount);
  yearEntries.sort((a, b) => b.saved_amount - a.saved_amount);

  return {
    year_total: round2(yearTotal),
    all_time_total: round2(allTime),
    entries,
    year_entries: yearEntries,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the passive-voice card copy from a totals snapshot. NEVER
 * uses "you saved" or "ollie saved you" framing.
 */
export function buildSavingsCardCopy(totals: SavingsTotals): string {
  if (totals.year_total <= 0) return '';
  const lead = `$${totals.year_total.toFixed(2)} saved this year.`;
  const top = totals.year_entries.slice(0, 3).map((e) => {
    const m = e.months_elapsed;
    return `${e.cancellation.merchant} (${m} mo)`;
  });
  return top.length ? `${lead} ${top.join(', ')}.` : lead;
}

/**
 * Last-day-of-month digest copy. F2.
 */
export function buildMonthlyDigestCopy(
  totals: SavingsTotals,
  monthCancellations: Cancellation[],
  monthlySavedThisMonth: number,
): string {
  const monthSaved = round2(monthlySavedThisMonth);
  const merchants = monthCancellations.map((c) => c.merchant).join(' + ');
  const lead = monthCancellations.length
    ? `this month: $${monthSaved.toFixed(2)} saved by cancelling ${merchants}.`
    : `this month: $${monthSaved.toFixed(2)} saved.`;
  return `${lead} total this year: $${totals.year_total.toFixed(2)}.`;
}

/**
 * Sum of savings accrued during the calendar month containing `now`.
 * For F2 month-end digest.
 */
export function savingsThisMonth(
  cancellations: Cancellation[],
  now: number,
): number {
  const monthStart = (() => {
    const d = new Date(now);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  let total = 0;
  for (const c of cancellations ?? []) {
    if (!c || typeof c.monthly_amount !== 'number' || typeof c.cancelled_at !== 'number') continue;
    const until = typeof c.resubscribed_at === 'number' ? c.resubscribed_at : now;
    const a = Math.max(c.cancelled_at, monthStart);
    const b = Math.min(until, now);
    if (a >= b) continue;
    // Whole month elapsed within the [monthStart, now] window — i.e.
    // 0 or 1 depending on whether a full calendar month falls inside.
    // Most cancellations contribute monthly_amount × 0 (sub-month) or
    // monthly_amount × 1 here. monthsBetween handles the boundary.
    const months = monthsBetween(a, b);
    total += months * c.monthly_amount;
  }
  return round2(total);
}

/**
 * Cancellations whose first full month accrued in the current month
 * window. Used to label the digest "cancelling X + Y this month."
 */
export function cancellationsAccruedThisMonth(
  cancellations: Cancellation[],
  now: number,
): Cancellation[] {
  const monthStart = (() => {
    const d = new Date(now);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  return (cancellations ?? []).filter((c) => {
    if (!c?.cancelled_at) return false;
    return c.cancelled_at >= monthStart && c.cancelled_at <= now;
  });
}
