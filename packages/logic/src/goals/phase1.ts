/**
 * @ollie/logic · goals · phase 1
 *
 * G4 — detectLowMood      (Skirrow & Asherson 2013; Sirois & Pychyl 2013)
 * G6 — detectObstacleEcho (Oettingen 2014 WOOP; Gollwitzer 1999)
 * G7 — detectPreMortemEcho (Klein 2007; Kahneman 2011)
 * G15 — retrieveUlyssesContract / getUlyssesText (Ainslie 1992; Elster 1979)
 *
 * All pure: inputs → outputs, no DOM, no store reads, no Date.now() inside.
 * Mirrors void-app.html VOID.logic.goals IIFE lines 22535–22723.
 */

import { resolveNow, tokens } from './helpers';
import { SOURCES } from './sources';
import { LOW_MOOD_RE } from './lexicons';
import type {
  DumpHistory,
  GoalsHistory,
  GoalsOpts,
  LowMoodSignal,
  ObstacleEchoSignal,
  PreMortemEchoSignal,
  UlyssesContractSignal,
  UlyssesText,
} from './types';

// ─── G4 — detectLowMood ───────────────────────────────────────────────
// Gates G4 emotion lock. Scans dumps for low-mood markers; ≥3 hits in 7d
// OR ≥2 hits in 48h triggers a 72h delete-lock recommendation.

export function detectLowMood(
  history: DumpHistory | null | undefined,
  opts?: GoalsOpts | null,
): LowMoodSignal | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 7;
  const windowStart = now - windowDays * 86400000;
  const recentStart = now - 2 * 86400000;
  const min7d = typeof o.min7d === 'number' ? o.min7d : 3;
  const min48h = typeof o.min48h === 'number' ? o.min48h : 2;
  const lockHours = typeof o.lockHours === 'number' ? o.lockHours : 72;

  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  if (dumps.length === 0) return null;

  let count7d = 0;
  let count48h = 0;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!text) continue;
    if (LOW_MOOD_RE.test(text)) {
      count7d++;
      if (d.ts >= recentStart) count48h++;
    }
  }

  const fires = count7d >= min7d || count48h >= min48h;
  if (!fires) return null;

  const confidence = count7d >= 6 ? 'high' : count7d >= 4 ? 'medium' : 'low';
  const lock_until_ts = now + lockHours * 3600 * 1000;

  return {
    signal: 'goals_low_mood',
    confidence,
    evidence: [
      'matches:' + count7d,
      'matches_48h:' + count48h,
      'window_days:' + windowDays,
    ],
    copy: "you're in a trough. let's not delete anything until tuesday.",
    copy_es: 'estás en un bache. no borremos nada hasta el martes.',
    lock_until_ts,
    sources: [SOURCES.skirrow, SOURCES.skirrow2014, SOURCES.pychyl],
  };
}

// ─── G6 — detectObstacleEcho ──────────────────────────────────────────
// Mirrors the user's own predicted obstacle when matching language
// reappears in recent dumps. Returns ALL candidate matches; orchestrator
// throttles (one per goal per 72h).

export function detectObstacleEcho(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): ObstacleEchoSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 7;
  const minMatches = typeof o.minMatches === 'number' ? o.minMatches : 2;
  const windowStart = now - windowDays * 86400000;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  if (goals.length === 0 || dumps.length === 0) return null;

  const out: ObstacleEchoSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    const obstacle = typeof g.obstacle === 'string' ? g.obstacle.trim() : '';
    if (!obstacle) continue;
    const obstacleTokens = new Set(tokens(obstacle));
    if (obstacleTokens.size === 0) continue;

    for (const d of dumps) {
      if (!d || typeof d.ts !== 'number') continue;
      if (d.ts < windowStart || d.ts > now) continue;
      const dumpId = d.id || (typeof d.ts === 'number' ? 'ts:' + d.ts : null);
      if (!dumpId) continue;
      const text = String(d.rawText || d.text || '');
      if (!text) continue;
      const dumpTokens = tokens(text);
      let matches = 0;
      const seen = new Set<string>();
      for (const t of dumpTokens) {
        if (seen.has(t)) continue;
        if (obstacleTokens.has(t)) { matches++; seen.add(t); }
      }
      if (matches < minMatches) continue;

      out.push({
        signal: 'goals_obstacle_echo',
        goal_id: g.id,
        dump_id: dumpId,
        matches,
        copy: 'this was the obstacle you predicted at creation. expected, not surprise.',
        copy_es: 'este fue el obstáculo que predijiste al crear el objetivo. esperado, no sorpresa.',
        sources: [SOURCES.oettingen, SOURCES.gollwitzer],
      });
    }
  }
  return out.length === 0 ? null : out;
}

// ─── G7 — detectPreMortemEcho ─────────────────────────────────────────
// Mirrors the user's own premortem reasoning when matching language
// reappears, but only for dumps ≥30 days after goal creation.

export function detectPreMortemEcho(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): PreMortemEchoSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 7;
  const minMatches = typeof o.minMatches === 'number' ? o.minMatches : 3;
  const minAgeDays = typeof o.minAgeDays === 'number' ? o.minAgeDays : 30;
  const windowStart = now - windowDays * 86400000;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  if (goals.length === 0 || dumps.length === 0) return null;

  const out: PreMortemEchoSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    const premortem = typeof g.premortem === 'string' ? g.premortem.trim() : '';
    if (!premortem) continue;
    const createdAt = typeof g.created_at === 'number' ? g.created_at : null;
    if (createdAt === null) continue;
    const earliestEcho = createdAt + minAgeDays * 86400000;
    const pmTokens = new Set(tokens(premortem));
    if (pmTokens.size === 0) continue;

    for (const d of dumps) {
      if (!d || typeof d.ts !== 'number') continue;
      if (d.ts < windowStart || d.ts > now) continue;
      if (d.ts < earliestEcho) continue;
      const dumpId = d.id || (typeof d.ts === 'number' ? 'ts:' + d.ts : null);
      if (!dumpId) continue;
      const text = String(d.rawText || d.text || '');
      if (!text) continue;
      const dumpTokens = tokens(text);
      let matches = 0;
      const seen = new Set<string>();
      for (const t of dumpTokens) {
        if (seen.has(t)) continue;
        if (pmTokens.has(t)) { matches++; seen.add(t); }
      }
      if (matches < minMatches) continue;

      out.push({
        signal: 'goals_premortem_echo',
        goal_id: g.id,
        dump_id: dumpId,
        matches,
        copy: 'you predicted this exact reason at creation. your past self is louder than the trough.',
        copy_es: 'predijiste exactamente esta razón al crear el objetivo. tu yo pasado pesa más que el bache.',
        sources: [SOURCES.klein, SOURCES.kahneman],
      });
    }
  }
  return out.length === 0 ? null : out;
}

// ─── G15 — retrieveUlyssesContract ────────────────────────────────────
// Pure lookup. Surfaces user's own future-self note on delete/pause
// flow attempts. Returns null if no contract or if action is not
// 'delete' | 'pause'.

export function retrieveUlyssesContract(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): UlyssesContractSignal | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const goal = o.goal || null;
  const action = o.action || null;
  if (!goal || !goal.id) return null;
  if (action !== 'delete' && action !== 'pause') return null;
  const contract = typeof goal.ulysses_contract === 'string' ? goal.ulysses_contract.trim() : '';
  if (!contract) return null;

  return {
    signal: 'goals_ulysses_present',
    goal_id: goal.id,
    contract_text: contract,
    copy: 'before you ' + action + ', you wanted to remember: ' + contract,
    copy_es: 'antes de ' + action + ', querías recordar: ' + contract,
    ts: now,
    sources: [SOURCES.ainslie, SOURCES.elster],
  };
}

// ─── G15 — getUlyssesText ─────────────────────────────────────────────
// Extends retrieveUlyssesContract for non-delete callsites (dashboards /
// mirror lists). Pure lookup, no action required.

export function getUlyssesText(goal: { id?: string | null; ulysses_contract?: string } | null | undefined): UlyssesText | null {
  if (!goal) return null;
  const text = typeof goal.ulysses_contract === 'string' ? goal.ulysses_contract.trim() : '';
  if (!text) return null;
  return { goal_id: goal.id || null, text };
}
