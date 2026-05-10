/**
 * @ollie/logic · admin Phase 2/3 additions
 *
 * A11 efCost / efStateFromDump / sortByState  — Volkow 2009
 * A14 getDocRefs / addDocRef                  — Baddeley 1986
 * A7  parseCostOfDelay / surfaceCostOfDelay   — Kahneman 1979; Barkley 2011
 * A13 detectRecurringDecision / buildDecisionRecall — Baumeister 1998; Ariely 2002
 * A15 detectScheduleFromDump / detectScheduleDrift  — Barkley 2011
 *
 * All functions are pure: no Date.now(), no store reads, no DOM.
 */

import type {
  AdminTask,
  AdminOpts,
  AdminState,
  DocRef,
  CostOfDelayParsed,
  CostOfDelaySurface,
  DecisionRecall,
  DecisionRule,
  ScheduleDetected,
  ScheduleDrift,
  EFState,
} from './types';
import {
  PHONE_RE,
  PAPERWORK_RE,
  EF_EMAIL_RE,
  EF_WEB_RE,
  EF_CLICK_RE,
  PEAK_RE,
  LOW_EF_RE,
  CRASH_RE,
  DELAY_CUE_RE,
  SCHEDULE_RE,
  DECISION_TOPIC_RE,
} from './constants';
import { consentOnAdmin } from './helpers';

// ─── A11 trio ────────────────────────────────────────────────────────────

/**
 * efCost — return EF tier (1–5) for a task.
 * Prefers explicit task.ef_cost when present.
 */
export function efCost(task: AdminTask | string | null | undefined): EFState {
  const text =
    task && typeof task === 'object'
      ? (typeof task.title === 'string' ? task.title : typeof task.label === 'string' ? task.label : '')
      : typeof task === 'string'
      ? task
      : '';
  if (task && typeof task === 'object' && typeof task.ef_cost === 'number'
      && task.ef_cost >= 1 && task.ef_cost <= 5) {
    return task.ef_cost as EFState;
  }
  if (!text) return 3;
  if (PHONE_RE.test(text)) return 5;
  if (PAPERWORK_RE.test(text)) return 4;
  if (EF_EMAIL_RE.test(text)) return 3;
  if (EF_WEB_RE.test(text)) return 2;
  if (EF_CLICK_RE.test(text)) return 1;
  return 3;
}

/**
 * efStateFromDump — map free-form dump to numeric EF state.
 * crash→1, low→2, ok→3 (default), peak→5.
 */
export function efStateFromDump(dumpText: string): EFState {
  if (typeof dumpText !== 'string' || dumpText.length === 0) return 3;
  if (CRASH_RE.test(dumpText)) return 1;
  if (LOW_EF_RE.test(dumpText)) return 2;
  if (PEAK_RE.test(dumpText)) return 5;
  return 3;
}

/**
 * sortByState — return tasks whose EF cost ≤ user's current EF state,
 * sorted ascending by cost.
 */
export function sortByState(
  tasks: AdminTask[],
  state: EFState | string,
  opts: AdminOpts = {},
): AdminTask[] {
  if (!consentOnAdmin(opts)) return [];
  if (!Array.isArray(tasks)) return [];
  const stateNum: EFState = typeof state === 'number'
    ? (state as EFState)
    : efStateFromDump(state as string);
  const tagged = tasks.map((t) => ({ t, c: efCost(t) }));
  return tagged
    .filter((x) => x.c <= stateNum)
    .sort((a, b) => a.c - b.c)
    .map((x) => x.t);
}

// ─── A14 ─────────────────────────────────────────────────────────────────

/** getDocRefs — return valid doc refs attached to a task. */
export function getDocRefs(task: AdminTask | null | undefined): DocRef[] {
  if (!task || !Array.isArray(task.doc_refs)) return [];
  return task.doc_refs.filter((r): r is DocRef => r != null && typeof r.label === 'string');
}

/** addDocRef — return new task object with doc ref appended (immutable). */
export function addDocRef(
  task: AdminTask,
  label: string,
  link?: string,
): AdminTask {
  if (!task || typeof label !== 'string' || label.trim().length === 0) return task;
  const existing = Array.isArray(task.doc_refs) ? task.doc_refs.slice() : [];
  existing.push({ label: label.trim(), link: typeof link === 'string' ? link.trim() : '' });
  return { ...task, doc_refs: existing };
}

// ─── A7 ──────────────────────────────────────────────────────────────────

/**
 * parseCostOfDelay — extract cost-of-delay pattern from dump text.
 * Returns null when consent is off or no cue found.
 */
export function parseCostOfDelay(
  text: string,
  opts: AdminOpts = {},
): CostOfDelayParsed | null {
  if (!consentOnAdmin(opts)) return null;
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  if (!DELAY_CUE_RE.test(text)) return null;
  return { pattern: 'cost-of-delay', cost_text: text.trim() };
}

/**
 * surfaceCostOfDelay — surface the stored cost_of_delay on a task when
 * deferred ≥2 times or past its scheduled_at.
 */
export function surfaceCostOfDelay(
  task: AdminTask | null | undefined,
  opts: AdminOpts = {},
): CostOfDelaySurface | null {
  if (!consentOnAdmin(opts)) return null;
  if (!task || typeof task !== 'object') return null;
  if (task.closed_at) return null;
  const cost = typeof task.cost_of_delay === 'string' ? task.cost_of_delay.trim() : null;
  if (!cost) return null;
  const deferThreshold = typeof opts.deferThreshold === 'number' ? opts.deferThreshold : 2;
  const deferCount =
    typeof task.deferred_count === 'number' ? task.deferred_count
    : typeof task.defer_count === 'number' ? task.defer_count
    : 0;
  const now = typeof opts.now === 'number' ? opts.now : null;
  const pastSchedule = now !== null && typeof task.scheduled_at === 'number' && now > task.scheduled_at;
  if (deferCount < deferThreshold && !pastSchedule) return null;
  return {
    task_id: task.id,
    cost_of_delay: cost,
    copy: `what happens if you keep waiting: ${cost}`,
    copy_es: `qué pasa si sigues esperando: ${cost}`,
  };
}

// ─── A13 ─────────────────────────────────────────────────────────────────

const _A13_STRIP_RE =
  /\b(20\d\d|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d+(?:st|nd|rd|th)?)\b/gi;
const _A13_STOP_RE = /\b(a|an|the|to|for|of|and|or|my|this|that|it)\b/gi;

function a13NormalizeTitle(title: string): string {
  if (typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(_A13_STRIP_RE, '')
    .replace(_A13_STOP_RE, '')
    .replace(/[^a-zÀ-ɏ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** buildDecisionRecall — build copy from a stored decision rule. */
export function buildDecisionRecall(rule: DecisionRule | null | undefined): DecisionRecall | null {
  if (!rule?.choice) return null;
  return {
    rule_id: rule.id,
    topic_key: rule.topic_key,
    choice: rule.choice,
    copy: `last time you went with: ${rule.choice}. same call, or you want to re-decide?`,
    copy_es: `la última vez fuiste con: ${rule.choice}. ¿igual, o quieres volver a decidir?`,
  };
}

/**
 * detectRecurringDecision — cross-reference dump text against stored
 * decision rules. Requires ≥2 overlapping words and decision-topic keyword.
 */
export function detectRecurringDecision(
  dumpText: string,
  state: AdminState | null | undefined,
  opts: AdminOpts = {},
): DecisionRecall | null {
  if (!consentOnAdmin(opts)) return null;
  if (typeof dumpText !== 'string' || dumpText.trim().length === 0) return null;
  if (!DECISION_TOPIC_RE.test(dumpText)) return null;
  const topicKey = a13NormalizeTitle(dumpText).split(/\s+/).slice(0, 6).join(' ').trim();
  if (!topicKey) return null;
  const rules: DecisionRule[] = state && Array.isArray(state.decision_rules) ? state.decision_rules : [];
  const dumpWords = new Set(topicKey.split(/\s+/).filter((w) => w.length > 2));
  let bestRule: DecisionRule | null = null;
  let bestScore = 0;
  for (const r of rules) {
    if (!r || r.revoked) continue;
    const ruleWords = (r.topic_key ?? '').split(/\s+/).filter((w) => w.length > 2);
    let shared = 0;
    for (const w of ruleWords) { if (dumpWords.has(w)) shared++; }
    if (shared >= 2 && shared > bestScore) {
      bestScore = shared;
      bestRule = r;
    }
  }
  if (!bestRule) return null;
  return buildDecisionRecall(bestRule);
}

// ─── A15 ─────────────────────────────────────────────────────────────────

const SCHEDULE_DRIFT_THRESHOLD = 3;

/**
 * detectScheduleFromDump — detect "I scheduled it" language in a dump.
 * Returns pattern tag or null.
 */
export function detectScheduleFromDump(
  dumpText: string,
  opts: AdminOpts = {},
): ScheduleDetected | null {
  if (!consentOnAdmin(opts)) return null;
  if (typeof dumpText !== 'string' || dumpText.trim().length === 0) return null;
  if (!SCHEDULE_RE.test(dumpText)) return null;
  return { pattern: 'scheduled-detected', raw: dumpText.trim() };
}

/**
 * detectScheduleDrift — find categories where last N entries are all
 * scheduled-but-not-done. ADHD scheduling-as-action illusion (Barkley 2011).
 */
export function detectScheduleDrift(
  state: AdminState | null | undefined,
  opts: AdminOpts = {},
): ScheduleDrift[] {
  if (!consentOnAdmin(opts)) return [];
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : SCHEDULE_DRIFT_THRESHOLD;
  const log = state && Array.isArray(state.scheduled_log) ? state.scheduled_log : [];
  if (log.length === 0) return [];

  const byCategory: Record<string, typeof log> = {};
  for (const entry of log) {
    if (!entry) continue;
    const cat = typeof entry.category === 'string' ? entry.category : 'general';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(entry);
  }

  const out: ScheduleDrift[] = [];
  for (const [category, entries] of Object.entries(byCategory)) {
    if (entries.length < threshold) continue;
    const recent = entries.slice(-threshold);
    const allScheduledNotDone = recent.every((e) => e.scheduled_at && !e.done_at);
    if (!allScheduledNotDone) continue;
    out.push({
      category,
      drift_count: threshold,
      task_ids: recent.map((e) => e.task_id),
      copy: `you've scheduled "${category}" ${threshold} times without doing it. scheduling and doing are not the same thing.`,
      copy_es: `has agendado "${category}" ${threshold} veces sin hacerlo. agendar y hacer no son lo mismo.`,
    });
  }
  return out;
}
