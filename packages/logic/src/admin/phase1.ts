/**
 * @ollie/logic · admin Phase 1 detectors
 *
 * A1  detectOpenLoopMissing  — Masicampo & Baumeister 2011
 * A2  detectPhoneTask        — Reid & Reid 2007; telephobia PMC11213418
 * A3  scheduleRenewalCues    — Altgassen 2014; Mioni 2025
 * A9  detectStaleBall        — Barkley 2012
 * A11 classifyActivationCost — Volkow et al. 2009
 * A12 detectLast5Pct         — Barkley 2012
 *
 * All functions are pure: no Date.now(), no store reads, no DOM.
 * `now` comes from opts.now or history.now.
 */

import type {
  AdminHistory,
  AdminOpts,
  AdminTask,
  OpenLoopSignal,
  PhoneTaskSignal,
  RenewalCueSignal,
  StaleBallSignal,
  ActivationCostSignal,
  Last5PctSignal,
} from './types';
import {
  OPEN_LOOP_RE,
  IF_THEN_RE,
  PHONE_RE,
  FORM_RE,
  EMAIL_RE,
  WEB_RE,
  ONECLICK_RE,
  SOURCES,
} from './constants';
import { resolveNow } from './helpers';
import { DAY_MS } from '../util';

// ─── A1 ──────────────────────────────────────────────────────────────────

/**
 * detectOpenLoopMissing — surfaces dumps that signal an open loop (I should…)
 * but contain no implementation hint (when/where/after). Window: last 24h.
 */
export function detectOpenLoopMissing(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): OpenLoopSignal[] | null {
  const now = resolveNow(history, opts);
  const windowHours = opts.windowHours ?? 24;
  const windowStart = now - windowHours * 3600 * 1000;

  const dumps = Array.isArray(history?.dumps) ? history!.dumps : [];
  if (dumps.length === 0) return null;

  const out: OpenLoopSignal[] = [];
  for (const d of dumps) {
    if (!d || typeof d.ts !== 'number') continue;
    if (d.ts < windowStart || d.ts > now) continue;
    const text = String(d.rawText ?? d.text ?? '');
    if (!text) continue;
    if (!OPEN_LOOP_RE.test(text)) continue;
    if (IF_THEN_RE.test(text)) continue;
    const dumpId = d.id ?? ('ts:' + d.ts);
    out.push({
      signal: 'admin_open_loop_missing',
      dump_id: dumpId,
      copy: "you said 'i should…'. when+where+how? even an unexecuted plan releases the load.",
      copy_es: 'dijiste "tengo que…". ¿cuándo+dónde+cómo? hasta un plan sin ejecutar baja la carga.',
      sources: [SOURCES.masicampo, SOURCES.altgassen2013, SOURCES.gollwitzer],
      ts: d.ts,
    });
  }
  return out.length > 0 ? out : null;
}

// ─── A2 ──────────────────────────────────────────────────────────────────

/**
 * detectPhoneTask — pure regex classifier on a single string.
 * Phone tasks bundle ADHD-aversive features (synchrony, novel social script,
 * inhibition). Returns signal or null.
 */
export function detectPhoneTask(
  text: string | { text?: string; rawText?: string } | null | undefined,
): PhoneTaskSignal | null {
  const s = typeof text === 'string'
    ? text
    : (text && (text.text ?? text.rawText)) ?? '';
  if (!s) return null;
  const m = s.match(PHONE_RE);
  if (!m) return null;
  const verb = (m[1] ?? m[0] ?? '').toLowerCase();
  return {
    signal: 'admin_phone_task',
    verb,
    copy: "phone bundles every adhd-aversive feature into one task. that's not weakness — that's neurology. want a script?",
    copy_es: 'el teléfono junta todo lo aversivo del tdah en una sola tarea. eso no es debilidad — es neurología. ¿quieres un guion?',
    sources: [SOURCES.reid, SOURCES.telephobia],
  };
}

// ─── A3 ──────────────────────────────────────────────────────────────────

/**
 * scheduleRenewalCues — time-based PM is more impaired than event-based in
 * ADHD. Pre-empt with cues at 90/30/7 days + overdue. Each cue carries an
 * action verb, not a status label.
 */
export function scheduleRenewalCues(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): RenewalCueSignal[] | null {
  const now = resolveNow(history, opts);
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const out: RenewalCueSignal[] = [];
  for (const t of tasks) {
    if (!t?.id) continue;
    if (t.kind !== 'renewal') continue;
    if (typeof t.expiry_ts !== 'number') continue;
    const daysLeft = (t.expiry_ts - now) / DAY_MS;
    let stage: RenewalCueSignal['stage'] | null = null;
    if (daysLeft <= 0) stage = 'overdue';
    else if (daysLeft <= 7) stage = 'urgent';
    else if (daysLeft <= 30) stage = 'mid';
    else if (daysLeft <= 90) stage = 'early';
    if (stage === null) continue;

    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'renewal';
    const verb = typeof t.action_verb === 'string' && t.action_verb.trim()
      ? t.action_verb.trim()
      : 'book the appointment';
    const dRound = Math.max(0, Math.ceil(daysLeft));

    let copy = '';
    if (stage === 'early')   copy = `${label} — ${dRound} days. start the paperwork now. future-you will be relieved.`;
    if (stage === 'mid')     copy = `${label} — ${dRound} days. ${verb} this week.`;
    if (stage === 'urgent')  copy = `${label} — ${dRound} days. ${verb} today.`;
    if (stage === 'overdue') copy = `${label} — expired ${Math.abs(Math.floor(daysLeft))} days ago. ${verb}.`;

    out.push({
      signal: 'admin_renewal_cue',
      task_id: t.id,
      stage,
      days_left: daysLeft,
      copy,
      sources: [SOURCES.altgassen2014, SOURCES.mioni],
      ts: now,
    });
  }
  return out.length > 0 ? out : null;
}

// ─── A9 ──────────────────────────────────────────────────────────────────

/**
 * detectStaleBall — ADHD object permanence: tasks that go quiet vanish from
 * mind. v1 resurfacing rules (audit #8):
 *   - `mine` with a due date → resurface once OVERDUE.
 *   - `mine` without a due date → resurface if UNTOUCHED ≥ untouchedDays (7).
 *   - `waiting` → resurface if UNTOUCHED ≥ untouchedDays (7).
 *   - `done` → never.
 * Copy is gentle + forward-moving, never shaming.
 */
export function detectStaleBall(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): StaleBallSignal[] | null {
  const now = resolveNow(history, opts);
  const untouchedDays = opts.untouchedDays ?? 7;
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const out: StaleBallSignal[] = [];
  for (const t of tasks) {
    if (!t?.id) continue;
    const state = t.ball_state;
    if (state === 'done') continue;
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'task';

    // mine + due date → overdue check (a dated task is never "untouched")
    if (state === 'mine' && typeof t.due_date === 'string') {
      const due = Date.parse(t.due_date);
      if (!Number.isNaN(due)) {
        const dueDay = Math.floor(due / DAY_MS);
        const nowDay = Math.floor(now / DAY_MS);
        if (dueDay < nowDay) {
          out.push({
            signal: 'admin_stale_ball',
            task_id: t.id,
            kind: 'overdue',
            days_overdue: nowDay - dueDay,
            copy: `${label} — this is still open.`,
            copy_es: `${label} — esto sigue pendiente.`,
            sources: [SOURCES.barkley],
            ts: now,
          });
        }
        continue;
      }
      // unparseable due date → fall through to the untouched check
    }

    // untouched check — mine (no usable due date) OR waiting that has gone quiet
    if (state === 'mine' || state === 'waiting') {
      const last = typeof t.last_transition_at === 'number' ? t.last_transition_at : null;
      if (last === null) continue;
      const ageDays = Math.floor((now - last) / DAY_MS);
      if (ageDays < untouchedDays) continue;
      const copy =
        state === 'waiting' ? `${label} — still waiting on this?` : `${label} — want to move this forward?`;
      const copy_es =
        state === 'waiting' ? `${label} — ¿sigues esperando esto?` : `${label} — ¿quieres avanzar con esto?`;
      out.push({
        signal: 'admin_stale_ball',
        task_id: t.id,
        kind: 'untouched',
        days_overdue: ageDays,
        copy,
        copy_es,
        sources: [SOURCES.barkley],
        ts: now,
      });
    }
  }
  return out.length > 0 ? out : null;
}

// ─── A11 (classifyActivationCost) ────────────────────────────────────────

/**
 * classifyActivationCost — pure rules-based EF-tier tag for a single task
 * vs a coarse user state (crash/flow/peak/null).
 * Tier 1 = 1-click, 5 = phone class.
 */
export function classifyActivationCost(
  task: AdminTask | null | undefined,
  state: 'crash' | 'peak' | 'flow' | null | undefined,
): ActivationCostSignal {
  const t: AdminTask = task ?? { id: '' };
  const id = t.id ?? null;
  const label = typeof t.label === 'string' ? t.label : '';
  let tier: 1 | 2 | 3 | 4 | 5 = 3;
  if (PHONE_RE.test(label)) tier = 5;
  else if (FORM_RE.test(label)) tier = 4;
  else if (EMAIL_RE.test(label)) tier = 3;
  else if (ONECLICK_RE.test(label)) tier = 1;
  else if (WEB_RE.test(label)) tier = 2;

  const fitsState =
    (state === 'crash' && tier <= 2) ||
    (state === 'peak'  && tier >= 4) ||
    (state === 'flow'  && tier >= 2 && tier <= 4) ||
    (state == null);

  let copy: string;
  if (fitsState) {
    copy = 'good match for current state.';
  } else if (state === 'crash') {
    copy = 'wrong task for now — try a tier-1 instead.';
  } else if (state === 'peak') {
    copy = 'wrong task for now — try a tier-5 instead.';
  } else {
    copy = 'wrong task for now — try a tier-2 to tier-4 instead.';
  }

  return {
    signal: 'admin_activation_cost',
    task_id: id,
    tier,
    fits_state: fitsState,
    copy,
    sources: [SOURCES.volkow],
  };
}

// ─── A12 ─────────────────────────────────────────────────────────────────

/**
 * detectLast5Pct — task is DONE (action taken) but never CLOSED (loop fully
 * shut). 5d gap surfaces it. Form filled, not mailed.
 */
export function detectLast5Pct(
  history: AdminHistory | null | undefined,
  opts: AdminOpts = {},
): Last5PctSignal[] | null {
  const now = resolveNow(history, opts);
  const gapDays = opts.gapDays ?? 5;
  const tasks = Array.isArray(history?.tasks) ? history!.tasks : [];
  if (tasks.length === 0) return null;

  const out: Last5PctSignal[] = [];
  for (const t of tasks) {
    if (!t?.id) continue;
    if (t.state !== 'done') continue;
    if (typeof t.done_at !== 'number') continue;
    if (typeof t.closed_at === 'number') continue;
    const ageMs = now - t.done_at;
    if (ageMs <= gapDays * DAY_MS) continue;
    const daysSince = Math.floor(ageMs / DAY_MS);
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'task';
    out.push({
      signal: 'admin_last_5pct',
      task_id: t.id,
      days_since_done: daysSince,
      copy: `${label} — but did you mail it? task was 95% done ${daysSince} days ago.`,
      copy_es: `${label} — pero ¿lo enviaste? la tarea estaba al 95% hace ${daysSince} días.`,
      sources: [SOURCES.barkley],
      ts: now,
    });
  }
  return out.length > 0 ? out : null;
}
