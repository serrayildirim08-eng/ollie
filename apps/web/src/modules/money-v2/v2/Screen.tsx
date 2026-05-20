/**
 * money-v2 · <Screen> — the warm-paper shell
 *
 * The shared v2 screen primitive. Every v2 leaf and module page across all
 * 12 modules mounts inside one. It is VIEWPORT-AWARE — one component, two
 * modes, picked by `useIsWideViewport()` (the 900px desktop floor):
 *
 * PHONE MODE (narrow — the iPhone Capacitor shell):
 *   - warm-paper background, full `100dvh` viewport, flex column
 *   - iPhone safe-area insets (env(safe-area-inset-*))
 *   - the swipe-handle affordance at the top
 *   - the Find dot (top-left) and Safe dot (top-right) — always-on chrome
 *   - 26px phone gutters
 *   - a `who` strip: either a centred label (money face) or a left-aligned
 *     glyph-tile + label (a leaf page)
 *
 * DESKTOP MODE (wide — the Electron shell, inside `DesktopShell`'s canvas):
 *   - no phone chrome: no swipe handle, no corner Find/Safe dots (the
 *     DesktopShell spine already owns Find + Safe), no safe-area insets.
 *   - sizes to content / fills its container — the canvas owns height, so
 *     no `100dvh`.
 *   - content held to a comfortable centred editorial measure
 *     (`clamp(620px, 50vw, 880px)`) with generous warm margins, never an
 *     edge-to-edge or 26px-gutter phone column.
 *   - the `who` strip stays, desktop-styled: a quiet left-aligned label
 *     at the top of the content.
 *
 * `onFind` / `onSafe` stay in the props in both modes — they are simply
 * not rendered in desktop mode.
 *
 * The warm `v2` palette, sharp 0-radius edges and system fonts are
 * identical in both modes — only the chrome + measure change.
 *
 * `boxSizing: border-box` is set on the root and every child via the
 * shared `box` helper — the app has a recurring overflow bug from
 * `width:100%` + padding without border-box; v2 must never reproduce it.
 */
import type { CSSProperties, ReactNode } from 'react';
import { v2 } from './tokens';
import { IconSearch, IconShield } from './icons';
import { useIsWideViewport } from '../../../lib/useIsWideViewport';

/** the desktop editorial measure — a comfortable reading column */
const DESKTOP_MEASURE = 'clamp(620px, 50vw, 880px)';

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

export function Screen(props: ScreenProps) {
  const wide = useIsWideViewport();
  return wide ? <DesktopScreen {...props} /> : <PhoneScreen {...props} />;
}

// ─── desktop mode — a real desktop page, no phone chrome ──────────────────────

/**
 * The wide-viewport `<Screen>`. Mounts inside `DesktopShell`'s centered
 * canvas, so it drops ALL phone chrome — swipe handle, corner Find/Safe
 * dots, safe-area insets, `100dvh` — and holds its content to a calm
 * editorial measure with generous warm margins. The DesktopShell spine
 * already owns Find + Safe, so `onFind` / `onSafe` are accepted but not
 * rendered here.
 */
function DesktopScreen({
  label,
  glyph,
  whoTrailing,
  centered = false,
  scroll = false,
  children,
  contentStyle,
}: ScreenProps) {
  return (
    <div
      data-testid="v2-screen-desktop"
      style={{
        ...box,
        position: 'relative',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        display: 'flex',
        flexDirection: 'column',
        // the canvas owns height; size to content / fill the container
        minHeight: '100%',
      }}
    >
      {/* the editorial column — centered, warm margins, not a phone gutter */}
      <div
        style={{
          ...box,
          width: '100%',
          maxWidth: DESKTOP_MEASURE,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: 'clamp(40px, 4vw, 72px) clamp(28px, 3vw, 56px)',
        }}
      >
        {/* who strip — a quiet left-aligned label at the top of the page */}
        <div
          style={{
            ...box,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 10,
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

        {/* body — generous desktop vertical rhythm */}
        <div
          style={{
            ...box,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: centered ? 'center' : 'flex-start',
            alignItems: 'stretch',
            overflowY: scroll ? 'auto' : 'visible',
            marginTop: 'clamp(28px, 2.6vw, 44px)',
            ...contentStyle,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── phone mode — byte-for-byte the original iPhone layout ────────────────────

/**
 * The narrow-viewport `<Screen>` — the original iPhone layout, unchanged:
 * `100dvh`, safe-area insets, the swipe handle, the corner Find/Safe dots,
 * 26px phone gutters.
 */
function PhoneScreen({
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
