/**
 * cycle-v2 · CycleFace — the cycle module page (Level 2)
 *
 * Mirrors cycle.html / cycle-cold.html — one face, two data states:
 *   - warmed   → the big phase ring (luteal arc + ovulation point + the
 *                travelling marker), a calm next-period prediction line,
 *                "log today", and the quiet drill rows
 *   - cold     → the ring is still present (track + a single marker, no
 *                arc), an honest "still learning" note, a confidence
 *                meter, and calm-empty drill rows
 *
 * Real data: every line comes from `selectors.ts` over the live `cycle.*`
 * slices via `useCycleSlices`. ONE focus = the ring (DIRECTION.md rule).
 */
import { useMemo } from 'react';
import {
  Screen,
  CycleRing,
  NavRow,
  AmberButton,
  IconPlus,
  v2,
} from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { faceVM, pillVM, historyVM, flagSummary } from '../selectors';
import type { CycleRoute } from '../CycleApp';

export interface CycleFaceProps {
  now: number;
  navigate: (to: CycleRoute) => void;
  onSafe: () => void;
}

export function CycleFace({ now, navigate, onSafe }: CycleFaceProps) {
  const slices = useCycleSlices();

  const face = useMemo(() => faceVM(slices, now), [slices, now]);
  const pill = useMemo(() => pillVM(slices, now), [slices, now]);
  const history = useMemo(() => historyVM(slices), [slices]);
  const flagLine = useMemo(() => flagSummary(slices, now), [slices, now]);

  // ── drill-row glance lines ───────────────────────────────────────────────

  const pillLine = !slices.birthControlEnabled
    ? 'not tracking birth control'
    : pill.totalLogged === 0
      ? "start logging when you're ready"
      : pill.todayLogged
        ? "today's pill logged"
        : 'today not logged yet';

  const historyLine = history.hasClosed
    ? `last ${history.cycles.length} cycle${history.cycles.length === 1 ? '' : 's'} · mean ${history.meanDays}d`
    : 'no closed cycles yet';

  const partnerLine = slices.asks.length
    ? `${slices.asks.length} thing${slices.asks.length === 1 ? '' : 's'} picked · send an ask`
    : 'tell someone what you need';

  return (
    <Screen label="cycle" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* HERO — the phase ring */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <CycleRing
          day={face.day}
          phase={face.phase}
          length={face.ringLength}
          lutealStartDay={face.lutealStartDay}
          ovulationDay={face.ovulationDay}
        />

        {/* prediction / cold-state note */}
        {face.coldStart ? (
          <ColdNote
            cyclesLogged={face.cyclesLogged}
            confidenceFill={face.confidenceFill}
            hasData={face.hasData}
          />
        ) : (
          face.prediction && (
            <div
              style={{
                marginTop: 24,
                fontSize: 14,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                textAlign: 'center',
              }}
            >
              <b style={{ fontWeight: 600 }}>
                period likely &middot; {face.prediction.date}
              </b>
              <span style={{ color: v2.mute, fontWeight: 500 }}>
                {' '}
                &plusmn; {face.prediction.plusMinusDays} day
                {face.prediction.plusMinusDays === 1 ? '' : 's'}
              </span>
            </div>
          )
        )}

        <AmberButton
          icon={<IconPlus size={18} />}
          onClick={() => navigate('log')}
          style={{ marginTop: 26, height: 50, borderRadius: 25 }}
        >
          log today
        </AmberButton>
      </div>

      {/* DRILL ROWS */}
      <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          rowKey="pill log"
          value={pillLine}
          dim={!slices.birthControlEnabled || pill.totalLogged === 0}
          onOpen={() => navigate('pill')}
        />
        <NavRow
          rowKey="history"
          value={historyLine}
          dim={!history.hasClosed}
          onOpen={() => navigate('history')}
        />
        <NavRow
          rowKey="partner-ask"
          value={partnerLine}
          last={!flagLine}
          dim={slices.asks.length === 0}
          onOpen={() => navigate('partner-ask')}
        />
        {/* the calm clinical-flag row — only ever present when a flag is live */}
        {flagLine && (
          <NavRow
            flag
            last
            rowKey="worth a look"
            value={flagLine}
            onOpen={() => navigate('flags')}
          />
        )}
      </div>

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{
          marginTop: 28,
          alignSelf: 'center',
          background: 'transparent',
          border: 'none',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        what cycle sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

interface ColdNoteProps {
  cyclesLogged: number;
  confidenceFill: number;
  hasData: boolean;
}

function ColdNote({ cyclesLogged, confidenceFill, hasData }: ColdNoteProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* the honest "still learning" line — a sage dot marks it */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          maxWidth: 280,
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
            lineHeight: 1.45,
            textAlign: 'left',
          }}
        >
          <b style={{ fontWeight: 600 }}>still learning your cycle.</b> a couple
          more and predictions warm up &mdash; for now ollie won&rsquo;t guess a
          date.
        </span>
      </div>

      {/* a quiet confidence meter */}
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 150,
            height: 4,
            borderRadius: 3,
            background: v2.line,
            position: 'relative',
            overflow: 'hidden',
          }}
          role="progressbar"
          aria-valuenow={Math.round(confidenceFill * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.max(8, confidenceFill * 100)}%`,
              borderRadius: 3,
              background: v2.sage,
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
          {hasData
            ? `${cyclesLogged} cycle${cyclesLogged === 1 ? '' : 's'} logged · warming up`
            : 'nothing logged yet · warming up'}
        </div>
      </div>
    </div>
  );
}
