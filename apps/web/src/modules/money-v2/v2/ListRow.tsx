/**
 * money-v2 · <ListRow> + <Stage>
 *
 * ListRow — the calm hairline-divided ledger row. A torn page from a
 * notebook: name on the left, amount, an optional dated tail. No cards,
 * no chips. Used by bills, adhd-tax, income facts.
 *
 * Stage — a centred one-focus column for a leaf page (a lead line, then
 * the focus object). The non-scrolling counterpart to Screen's centred
 * body; it just standardises the inner max-width + lead spacing.
 *
 * Both are shared v2 primitives.
 */
import type { ReactNode } from 'react';
import { v2 } from './tokens';

export interface ListRowProps {
  /** left text */
  name: ReactNode;
  /** the amount, rendered in ink (or muted via `muted`) */
  amount?: ReactNode;
  /** a short dated tail, right-aligned, muted (e.g. "fri", "may 24") */
  when?: ReactNode;
  /** the soonest/active row tints `when` amber */
  soon?: boolean;
  /** flatten the whole row to a single muted grey (adhd-tax grammar) */
  muted?: boolean;
  /** draw a top border (caller sets on first row) */
  first?: boolean;
  /** larger type — the bills page uses 20px rows */
  large?: boolean;
}

export function ListRow({
  name,
  amount,
  when,
  soon = false,
  muted = false,
  first = false,
  large = false,
}: ListRowProps) {
  const ink = muted ? '#7A726A' : v2.ink;
  const size = large ? 20 : 15;
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        padding: large ? '17px 2px' : '15px 2px',
        borderTop: first ? `1px solid ${v2.line}` : undefined,
        borderBottom: `1px solid ${v2.line}`,
      }}
    >
      <span
        style={{
          fontSize: size,
          color: ink,
          fontWeight: 400,
          letterSpacing: '-0.012em',
          flex: 1,
        }}
      >
        {name}
      </span>
      {amount != null && (
        <span
          style={{
            fontSize: size,
            color: ink,
            fontWeight: muted ? 600 : 500,
            letterSpacing: '-0.02em',
          }}
        >
          {amount}
        </span>
      )}
      {when != null && (
        <span
          style={{
            fontSize: 13,
            color: soon ? v2.accent : v2.mute,
            fontWeight: soon ? 600 : 500,
            width: 56,
            textAlign: 'right',
          }}
        >
          {when}
        </span>
      )}
    </div>
  );
}

export interface StageProps {
  /** the small muted lead line above the focus */
  lead?: ReactNode;
  children: ReactNode;
  /** narrower inner column */
  maxWidth?: number;
}

export function Stage({ lead, children, maxWidth = 320 }: StageProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth,
        margin: '0 auto',
      }}
    >
      {lead != null && (
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
            marginBottom: 28,
            textAlign: 'center',
          }}
        >
          {lead}
        </div>
      )}
      {children}
    </div>
  );
}
