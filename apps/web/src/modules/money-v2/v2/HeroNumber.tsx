/**
 * money-v2 · <HeroNumber> — the one-number focus
 *
 * The big light-weight figure that anchors safe-to-spend, savings, adhd
 * tax and tax-set-aside. One number, the rest is air.
 *
 * It carries the privacy contract: when `masked` it renders a calm
 * monospace block (never a number, never a fake digit), exactly as
 * money-private.html specifies.
 *
 * Optional `horizon` (a 0..1 fill) reuses the soft horizon bar that both
 * safe-to-spend and savings share.
 */
import type { ReactNode } from 'react';
import { v2 } from './tokens';

export interface HeroNumberProps {
  /** the small lead line above the number */
  lead: string;
  /** currency symbol, rendered muted */
  currency?: string;
  /** the value, already formatted (e.g. "312" or "3.2") */
  value: string;
  /** an optional muted unit suffix (e.g. "k") */
  unit?: string;
  /** font size of the number — mockups use 78 (face) / 72 (leaf) / 62 */
  size?: number;
  /** when set, a horizon bar (0..1) is shown under the number */
  horizon?: number;
  /** a muted caption under the horizon / number */
  caption?: ReactNode;
  /** privacy: render a masked block instead of the figure */
  masked?: boolean;
}

export function HeroNumber({
  lead,
  currency = '$',
  value,
  unit,
  size = 72,
  horizon,
  caption,
  masked = false,
}: HeroNumberProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
        {lead}
      </div>

      {masked ? (
        <div
          aria-label="hidden"
          style={{
            marginTop: 10,
            fontFamily: v2.mono,
            background: v2.line,
            color: 'transparent',
            borderRadius: 6,
            letterSpacing: '0.1em',
            height: Math.round(size * 0.82),
            width: Math.round(size * 2.4),
            userSelect: 'none',
          }}
        />
      ) : (
        <div
          style={{
            marginTop: 8,
            fontSize: size,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span style={{ color: v2.mute, fontWeight: 300, fontSize: Math.round(size * 0.6) }}>
            {currency}
          </span>
          {value}
          {unit && (
            <span style={{ color: v2.mute, fontWeight: 300, fontSize: Math.round(size * 0.35), marginLeft: 1 }}>
              {unit}
            </span>
          )}
        </div>
      )}

      {typeof horizon === 'number' && (
        <div
          style={{
            marginTop: 26,
            width: 188,
            height: 4,
            borderRadius: 3,
            background: v2.line,
            position: 'relative',
            overflow: 'hidden',
          }}
          role="progressbar"
          aria-valuenow={Math.round(Math.min(1, Math.max(0, horizon)) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {!masked && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(100, Math.max(0, horizon * 100))}%`,
                borderRadius: 3,
                background: v2.accent,
              }}
            />
          )}
        </div>
      )}

      {caption != null && (
        <div
          style={{
            marginTop: 13,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
          }}
        >
          {masked ? (
            <span
              style={{
                display: 'inline-block',
                fontFamily: v2.mono,
                background: v2.line,
                color: 'transparent',
                borderRadius: 6,
                height: 19,
                width: 120,
                userSelect: 'none',
              }}
            />
          ) : (
            caption
          )}
        </div>
      )}
    </div>
  );
}
