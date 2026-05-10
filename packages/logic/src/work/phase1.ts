/**
 * @ollie/logic · work phase-1 pattern detectors
 *
 *   W1  task-switch-tax         (Monsell 2003)
 *   W2  meeting-cliff           (Microsoft HFL 2021)
 *   W4  deadline-blindness cues (Altgassen 2014)
 *   W12 shutdown-gap            (Newport / Masicampo 2011)
 *   W17 triage-day anchor       (Sonnentag 2007)
 *
 * Pure: no I/O, no window.* globals, now always explicit.
 * Consent gate is a plain boolean in opts — caller resolves from store.
 */

import type {
  WorkState,
  WorkPatternOpts,
  HabitsState,
  Deadline,
  TaskSwitchTaxPattern,
  MeetingCliffPattern,
  DeadlineCuesPattern,
  DeadlineCue,
  ShutdownGapPattern,
  ShutdownPrompt,
  TriageDayAnchorPattern,
} from './types';
import { DAY, HOUR, DEADLINE_CUE_OFFSETS_DAYS, DEFAULT_EVENT_SUGGESTIONS } from './constants';
import { consentOn, dayKey, isTriageActive } from './helpers';

// ── W1 — Task-Switch Tax (Monsell 2003) ──────────────────────────────

export function detectTaskSwitchTax(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): TaskSwitchTaxPattern | null {
  if (!consentOn(opts)) return null;
  if (!opts.review) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 14;
  const minSessions = typeof opts.minSessions === 'number' ? opts.minSessions : 10;
  const meanSwapThreshold = typeof opts.meanSwapThreshold === 'number' ? opts.meanSwapThreshold : 3;
  const windowStart = now - windowDays * DAY;

  const sessions = Array.isArray(state?.sessions) ? state!.sessions! : [];
  const inWindow = sessions.filter(
    (s) => s && typeof s.at === 'number' && s.at >= windowStart && s.at <= now,
  );
  if (inWindow.length < minSessions) return null;

  let totalSwaps = 0;
  for (const s of inWindow) {
    if (Array.isArray(s.swap_log) && s.swap_log.length > 0) {
      totalSwaps += s.swap_log.length;
    } else if (Array.isArray(s.task_tags)) {
      totalSwaps += Math.max(0, s.task_tags.length - 1);
    }
  }
  const meanSwaps = totalSwaps / inWindow.length;
  if (meanSwaps < meanSwapThreshold) return null;

  return {
    pattern: 'task-switch-tax',
    confidence: meanSwaps >= 5 ? 'high' : meanSwaps >= 4 ? 'medium' : 'low',
    sample_n: inWindow.length,
    total_swaps: totalSwaps,
    mean_swaps_per_session: Math.round(meanSwaps * 10) / 10,
    window_days: windowDays,
    copy:
      'you switched tasks ' + totalSwaps + ' times across ' + inWindow.length + ' sessions. ' +
      'switch cost is real — that tiredness has a name.',
    copy_es:
      'cambiaste de tarea ' + totalSwaps + ' veces en ' + inWindow.length + ' sesiones. ' +
      'el coste de cambiar es real — ese cansancio tiene nombre.',
    source: {
      citation: 'Monsell 2003, Trends in Cognitive Sciences — Task switching',
      url: 'https://doi.org/10.1016/S1364-6613(03)00028-7',
    },
  };
}

// ── W2 — Meeting-Density Cliff (Microsoft HFL 2021) ──────────────────

export function detectMeetingCliff(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): MeetingCliffPattern[] {
  if (!consentOn(opts)) return [];
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 1;
  const cliffWindowMs = typeof opts.cliffWindowMs === 'number' ? opts.cliffWindowMs : 4 * HOUR;
  const minMeetings = typeof opts.minMeetings === 'number' ? opts.minMeetings : 3;
  const maxGapMs = typeof opts.maxGapMs === 'number' ? opts.maxGapMs : 15 * 60 * 1000;
  const windowStart = now - windowDays * DAY;

  const meetings = Array.isArray(state?.meetings) ? state!.meetings! : [];
  const inWindow = meetings
    .filter(
      (m) =>
        m &&
        typeof m.start_at === 'number' &&
        typeof m.end_at === 'number' &&
        m.end_at > m.start_at &&
        m.end_at >= windowStart &&
        m.start_at <= now,
    )
    .slice()
    .sort((a, b) => a.start_at - b.start_at);

  if (inWindow.length < minMeetings) return [];

  const cliffsByDay: Record<string, { date_key: string; count: number; meeting_ids: Array<string | null>; first_start: number; last_end: number }> = Object.create(null);

  for (let i = 0; i < inWindow.length; i++) {
    const anchor = inWindow[i];
    const horizon = anchor.start_at + cliffWindowMs;
    const cluster = [anchor];
    for (let j = i + 1; j < inWindow.length; j++) {
      if (inWindow[j].start_at <= horizon) cluster.push(inWindow[j]);
      else break;
    }
    if (cluster.length < minMeetings) continue;
    let gapsOk = true;
    for (let k = 1; k < cluster.length; k++) {
      const gap = cluster[k].start_at - cluster[k - 1].end_at;
      if (gap > maxGapMs) { gapsOk = false; break; }
    }
    if (!gapsOk) continue;
    const dKey = dayKey(anchor.start_at);
    const existing = cliffsByDay[dKey];
    if (!existing || cluster.length > existing.count) {
      cliffsByDay[dKey] = {
        date_key: dKey,
        count: cluster.length,
        meeting_ids: cluster.map((m) => m.id ?? null),
        first_start: cluster[0].start_at,
        last_end: cluster[cluster.length - 1].end_at,
      };
    }
  }

  const out: MeetingCliffPattern[] = [];
  for (const dKey of Object.keys(cliffsByDay)) {
    const c = cliffsByDay[dKey];
    out.push({
      pattern: 'meeting-cliff',
      confidence: c.count >= 5 ? 'high' : 'medium',
      date_key: c.date_key,
      meeting_count: c.count,
      meeting_ids: c.meeting_ids,
      span_ms: c.last_end - c.first_start,
      copy:
        c.count + ' meetings back-to-back today. ' +
        'beta-wave load builds across calls — plan recovery, not productivity, after.',
      copy_es:
        c.count + ' reuniones seguidas hoy. ' +
        'la carga de ondas beta se acumula entre llamadas — planifica recuperación, no productividad, después.',
      source: {
        citation: 'Microsoft Human Factors Lab 2021 — back-to-back meeting EEG',
        url: 'https://www.microsoft.com/en-us/worklab/work-trend-index/brain-research',
      },
    });
  }
  return out;
}

// ── W4 — Deadline-Blindness Event Cues (Altgassen 2014) ──────────────

function suggestLinkedEvent(habitsState: HabitsState | null | undefined): string {
  if (habitsState && Array.isArray(habitsState.habits) && habitsState.habits.length > 0) {
    for (const h of habitsState.habits) {
      if (!h) continue;
      if (typeof h.external_cue === 'string' && h.external_cue.trim().length > 0)
        return 'after ' + h.external_cue.trim();
      if (typeof h.name === 'string' && h.name.trim().length > 0)
        return 'after ' + h.name.trim();
    }
  }
  return DEFAULT_EVENT_SUGGESTIONS[0];
}

function deadlineActionByOffset(
  d: number,
  title: string | undefined,
): { next_action: string; copy: string; copy_es: string } {
  const t = typeof title === 'string' && title.trim().length > 0 ? title.trim() : 'this';
  if (d === 7)
    return {
      next_action: 'draft one paragraph or rough outline for ' + t,
      copy: 'deadline 1 week out. drafting one paragraph today, not the whole thing.',
      copy_es: 'plazo a 1 semana. hoy un párrafo, no el todo.',
    };
  if (d === 2)
    return {
      next_action: 'first real pass on ' + t,
      copy: '2 days out. first pass today — quality fix tomorrow.',
      copy_es: 'a 2 días. primera pasada hoy — el ajuste fino mañana.',
    };
  if (d === 1)
    return {
      next_action: 'finish + send/submit ' + t,
      copy: "tomorrow. finish, then send. you didn't fail at time — time-based cues just hit your brain different.",
      copy_es:
        'mañana. termina, luego envía. no es que no llegues a tiempo — las señales temporales le pegan distinto a tu cerebro.',
    };
  return {
    next_action: 'one move toward ' + t,
    copy: 'deadline approaching. one move today.',
    copy_es: 'plazo cerca. un paso hoy.',
  };
}

export function scheduleDeadlineCues(
  deadline: Deadline,
  opts: WorkPatternOpts,
): DeadlineCuesPattern | null {
  if (!consentOn(opts)) return null;
  if (!deadline || typeof deadline.due_at !== 'number' || !isFinite(deadline.due_at)) return null;
  const deadlineAt = deadline.due_at;
  const title = deadline.title;
  const habitsState = opts.habitsState ?? null;
  const suggested =
    typeof deadline.linked_event === 'string' && deadline.linked_event.trim().length > 0
      ? deadline.linked_event.trim()
      : suggestLinkedEvent(habitsState);

  const cues: DeadlineCue[] = DEADLINE_CUE_OFFSETS_DAYS.map((d) => {
    const action = deadlineActionByOffset(d, title);
    return {
      offset_days: -d,
      stage: d + 'd',
      at: deadlineAt - d * DAY,
      linked_event: suggested,
      next_action: action.next_action,
      copy: action.copy,
      copy_es: action.copy_es,
    };
  });

  return {
    pattern: 'deadline-cues',
    deadline_id: deadline.id ?? null,
    title: typeof title === 'string' ? title : '',
    suggested_event: suggested,
    cues,
    copy:
      (typeof title === 'string' && title.trim().length > 0
        ? 'deadline: "' + title.trim() + '". '
        : 'deadline scheduled. ') +
      'event-based cues at -7 / -2 / -1 day, anchored to ' + suggested + '.',
    source: {
      citation: 'Altgassen Kretschmer Kliegel 2014, J Atten Disord — task dissociation in PM in ADHD',
      url: 'https://doi.org/10.1177/1087054712445484',
    },
  };
}

// ── W12 — Shutdown Ritual (Newport / Masicampo 2011) ─────────────────

export function detectShutdownGap(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): ShutdownGapPattern | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const gapDays = typeof opts.gapDays === 'number' ? opts.gapDays : 3;
  const log = Array.isArray(state?.shutdown_log) ? state!.shutdown_log! : [];

  let lastTs = 0;
  for (const e of log) {
    if (e && typeof e.ts === 'number' && e.ts > lastTs) lastTs = e.ts;
  }
  const ageDays = lastTs > 0 ? (now - lastTs) / DAY : Infinity;
  if (ageDays <= gapDays) return null;

  // Cross-module read is NOT done here — caller passes sleep via opts.
  const sleep = opts.sleep ?? null;
  const lowSleep = !!(sleep && typeof sleep.hours === 'number' && sleep.hours < 6);

  return {
    pattern: 'shutdown-gap',
    confidence: lowSleep ? 'high' : 'medium',
    last_shutdown_ts: lastTs > 0 ? lastTs : null,
    days_since: isFinite(ageDays) ? Math.floor(ageDays) : null,
    low_sleep_signal: lowSleep,
    copy: lowSleep
      ? 'open loops are taxing your sleep. one minute capture — what is still open, what is the next move, what is done.'
      : 'open loops cost more than the work itself. close them on paper, then leave.',
    copy_es: lowSleep
      ? 'los bucles abiertos te están cobrando en sueño. un minuto para capturar — qué sigue abierto, cuál es el siguiente paso, qué está hecho.'
      : 'los bucles abiertos cuestan más que el trabajo en sí. ciérralos en papel y vete.',
    source: {
      citation: 'Masicampo & Baumeister 2011, J Personality Soc Psychol — Consider it done!',
      url: 'https://doi.org/10.1037/a0024192',
    },
  };
}

export function buildShutdownPrompt(): ShutdownPrompt {
  return {
    questions: [
      { id: 'open_loops', label: 'what is still open?' },
      { id: 'next_moves', label: 'what is the next move on each?' },
      { id: 'closure', label: 'what is done that you have not let yourself feel done?' },
    ],
    copy: 'shutdown ritual. one minute. the loop closes when the plan is written, not when the work is done.',
    copy_es:
      'ritual de cierre. un minuto. el bucle se cierra cuando escribes el plan, no cuando acaba el trabajo.',
  };
}

// ── W17 — Triage-Day Soft-State Flag (Sonnentag 2007) ────────────────

export { isTriageActive };

export function buildTriageAnchor(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): TriageDayAnchorPattern | null {
  if (!consentOn(opts)) return null;
  if (!isTriageActive(state, opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const key = dayKey(now);
  const list = Array.isArray(state?.triage_days) ? state!.triage_days! : [];
  let reason: string | null = null;
  for (const t of list) if (t && t.date_key === key) { reason = t.reason ?? null; break; }
  return {
    pattern: 'triage-day-anchor',
    date_key: key,
    reason,
    prompt: "today's anchor — what is the one thing that matters?",
    copy: 'today is not a work day. it is a get-through day. that is information, not a verdict.',
    copy_es: 'hoy no es día de trabajo. es día de aguantar. eso es información, no veredicto.',
    source: {
      citation: 'Sonnentag & Fritz 2007, J Occup Health Psych — Recovery Experience',
      url: 'https://doi.org/10.1037/1076-8998.12.3.204',
    },
  };
}
