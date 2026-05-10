/**
 * @ollie/logic · journal · extraction helpers
 *
 * segment, extractRuleBased, validateEntry, stripCodeFence,
 * snapToWordBoundaries, filterInSpan, mergeOverlappingEntries.
 *
 * All pure. No I/O. No DOM.
 */

import type {
  SpanWithText,
  RuleBasedResult,
  ValidationResult,
  UserEntities,
  JournalEntry,
} from './types';
import {
  EMOTION_WORDS,
  DECISION_PATTERNS,
  BANNED_FIELDS,
  TIME_PATTERNS,
} from './constants';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split rawText into sentence/paragraph-level spans.
 * Returns an array of non-empty spans with their character offsets.
 */
export function segment(rawText: string): SpanWithText[] {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) return [];

  const paraRegex = /\n[ \t]*\n+/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  const paragraphs: Array<{ start: number; end: number }> = [];

  while ((m = paraRegex.exec(rawText)) !== null) {
    paragraphs.push({ start: cursor, end: m.index });
    cursor = m.index + m[0].length;
  }
  paragraphs.push({ start: cursor, end: rawText.length });

  const spans: SpanWithText[] = [];

  for (const p of paragraphs) {
    const text = rawText.slice(p.start, p.end);
    if (text.trim().length === 0) continue;

    // Lookbehind for sentence boundaries — Chrome supports this.
    const sentenceRegex = /(?<=[.!?])\s+(?=[A-Za-z])/g;
    const parts: Array<{ start: number; end: number }> = [];
    let sStart = 0;

    while ((m = sentenceRegex.exec(text)) !== null) {
      parts.push({ start: sStart, end: m.index });
      sStart = m.index + m[0].length;
    }
    parts.push({ start: sStart, end: text.length });

    for (const part of parts) {
      const span: SpanWithText = {
        start: p.start + part.start,
        end: p.start + part.end,
        text: rawText.slice(p.start + part.start, p.start + part.end),
      };
      if (span.text.trim().length === 0) continue;
      spans.push(span);
    }
  }

  // Merge tiny trailing fragments into the previous span.
  const out: SpanWithText[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.text.trim().length < 4) {
      last.end = s.end;
      last.text = rawText.slice(last.start, last.end);
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Rule-based fallback extraction when AI is unavailable.
 * Returns a single flat result (not segmented per entry).
 */
export function extractRuleBased(
  rawText: string,
  userEntities?: UserEntities,
): RuleBasedResult {
  const text = typeof rawText === 'string' ? rawText : '';
  const entities: UserEntities = userEntities ?? { people: [], places: [] };
  const lower = text.toLowerCase();

  const emotions: string[] = [];
  for (const w of EMOTION_WORDS) {
    const re = new RegExp('\\b' + escapeRegex(w) + '\\b');
    if (re.test(lower)) emotions.push(w);
  }

  const people = (entities.people ?? []).filter(p => {
    const re = new RegExp('\\b' + escapeRegex(p.toLowerCase()) + '\\b');
    return re.test(lower);
  });
  const places = (entities.places ?? []).filter(p => {
    const re = new RegExp('\\b' + escapeRegex(p.toLowerCase()) + '\\b');
    return re.test(lower);
  });

  const questions: string[] = [];
  const qRegex = /[^.!?\n]*\?/g;
  let qm: RegExpExecArray | null;
  while ((qm = qRegex.exec(text)) !== null) {
    const q = qm[0].trim();
    if (q.length >= 4) questions.push(q);
  }

  const decisions: string[] = [];
  const clauses = text.split(/(?<=[.!?])\s+|\n+/g);
  for (const c of clauses) {
    const trimmed = c.trim();
    if (trimmed.length < 4) continue;
    if (DECISION_PATTERNS.some(re => re.test(trimmed))) decisions.push(trimmed);
  }

  const timeAnchors: Array<{ iso: null; text: string }> = [];
  for (const re of TIME_PATTERNS) {
    const tm = re.exec(text);
    if (tm) timeAnchors.push({ iso: null, text: tm[0].toLowerCase() });
  }

  let summary: string | null = null;
  if (text.length > 120) {
    const trimmed = text.trim();
    const firstBreak = Math.min(
      80,
      ...(['. ', '? ', '! ', '\n'].map(s => {
        const idx = trimmed.indexOf(s);
        return idx > 0 && idx < 80 ? idx : 80;
      })),
    );
    summary = trimmed.slice(0, firstBreak).toLowerCase();
  }

  return {
    state: 'extracted-rule-based',
    extractor_version: 'rule-1',
    text_rendered: text,
    summary,
    emotions,
    people,
    places,
    questions,
    decisions,
    time_anchors: timeAnchors,
    module_hints: [],
  };
}

/**
 * Strip markdown code fences that Haiku occasionally wraps JSON in despite
 * being told not to. Discovered via live call 2026-04-21.
 */
export function stripCodeFence(text: unknown): unknown {
  if (typeof text !== 'string') return text;
  let s = text.trim();
  const openMatch = s.match(/^```(?:json|javascript)?\s*\n?/i);
  if (openMatch) s = s.slice(openMatch[0].length);
  s = s.replace(/\s*```\s*$/i, '');
  return s.trim();
}

/**
 * Haiku's character offsets are frequently off by a few chars.
 * Heal by expanding span outward to nearest non-word boundary on each side.
 */
export function snapToWordBoundaries(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const isWord = (c: string | undefined): boolean => /[A-Za-z0-9']/.test(c ?? '');
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(0, Math.min(end, text.length));
  while (s > 0 && isWord(text[s - 1]) && isWord(text[s])) s--;
  while (e < text.length && isWord(text[e - 1]) && isWord(text[e])) e++;
  return { start: s, end: e };
}

/**
 * Drops any string from items[] that isn't literally present in spanText.
 * Enforces §7.3: every extracted field must be substring-in-span.
 */
export function filterInSpan(items: unknown[], spanText: string): string[] {
  if (!Array.isArray(items)) return [];
  const lower = String(spanText ?? '').toLowerCase();
  return items.filter((i): i is string => typeof i === 'string' && lower.includes(i.toLowerCase()));
}

/**
 * Merge overlapping or abutting spans (≤2 char gap) from Haiku output.
 * Also drops micro-fragments whose span text is <8 chars after trim.
 * Unions text-bearing arrays; summary + module_hints from earlier entry.
 */
export function mergeOverlappingEntries(entries: JournalEntry[]): JournalEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const sorted = entries
    .filter(e => e?.span && typeof e.span.start === 'number' && typeof e.span.end === 'number' && e.span.end > e.span.start)
    .slice()
    .sort((a, b) => a.span.start - b.span.start);

  const out: JournalEntry[] = [];

  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.span.start <= last.span.end + 2) {
      last.span.end = Math.max(last.span.end, e.span.end);
      for (const k of ['people', 'places', 'emotions', 'questions', 'decisions'] as const) {
        const a = Array.isArray(last[k]) ? last[k] : [];
        const b = Array.isArray(e[k]) ? e[k] : [];
        (last[k] as string[]) = Array.from(new Set([...a, ...b]));
      }
      last.time_anchors = [
        ...(Array.isArray(last.time_anchors) ? last.time_anchors : []),
        ...(Array.isArray(e.time_anchors) ? e.time_anchors : []),
      ];
      last.module_hints = [
        ...(Array.isArray(last.module_hints) ? last.module_hints : []),
        ...(Array.isArray(e.module_hints) ? e.module_hints : []),
      ];
      if (!last.summary && e.summary) last.summary = e.summary;
    } else {
      out.push({ ...e, span: { start: e.span.start, end: e.span.end } });
    }
  }

  return out.filter(e => (e.span.end - e.span.start) >= 8);
}

/**
 * Validate a journal entry against §7 rules.
 * `rawDump` is optional — if provided, raw_span consistency is also checked.
 */
export function validateEntry(
  entry: unknown,
  rawDump?: string,
): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['entry is not an object'] };
  }

  const e = entry as Record<string, unknown>;

  for (const k of Object.keys(e)) {
    if (BANNED_FIELDS.has(k)) errors.push(`banned field: ${k}`);
  }

  if (typeof rawDump === 'string') {
    const rs = e['raw_span'] as Record<string, unknown> | undefined;
    if (!rs || typeof rs['start'] !== 'number' || typeof rs['end'] !== 'number') {
      errors.push('missing raw_span{start,end}');
    } else {
      const sliced = rawDump.slice(rs['start'] as number, rs['end'] as number);
      const textRendered = e['text_rendered'];
      if (typeof textRendered === 'string' && textRendered !== sliced) {
        errors.push('text_rendered does not match rawDump.slice(raw_span) — §7.2');
      }
    }
  }

  if (Array.isArray(e['emotions']) && typeof e['text_rendered'] === 'string') {
    const lower = (e['text_rendered'] as string).toLowerCase();
    for (const em of e['emotions'] as unknown[]) {
      if (typeof em !== 'string') { errors.push('emotion is not a string'); continue; }
      if (!lower.includes(em.toLowerCase())) {
        errors.push(`emotion "${em}" not present in text_rendered — §7.3`);
      }
    }
  }

  if (e['summary'] != null) {
    if (typeof e['summary'] !== 'string') errors.push('summary is not a string');
    else if ((e['summary'] as string).length > 80) errors.push('summary >80 chars — §7.5');
  }

  return { valid: errors.length === 0, errors };
}
