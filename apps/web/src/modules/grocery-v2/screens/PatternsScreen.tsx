/**
 * grocery-v2 · PatternsScreen — see the rest (grocery-patterns.html)
 *
 * A "see the rest" reflective surface — calm reading, never a charts wall.
 * Grouped one-line observations under small section labels, a sage dot on
 * each line, a soft reframe sub-line, an italic citation tag. It reads
 * like a journal. None of it is ever pushed as a notification.
 *
 * Real data: `patternsVM` runs `detectPatterns` + `detectInterestCapture`
 * from `@ollie/logic/grocery` over the live `grocery.*` slices. When no
 * real pattern fires it falls back to honest canonical examples — the
 * `exampleFallback` flag drives the honest "example observations" banner.
 * Reported as: cross-module detectors (grocery × sleep, grocery × cycle,
 * the learned-stores observation) are NOT wired — they need history this
 * preview store doesn't carry; the canonical examples stand in for them.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useGrocerySlices } from '../useGrocerySlices';
import { patternsVM } from '../selectors';

export interface PatternsScreenProps {
  now: number;
  onBack: () => void;
}

export function PatternsScreen({ now, onBack }: PatternsScreenProps) {
  const slices = useGrocerySlices();
  const vm = useMemo(() => patternsVM(slices, now), [slices, now]);

  return (
    <Screen label="see the rest" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> about your
          shopping
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
          none of this needs doing today. it&rsquo;s here to read when
          you&rsquo;re curious &mdash; quiet patterns, not instructions.
        </div>
      </div>

      {/* the honest example banner — only when nothing live is observed */}
      {vm.exampleFallback && (
        <div
          style={{
            marginTop: 22,
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
            style={{ fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}
          >
            <b style={{ color: v2.ink, fontWeight: 600 }}>example observations.</b>{' '}
            the pattern detectors read your shopping + pantry history &mdash;
            until a few weeks of trips are here, these stand in to show the
            shape of what surfaces.
          </span>
        </div>
      )}

      {/* the pattern groups */}
      {vm.groups.map((group) => (
        <div key={group.label} style={{ marginTop: 30 }}>
          <div
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {group.label}
          </div>
          {group.rows.map((p, i) => (
            <div
              key={p.line}
              style={{
                boxSizing: 'border-box',
                padding: '16px 0',
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === group.rows.length - 1 ? `1px solid ${v2.line}` : 'none',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}
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
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      color: v2.ink,
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.4,
                    }}
                  >
                    {p.line}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      color: v2.mute,
                      fontWeight: 400,
                      lineHeight: 1.45,
                    }}
                  >
                    {p.frame}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: v2.mute,
                      fontWeight: 500,
                      fontStyle: 'italic',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {p.cite}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* the closing note */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span
          style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}
        >
          ollie notices patterns &mdash; it does not judge a basket. none of
          this is ever sent as a notification; it waits here for when you want
          it.
        </span>
      </div>
    </Screen>
  );
}
