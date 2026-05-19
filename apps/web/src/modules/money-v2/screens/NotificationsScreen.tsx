/**
 * money-v2 · NotificationsScreen — the lock-screen reel (money-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame. It is the money module's notification copy
 * gallery: it shows how each ambient detector speaks. The copy is
 * lowercase, dry, no exclamation — the calm v2 voice.
 *
 * This is a presentation surface (a gallery of what notifications look
 * like), not a live feed; the real notification engine is the ambient
 * orchestrator. Data here is the canonical example set from the spec.
 */
import {
  IconClock,
  IconBriefcase,
  IconRefresh,
  IconTrendUp,
  v2,
} from '../v2';
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

const FRAMES: Frame[] = [
  {
    day: 'friday, may 22',
    time: '9:41',
    icon: <IconClock size={14} weight={2} stroke={v2.paper} />,
    when: 'now',
    title: 'rent · $1,200 · due tomorrow',
    body: "one bill, so you're not caught out.",
  },
  {
    day: 'tuesday, may 26',
    time: '2:18',
    icon: <IconBriefcase size={14} weight={1.9} stroke={v2.paper} />,
    when: '2h ago',
    title: 'income landed — set $340 aside for tax?',
    body: 'an offer, before it gets spent.',
  },
  {
    day: 'wednesday, may 27',
    time: '8:30',
    icon: <IconClock size={14} weight={2} stroke={v2.paper} />,
    when: 'yesterday',
    title: 'the $180 headphones — 24h is up. your call.',
    body: 'no nudge either way.',
  },
  {
    day: 'monday, june 1',
    time: '11:05',
    icon: <IconRefresh size={14} weight={2} stroke={v2.paper} />,
    when: 'mon',
    title: 'spotify renews in 3 days · $11',
    body: 'not in your words for 6 weeks.',
  },
  {
    day: 'tuesday, june 2',
    time: '6:47',
    icon: <IconTrendUp size={14} weight={2} stroke={v2.paper} />,
    when: 'tue',
    title: '$240 today — about 3× a usual day',
    body: "just so you've seen it. not a problem on its own.",
  },
  {
    day: 'sunday, june 7',
    time: '6:00',
    icon: (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} stroke={v2.paper} aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
      </svg>
    ),
    when: 'sun 6pm',
    title: 'your week — safe-to-spend held, 1 bill paid',
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
      {/* a quiet exit — tap anywhere on the status row */}
      {FRAMES.map((f, i) => (
        <div
          key={f.day}
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
            <div style={{ fontSize: 15, color: '#5A5044', fontWeight: 500, letterSpacing: '0.01em' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
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
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="#6A604F">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
