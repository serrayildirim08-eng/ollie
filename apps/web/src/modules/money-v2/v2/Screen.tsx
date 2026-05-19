/**
 * money-v2 · <Screen> — the warm-paper shell
 *
 * The shared v2 screen primitive. Every v2 leaf and module page mounts
 * inside one. It provides, verbatim from the mockups:
 *   - warm-paper background, full viewport, flex column
 *   - iPhone safe-area insets (env(safe-area-inset-*))
 *   - the swipe-handle affordance at the top
 *   - the Find dot (top-left) and Safe dot (top-right) — always-on chrome
 *   - a `who` strip: either a centred label (money face) or a left-aligned
 *     glyph-tile + label (a leaf page)
 *
 * `boxSizing: border-box` is set on the root and every child via the
 * shared `box` helper — the app has a recurring overflow bug from
 * `width:100%` + padding without border-box; v2 must never reproduce it.
 *
 * body / home / work will reuse this shell unchanged.
 */
import type { CSSProperties, ReactNode } from 'react';
import { v2 } from './tokens';
import { IconSearch, IconShield } from './icons';

export interface ScreenProps {
  /** the small lowercase module/area label in the `who` strip */
  label: string;
  /**
   * a glyph for the `who` strip. When provided the strip is left-aligned
   * with a glyph-tile (a leaf page). When omitted the label is centred
   * (the money face). Optionally followed by `whoTrailing` (the eye).
   */
  glyph?: ReactNode;
  /** an extra control after the centred label — used for the privacy eye */
  whoTrailing?: ReactNode;
  /** opens Find (top-left dot) */
  onFind?: () => void;
  /** opens Safe / crisis (top-right dot) */
  onSafe?: () => void;
  /**
   * when provided, the top swipe handle becomes a real dismiss button
   * (the v2 back gesture is a swipe-down on the handle; this makes it
   * tappable too, for preview-on-device + tests). Optional — money's
   * leaf screens leave it unset and the handle stays decorative.
   */
  onBack?: () => void;
  /** when true the body area is `justify-content:center` (a leaf focus) */
  centered?: boolean;
  /** scrollable body (the money face). default: a fixed centred stage. */
  scroll?: boolean;
  children: ReactNode;
  /** extra style on the inner content wrapper */
  contentStyle?: CSSProperties;
}

const box: CSSProperties = { boxSizing: 'border-box' };

const dotStyle: CSSProperties = {
  ...box,
  position: 'absolute',
  top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
  width: 34,
  height: 34,
  borderRadius: '50%',
  border: `1.5px solid ${v2.line}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

export function Screen({
  label,
  glyph,
  whoTrailing,
  onFind,
  onSafe,
  onBack,
  centered = false,
  scroll = false,
  children,
  contentStyle,
}: ScreenProps) {
  const leftAligned = Boolean(glyph);

  return (
    <div
      style={{
        ...box,
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* swipe handle — a real dismiss button when `onBack` is given */}
      {onBack ? (
        <button
          type="button"
          aria-label="back"
          onClick={onBack}
          style={{
            ...box,
            height: 28,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: 10,
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
        </button>
      ) : (
        <div
          style={{
            ...box,
            height: 18,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: 10,
            flexShrink: 0,
          }}
          aria-hidden
        >
          <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
        </div>
      )}

      {/* Find dot — top-left */}
      <button
        type="button"
        aria-label="find"
        onClick={onFind}
        style={{ ...dotStyle, left: 'calc(env(safe-area-inset-left, 0px) + 24px)' }}
      >
        <IconSearch stroke={v2.mute} />
      </button>

      {/* Safe dot — top-right */}
      <button
        type="button"
        aria-label="safe"
        onClick={onSafe}
        style={{ ...dotStyle, right: 'calc(env(safe-area-inset-right, 0px) + 24px)' }}
      >
        <IconShield stroke={v2.mute} />
      </button>

      {/* who strip */}
      <div
        style={{
          ...box,
          marginTop: 26,
          padding: '0 26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: leftAligned ? 'flex-start' : 'center',
          gap: leftAligned ? 10 : 9,
          flexShrink: 0,
        }}
      >
        {glyph && (
          <span
            style={{
              ...box,
              width: 34,
              height: 34,
              borderRadius: 11,
              background: v2.tile,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {glyph}
          </span>
        )}
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: v2.mute,
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </span>
        {whoTrailing}
      </div>

      {/* body */}
      <div
        style={{
          ...box,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: centered ? 'center' : 'flex-start',
          alignItems: 'stretch',
          overflowY: scroll ? 'auto' : 'visible',
          padding: '0 26px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 36px)',
          ...contentStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
