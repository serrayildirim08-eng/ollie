/**
 * cycle-v2 · FlagsScreen — "worth a look" (cycle-flags.html)
 *
 * A calm "when you have a moment" surface. A framing line at the top sets
 * the tone, then each flag is ONE calm line: a sage dot, the observation,
 * a quiet source tag, and a soft watch/discuss framing under it. Sage and
 * ink only — NEVER red, never a diagnosis, never a count badge. A closing
 * note restates that none of this is diagnostic and is never pushed.
 *
 * Real data: `flagsVM` combines the live `detectHealthFlags` (per-cycle
 * run-length flags) + `detectSyndromePatterns` (PCOS / endo / PMDD / etc.)
 * over the real cycle history. Empty state: a calm "nothing here" line.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { flagsVM } from '../selectors';

export interface FlagsScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function FlagsScreen({ now, onBack, onSafe }: FlagsScreenProps) {
  const slices = useCycleSlices();
  const { flags } = useMemo(() => flagsVM(slices, now), [slices, now]);

  return (
    <Screen
      label="worth a look"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the framing line — calm, never an alarm */}
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
          {flags.length > 0 ? (
            <>
              <b style={{ fontWeight: 500 }}>a few things</b> ollie noticed in
              your cycles
            </>
          ) : (
            <>
              <b style={{ fontWeight: 500 }}>nothing</b> stands out right now
            </>
          )}
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
          {flags.length > 0
            ? 'nothing here needs doing today. when you have a moment, these are worth raising with a clinician.'
            : "ollie watches for patterns worth a clinician's eye — long cycles, prolonged bleeds, syndrome patterns. it'll quietly note them here if it sees any."}
        </div>
      </div>

      {/* the flags — each one calm line */}
      {flags.length > 0 && (
        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column' }}>
          {flags.map((f, i) => (
            <div
              key={f.id}
              style={{
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === flags.length - 1 ? `1px solid ${v2.line}` : 'none',
                padding: '18px 0',
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
                    {f.line}
                    {f.source && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          marginLeft: 8,
                          border: `1px solid ${v2.line}`,
                          borderRadius: 6,
                          padding: '1.5px 6px',
                          fontSize: 10,
                          fontWeight: 600,
                          color: v2.sage,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          verticalAlign: '1px',
                        }}
                      >
                        {f.source}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      fontSize: 13,
                      color: v2.mute,
                      fontWeight: 400,
                      lineHeight: 1.45,
                    }}
                  >
                    {f.frame}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* the closing note — the screen-only promise */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo stroke={v2.mute} />
        </span>
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          ollie observes patterns — it does not diagnose. these notes are never
          sent to you as a notification; they wait here for when you want them.
        </span>
      </div>
    </Screen>
  );
}
