/**
 * admin-v2 · NotificationsScreen — the lock-screen reel (admin-notifications.html)
 *
 * A vertical scroll-snap reel of full-height lock-screen frames — ONE
 * notification per frame, so you never see two at once. It is the admin
 * module's notification copy gallery: it shows how each ambient admin
 * detector speaks — a renewal cue, an appointment, a stale ball, the last
 * 5%, a yearly rhythm, a defer-chain, and an opt-in weekly note. The copy
 * is lowercase, dry, no exclamation.
 *
 * The reel closes on a non-notification "endframe" — the screen-only
 * promise: the reflective EF detectors (schedule-drift, open loops, the
 * EF-tier match) are NEVER pushed; they wait in "see the rest".
 *
 * This is a presentation surface (a gallery of what the seven pushes look
 * like), not a live feed — the real notification engine is the ambient
 * admin orchestrator. The seven cards come from the `notificationsVM`
 * selector (a curated reel; reported as a presentation stub). The frame
 * dates are derived off the injected `now` so the reel reads as live.
 */
import { useMemo } from 'react';
import {
  v2,
  IconRefresh,
  IconCalendar,
  IconPerson,
  IconMail,
  IconClock,
  IconList,
} from '../../money-v2/v2';
import { notificationsVM, type NotificationCard } from '../selectors';

export interface NotificationsScreenProps {
  now: number;
  onBack: () => void;
}

const ICON_STROKE = v2.paper;

/** the glyph for a notification card */
function CardGlyph({ glyph }: { glyph: NotificationCard['glyph'] }) {
  const props = { size: 14, stroke: ICON_STROKE } as const;
  switch (glyph) {
    case 'renewal':
    case 'recurring':
      return <IconRefresh {...props} />;
    case 'appointment':
      return <IconCalendar {...props} />;
    case 'staleball':
      return <IconPerson {...props} />;
    case 'mail':
      return <IconMail {...props} />;
    case 'clock':
      return <IconClock {...props} size={14} weight={2} />;
    case 'weekly':
      return <IconList {...props} />;
    default:
      return <IconRefresh {...props} />;
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
          key={c.key}
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
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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
            width: 42,
            height: 42,
            borderRadius: '50%',
            border: `1.5px solid ${v2.line}`,
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
            strokeWidth={1.8}
            stroke={v2.sage}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </div>
        <h2
          style={{
            fontSize: 19,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          seven pushes. <b style={{ fontWeight: 500 }}>that&rsquo;s the whole list.</b>
        </h2>
        <p
          style={{
            marginTop: 14,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          renewals, appointments, a stale ball, the last 5%, a yearly rhythm, a
          defer-chain &mdash; and an opt-in weekly note. the reflective detectors
          &mdash; schedule-drift, open loops, the EF-tier match &mdash; are
          deliberately screen-only. they wait in &ldquo;see the rest&rdquo; for
          when you&rsquo;re curious, never on your lock screen.
        </p>
      </div>
    </div>
  );
}
