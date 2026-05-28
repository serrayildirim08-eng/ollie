/**
 * formatRelativeTime · one-line editorial "when" stamps for entry rows.
 *
 * Every Box across the native app needs a calm sub-caption under each
 * row that says when the thing was logged. The grammar is universal:
 *
 *   - under a minute     → "just now"
 *   - under an hour      → "5m ago" / "59m ago"
 *   - same local day     → "today 6:05 PM"
 *   - day before today   → "yesterday 11:00 PM"
 *   - within last 7 days → "Mon 11:00 PM"
 *   - earlier this year  → "May 28 6:05 PM"
 *   - older              → "May 12 2026"
 *
 * Locale-friendly: weekdays + months come from `Intl.DateTimeFormat`,
 * not a hardcoded English table, so the box reads correctly when the
 * shell switches language. The literal words "just now", "today",
 * "yesterday", and the "Xm ago" suffix stay English-only for now —
 * Ollie's UI is English (+ Spanish coming) per Serra's locked decision
 * (2026-05-07). When the second language lands, the four tokens get
 * extracted into the lexicons.
 *
 * Returns "" when ts is null/undefined/NaN — callers can guard on the
 * empty string without crashing the row.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Format a millisecond timestamp as an editorial "when" line. */
export function formatRelativeTime(ts: number | null | undefined, now: number = Date.now()): string {
  if (ts == null || !Number.isFinite(ts)) return '';

  const diff = now - ts;

  // future / clock-skew tolerance — anything less than a minute in
  // either direction reads as "just now" rather than a confusing
  // negative number.
  if (diff < MIN && diff > -MIN) return 'just now';

  // sub-hour fallthrough — minutes ago, but only for positive diffs.
  if (diff >= MIN && diff < HOUR) {
    const mins = Math.floor(diff / MIN);
    return `${mins}m ago`;
  }

  const then = new Date(ts);
  const nowDate = new Date(now);

  const sameDay = isSameLocalDay(then, nowDate);
  if (sameDay) {
    return `today ${formatClock(then)}`;
  }

  const yesterday = new Date(nowDate);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(then, yesterday)) {
    return `yesterday ${formatClock(then)}`;
  }

  // within the last 7 days (excluding today + yesterday handled above):
  // "Mon 11:00 PM" — short weekday + clock.
  if (diff > 0 && diff < 7 * DAY) {
    const weekday = then.toLocaleDateString(undefined, { weekday: 'short' });
    return `${weekday} ${formatClock(then)}`;
  }

  // earlier this calendar year: "May 28 6:05 PM"
  if (then.getFullYear() === nowDate.getFullYear()) {
    const md = then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${md} ${formatClock(then)}`;
  }

  // older — "May 12 2026" (no clock, the day carries enough)
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** True when two Date instances fall on the same calendar day in the user's locale. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "6:05 PM" — locale-driven clock, no seconds. */
function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── dev-mode smoke assertions ───────────────────────────────────────────
//
// No vitest in apps/native yet — these run once at module-load in DEV
// builds and log to console if a case regresses. They never throw, so
// they can't take the app down. Production builds strip the block
// because `import.meta.env.DEV` is statically false.

if (import.meta.env.DEV) {
  const NOW = new Date('2026-05-28T18:30:00').getTime();

  const cases: Array<[number, string | RegExp]> = [
    // boundary: 30 seconds ago
    [NOW - 30_000, 'just now'],
    // 5 minutes ago
    [NOW - 5 * MIN, '5m ago'],
    // 59 minutes ago
    [NOW - 59 * MIN, '59m ago'],
    // 2 hours ago (still same calendar day)
    [NOW - 2 * HOUR, /^today \d/],
    // yesterday
    [NOW - 26 * HOUR, /^yesterday \d/],
    // 3 days ago — weekday + clock
    [NOW - 3 * DAY, /^[A-Za-zÇŞĞÜÖİ]{3,} \d/],
    // 60 days ago — month/day + clock (this year)
    [NOW - 60 * DAY, /^[A-Za-zÇŞĞÜÖİ]+ \d+ \d/],
    // 2 years ago — month/day/year only
    [NOW - 730 * DAY, /^[A-Za-zÇŞĞÜÖİ]+ \d+ \d{4}$/],
    // null guard
    [NaN, ''],
  ];

  for (const [input, expected] of cases) {
    const out = formatRelativeTime(input, NOW);
    const ok = typeof expected === 'string' ? out === expected : expected.test(out);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[formatRelativeTime] case failed · input=${input} expected=${String(expected)} got="${out}"`,
      );
    }
  }
}
