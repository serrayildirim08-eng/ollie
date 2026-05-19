/**
 * grocery-v2 · <ShelfBar> — the shelf-life fill-bar (grocery-pantry.html)
 *
 * A thin track, a fill showing % of shelf life remaining. The fill colour
 * follows the shelf tier: umber when critical, amber when watching, sage
 * when stocked. A calm data object, never a progress race. Decorative —
 * the days label next to it carries the real value to the reader.
 */
import { v2 } from '../../money-v2/v2';
import type { ShelfTier } from '../selectors';

const FILL: Record<ShelfTier, string> = {
  critical: v2.umber,
  watching: v2.accent,
  stocked: v2.sage,
};

export interface ShelfBarProps {
  /** 0..1 — the % of shelf life remaining */
  fill: number;
  tier: ShelfTier;
}

export function ShelfBar({ fill, tier }: ShelfBarProps) {
  const w = Math.max(0, Math.min(1, fill));
  return (
    <div
      aria-hidden
      style={{
        boxSizing: 'border-box',
        height: 5,
        borderRadius: 3,
        background: v2.line,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${w * 100}%`,
          borderRadius: 3,
          background: FILL[tier],
        }}
      />
    </div>
  );
}
