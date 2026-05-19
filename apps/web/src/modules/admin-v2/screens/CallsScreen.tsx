/**
 * admin-v2 · CallsScreen — calls to make (admin-calls.html)
 *
 * The phone-call cluster — admin's one ADHD-aversive thing, surfaced gently.
 * A calm reframe up top (a call asks a lot at once — that's why they wait),
 * then each call as ONE block, oldest-waiting first, with a quiet phone
 * glyph and how long it's waited. Each offers a sage "ask ollie for a call
 * script" line. A closing note restates the calm posture.
 *
 * Real data: `callsVM` over the live `admin.tasks` slice — the `phone_assist`
 * cluster, the SAME set the live `selectPhoneTasks` selector gathers.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, IconPhone, v2 } from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { callsVM } from '../selectors';

export interface CallsScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function CallsScreen({ now, onBack, onSafe }: CallsScreenProps) {
  const slices = useAdminSlices();
  const vm = useMemo(() => callsVM(slices, now), [slices, now]);

  return (
    <Screen
      label="calls to make"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the framing line */}
      <div style={{ marginTop: 44 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.3,
          }}
        >
          <b style={{ fontWeight: 500 }}>the calls.</b> gathered in one place
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          a phone call asks a lot at once &mdash; initiation, a script, holding
          the thread. that&rsquo;s why they wait. ollie can write the opening
          lines for any of them.
        </div>
      </div>

      {vm.calls.length === 0 ? (
        <div
          style={{
            marginTop: 30,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: v2.sage,
              flexShrink: 0,
              marginTop: 6,
            }}
          />
          <span
            style={{
              fontSize: 14,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.5,
            }}
          >
            no calls waiting. a task routed &ldquo;phone&rdquo; &mdash; from a
            defer or a dump &mdash; gathers here, so they&rsquo;re never
            scattered.
          </span>
        </div>
      ) : (
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column' }}>
          {vm.calls.map((call, i) => (
            <div
              key={call.id}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: i === vm.calls.length - 1 ? `1px solid ${v2.line}` : 'none',
                padding: '18px 2px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                <span
                  style={{
                    boxSizing: 'border-box',
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: v2.tile,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  <IconPhone size={15} stroke={v2.ink} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15,
                      color: v2.ink,
                      fontWeight: 500,
                      letterSpacing: '-0.012em',
                      lineHeight: 1.35,
                    }}
                  >
                    {call.title}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: call.oldest ? 600 : 500,
                      letterSpacing: '0.01em',
                      color: call.oldest ? '#A8703C' : v2.mute,
                    }}
                  >
                    {call.waitLine}
                  </div>
                </div>
              </div>
              {/* the script offer — a calm sage line */}
              <div
                style={{
                  marginTop: 13,
                  marginLeft: 43,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: v2.sage,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: v2.sage,
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                  }}
                >
                  ask ollie for a call script
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* the closing note */}
      <div style={{ marginTop: 26, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          a call bundles every part that&rsquo;s hard at once &mdash; that&rsquo;s
          neurology, not avoidance. one a day is plenty.
        </span>
      </div>
    </Screen>
  );
}
