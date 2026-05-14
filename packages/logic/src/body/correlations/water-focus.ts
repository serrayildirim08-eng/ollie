/**
 * @ollie/logic · body · water → focus correlator
 *
 * STATUS: PENDING
 *
 * Blocker: no `focus_rating` numeric in the store today. work.focus_log
 * carries `{ ts, duration_ms }` — a duration is not a rating. Mapping
 * duration → rating via a hand-rolled heuristic would be fake correlation
 * dressed up as math.
 *
 * Unblocks: add a self-rated focus quality (1–5) to focus_log entries
 * OR add a brain-dump-derived focus clarity proxy (separate correlator).
 *
 * Honest no-op — returns sentinel implemented=false; registry skips emit.
 */

export interface WaterFocusResult {
  correlation: null;
  sampleSize: 0;
  copy: '';
  ts: number;
  implemented: false;
  reason: 'no focus_rating numeric in store · awaiting either self-rated focus quality or a brain-dump clarity proxy';
}

export function correlateWaterAndFocus(
  _waterLog: unknown,
  _focusLog: unknown,
  opts?: { now?: number },
): WaterFocusResult {
  return {
    correlation: null,
    sampleSize: 0,
    copy: '',
    ts: opts?.now ?? Date.now(),
    implemented: false,
    reason:
      'no focus_rating numeric in store · awaiting either self-rated focus quality or a brain-dump clarity proxy',
  };
}
