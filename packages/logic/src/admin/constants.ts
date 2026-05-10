/**
 * @ollie/logic · admin constants
 *
 * Shared regexes, lexicons, stopwords, and source citations used across
 * all admin detectors. Pure module — no functions, no I/O.
 */

import type { AdminSource } from './types';

// ─── Core regex classifiers ───────────────────────────────────────────────

/** Open-loop trigger phrases (EN + TR). Surfaces only when no impl-intention follows. */
export const OPEN_LOOP_RE =
  /\b(i should|i need to|gotta|have to|halletmeliyim|yapmam lazım|aramam lazım|şunu)\b/i;

/** Implementation-intention markers (when/where). If present → plan is partial. */
export const IF_THEN_RE =
  /\b(after|before|when|tomorrow|tonight|at \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yarın|sonra|öğleden|akşam|sabah)\b/i;

/** Phone-task classifier — used by detectPhoneTask and classifyActivationCost tier-5 gate. */
export const PHONE_RE =
  /\b(call|phone|ring|aramam|telefon|arıyorum|aradım|aranacak)\b/i;

/** EF tier heuristics for classifyActivationCost. */
export const FORM_RE =
  /\b(form|tax|taxes|insurance|lease|contract|notary|noter|vergi|sigorta|kira sözleşme)\b/i;
export const EMAIL_RE =
  /\b(email|e-mail|mail|reply|respond|cevap|yanıt|inbox)\b/i;
export const WEB_RE =
  /\b(login|log in|sign in|click|submit|upload|download|portal|website|site|girişi yap|tıkla|yükle)\b/i;
export const ONECLICK_RE =
  /\b(toggle|check|uncheck|mark|tick|switch on|switch off|enable|disable|işaretle|aç|kapat)\b/i;

/** Paperwork classification (A4 + A11 tier-4). */
export const PAPERWORK_RE =
  /\b(form|tax|insurance|lease|paperwork|application|registration|kira|sigorta|vergi|başvuru|evrak)\b/i;

/** Narrow implementation-hint for firehose dump (A5). */
export const IMPL_HINT_RE =
  /\b(after|before|when|tomorrow|tonight|yarın|sonra)\b/i;

// ─── Firehose stopwords (A5) ──────────────────────────────────────────────

export const FIREHOSE_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'had',
  'was', 'are', 'but', 'not', 'you', 'your', 'our', 'their',
  've', 'ile', 'bir', 'bu', 'şu', 'ama', 'çok', 'daha', 'için', 'gibi',
  'ki', 'de', 'da', 'mi', 'mı', 'mu', 'mü',
]);

// ─── Phase 2/3 multilingual lexicons ─────────────────────────────────────
// Boundary lookarounds that work for non-ASCII tokens.

const _L = '(?:^|[\\s,.!?;:\'"()\\[\\]\\-/])';
const _R = '(?=[\\s,.!?;:\'"()\\[\\]\\-/]|$)';
const _wrap = (alts: string[]): RegExp =>
  new RegExp(_L + '(?:' + alts.join('|') + ')' + _R, 'iu');

/** DEFER_RE — A6 defer-chain detector (Barkley EF avoidance). EN/TR/FR/ES/DE. */
export const DEFER_RE = _wrap([
  'defer(?:red|ring)?', 'postpone(?:d|ing)?', 'push(?:ed|ing)?\\s*(?:back|it\\s*back|out)',
  'reschedule(?:d|ing)?', 'delay(?:ed|ing)?', 'put\\s*(?:it\\s*)?off',
  'not\\s*(?:yet|today|now)', 'maybe\\s*(?:later|next\\s*week|tomorrow)',
  'erteliyorum', 'erteledim', 'erteleme', 'sonraya\\s*b[ıi]rakt[ıi]m',
  'şimdi\\s*değil', 'simdi\\s*degil', 'sonra\\s*bakar[ıi]m',
  'remettre\\s*(?:à|a)\\s*plus\\s*tard', 'reporter', 'pas\\s*encore',
  'peut-?être\\s*(?:demain|plus\\s*tard)',
  'aplazar', 'aplazad[oa]', 'posponer', 'pospuesto', 'más\\s*tarde',
  'mas\\s*tarde', 'mañana\\s*(?:quizás|quizas|ya)',
  'verschieben', 'verschoben', 'aufschieben', 'aufgeschoben',
  'auf\\s*sp[äa]ter', 'nicht\\s*jetzt', 'vielleicht\\s*(?:morgen|sp[äa]ter)',
]);

/** TWOMIN_RE — Allen GTD 2-min rule (A8). EN/TR/FR/ES/DE. */
export const TWOMIN_RE = _wrap([
  'quick', 'one\\s*sec(?:ond)?', '(?:two|2)\\s*min(?:utes?)?',
  'takes?\\s*(?:a\\s*)?(?:second|moment|minute)', 'literally\\s*nothing',
  'h[ıi]zl[ıi]', 'çabuk', 'cabuk', 'bir\\s*dakika', 'iki\\s*dakika',
  'saniyeye\\s*biter', 'dakika\\s*içinde',
  'rapide', 'deux\\s*minutes?', 'en\\s*une\\s*minute', 'vite\\s*fait',
  'r[aá]pido', 'dos\\s*minutos?', 'un\\s*momento', 'en\\s*un\\s*segundo',
  'schnell', 'zwei\\s*minuten?', 'kurz', 'in\\s*einer\\s*minute',
]);

/** PEAK_RE — A11 EF state: peak focus. EN/TR/FR/ES/DE. */
export const PEAK_RE = _wrap([
  'peak', 'focused', 'wired', 'sharp', 'locked\\s*in', 'on\\s*fire', 'in\\s*the\\s*zone',
  'formday[ıi]m', 'odakl[ıi]', 'odaklan(?:d[ıi]m|m[ıi]ş)', 'zirvedeyim',
  'concentrée?', 'au\\s*top', 'en\\s*forme',
  'concentrad[oa]', 'al\\s*máximo', 'al\\s*maximo', 'en\\s*racha', 'enfocad[oa]',
  'fokussiert', 'im\\s*flow', 'höchstform', 'hochstform',
]);

/** LOW_EF_RE — A11 EF state: low. EN/TR/FR/ES/DE. */
export const LOW_EF_RE = _wrap([
  'low', 'sluggish', 'tired', 'slow', 'fuzzy', 'foggy', 'meh',
  'yorgun', 'ağ[ıi]r', 'ag[ıi]r', 'yavaş', 'yavas', 'm[ıi]zm[ıi]z',
  'fatiguée?', 'lente?', 'molle?s?', 'dans\\s*le\\s*brouillard',
  'cansad[oa]', 'lent[oa]', 'flojo', 'con\\s*niebla',
  'müde', 'mude', 'langsam', 'träge', 'trage', 'benebelt',
]);

/** CRASH_RE — A11 EF state: crash. EN/TR/FR/ES/DE. */
export const CRASH_RE = _wrap([
  'crash', 'wiped', 'fried', 'toast', 'wrecked', 'cooked', 'spent',
  'exhaust(?:ed|ing)?', 'burnt\\s*out', 'burned\\s*out',
  'çöktüm', 'coktum', 'bitik', 'bittim', 'tükendim', 'tukendim', 'mahvoldum',
  'épuisée?', 'epuisee?', 'cramée?', 'cramee?', 'lessivée?', 'lessivee?', 'mort[se]?',
  'agotad[oa]', 'hecho\\s*polvo', 'muert[oa]',
  'erschöpft', 'erschopft', 'kaputt', 'fix\\s*und\\s*fertig', 'ausgebrannt',
]);

/** DELAY_CUE_RE — A7 cost-of-delay (Kahneman & Tversky 1979 + Barkley 2011). EN/TR/FR/ES/DE. */
export const DELAY_CUE_RE = _wrap([
  'late\\s*fee', 'fine', 'penalty', 'penalt(?:y|ies)', 'expire?(?:d|s)?',
  'expir(?:y|ation)', 'lapse(?:d)?', 'consequence(?:s)?', 'if\\s*late',
  'if\\s*i\\s*(?:don\'?t|miss|wait)', 'overdue', 'cost\\s*(?:of\\s*)?waiting',
  'renewal\\s*lag', 'what\\s*happens', 'miss(?:ing|ed)\\s*(?:the\\s*)?deadline',
  'gecikme\\s*cezas[ıi]', 'son\\s*tarih', 'süresi\\s*doldu', 'suresi\\s*doldu',
  'ceza(?:s[ıi])?', 'kaybedersem', 'geç(?:ersem|irsem|irirsem)',
  'gecikirsem', 'zamand[ae]\\s*yapmazsam',
  'pénalité', 'penalite', 'amende', 'expiré', 'expire', 'retard',
  'conséquence', 'consequence', 'si\\s*je\\s*(?:tarde|rate|manque)',
  'multa', 'penalización', 'penalizacion', 'vencid[oa]', 'consecuencia',
  'si\\s*no\\s*(?:lo\\s*)?hago', 'si\\s*me\\s*retraso',
  'strafe', 'versäumnis', 'versaumnis', 'abgelaufen', 'konsequenz',
  'wenn\\s*ich\\s*(?:warte|es\\s*verpasse)',
]);

/** SCHEDULE_RE — A15 schedule-vs-do drift detector (Barkley 2011). EN/TR/FR/ES/DE. */
export const SCHEDULE_RE = _wrap([
  'scheduled', 'booked', 'set\\s*(?:a\\s*)?(?:time|appointment|reminder)',
  'put\\s*(?:it\\s*)?(?:in|on)\\s*(?:the\\s*)?calendar',
  'added\\s*(?:it\\s*)?to\\s*(?:the\\s*)?calendar',
  'blocked\\s*(?:time|off)', 'reserved\\s*time', 'time\\s*blocked',
  'planned\\s*(?:it\\s*)?for', 'set\\s*(?:a\\s*)?(?:date|reminder|alarm)',
  'made\\s*(?:an?\\s*)?appointment', 'booked\\s*(?:a\\s*)?slot',
  'planlad[ıi]m', 'takvime\\s*ekled\\w*', 'randevu\\s*ald[ıi]m',
  'ay[ıi]rd[ıi]m', 'zaman[ıi]\\s*ay[ıi]rd[ıi]m',
  'planifiée?', 'pris\\s*rendez-?vous', 'ajoutée?\\s*au\\s*calendrier',
  'réservée?\\s*du\\s*temps', 'reservee?\\s*du\\s*temps', 'bloquée?\\s*du\\s*temps',
  'programad[oa]', 'cita\\s*agendada', 'lo\\s*puse\\s*en\\s*el\\s*calendario',
  'bloqueé\\s*tiempo', 'bloque\\s*tiempo', 'agendad[oa]',
  'geplant', 'termin\\s*gebucht', 'im\\s*kalender\\s*eingetragen',
  'zeit\\s*geblockt', 'geblockt', 'termin\\s*(?:gesetzt|gemacht)',
]);

/** Narrow gate: only decision-shaped topics (A13). */
export const DECISION_TOPIC_RE =
  /\b(insurance|doctor|pharmacy|dentist|provider|plan|service|bank|carrier|vendor|subscription)\b/i;

// ─── EF cost regexes (A11 trio) ───────────────────────────────────────────

export const EF_EMAIL_RE = /\b(email|reply|message|draft|write\s*to|letter)\b/i;
export const EF_WEB_RE = /\b(book|order|search|portal|website|browse|look\s*up|upload)\b/i;
export const EF_CLICK_RE = /\b(click|tap|toggle|press|approve|confirm|cancel|opt\s*out)\b/i;

// ─── Source citations ─────────────────────────────────────────────────────

export const SOURCES: Record<string, AdminSource> = {
  masicampo: {
    citation: 'Masicampo & Baumeister 2011, J Personality and Social Psychology — Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals',
    url: 'https://doi.org/10.1037/a0024192',
  },
  altgassen2013: {
    citation: 'Altgassen et al. 2013, PLoS ONE — Prospective memory in adults with ADHD',
  },
  gollwitzer: {
    citation: 'Gollwitzer 1999, American Psychologist — Implementation intentions: Strong effects of simple plans',
    url: 'https://doi.org/10.1037/0003-066X.54.7.493',
  },
  reid: {
    citation: 'Reid & Reid 2007 — Telephobia: A neglected aspect of telephone communication apprehension',
  },
  telephobia: {
    citation: 'Telephone phobia prevalence review (PMC11213418)',
  },
  altgassen2014: {
    citation: 'Altgassen, Kretschmer & Kliegel 2014, J Clinical and Experimental Neuropsychology — Time-based PM in adults with ADHD',
    url: 'https://doi.org/10.1080/13803395.2014.910219',
  },
  mioni: {
    citation: 'Mioni et al. 2025 — Event-based vs time-based prospective memory in ADHD',
  },
  volkow: {
    citation: 'Volkow et al. 2009, JAMA — Evaluating dopamine reward pathway in ADHD: clinical implications',
    url: 'https://doi.org/10.1001/jama.2009.1308',
  },
  barkley: {
    citation: 'Barkley 2012, Executive Functions: What They Are, How They Work, and Why They Evolved (Guilford Press) — prospective memory and goal-directed persistence in ADHD',
  },
  steel: {
    citation: 'Steel 2007, Psychological Bulletin — The nature of procrastination: A meta-analytic and theoretical review of quintessential self-regulatory failure',
    url: 'https://doi.org/10.1037/0033-2909.133.1.65',
  },
  risko: {
    citation: 'Risko & Gilbert 2016, Trends in Cognitive Sciences — Cognitive offloading',
    url: 'https://doi.org/10.1016/j.tics.2016.07.002',
  },
  allen: {
    citation: 'Allen 2001/2015, Getting Things Done — 2-minute rule. ADHD: deferred micro-task balloons; immediate execution = ~90sec',
  },
  einstein: {
    citation: 'Einstein & McDaniel 2005, Current Directions in Psychological Science — Prospective memory: Multiple retrieval processes',
    url: 'https://doi.org/10.1111/j.0963-7214.2005.00357.x',
  },
  kahneman1979: {
    citation: 'Kahneman & Tversky 1979, Econometrica — Prospect theory: An analysis of decision under risk',
    url: 'https://doi.org/10.2307/1914185',
  },
  barkley2011: {
    citation: 'Barkley 2011 — Executive Functions: What They Are, How They Work, and Why They Evolved',
  },
  baumeister1998: {
    citation: 'Baumeister, Bratslavsky, Muraven & Tice 1998, JPSP — Ego depletion: Is the active self a limited resource?',
  },
  ariely2002: {
    citation: 'Ariely & Wertenbroch 2002, Psychological Science — Procrastination, deadlines, and performance: Self-control by precommitment',
    url: 'https://doi.org/10.1111/1467-9280.00441',
  },
  baddeley1986: {
    citation: 'Baddeley 1986 — Working Memory (phonological loop, visuospatial sketchpad)',
  },
};
