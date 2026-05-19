/**
 * v2 · <ProgressArc> — the 270° open progress gauge
 *
 * A shared v2 primitive (added for the habits module, lives in the shared
 * `v2/` dir for body / home reuse). The progress arc from habits.html —
 * a ~270° open arc, deliberately NOT a closed ring: a calm line track,
 * filled in ink for the fraction `done / total`, with a centred ledger
 * count beneath an uppercase label.
 *
 * It is a LEDGER mark, not a score: the centre reads "n", never "n / m" in
 * a way that grades. When nothing is done the centre number renders in the
 * calm `mute` ink (the cold "the day's ahead" state), not the bold ink.
 *
 * Geometry follows habits.html exactly: a 112×112 viewBox, r=46, centre
 * (56,56). The arc opens at the bottom — a 270° sweep starting at 135°
 * (bottom-left), gap centred downward. `boxSizing: border-box` throughout.
 */
import { v2 } from './tokens';

export interface ProgressArcProps {
  /** how many are done — the filled portion + the centre number */
  done: number;
  /** the total on file — sets the fill fraction */
  total: number;
  /** the small uppercase label under the count */
  label: string;
  /** gauge diameter in px (the viewBox stays 112) */
  size?: number;
}

const VIEW = 112;
const C = 56;
const R = 46;
const CIRC = 2 * Math.PI * R; // ≈ 289.0
/** the visible arc is 270° of the full circle */
const ARC_LEN = CIRC * 0.75; // ≈ 216.8
const GAP_LEN = CIRC - ARC_LEN; // ≈ 72.2

export function ProgressArc({ done, total, label, size = 112 }: ProgressArcProps) {
  const safeTotal = Math.max(0, total);
  const safeDone = Math.max(0, Math.min(done, safeTotal));
  const frac = safeTotal > 0 ? safeDone / safeTotal : 0;
  const fillLen = ARC_LEN * frac;

  return (
    <div
      style={{
        boxSizing: 'border-box',
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        style={{ display: 'block' }}
        aria-hidden
      >
        {/* the open 270° track — a calm line */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={v2.line}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN} ${GAP_LEN}`}
          transform={`rotate(135 ${C} ${C})`}
        />
        {/* the ink fill — done / total of the 270° arc */}
        {fillLen > 0 && (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={v2.ink}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${fillLen} ${CIRC - fillLen}`}
            transform={`rotate(135 ${C} ${C})`}
          />
        )}
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        role="img"
        aria-label={`${safeDone} of ${safeTotal} — ${label}`}
      >
        <div
          style={{
            fontSize: 34,
            fontWeight: safeDone > 0 ? 300 : 200,
            color: safeDone > 0 ? v2.ink : v2.mute,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {safeDone}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
