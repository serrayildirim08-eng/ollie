/**
 * body-v2 · <Glass> — the water-vessel visual
 *
 * The tumbler-outline glass from body-detail.html / body-intake.html /
 * body-cold.html. An ink outline with sage water filled to a 0..1 level.
 * At fill 0 it is just the outline + a faint dashed half-line ghost — it
 * reads "waiting to fill", never broken.
 *
 * Two sizes: `big` (the intake / cold hero, 118×160) and the small inline
 * glass (22×30) the episode-face background line uses. Faithful to the
 * mockups' SVG geometry. Decorative — `aria-hidden`.
 */
import { useId } from 'react';
import { v2 } from '../../money-v2/v2';

export interface GlassProps {
  /** 0..1 fill level */
  fill: number;
  /** the big hero glass (default) or the small inline glass */
  size?: 'big' | 'small';
}

export function Glass({ fill, size = 'big' }: GlassProps) {
  const clipId = useId();
  const f = Math.max(0, Math.min(1, fill));

  if (size === 'small') {
    // body-detail.html .glass — a 22×30 inline glass, viewBox 34×46
    // inner cavity y ≈ 5..41 (h ≈ 36); water rises from the base
    const cavityTop = 5;
    const cavityBottom = 41;
    const waterTop = cavityBottom - f * (cavityBottom - cavityTop);
    return (
      <svg
        width={22}
        height={30}
        viewBox="0 0 34 46"
        aria-hidden
        style={{ display: 'block' }}
      >
        <clipPath id={clipId}>
          <path d="M7.5 5 L26.5 5 L24.8 35 Q24.4 41 17 41 Q9.6 41 9.2 35 Z" />
        </clipPath>
        {f > 0 && (
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={6}
              y={waterTop}
              width={22}
              height={cavityBottom - waterTop + 6}
              fill={v2.sage}
              opacity={0.88}
            />
            <line
              x1={6}
              y1={waterTop + 0.4}
              x2={28}
              y2={waterTop + 0.4}
              stroke="#fff"
              strokeWidth={1}
              opacity={0.45}
            />
          </g>
        )}
        <path
          d="M7 4 L27 4 L25.1 35 Q24.6 42 17 42 Q9.4 42 8.9 35 Z"
          fill="none"
          stroke={v2.ink}
          strokeWidth={1.6}
        />
      </svg>
    );
  }

  // body-intake.html .bigglass — a 118×160 tumbler, viewBox 118×160
  // inner cavity y ≈ 18..142 (h ≈ 124)
  const cavityTop = 18;
  const cavityBottom = 142;
  const waterTop = cavityBottom - f * (cavityBottom - cavityTop);
  return (
    <svg
      width={118}
      height={160}
      viewBox="0 0 118 160"
      aria-hidden
      style={{ display: 'block' }}
    >
      <clipPath id={clipId}>
        <path d="M26 18 L92 18 L86 122 Q84.6 142 59 142 Q33.4 142 32 122 Z" />
      </clipPath>
      {f > 0 ? (
        <g clipPath={`url(#${clipId})`}>
          <rect
            x={22}
            y={waterTop}
            width={74}
            height={cavityBottom - waterTop + 18}
            fill={v2.sage}
            opacity={0.88}
          />
          <line
            x1={22}
            y1={waterTop + 1}
            x2={96}
            y2={waterTop + 1}
            stroke="#fff"
            strokeWidth={2.4}
            opacity={0.5}
          />
        </g>
      ) : (
        // empty: a faint dashed half-line ghost so the glass reads as a scale
        <line
          x1={33}
          y1={80}
          x2={86}
          y2={80}
          stroke={v2.line}
          strokeWidth={1.6}
          strokeDasharray="3 4"
        />
      )}
      <path
        d="M24 14 L94 14 L87.5 122 Q86 145 59 145 Q32 145 30.5 122 Z"
        fill="none"
        stroke={v2.ink}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}
