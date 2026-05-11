/**
 * parseReminder — pure function, no side effects.
 *
 * Ported from VOID.parseReminder (void-app.html ~line 29153).
 * Additions: typed API, locale-aware TR patterns, id via crypto.randomUUID.
 */

import type { Reminder } from './types';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ─── fat-finger normalizer ────────────────────────────────────────────────────

function normalizeText(phrase: string): string {
  let t = String(phrase || '').toLowerCase().trim();
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

// ─── pattern table ────────────────────────────────────────────────────────────

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

// ─── fireAt resolution ────────────────────────────────────────────────────────

function resolveFireAt(pat: PatternEntry, m: RegExpMatchArray, now: number): number | null {
  if (pat.kind === 'offset') {
    const n = pat.fixedN !== undefined ? pat.fixedN : parseInt(m[1], 10);
    if (isNaN(n) || n <= 0 || !pat.unit) return null;
    return now + n * pat.unit;

  } else if (pat.kind === 'at') {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    const d = new Date(now); d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();

  } else if (pat.kind === 'tonight') {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (hh < 12) hh += 12;
    const d = new Date(now); d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();

  } else if (pat.kind === 'tomorrow') {
    let hh = m[1] ? parseInt(m[1], 10) : 9;
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(hh, mm, 0, 0);
    return d.getTime();

  } else if (pat.kind === 'yarın') {
    let hh = m[1] ? parseInt(m[1], 10) : 9;
    const mm = m[2] ? parseInt(m[2], 10) : 0;
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

// ─── public API ──────────────────────────────────────────────────────────────

export function parseReminder(
  text: string,
  now: number,
  locale: 'en' | 'tr' = 'en',
  module = 'dump',
): Reminder | null {
  if (!text || typeof text !== 'string') return null;

  const cleaned = normalizeText(text);
  const patterns = locale === 'tr'
    ? [...TR_PATTERNS, ...EN_PATTERNS]
    : EN_PATTERNS;

  for (const pat of patterns) {
    const m = cleaned.match(pat.rx);
    if (!m) continue;

    const fireAt = resolveFireAt(pat, m, now);
    if (!fireAt) continue;
    // Reject timestamps more than 5 min in the past.
    if (fireAt < now - 300000) continue;
    // Floor at "now + 10s" so the scheduler doesn't fire instantly on a race.
    const datetime = Math.max(fireAt, now + 10000);

    // Extract action body: strip reminder verbs and the matched time phrase.
    let body = cleaned
      .replace(/^remind me (that |to )?/, '')
      .replace(/^remind me\s+/, '')
      .replace(/^remind\s+/, '')
      .replace(m[0], '')
      .replace(/\s+(to|at|in|on)\s*$/, '')
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

  return null;
}
