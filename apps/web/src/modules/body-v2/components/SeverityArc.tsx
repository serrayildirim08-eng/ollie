/**
 * body-v2 · <SeverityArc> — the calm severity sparkline
 *
 * The check-in-by-check-in severity line from body-episode.html /
 * body-detail.html / body-doctor-summary.html. A baseline rule, a quiet
 * ink polyline of 1..5 severity values, the last point amber (today's
 * check-in). NO grade marks, NO chart chrome — a calm rising-then-easing
 * line, never a "score".
 *
 * Three sizes mirror the three places the arc appears: `mini` (the face,
 * 148×46), `card` (the episode card, ~300×96) and `brief` (the doctor
 * summary, ~320×78). Decorative — `aria-hidden`.
 */
import { v2 } from '../../money-v2/v2';

export interface SeverityArcProps {
  /** severity values 1..5, oldest first; the last is "today" */
  points: number[];
  /** which surface the arc sits on */
  variant?: 'mini' | 'card' | 'brief';
  /** optional small day labels under a card / brief arc */
  dayLabels?: string[];
}

interface ArcGeom {
  w: number;
  h: number;
  padX: number;
  /** y for severity 5 (top) and severity 1 (bottom) */
  yTop: number;
  yBottom: number;
  stroke: number;
  dot: number;
  lastDot: number;
}

const GEOM: Record<NonNullable<SeverityArcProps['variant']>, ArcGeom> = {
  mini: { w: 148, h: 46, padX: 20, yTop: 8, yBottom: 34, stroke: 2, dot: 3, lastDot: 4.4 },
  card: { w: 300, h: 96, padX: 40, yTop: 14, yBottom: 82, stroke: 2.4, dot: 4, lastDot: 5.5 },
  brief: { w: 320, h: 78, padX: 42, yTop: 12, yBottom: 66, stroke: 2.2, dot: 3.6, lastDot: 4.8 },
};

export function SeverityArc({
  points,
  variant = 'mini',
  dayLabels,
}: SeverityArcProps) {
  const g = GEOM[variant];
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => typeof p === 'number' && Number.isFinite(p))
    .map((p) => Math.max(1, Math.min(5, p)));

  // y maps severity 1 → yBottom ... 5 → yTop
  const yFor = (sev: number) =>
    g.yBottom - ((sev - 1) / 4) * (g.yBottom - g.yTop);

  const xFor = (i: number) => {
    if (pts.length <= 1) return g.w / 2;
    return g.padX + (i * (g.w - g.padX * 2)) / (pts.length - 1);
  };

  const coords = pts.map((sev, i) => ({ x: xFor(i), y: yFor(sev) }));
  const baselineY = g.h - 6;

  return (
    <div style={{ width: '100%' }}>
      <svg
        width={variant === 'mini' ? g.w : '100%'}
        height={variant === 'mini' ? g.h : undefined}
        viewBox={`0 0 ${g.w} ${g.h}`}
        preserveAspectRatio={variant === 'mini' ? undefined : 'none'}
        aria-hidden
        style={{ display: 'block' }}
      >
        {variant === 'mini' ? (
          <line
            x1={6}
            y1={baselineY}
            x2={g.w - 6}
            y2={baselineY}
            stroke={v2.line}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ) : (
          <>
            {/* two faint reference rules: severity 5 (top), 1 (bottom) */}
            <line x1={6} y1={g.yTop} x2={g.w - 6} y2={g.yTop} stroke={v2.line} strokeWidth={1} />
            <line
              x1={6}
              y1={g.yBottom}
              x2={g.w - 6}
              y2={g.yBottom}
              stroke={v2.line}
              strokeWidth={1}
            />
          </>
        )}

        {coords.length >= 2 && (
          <polyline
            points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
            fill="none"
            stroke={v2.ink}
            strokeWidth={g.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.58}
          />
        )}
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          return (
            <circle
              key={`${c.x}-${c.y}-${i}`}
              cx={c.x}
              cy={c.y}
              r={isLast ? g.lastDot : g.dot}
              fill={isLast ? v2.accent : v2.ink}
              opacity={isLast ? 1 : 0.58}
            />
          );
        })}
      </svg>

      {dayLabels && dayLabels.length > 0 && (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0 4px',
          }}
        >
          {dayLabels.map((d, i) => (
            <span
              key={`${d}-${i}`}
              style={{
                fontSize: variant === 'brief' ? 9.5 : 10,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
