/**
 * Ball-state inference (audit #7, v1).
 *
 * A new task defaults to `mine`. At capture time we move it to `waiting` only
 * when the text carries a CLEAR hand-off / awaiting-reply signal — the founder's
 * v1 list. Conservative by design: ambiguous text stays `mine` (better to keep
 * a task on the user's plate than to silently park it as waiting).
 *
 * Pure + standalone so it is trivially unit-testable and reusable by the
 * handler (AI capture) and any future manual UI control.
 */

import type { BallState } from './types';

// Lowercased substring signals (EN + a little ES/TR for the trilingual app).
const WAITING_SIGNALS: string[] = [
  'waiting for reply',
  'waiting to hear back',
  'waiting on',
  'sent the form',
  'sent the application',
  'submitted application',
  'submitted the',
  'they will confirm',
  "they'll confirm",
  'they will reply',
  "they'll reply",
  'will get back to me',
  'will call back',
  'landlord will',
  'doctor will call',
  'awaiting',
  // ES
  'esperando respuesta',
  'envié el formulario',
  // TR
  'cevap bekliyorum',
  'geri dönecekler',
  'formu gönderdim',
];

/** True when the text clearly indicates the ball is now on someone else's side. */
export function looksLikeWaiting(text: string): boolean {
  const t = text.toLowerCase();
  return WAITING_SIGNALS.some((s) => t.includes(s));
}

/** Initial ball_state for a freshly captured task: waiting on a clear signal,
 *  else mine. */
export function inferInitialBallState(text: string): BallState {
  return looksLikeWaiting(text) ? 'waiting' : 'mine';
}
