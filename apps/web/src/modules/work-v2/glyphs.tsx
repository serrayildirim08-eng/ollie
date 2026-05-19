/**
 * work-v2 · module-local glyphs
 *
 * The matter file-tab marks for the matters concept. They live in the module
 * rather than the shared v2 icon set — mirroring the way partner-v2 keeps its
 * `SettingsGlyph` local. Inline SVG, no dependency.
 *
 * Phase 1/2 is passive — there is no urgency concept yet (urgency framing
 * belongs to the unbuilt Phase-3 briefing), so these glyphs are drawn calm,
 * no warm/severity variant.
 */
import { v2 } from '../money-v2/v2';

/**
 * The matter mark — a single file-tab glyph used in the matter-list gutter,
 * the empty state, and the work-face preview. Calm muted ink. Decorative —
 * every use sits next to the matter's name.
 */
export function MatterMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={v2.mute}
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h6l2 2h8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/**
 * The matter-stack glyph — three overlapping file-tabs. The work face's
 * gutter visual: reads as "a few matters" at a glance. Calm — no warm tab,
 * Phase 1/2 carries no urgency. Decorative.
 */
export function MatterStack() {
  return (
    <svg width={50} height={46} viewBox="0 0 50 46" aria-hidden>
      <path
        fill="none"
        stroke={v2.mute}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M12 13h14l3 3h13v22a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z"
      />
      <path
        fill="none"
        stroke={v2.mute}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M9 19h14l3 3h13v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V21a2 2 0 0 1 2-2z"
      />
      <path
        fill={v2.tile}
        stroke={v2.mute}
        strokeWidth={1.7}
        strokeLinejoin="round"
        d="M6 25h14l3 3h13v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}
