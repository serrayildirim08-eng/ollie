/**
 * Partner · interpretation engine (device-side, decision 10 layer A).
 *
 * Pure module — no IO, no clock, no AI. Maps raw per-channel signals into the
 * soft "intimate window" language a partner sees. Only channels the sharer has
 * consented to are ever read here; the caller passes consent in.
 *
 * Hard rule: output is gentle phrasing, NEVER numbers ("tender day", not
 * "mood 3/10"). AI is deliberately NOT used for the daily path — it only ever
 * touches the crisis path (decision 10), which is handled by the caller.
 */

import type { ConsentFlags, InterpretedState } from './types';

export type MoodSignal = 'low' | 'neutral' | 'high' | null;
export type EnergySignal = 'low' | 'mid' | 'high' | null;
export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | null;
export type FocusSignal = 'deep' | 'scattered' | null;

export interface RawSignals {
  mood: MoodSignal;
  energy: EnergySignal;
  cyclePhase: CyclePhase;
  focus: FocusSignal;
}

/**
 * Turn consented raw signals into soft phrases. Order matters — emotional state
 * first (mood/cycle), then capacity (energy/focus). De-duped so cycle+mood
 * don't both say "tender day".
 */
export function interpret(
  signals: RawSignals,
  consent: ConsentFlags,
  opts: { selfWord?: string | null; crisis?: boolean; goneDark?: boolean; nowMs: number },
): InterpretedState {
  const phrases: string[] = [];
  const push = (p: string) => {
    if (p && !phrases.includes(p)) phrases.push(p);
  };

  // ── emotional weather (mood, then cycle as a softener) ──
  if (consent.mood) {
    if (signals.mood === 'low') push('tender day');
    else if (signals.mood === 'high') push('bright day');
  }
  if (consent.cycle && signals.cyclePhase === 'menstrual') push('tender day');
  if (consent.cycle && signals.cyclePhase === 'luteal' && signals.mood !== 'high') {
    push('winding down');
  }

  // ── capacity (energy, focus) ──
  if (consent.energy) {
    if (signals.energy === 'low') push('low energy');
    else if (signals.energy === 'high') push('good energy');
  }
  if (consent.focus) {
    if (signals.focus === 'deep') push('heads-down');
    else if (signals.focus === 'scattered') push('scattered');
  }

  return {
    phrases: phrases.slice(0, 3),
    selfWord: opts.selfWord ?? null,
    crisis: opts.crisis ?? false,
    goneDark: opts.goneDark ?? false,
    updatedAtMs: opts.nowMs,
  };
}

/**
 * The single line shown on the ambient card, given an interpreted state and the
 * partner's name. Honours the locked copy decisions:
 *   - go-dark  → "Serra · taking today off" (decision 14, plain not poetic)
 *   - crisis   → "Serra needs you today" (decision 7/8, Level-1 text only)
 *   - empty    → a gentle "steady day" rather than a blank
 */
export function cardLine(name: string, state: InterpretedState): string {
  if (state.goneDark) return `${name} · taking today off`;
  if (state.crisis) return `${name} needs you today`;
  const parts = [...state.phrases];
  if (state.selfWord) parts.push(state.selfWord);
  const body = parts.length > 0 ? parts.join(' · ') : 'steady day';
  return `${name} · ${body}`;
}
