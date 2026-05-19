/**
 * money-v2 · <AmberButton> + <GhostButton>
 *
 * The two calm action primitives shared across v2.
 *
 *   AmberButton — the single warm action per screen. Amber fill, white
 *   ink, soft amber glow. There is at most one per screen (the v2 rule:
 *   one focus, one action).
 *
 *   GhostButton — a quiet equal-weight alternative (keep / export / spend
 *   it now). White or paper fill, hairline border, ink text.
 *
 * Both are real <button>s — keyboard-focusable, 44px+ tall hit targets.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { v2 } from './tokens';

interface CommonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** an optional leading icon */
  icon?: ReactNode;
  /** full-width pill (default) or auto-width (a centred chip) */
  block?: boolean;
}

export function AmberButton({ children, icon, block = false, style, ...rest }: CommonProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        boxSizing: 'border-box',
        height: 52,
        borderRadius: 26,
        background: v2.accent,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 26px',
        boxShadow: v2.amberShadow,
        cursor: 'pointer',
        width: block ? '100%' : 'auto',
        margin: block ? undefined : '0 auto',
        color: '#fff',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function GhostButton({ children, icon, block = true, style, ...rest }: CommonProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        boxSizing: 'border-box',
        height: 52,
        borderRadius: 26,
        background: v2.paper,
        border: `1px solid ${v2.line}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 22px',
        cursor: 'pointer',
        width: block ? '100%' : 'auto',
        margin: block ? undefined : '0 auto',
        color: v2.ink,
        fontSize: 16,
        fontWeight: 600,
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
