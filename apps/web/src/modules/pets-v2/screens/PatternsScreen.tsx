/**
 * pets-v2 · PatternsScreen — "see the rest" (pets-patterns.html)
 *
 * A calm reflective surface — the behavioural patterns ollie noticed about
 * the keeper and the pets, grouped under quiet section labels, each a
 * ONE-LINE observation with a sage dot, a soft reframe, and a barely-there
 * italic citation. NO charts, NO badges, NO counts. A closing note restates
 * the surface is screen-only — these reflective patterns are never pushed.
 *
 * Honest stub: the pets P1–P5 detectors (`@ollie/logic/pets`) need
 * cross-module history — work crash logs, body sleep-debt, brain-dump
 * corpora — that the pets store alone cannot supply. So, exactly like
 * habits-v2 / admin-v2, `petsPatternsVM().showingExamples` is currently
 * always true and the screen renders the canonical research-grounded
 * example set, honestly labelled. (Reported as a stub.)
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { petsPatternsVM } from '../selectors';
import type { PatternVM } from '../selectors';

export interface PatternsScreenProps {
  now: number;
  onBack: () => void;
}

export function PatternsScreen({ now, onBack }: PatternsScreenProps) {
  const slices = usePetsSlices();
  const vm = useMemo(() => petsPatternsVM(slices, now), [slices, now]);
  const patterns = vm.showingExamples ? vm.examples : vm.live;

  // group the flat pattern list by its `.group` field, preserving order
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PatternVM[]>();
    for (const p of patterns) {
      if (!byGroup.has(p.group)) {
        byGroup.set(p.group, []);
        order.push(p.group);
      }
      byGroup.get(p.group)!.push(p);
    }
    return order.map((label) => ({ label, lines: byGroup.get(label)! }));
  }, [patterns]);

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
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> about you and the
          pets
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
          you&rsquo;re curious &mdash; quiet patterns about how care fits your
          days, not a scorecard.
        </div>
      </div>

      {/* the honest example banner — only when nothing live is observed */}
      {vm.showingExamples && (
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
            the pets pattern detectors read your care log alongside your dumps
            and crash history across modules &mdash; until that history is here,
            these stand in to show the shape of what surfaces.
          </span>
        </div>
      )}

      {groups.map((group) => (
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
              key={`${group.label}-${i}`}
              style={{
                boxSizing: 'border-box',
                padding: '16px 0',
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === group.lines.length - 1 ? `1px solid ${v2.line}` : 'none',
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
          ollie notices patterns &mdash; it does not judge, and it never shames a
          missed care task. these reflective ones are deliberately never sent as
          a notification; they wait here for when you want them.
        </span>
      </div>
    </Screen>
  );
}
