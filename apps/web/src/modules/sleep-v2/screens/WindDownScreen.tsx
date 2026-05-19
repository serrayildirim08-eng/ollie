/**
 * sleep-v2 · WindDownScreen — the 6-step bedtime ritual (sleep-winddown.html)
 *
 * One thing: a 6-step sequential tap-through. Done steps settle back with
 * a sage tick; the step in focus is the only one with weight — an amber
 * ring, larger mark, a quiet "tap when done" cue. No streak, no progress
 * bar — just where you are in the ritual.
 *
 * Real data: the run state is the persisted `sleep.wind_down_state` — the
 * SAME date-keyed slice the live `WindDownChecklist` writes — read via
 * `windDownVM` and advanced through `useSleepActions.setWindDownStep`.
 * Reload restores your place; local midnight starts a fresh night.
 */
import { useMemo } from 'react';
import { Screen, IconCheck, IconMoon, v2 } from '../../money-v2/v2';
import { useSleepSlices } from '../useSleepSlices';
import { useSleepActions } from '../useSleepActions';
import { windDownVM } from '../selectors';

export interface WindDownScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function WindDownScreen({ now, onBack, onSafe }: WindDownScreenProps) {
  const slices = useSleepSlices();
  const actions = useSleepActions(now);
  const wind = useMemo(() => windDownVM(slices, now), [slices, now]);

  return (
    <Screen
      label="wind-down"
      glyph={<IconMoon stroke={v2.accent} />}
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the lead */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>six small steps</b> into the night
      </div>
      {/* notif-scope-allow — the copy DISAVOWS streaks (DNA principle iii,
          the Volkow rule); ollie keeps none here. not an engagement push. */}
      <div style={{ marginTop: 6, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        tap each as you go &middot; no streak, no rush
      </div>

      {/* the 6-step sequential ritual */}
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column' }}>
        {wind.steps.map((step, index) => {
          const isDone = index < wind.cursor;
          const isNow = index === wind.cursor && !wind.allDone;

          // tapping the focused step advances; tapping a done step rewinds
          const onTap = () => {
            if (isNow) actions.setWindDownStep(index + 1);
            else if (isDone) actions.setWindDownStep(index);
          };

          return (
            <button
              key={step.id}
              type="button"
              onClick={onTap}
              disabled={!isNow && !isDone}
              aria-pressed={isDone}
              aria-label={
                isDone
                  ? `${step.label} — done, tap to undo`
                  : isNow
                    ? `${step.label} — tap when done`
                    : `${step.label} — not yet`
              }
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 15,
                padding: isNow ? '18px 16px' : '15px 2px',
                margin: isNow ? '6px -4px' : 0,
                background: isNow ? '#FCF6EA' : 'transparent',
                borderRadius: isNow ? 18 : 0,
                border: 'none',
                textAlign: 'left',
                cursor: isNow || isDone ? 'pointer' : 'default',
                WebkitTapHighlightColor: 'transparent',
                width: isNow ? 'calc(100% + 8px)' : '100%',
              }}
            >
              {/* the mark — open circle / amber ring / sage tick */}
              <span
                style={{
                  boxSizing: 'border-box',
                  width: isNow ? 34 : 28,
                  height: isNow ? 34 : 28,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isDone
                    ? `1.6px solid ${v2.sage}`
                    : isNow
                      ? `2px solid ${v2.accent}`
                      : `1.6px solid ${v2.line}`,
                  background: isDone ? v2.sage : 'transparent',
                }}
              >
                {isDone && <IconCheck size={13} weight={3} stroke="#fff" />}
              </span>

              {/* the step text */}
              <span
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: isNow ? 17 : 15,
                    color: isDone || isNow ? v2.ink : v2.mute,
                    fontWeight: isNow ? 600 : 500,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {step.label}
                </span>
                {isNow && step.cue && (
                  <span style={{ fontSize: 12, color: '#9A7A45', fontWeight: 500 }}>
                    {step.cue}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* the closing line — calm, no score */}
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconMoon size={15} stroke={v2.mute} />
        </span>
        {/* notif-scope-allow — the copy DISAVOWS streaks (DNA principle iii,
            the Volkow rule); ollie keeps none here. not an engagement push. */}
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          missing a step is fine &mdash; it&rsquo;s a ritual, not a test. ollie keeps
          no streak here.
        </span>
      </div>
    </Screen>
  );
}
