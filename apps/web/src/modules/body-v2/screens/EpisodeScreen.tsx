/**
 * body-v2 · EpisodeScreen — the open-episode detail (body-episode.html)
 *
 * The episode head (name + day-N counter), the severity arc card
 * (check-in by check-in), the meds-logged list with an inline "log a med"
 * row, an optional severity check-in, and the calm sage resolve action —
 * which reveals a plain factual recap before the amber "close it" commit.
 *
 * Real data + logic: `episodeVM` over the live open episode in
 * `body.episodes`; check-ins / meds / close all mutate the live store via
 * `useBodyActions` (which routes through the pure `@ollie/logic/body`
 * episode helpers).
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconPlus, IconCheck, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { useBodyActions } from '../useBodyActions';
import { symptomsVM, episodeVM } from '../selectors';
import { SeverityArc } from '../components/SeverityArc';

export interface EpisodeScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function EpisodeScreen({ now, onBack, onSafe }: EpisodeScreenProps) {
  const slices = useBodySlices();
  const actions = useBodyActions(now);

  const open = useMemo(() => symptomsVM(slices).open, [slices]);
  const vm = useMemo(() => episodeVM(open, now), [open, now]);

  const [mode, setMode] = useState<null | 'med' | 'severity' | 'recap'>(null);
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [sevPick, setSevPick] = useState<number | null>(null);

  // no open episode — a calm honest empty state, never a blank page
  if (!vm.exists || !open) {
    return (
      <Screen
        label="episode"
        onBack={onBack}
        onSafe={onSafe}
        centered
        contentStyle={{ paddingTop: 0 }}
      >
        <div
          style={{
            textAlign: 'center',
            fontSize: 16,
            color: v2.mute,
            fontWeight: 500,
            lineHeight: 1.5,
            padding: '0 20px',
          }}
        >
          no episode is open right now. start one from{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>symptoms</b> when
          something turns up.
        </div>
      </Screen>
    );
  }

  function submitMed() {
    if (!medName.trim()) return;
    actions.logMed(open!.id, medName, medDose);
    setMedName('');
    setMedDose('');
    setMode(null);
  }

  function submitSeverity() {
    if (sevPick == null) return;
    actions.logSeverity(open!.id, sevPick);
    setSevPick(null);
    setMode(null);
  }

  function confirmClose() {
    actions.closeEpisode(open!.id);
    onBack();
  }

  const arcDayLabels = vm.checkIns.map((c) => c.label);

  return (
    <Screen
      label="episode"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the episode head */}
      <div style={{ marginTop: 44 }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
          }}
        >
          {vm.name}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {vm.dayLine}
        </div>
      </div>

      {/* the severity arc card */}
      <div
        style={{
          marginTop: 32,
          background: v2.card,
          border: `1px solid ${v2.line}`,
          borderRadius: 20,
          padding: '20px 18px 16px',
          boxShadow: '0 6px 16px rgba(42,38,34,.04)',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
          }}
        >
          severity, check-in by check-in
        </div>
        {vm.checkIns.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <SeverityArc
              points={vm.checkIns.map((c) => c.severity)}
              variant="card"
              dayLabels={arcDayLabels}
            />
          </div>
        ) : (
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            no check-ins yet. tap below whenever you want to note how it feels
            &mdash; it builds the arc, and the doctor summary.
          </div>
        )}
      </div>

      {/* an optional severity check-in */}
      {mode === 'severity' ? (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            how is it now
          </div>
          <div
            style={{
              marginTop: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => {
              const on = sevPick === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  aria-label={`severity ${n}`}
                  onClick={() => setSevPick(on ? null : n)}
                  style={{
                    boxSizing: 'border-box',
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    border: `1.5px solid ${on ? v2.accent : v2.line}`,
                    background: on ? '#FCF6EA' : 'transparent',
                    color: on ? v2.accent : v2.mute,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <AmberButton
              onClick={submitSeverity}
              block
              disabled={sevPick == null}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 22,
                fontSize: 14,
                opacity: sevPick == null ? 0.55 : 1,
              }}
            >
              note it
            </AmberButton>
            <CancelButton onClick={() => { setMode(null); setSevPick(null); }} />
          </div>
        </div>
      ) : (
        mode == null && (
          <button
            type="button"
            onClick={() => setMode('severity')}
            style={{
              marginTop: 16,
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              padding: '4px 2px',
              fontSize: 13,
              color: v2.sage,
              fontWeight: 600,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            + note how it feels now
          </button>
        )
      )}

      {/* meds logged */}
      <div
        style={{
          marginTop: 32,
          marginBottom: 2,
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        meds logged
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {vm.meds.map((m, i) => (
          <div
            key={`${m.name}-${m.when}-${i}`}
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'baseline',
              padding: '14px 2px',
              borderTop: `1px solid ${v2.line}`,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 14,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              <b style={{ fontWeight: 600 }}>{m.name}</b>
              {m.dose ? ` · ${m.dose}` : ''}
            </span>
            <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500 }}>
              {m.when}
            </span>
          </div>
        ))}

        {/* the log-a-med row — a ghost row, then an inline form */}
        {mode === 'med' ? (
          <div
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${v2.line}`,
              borderBottom: `1px solid ${v2.line}`,
              padding: '14px 2px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <input
              autoFocus
              value={medName}
              onChange={(e) => setMedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitMed();
              }}
              placeholder="what did you take"
              aria-label="medication name"
              style={fieldStyle}
            />
            <input
              value={medDose}
              onChange={(e) => setMedDose(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitMed();
              }}
              placeholder="dose — optional"
              aria-label="medication dose"
              style={fieldStyle}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <AmberButton
                onClick={submitMed}
                block
                style={{ flex: 1, height: 44, borderRadius: 22, fontSize: 14 }}
              >
                log it
              </AmberButton>
              <CancelButton
                onClick={() => {
                  setMode(null);
                  setMedName('');
                  setMedDose('');
                }}
              />
            </div>
          </div>
        ) : (
          mode == null && (
            <button
              type="button"
              onClick={() => setMode('med')}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: `1px solid ${v2.line}`,
                padding: '14px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                background: 'transparent',
                borderLeft: 'none',
                borderRight: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: `1.5px dashed ${v2.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <IconPlus size={11} weight={2.4} stroke={v2.mute} />
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: v2.mute,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                log a med taken
              </span>
            </button>
          )
        )}
      </div>

      {/* the calm resolve action — sage, not amber-loud */}
      {mode !== 'recap' && mode !== 'med' && mode !== 'severity' && (
        <button
          type="button"
          onClick={() => setMode('recap')}
          style={{
            boxSizing: 'border-box',
            marginTop: 30,
            height: 50,
            borderRadius: 25,
            background: v2.card,
            border: `1.5px solid ${v2.sage}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <IconCheck size={18} weight={2.2} stroke={v2.sage} />
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: v2.sage,
              letterSpacing: '-0.01em',
            }}
          >
            this one&rsquo;s over
          </span>
        </button>
      )}

      {/* the recap shown before confirming the close */}
      {mode === 'recap' && (
        <div
          style={{
            marginTop: 18,
            background: '#FCF6EA',
            border: '1px solid #E7D4AC',
            borderRadius: 20,
            padding: 18,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: v2.ink,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            before you close it &mdash; here&rsquo;s what was tracked
          </div>
          <div
            style={{
              marginTop: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            <RecapLine k="tracked for" v={`${vm.recap.days} day${vm.recap.days === 1 ? '' : 's'}`} />
            <RecapLine k="check-ins" v={String(vm.recap.checkIns)} />
            <RecapLine
              k="severity peak"
              v={vm.recap.peak != null ? `${vm.recap.peak} of 5` : 'none logged'}
            />
            <RecapLine k="meds logged" v={String(vm.recap.meds)} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <AmberButton
              onClick={confirmClose}
              block
              style={{ flex: 1, height: 46, borderRadius: 23, fontSize: 15 }}
            >
              close it
            </AmberButton>
            <CancelButton onClick={() => setMode(null)} />
          </div>
        </div>
      )}
    </Screen>
  );
}

const fieldStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '11px 13px',
  borderRadius: 12,
  border: `1px solid ${v2.line}`,
  background: v2.card,
  fontSize: 15,
  color: v2.ink,
  fontFamily: v2.sans,
  outline: 'none',
};

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        boxSizing: 'border-box',
        height: 44,
        padding: '0 18px',
        borderRadius: 22,
        border: `1px solid ${v2.line}`,
        background: v2.paper,
        color: v2.mute,
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      cancel
    </button>
  );
}

function RecapLine({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        fontSize: 13,
      }}
    >
      <span style={{ color: v2.mute, fontWeight: 500 }}>{k}</span>
      <span style={{ color: v2.ink, fontWeight: 600 }}>{v}</span>
    </div>
  );
}
