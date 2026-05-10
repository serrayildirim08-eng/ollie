/**
 * @ollie/logic · goals · phase 3
 *
 * G1  — detectContagion / isIncubating       (Aarts, Gollwitzer & Hassin 2004)
 * G3  — classifyAnchor / detectMissingAnchorPair (Oyserman & Destin 2010; Jones & Hesse 2018)
 * G8  — detectFloatingGoal                   (Jones & Hesse 2018)
 * G9  — detectMissingConstrual / construalFrameForState (Trope & Liberman 2010)
 * G10 — detectAntiGoalOpportunity / detectAntiGoalInDump (Elliot 1999)
 * G12 — detectGoalInterference
 * G16 — detectExperimentCandidate            (Dweck 2006)
 *
 * All pure: inputs → outputs, no DOM, no store reads, no Date.now() inside.
 * Mirrors void-app.html VOID.logic.goals IIFE lines 22982–23644.
 *
 * NOTE: _consentOnGoals is omitted — it read window.VOID.consent which is
 * a browser global. Callers pass consent via opts.consent if needed.
 */

import { resolveNow, tokens, goalLabel } from './helpers';
import { SOURCES } from './sources';
import { EXTERNAL_TRIGGER_RE, ANTI_GOAL_RE } from './lexicons';
import type {
  GoalsHistory,
  GoalsOpts,
  Goal,
  AnchorType,
  ConstrualFrame,
  ContagionSignal,
  MissingAnchorPairSignal,
  FloatingGoalSignal,
  MissingConstrualSignal,
  AntiGoalOpportunitySignal,
  AntiGoalInDumpSignal,
  GoalInterferenceSignal,
  ExperimentCandidateSignal,
} from './types';

const CYCLE_TOKENS = ["just because", "i don't know", "don't know", "dunno", "idk", "no idea", "not sure"];

const CONFLICT_PAIRS: Array<[string, string]> = [
  ['spend', 'save'],
  ['social', 'solo'],
  ['deep', 'broad'],
  ['night', 'morning'],
  ['structured', 'spontaneous'],
  ['high-ef', 'high-ef'],
];

// ─── G1 — detectContagion ─────────────────────────────────────────────
// Detects externally-primed goals from recent dumps. Returns signal if
// ≥1 external-trigger match found within windowDays (default 3).

export function detectContagion(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): ContagionSignal | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 3;
  const minMatches = typeof o.minMatches === 'number' ? o.minMatches : 1;
  const windowStart = now - windowDays * 86400000;

  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  if (dumps.length === 0) return null;

  let matches = 0;
  let firstExcerpt: string | null = null;
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!text) continue;
    const m = EXTERNAL_TRIGGER_RE.exec(text);
    if (m) {
      matches++;
      if (!firstExcerpt) {
        firstExcerpt = text.slice(Math.max(0, m.index - 10), m.index + 40).trim();
      }
    }
  }
  if (matches < minMatches) return null;

  return {
    signal: 'goals_contagion',
    matches,
    source_excerpt: firstExcerpt,
    evidence: ['matches:' + matches, 'window_days:' + windowDays],
    copy: 'this goal came from outside. sit with it for 7 days before committing.',
    copy_es: 'este objetivo vino de fuera. siéntate con él 7 días antes de comprometerte.',
    sources: [SOURCES.aarts],
    ts: now,
  };
}

// ─── G1 — isIncubating ────────────────────────────────────────────────
// Returns true if goal.incubation_until is in the future.

export function isIncubating(
  goal: Partial<Goal> | null | undefined,
  opts?: { now?: number } | null,
): boolean {
  if (!goal || typeof goal.incubation_until !== 'number') return false;
  const now = typeof opts?.now === 'number' ? opts.now : Date.now();
  return goal.incubation_until > now;
}

// ─── G3 — classifyAnchor ─────────────────────────────────────────────
// Returns goal.anchor_type if valid ('identity' | 'metric'), else null.

const ANCHOR_TYPES: AnchorType[] = ['identity', 'metric'];

export function classifyAnchor(goal: Partial<Goal> | null | undefined): AnchorType | null {
  if (!goal || !ANCHOR_TYPES.includes(goal.anchor_type as AnchorType)) return null;
  return goal.anchor_type as AnchorType;
}

// ─── G3 — detectMissingAnchorPair ─────────────────────────────────────
// Identity goals must have construal_concrete. Metric goals must have
// construal_abstract. Surfaces missing half.

export function detectMissingAnchorPair(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): MissingAnchorPairSignal[] | null {
  const now = resolveNow(history, opts);
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  if (goals.length === 0) return null;

  const out: MissingAnchorPairSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const anchor = classifyAnchor(g);
    if (!anchor) continue;
    const label = goalLabel(g);

    if (anchor === 'identity' && (!g.construal_concrete || !String(g.construal_concrete).trim())) {
      out.push({
        signal: 'goals_missing_anchor_pair',
        goal_id: g.id,
        anchor_type: anchor,
        missing: 'concrete',
        evidence: ['anchor:identity', 'missing:concrete'],
        copy: label + ' — identity goal needs one concrete behavior to make it real. what would that look like this week?',
        copy_es: label + ' — un objetivo de identidad necesita un comportamiento concreto para hacerlo real. ¿cómo se vería esta semana?',
        sources: [SOURCES.oysermanDestin, SOURCES.jonesHesse],
        ts: now,
      });
    } else if (anchor === 'metric' && (!g.construal_abstract || !String(g.construal_abstract).trim())) {
      out.push({
        signal: 'goals_missing_anchor_pair',
        goal_id: g.id,
        anchor_type: anchor,
        missing: 'abstract',
        evidence: ['anchor:metric', 'missing:abstract'],
        copy: label + ' — metric goal needs a "who am I becoming" anchor, otherwise it\'s just a number. what\'s the bigger picture?',
        copy_es: label + ' — un objetivo métrico necesita un anclaje de "en quién me convierto", si no es solo un número. ¿cuál es el cuadro más grande?',
        sources: [SOURCES.oysermanDestin, SOURCES.jonesHesse],
        ts: now,
      });
    }
  }
  return out.length === 0 ? null : out;
}

// ─── G8 — detectFloatingGoal ──────────────────────────────────────────
// Detects shallow (<3 why_chain), dead-end (circular/idk tokens), or
// circular (repeated tokens across chain entries) why-chains.

export function detectFloatingGoal(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): FloatingGoalSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const minDepth = typeof o.minDepth === 'number' ? o.minDepth : 3;
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  if (goals.length === 0) return null;

  const out: FloatingGoalSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const chain = Array.isArray(g.why_chain)
      ? g.why_chain.filter(w => typeof w === 'string' && w.trim())
      : [];
    if (chain.length === 0) continue;

    const label = goalLabel(g);

    // Shallow
    if (chain.length < minDepth) {
      const more = minDepth - chain.length;
      out.push({
        signal: 'goals_floating_goal',
        goal_id: g.id,
        reason: 'shallow',
        depth: chain.length,
        evidence: ['depth:' + chain.length, 'min:' + minDepth],
        copy: label + ' — the why behind this goal is still shallow. ask "why" ' + more + ' more time' + (more > 1 ? 's' : '') + ' to find the real root.',
        copy_es: label + ' — el porqué de este objetivo sigue superficial. pregunta "por qué" ' + more + ' ' + (more > 1 ? 'veces más' : 'vez más') + ' para encontrar la raíz real.',
        sources: [SOURCES.jonesHesse],
        ts: now,
      });
      continue;
    }

    // Dead-end
    let deadEnd = false;
    for (let i = 0; i < Math.min(chain.length, 3); i++) {
      const low = chain[i].toLowerCase();
      if (CYCLE_TOKENS.some(t => low.indexOf(t) !== -1)) {
        out.push({
          signal: 'goals_floating_goal',
          goal_id: g.id,
          reason: 'dead-end',
          depth: i + 1,
          evidence: ['reason:dead-end', 'depth:' + (i + 1)],
          copy: label + ' — the chain stops at "' + chain[i].trim() + '". that\'s a floating goal — no terminal value found yet.',
          copy_es: label + ' — la cadena se detiene en "' + chain[i].trim() + '". es un objetivo flotando — todavía no hay valor terminal.',
          sources: [SOURCES.jonesHesse],
          ts: now,
        });
        deadEnd = true;
        break;
      }
    }
    if (deadEnd) continue;

    // Circular
    const normalised = chain.map(w => tokens(w.toLowerCase()).sort().join(' '));
    let circular = false;
    for (let i = 0; i < normalised.length && !circular; i++) {
      for (let j = i + 1; j < normalised.length; j++) {
        if (normalised[i].length > 0 && normalised[i] === normalised[j]) {
          out.push({
            signal: 'goals_floating_goal',
            goal_id: g.id,
            reason: 'circular',
            depth: j + 1,
            evidence: ['reason:circular', 'i:' + (i + 1), 'j:' + (j + 1)],
            copy: label + ' — the why-chain is going in circles. entries ' + (i + 1) + ' and ' + (j + 1) + ' say the same thing.',
            copy_es: label + ' — la cadena de porqués va en círculos. las entradas ' + (i + 1) + ' y ' + (j + 1) + ' dicen lo mismo.',
            sources: [SOURCES.jonesHesse],
            ts: now,
          });
          circular = true;
          break;
        }
      }
    }
  }
  return out.length === 0 ? null : out;
}

// ─── G9 — detectMissingConstrual ──────────────────────────────────────
// Surfaces goals missing one of the two construal-level fields.

export function detectMissingConstrual(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): MissingConstrualSignal[] | null {
  const now = resolveNow(history, opts);
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  if (goals.length === 0) return null;

  const out: MissingConstrualSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const hasAbstract = typeof g.construal_abstract === 'string' && g.construal_abstract.trim().length > 0;
    const hasConcrete = typeof g.construal_concrete === 'string' && g.construal_concrete.trim().length > 0;
    if (hasAbstract && hasConcrete) continue;
    const label = goalLabel(g);
    out.push({
      signal: 'goals_missing_construal',
      goal_id: g.id,
      missing: hasAbstract ? 'concrete' : 'abstract',
      evidence: ['missing:' + (hasAbstract ? 'concrete' : 'abstract')],
      copy: hasAbstract
        ? label + ' — this goal needs one concrete micro-behavior. abstract intention without a first step stays abstract.'
        : label + ' — this goal needs a "who you\'re becoming" anchor. concrete steps without meaning drift.',
      copy_es: hasAbstract
        ? 'este objetivo necesita un microcomportamiento concreto. la intención abstracta sin primer paso se queda abstracta.'
        : 'este objetivo necesita un anclaje de "en quién te conviertes". los pasos concretos sin sentido se desvían.',
      sources: [SOURCES.tropeLiberman],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}

// ─── G9 — construalFrameForState ──────────────────────────────────────
// Returns the appropriate construal frame based on EF state.
// low EF → abstract; high EF → concrete.

export function construalFrameForState(
  goal: Partial<Goal> | null | undefined,
  efState: 'low' | 'high' | string,
  opts?: GoalsOpts | null,
): ConstrualFrame | null {
  if (!goal) return null;
  if (efState === 'low' && typeof goal.construal_abstract === 'string' && goal.construal_abstract.trim()) {
    return {
      frame: 'abstract',
      text: goal.construal_abstract.trim(),
      copy: 'low energy day. zoom out: ' + goal.construal_abstract.trim(),
      copy_es: 'día de baja energía. zoom out: ' + goal.construal_abstract.trim(),
    };
  }
  if (efState === 'high' && typeof goal.construal_concrete === 'string' && goal.construal_concrete.trim()) {
    return {
      frame: 'concrete',
      text: goal.construal_concrete.trim(),
      copy: 'energy is up. today\'s step: ' + goal.construal_concrete.trim(),
      copy_es: 'la energía está arriba. paso de hoy: ' + goal.construal_concrete.trim(),
    };
  }
  return null;
}

// ─── G10 — detectAntiGoalOpportunity ──────────────────────────────────
// For stuck active goals (no doing in stuckDays), surface anti-goal
// framing. If goal has anti_goal set, mirror it; otherwise suggest.

export function detectAntiGoalOpportunity(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): AntiGoalOpportunitySignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const stuckDays = typeof o.stuckDays === 'number' ? o.stuckDays : 14;
  const stuckMs = stuckDays * 86400000;
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const sessions = Array.isArray(history?.sessions) ? history!.sessions! : [];
  if (goals.length === 0) return null;

  const lastDoing = new Map<string, number>();
  for (const s of sessions) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.type !== 'doing') continue;
    if (!s.goal_id) continue;
    const cur = lastDoing.get(s.goal_id) || 0;
    if (s.ts > cur) lastDoing.set(s.goal_id, s.ts);
  }

  const out: AntiGoalOpportunitySignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const lastDoingTs = lastDoing.get(g.id) ?? null;
    const isStuck = lastDoingTs === null || (now - lastDoingTs) > stuckMs;
    if (!isStuck) continue;
    const label = goalLabel(g);

    if (typeof g.anti_goal === 'string' && g.anti_goal.trim()) {
      out.push({
        signal: 'goals_anti_goal_opportunity',
        goal_id: g.id,
        mode: 'avoidance',
        anti_goal: g.anti_goal.trim(),
        evidence: ['mode:avoidance'],
        copy: label + ' — approach isn\'t moving it. flip: "' + g.anti_goal.trim() + '" — is that still true?',
        copy_es: label + ' — la aproximación no lo mueve. dale la vuelta: "' + g.anti_goal.trim() + '" — ¿sigue siendo cierto?',
        sources: [SOURCES.elliot],
        ts: now,
      });
    } else {
      out.push({
        signal: 'goals_anti_goal_opportunity',
        goal_id: g.id,
        mode: 'suggest',
        evidence: ['mode:suggest'],
        copy: label + ' — approach isn\'t moving this. what do you NOT want to become here? that might be the real engine.',
        copy_es: label + ' — la aproximación no mueve esto. ¿en qué NO quieres convertirte aquí? puede que ese sea el motor real.',
        sources: [SOURCES.elliot],
        ts: now,
      });
    }
  }
  return out.length === 0 ? null : out;
}

// ─── G10 — detectAntiGoalInDump ───────────────────────────────────────
// Scans recent dumps for avoidance language. Returns first match.

export function detectAntiGoalInDump(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): AntiGoalInDumpSignal | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const windowDays = typeof o.windowDays === 'number' ? o.windowDays : 7;
  const windowStart = now - windowDays * 86400000;
  const dumps = Array.isArray(history?.dumps) ? history!.dumps! : [];
  if (dumps.length === 0) return null;

  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText || d.text || '');
    if (!text) continue;
    const m = ANTI_GOAL_RE.exec(text);
    if (!m) continue;
    const excerpt = text.slice(Math.max(0, m.index), m.index + 60).trim();
    return {
      signal: 'goals_anti_goal_in_dump',
      excerpt,
      evidence: ['excerpt:' + excerpt.slice(0, 30)],
      copy: 'you named something you want to avoid. worth saving as an anti-goal?',
      copy_es: 'nombraste algo que quieres evitar. ¿vale la pena guardarlo como anti-objetivo?',
      sources: [SOURCES.elliot],
      ts: now,
    };
  }
  return null;
}

// ─── G12 — detectGoalInterference ─────────────────────────────────────
// Detects conflicting resource tags across pairs of active goals.

export function detectGoalInterference(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): GoalInterferenceSignal | null {
  const now = resolveNow(history, opts);
  const all = Array.isArray(history?.goals) ? history!.goals! : [];
  const goals = all.filter(g => g && g.id && (!g.status || g.status === 'active'));
  if (goals.length < 2) return null;

  const conflicts: GoalInterferenceSignal['conflicts'] = [];
  for (let i = 0; i < goals.length; i++) {
    for (let j = i + 1; j < goals.length; j++) {
      const tagsA = Array.isArray(goals[i].interference_tags) ? goals[i].interference_tags! : [];
      const tagsB = Array.isArray(goals[j].interference_tags) ? goals[j].interference_tags! : [];
      for (const [pA, pB] of CONFLICT_PAIRS) {
        if (pA === pB) {
          if (tagsA.includes(pA) && tagsB.includes(pB)) {
            conflicts.push({ goal_a_id: goals[i].id, goal_b_id: goals[j].id, tag_a: pA, tag_b: pB });
          }
        } else {
          if ((tagsA.includes(pA) && tagsB.includes(pB)) || (tagsA.includes(pB) && tagsB.includes(pA))) {
            const foundA = tagsA.includes(pA) ? pA : pB;
            const foundB = tagsA.includes(pA) ? pB : pA;
            conflicts.push({ goal_a_id: goals[i].id, goal_b_id: goals[j].id, tag_a: foundA, tag_b: foundB });
          }
        }
      }
    }
  }
  if (conflicts.length === 0) return null;

  return {
    signal: 'goals_interference',
    conflicts,
    evidence: ['conflict_count:' + conflicts.length],
    copy: conflicts.length === 1
      ? 'two active goals share opposing resources (' + conflicts[0].tag_a + ' vs ' + conflicts[0].tag_b + '). are these eating each other?'
      : conflicts.length + ' goal pairs share opposing resources. are some of these cancelling each other out?',
    copy_es: conflicts.length === 1
      ? 'dos objetivos activos comparten recursos opuestos (' + conflicts[0].tag_a + ' vs ' + conflicts[0].tag_b + '). ¿se están comiendo entre ellos?'
      : conflicts.length + ' pares de objetivos comparten recursos opuestos. ¿algunos se están cancelando entre sí?',
    sources: [SOURCES.barkley],
    ts: now,
  };
}

// ─── G16 — detectExperimentCandidate ──────────────────────────────────
// Goals quiet for ≥4 weeks get reframed as testable hypotheses.

export function detectExperimentCandidate(
  history: GoalsHistory | null | undefined,
  opts?: GoalsOpts | null,
): ExperimentCandidateSignal[] | null {
  const o = opts || {};
  const now = resolveNow(history, opts);
  const stuckWeeks = typeof o.stuckWeeks === 'number' ? o.stuckWeeks : 4;
  const stuckMs = stuckWeeks * 7 * 86400000;
  const goals = Array.isArray(history?.goals) ? history!.goals! : [];
  const sessions = Array.isArray(history?.sessions) ? history!.sessions! : [];
  if (goals.length === 0) return null;

  const lastDoing = new Map<string, number>();
  for (const s of sessions) {
    if (!s || typeof s.ts !== 'number') continue;
    if (s.type !== 'doing') continue;
    if (!s.goal_id) continue;
    const cur = lastDoing.get(s.goal_id) || 0;
    if (s.ts > cur) lastDoing.set(s.goal_id, s.ts);
  }

  const out: ExperimentCandidateSignal[] = [];
  for (const g of goals) {
    if (!g || !g.id) continue;
    if (g.status && g.status !== 'active') continue;
    const lastDoingTs = lastDoing.get(g.id)
      ?? (typeof g.created_at === 'number' ? g.created_at : now);
    const sinceMs = now - lastDoingTs;
    if (sinceMs < stuckMs) continue;
    const weeksStuck = Math.floor(sinceMs / (7 * 86400000));
    const hasHypothesis = typeof g.hypothesis === 'string' && g.hypothesis.trim().length > 0;
    const label = goalLabel(g);

    out.push({
      signal: 'goals_experiment_candidate',
      goal_id: g.id,
      weeks_stuck: weeksStuck,
      has_hypothesis: hasHypothesis,
      evidence: ['weeks_stuck:' + weeksStuck, 'has_hypothesis:' + hasHypothesis],
      copy: hasHypothesis
        ? label + ' — this has been an experiment for ' + weeksStuck + ' weeks. what\'s the evidence so far — does the hypothesis hold?'
        : label + ' — this goal has been quiet for ' + weeksStuck + ' weeks. what if it\'s a hypothesis, not a promise? what are you testing?',
      copy_es: hasHypothesis
        ? 'esto lleva ' + weeksStuck + ' semanas como experimento. ¿qué evidencia hay hasta ahora — sigue en pie la hipótesis?'
        : 'este objetivo lleva ' + weeksStuck + ' semanas en silencio. ¿y si es una hipótesis, no una promesa? ¿qué estás probando?',
      sources: [SOURCES.dweck],
      ts: now,
    });
  }
  return out.length === 0 ? null : out;
}
