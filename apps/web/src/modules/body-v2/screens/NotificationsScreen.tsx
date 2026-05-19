/**
 * body-v2 · NotificationsScreen — the lock-screen reel (body-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the body
 * module's notification copy gallery: it shows how each ambient body
 * detector speaks. The copy is lowercase, dry, no exclamation.
 *
 * The reel closes on a non-notification "endframe" — the screen-only
 * promise: the episode patterns, the cross-module correlations and the
 * doctor summary are NEVER pushed; health findings should never land on a
 * lock screen.
 *
 * This is a presentation surface (a gallery of what notifications look
 * like), not a live feed — the real notification engine is the ambient
 * body orchestrator. Data here is the canonical example set from the spec.
 * Mirrors sleep-v2/screens/NotificationsScreen.tsx in code style.
 */
import type { ReactNode } from 'react';
import { v2 } from '../../money-v2/v2';

export interface NotificationsScreenProps {
  onBack: () => void;
}

interface Frame {
  day: string;
  time: string;
  icon: ReactNode;
  when: string;
  title: string;
  body: string;
}

const ICON_STROKE = v2.paper;

/** a water drop — the hydration glyph */
function IconDrop() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
    </svg>
  );
}
/** a capsule — the supplement glyph */
function IconCapsule() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(45 12 12)" />
    </svg>
  );
}
/** a standing figure — the posture glyph */
function IconPosture() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 8v8M12 11l-5 3M12 11l5 3M9 21l3-5 3 5" />
    </svg>
  );
}
/** a calendar — the treatment glyph */
function IconCalendar() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="6" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 11h16" />
    </svg>
  );
}
/** a heart — the be-gentle glyph */
function IconHeart() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  );
}
/** three lines — the weekly-recap glyph */
function IconLines() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

const FRAMES: Frame[] = [
  {
    day: 'monday, may 12',
    time: '3:20',
    icon: <IconDrop />,
    when: 'now',
    title: "water — you're a few glasses behind today",
    body: 'three hours into a focus block. no rush — just a heads-up.',
  },
  {
    day: 'tuesday, may 13',
    time: '9:00',
    icon: <IconCapsule />,
    when: 'now',
    title: 'supplement — vitamin d',
    body: "it's 9am, the time you usually take it.",
  },
  {
    day: 'tuesday, may 13',
    time: '2:00',
    icon: <IconPosture />,
    when: 'now',
    title: 'posture — a small reset',
    body: "shoulders down, screen up. that's the whole thing.",
  },
  {
    day: 'thursday, may 15',
    time: '6:30',
    icon: <IconCalendar />,
    when: '6h ago',
    title: 'treatment — cycle 3 starts tomorrow',
    body: "just so it's not a surprise. it's on your calendar.",
  },
  {
    day: 'friday, may 16',
    time: '8:15',
    icon: <IconHeart />,
    when: 'now',
    title: 'be gentle today — yesterday was a lot',
    body: 'a long focus day, a short night. lower the bar a little.',
  },
  {
    day: 'sunday, may 18',
    time: '6:00',
    icon: <IconLines />,
    when: 'sun 6pm',
    title: 'your week in body — water held, supplements steady',
    body: 'a quiet recap. arrives only if you asked for it.',
  },
];

export function NotificationsScreen({ onBack }: NotificationsScreenProps) {
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
      {FRAMES.map((f, i) => (
        <div
          key={`${f.day}-${f.time}`}
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
          {/* a quiet exit — tap anywhere on the status row */}
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
            }}
          >
            <span>9:41</span>
            <span aria-hidden>&#9679;&#9679;&#9679;</span>
          </button>

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
                  {f.icon}
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

          {/* a barely-there scroll hint — every frame but the last */}
          {i < FRAMES.length - 1 && (
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

      {/* closing note — the screen-only promise */}
      <div
        style={{
          height: '100dvh',
          scrollSnapAlign: 'start',
          background:
            'linear-gradient(168deg,#EFE7D7 0%,#E3D8C2 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 40px',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: '1.5px solid #C7BAA0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 22,
          }}
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={1.7}
            stroke="#6A604F"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 300,
            color: '#3A342C',
            letterSpacing: '-0.02em',
            lineHeight: 1.4,
          }}
        >
          six pushes, and no more.
          <br />
          <b style={{ fontWeight: 600 }}>the rest stays on the page.</b>
        </div>
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 11,
            alignSelf: 'stretch',
          }}
        >
          <ClosingItem>
            the <b>episode patterns</b> &mdash; how long things run, what tends
            to precede them
          </ClosingItem>
          <ClosingItem>
            the <b>cross-module correlations</b> &mdash; body &times; cycle,
            body &times; sleep, body &times; work
          </ClosingItem>
          <ClosingItem>
            the <b>doctor summary</b> &mdash; it&rsquo;s prepared for you, never
            sent at you
          </ClosingItem>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 12,
            color: '#8A7E6C',
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          health findings never land on a lock screen. they wait in the app,
          calm, for whenever you want to read them.
        </div>
      </div>
    </div>
  );
}

function ClosingItem({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: v2.sage,
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <span
        style={{
          fontSize: 13,
          color: '#5A5044',
          fontWeight: 400,
          lineHeight: 1.5,
          textAlign: 'left',
        }}
      >
        {children}
      </span>
    </div>
  );
}
