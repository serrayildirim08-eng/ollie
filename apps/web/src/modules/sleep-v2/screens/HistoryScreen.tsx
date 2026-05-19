/**
 * sleep-v2 · HistoryScreen — the last 14 nights (sleep-history.html)
 *
 * One thing: the window mean as a headline number, then the last 14
 * usable nights as a confident bar chart (the shared `WeekBars` grammar,
 * scaled tall, last night amber). Below, two calm ledger lines — the
 * shortest night and the 14-day sleep debt. No grades, no judgement.
 *
 * Real data: `historyVM` over the live `sleep.records` + `computeSleepDebt`
 * from `@ollie/logic/sleep`. Empty state: an honest line, never a blank.
 */
import { useMemo } from 'react';
import { Screen, ListRow, IconMoon, v2 } from '../../money-v2/v2';
import { useSleepSlices } from '../useSleepSlices';
import { historyVM, fmtDuration } from '../selectors';
import { WeekBars } from '../components/WeekBars';

export interface HistoryScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function HistoryScreen({ now, onBack, onSafe }: HistoryScreenProps) {
  const slices = useSleepSlices();
  const history = useMemo(() => historyVM(slices, now), [slices, now]);

  return (
    <Screen
      label="history"
      glyph={<IconMoon stroke={v2.accent} />}
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {history.hasData ? (
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
              {history.count}-night average
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 54,
                fontWeight: 300,
                color: v2.ink,
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {history.meanMin != null ? fmtDuration(history.meanMin) : '—'}
            </div>
          </div>

          {/* the 14-night chart — confident bars, last night amber */}
          <div style={{ marginTop: 44 }}>
            <WeekBars bars={history.nights} maxHeight={150} flex gap={5} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 9,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: v2.mute,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {history.count >= 14 ? '2 wks ago' : 'earliest'}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: v2.mute,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                last night
              </span>
            </div>
          </div>

          {/* two calm ledger lines — shortest night + sleep debt */}
          <div style={{ marginTop: 38, display: 'flex', flexDirection: 'column' }}>
            <ListRow
              first
              name="shortest night"
              amount={
                history.shortestMin != null
                  ? fmtDuration(history.shortestMin)
                  : '—'
              }
            />
            <ListRow
              name={`sleep debt · ${history.count} days`}
              amount={
                history.debtMin == null
                  ? 'not enough nights'
                  : history.debtMin <= 0
                    ? 'on target'
                    : `${fmtDuration(history.debtMin)} short`
              }
            />
          </div>
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
          <div style={{ fontSize: 17, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
            no nights logged yet. log a night from the sleep face and a calm
            history builds here.
          </div>
        </div>
      )}
    </Screen>
  );
}
