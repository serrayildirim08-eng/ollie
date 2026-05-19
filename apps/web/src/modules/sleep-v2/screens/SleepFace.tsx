/**
 * sleep-v2 · SleepFace — the sleep submodule page (Level 2)
 *
 * Mirrors sleep.html / sleep-cold.html — one face, two data states:
 *   - warmed → the 7-night bar, last night's duration as the hero, two
 *              calm lines (sleep debt + tonight's forecast), "log last
 *              night", and the quiet drill rows
 *   - cold   → the 7-night bar still present (real nights + dashed empty
 *              slots), an honest "still settling" note, a confidence
 *              meter, calm-cold drill rows
 *
 * Real data: every line comes from `selectors.ts` over the live `sleep.*`
 * slices via `useSleepSlices`. ONE focus = last night's duration.
 */
import { useMemo } from 'react';
import {
  Screen,
  NavRow,
  AmberButton,
  IconPlus,
  v2,
} from '../../money-v2/v2';
import { useSleepSlices } from '../useSleepSlices';
import {
  faceVM,
  windDownVM,
  historyVM,
  patternSummary,
  fmtDuration,
} from '../selectors';
import { WeekBars } from '../components/WeekBars';
import type { SleepRoute } from '../SleepApp';

export interface SleepFaceProps {
  now: number;
  navigate: (to: SleepRoute) => void;
  onSafe: () => void;
}

export function SleepFace({ now, navigate, onSafe }: SleepFaceProps) {
  const slices = useSleepSlices();

  const face = useMemo(() => faceVM(slices, now), [slices, now]);
  const wind = useMemo(() => windDownVM(slices, now), [slices, now]);
  const history = useMemo(() => historyVM(slices, now), [slices, now]);
  const patternLine = useMemo(() => patternSummary(slices), [slices]);

  // ── drill-row glance lines ───────────────────────────────────────────────

  const windLine = wind.allDone
    ? 'tonight’s steps all done'
    : wind.cursor > 0
      ? `${wind.cursor} of 6 steps done`
      : '6 small steps before bed';

  const historyLine = history.hasData
    ? `last ${history.count} night${history.count === 1 ? '' : 's'} · ${
        history.meanMin != null ? fmtDuration(history.meanMin) : '—'
      } mean`
    : `${face.nightsLogged} night${face.nightsLogged === 1 ? '' : 's'} so far`;

  const deeperLine = face.coldStart
    ? 'two short check-ins, whenever you like'
    : slices.insomniaResult || slices.epworthResult
      ? 'your check-in results · retake any time'
      : 'two short sleep check-ins';

  return (
    <Screen label="sleep" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* HERO — last night's duration */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <WeekBars bars={face.week} maxHeight={48} />

        <div
          style={{
            marginTop: 22,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          last night
        </div>
        <Duration min={face.lastNightMin} />

        {/* prediction / cold-state note */}
        {face.coldStart ? (
          <ColdNote
            nightsLogged={face.nightsLogged}
            confidenceFill={face.confidenceFill}
            hasData={face.hasData}
          />
        ) : (
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {face.debtMin != null && (
              <Line
                k="this week"
                v={
                  face.debtMin <= 0
                    ? 'on target'
                    : `${fmtDuration(face.debtMin)} short`
                }
              />
            )}
            {face.tonightHours != null && (
              <Line k="tonight" v={`~${face.tonightHours}h likely`} />
            )}
          </div>
        )}

        <AmberButton
          icon={<IconPlus size={18} />}
          onClick={() => navigate('log')}
          style={{ marginTop: 28, height: 50, borderRadius: 25 }}
        >
          log last night
        </AmberButton>
      </div>

      {/* DRILL ROWS */}
      <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          rowKey="wind-down"
          value={windLine}
          onOpen={() => navigate('winddown')}
        />
        <NavRow
          rowKey="history"
          value={historyLine}
          dim={!history.hasData || face.coldStart}
          onOpen={() => navigate('history')}
        />
        <NavRow
          rowKey="sounds"
          value="brown noise · soft sleep timer"
          onOpen={() => navigate('sounds')}
        />
        <NavRow
          rowKey="go deeper"
          value={deeperLine}
          last={!patternLine}
          dim={face.coldStart && !slices.insomniaResult && !slices.epworthResult}
          onOpen={() => navigate('survey')}
        />
        {/* the observed-pattern row — only present when a pattern is live */}
        {patternLine && (
          <NavRow
            flag
            last
            rowKey="see the rest"
            value={patternLine}
            onOpen={() => navigate('patterns')}
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
        what sleep sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

// ─── the hero duration figure ────────────────────────────────────────────────

function Duration({ min }: { min: number | null }) {
  if (min == null) {
    return (
      <div
        style={{
          marginTop: 8,
          fontSize: 26,
          fontWeight: 400,
          color: v2.mute,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          textAlign: 'center',
        }}
      >
        nothing logged yet
      </div>
    );
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (
    <div
      style={{
        marginTop: 8,
        fontSize: 74,
        fontWeight: 300,
        color: v2.ink,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        display: 'flex',
        alignItems: 'baseline',
      }}
    >
      {h}
      <span style={{ fontSize: 30, color: v2.mute, fontWeight: 300, letterSpacing: '-0.02em' }}>
        h
      </span>
      <span style={{ width: 12 }} />
      {String(m).padStart(2, '0')}
      <span style={{ fontSize: 30, color: v2.mute, fontWeight: 300, letterSpacing: '-0.02em' }}>
        m
      </span>
    </div>
  );
}

// ─── a calm "k · v" line under the hero ──────────────────────────────────────

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ fontSize: 14, color: v2.ink, fontWeight: 500, letterSpacing: '-0.01em' }}>
      <span style={{ color: v2.mute, fontWeight: 500 }}>{k}</span>
      <span style={{ color: v2.line, margin: '0 7px' }}>&middot;</span>
      <b style={{ fontWeight: 600 }}>{v}</b>
    </div>
  );
}

// ─── the cold-start note + confidence meter ──────────────────────────────────

interface ColdNoteProps {
  nightsLogged: number;
  confidenceFill: number;
  hasData: boolean;
}

function ColdNote({ nightsLogged, confidenceFill, hasData }: ColdNoteProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* the honest "still settling" line — a sage dot marks it */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          maxWidth: 286,
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
          <b style={{ fontWeight: 600 }}>the forecast is still settling.</b> a few
          more nights and ollie can tell you what tonight is likely to look like.
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
            ? `${nightsLogged} night${nightsLogged === 1 ? '' : 's'} logged · settling`
            : 'nothing logged yet · settling'}
        </div>
      </div>
    </div>
  );
}
