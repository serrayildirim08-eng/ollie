/**
 * @ollie/logic · work constants
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Days before deadline at which event-cues fire. */
export const DEADLINE_CUE_OFFSETS_DAYS: readonly number[] = [7, 2, 1] as const;

// ─── Multilingual lexicons (mirrors void-app.html IIFE) ──────────────

const _LEFT = '(?:^|[\\s,.!?;:\'"()\\[\\]\\-/])';
const _RIGHT = '(?=[\\s,.!?;:\'"()\\[\\]\\-/]|$)';
const _wrap = (alts: string[]): RegExp =>
  new RegExp(_LEFT + '(?:' + alts.join('|') + ')' + _RIGHT, 'iu');

/** Deadline signal — EN / TR / FR / ES / DE */
export const DEADLINE_RE = _wrap([
  // EN
  'deadline',
  'due\\s*(?:date|by|on|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?',
  'submit\\s*by', 'turn\\s*in\\s*by', 'send\\s*by',
  // TR
  'son\\s*tarih', 'teslim\\s*(?:tarihi|et\\w*)', 'bitirmem\\s*gerek',
  // FR
  'date\\s*limite', 'échéance', 'echeance', 'à\\s*rendre', 'a\\s*rendre',
  // ES
  'fecha\\s*límite', 'fecha\\s*limite', 'plazo', 'entrega',
  // DE
  'frist', 'abgabetermin', 'fällig', 'fallig',
]);

/** Triage / sick-day signal — EN / TR / FR / ES / DE */
export const TRIAGE_RE = _wrap([
  // EN
  'sick', 'ill', 'caregiving', 'caretaker', 'doctor\\s*(?:visit|appointment)?',
  'er\\s*visit', 'emergency\\s*room', 'low\\s*day', 'survival\\s*mode',
  'triage(?:\\s*day)?', 'sick\\s*kid', 'kid\\s*home',
  // TR
  'hasta(?:y[ıi]m)?', 'doktor', 'acil', 'bak[ıi]c[ıi]', 'çocuk\\s*hasta', 'cocuk\\s*hasta',
  // FR
  'malade', 'médecin', 'medecin', 'urgences', 'aidant', 'enfant\\s*malade',
  // ES
  'enferm[oa]', 'médico', 'medico', 'urgencias', 'cuidador(?:a)?',
  'niñ[oa]\\s*enferm[oa]', 'nin[oa]\\s*enferm[oa]',
  // DE
  'krank', 'arzt', 'notaufnahme', 'pflegende[rn]?', 'kind\\s*krank',
]);

/** Feedback / review signal — EN / TR / FR / ES / DE */
export const FEEDBACK_RE = _wrap([
  // EN
  'feedback', 'review', 'critique', 'comments?', 'edits?', 'redline',
  'response\\s*from', 'reply\\s*from', 'reply\\s*to\\s*feedback',
  'manuscript\\s*comments', 'thesis\\s*comments', 'reviewer\\s*[12]',
  'performance\\s*review', 'annual\\s*review', '1[: ]?on[: ]?1\\s*notes',
  // TR
  'geri\\s*bildirim', 'eleştiri', 'elestiri', 'inceleme', 'değerlendirme',
  'degerlendirme', 'yorum(?:lar(?:[ıi]m)?)?', 'cevap\\s*(?:bekleyen|gelen)',
  // FR
  'retour\\s*(?:sur|client|écrit|ecrit)?', 'commentaires?', 'critique',
  'évaluation', 'evaluation', 'corrections?',
  // ES
  'comentarios?', 'revisión', 'revision', 'crítica', 'critica',
  'evaluación', 'evaluacion', 'correcciones?',
  // DE
  'rückmeldung', 'ruckmeldung', 'kritik', 'bewertung', 'anmerkungen',
]);

/** Default linked-event suggestions when no habit state available. */
export const DEFAULT_EVENT_SUGGESTIONS: readonly string[] = [
  'when you open laptop',
  'after morning coffee',
  'after lunch',
] as const;
