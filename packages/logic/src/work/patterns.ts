/**
 * @ollie/logic · work · central detectPatterns wrapper
 *
 * Mirrors the IIFE's detectPatterns function verbatim.
 * W17 triage short-circuits phases 1–3.
 * W0 legacy always runs (pre-dates consent gate convention).
 */

import type { WorkState, WorkPatternOpts, AnyWorkPattern } from './types';
import { detectDeepFocusHours, detectPacingBreach } from './legacy';
import {
  detectTaskSwitchTax,
  detectMeetingCliff,
  scheduleDeadlineCues,
  detectShutdownGap,
  buildTriageAnchor,
  isTriageActive,
} from './phase1';
import {
  detectActivationBarrier,
  detectEstimationDrift,
  detectPostMeetingBuffer,
  detectOneMoreThingSpiral,
  buildCrashPrompt,
  detectHyperfocusCrashPattern,
} from './phase2';
import {
  detectTabSprawl,
  detectNotificationTax,
  detectRecurringMeetingDeads,
  detectMultitaskIllusion,
  matchRSDTitle,
  detectRSDPattern,
} from './phase3';
import { consentOn } from './helpers';

export function detectPatterns(
  history: WorkState | null | undefined,
  opts: WorkPatternOpts,
): AnyWorkPattern[] {
  const out: AnyWorkPattern[] = [];
  const o = opts ?? {};

  // W0 legacy — always runs
  const d = detectDeepFocusHours(history as never, o);
  if (d) out.push(d);
  const pb = detectPacingBreach(history as never, o);
  if (pb) out.push(pb);

  if (!consentOn(o)) return out;
  const state = history ?? {};

  // W17 first — short-circuits phases 1–3
  if (isTriageActive(state, o)) {
    const anchor = buildTriageAnchor(state, o);
    if (anchor) out.push(anchor);
    return out;
  }

  const w1 = detectTaskSwitchTax(state, o);
  if (w1) out.push(w1);

  const w2 = detectMeetingCliff(state, o);
  for (const r of w2) out.push(r);

  if (Array.isArray(o.deadlines) && o.deadlines.length > 0) {
    for (const dl of o.deadlines) {
      const r = scheduleDeadlineCues(dl, o);
      if (r) out.push(r);
    }
  }

  const w12 = detectShutdownGap(state, o);
  if (w12) out.push(w12);

  const w5 = detectActivationBarrier(state, o);
  for (const r of w5) out.push(r);

  const w6 = detectEstimationDrift(state, o);
  if (w6) out.push(w6);

  const w9 = detectPostMeetingBuffer(state, o);
  if (w9) out.push(w9);

  if (typeof o.sessionId === 'string' && o.sessionId) {
    const w11 = detectOneMoreThingSpiral(state, o);
    if (w11) out.push(w11);
  }

  const w3prompt = buildCrashPrompt(state, o);
  if (w3prompt) out.push(w3prompt);
  const w3pattern = detectHyperfocusCrashPattern(state, o);
  if (w3pattern) out.push(w3pattern);

  const w7 = detectTabSprawl(state, o);
  if (w7) out.push(w7);

  const w8 = detectNotificationTax(state, o);
  if (w8) out.push(w8);

  const w10 = detectRecurringMeetingDeads(state, o);
  for (const r of w10) out.push(r);

  const w13 = detectMultitaskIllusion(state, o);
  if (w13) out.push(w13);

  if (typeof o.taskTitle === 'string' && o.taskTitle.length > 0) {
    const w14prompt = matchRSDTitle(o.taskTitle, o);
    if (w14prompt) out.push(w14prompt);
  }
  const w14pattern = detectRSDPattern(state, o);
  if (w14pattern) out.push(w14pattern);

  return out;
}
