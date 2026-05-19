/**
 * body-v2 · PatternsScreen — "see the rest" (body-patterns.html)
 *
 * A calm "see the rest" reflective surface — quiet patterns grouped under
 * small section labels, each a ONE-LINE observation with a sage dot and a
 * soft reframe sub-line. NO charts, NO badges, NO counts. It reads like a
 * journal. A closing note restates the surface is screen-only, never pushed.
 *
 * Real data: `patternsVM` over the live `body.patterns` slice — the SAME
 * orchestrator-written pattern set the live `BodyNoticed` panel renders.
 * Each pattern's `copy` is the observation; the selector pairs the gentle
 * reframe. When no pattern is observed yet, an honest "still settling"
 * note stands in — never a blank page.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import {
  patternsVM,
  patternGroupLabel,
  PATTERN_GROUP_ORDER,
} from '../selectors';

export interface PatternsScreenProps {
  onBack: () => void;
  onSafe: () => void;
}

export function PatternsScreen({ onBack, onSafe }: PatternsScreenProps) {
  const slices = useBodySlices();
  const vm = useMemo(() => patternsVM(slices), [slices]);

  const grouped = useMemo(
    () =>
      PATTERN_GROUP_ORDER.map((g) => ({
        group: g,
        items: vm.patterns.filter((p) => p.group === g),
      })).filter((g) => g.items.length > 0),
    [vm],
  );

  return (
    <Screen
      label="see the rest"
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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> about your body
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

      {grouped.length === 0 ? (
        <div
          style={{
            marginTop: 36,
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
            nothing&rsquo;s settled into a pattern yet. keep logging water,
            supplements, the odd symptom &mdash; patterns tend to surface around
            two weeks in, and they&rsquo;ll appear here when they do.
          </span>
        </div>
      ) : (
        grouped.map(({ group, items }) => (
          <div key={group} style={{ marginTop: 30 }}>
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
              {patternGroupLabel(group)}
            </div>
            {items.map((p, i) => (
              <div
                key={p.id}
                style={{
                  boxSizing: 'border-box',
                  padding: '16px 0',
                  borderTop: `1px solid ${v2.line}`,
                  borderBottom:
                    i === items.length - 1 ? `1px solid ${v2.line}` : 'none',
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

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
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          ollie notices patterns &mdash; it does not diagnose. none of this is
          ever sent as a notification; it waits here for when you want it.
        </span>
      </div>
    </Screen>
  );
}
