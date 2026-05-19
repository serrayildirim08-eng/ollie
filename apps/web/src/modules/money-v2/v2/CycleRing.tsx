/**
 * v2 · <CycleRing> — the phase ring
 *
 * A shared v2 primitive (added for cycle, lives in the shared `v2/` dir so
 * body / home can reuse it). The big light-weight focus ring from
 * cycle.html / cycle-cold.html:
 *
 *   - a calm full-cycle track
 *   - a sage luteal arc (only when `lutealStartDay` is known)
 *   - a quiet open-ink ovulation point (only when `ovulationDay` is known)
 *   - an amber travelling marker for today's day
 *   - a centred day number + uppercase phase label
 *
 * Everything but the track is optional, so the same component renders the
 * cold-start ring (track + a single small day-marker, no arc) and the
 * warmed ring (arc + ovulation point + marker).
 *
 * Geometry follows cycle.html exactly: a 236×236 viewBox, r=100, centre
 * (118,118). Day N rides the ring at angle -90° + (N/length)*360° — 0 at
 * the top, clockwise. `boxSizing: border-box` throughout.
 */
import { v2 } from './tokens';

export interface CycleRingProps {
  /** the cycle's current day (1-based) — the centre number + marker */
  day: number;
  /** the uppercase phase label inside the ring */
  phase: string;
  /** the cycle length in days — sets the ring's angular scale */
  length: number;
  /** first day of the luteal arc; omit for the cold ring (no arc) */
  lutealStartDay?: number;
  /** ovulation day — draws the small open-ink point; omit for cold ring */
  ovulationDay?: number;
  /** ring diameter in px (the viewBox stays 236) */
  size?: number;
}

const VIEW = 236;
const CX = 118;
const CY = 118;
const R = 100;
const CIRC = 2 * Math.PI * R; // ≈ 628.3

/** point on the ring for a 1-based day, 0° = top, clockwise */
function ringPoint(day: number, length: number): { x: number; y: number } {
  const frac = Math.max(0, Math.min(1, (day - 1) / Math.max(1, length)));
  const angle = -Math.PI / 2 + frac * 2 * Math.PI;
  return {
    x: CX + R * Math.cos(angle),
    y: CY + R * Math.sin(angle),
  };
}

export function CycleRing({
  day,
  phase,
  length,
  lutealStartDay,
  ovulationDay,
  size = 236,
}: CycleRingProps) {
  const safeLength = Math.max(1, length);
  const marker = ringPoint(day, safeLength);

  // luteal arc: starts at (lutealStartDay-1)/length along the ring
  let arcDash: string | undefined;
  let arcOffset: number | undefined;
  if (typeof lutealStartDay === 'number') {
    const startFrac = Math.max(0, Math.min(1, (lutealStartDay - 1) / safeLength));
    const arcStart = startFrac * CIRC;
    const arcLen = CIRC - arcStart;
    arcDash = `${arcLen} ${arcStart}`;
    arcOffset = -arcStart;
  }

  const ov =
    typeof ovulationDay === 'number'
      ? ringPoint(ovulationDay + 0.5, safeLength)
      : null;

  return (
    <div
      style={{
        boxSizing: 'border-box',
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        style={{ position: 'absolute', display: 'block' }}
        aria-hidden
      >
        {/* full cycle track */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={v2.line} strokeWidth={9} />

        {/* luteal arc — sage, the back stretch */}
        {arcDash && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={v2.sage}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={arcDash}
            strokeDashoffset={arcOffset}
            transform={`rotate(-90 ${CX} ${CY})`}
            opacity={0.85}
          />
        )}

        {/* ovulation point — a small open ink ring */}
        {ov && (
          <circle cx={ov.x} cy={ov.y} r={5.5} fill="none" stroke={v2.ink} strokeWidth={2} />
        )}

        {/* travelling day marker — amber, with a paper halo */}
        <circle cx={marker.x} cy={marker.y} r={8} fill={v2.accent} />
        <circle
          cx={marker.x}
          cy={marker.y}
          r={8}
          fill="none"
          stroke={v2.paper}
          strokeWidth={3.5}
        />
      </svg>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
        }}
        role="img"
        aria-label={`cycle day ${day}, ${phase}`}
      >
        <div
          style={{
            fontSize: 46,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {day}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {phase}
        </div>
      </div>
    </div>
  );
}
