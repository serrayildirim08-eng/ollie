/**
 * parseReminder — pure function, no side effects.
 *
 * English path: chrono-node natural-language date parser. This fixes the
 *   long-standing bug where "next friday at 6pm" dropped the time and
 *   resolved to 09:00 — chrono keeps the explicit time component.
 * Turkish path: the hand-rolled pattern table is kept as-is (chrono has no
 *   reliable Turkish locale), with EN patterns as a fallback.
 *
 * Both paths run hour/minute bounds validation, so impossible times like
 * "99:88" are rejected instead of silently accepted.
 *
 * Ported from VOID.parseReminder (void-app.html ~line 29153).
 *
 * TIMEZONE ASSUMPTION (audit item #7) — VERIFIED, not a live bug:
 *   Relative wall-clock times ("at 6pm", "tomorrow morning", chrono's
 *   `forwardDate`) are resolved in the HOST runtime's local timezone:
 *   every `new Date(now)` / `d.setHours()` here, and `result.start.date()`
 *   from chrono, use the host TZ. parseReminder is a CLIENT-SIDE function
 *   (PWA / Electron) — host TZ == the user's own device TZ — so "6pm"
 *   correctly means 6pm where the user is. This is the right behaviour
 *   and needs no change today.
 *
 *   It would ONLY be wrong if parseReminder were called server-side
 *   (a Cloudflare Worker runs in UTC). It is NOT today. If a server
 *   caller is ever added it MUST pass the user's IANA TZ and this
 *   function must switch to a TZ-aware resolver (chrono `timezone`
 *   option + a TZ-aware clock); do not call it server-side before then.
 */

import * as chrono from 'chrono-node';
import type { Reminder } from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ─── fat-finger normalizer ────────────────────────────────────────────────────

/**
 * Locale-aware lowercasing (audit item #9).
 *
 * For Turkish input we MUST use `toLocaleLowerCase('tr')`: plain
 * `toLowerCase()` turns "İ" into "i̇" (i + combining dot) and "I" into
 * "i", so a capitalized "Yarın"/"İki" silently misses the lowercase TR
 * pattern keywords. For English we keep the invariant `toLowerCase()` —
 * Turkish casing would corrupt English "I" into dotless "ı" and break
 * patterns like "in 5 min".
 */
function localeLower(s: string, locale: 'en' | 'tr'): string {
  return locale === 'tr' ? s.toLocaleLowerCase('tr') : s.toLowerCase();
}

function normalizeText(phrase: string, locale: 'en' | 'tr'): string {
  let t = localeLower(String(phrase || ''), locale).trim();
  // insert spaces between digits and letters: "at3pm" → "at 3 pm"
  t = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');

  const aliases: [RegExp, string][] = [
    [/\b(tmr|tmrw|tmmrw|tomo|tomoz|tomoro|tomorow|tommorow|tmrrw|2morrow|2moro)\b/g, 'tomorrow'],
    [/\b(tnite|tonite|2nite|2night|tnight)\b/g, 'tonight'],
    [/\b(mim|mims|mns|mnts|minuts|minutess)\b/g, 'min'],
    [/\b(houre|houres|hrss)\b/g, 'hour'],
    [/\b(mng|mrning|morng|morn|mornng)\b/g, 'morning'],
    [/\b(aftrnoon|aftn|aftrnn)\b/g, 'afternoon'],
    [/\b(evng|evning|eving|evenin)\b/g, 'evening'],
    [/\b(remnd|remind(?:e|ed|dd)|reming|remid)\b/g, 'remind'],
    [/\b(nxt|nex)\b/g, 'next'],
    [/\bp\.?\s?m\.?\b/g, 'pm'],
    [/\ba\.?\s?m\.?\b/g, 'am'],
    [/\bmon\b/g, 'monday'],
    [/\b(tue|tues)\b/g, 'tuesday'],
    [/\bwed\b/g, 'wednesday'],
    [/\b(thu|thur|thurs)\b/g, 'thursday'],
    [/\bfri\b/g, 'friday'],
    [/\bsat\b/g, 'saturday'],
    [/\bsun\b/g, 'sunday'],
    [/\bone (minutes?|mins?|min)\b/g, '1 min'],
    [/\btwo (minutes?|mins?|min)\b/g, '2 min'],
    [/\bfive (minutes?|mins?|min)\b/g, '5 min'],
    [/\bten (minutes?|mins?|min)\b/g, '10 min'],
    [/\bfifteen (minutes?|mins?|min)\b/g, '15 min'],
    [/\bthirty (minutes?|mins?|min)\b/g, '30 min'],
    [/\bone (hours?|hrs?|hour)\b/g, '1 hour'],
    [/\btwo (hours?|hrs?|hour)\b/g, '2 hour'],
    // TR normalizations
    [/\bdakika\b/g, 'dakika'],  // already correct, kept for completeness
    [/\bsaatler?\b/g, 'saat'],
    [/\bgünler?\b/g, 'gün'],
    [/\byarın\b/g, 'yarın'],
  ];

  for (const [rx, sub] of aliases) t = t.replace(rx, sub);
  return t.replace(/\s+/g, ' ').trim();
}

// ─── hour/minute bounds validation ────────────────────────────────────────────

/**
 * Reject any explicit clock time outside the legal 24h range, e.g. "99:88".
 * Scans the *original* text (before normalization joins digits to letters)
 * for HH:MM clusters. A clock time is invalid when hours > 23 or minutes > 59.
 * Returns true when every explicit HH:MM in the string is well-formed.
 */
function hasValidClockTimes(text: string): boolean {
  const rx = /\b(\d{1,2}):(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) return false;
  }
  return true;
}

// ─── TR pattern table (kept as-is) ────────────────────────────────────────────

interface PatternEntry {
  rx: RegExp;
  kind: string;
  unit?: number;
  fixedN?: number;
}

const EN_PATTERNS: PatternEntry[] = [
  { rx: /\bin\s+(\d+)\s*(minutes?|mins?|m)\b/,       kind: 'offset', unit: 60000 },
  { rx: /\bin\s+(\d+)\s*(hours?|hrs?|h)\b/,          kind: 'offset', unit: 3600000 },
  { rx: /\bin\s+(\d+)\s*(days?)\b/,                  kind: 'offset', unit: 86400000 },
  { rx: /\bin\s+(a|an|one)\s+minute\b/,              kind: 'offset', unit: 60000,     fixedN: 1 },
  { rx: /\bin\s+(a|an|one)\s+hour\b/,                kind: 'offset', unit: 3600000,   fixedN: 1 },
  { rx: /\bin\s+(a|an|one)\s+day\b/,                 kind: 'offset', unit: 86400000,  fixedN: 1 },
  { rx: /\btonight\s+at\s+(\d{1,2})(?::(\d{2}))?\b/, kind: 'tonight' },
  { rx: /\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/, kind: 'tomorrow' },
  { rx: /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/, kind: 'nextWeekday' },
  { rx: /\bon\s+(\d{1,2})\/(\d{1,2})\b/,             kind: 'date' },
  { rx: /\bin\s+the\s+(morning|afternoon|evening|night)\b/, kind: 'timeOfDay' },
  { rx: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/, kind: 'at' },
];

// TR: "X dakika sonra", "X saat sonra", "X gün sonra", "yarın [saat HH]"
const TR_PATTERNS: PatternEntry[] = [
  { rx: /(\d+)\s*dakika\s+sonra\b/,   kind: 'offset', unit: 60000 },
  { rx: /(\d+)\s*saat\s+sonra\b/,     kind: 'offset', unit: 3600000 },
  { rx: /(\d+)\s*gün\s+sonra\b/,      kind: 'offset', unit: 86400000 },
  { rx: /\byarın(?:\s+saat\s+(\d{1,2})(?::(\d{2}))?)?\b/, kind: 'yarın' },
];

// ─── fireAt resolution (pattern table path) ────────────────────────────────────

function resolveFireAt(pat: PatternEntry, m: RegExpMatchArray, now: number): number | null {
  if (pat.kind === 'offset') {
    const n = pat.fixedN !== undefined ? pat.fixedN : parseInt(m[1], 10);
    if (isNaN(n) || n <= 0 || !pat.unit) return null;
    return now + n * pat.unit;

  } else if (pat.kind === 'at') {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh > 23 || mm > 59) return null;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    const d = new Date(now); d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();

  } else if (pat.kind === 'tonight') {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh > 23 || mm > 59) return null;
    if (hh < 12) hh += 12;
    const d = new Date(now); d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();

  } else if (pat.kind === 'tomorrow') {
    let hh = m[1] ? parseInt(m[1], 10) : 9;
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh > 23 || mm > 59) return null;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(hh, mm, 0, 0);
    return d.getTime();

  } else if (pat.kind === 'yarın') {
    const hh = m[1] ? parseInt(m[1], 10) : 9;
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh > 23 || mm > 59) return null;
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(hh, mm, 0, 0);
    return d.getTime();

  } else if (pat.kind === 'nextWeekday') {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const target = days.indexOf(m[1].toLowerCase());
    const d = new Date(now); d.setHours(9, 0, 0, 0);
    const delta = ((target - d.getDay()) + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return d.getTime();

  } else if (pat.kind === 'date') {
    const mon = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    const d = new Date(now); d.setMonth(mon, day); d.setHours(9, 0, 0, 0);
    if (d.getTime() <= now) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();

  } else if (pat.kind === 'timeOfDay') {
    const hhMap: Record<string, number> = { morning: 9, afternoon: 15, evening: 20, night: 22 };
    const hh = hhMap[m[1].toLowerCase()];
    if (hh === undefined) return null;
    const d = new Date(now); d.setHours(hh, 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  return null;
}

/** Run the hand-rolled pattern table. Returns { fireAt, matched } or null. */
function parseWithPatternTable(
  cleaned: string,
  now: number,
  patterns: PatternEntry[],
): { fireAt: number; matched: string } | null {
  for (const pat of patterns) {
    const m = cleaned.match(pat.rx);
    if (!m) continue;
    const fireAt = resolveFireAt(pat, m, now);
    if (fireAt == null) continue;
    return { fireAt, matched: m[0] };
  }
  return null;
}

// ─── chrono-node English path ─────────────────────────────────────────────────

/**
 * Parse the English natural-language path with chrono-node. Unlike the old
 * pattern table, chrono keeps explicit times — "next friday at 6pm"
 * resolves to 18:00 on the correct Friday, not 09:00.
 *
 * Returns { fireAt, matched } where `matched` is the substring chrono
 * consumed (so the body extractor can strip it), or null when chrono
 * found no date.
 */
function parseWithChrono(
  cleaned: string,
  now: number,
): { fireAt: number; matched: string } | null {
  const ref = new Date(now);
  // forwardDate: bare times/days resolve to the next future occurrence,
  // matching the old pattern table's "if past, roll forward" behaviour.
  const results = chrono.parse(cleaned, ref, { forwardDate: true });
  if (results.length === 0) return null;

  // Take the first result. chrono returns matches left-to-right.
  const result = results[0];
  const fireAt = result.start.date().getTime();
  if (!Number.isFinite(fireAt)) return null;

  return { fireAt, matched: result.text };
}

// ─── public API ──────────────────────────────────────────────────────────────

export function parseReminder(
  text: string,
  now: number,
  locale: 'en' | 'tr' = 'en',
  module = 'dump',
): Reminder | null {
  if (!text || typeof text !== 'string') return null;

  // Reject impossible clock times ("99:88") before any parser runs. We scan
  // the raw text so a malformed time can't be silently coerced downstream.
  if (!hasValidClockTimes(text)) return null;

  const cleaned = normalizeText(text, locale);

  let resolved: { fireAt: number; matched: string } | null;

  if (locale === 'tr') {
    // Turkish: pattern table first (chrono has no reliable TR locale),
    // then EN patterns as a fallback for mixed-language input.
    resolved =
      parseWithPatternTable(cleaned, now, TR_PATTERNS) ??
      parseWithPatternTable(cleaned, now, EN_PATTERNS);
  } else {
    // English: chrono-node first, pattern table as a fallback for the few
    // shapes chrono misses (e.g. very terse "in 5 m").
    resolved =
      parseWithChrono(cleaned, now) ??
      parseWithPatternTable(cleaned, now, EN_PATTERNS);
  }

  if (!resolved) return null;

  const { fireAt, matched } = resolved;

  // Reject timestamps more than 5 min in the past.
  if (fireAt < now - 300000) return null;
  // Floor at "now + 10s" so the scheduler doesn't fire instantly on a race.
  const datetime = Math.max(fireAt, now + 10000);

  // Extract action body: strip reminder verbs and the matched time phrase.
  let body = cleaned
    .replace(/^remind me (that |to )?/, '')
    .replace(/^remind me\s+/, '')
    .replace(/^remind\s+/, '');
  if (matched) body = body.replace(matched, '');
  body = body
    .replace(/\s+(to|at|in|on|by)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) body = 'reminder';

  return {
    id: newId(),
    module,
    action: 'remind',
    datetime,
    body,
    status: 'scheduled',
  };
}
