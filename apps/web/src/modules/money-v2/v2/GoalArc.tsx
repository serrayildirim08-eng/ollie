/**
 * v2 · <GoalArc> — the 270° open percent gauge
 *
 * A shared v2 primitive (added for the goals module, lives in the shared
 * `v2/` dir for reuse). The progress arc from goals.html — a ~270° open
 * arc, deliberately NOT a closed score-ring: a calm line track, filled in
 * ink to a `pct` (0..100). The centre shows either a large light percent
 * (a goal in motion) or arbitrary children (the cold state's seed glyph).
 *
 * It is a calm shape, never a number to beat. When `pct` is 0 the centre
 * percent renders in the calm `mute` ink, not the bold ink.
 *
 * Geometry follows goals.html exactly: a 204×204 viewBox, r=86, centre
 * (102,102), an 8px stroke. The arc opens at the bottom — a 270° sweep
 * starting at 135° (bottom-left), gap centred downward. `boxSizing:
 * border-box` throughout.
 */
import type { ReactNode } from 'react';
import { v2 } from './tokens';

const VIEW = 204;
const C = 102;
const R = 86;
const CIRC = 2 * Math.PI * R; // ≈ 540.4
/** the visible track is 270° of the full circle */
const ARC_LEN = CIRC * 0.75; // ≈ 405.3
const GAP_LEN = CIRC - ARC_LEN; // ≈ 135.1

export interface GoalArcProps {
  /** the fill percent 0..100; null = an empty arc (the cold state) */
  pct: number | null;
  /**
   * the centre content. When omitted and `pct` is non-null, a large light
   * percent number is drawn. The cold face passes a seed glyph here.
   */
  children?: ReactNode;
  /** the small uppercase label under the centre content */
  label?: string;
  /** gauge diameter in px (the viewBox stays 204) */
  size?: number;
}

export function GoalArc({ pct, children, label, size = 204 }: GoalArcProps) {
  const safePct =
    pct == null ? null : Math.max(0, Math.min(100, Math.round(pct)));
  const fillLen = safePct != null ? ARC_LEN * (safePct / 100) : 0;

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
        {/* the open 270° track — a calm line */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={v2.line}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN} ${GAP_LEN}`}
          transform={`rotate(135 ${C} ${C})`}
        />
        {/* the ink fill — pct of the 270° arc; soft, never a score-ring */}
        {fillLen > 0 && (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={v2.ink}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${fillLen} ${CIRC - fillLen}`}
            transform={`rotate(135 ${C} ${C})`}
            opacity={0.82}
          />
        )}
      </svg>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
        role="img"
        aria-label={
          safePct != null
            ? `${safePct}% — ${label ?? 'progress'}`
            : (label ?? 'nothing growing yet')
        }
      >
        {children ?? (
          <div
            style={{
              fontSize: 52,
              fontWeight: 300,
              color: safePct && safePct > 0 ? v2.ink : v2.mute,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {safePct ?? 0}%
          </div>
        )}
        {label && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
