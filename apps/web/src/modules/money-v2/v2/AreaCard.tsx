/**
 * money-v2 · <AreaCard> — the expandable info-card
 *
 * The core of the clean-slate v2 revision (DIRECTION.md "The expandable
 * info-card"). A submodule / area row with three states:
 *
 *   1. collapsed  — key · one glanceable line of real data + chevron
 *   2. expanded   — opens in place: 2–4 quiet key/value lines + an
 *                   `open … →` cue. No navigation. One card open at a time
 *                   is the caller's job (it owns `open`).
 *   3. detail     — the `open …` cue (or a second tap) calls `onOpen`.
 *
 * Privacy: when `masked`, the value line renders a calm monospace block.
 *
 * This is shared — body / home / work module pages are lists of these.
 */
import type { ReactNode } from 'react';
import { v2 } from './tokens';
import { IconChevronDown } from './icons';

export interface AreaDetailLine {
  k: string;
  v: ReactNode;
}

export interface AreaCardProps {
  /** the submodule key, e.g. "bills" */
  areaKey: string;
  /** the glanceable value line. `ReactNode` so it can carry <b> emphasis */
  value: ReactNode;
  /** whether this card is currently expanded (caller-controlled) */
  open: boolean;
  /** toggle expand */
  onToggle: () => void;
  /** 2–4 quiet lines shown when expanded */
  detail?: AreaDetailLine[];
  /** the `open <areaKey> →` cue label; defaults to `open <areaKey>` */
  openLabel?: string;
  /** push the level-3 detail page */
  onOpen?: () => void;
  /** privacy mask the value line */
  masked?: boolean;
  /** first card draws a top border too (caller sets on index 0) */
  first?: boolean;
}

export function AreaCard({
  areaKey,
  value,
  open,
  onToggle,
  detail,
  openLabel,
  onOpen,
  masked = false,
  first = false,
}: AreaCardProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        borderTop: first ? `1px solid ${v2.line}` : undefined,
        borderBottom: `1px solid ${v2.line}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '19px 2px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 0,
          cursor: 'pointer',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.01em',
            flexShrink: 0,
          }}
        >
          {areaKey}
        </span>
        <span style={{ color: v2.line, margin: '0 8px', fontSize: 13 }}>·</span>
        <span
          style={{
            fontSize: 14,
            color: masked ? 'transparent' : v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            flex: 1,
            ...(masked
              ? {
                  fontFamily: v2.mono,
                  background: v2.line,
                  borderRadius: 6,
                  height: 19,
                  userSelect: 'none',
                }
              : {}),
          }}
        >
          {masked ? ' ' : value}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignSelf: 'center',
            marginLeft: 8,
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 180ms ease-out',
          }}
          aria-hidden
        >
          <IconChevronDown stroke={v2.mute} />
        </span>
      </button>

      {open && (
        <div style={{ boxSizing: 'border-box', padding: '0 2px 22px' }}>
          {detail && detail.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {detail.map((d) => (
                <div
                  key={d.k}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: v2.mute, fontWeight: 500 }}>{d.k}</span>
                  <span style={{ color: v2.ink, fontWeight: 600 }}>{d.v}</span>
                </div>
              ))}
            </div>
          )}
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              style={{
                marginTop: 14,
                background: 'transparent',
                border: 'none',
                padding: 0,
                fontSize: 12,
                color: v2.accent,
                fontWeight: 600,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {openLabel ?? `open ${areaKey}`} &rsaquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
