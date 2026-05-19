/**
 * v2 · <Chip> + <NavRow>
 *
 * Two small shared v2 primitives added for the cycle module (they live in
 * the shared `v2/` dir for body / home reuse).
 *
 * Chip — the calm toggle chip from cycle-log.html / partner-ask.html: a
 * hairline-bordered white pill that fills sage when selected. A real
 * <button> with `aria-pressed`, 44px+ hit target.
 *
 * NavRow — cycle.html's quiet drill row: a key · value line with a small
 * caret, no card. An optional sage dot makes it the calm clinical-flag
 * row (cycle.html `.row.flag`). A real <button>.
 */
import type { ReactNode } from 'react';
import { v2 } from './tokens';
import { IconChevronRight } from './icons';

export interface ChipProps {
  /** chip label */
  children: ReactNode;
  /** selected — fills sage */
  on: boolean;
  /** toggle */
  onToggle: () => void;
}

export function Chip({ children, on, onToggle }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      style={{
        boxSizing: 'border-box',
        border: `1px solid ${on ? v2.sage : v2.line}`,
        background: on ? v2.sage : v2.card,
        borderRadius: 18,
        padding: '9px 15px',
        minHeight: 38,
        fontSize: 14,
        fontWeight: 500,
        color: on ? '#fff' : v2.ink,
        letterSpacing: '-0.01em',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

export interface NavRowProps {
  /** the small muted key on the left */
  rowKey: string;
  /** the tailored value line */
  value: ReactNode;
  /** push the row's screen */
  onOpen: () => void;
  /** first row draws a top border too */
  first?: boolean;
  /** last row draws a bottom border */
  last?: boolean;
  /** the calm clinical-flag variant — a sage dot, sage key */
  flag?: boolean;
  /** dim the row (cold-state rows) */
  dim?: boolean;
}

export function NavRow({
  rowKey,
  value,
  onOpen,
  first = false,
  last = false,
  flag = false,
  dim = false,
}: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: first ? `1px solid ${v2.line}` : `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '18px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {flag && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v2.sage,
            flexShrink: 0,
            marginRight: 11,
          }}
        />
      )}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: flag ? v2.sage : v2.mute,
          flexShrink: 0,
        }}
      >
        {rowKey}
      </span>
      <span style={{ color: v2.line, margin: '0 8px', fontSize: 13 }}>·</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: dim ? 400 : 500,
          letterSpacing: '-0.01em',
          color: dim ? v2.mute : v2.ink,
          flex: 1,
        }}
      >
        {value}
      </span>
      <span style={{ display: 'inline-flex', marginLeft: 8 }} aria-hidden>
        <IconChevronRight stroke={dim ? v2.line : v2.mute} />
      </span>
    </button>
  );
}
