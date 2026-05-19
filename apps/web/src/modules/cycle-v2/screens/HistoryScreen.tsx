/**
 * cycle-v2 · HistoryScreen — last 5 closed cycles (cycle-history.html)
 *
 * One thing: the mean cycle length as a headline number, then the last 5
 * closed cycles as calm day-length bars (width reads length against the
 * set; a long cycle tints the bar sage). The irregular note, when set, is
 * one calm sage line — a watch framing, never an alarm.
 *
 * Real data: `historyVM` over the live boundary detector + `deriveCycleStats`.
 * Empty state: an honest "no closed cycles yet" line, never a blank page.
 */
import { useMemo } from 'react';
import { Screen, IconDrop, v2 } from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { historyVM } from '../selectors';

export interface HistoryScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function HistoryScreen({ onBack, onSafe }: HistoryScreenProps) {
  const slices = useCycleSlices();
  const history = useMemo(() => historyVM(slices), [slices]);

  return (
    <Screen
      label="history"
      glyph={<IconDrop stroke={v2.accent} />}
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {history.hasClosed ? (
        <>
          {/* the mean — the headline number */}
          <div
            style={{
              marginTop: 44,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
              mean cycle length
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 54,
                fontWeight: 300,
                color: v2.ink,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'baseline',
              }}
            >
              {history.meanDays}
              <span
                style={{
                  fontSize: 20,
                  color: v2.mute,
                  fontWeight: 400,
                  marginLeft: 6,
                  letterSpacing: 0,
                }}
              >
                days
              </span>
            </div>
          </div>

          {/* last 5 closed cycles — calm day-length bars, newest first */}
          <div
            style={{
              marginTop: 46,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {history.cycles.map((c) => (
              <div
                key={c.startTs}
                style={{ display: 'flex', alignItems: 'center', gap: 14 }}
              >
                <span
                  style={{
                    width: 40,
                    fontSize: 11,
                    color: v2.mute,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {c.month}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    borderRadius: 7,
                    background: v2.line,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.round(c.fill * 100)}%`,
                      borderRadius: 7,
                      background: c.long ? v2.sage : v2.ink,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 54,
                    fontSize: 14,
                    color: v2.ink,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {c.days}
                  <span style={{ color: v2.mute, fontWeight: 500, fontSize: 12 }}> d</span>
                </span>
              </div>
            ))}
          </div>

          {/* the irregular note — one calm sage line, a watch framing */}
          {history.irregularNote && (
            <div
              style={{
                marginTop: 38,
                paddingTop: 22,
                borderTop: `1px solid ${v2.line}`,
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
                  marginTop: 5,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: v2.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.45,
                }}
              >
                <b style={{ fontWeight: 600, color: v2.sage }}>
                  cycles vary by {history.irregularNote.spreadDays} days
                </b>{' '}
                — that&rsquo;s wider than usual for you.
              </span>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            maxWidth: 260,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              fontSize: 17,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            no closed cycles yet. once you log two period starts, ollie can
            measure a cycle.
          </div>
        </div>
      )}
    </Screen>
  );
}
