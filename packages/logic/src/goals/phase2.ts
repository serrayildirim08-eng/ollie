/**
 * @ollie/logic · goals · phase 2
 *
 * G2  — detectActiveCap         (Merino-Soto 2023; choice overload)
 * G5  — detectResearchAsProgress (Steel 2007)
 * G11 — detectIdentityDrift     (Verplanken & Sui 2019)
 * G13 — detectSunkCostFlag      (Hupfeld 2019; Kahneman 2011)
 * G14 — classifyPacing          (Barkley 2012)
 *      — detectPacingBreach
 *
 * All pure: inputs → outputs, no DOM, no store reads, no Date.now() inside.
 * Mirrors void-app.html VOID.logic.goals IIFE lines 22737–23173.
 */

import { resolveNow, goalLabel } from './helpers';
import { SOURCES } from './sources';
import { DAY_MS } from '../util';
import type {
  GoalsHistory,
  GoalsOpts,
  Goal,
  ActiveCapSignal,
  ResearchAsProgressSignal,
  IdentityDriftSignal,
  SunkCostSignal,
  PacingClassifiedSignal,
  PacingBreachSignal,
  PacingKind,
} from './types';

const SIX_WEEKS  = 6 * 7 * DAY_MS;
const SIX_MONTHS = 6 * 30 * DAY_MS;

const PACING_DORMANCY_DAYS: Record<PacingKind, number> = {
  sprint: 7,
  marathon: 30,
  rolling: 14,
};

// Consent gate — mirrors void-app.html _consentOnGoals (line 23098).
// Reads opts.consent first; defaults to true when absent (consent layer not wired).
function _consentOnGoals(opts: GoalsOpts | null | undefined): boolean {
  if (opts && typeof opts.consent === 'boolean') return opts.consent;
  return true;
}

// ─── G14 — classifyPacing ─────────────────────────────────────────────
// Pure classifier on a single goal. Always returns an object (never null).
// Pacing precedence: explicit goal.pacing > inferred from target_date_ts > 'rolling'.
// Bands: ≤6w → sprint; >6w & ≤6mo → marathon; >6mo or no target → rolling.

export function classifyPacing(
  goal: Partial<Goal> | null | undefined,
  opts?: { now?: number } | null,
): PacingClassifiedSignal {
  const g = (goal && typeof goal === 'object') ? goal : {} as Partial<Goal>;
  const now = typeof opts?.now === 'number'
    ? opts.now
    : (typeof (g as Record<string, unknown>).now === 'number' ? (g as Record<string, number>).now : Date.now());

  let pacing: PacingKind;
  if (g.pacing === 'sprint' || g.pacing === 'marathon' || g.pacing === 'rolling') {
    pacing = g.pacing;
  } else if (typeof g.target_date_ts === 'number' && typeof g.created_at === 'number') {
    const span = g.target_date_ts - g.created_at;
    if (span <= SIX_WEEKS) pacing = 'sprint';
    else if (span <= SIX_MONTHS) pacing = 'marathon';
    else pacing = 'rolling';
  } else {
    pacing = 'rolling';
  }

  const dormancy_threshold_days: number | null =
    pacing === 'sprint' ? 10 :
    pacing === 'marathon' ? 60 :
    null;

  const copy = 'pacing: ' + pacing + (
    pacing === 'rolling'
      ? '. no staleness threshold — continuous goal.'
      : '. stales after ' + dormancy_threshold_days + ' days.'
  );

  return {
    signal: 'goals_pacing_classified',
    goal_id: g.id || null,
    pacing,
    dormancy_threshold_days,
    evidence: ['pacing:' + pacing, 'threshold:' + (dormancy_threshold_days === null ? 'null' : dormancy_threshold_days)],
    copy,
    sources: [SOURCES.barkley],
    ts: now,
  };
}

// ─── G2 — detectActiveCap ─────────────────────────────────────────────
// Counts goals with status 'active'. If > cap (default 5), returns signal.

export function detectActiveCap(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): ActiveCapSignal | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const cap = typeof o.cap === 'number' ? o.cap : 5;
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  if (goals.length === 0) return null;

  let active = 0;
  for (const g of goals) {
    if (!g || typeof g !== 'object') continue;
    if (g.status === 'active') active++;
  }
  if (active <= cap) return null;

  return {
    signal: 'goals_active_cap_exceeded',
    active_count: active,
    evidence: ['active:' + active, 'cap:' + cap],
    copy: 'you have ' + active + ' active goals. cap is ' + cap + ' — pick one to move to graveyard. cognitive load is real, even invisible.',
    copy_es: 'tienes ' + active + ' objetivos activos. el tope es ' + cap + ' — elige uno para mandarlo al cementerio. la carga cognitiva es real aunque sea invisible.',
    sources: [SOURCES.merino, SOURCES.choiceOverload],
    ts: now,
  };
}

// ─── G5 — detectResearchAsProgress ────────────────────────────────────
// For each active goal, count last contiguous run of 'thinking' sessions
// in the last 30d. If ≥5 thinking and 0 'doing' in window, surface.

export function detectResearchAsProgress(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): ResearchAsProgressSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 30;
  const minThinking = typeof o.minThinking === 'number' ? o.minThinking : 5;
  const windowStart = now - windowDays * DAY_MS;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const sessions = Array.isArray(history?.sessions) ? history!.sessions! : [];
  if (goals.length === 0 || sessions.length === 0) return null;

  const out: ResearchAsProgressSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;

    let thinking = 0;
    let doing = 0;
    const goalSessions = [];
    for (const s of sessions) {
      if (!s || typeof s.ts !== 'number') continue;
      if (s.goal_id !== g.id) continue;
      if (s.ts < windowStart || s.ts > now) continue;
      goalSessions.push(s);
      if (s.type === 'thinking') thinking++;
      else if (s.type === 'doing') doing++;
    }
    if (doing > 0) continue;
    if (thinking < minThinking) continue;

    // enforce contiguous: check sorted-desc last N are all thinking
    goalSessions.sort((a, b) => b.ts - a.ts);
    let contiguous = 0;
    for (const s of goalSessions) {
      if (s.type === 'thinking') contiguous++;
      else break;
    }
    if (contiguous < minThinking) continue;

    const label = goalLabel(g);
    out.push({
      signal: 'goals_research_as_progress',
      goal_id: g.id,
      thinking_count: thinking,
      evidence: ['thinking:' + thinking, 'doing:' + doing, 'window_days:' + windowDays],
      copy: label + ' — ' + thinking + ' thinking sessions, 0 doing. what\'s the smallest doing step?',
      copy_es: label + ' — ' + thinking + ' sesiones pensando, cero haciendo. ¿cuál es el paso más pequeño de hacer?',
      sources: [SOURCES.steel],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}

// ─── G11 — detectIdentityDrift ────────────────────────────────────────
// For each active goal with a non-empty `role`, look for role-aligned
// activity in last 30d. Zero matches → surface soft mirror.

export function detectIdentityDrift(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): IdentityDriftSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 30;
  const windowStart = now - windowDays * DAY_MS;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  const sessions = Array.isArray(history?.sessions) ? history!.sessions! : [];
  if (goals.length === 0) return null;

  const out: IdentityDriftSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const role = typeof g.role === 'string' ? g.role.trim() : '';
    if (!role) continue;
    const roleLower = role.toLowerCase();

    let matches = 0;
    for (const d of dumps) {
      if (!d || typeof d.ts !== 'number') continue;
      if (d.ts < windowStart || d.ts > now) continue;
      const text = String(d.rawText || d.text || '').toLowerCase();
      if (!text) continue;
      if (text.indexOf(roleLower) !== -1) { matches++; break; }
    }
    if (matches === 0) {
      for (const s of sessions) {
        if (!s || typeof s.ts !== 'number') continue;
        if (s.goal_id !== g.id) continue;
        if (s.ts < windowStart || s.ts > now) continue;
        if (s.type === 'doing') { matches++; break; }
      }
    }
    if (matches > 0) continue;

    out.push({
      signal: 'goals_identity_drift',
      goal_id: g.id,
      role,
      days_silent: windowDays,
      evidence: ['role:' + role, 'days_silent:' + windowDays],
      copy: role + ' role hasn\'t been touched in ' + windowDays + ' days. role changed, or season?',
      copy_es: 'el rol ' + role + ' lleva ' + windowDays + ' días sin tocarse. ¿cambió el rol o cambió la temporada?',
      sources: [SOURCES.verplanken],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}

// ─── G13 — detectSunkCostFlag ─────────────────────────────────────────
// For each goal with ≥3 reviews in the last 60d, if the last 3 reviews
// (by ts desc) are all 'invested', surface. Returns array or null.

export function detectSunkCostFlag(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): SunkCostSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 60;
  const minRun = typeof o.minRun === 'number' ? o.minRun : 3;
  const windowStart = now - windowDays * DAY_MS;

  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const reviews = Array.isArray(history?.reviews) ? history!.reviews! : [];
  if (goals.length === 0 || reviews.length === 0) return null;

  const byGoal = new Map<string, typeof reviews>();
  for (const r of reviews) {
    if (!r || typeof r.ts !== 'number') continue;
    if (r.ts < windowStart || r.ts > now) continue;
    if (!r.goal_id) continue;
    if (!byGoal.has(r.goal_id)) byGoal.set(r.goal_id, []);
    byGoal.get(r.goal_id)!.push(r);
  }

  const out: SunkCostSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    const list = byGoal.get(g.id);
    if (!list || list.length < minRun) continue;
    list.sort((a, b) => b.ts - a.ts);
    const lastN = list.slice(0, minRun);
    const allInvested = lastN.every(r => r && r.alive_flag === 'invested');
    if (!allInvested) continue;

    const label = goalLabel(g);
    out.push({
      signal: 'goals_sunk_cost_flag',
      goal_id: g.id,
      evidence: ['runs:' + minRun, 'window_days:' + windowDays],
      copy: label + ' — ' + minRun + ' reviews in a row \'already invested\', not \'still want\'. graveyard?',
      copy_es: label + ' — ' + minRun + ' revisiones seguidas marcadas como "ya metido", no "todavía quiero". ¿al cementerio?',
      sources: [SOURCES.hupfeld, SOURCES.kahnemanSunk],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}

// ─── G14 — detectPacingBreach ─────────────────────────────────────────
// For each active goal, resolve pacing and dormancy threshold, then check
// days since last 'doing' session. Breach → surface.

export function detectPacingBreach(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): PacingBreachSignal[] | null {
  const o = opts || {};
  if (!_consentOnGoals(o)) return null;
  const now = resolveNow(history, opts);
  const thresholds = o.dormancyDays || PACING_DORMANCY_DAYS;
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const sessions = Array.isArray(history?.sessions) ? history!.sessions! : [];
  if (goals.length === 0) return null;

  // Build last-doing map per goal_id
  const lastDoing = new Map<string, number>();
  for (const s of sessions) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.type !== 'doing') continue;
    if (!s.goal_id) continue;
    const cur = lastDoing.get(s.goal_id) || 0;
    if (s.ts > cur) lastDoing.set(s.goal_id, s.ts);
  }

  const out: PacingBreachSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;

    let pacing: PacingKind | null =
      (g.pacing === 'sprint' || g.pacing === 'marathon' || g.pacing === 'rolling')
        ? g.pacing : null;

    if (!pacing && typeof g.target_date_ts === 'number' && typeof g.created_at === 'number') {
      const cp = classifyPacing(g, { now });
      pacing = cp.pacing;
    }
    pacing = pacing || 'rolling';

    const maxDays = thresholds[pacing] ?? thresholds.rolling ?? 14;
    const lastActiveTs = lastDoing.get(g.id)
      ?? (typeof g.last_activity_at === 'number' ? g.last_activity_at : null)
      ?? (typeof g.created_at === 'number' ? g.created_at : now);
    const daysSince = Math.floor((now - lastActiveTs) / DAY_MS);
    if (daysSince < maxDays) continue;

    const label = goalLabel(g);
    out.push({
      signal: 'goals_pacing_breach',
      goal_id: g.id,
      pacing,
      days_since: daysSince,
      evidence: ['pacing:' + pacing, 'days_since:' + daysSince, 'threshold:' + maxDays],
      copy: pacing === 'sprint'
        ? label + ' — sprint goal, no doing in ' + daysSince + ' days. past the threshold.'
        : label + ' — no doing on this goal in ' + daysSince + ' days.',
      copy_es: pacing === 'sprint'
        ? 'objetivo sprint, sin actividad en ' + daysSince + ' días. ya pasó el umbral — vale la pena un check-in.'
        : 'sin actividad en este objetivo en ' + daysSince + ' días.',
      sources: [SOURCES.barkley],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}
