/**
 * cycle-v2 · NotificationsScreen — the lock-screen reel (cycle-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the cycle
 * module's notification copy gallery: it shows how each ambient detector
 * speaks. The copy is lowercase, dry, no exclamation — the calm v2 voice.
 *
 * The reel closes on a non-notification "endframe" — the screen-only
 * promise: the clinical flags (long cycles, prolonged bleeds, syndrome
 * patterns) are NEVER pushed; they live quietly in "worth a look".
 *
 * This is a presentation surface (a gallery of what notifications look
 * like), not a live feed; the real notification engine is the ambient
 * orchestrator. Data here is the canonical example set from the spec.
 * Mirrors money-v2/screens/NotificationsScreen.tsx in code style.
 */
import { IconClock, IconPill, IconEye, IconCalendar, v2 } from '../../money-v2/v2';
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

/** a crescent moon — luteal-phase glyph (no shared v2 icon for it) */
function IconMoon() {
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
      <path d="M12 3a9 9 0 1 0 9 9c0-.5 0-1-.1-1.4A6 6 0 0 1 12 3z" />
    </svg>
  );
}

const FRAMES: Frame[] = [
  {
    day: 'tuesday, may 26',
    time: '9:41',
    icon: <IconClock size={14} weight={2} stroke={v2.paper} />,
    when: 'now',
    title: 'period likely in ~2 days',
    body: "a heads-up, so it isn't a surprise.",
  },
  {
    day: 'tuesday, may 26',
    time: '9:00',
    icon: <IconPill size={14} weight={1.9} stroke={v2.paper} />,
    when: 'now',
    title: 'pill · 9:00pm',
    body: 'one tap to log it.',
  },
  {
    day: 'wednesday, may 27',
    time: '8:15',
    icon: <IconClock size={14} weight={2} stroke={v2.paper} />,
    when: 'yesterday',
    title: "yesterday's pill — not logged",
    body: 'you can still back-date it.',
  },
  {
    day: 'monday, june 8',
    time: '10:30',
    icon: <IconEye size={14} weight={2} stroke={v2.paper} />,
    when: 'mon',
    title: 'fertile window starts tomorrow',
    body: 'noted because you asked ollie to track it.',
  },
  {
    day: 'friday, june 12',
    time: '7:00',
    icon: <IconMoon />,
    when: 'fri',
    title: 'heading into luteal — be a little gentler this week',
    body: "your energy may run lower. that's the phase, not you.",
  },
  {
    day: 'sunday, june 28',
    time: '11:20',
    icon: <IconCalendar size={14} weight={1.9} stroke={v2.paper} />,
    when: 'sun',
    title: "it's been 38 days — did a period go unlogged?",
    body: 'tap if so, and ollie will fix the count. or ignore it.',
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

      {/* closing note — the screen-only promise. a calm full-paper frame,
          not a notification: the clinical flags are NEVER pushed. */}
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
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            stroke={v2.sage}
            aria-hidden
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
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
          <b style={{ fontWeight: 500 }}>six pushes &mdash; that&rsquo;s all.</b>
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
          the clinical flags ollie finds &mdash; long cycles, prolonged bleeds,
          syndrome patterns &mdash; are <b>never</b> sent as a notification.
          health news shouldn&rsquo;t arrive on a lock screen. they live quietly
          in <b>worth a look</b>, for when you choose to open it.
        </div>
      </div>
    </div>
  );
}
