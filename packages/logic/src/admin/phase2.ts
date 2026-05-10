/**
 * @ollie/logic · admin Phase 2 detectors
 *
 * A4  detectPaperworkSplit   — Steel 2007; Barkley 2012
 * A5  detectFirehoseDump     — Risko & Gilbert 2016; Masicampo 2011
 * A6  detectDeferChain       — Steel 2007; Barkley 2012
 * A8  detectTwoMinuteTask    — Allen GTD 2001/2015
 * A10 detectRecurringPattern — Einstein & McDaniel 2005
 *
 * All functions are pure: no Date.now(), no store reads, no DOM.
 * `now` comes from opts.now or history.now.
 */

import type {
  AdminHistory,
  AdminOpts,
  FirehoseDumpSignal,
  DeferChainSignal,
  TwoMinuteTaskSignal,
  RecurringPatternSignal,
  PaperworkSplitSignal,
  PaperworkSplitExistingSignal,
} from './types';
import { PAPERWORK_RE, IMPL_HINT_RE, FIREHOSE_STOPWORDS, SOURCES } from './constants';
import { resolveNow } from './helpers';

// ─── A4 ──────────────────────────────────────────────────────────────────

/**
 * detectPaperworkSplit — two paths:
 *   (a) dump_text classification → suggest GATHER+FILL
 *   (b) tasks scan → flag unsplit paperwork tasks
 * Returns single signal (dump path), array (tasks path), or null.
 */
export function detectPaperworkSplit(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): PaperworkSplitSignal | PaperworkSplitExistingSignal[] | null {
  const now = resolveNow(history, opts);
  const h = history ?? {};
  const dumpText = typeof opts.dump_text === 'string' ? opts.dump_text
    : typeof h.dump_text === 'string' ? h.dump_text : null;
  const tasks = Array.isArray(h.tasks) ? h.tasks
    : Array.isArray(opts.tasks) ? opts.tasks : null;

  if (dumpText && PAPERWORK_RE.test(dumpText)) {
    return {
      signal: 'admin_paperwork_split',
      dump_match: true,
      copy: 'paperwork tasks die monolithic. split into GATHER (collect documents) + FILL (fill them in)?',
      copy_es: 'el papeleo muere si se trata como un bloque. ¿lo partimos en JUNTAR (reúne documentos) + RELLENAR?',
      sources: [SOURCES.steel, SOURCES.barkley],
      ts: now,
    };
  }

  if (tasks && tasks.length > 0) {
    const out: PaperworkSplitExistingSignal[] = [];
    for (const t of tasks) {
      if (!t?.id) continue;
      const label = typeof t.label === 'string' ? t.label : '';
      if (!label || !PAPERWORK_RE.test(label)) continue;
      if (t.parent_task_id) continue;
      if (typeof t.stage === 'string' && t.stage) continue;
      out.push({
        signal: 'admin_paperwork_split_existing',
        task_id: t.id,
        copy: `${label.trim()} looks like paperwork. split into GATHER + FILL stages?`,
        copy_es: `${label.trim()} parece papeleo. ¿lo partimos en etapas JUNTAR + RELLENAR?`,
        sources: [SOURCES.steel, SOURCES.barkley],
        ts: now,
      });
    }
    if (out.length > 0) return out;
  }

  return null;
}

// ─── A5 ──────────────────────────────────────────────────────────────────

/**
 * detectFirehoseDump — single high-entropy unload.
 * Heuristic: ≥4 distinct content tokens, ≤25 total words, <120 chars,
 * no impl-hint, no sentence-mid punctuation.
 */
export function detectFirehoseDump(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): FirehoseDumpSignal | null {
  const now = resolveNow(history, opts);
  const h = history ?? {};
  const text = typeof opts.dump_text === 'string' ? opts.dump_text
    : typeof h.dump_text === 'string' ? h.dump_text : '';
  if (!text) return null;
  if (text.length >= 120) return null;
  if (/[.!?]/.test(text)) return null;
  if (IMPL_HINT_RE.test(text)) return null;

  const raw = text.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  if (raw.length === 0 || raw.length > 25) return null;

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const w of raw) {
    const lw = w.toLowerCase();
    if (lw.length <= 2) continue;
    if (FIREHOSE_STOPWORDS.has(lw)) continue;
    if (seen.has(lw)) continue;
    seen.add(lw);
    tokens.push(lw);
  }
  if (tokens.length < 4) return null;

  const candidates = tokens.slice(0, 12);
  return {
    signal: 'admin_firehose_dump',
    candidate_items: candidates,
    copy: `firehose dump detected — ${candidates.length} candidate admin items. split into separate tasks?`,
    copy_es: `volcado tipo manguera detectado — ${candidates.length} candidatos a tareas admin. ¿los separamos?`,
    sources: [SOURCES.risko, SOURCES.masicampo],
    ts: now,
  };
}

// ─── A6 ──────────────────────────────────────────────────────────────────

/**
 * detectDeferChain — task deferred ≥5 times → root-cause prompt.
 * Returns array sorted by defer_count desc, or null.
 */
export function detectDeferChain(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): DeferChainSignal[] | null {
  const now = resolveNow(history, opts);
  const minDefers = opts.minDefers ?? 5;
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const out: DeferChainSignal[] = [];
  for (const t of tasks) {
    if (!t?.id) continue;
    const dc = typeof t.defer_count === 'number' ? t.defer_count : 0;
    if (dc < minDefers) continue;
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'task';
    out.push({
      signal: 'admin_defer_chain',
      task_id: t.id,
      defer_count: dc,
      copy: `${label} deferred ${dc} times. phone? form? confrontation? root, not laziness.`,
      copy_es: `${label} aplazada ${dc} veces. ¿una llamada? ¿un formulario? ¿una confrontación? raíz, no pereza.`,
      sources: [SOURCES.steel, SOURCES.barkley],
      ts: now,
    });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => b.defer_count - a.defer_count);
  return out;
}

// ─── A8 ──────────────────────────────────────────────────────────────────

/**
 * detectTwoMinuteTask — active tasks with duration_min ≤ 2.
 * ≥5 tasks → batch = true (burst-session prompt).
 */
export function detectTwoMinuteTask(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): TwoMinuteTaskSignal | null {
  const now = resolveNow(history, opts);
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const taskIds: string[] = [];
  let firstLabel: string | null = null;
  for (const t of tasks) {
    if (!t?.id) continue;
    if (t.state !== 'active') continue;
    if (typeof t.duration_min !== 'number') continue;
    if (t.duration_min > 2) continue;
    taskIds.push(t.id);
    if (firstLabel === null) {
      firstLabel = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'task';
    }
  }
  const count = taskIds.length;
  if (count < 1) return null;
  const batch = count >= 5;
  const copy = batch
    ? `${count} micro-tasks under 2min each. burst session?`
    : `${firstLabel ?? 'task'} takes ≤2min. do it now beats deferring.`;
  return {
    signal: 'admin_two_minute_tasks',
    count,
    batch,
    task_ids: taskIds,
    copy,
    sources: [SOURCES.allen],
    ts: now,
  };
}

// ─── A10 ─────────────────────────────────────────────────────────────────

/**
 * detectRecurringPattern — annual-cadence learning across years.
 * Groups closed tasks by category (or first label token); group with ≥2
 * closures spanning ≥10 months → predict next occurrence; if within 30d,
 * surface.
 */
export function detectRecurringPattern(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): RecurringPatternSignal[] | null {
  const now = resolveNow(history, opts);
  const horizonDays = opts.horizonDays ?? 30;
  const minSpanMs = (opts.minSpanMonths ?? 10) * 30 * 86_400_000;
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const dayOfYear = (ts: number): number => {
    const d = new Date(ts);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((ts - start) / 86_400_000);
  };
  const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const tsForDayOfYear = (year: number, doy: number): number => {
    const max = isLeap(year) ? 365 : 364;
    const safe = Math.max(0, Math.min(max, doy));
    return Date.UTC(year, 0, 1) + safe * 86_400_000;
  };

  const groups = new Map<string, number[]>();
  for (const t of tasks) {
    if (!t?.id) continue;
    if (typeof t.closed_at !== 'number') continue;
    let key: string | null = null;
    if (typeof t.category === 'string' && t.category.trim()) {
      key = t.category.trim().toLowerCase();
    } else if (typeof t.label === 'string' && t.label.trim()) {
      const tok = t.label.trim().toLowerCase().split(/\s+/)[0];
      if (tok && tok.length > 1) key = tok;
    }
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t.closed_at);
  }
  if (groups.size === 0) return null;

  const out: RecurringPatternSignal[] = [];
  const nowYear = new Date(now).getUTCFullYear();
  for (const [key, closures] of groups) {
    if (closures.length < 2) continue;
    const minTs = Math.min(...closures);
    const maxTs = Math.max(...closures);
    if (maxTs - minTs < minSpanMs) continue;
    const meanDoy = Math.round(closures.reduce((s, c) => s + dayOfYear(c), 0) / closures.length);
    let predicted = tsForDayOfYear(nowYear, meanDoy);
    if (predicted < now) predicted = tsForDayOfYear(nowYear + 1, meanDoy);
    const daysUntil = Math.floor((predicted - now) / 86_400_000);
    if (daysUntil < 0 || daysUntil > horizonDays) continue;
    out.push({
      signal: 'admin_recurring_pattern',
      category_or_label: key,
      predicted_next_ts: predicted,
      days_until: daysUntil,
      history_count: closures.length,
      copy: `last year you did ${key} this month. ready?`,
      copy_es: `el año pasado hiciste ${key} este mes. ¿lista?`,
      sources: [SOURCES.einstein],
      ts: now,
    });
  }
  return out.length > 0 ? out : null;
}
