/**
 * goals-v2 · PatternsScreen — "see the rest" (goals-patterns.html)
 *
 * A calm "see the rest" reflective surface — quiet patterns grouped under
 * small section labels, each a ONE-LINE observation with a sage dot, a soft
 * reframe sub-line, and a barely-there italic citation tag. NO charts, NO
 * badges, NO counts. It reads like a journal.
 *
 * TONE — goals + ADHD is a shame minefield, so this surface is the most
 * carefully kind: a stalled or abandoned goal is read as neurology and
 * interference, never as failure. A closing note restates it is screen-
 * only — none of this is ever pushed as a notification, and a stalled goal
 * is never a verdict.
 *
 * Real data + honest stub: the goals detectors that run on the `goals.*`
 * slices (goal-interference, per-category velocity, research-as-progress,
 * identity-drift, sunk-cost) are surfaced LIVE through `patternsVM` from
 * `selectors.ts`. The reflective echo detectors need a full cross-module
 * dump + per-goal tag history the preview store may not cleanly carry, so
 * when nothing is observed the screen shows the canonical spec example set
 * and SAYS SO plainly — `patternsVM().isExample` drives an honest banner.
 * (Reported as a stub.)
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useGoalsSlices } from '../useGoalsSlices';
import { patternsVM } from '../selectors';

export interface PatternsScreenProps {
  now: number;
  onBack: () => void;
}

export function PatternsScreen({ now, onBack }: PatternsScreenProps) {
  const slices = useGoalsSlices();
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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> about your goals
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
          none of this is a verdict. a stalled goal isn&rsquo;t a failing
          &mdash; it&rsquo;s information. read it when you&rsquo;re curious,
          leave it when you&rsquo;re not.
        </div>
      </div>

      {/* the honest example banner — only when nothing live is observed */}
      {vm.isExample && (
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
          <span style={{ fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
            <b style={{ color: v2.ink, fontWeight: 600 }}>example observations.</b>{' '}
            ollie&rsquo;s goal detectors read your dumps, your per-goal notes
            and your check-ins &mdash; until that history is here, these stand
            in to show the shape of what surfaces.
          </span>
        </div>
      )}

      {vm.groups.map((group) => (
        <div key={group.key} style={{ marginTop: 30 }}>
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
          {group.lines.map((p, i) => (
            <div
              key={p.key}
              style={{
                boxSizing: 'border-box',
                padding: '16px 0',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: i === group.lines.length - 1 ? `1px solid ${v2.line}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
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
                      fontSize: 11.5,
                      color: v2.mute,
                      fontWeight: 400,
                      fontStyle: 'italic',
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

      {/* the closing note — screen-only, never pushed, never shaming */}
      <div style={{ marginTop: 26, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          ollie notices patterns &mdash; it never grades you. none of this is
          ever sent as a notification; it waits here, quietly, for when you
          want it. a stalled goal is never a verdict.
        </span>
      </div>
    </Screen>
  );
}
