/**
 * admin-v2 · <Runway> — the renewal-runway visual
 *
 * The tailored hero visual from admin.html / admin-cold.html: a flat
 * horizontal track with the four staged renewal cues (90 · 30 · 7 · 0 days)
 * marked as quiet ticks, and an umber marker riding it at the renewal's
 * current position. Body's bar-grammar reworked flat — a calm "where it
 * sits" object, never a countdown alarm.
 *
 * `pos` is 0..1: 1 = at the 90-day stage (far left, just started), 0 = due
 * or overdue (far right). When `pos` is null the runway renders bare —
 * faint dashed ticks, no marker — the calm cold-start state.
 *
 * The geometry is lifted verbatim from the mockup SVG (208×44 viewBox).
 */
import { v2 } from '../../money-v2/v2';

export interface RunwayProps {
  /** marker position 0..1, or null for the bare cold runway */
  pos: number | null;
}

const TRACK_X0 = 8;
const TRACK_X1 = 200;
const TRACK_Y = 30;

/** map a 0..1 position to the runway's pixel x (1 = left start, 0 = right) */
function markerX(pos: number): number {
  const clamped = Math.max(0, Math.min(1, pos));
  return TRACK_X1 - clamped * (TRACK_X1 - TRACK_X0);
}

export function Runway({ pos }: RunwayProps) {
  if (pos == null) {
    // the bare cold runway — dashed track, faint ticks, no marker
    return (
      <div style={{ boxSizing: 'border-box', width: 208, height: 44, marginBottom: 24 }}>
        <svg width="208" height="44" viewBox="0 0 208 44" style={{ display: 'block' }} aria-hidden>
          <line
            x1={TRACK_X0}
            y1={TRACK_Y}
            x2={TRACK_X1}
            y2={TRACK_Y}
            stroke={v2.line}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="2 5"
          />
          {[8, 72, 136, 200].map((x) => (
            <line key={x} x1={x} y1={25} x2={x} y2={35} stroke={v2.line} strokeWidth={1.6} />
          ))}
        </svg>
      </div>
    );
  }

  const mx = markerX(pos);
  // the travelled stretch — from the 90-day start tick to the marker
  return (
    <div style={{ boxSizing: 'border-box', width: 208, height: 44, marginBottom: 24 }}>
      <svg width="208" height="44" viewBox="0 0 208 44" style={{ display: 'block' }} aria-hidden>
        {/* the runway baseline */}
        <line
          x1={TRACK_X0}
          y1={TRACK_Y}
          x2={TRACK_X1}
          y2={TRACK_Y}
          stroke={v2.line}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* the stretch already travelled — start → marker, umber, soft */}
        <line
          x1={TRACK_X0}
          y1={TRACK_Y}
          x2={mx}
          y2={TRACK_Y}
          stroke="#A8703C"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.4}
        />
        {/* stage ticks: 90d, 30d, 7d, 0d */}
        <line x1={8} y1={24} x2={8} y2={36} stroke={v2.line} strokeWidth={2} />
        <line x1={142} y1={24} x2={142} y2={36} stroke={v2.line} strokeWidth={2} />
        <line x1={178} y1={24} x2={178} y2={36} stroke={v2.line} strokeWidth={2} />
        <line x1={200} y1={24} x2={200} y2={36} stroke={v2.line} strokeWidth={2} />
        {/* the travelling marker — an umber dot with a paper halo */}
        <circle cx={mx} cy={TRACK_Y} r={7} fill="#A8703C" />
        <circle cx={mx} cy={TRACK_Y} r={7} fill="none" stroke={v2.paper} strokeWidth={3} />
        {/* the barely-there stage labels */}
        <text x={8} y={14} fontSize={9} fontWeight={600} fill={v2.mute} textAnchor="middle">
          90
        </text>
        <text x={142} y={14} fontSize={9} fontWeight={600} fill={v2.mute} textAnchor="middle">
          30
        </text>
        <text x={178} y={14} fontSize={9} fontWeight={600} fill={v2.mute} textAnchor="middle">
          7
        </text>
        <text x={200} y={14} fontSize={9} fontWeight={600} fill={v2.mute} textAnchor="middle">
          0
        </text>
      </svg>
    </div>
  );
}
