/**
 * v2-shell · <HomepageShell> — the chrome for a Level-2 module homepage
 *
 * body.html / home.html / work.html share one frame: a warm-paper page
 * with a swipe-down handle, the Find dot (top-left) + Safe dot (top-right),
 * a centred lowercase `who` label, and a scrollable card column below it.
 *
 * The handle is a real back button (tap = pop) AND the page is wrapped by
 * `PushSurface` one level up for the edge-swipe — DIRECTION.md's two back
 * gestures. iPhone-correct: safe-area insets, `boxSizing:border-box`,
 * `overflowX:hidden`.
 *
 * Module homepages reuse this; submodule `*-v2` apps own their own
 * `Screen` chrome and are NOT wrapped by it.
 */
import type { ReactNode } from 'react';
import { v2, IconSearch, IconShield } from '../../money-v2/v2';

const box = { boxSizing: 'border-box' as const };

const dot = {
  ...box,
  position: 'absolute' as const,
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
  zIndex: 5,
  WebkitTapHighlightColor: 'transparent',
};

export interface HomepageShellProps {
  /** the lowercase module label in the `who` strip ("body", "home", "work") */
  label: string;
  /** pop the stack — the handle tap (the edge-swipe is handled by PushSurface) */
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
  children: ReactNode;
}

export function HomepageShell({ label, onBack, onFind, onSafe, children }: HomepageShellProps) {
  return (
    <div
      style={{
        ...box,
        position: 'relative',
        minHeight: '100%',
        height: '100%',
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
      {/* swipe-down handle — a real back button */}
      <button
        type="button"
        aria-label="back"
        onClick={onBack}
        style={{
          ...box,
          height: 30,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: 12,
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
      </button>

      {/* Find dot — top-left */}
      <button
        type="button"
        aria-label="find"
        onClick={onFind}
        style={{ ...dot, left: 'calc(env(safe-area-inset-left, 0px) + 24px)' }}
      >
        <IconSearch stroke={v2.mute} />
      </button>

      {/* Safe dot — top-right */}
      <button
        type="button"
        aria-label="safe"
        onClick={onSafe}
        style={{ ...dot, right: 'calc(env(safe-area-inset-right, 0px) + 24px)' }}
      >
        <IconShield stroke={v2.mute} />
      </button>

      {/* who strip — the centred module label */}
      <div
        style={{
          ...box,
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: v2.mute, letterSpacing: '.04em' }}>
          {label}
        </span>
      </div>

      {/* scrollable card column */}
      <div
        style={{
          ...box,
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '0 26px',
          paddingTop: 26,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 36px)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
