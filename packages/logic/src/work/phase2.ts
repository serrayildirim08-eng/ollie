/**
 * @ollie/logic · work phase-2 pattern detectors
 *
 *   W5  activation-barrier splitter (Steel 2007)
 *   W6  estimation-drift mirror     (Buehler 1994)
 *   W9  post-meeting recovery buffer (Microsoft HFL 2021)
 *   W11 one-more-thing spiral brake  (Hupfeld 2019)
 *   W3  hyperfocus-crash prompt + pattern (Hupfeld 2019 / Ozel-Kizil 2016)
 *
 * Pure: no I/O, no window.* globals, now always explicit.
 */

import type {
  WorkState,
  WorkPatternOpts,
  ActivationBarrierPattern,
  EstimationDriftPattern,
  PostMeetingBufferPattern,
  OneMoreThingSpiralPattern,
  HyperfocusCrashPromptPattern,
  HyperfocusCrashPattern,
} from './types';
import { HOUR } from './constants';
import { consentOn, ordinal } from './helpers';
import { median as medianOf } from '../stats';

// ── W5 — Activation-Barrier Splitter (Steel 2007) ────────────────────

export function detectActivationBarrier(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): ActivationBarrierPattern[] {
  if (!consentOn(opts)) return [];
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const thresholdMs = typeof opts.thresholdMs === 'number' ? opts.thresholdMs : 48 * HOUR;
  const tasks = Array.isArray(state?.tasks) ? state!.tasks! : [];
  const out: ActivationBarrierPattern[] = [];

  for (const t of tasks) {
    if (!t || typeof t.created_at !== 'number') continue;
    if (t.completed_at) continue;
    if (t.first_session_at) continue;
    if (typeof t.first_micro_step === 'string' && t.first_micro_step.length > 0) continue;
    if (now - t.created_at < thresholdMs) continue;
    out.push({
      pattern: 'activation-barrier',
      task_id: t.id,
      task_title: t.title ?? '',
      prompt: 'what is the first 30-second move?',
      copy: 'starting is the most expensive minute. once moving, the cost falls. naming the smallest move is chemistry, not softness.',
      copy_es:
        'arrancar es el minuto más caro. una vez en marcha, el coste cae. nombrar el paso más pequeño es química, no debilidad.',
      source: {
        citation: 'Steel 2007, Psychological Bulletin — meta-analysis of procrastination',
        url: 'https://doi.org/10.1037/0033-2909.133.1.65',
      },
    });
  }
  return out;
}

// ── W6 — Estimation-Drift Mirror (Buehler 1994) ──────────────────────

export function detectEstimationDrift(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): EstimationDriftPattern | null {
  if (!consentOn(opts)) return null;
  const isFreshUser = typeof opts.daysSinceOnboarding === 'number' && opts.daysSinceOnboarding < 14;
  const minEntries = typeof opts.minEntries === 'number' ? opts.minEntries : isFreshUser ? 4 : 7;
  const windowEntries = typeof opts.windowEntries === 'number' ? opts.windowEntries : 10;
  const log = Array.isArray(state?.estimation_log) ? state!.estimation_log! : [];
  if (log.length < minEntries) return null;

  const recent = log.slice(-windowEntries);
  const ratios: number[] = [];
  for (const e of recent) {
    if (!e || typeof e.estimated_min !== 'number' || typeof e.actual_min !== 'number') continue;
    if (e.estimated_min <= 0) continue;
    ratios.push(e.actual_min / e.estimated_min);
  }
  if (ratios.length < minEntries) return null;

  const median = medianOf(ratios);
  if (median < 1.2) return null;

  const rounded = Math.round(median * 10) / 10;
  return {
    pattern: 'estimation-drift',
    multiplier: rounded,
    sample_size: ratios.length,
    copy:
      'your estimates run about x' + rounded.toFixed(1) + ' short across the last ' + ratios.length + ' tasks. that is a knowable number, more useful than guilt.',
    copy_es:
      'tus estimaciones se quedan unas x' + rounded.toFixed(1) + ' cortas en las últimas ' + ratios.length + ' tareas. ese es un número conocible, más útil que la culpa.',
    suggestion: 'optional: pad new estimates by x' + rounded.toFixed(1) + '. you can decline.',
    source: {
      citation: 'Buehler, Griffin & Ross 1994, JPSP — Exploring the planning fallacy',
      url: 'https://doi.org/10.1037/0022-3514.67.3.366',
    },
  };
}

// ── W9 — Post-Meeting Recovery Buffer (Microsoft HFL 2021) ───────────

export function detectPostMeetingBuffer(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): PostMeetingBufferPattern | null {
  if (!consentOn(opts)) return null;
  const buf = state?.meeting_buffer ?? null;
  if (!buf) return null;

  const accepts = Array.isArray(buf.accept_log) ? buf.accept_log : [];
  const declines = Array.isArray(buf.decline_log) ? buf.decline_log : [];
  type BufEvent = { kind: 'accept' | 'decline'; ts: number };
  const events: BufEvent[] = (accepts
    .map((t): BufEvent => ({ kind: 'accept', ts: t })) as BufEvent[])
    .concat(declines.map((t): BufEvent => ({ kind: 'decline', ts: t })))
    .filter((e) => typeof e.ts === 'number')
    .sort((a, b) => a.ts - b.ts);

  if (events.length < 3) return null;
  const last3 = events.slice(-3);
  const allAccept = last3.every((e) => e.kind === 'accept');
  const allDecline = last3.every((e) => e.kind === 'decline');
  if (!allAccept && !allDecline) return null;

  const defaultState = allAccept ? 'on' : 'off';
  return {
    pattern: 'post-meeting-buffer',
    default_state: defaultState,
    last3: last3.map((e) => e.kind),
    copy: allAccept
      ? 'three buffers in a row accepted. flipping the default on. buffer is the cost of context-switch your calendar usually hides.'
      : 'three buffers in a row declined. flipping the default off. you can re-enable any time.',
    copy_es: allAccept
      ? 'tres buffers seguidos aceptados. activamos el default. el buffer es el coste de cambiar de contexto que tu calendario suele esconder.'
      : 'tres buffers seguidos rechazados. desactivamos el default. puedes volver a activarlo cuando quieras.',
    source: {
      citation: 'Microsoft Human Factors Lab 2021 — EEG study on back-to-back meetings',
      url: 'https://www.microsoft.com/en-us/worklab/work-trend-index/brain-research',
    },
  };
}

// ── W11 — One-More-Thing Spiral Brake (Hupfeld 2019) ─────────────────

export function detectOneMoreThingSpiral(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): OneMoreThingSpiralPattern | null {
  if (!consentOn(opts)) return null;
  const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : null;
  if (!sessionId) return null;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 3;
  const log = Array.isArray(state?.one_more_thing_log) ? state!.one_more_thing_log! : [];
  let count = 0;
  for (const e of log) {
    if (e && e.session_id === sessionId) count++;
  }
  if (count < threshold) return null;
  return {
    pattern: 'one-more-thing-spiral',
    session_id: sessionId,
    presses: count,
    copy:
      'this is the ' + ordinal(count) + ' "one more thing" this session. naming the pattern, not stopping you.',
    copy_es:
      'este es el "una cosa más" número ' + count + ' de esta sesión. nombramos el patrón, no te paramos.',
    source: {
      citation: 'Hupfeld, Abagis & Shah 2019, ADHD Atten Defic Hyperact Disord — AHQ subscale',
      url: 'https://doi.org/10.1007/s12402-018-0272-y',
    },
  };
}

// ── W3 — Hyperfocus Crash (Hupfeld 2019 / Ozel-Kizil 2016) ──────────

export function buildCrashPrompt(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): HyperfocusCrashPromptPattern | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const minHours = typeof opts.minHours === 'number' ? opts.minHours : 3;
  const sessions = Array.isArray(state?.sessions) ? state!.sessions! : [];
  const log = Array.isArray(state?.crash_log) ? state!.crash_log! : [];
  const askedIds = new Set(log.map((c) => c?.session_id).filter(Boolean));

  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (!s || typeof s.at !== 'number') continue;
    const hours = typeof s.duration_min === 'number' ? s.duration_min / 60 : 0;
    if (hours < minHours) continue;
    if (s.at > now) continue;
    if (askedIds.has(s.id)) continue;
    if (now - s.at > 24 * HOUR) continue;
    return {
      pattern: 'hyperfocus-crash-prompt',
      session_id: s.id,
      session_at: s.at,
      session_hours: hours,
      prompt: 'yesterday was a long session. has the body filed the bill yet?',
      chips: ['yes', 'not yet', 'no crash', 'not sure'],
      copy: 'hyperfocus is wiring, not a bug. naming the bill is planning, not a verdict.',
      copy_es: 'el hiperfoco es cableado, no un bug. nombrar la factura es planificar, no un veredicto.',
      source: {
        citation: 'Hupfeld, Abagis & Shah 2019, ADHD Atten Defic Hyperact Disord — hyperfocus dimension',
        url: 'https://doi.org/10.1007/s12402-018-0272-y',
      },
    };
  }
  return null;
}

export function detectHyperfocusCrashPattern(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): HyperfocusCrashPattern | null {
  if (!consentOn(opts)) return null;
  const minRunLength = typeof opts.minRunLength === 'number' ? opts.minRunLength : 3;
  const minSampleSize = typeof opts.minSampleSize === 'number' ? opts.minSampleSize : 5;
  const log = Array.isArray(state?.crash_log) ? state!.crash_log! : [];
  const decisive = log.filter((c) => c && (c.reply === 'yes' || c.reply === 'no_crash'));
  if (decisive.length < minSampleSize) return null;
  const yesCount = decisive.filter((c) => c.reply === 'yes').length;
  if (yesCount < minRunLength) return null;
  return {
    pattern: 'hyperfocus-crash-pattern',
    yes_count: yesCount,
    sample_size: decisive.length,
    copy:
      'sessions over three hours have led to a crash ' +
      yesCount + ' of ' + decisive.length + ' times. pattern, not a verdict.',
    copy_es:
      'las sesiones de más de tres horas terminaron en bajón ' +
      yesCount + ' de ' + decisive.length + ' veces. patrón, no veredicto.',
    source: {
      citation: 'Hupfeld, Abagis & Shah 2019, ADHD Atten Defic Hyperact Disord — n=251 + 372 replication',
      url: 'https://doi.org/10.1007/s12402-018-0272-y',
    },
  };
}
