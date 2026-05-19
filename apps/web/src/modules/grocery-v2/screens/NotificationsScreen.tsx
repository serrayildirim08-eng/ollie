/**
 * grocery-v2 · NotificationsScreen — the lock-screen reel
 * (grocery-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is grocery's
 * notification copy gallery: how each ambient grocery detector speaks —
 * expiration drift, the stockout cascade, a stale list, shopping cadence,
 * and an opt-in weekly note. The copy is lowercase, dry, no exclamation.
 *
 * The reel closes on a non-notification endframe — the screen-only
 * promise: the reflective patterns (the 3-keyboards interest capture, the
 * shopping cadence, the learned stores) are NEVER pushed; they wait in
 * "see the rest". A duplicate-buy surfaces in-app, never as a push.
 *
 * This is a PRESENTATION SURFACE (a gallery of what the pushes look like),
 * not a live feed — the real notification engine is the ambient grocery
 * orchestrator. The five frames come from the `notificationsVM` selector
 * (a curated reel; reported as a presentation stub). The frame dates are
 * derived off the injected `now` so the reel reads as live.
 */
import { useMemo } from 'react';
import {
  v2,
  IconBasket,
  IconRefresh,
  IconList,
  IconJar,
} from '../../money-v2/v2';
import { notificationsVM, type NotificationGlyph } from '../selectors';

export interface NotificationsScreenProps {
  now: number;
  onBack: () => void;
}

const ICON_STROKE = v2.paper;

/** the glyph for a notification card */
function CardGlyph({ glyph }: { glyph: NotificationGlyph }) {
  const props = { size: 14, stroke: ICON_STROKE } as const;
  switch (glyph) {
    case 'expiration':
      return <IconJar {...props} weight={1.9} />;
    case 'cascade':
      return <IconRefresh {...props} weight={1.9} />;
    case 'stale':
      return <IconList {...props} weight={2} />;
    case 'cadence':
      return <IconBasket {...props} weight={1.9} />;
    case 'weekly':
      return <IconList {...props} weight={1.9} />;
    default:
      return <IconBasket {...props} weight={1.9} />;
  }
}

export function NotificationsScreen({ now, onBack }: NotificationsScreenProps) {
  const vm = useMemo(() => notificationsVM(now), [now]);
  const cards = vm.cards;

  return (
    <div
      style={{
        height: '100dvh',
        width: '100%',
        position: 'relative',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollSnapType: 'y mandatory',
        WebkitOverflowScrolling: 'touch',
        boxSizing: 'border-box',
      }}
    >
      {cards.map((c, i) => (
        <div
          key={c.title}
          style={{
            height: '100dvh',
            scrollSnapAlign: 'start',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            background:
              'linear-gradient(168deg,#EFE7D7 0%,#E6DBC6 56%,#DBCDB1 100%)',
            boxSizing: 'border-box',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          {/* a quiet exit — tap the status row */}
          <button
            type="button"
            aria-label="close notifications"
            onClick={onBack}
            style={{
              height: 54,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              padding: '0 26px 6px',
              fontSize: 13,
              fontWeight: 600,
              color: '#3A342C',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            <span>9:41</span>
            <span aria-hidden>&#9679;&#9679;&#9679;</span>
          </button>

          {/* the lock-screen clock */}
          <div style={{ textAlign: 'center', marginTop: 30, flexShrink: 0 }}>
            <div
              style={{
                fontSize: 15,
                color: '#5A5044',
                fontWeight: 500,
                letterSpacing: '0.01em',
              }}
            >
              {c.day}
            </div>
            <div
              style={{
                fontSize: 80,
                color: '#3A342C',
                fontWeight: 200,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                marginTop: 4,
              }}
            >
              {c.time}
            </div>
          </div>

          {/* the one notification — floated low */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 20px',
            }}
          >
            <div
              style={{
                width: '100%',
                background: 'rgba(250,246,239,.9)',
                borderRadius: 24,
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                padding: '18px 19px',
                boxShadow: '0 10px 30px rgba(42,38,34,.13)',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  marginBottom: 9,
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    background: v2.ink,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CardGlyph glyph={c.glyph} />
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: v2.mute,
                    letterSpacing: '0.04em',
                  }}
                >
                  ollie
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: v2.mute,
                    fontWeight: 500,
                  }}
                >
                  {c.when}
                </span>
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: v2.ink,
                  letterSpacing: '-0.012em',
                  lineHeight: 1.34,
                }}
              >
                {c.title}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: '#6A6056',
                  fontWeight: 400,
                  lineHeight: 1.42,
                  marginTop: 4,
                }}
              >
                {c.body}
              </div>
            </div>
          </div>

          {/* a barely-there scroll hint — every frame but the last */}
          {i < cards.length - 1 && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 34px)',
                display: 'flex',
                justifyContent: 'center',
                opacity: 0.5,
              }}
              aria-hidden
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={1.8}
                stroke="#6A604F"
              >
                <path
                  d="M6 9l6 6 6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </div>
      ))}

      {/* the closing endframe — the screen-only promise */}
      <div
        style={{
          height: '100dvh',
          scrollSnapAlign: 'start',
          background: v2.paper,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 44px',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: `1.5px solid rgba(91,140,126,.5)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={1.7}
            stroke={v2.sage}
          >
            <circle cx="12" cy="12" r="9" />
            <path
              d="M12 11v5M12 8h.01"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div
          style={{
            fontSize: 18,
            color: '#3A342C',
            fontWeight: 500,
            letterSpacing: '-0.015em',
            lineHeight: 1.4,
          }}
        >
          the reflective patterns stay inside the app
        </div>
        <div
          style={{
            marginTop: 11,
            fontSize: 13,
            color: '#6A6056',
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          the 3-keyboards kind of observation &mdash; interest-capture, shopping
          cadence, the stores ollie&rsquo;s learned &mdash; never lands on a
          lock screen. it waits on{' '}
          <i style={{ fontStyle: 'italic' }}>see the rest</i> for when
          you&rsquo;re curious.
          <br />
          <br />a duplicate buy doesn&rsquo;t push either &mdash; it surfaces
          quietly in-app the moment you check the item off, never as a
          notification.
        </div>
        <button
          type="button"
          onClick={onBack}
          style={{
            marginTop: 26,
            background: 'transparent',
            border: 'none',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.02em',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          back to grocery
        </button>
      </div>
    </div>
  );
}
