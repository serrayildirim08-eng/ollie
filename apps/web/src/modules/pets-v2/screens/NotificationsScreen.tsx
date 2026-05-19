/**
 * pets-v2 · NotificationsScreen — the lock-screen reel (pets-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the pets
 * module's notification copy gallery: it shows how each pets push speaks —
 * a staged care cue, a vet cue, a weather alert, a warm adoptversary, and
 * an opt-in weekly note. The copy is lowercase, dry, no exclamation, never
 * guilt. The reel closes on a non-notification endframe: the screen-only
 * promise that health flags + behavioural patterns are never pushed, and a
 * missed care task is never sent as a notification.
 *
 * The lead `care` frame is built from real data — the live face hero's
 * deadpan `generateGuiltTripCopy` text via `notificationsReelVM`. The rest
 * are the canonical voice gallery. PRESENTATION SURFACE — reported as a
 * presentation stub, like admin-v2 / habits-v2.
 */
import { useMemo } from 'react';
import {
  v2,
  IconHay,
  IconShield,
  IconSun,
  IconHeart,
  IconList,
} from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { notificationsReelVM } from '../selectors';
import type { NotificationFrameVM } from '../selectors';

export interface NotificationsScreenProps {
  now: number;
  onBack: () => void;
}

const GRADIENT =
  'linear-gradient(168deg,#EFE7D7 0%,#E6DBC6 56%,#DBCDB1 100%)';

/** the glyph for a notification frame */
function FrameGlyph({ kind }: { kind: NotificationFrameVM['kind'] }) {
  const props = { size: 14, stroke: v2.paper, weight: 2 } as const;
  switch (kind) {
    case 'care':
      return <IconHay {...props} />;
    case 'vet':
      return <IconShield {...props} />;
    case 'weather':
      return <IconSun {...props} />;
    case 'adoptversary':
      return <IconHeart {...props} />;
    case 'weekly':
      return <IconList {...props} weight={1.9} />;
    default:
      return <IconHay {...props} />;
  }
}

export function NotificationsScreen({ now, onBack }: NotificationsScreenProps) {
  const slices = usePetsSlices();
  const frames = useMemo(() => notificationsReelVM(slices, now), [slices, now]);
  // total scroll-snap frames = data frames + the closing endframe
  const total = frames.length + 1;

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
      {frames.map((f, i) => (
        <div
          key={`${f.kind}-${i}`}
          style={{
            height: '100dvh',
            scrollSnapAlign: 'start',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            background: GRADIENT,
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
              WebkitTapHighlightColor: 'transparent',
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
              {f.day}
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
              {f.time}
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
                  <FrameGlyph kind={f.kind} />
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
                  {f.when}
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
                {f.title}
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
                {f.body}
              </div>
            </div>
          </div>

          {/* the barely-there scroll hint — every frame but the last */}
          {i < total - 1 && (
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

      {/* the closing frame — a calm note, not a notification */}
      <div
        style={{
          height: '100dvh',
          scrollSnapAlign: 'start',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          background: GRADIENT,
          boxSizing: 'border-box',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
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
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span>9:41</span>
          <span aria-hidden>&#9679;&#9679;&#9679;</span>
        </button>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 42px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1.5px solid #B7A98C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <svg
              width={19}
              height={19}
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={1.8}
              stroke="#6A604F"
            >
              <circle cx="12" cy="12" r="9" />
              <path
                d="M12 11v5M12 8h.01"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              color: '#3A342C',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
              marginBottom: 10,
            }}
          >
            the health flags and the behavioural patterns are deliberately
            screen-only.
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#6A6056',
              fontWeight: 400,
              lineHeight: 1.55,
            }}
          >
            a welfare note or a &ldquo;noticed&rdquo; pattern never lands on your
            lock screen as a verdict. they wait quietly in <i>health</i> and{' '}
            <i>see the rest</i> &mdash; there for when you have a moment, never
            pushed at you. a missed care task is never sent as a notification.
          </p>
        </div>
      </div>
    </div>
  );
}
