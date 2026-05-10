/**
 * @ollie/logic · sleep · parse & merge
 *
 * parseSleepDump — extract a SleepRecord from free-text brain-dump input.
 * mergeRecord    — merge a partial update into an existing or new record.
 * sleepEfficiency — compute sleep efficiency ratio.
 * resolveTarget  — clamp user target_hours to [4, 12].
 *
 * No I/O. No DOM. No wall-clock reads (now is explicit).
 */

import type { SleepRecord, ParsedSleepResult, SleepSettings } from './types';
import {
  parseTimeOfDay,
  minutesInBed,
  isoDate,
  formatTime,
} from './helpers';
import { QUALITY_MAP, DEFAULT_TOKENS } from './constants';

export function parseSleepDump(
  text: string,
  now: number,
  keywords?: Record<string, string[]>,
): ParsedSleepResult {
  const src = String(text || '');
  if (!src.trim()) return { record: null, span: null };
  const marker = /\b(bed|slept|sleep|woke|awake|nap|insomnia|bedtime|wake|asleep)\b/i;
  if (!marker.test(src)) return { record: null, span: null };
  const lower = src.toLowerCase();

  let bedtime: number | null = null;
  const btMatch = src.match(
    /\b(?:in bed|went to bed|asleep|bedtime|slept)\s*(?:at|by|around|~)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  );
  if (btMatch) {
    const m = parseTimeOfDay(btMatch[1]);
    if (m != null) bedtime = m;
  }

  let wakeTime: number | null = null;
  const wkMatch = src.match(
    /\b(?:woke(?:\s*up)?|awake|up)\s*(?:at|around|~)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  );
  if (wkMatch) {
    const m = parseTimeOfDay(wkMatch[1]);
    if (m != null) wakeTime = m;
  }

  let onsetLatency: number | null = null;
  const solMatch = src.match(
    /(?:took\s*(?:me\s*)?|couldn'?t\s*(?:fall\s*asleep|sleep)\s*for\s*|lay\s*awake\s*for\s*)(\d{1,3})\s*(hour|hours|hr|h|minute|minutes|min|m)\b/i,
  );
  if (solMatch) {
    const n = parseInt(solMatch[1], 10);
    if (isFinite(n))
      onsetLatency = /h/.test(solMatch[2].toLowerCase()) ? n * 60 : n;
  }
  if (
    onsetLatency == null &&
    /couldn'?t\s*(?:fall\s*asleep|sleep)\s*for\s*(?:an?|one)\s*hour/i.test(src)
  )
    onsetLatency = 60;

  let wakings: number | null = null;
  const wcMatch = src.match(/\bwoke\s*(?:up\s*)?(\d+)\s*times?\b/i);
  if (wcMatch) wakings = parseInt(wcMatch[1], 10);
  if (wakings == null && /\bup\s*(?:a\s*few|several|multiple|many)\s*times?\b/i.test(src))
    wakings = 3;
  if (wakings == null && /\bup\s*twice\b/i.test(src)) wakings = 2;
  if (wakings == null && /\bup\s*once\b/i.test(src)) wakings = 1;

  let quality: number | null = null;
  let qualityText: string | null = null;
  for (const w of Object.keys(QUALITY_MAP)) {
    if (new RegExp('\\b' + w + '\\b(?:\\s*(?:night|sleep|rest))?', 'i').test(lower)) {
      quality = QUALITY_MAP[w];
      qualityText = w;
      break;
    }
  }

  const isSkipped = /\b(didn'?t\s*sleep|no\s*sleep|skipped\s*log)\b/i.test(src);

  const tokens: string[] = [];
  const tokenMap = keywords || DEFAULT_TOKENS;
  for (const [category, words] of Object.entries(tokenMap)) {
    for (const w of words) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(lower)) {
        tokens.push(category + ':' + w.toLowerCase());
        break;
      }
    }
  }

  const hasContent =
    bedtime != null ||
    wakeTime != null ||
    onsetLatency != null ||
    wakings != null ||
    quality != null ||
    isSkipped;
  if (!hasContent) return { record: null, span: null };

  let nightOf = isoDate(now);
  if (bedtime != null && bedtime < 720) {
    const prior = new Date(now);
    prior.setDate(prior.getDate() - 1);
    nightOf = isoDate(prior.getTime());
  }

  return {
    record: {
      night_of: nightOf,
      bedtime: bedtime != null ? formatTime(bedtime) : null,
      wake_time: wakeTime != null ? formatTime(wakeTime) : null,
      onset_latency_min: onsetLatency,
      wakings_count: wakings,
      wakings_total_min: null,
      quality,
      quality_text: qualityText,
      notes: null,
      tokens,
      is_skipped: isSkipped,
      is_partial: !(bedtime != null && wakeTime != null),
      is_disputed: false,
      raw_span: { start: 0, end: src.length },
    },
    span: { start: 0, end: src.length },
  };
}

export function mergeRecord(
  prev: SleepRecord | null,
  next: Partial<SleepRecord>,
  now: number,
): SleepRecord {
  const base: SleepRecord = prev || {
    id: 'sleep-' + now + '-' + Math.random().toString(36).slice(2, 8),
    created_at: now,
    extractor_version: 'rule-1',
    raw_source_id: null,
    raw_span: null,
    night_of: '',
    bedtime: null,
    wake_time: null,
    onset_latency_min: null,
    wakings_count: null,
    wakings_total_min: null,
    quality: null,
    quality_text: null,
    notes: null,
    tokens: [],
    is_skipped: false,
    is_partial: true,
    is_disputed: false,
    cycle_phase: null,
    journal_entry_ids: [],
  };
  const out: SleepRecord = { ...base };
  const outAny = out as unknown as Record<string, unknown>;
  const nextAny = (next || {}) as Record<string, unknown>;
  for (const k of Object.keys(nextAny)) {
    if (nextAny[k] !== undefined && nextAny[k] !== null) {
      outAny[k] = nextAny[k];
    }
  }
  out.last_edited_at = now;
  if (Array.isArray(base.tokens) && Array.isArray(next?.tokens)) {
    out.tokens = Array.from(new Set([...base.tokens, ...next.tokens]));
  }
  const btMin = parseTimeOfDay(out.bedtime);
  const wkMin = parseTimeOfDay(out.wake_time);
  out.time_in_bed_min = minutesInBed(btMin, wkMin);
  if (out.time_in_bed_min != null) {
    const sol = out.onset_latency_min || 0;
    const wake = out.wakings_total_min || 0;
    out.tst_min = Math.max(0, out.time_in_bed_min - sol - wake);
    out.efficiency =
      out.time_in_bed_min > 0 ? out.tst_min / out.time_in_bed_min : null;
  } else {
    out.tst_min = null;
    out.efficiency = null;
  }
  out.is_partial = !(out.bedtime != null && out.wake_time != null);
  return out;
}

export function sleepEfficiency(r: SleepRecord | null | undefined): number | null {
  if (!r || r.time_in_bed_min == null || r.time_in_bed_min < 60 || r.tst_min == null)
    return null;
  return r.tst_min / r.time_in_bed_min;
}

export function resolveTarget(s: SleepSettings | null | undefined): number {
  if (s && typeof s.target_hours === 'number' && isFinite(s.target_hours)) {
    return Math.max(4, Math.min(12, s.target_hours));
  }
  return 7.5;
}
