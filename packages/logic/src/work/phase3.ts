/**
 * @ollie/logic · work phase-3 pattern detectors
 *
 *   W7  tab-sprawl surface          (Risko 2016 / Cowan 2010)
 *   W8  notification-tax counter    (Mark Gudith Klocke 2008)
 *   W10 recurring-meeting drift     (Microsoft WTI 2022)
 *   W13 multitask-illusion mirror   (Watson & Strayer 2010)
 *   W14 RSD feedback soft-anchor    (Shaw 2014)
 *
 * Pure: no I/O, no window.* globals, now always explicit.
 */

import type {
  WorkState,
  WorkPatternOpts,
  TabSprawlPattern,
  NotificationTaxPattern,
  RecurringMeetingDeadPattern,
  MultitaskIllusionPattern,
  RsdAnchorPromptPattern,
  RsdAnchorMirrorPattern,
} from './types';
import { DAY } from './constants';
import { consentOn } from './helpers';
import { FEEDBACK_RE } from './constants';

// ── W7 — Tab-Sprawl Surface (Risko 2016 / Cowan 2010) ────────────────

export function detectTabSprawl(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): TabSprawlPattern | null {
  if (!consentOn(opts)) return null;
  const minReports = typeof opts.minReports === 'number' ? opts.minReports : 4;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 15;
  const log = Array.isArray(state?.tab_reports) ? state!.tab_reports! : [];
  if (log.length < minReports) return null;
  const recent = log.slice(-minReports);
  let sum = 0;
  for (const r of recent) {
    if (!r || typeof r.count !== 'number') return null;
    sum += r.count;
  }
  const mean = sum / recent.length;
  if (mean < threshold) return null;
  return {
    pattern: 'tab-sprawl',
    mean: Math.round(mean * 10) / 10,
    sample_size: recent.length,
    copy: 'tabs over about seven stop being memory and start being anxiety. cognitive offloading works only if you trust the return. let us prune what is stale.',
    copy_es:
      'pasadas unas siete pestañas, dejan de ser memoria y empiezan a ser ansiedad. descargar la cabeza solo funciona si confías en volver. podamos lo viejo.',
    source: {
      citation: 'Risko & Gilbert 2016, Trends Cogn Sci — Cognitive Offloading',
      url: 'https://doi.org/10.1016/j.tics.2016.07.002',
    },
  };
}

// ── W8 — Notification-Tax Counter (Mark Gudith Klocke 2008) ──────────

export function detectNotificationTax(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): NotificationTaxPattern | null {
  if (!consentOn(opts)) return null;
  const now = typeof opts.now === 'number' ? opts.now : 0;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 7;
  const minTotal = typeof opts.minTotal === 'number' ? opts.minTotal : 5;
  const cutoff = now - windowDays * DAY;
  const log = Array.isArray(state?.notification_tax_log) ? state!.notification_tax_log! : [];
  const inWindow = log.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff && e.ts <= now);
  if (inWindow.length < minTotal) return null;

  let selfCheck = 0, external = 0, actualNeed = 0;
  for (const e of inWindow) {
    if (e.kind === 'impulse_check') selfCheck++;
    else if (e.kind === 'notification') external++;
    else if (e.kind === 'actual_need') actualNeed++;
  }
  return {
    pattern: 'notification-tax',
    window_days: windowDays,
    self_checks: selfCheck,
    external_interruptions: external,
    actual_needs: actualNeed,
    total: inWindow.length,
    copy:
      selfCheck + ' self-checks across ' + windowDays + ' days. each one costs about a minute to land back. pattern, not cause.',
    copy_es:
      selfCheck + ' auto-chequeos en ' + windowDays + ' días. cada uno cuesta como un minuto para volver al hilo. patrón, no causa.',
    source: {
      citation: 'Mark, Gudith & Klocke 2008, CHI — The cost of interrupted work',
      url: 'https://doi.org/10.1145/1357054.1357072',
    },
  };
}

// ── W10 — Recurring-Meeting Drift Audit (Microsoft WTI 2022) ─────────

export function buildCancelDraft(title?: string): string {
  const t =
    typeof title === 'string' && title.trim()
      ? title.trim()
      : 'this recurring meeting';
  return (
    'wanted to flag: ' +
    t +
    ' has run its course for me. proposing we drop it from the recurring slot. happy to revive ad-hoc if a real agenda lands.'
  );
}

export function detectRecurringMeetingDeads(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): RecurringMeetingDeadPattern[] {
  if (!consentOn(opts)) return [];
  const list = Array.isArray(state?.recurring_meetings) ? state!.recurring_meetings! : [];
  const out: RecurringMeetingDeadPattern[] = [];
  for (const m of list) {
    if (!m || m.status !== 'dead') continue;
    out.push({
      pattern: 'recurring-meeting-dead',
      meeting_id: m.id,
      title: m.title ?? '',
      cancel_draft: buildCancelDraft(m.title ?? 'this recurring meeting'),
      copy: 'recurring meetings die quietly while staying on the calendar. naming the dead ones is accounting, not difficulty.',
      copy_es:
        'las reuniones recurrentes mueren en silencio mientras siguen en el calendario. nombrar las muertas es contabilidad, no dificultad.',
      source: {
        citation: 'Microsoft Work Trend Index 2022 — meeting time up 252%',
        url: 'https://www.microsoft.com/en-us/worklab/work-trend-index/hybrid-work-is-just-work',
      },
    });
  }
  return out;
}

// ── W13 — Multitask-Illusion Mirror (Watson & Strayer 2010) ──────────

export function detectMultitaskIllusion(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): MultitaskIllusionPattern | null {
  if (!consentOn(opts)) return null;
  const isFreshUser = typeof opts.daysSinceOnboarding === 'number' && opts.daysSinceOnboarding < 14;
  const minPerCohort = typeof opts.minPerCohort === 'number' ? opts.minPerCohort : isFreshUser ? 2 : 3;
  const log = Array.isArray(state?.multitask_log) ? state!.multitask_log! : [];
  const multi = log.filter((e) => e && e.task_count >= 2 && typeof e.completion_rate === 'number');
  const solo = log.filter((e) => e && e.task_count === 1 && typeof e.completion_rate === 'number');
  if (multi.length < minPerCohort || solo.length < minPerCohort) return null;

  const meanMulti = multi.reduce((a, e) => a + e.completion_rate, 0) / multi.length;
  const meanSolo = solo.reduce((a, e) => a + e.completion_rate, 0) / solo.length;
  if (meanSolo - meanMulti < 0.1) return null;

  return {
    pattern: 'multitask-illusion',
    multi_completion: Math.round(meanMulti * 100),
    solo_completion: Math.round(meanSolo * 100),
    multi_n: multi.length,
    solo_n: solo.length,
    copy:
      'in sessions tagged two-at-once, completion ran at ' +
      Math.round(meanMulti * 100) +
      '%. solo-tagged sessions: ' +
      Math.round(meanSolo * 100) +
      '%. the felt sense of multitasking is real. so is the cost.',
    copy_es:
      'en sesiones etiquetadas como "dos a la vez", el cierre fue del ' +
      Math.round(meanMulti * 100) +
      '%. en sesiones solo: ' +
      Math.round(meanSolo * 100) +
      '%. la sensación de multitarea es real. el coste también.',
    source: {
      citation: 'Watson & Strayer 2010, Psychon Bull Rev — Supertaskers (n=200, 2.5%)',
      url: 'https://doi.org/10.3758/PBR.17.4.479',
    },
  };
}

// ── W14 — RSD Feedback Soft-Anchor (Shaw 2014) ───────────────────────

export function matchRSDTitle(
  title: string,
  opts: WorkPatternOpts,
): RsdAnchorPromptPattern | null {
  if (!consentOn(opts)) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (!FEEDBACK_RE.test(title)) return null;
  return {
    pattern: 'rsd-anchor-prompt',
    matched_title: title,
    prompt: "open it inside ollie's space, not your inbox? we can read it together.",
    chips: ['fine', 'sting', 'shame spike', 'mixed'],
    copy: 'feedback hits some brains harder than the message size. opening it in a held space costs less than opening it alone.',
    copy_es:
      'el feedback le pega a algunos cerebros más fuerte que el tamaño del mensaje. abrirlo en un espacio acompañado cuesta menos que abrirlo a solas.',
    source: {
      citation: 'Shaw, Stringaris, Nigg & Leibenluft 2014, Am J Psychiatry — emotion dysregulation in ADHD',
      url: 'https://doi.org/10.1176/appi.ajp.2013.13070966',
    },
  };
}

export function detectRSDPattern(
  state: WorkState | null | undefined,
  opts: WorkPatternOpts,
): RsdAnchorMirrorPattern | null {
  if (!consentOn(opts)) return null;
  const minSample = typeof opts.minSample === 'number' ? opts.minSample : 5;
  const log = Array.isArray(state?.rsd_anchor_log) ? state!.rsd_anchor_log! : [];
  if (log.length < minSample) return null;

  let fine = 0, sting = 0, shame = 0, mixed = 0;
  for (const e of log) {
    if (!e) continue;
    if (e.landed === 'fine') fine++;
    else if (e.landed === 'sting') sting++;
    else if (e.landed === 'shame_spike') shame++;
    else if (e.landed === 'mixed') mixed++;
  }
  const total = fine + sting + shame + mixed;
  if (total < minSample) return null;

  return {
    pattern: 'rsd-anchor-mirror',
    sample_size: total,
    counts: { fine, sting, shame_spike: shame, mixed },
    copy:
      'across ' +
      total +
      ' feedback opens, you logged: ' +
      fine + ' fine, ' +
      sting + ' sting, ' +
      shame + ' shame-spike, ' +
      mixed + ' mixed. mirror, not a verdict.',
    copy_es:
      'en ' +
      total +
      ' veces que abriste feedback, registraste: ' +
      fine + ' bien, ' +
      sting + ' escozor, ' +
      shame + ' pico de vergüenza, ' +
      mixed + ' mixto. espejo, no veredicto.',
    source: {
      citation: 'Shaw, Stringaris, Nigg & Leibenluft 2014, Am J Psychiatry — emotion dysregulation in ADHD',
      url: 'https://doi.org/10.1176/appi.ajp.2013.13070966',
    },
  };
}
