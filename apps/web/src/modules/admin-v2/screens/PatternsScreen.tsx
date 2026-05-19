/**
 * admin-v2 · PatternsScreen — "see the rest" (admin-patterns.html)
 *
 * A calm "see the rest" reflective surface — quiet patterns grouped under
 * small section labels, each a ONE-LINE observation with a sage dot, a soft
 * reframe sub-line, and a barely-there italic citation tag. NO charts, NO
 * badges, NO counts. It reads like a journal. A closing note restates the
 * surface is screen-only — the reflective EF detectors are never pushed.
 *
 * Real data + honest stub: the three A-series detectors that run on the
 * `admin.tasks` slice alone (A6 defer-chain, A10 recurring-annual, A12
 * last-5%) are surfaced LIVE through `patternsVM` from `@ollie/logic/admin`.
 * The reflective ones (A1 open-loop, A11 EF-tier match, A13 decision recall,
 * A15 schedule-drift) need cross-module dump + decision-rule history the
 * preview store doesn't cleanly carry, so when no live pattern is observed
 * the screen shows the canonical spec example set and SAYS SO plainly —
 * `patternsVM().isExample` drives an honest banner. (Reported as a stub.)
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { patternsVM } from '../selectors';

export interface PatternsScreenProps {
  now: number;
  onBack: () => void;
}

export function PatternsScreen({ now, onBack }: PatternsScreenProps) {
  const slices = useAdminSlices();
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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> in how you handle
          admin
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
            the reflective detectors read your dumps and decision history
            across modules &mdash; until that history is here, these stand in to
            show the shape of what surfaces.
          </span>
        </div>
      )}

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
                      fontSize: 11,
                      color: v2.mute,
                      fontWeight: 500,
                      fontStyle: 'italic',
                      letterSpacing: '0.01em',
                      opacity: 0.85,
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
      <div style={{ marginTop: 26, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          ollie notices patterns &mdash; it does not judge. these reflective ones
          &mdash; schedule-drift, the open loops &mdash; are deliberately never
          sent as a notification; they wait here for when you want them.
        </span>
      </div>
    </Screen>
  );
}
