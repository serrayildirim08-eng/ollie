/**
 * sleep-v2 · NotificationsScreen — the lock-screen reel (sleep-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the sleep
 * module's notification copy gallery: it shows how each ambient detector
 * speaks. The copy is lowercase, dry, no exclamation — the calm v2 voice.
 *
 * The reel closes on a non-notification "endframe" — the screen-only
 * promise: the analysis (chronotype, the DSPS pattern, the survey scores)
 * is NEVER pushed; sleep news should never wake you up.
 *
 * This is a presentation surface (a gallery of what notifications look
 * like), not a live feed — the real notification engine is the ambient
 * orchestrator. Data here is the canonical example set from the spec.
 * Mirrors cycle-v2/screens/NotificationsScreen.tsx in code style.
 */
import { IconMoon, IconCheck, IconClock, v2 } from '../../money-v2/v2';
import type { ReactNode } from 'react';

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

/** a coffee cup — caffeine-cutoff glyph (no shared v2 icon for it) */
function IconCoffee() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      stroke={v2.paper}
      aria-hidden
    >
      <path d="M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M16 9h2a2 2 0 0 1 0 4h-2" />
      <path d="M8 3v2M11 3v2" />
    </svg>
  );
}

/** three lines — the weekly-recap glyph */
function IconLines() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      stroke={v2.paper}
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

const FRAMES: Frame[] = [
  {
    day: 'tuesday, may 19',
    time: '22:30',
    icon: <IconMoon size={14} weight={1.9} stroke={v2.paper} />,
    when: 'now',
    title: 'wind-down — 6 small steps',
    body: 'a calm way into the night, if you want it.',
  },
  {
    day: 'wednesday, may 20',
    time: '8:15',
    icon: <IconCheck size={14} weight={2} stroke={v2.paper} />,
    when: 'now',
    title: 'last night — log it?',
    body: 'one tap, four words. solid, ok, rough, bad.',
  },
  {
    day: 'friday, may 22',
    time: '9:05',
    icon: <IconMoon size={14} weight={1.9} stroke={v2.paper} />,
    when: '8m ago',
    title: '3 short nights — be gentle today',
    body: 'scaling expectations, not standards.',
  },
  {
    day: 'monday, may 25',
    time: '16:00',
    icon: <IconCoffee />,
    when: 'now',
    title: 'coffee at 4pm — that usually costs ~40min tonight',
    body: "just so you've seen it. your call.",
  },
  {
    day: 'sunday, may 31',
    time: '19:00',
    icon: <IconLines />,
    when: 'sun 7pm',
    title: 'your week in sleep',
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
      {/* one notification per full-height lock-screen frame */}
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
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      ))}

      {/* closing note — the screen-only promise. a calm full-paper frame,
          not a notification: the analysis is NEVER pushed. */}
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
            border: `1.5px solid ${v2.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <IconClock size={20} weight={1.7} stroke={v2.sage} />
        </div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.4,
          }}
        >
          <b style={{ fontWeight: 500 }}>five pushes &mdash; that&rsquo;s the whole of it.</b>
          <br />
          the rest waits for you in the app.
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          the analysis stays where you can find it, never on your lock screen
          &mdash; chronotype, the DSPS pattern, the survey scores. they live
          quietly in <b>see the rest</b> and <b>go deeper</b>. sleep news should
          never wake you up.
        </div>
      </div>
    </div>
  );
}
