/**
 * sleep-v2 · PatternsScreen — see the rest (sleep-patterns.html)
 *
 * A "see the rest" reflective surface: calm reading, never a charts wall.
 * The observed patterns are grouped quietly under small section labels —
 * each group a cluster of one-line observations with a sage dot and a
 * gentle reframe. It reads like a journal. No charts, no badges, no counts.
 *
 * Real data: `patternsVM` derives the "your shape" + "week vs weekend"
 * lines live from the same `@ollie/logic/sleep` detectors the live
 * `SleepModule` uses, and folds in the orchestrator-written `sleep.patterns`
 * for the behavioural + cross-module lines. Empty state: an honest line.
 */
import { useMemo } from 'react';
import { Screen, IconMoon, IconInfo, v2 } from '../../money-v2/v2';
import { useSleepSlices } from '../useSleepSlices';
import { patternsVM, patternGroupLabel, type PatternLine } from '../selectors';

export interface PatternsScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

/** the order the pattern groups appear in */
const GROUP_ORDER: PatternLine['group'][] = ['shape', 'week', 'winddown', 'cross'];

export function PatternsScreen({ onBack, onSafe }: PatternsScreenProps) {
  const slices = useSleepSlices();
  const vm = useMemo(() => patternsVM(slices), [slices]);

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((g) => ({
      group: g,
      lines: vm.patterns.filter((p) => p.group === g),
    })).filter((g) => g.lines.length > 0);
  }, [vm]);

  return (
    <Screen
      label="see the rest"
      glyph={<IconMoon stroke={v2.accent} />}
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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> in how you sleep
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
          none of this needs doing today. it&rsquo;s here to read when you&rsquo;re
          curious &mdash; quiet patterns, not instructions.
        </div>
      </div>

      {grouped.length === 0 ? (
        <div
          style={{
            marginTop: 40,
            fontSize: 15,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          nothing noticed yet. log a few more nights and quiet patterns start to
          surface here &mdash; chronotype, drift, the week-vs-weekend shape.
        </div>
      ) : (
        grouped.map(({ group, lines }) => (
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
            {lines.map((p, i) => (
              <div
                key={p.id}
                style={{
                  borderTop: `1px solid ${v2.line}`,
                  borderBottom:
                    i === lines.length - 1 ? `1px solid ${v2.line}` : 'none',
                  padding: '16px 0',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 11,
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
            ))}
          </div>
        ))
      )}

      {/* the closing note — restates this surface is screen-only */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} stroke={v2.mute} />
        </span>
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          ollie notices patterns &mdash; it does not diagnose. none of this is ever
          sent as a notification; it waits here for when you want it.
        </span>
      </div>
    </Screen>
  );
}
