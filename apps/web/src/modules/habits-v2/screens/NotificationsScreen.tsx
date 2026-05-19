/**
 * habits-v2 · NotificationsScreen — the lock-screen reel
 *   (habits-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the habits
 * module's notification copy gallery: it shows how each habit cue speaks.
 * The copy is lowercase, dry, no exclamation — gentle cue-nudges and
 * supportive reframes ONLY.
 *
 * Habits sends exactly four kinds of push — a morning cue, an evening
 * cue, a "your week is different" reframe (luteal / stress), and an
 * opt-in weekly note. The reel closes on a non-notification "endframe":
 * the screen-only promise that there is no "you missed", no completion
 * count, no streak-broken push — and that the 24 patterns stay on
 * "see the rest".
 *
 * This is a PRESENTATION SURFACE — a gallery of what the notifications
 * look like — not a live feed. The real notification engine is the
 * orchestrator's habits detector; the copy here is the canonical example
 * set from the spec. Mirrors medication-v2/screens/NotificationsScreen.tsx
 * in code style. (Reported as a presentation stub, like sleep/medication.)
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

/** a sun — the morning-cue glyph */
function IconSun() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      stroke={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2" />
    </svg>
  );
}

/** a crescent moon — the evening-cue glyph */
function IconMoon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      stroke={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  );
}

/** a soft moon-dial — the "your week is different" reframe glyph */
function IconReframe() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      stroke={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8a4 4 0 0 0 0 8" />
    </svg>
  );
}

/** a heart — the stress-mode offer glyph */
function IconHeart() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      stroke={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
    </svg>
  );
}

/** stacked lines — the weekly-note glyph */
function IconLines() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.9}
      stroke={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

const FRAMES: Frame[] = [
  {
    day: 'monday, may 19',
    time: '9:00',
    icon: <IconSun />,
    when: 'now',
    title: 'morning — 3 small things, when you can',
    body: 'no order, no rush. they wait for their cue.',
  },
  {
    day: 'monday, may 19',
    time: '8:30',
    icon: <IconMoon />,
    when: 'now',
    title: 'evening — 2 still waiting',
    body: 'if tonight has room. if not, that’s fine too.',
  },
  {
    day: 'thursday, may 22',
    time: '10:15',
    icon: <IconReframe />,
    when: '9:15am',
    title: 'your brain’s different this week',
    body: 'scaling expectations, not standards — a lighter list is enough.',
  },
  {
    day: 'monday, may 26',
    time: '8:50',
    icon: <IconHeart />,
    when: 'now',
    title: 'a lot on right now — want stress mode?',
    body: 'it pares the list down to body-only. flip it back any time.',
  },
  {
    day: 'sunday, june 1',
    time: '6:00',
    icon: <IconLines />,
    when: 'sun 6pm',
    title: 'your week in habits',
    body: 'a quiet recap — no grade. arrives only if you asked for it.',
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

      {/* closing note — what habits deliberately keeps off the lock screen */}
      <div
        style={{
          height: '100dvh',
          scrollSnapAlign: 'start',
          background: 'linear-gradient(168deg,#EFE7D7 0%,#E3D8C2 100%)',
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
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '1.6px solid #9A8F7C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 22,
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            stroke="#6A604F"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 13l4 4 10-11" />
          </svg>
        </div>
        <h4
          style={{
            margin: 0,
            fontSize: 15,
            color: '#3A342C',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: 13,
          }}
        >
          no &ldquo;you missed&rdquo; &mdash; ever
        </h4>
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: '#6A604F',
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          habits sends{' '}
          <b style={{ color: '#3A342C', fontWeight: 600 }}>gentle cue nudges</b>{' '}
          and{' '}
          <b style={{ color: '#3A342C', fontWeight: 600 }}>
            supportive reframes
          </b>{' '}
          &mdash; and nothing else. there is deliberately no &ldquo;you
          missed&rdquo;, no completion count, no broken-streaks push.
        </p>
        <div
          style={{
            width: 26,
            height: 1.5,
            background: '#C3B69E',
            borderRadius: 1,
            margin: '18px 0',
          }}
        />
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: '#6A604F',
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          the patterns ollie notices &mdash; keystone habits, luteal and stress
          dips, friction days, habit rebirth &mdash; all stay{' '}
          <b style={{ color: '#3A342C', fontWeight: 600 }}>screen-only</b>, on
          &ldquo;see the rest&rdquo;. a quiet week is never news that lands on a
          lock screen.
        </p>
      </div>
    </div>
  );
}
