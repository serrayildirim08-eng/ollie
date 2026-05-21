/**
 * PendingHair — 6px-thin shimmer hairline for "we're working on it" states.
 *
 * Use cases:
 *   • bottom edge of BrainDumpInput while a grocery route is mid-flight
 *     (cache miss → Gemini call). Cache hits skip this entirely because
 *     they resolve inside one frame.
 *   • underneath a grocery item row that's still being categorized.
 *
 * Design DNA:
 *   • Hairline weight only (1px stroke, 6px total height container).
 *   • Sage accent (`--accent`) gradient that drifts left→right.
 *   • Respects `prefers-reduced-motion`: gradient becomes a static
 *     sage hairline (no animation, still visible as a "busy" signal).
 *
 * No color carries information — the hairline only signals *busy*, not
 * success/failure. Resolution belongs to SortedToast.
 */

import { useId } from 'react';

export interface PendingHairProps {
  /** Render as a flat, parent-positioned hairline. Default true. When false
   *  the hair absolutely positions itself across its parent's bottom edge —
   *  caller's parent must be `position: relative`. */
  flow?: boolean;
  /** Stretch width. Defaults to `100%`. */
  width?: string | number;
  /** Aria label override; default reads "sorting". */
  label?: string;
}

export function PendingHair({
  flow = true,
  width = '100%',
  label = 'sorting',
}: PendingHairProps) {
  // unique class so multiple instances can coexist without collision; the
  // keyframes scope to this instance via the generated class id.
  const reactId = useId();
  // useId returns ":r1:" style strings — strip colons for a valid class.
  const cls = `pending-hair-${reactId.replace(/:/g, '')}`;

  return (
    <span
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cls}
      style={{
        display: 'block',
        position: flow ? 'relative' : 'absolute',
        bottom: flow ? undefined : 0,
        left: flow ? undefined : 0,
        right: flow ? undefined : 0,
        width,
        height: '6px',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <style>{`
        .${cls}::before {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: var(--rule);
          transform: translateY(-50%);
        }
        .${cls}::after {
          content: '';
          position: absolute;
          left: -40%;
          top: 50%;
          width: 40%;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            var(--accent, #2E5D43) 50%,
            transparent 100%
          );
          transform: translateY(-50%);
          animation: ${cls}-drift 1400ms linear infinite;
          opacity: 0.85;
        }
        @keyframes ${cls}-drift {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .${cls}::after {
            animation: none;
            left: 0;
            width: 100%;
            background: var(--accent, #2E5D43);
            opacity: 0.45;
          }
        }
      `}</style>
    </span>
  );
}
