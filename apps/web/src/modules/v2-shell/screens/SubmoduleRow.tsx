/**
 * v2-shell · <SubmoduleRow> + <ObservedNote>
 *
 * The shared info-card grammar for the Level-2 module homepages
 * (body.html / home.html / work.html). DIRECTION.md "the expandable
 * info-card": a submodule on a module page is one card — a visual gutter,
 * a glance line of real data, a chevron — and an optional at-rest preview
 * body of 2-3 real lines underneath (home / work carry these; body's five
 * thinner rows mostly do not).
 *
 * Tapping the row routes straight into the submodule's real `*-v2` app —
 * the shell mounts it. (DIRECTION.md keeps an inline-expand tier; for the
 * shell's first cut a tap goes to the detail page, which the mockups also
 * support via the `open …` cue. The expand-in-place tier is a documented
 * follow-up.)
 *
 * `ObservedNote` is the sage-dot + one-line observation that closes a
 * homepage (body.html / home.html / work.html `.note`).
 */
import type { ReactNode } from 'react';
import { v2 } from '../../money-v2/v2';

const box = { boxSizing: 'border-box' as const };

export interface SubmoduleRowProps {
  /** the small uppercase submodule key ("CYCLE", "SLEEP", …) */
  label: string;
  /** the one glanceable line of real data */
  glance: ReactNode;
  /** the micro-visual for the gutter */
  visual: ReactNode;
  /** gutter width — body uses 54, home/work use 62 */
  vizWidth?: number;
  /** the at-rest preview body — real data lines under the glance line */
  preview?: ReactNode;
  /** the `open …` cue copy ("open sleep", "open work") */
  openCue?: string;
  /** draw the top hairline (the homepage sets it on the first row) */
  first?: boolean;
  /** draw the bottom hairline (the homepage sets it on the last row) */
  last?: boolean;
  /** tap → mount the submodule's real `*-v2` app */
  onOpen: () => void;
}

export function SubmoduleRow({
  label,
  glance,
  visual,
  vizWidth = 54,
  preview,
  openCue,
  first = false,
  last = false,
  onOpen,
}: SubmoduleRowProps) {
  // preview + open cue align under the text column, not the visual gutter
  const textInset = vizWidth + (vizWidth >= 62 ? 16 : 14);

  return (
    <div
      style={{
        ...box,
        borderTop: first ? `1px solid ${v2.line}` : `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '20px 2px',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={openCue ?? `open ${label.toLowerCase()}`}
        style={{
          ...box,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: vizWidth >= 62 ? 16 : 14,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* the micro-visual gutter */}
        <span
          aria-hidden
          style={{ ...box, width: vizWidth, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {visual}
        </span>
        {/* glance text */}
        <span style={{ ...box, flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: v2.mute, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            {label}
          </span>
          <span style={{ fontSize: 14, color: v2.ink, fontWeight: 500, letterSpacing: '-.01em' }}>
            {glance}
          </span>
        </span>
        {/* chevron */}
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={v2.mute} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: 6 }} aria-hidden>
          <path d="M9 6l6 6 6-6" transform="rotate(-90 12 12)" />
        </svg>
      </button>

      {/* at-rest preview body */}
      {preview && (
        <div style={{ ...box, marginTop: 14, marginLeft: textInset, display: 'flex', flexDirection: 'column' }}>
          {preview}
        </div>
      )}

      {/* the open cue */}
      {openCue && (
        <button
          type="button"
          onClick={onOpen}
          style={{
            ...box,
            marginTop: 16,
            marginLeft: textInset,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            color: v2.accent,
            fontWeight: 600,
            letterSpacing: '.02em',
            cursor: 'pointer',
            display: 'block',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {openCue} →
        </button>
      )}
    </div>
  );
}

export interface ObservedNoteProps {
  children: ReactNode;
}

/** the sage-dot + one-line observation closing a module homepage. */
export function ObservedNote({ children }: ObservedNoteProps) {
  return (
    <div style={{ ...box, marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: v2.sage, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: v2.ink, fontWeight: 500, letterSpacing: '-.01em' }}>{children}</span>
    </div>
  );
}
