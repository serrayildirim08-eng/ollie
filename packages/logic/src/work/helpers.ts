/**
 * @ollie/logic · work helpers
 *
 * Pure utility functions shared across phase files.
 * No I/O. No wall-clock reads.
 */

import type { WorkState, WorkPatternOpts, TriageDay } from './types';

// ─── Consent ──────────────────────────────────────────────────────────

export function consentOn(opts: WorkPatternOpts): boolean {
  if (opts && typeof opts.consent === 'boolean') return opts.consent;
  return true; // default-on when consent layer absent
}

// ─── Date key ─────────────────────────────────────────────────────────

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Block label ──────────────────────────────────────────────────────

export function fmtBlockLabel(blockIndex: number): string {
  const s = blockIndex * 2;
  const e = s + 2;
  const fmt = (h: number): string => {
    const h12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 || h === 24 ? 'am' : 'pm';
    return `${h12}${ampm}`;
  };
  if (e === 24) return `${fmt(s)}-midnight`;
  return `${fmt(s)}-${fmt(e)}`;
}

// ─── Ordinal ──────────────────────────────────────────────────────────

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ─── Triage guard ─────────────────────────────────────────────────────

export function isTriageActive(state: WorkState | null | undefined, opts: WorkPatternOpts): boolean {
  if (opts && typeof opts.triage === 'boolean') return opts.triage;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  if (!state) return false;
  const key = dayKey(now);
  const list: TriageDay[] = Array.isArray(state.triage_days) ? state.triage_days : [];
  for (const t of list) if (t && t.date_key === key) return true;
  return false;
}
