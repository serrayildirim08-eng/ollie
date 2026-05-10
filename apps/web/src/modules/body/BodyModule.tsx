/**
 * BodyModule — water tracker + supplement reminders.
 * Never mentions calories.
 *
 * Visual language: paper/ink editorial (#F2EEE4 bg), not frosted-glass sky.
 * Ported from void-app.html BodyModule, ActiveEpisodeCard, SignalsSection,
 * ChronicConditionsCard, TreatmentPlansCard, BodyNoticed (~lines 40503–42070).
 */

import React, { useMemo, useState } from 'react';
import {
  activeEpisode,
  elapsedDays,
  logSeverity,
  logMed,
  closeEpisode,
  summarizeEpisode,
  generateDoctorSummary,
} from '@ollie/logic/body';
import {
  newTreatmentPlan,
  addCycleStart,
  cyclePosition,
} from '@ollie/logic/body';
import type { Episode, TreatmentPlan, AnyBodyPattern } from '@ollie/logic/body';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';
import { SourcesLink } from '../../components/SourcesLink';

// ─── colour tokens (paper/ink — no sky) ──────────────────────────────────────

const C = {
  bg: '#F2EEE4',
  paper: '#F8F4EA',
  ink: '#14130F',
  muted: '#4B4740',
  faint: '#7C7770',
  hairline: 'rgba(20,19,15,0.10)',
  hairlineHi: 'rgba(20,19,15,0.28)',
  water: '#3A4E5E', // editorial steel-blue
} as const;

// ─── Supplement shape ─────────────────────────────────────────────────────────

interface Supplement {
  id: string;
  name: string;
  dose: string | null;
  added_at: number;
}

// ─── Shared settings shape ────────────────────────────────────────────────────

interface SharedSettings {
  age_range?: string;
  chronic_conditions?: string[];
  name?: string;
  [k: string]: unknown;
}

// ─── Signal shape ─────────────────────────────────────────────────────────────

interface Signal {
  signal: string;
  copy: string;
  sources?: Array<{ citation?: string; url?: string }>;
}

// ─── style helpers ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.26em',
  color: C.muted,
  textTransform: 'uppercase',
  fontWeight: 500,
};

const ghostBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '12px 14px',
  background: active ? C.ink : 'transparent',
  color: active ? C.bg : C.muted,
  border: `1px solid ${active ? C.ink : C.hairlineHi}`,
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 2,
});

const inputStyle: React.CSSProperties = {
  padding: '11px 14px',
  background: C.bg,
  border: `1px solid ${C.hairline}`,
  color: C.ink,
  borderRadius: 2,
  fontFamily: "'Inter Tight', sans-serif",
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

// ─── SIGNAL_MODULE_RELEVANCE ──────────────────────────────────────────────────

const BODY_SIGNALS = new Set([
  'stress_luteal_migraine_cascade',
  'sleep_debt_amygdala',
  'hyperfocus_meal_rebound',
  'stress-caffeine-sleep-cooccurrence',
  'body_mind_comorbidity',
  'treatment_cycle_mood_lag',
]);

// ─── sub-components ───────────────────────────────────────────────────────────

// ── SignalsSection ────────────────────────────────────────────────────────────

function SignalsSection() {
  const [signals] = useStoreSlice<Signal[]>('shared', 'signals', []);
  const [dismissed, setDismissed] = useStoreSlice<string[]>('shared', 'dismissedSignals', []);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);

  const visible = useMemo(
    () =>
      (Array.isArray(signals) ? signals : []).filter(
        (s) => s && s.signal && BODY_SIGNALS.has(s.signal) && !dismissedSet.has(s.signal),
      ),
    [signals, dismissedSet],
  );

  if (visible.length === 0) return null;

  function dismiss(sig: string) {
    setDismissed([...dismissed, sig]);
  }

  return (
    <section style={{ paddingBottom: 24 }}>
      <div style={{ ...labelStyle, paddingBottom: 16 }}>
        signals{' '}
        <span style={{ color: C.faint, margin: '0 10px' }}>·</span>
        {visible.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.map((sig) => (
          <div
            key={sig.signal}
            style={{
              background: C.paper,
              border: `1px solid ${C.hairline}`,
              borderRadius: 4,
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                lineHeight: 1.55,
                color: C.ink,
              }}
            >
              {sig.copy}
            </div>
            {sig.sources && sig.sources.length > 0 && (
              <SourcesLink
                sources={sig.sources
                  .slice(0, 2)
                  .map((s) => s.url ?? '')
                  .filter(Boolean)}
              />
            )}
            <div>
              <button
                type="button"
                onClick={() => dismiss(sig.signal)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.hairlineHi}`,
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  color: C.muted,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── ActiveEpisodeCard ─────────────────────────────────────────────────────────

function ActiveEpisodeCard() {
  const [episodes, setEpisodes] = useStoreSlice<Episode[]>('body', 'episodes', []);
  const [mode, setMode] = useState<null | 'severity' | 'med' | 'close'>(null);
  const [sevPick, setSevPick] = useState<number | null>(null);
  const [sevNote, setSevNote] = useState('');
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState('');
  const [docModal, setDocModal] = useState<{ md: string } | null>(null);
  const [docCopied, setDocCopied] = useState(false);

  const list = useMemo(() => (Array.isArray(episodes) ? episodes : []), [episodes]);
  const activeEp = useMemo(() => activeEpisode(list), [list]);

  const now = Date.now();

  if (!activeEp) return null;

  // Capture as non-null so closures below don't re-check.
  const ep: Episode = activeEp;

  const days = elapsedDays(ep, now);
  const dayLabel = days === 0 ? 'day 1' : `day ${days + 1}`;

  const sevLog = Array.isArray(ep.severity_log) ? ep.severity_log : [];
  const lastSev = sevLog.length > 0 ? sevLog[sevLog.length - 1] : null;
  const medsArr = Array.isArray(ep.meds) ? ep.meds : [];
  const medNames = medsArr
    .slice(-3)
    .map((m) => (m && m.name ? m.name : ''))
    .filter(Boolean)
    .join(', ');

  function replaceEpisode(next: Episode): Episode[] {
    return list.map((e) => (e && e.id === ep.id ? next : e));
  }

  function closeMode() {
    setMode(null);
    setSevPick(null);
    setSevNote('');
    setMedName('');
    setMedDose('');
  }

  function submitSeverity() {
    if (!sevPick) return;
    const opts: { now: number; note?: string } = { now: Date.now() };
    const note = sevNote.trim();
    if (note) opts.note = note;
    const next = logSeverity(ep, sevPick, opts);
    setEpisodes(replaceEpisode(next));
    closeMode();
  }

  function submitMed() {
    const name = medName.trim();
    if (!name) return;
    const opts: { now: number; dose?: string } = { now: Date.now() };
    const dose = medDose.trim();
    if (dose) opts.dose = dose;
    const next = logMed(ep, name, opts);
    setEpisodes(replaceEpisode(next));
    closeMode();
  }

  function submitClose() {
    const ts = Date.now();
    const next = closeEpisode(ep, { now: ts });
    setEpisodes(replaceEpisode(next));
    closeMode();
  }

  function openDocModal() {
    try {
      const md = generateDoctorSummary(ep, {}, { now: Date.now() });
      if (!md) return;
      setDocModal({ md });
      setDocCopied(false);
    } catch {
      // generateDoctorSummary unavailable — silent
    }
  }

  // sparkline data
  const sparkPoints = (() => {
    if (sevLog.length === 0) return null;
    const W = 200, H = 40, padX = 10, padY = 8;
    const xs = sevLog.map((_, i) =>
      sevLog.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (sevLog.length - 1),
    );
    const ys = sevLog.map(
      (s) => padY + (1 - Math.max(0, Math.min(5, s.severity)) / 5) * (H - padY * 2),
    );
    return { xs, ys };
  })();

  const peakIdx = sparkPoints
    ? sevLog.reduce((best, s, i) => (s.severity > sevLog[best].severity ? i : best), 0)
    : 0;

  return (
    <>
      <section
        style={{
          marginBottom: 40,
          padding: 24,
          background: C.paper,
          border: `1px solid ${C.hairline}`,
          borderLeft: `2px solid ${C.water}`,
          borderRadius: 2,
        }}
      >
        <div style={{ ...labelStyle, paddingBottom: 14 }}>active episode</div>

        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontStyle: 'italic',
            fontSize: 'clamp(24px, 3vw, 30px)',
            color: C.ink,
            lineHeight: 1.1,
            paddingBottom: 6,
          }}
        >
          {ep.label || 'episode'}
        </div>

        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.22em',
            color: C.muted,
            textTransform: 'uppercase',
            paddingBottom: 18,
          }}
        >
          {dayLabel}
          {ep.kind && (
            <>
              <span style={{ color: C.faint, margin: '0 10px' }}>·</span>
              {ep.kind}
            </>
          )}
        </div>

        <div
          style={{
            fontFamily: "'Inter Tight', 'DM Sans', sans-serif",
            fontSize: 13,
            color: C.muted,
            lineHeight: 1.6,
            paddingBottom: 20,
          }}
        >
          {lastSev ? (
            <div>
              severity last logged: {lastSev.severity}/5
              {lastSev.note ? ` · ${lastSev.note}` : ''}
            </div>
          ) : (
            <div style={{ color: C.faint, fontStyle: 'italic' }}>
              no severity logged yet
            </div>
          )}
          {medNames ? (
            <div>meds taken: {medNames}</div>
          ) : (
            <div style={{ color: C.faint, fontStyle: 'italic' }}>no meds logged yet</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setMode(mode === 'severity' ? null : 'severity')}
            style={ghostBtnStyle(mode === 'severity')}
          >
            how i feel
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'med' ? null : 'med')}
            style={ghostBtnStyle(mode === 'med')}
          >
            meds
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'close' ? null : 'close')}
            style={ghostBtnStyle(mode === 'close')}
          >
            resolved
          </button>
        </div>

        {/* doctor summary */}
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: `1px solid ${C.hairline}`,
          }}
        >
          <button
            type="button"
            onClick={openDocModal}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'transparent',
              color: C.ink,
              border: `1px solid ${C.hairlineHi}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 2,
            }}
          >
            doctor summary · preview
          </button>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.18em',
              color: C.faint,
              textTransform: 'uppercase',
              paddingTop: 8,
              textAlign: 'center',
            }}
          >
            tldr · severity arc · meds · 7-day context
          </div>
        </div>

        {/* severity picker */}
        {mode === 'severity' && (
          <div
            style={{
              marginTop: 18,
              padding: 18,
              background: C.bg,
              border: `1px solid ${C.hairline}`,
              borderRadius: 2,
            }}
          >
            <div style={{ ...labelStyle, fontSize: 9, paddingBottom: 14 }}>
              how intense
            </div>
            <div style={{ display: 'flex', gap: 10, paddingBottom: 14 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSevPick(n)}
                  aria-label={`severity ${n}`}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: sevPick === n ? C.water : 'transparent',
                    color: sevPick === n ? C.bg : C.muted,
                    border: `1px solid ${sevPick === n ? C.water : C.hairlineHi}`,
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              style={inputStyle}
              value={sevNote}
              onChange={(e) => setSevNote(e.target.value)}
              placeholder="note (optional)"
            />
            <div style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
              <button
                type="button"
                onClick={submitSeverity}
                disabled={!sevPick}
                style={{
                  padding: '10px 18px',
                  background: sevPick ? C.ink : 'transparent',
                  color: sevPick ? C.bg : C.faint,
                  border: `1px solid ${sevPick ? C.ink : C.hairlineHi}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: sevPick ? 'pointer' : 'default',
                  borderRadius: 2,
                }}
              >
                save
              </button>
              <button
                type="button"
                onClick={closeMode}
                style={{
                  padding: '10px 14px',
                  background: 'transparent',
                  color: C.muted,
                  border: `1px solid ${C.hairlineHi}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                cancel
              </button>
            </div>
          </div>
        )}

        {/* med picker */}
        {mode === 'med' && (
          <div
            style={{
              marginTop: 18,
              padding: 18,
              background: C.bg,
              border: `1px solid ${C.hairline}`,
              borderRadius: 2,
            }}
          >
            <div style={{ ...labelStyle, fontSize: 9, paddingBottom: 14 }}>
              what did you take
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: 10,
                paddingBottom: 14,
              }}
            >
              <input
                style={inputStyle}
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                placeholder="med name · e.g. ibuprofen"
              />
              <input
                style={inputStyle}
                value={medDose}
                onChange={(e) => setMedDose(e.target.value)}
                placeholder="dose · optional"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={submitMed}
                disabled={!medName.trim()}
                style={{
                  padding: '10px 18px',
                  background: medName.trim() ? C.ink : 'transparent',
                  color: medName.trim() ? C.bg : C.faint,
                  border: `1px solid ${medName.trim() ? C.ink : C.hairlineHi}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: medName.trim() ? 'pointer' : 'default',
                  borderRadius: 2,
                }}
              >
                save
              </button>
              <button
                type="button"
                onClick={closeMode}
                style={{
                  padding: '10px 14px',
                  background: 'transparent',
                  color: C.muted,
                  border: `1px solid ${C.hairlineHi}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                cancel
              </button>
            </div>
          </div>
        )}

        {/* close confirm */}
        {mode === 'close' && (
          <div
            style={{
              marginTop: 18,
              padding: 18,
              background: C.bg,
              border: `1px solid ${C.hairline}`,
              borderRadius: 2,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: "'Inter Tight', sans-serif",
                fontSize: 14,
                color: C.ink,
                lineHeight: 1.5,
                paddingBottom: 16,
              }}
            >
              episode over? can't undo.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={submitClose}
                style={{
                  padding: '10px 22px',
                  background: C.ink,
                  color: C.bg,
                  border: `1px solid ${C.ink}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                yes, close
              </button>
              <button
                type="button"
                onClick={closeMode}
                style={{
                  padding: '10px 14px',
                  background: 'transparent',
                  color: C.muted,
                  border: `1px solid ${C.hairlineHi}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* doctor summary modal */}
      {docModal && (
        <>
          <div
            role="button"
            aria-label="close modal"
            tabIndex={0}
            onClick={() => setDocModal(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')
                setDocModal(null);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(20,20,15,0.30)',
              zIndex: 8000,
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#FCFAF5',
              border: '1px solid rgba(17,17,17,0.08)',
              borderRadius: 4,
              width: 'min(640px, 92vw)',
              maxHeight: '88vh',
              overflow: 'auto',
              zIndex: 8001,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {sparkPoints && (
              <div
                style={{
                  padding: '18px 28px',
                  borderBottom: '1px solid rgba(17,17,17,0.08)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 24,
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    letterSpacing: '0.20em',
                    textTransform: 'uppercase',
                    color: '#7C7770',
                    fontWeight: 500,
                  }}
                >
                  severity arc
                </div>
                <svg width="220" height="56" viewBox="0 0 220 56" preserveAspectRatio="none">
                  <line x1="0" y1="48" x2="220" y2="48" stroke="#7C7770" strokeWidth="0.5" />
                  {sparkPoints.xs.length > 1 && (
                    <polyline
                      points={sparkPoints.xs
                        .map((x, i) => `${x},${sparkPoints.ys[i]}`)
                        .join(' ')}
                      fill="none"
                      stroke="#7AA4B8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {sparkPoints.xs.map((x, i) => (
                    <circle key={i} cx={x} cy={sparkPoints.ys[i]} r="3" fill="#7AA4B8" />
                  ))}
                  <circle
                    cx={sparkPoints.xs[peakIdx]}
                    cy={sparkPoints.ys[peakIdx]}
                    r="6"
                    fill="none"
                    stroke="#A03E2A"
                    strokeWidth="1"
                  />
                  <text x="0" y="6" fontFamily="DM Mono" fontSize="7" fill="#7C7770">
                    5
                  </text>
                  <text x="0" y="52" fontFamily="DM Mono" fontSize="7" fill="#7C7770">
                    0
                  </text>
                </svg>
              </div>
            )}

            <div
              style={{
                padding: '16px 28px 22px',
                background: '#F2EEE4',
                borderTop: '1px solid rgba(17,17,17,0.08)',
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(docModal.md).then(
                      () => {
                        setDocCopied(true);
                        setTimeout(() => setDocCopied(false), 2400);
                      },
                      () => undefined,
                    );
                  }
                }}
                style={{
                  padding: '14px 16px',
                  background: docCopied ? '#4F6E5B' : '#14130F',
                  color: '#FCFAF5',
                  border: 'none',
                  borderRadius: 2,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'background 200ms ease',
                }}
              >
                {docCopied ? 'copied' : 'copy as markdown'}
              </button>
              <button
                type="button"
                onClick={() => setDocModal(null)}
                style={{
                  padding: '13px 16px',
                  background: 'transparent',
                  color: '#4B4740',
                  border: '1px solid rgba(17,17,17,0.18)',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.20em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                close
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── ChronicConditionsCard ─────────────────────────────────────────────────────

function ChronicConditionsCard() {
  const [settings, setSettings] = useStoreSlice<SharedSettings>('shared', 'settings', {});
  const [draft, setDraft] = useState('');

  const conditions: string[] = useMemo(
    () =>
      Array.isArray(settings?.chronic_conditions) ? (settings.chronic_conditions as string[]) : [],
    [settings],
  );

  function submit() {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (conditions.some((c) => typeof c === 'string' && c.toLowerCase().trim() === v)) {
      setDraft('');
      return;
    }
    setSettings({ ...settings, chronic_conditions: [...conditions, v] });
    setDraft('');
  }

  function remove(idx: number) {
    setSettings({
      ...settings,
      chronic_conditions: conditions.filter((_, i) => i !== idx),
    });
  }

  return (
    <section
      style={{
        marginBottom: 40,
        padding: '20px 22px',
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 14,
        }}
      >
        <div style={labelStyle}>chronic conditions</div>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.22em',
            color: C.faint,
            textTransform: 'uppercase',
          }}
        >
          {conditions.length === 0 ? 'optional' : `${conditions.length} tracked`}
        </div>
      </div>

      {conditions.length === 0 ? (
        <div
          style={{
            fontFamily: "'Inter Tight', sans-serif",
            fontSize: 14,
            color: C.muted,
            lineHeight: 1.55,
            fontStyle: 'italic',
            paddingBottom: 14,
          }}
        >
          recurring conditions? add them here and i'll auto-tag matching episodes as chronic. optional.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 14 }}>
          {conditions.map((c, i) => (
            <div
              key={`${c}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px 6px 12px',
                background: C.bg,
                border: `1px solid ${C.hairline}`,
                borderRadius: 999,
                fontFamily: "'Inter Tight', sans-serif",
                fontSize: 13,
                color: C.ink,
              }}
            >
              <span>{c}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`remove ${c}`}
                style={{
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: C.faint,
                  cursor: 'pointer',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 14,
                  lineHeight: 1,
                  minWidth: 18,
                  minHeight: 18,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. migraine, fibromyalgia, ibs"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          style={{
            padding: '10px 16px',
            background: 'transparent',
            color: draft.trim() ? C.ink : C.faint,
            border: `1px solid ${draft.trim() ? C.ink : C.hairlineHi}`,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: draft.trim() ? 'pointer' : 'default',
            borderRadius: 2,
            whiteSpace: 'nowrap',
          }}
        >
          + add
        </button>
      </div>
    </section>
  );
}

// ── TreatmentPlansCard ────────────────────────────────────────────────────────

function TreatmentPlansCard() {
  const [plans, setPlans] = useStoreSlice<TreatmentPlan[]>('body', 'treatment_plans', []);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [cycleLen, setCycleLen] = useState('21');
  const [totalCycles, setTotalCycles] = useState('6');

  const list = useMemo(() => (Array.isArray(plans) ? plans : []), [plans]);
  const now = Date.now();

  function submit() {
    const lbl = label.trim();
    if (!lbl) return;
    const cl = parseInt(cycleLen, 10);
    const tc = parseInt(totalCycles, 10);
    const plan = newTreatmentPlan(lbl, {
      cycle_length_days: isFinite(cl) && cl > 0 ? cl : 21,
      total_cycles: isFinite(tc) && tc > 0 ? tc : 6,
      now,
    });
    setPlans([...list, plan]);
    setLabel('');
    setCycleLen('21');
    setTotalCycles('6');
    setAddOpen(false);
  }

  function advanceCycle(id: string) {
    const idx = list.findIndex((p) => p && p.id === id);
    if (idx < 0) return;
    const next = addCycleStart(list[idx], now);
    const nextList = list.slice();
    nextList[idx] = next;
    setPlans(nextList);
  }

  function removePlan(id: string) {
    setPlans(list.filter((p) => p && p.id !== id));
  }

  return (
    <section
      style={{
        marginBottom: 40,
        padding: '20px 22px',
        background: C.paper,
        border: `1px solid ${C.hairline}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 14,
        }}
      >
        <div style={labelStyle}>treatment plans</div>
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.22em',
            color: C.faint,
            textTransform: 'uppercase',
          }}
        >
          {list.length === 0 ? 'optional' : `${list.length} active`}
        </div>
      </div>

      {list.length === 0 ? (
        <div
          style={{
            fontFamily: "'Inter Tight', sans-serif",
            fontSize: 14,
            color: C.muted,
            lineHeight: 1.55,
            fontStyle: 'italic',
            paddingBottom: 14,
          }}
        >
          cycle-based treatment? add it and i'll tag "cycle 3 of 6, day 5 post-event" automatically. optional.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 14 }}>
          {list.map((plan) => {
            const pos = cyclePosition(plan, now);
            return (
              <div
                key={plan.id}
                style={{
                  padding: '12px 14px',
                  background: C.bg,
                  border: `1px solid ${C.hairline}`,
                  borderLeft: `2px solid ${C.water}`,
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    color: C.ink,
                    textTransform: 'uppercase',
                    paddingBottom: 6,
                  }}
                >
                  {plan.label}
                </div>
                <div
                  style={{
                    fontFamily: "'Inter Tight', sans-serif",
                    fontSize: 13,
                    color: C.muted,
                    paddingBottom: 10,
                  }}
                >
                  {pos
                    ? `cycle ${pos.cycle_n} of ${pos.total} · day ${pos.day_of_cycle} post-event`
                    : 'treatment not yet started'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => advanceCycle(plan.id)}
                    style={{
                      padding: '8px 14px',
                      background: 'transparent',
                      color: C.muted,
                      border: `1px solid ${C.hairlineHi}`,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      letterSpacing: '0.20em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      borderRadius: 2,
                    }}
                  >
                    + next cycle
                  </button>
                  <button
                    type="button"
                    onClick={() => removePlan(plan.id)}
                    style={{
                      padding: '8px 14px',
                      background: 'transparent',
                      color: C.faint,
                      border: `1px solid ${C.hairlineHi}`,
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      letterSpacing: '0.20em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      borderRadius: 2,
                    }}
                  >
                    remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!addOpen ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            padding: '10px 16px',
            background: 'transparent',
            color: C.muted,
            border: `1px solid ${C.hairlineHi}`,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          + add plan
        </button>
      ) : (
        <div
          style={{
            padding: 14,
            background: C.bg,
            border: `1px solid ${C.hairline}`,
            borderRadius: 2,
            marginTop: 4,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr',
              gap: 10,
              paddingBottom: 12,
            }}
          >
            <input
              style={inputStyle}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="chemo · allergy · IVF"
            />
            <input
              style={inputStyle}
              type="number"
              value={cycleLen}
              onChange={(e) => setCycleLen(e.target.value)}
              placeholder="cycle length"
            />
            <input
              style={inputStyle}
              type="number"
              value={totalCycles}
              onChange={(e) => setTotalCycles(e.target.value)}
              placeholder="total cycles"
            />
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.18em',
              color: C.faint,
              textTransform: 'uppercase',
              paddingBottom: 12,
            }}
          >
            first cycle starts today
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={submit}
              disabled={!label.trim()}
              style={{
                padding: '10px 18px',
                background: label.trim() ? C.ink : 'transparent',
                color: label.trim() ? C.bg : C.faint,
                border: `1px solid ${label.trim() ? C.ink : C.hairlineHi}`,
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: label.trim() ? 'pointer' : 'default',
                borderRadius: 2,
              }}
            >
              save
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false);
                setLabel('');
              }}
              style={{
                padding: '10px 14px',
                background: 'transparent',
                color: C.muted,
                border: `1px solid ${C.hairlineHi}`,
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── BodyNoticed ───────────────────────────────────────────────────────────────

function BodyNoticed() {
  const [patterns] = useStoreSlice<AnyBodyPattern[]>('body', 'patterns', []);
  const list = useMemo(() => (Array.isArray(patterns) ? patterns : []), [patterns]);

  function fmtRange(r: { start: number | string; end: number | string } | undefined): string {
    if (!r || r.start == null || r.end == null) return '';
    const start = typeof r.start === 'string' ? Date.parse(r.start) : r.start;
    const end = typeof r.end === 'string' ? Date.parse(r.end) : r.end;
    const span = Math.round((end - start) / 86400000) + 1;
    return `${span} days of data`;
  }

  return (
    <section
      style={{ marginTop: 64, paddingTop: 28, borderTop: `1px solid ${C.hairline}` }}
    >
      <div style={{ ...labelStyle, paddingBottom: 20 }}>— noticed</div>
      {list.length === 0 ? (
        <div
          style={{
            fontFamily: "'Inter Tight', sans-serif",
            fontSize: 15,
            color: C.muted,
            lineHeight: 1.55,
            fontStyle: 'italic',
          }}
        >
          not enough data yet. keep dumping — patterns surface at about two weeks.
        </div>
      ) : (
        list.map((p) => {
          const dateRange =
            'date_range' in p
              ? (p.date_range as { start: number | string; end: number | string } | undefined)
              : undefined;
          const confidence = 'confidence' in p ? (p.confidence as string) : undefined;
          const r = 'r' in p ? (p.r as number) : undefined;
          const sources = 'sources' in p ? (p.sources as Array<{ url: string; citation: string }>) : undefined;
          const source = 'source' in p ? (p.source as { url?: string; citation?: string }) : undefined;
          const sourceUrls: string[] = [];
          if (sources && Array.isArray(sources)) {
            for (const s of sources.slice(0, 1)) {
              if (s?.url) sourceUrls.push(s.url);
            }
          } else if (source?.url) {
            sourceUrls.push(source.url);
          }

          return (
            <div
              key={p.pattern}
              style={{
                padding: '18px 20px',
                background: C.paper,
                borderLeft: `2px solid ${C.water}`,
                borderRadius: 2,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontFamily: "'Inter Tight', sans-serif",
                  fontSize: 16,
                  color: C.ink,
                  lineHeight: 1.55,
                }}
              >
                {p.copy}
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  color: C.faint,
                  textTransform: 'uppercase',
                  paddingTop: 10,
                  display: 'flex',
                  gap: 14,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {confidence && <span>{confidence} confidence</span>}
                {typeof r === 'number' && (
                  <>
                    <span>·</span>
                    <span>r = {r}</span>
                  </>
                )}
                {dateRange && (
                  <>
                    <span>·</span>
                    <span>{fmtRange(dateRange)}</span>
                  </>
                )}
                {sourceUrls.length > 0 && (
                  <>
                    <span>·</span>
                    <SourcesLink sources={sourceUrls} />
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

// ─── BodyModule — main export ─────────────────────────────────────────────────

export interface BodyModuleProps {
  onBack: () => void;
}

export function BodyModule({ onBack }: BodyModuleProps) {
  // ── store slices ────────────────────────────────────────────────────────────
  const [sharedSettings] = useStoreSlice<SharedSettings>('shared', 'settings', {});
  const ageDefaultWater = useMemo(() => {
    const a = sharedSettings?.age_range ?? '';
    if (a === '18-25' || a === '26-35') return 6;
    if (a === '36-45' || a === '46-55') return 7;
    return 8;
  }, [sharedSettings]);

  const [waterTarget, setWaterTarget] = useStoreSlice<number>('body', 'water_target', ageDefaultWater);
  const [waterLog, setWaterLog] = useStoreSlice<number[]>('body', 'water_log', []);
  const [supps, setSupps] = useStoreSlice<Supplement[]>('body', 'supplements', []);
  const [suppChecks, setSuppChecks] = useStoreSlice<Record<string, Record<string, boolean>>>(
    'body',
    'supp_checks',
    {},
  );
  const [addSuppOpen, setAddSuppOpen] = useState(false);
  const [newSuppName, setNewSuppName] = useState('');
  const [newSuppDose, setNewSuppDose] = useState('');

  // ── derived ─────────────────────────────────────────────────────────────────
  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayWater = useMemo(
    () =>
      (Array.isArray(waterLog) ? waterLog : []).filter((ts) => {
        const d = new Date(ts);
        return d.toISOString().slice(0, 10) === todayKey;
      }),
    [waterLog, todayKey],
  );

  const waterCount = todayWater.length;
  const target = Math.max(1, Math.min(16, waterTarget || 8));

  const todayChecks = useMemo(
    () => (suppChecks[todayKey] as Record<string, boolean>) ?? {},
    [suppChecks, todayKey],
  );

  const allTakenToday = useMemo(
    () => supps.length > 0 && supps.every((s) => s && todayChecks[s.id]),
    [supps, todayChecks],
  );

  // ── handlers ────────────────────────────────────────────────────────────────
  function addGlass() {
    setWaterLog([...(Array.isArray(waterLog) ? waterLog : []), Date.now()]);
  }

  function removeGlass() {
    if (todayWater.length === 0) return;
    const lastTs = todayWater[todayWater.length - 1];
    setWaterLog((Array.isArray(waterLog) ? waterLog : []).filter((ts) => ts !== lastTs));
  }

  function toggleSupp(id: string) {
    const curr = todayChecks[id];
    setSuppChecks({
      ...suppChecks,
      [todayKey]: { ...todayChecks, [id]: !curr },
    });
  }

  function addSupp() {
    const n = newSuppName.trim();
    if (!n) return;
    const s: Supplement = {
      id: 'sup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: n,
      dose: newSuppDose.trim() || null,
      added_at: Date.now(),
    };
    setSupps([...(Array.isArray(supps) ? supps : []), s]);
    setNewSuppName('');
    setNewSuppDose('');
    setAddSuppOpen(false);
  }

  function removeSupp(id: string) {
    setSupps((Array.isArray(supps) ? supps : []).filter((s) => s && s.id !== id));
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: C.bg,
        color: C.ink,
        fontFamily: "'Inter Tight', 'DM Sans', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0 auto',
          padding: '44px clamp(24px, 5vw, 56px) 120px',
          boxSizing: 'border-box',
        }}
      >
        {/* nav bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingBottom: 52,
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.24em',
            color: C.muted,
            textTransform: 'uppercase',
          }}
        >
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: C.muted,
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: 0,
              minHeight: 44,
              minWidth: 44,
            }}
          >
            ← dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span>
              ollie{' '}
              <span style={{ color: C.faint, margin: '0 10px' }}>/</span>{' '}
              <span style={{ color: C.ink }}>body</span>
            </span>
            <ModuleHelp moduleId="body" />
          </div>
        </div>

        {/* heading */}
        <div
          style={{
            paddingBottom: 20,
            borderBottom: `1px solid ${C.hairline}`,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 'clamp(34px, 4vw, 46px)',
              color: C.ink,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            body.
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontStyle: 'italic',
              fontSize: 'clamp(16px, 1.5vw, 18px)',
              color: C.muted,
              paddingTop: 10,
            }}
          >
            hydrate. take your stuff. rest when you need to.
          </div>
        </div>

        {/* active episode (conditional) */}
        <ActiveEpisodeCard />

        {/* cross-module signals */}
        <SignalsSection />

        {/* chronic conditions */}
        <ChronicConditionsCard />

        {/* treatment plans */}
        <TreatmentPlansCard />

        {/* WATER */}
        <section style={{ paddingBottom: 64 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 24,
            }}
          >
            <div style={labelStyle}>
              water{' '}
              <span style={{ color: C.faint, margin: '0 10px' }}>·</span> today
            </div>
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                color: waterCount >= target ? C.water : C.faint,
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              {waterCount} / {target}
              {waterCount >= target ? ' · done' : ''}
            </div>
          </div>

          {/* glass row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingBottom: 20 }}>
            {Array.from({ length: target }).map((_, i) => {
              const filled = i < waterCount;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (filled && i === waterCount - 1) removeGlass();
                    else addGlass();
                  }}
                  aria-label={`glass ${i + 1}`}
                  style={{
                    width: 48,
                    height: 64,
                    padding: 0,
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    minWidth: 44,
                    minHeight: 44,
                  }}
                >
                  <svg viewBox="0 0 40 56" width="40" height="56" aria-hidden="true">
                    <path
                      d="M 6 6 L 34 6 L 30 52 L 10 52 Z"
                      fill={filled ? C.water : 'none'}
                      stroke={filled ? C.water : C.hairlineHi}
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>

          <div
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <button
              type="button"
              onClick={addGlass}
              style={{
                padding: '12px 22px',
                background: C.ink,
                color: C.bg,
                border: `1px solid ${C.ink}`,
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
                minHeight: 44,
              }}
            >
              + glass
            </button>
            <button
              type="button"
              onClick={removeGlass}
              disabled={waterCount === 0}
              style={{
                padding: '12px 18px',
                background: 'transparent',
                color: waterCount ? C.muted : C.faint,
                border: `1px solid ${waterCount ? C.hairlineHi : C.hairline}`,
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: waterCount ? 'pointer' : 'default',
                borderRadius: 2,
                minHeight: 44,
              }}
            >
              undo
            </button>
            <div style={{ ...labelStyle, marginLeft: 8, fontSize: 9 }}>target</div>
            {[6, 8, 10, 12].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setWaterTarget(t)}
                style={{
                  padding: '8px 10px',
                  background: target === t ? C.water : 'transparent',
                  color: target === t ? C.bg : C.muted,
                  border: `1px solid ${target === t ? C.water : C.hairline}`,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  cursor: 'pointer',
                  borderRadius: 2,
                  minWidth: 36,
                  minHeight: 36,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* SUPPLEMENTS */}
        <section
          style={{
            paddingBottom: 64,
            borderTop: `1px solid ${C.hairline}`,
            paddingTop: 40,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 24,
            }}
          >
            <div style={labelStyle}>
              supplements{' '}
              <span style={{ color: C.faint, margin: '0 10px' }}>·</span> today
            </div>
            <button
              type="button"
              onClick={() => setAddSuppOpen((o) => !o)}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: addSuppOpen ? C.ink : C.muted,
                border: `1px solid ${C.hairlineHi}`,
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
                minHeight: 44,
              }}
            >
              {addSuppOpen ? 'close' : '+ add'}
            </button>
          </div>

          {addSuppOpen && (
            <div
              style={{
                padding: 22,
                background: C.paper,
                border: `1px solid ${C.hairline}`,
                borderRadius: 2,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <input
                  style={inputStyle}
                  value={newSuppName}
                  onChange={(e) => setNewSuppName(e.target.value)}
                  placeholder="name · e.g. vitamin d"
                />
                <input
                  style={inputStyle}
                  value={newSuppDose}
                  onChange={(e) => setNewSuppDose(e.target.value)}
                  placeholder="dose · optional"
                />
                <button
                  type="button"
                  onClick={addSupp}
                  disabled={!newSuppName.trim()}
                  style={{
                    padding: '11px 18px',
                    background: newSuppName.trim() ? C.ink : 'transparent',
                    color: newSuppName.trim() ? C.bg : C.faint,
                    border: `1px solid ${newSuppName.trim() ? C.ink : C.hairlineHi}`,
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: newSuppName.trim() ? 'pointer' : 'default',
                    borderRadius: 2,
                    whiteSpace: 'nowrap',
                    minHeight: 44,
                  }}
                >
                  add
                </button>
              </div>
            </div>
          )}

          {supps.length === 0 && !addSuppOpen && (
            <div
              style={{
                padding: '16px 0',
                fontFamily: "'DM Serif Display', serif",
                fontSize: 'clamp(18px, 2vw, 22px)',
                fontStyle: 'italic',
                color: C.muted,
                lineHeight: 1.4,
                maxWidth: 520,
              }}
            >
              no supplements yet. add what you take.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {supps.map((s) => {
              if (!s) return null;
              const taken = !!todayChecks[s.id];
              return (
                <div
                  key={s.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: `1px solid ${C.hairline}`,
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 14,
                    alignItems: 'center',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSupp(s.id)}
                    aria-label={`toggle ${s.name}`}
                    style={{
                      width: 28,
                      height: 28,
                      padding: 0,
                      background: 'transparent',
                      border: `1.5px solid ${taken ? C.water : C.hairlineHi}`,
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 28,
                      minHeight: 28,
                    }}
                  >
                    {taken && (
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                        <path
                          d="M 3 8 L 7 12 L 13 4"
                          fill="none"
                          stroke={C.water}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  <div>
                    <div
                      style={{
                        fontFamily: "'Inter Tight', sans-serif",
                        fontSize: 17,
                        fontWeight: 500,
                        color: taken ? C.muted : C.ink,
                        textDecoration: taken ? 'line-through' : 'none',
                        textDecorationThickness: '1px',
                        textDecorationColor: C.faint,
                      }}
                    >
                      {s.name}
                    </div>
                    {s.dose && (
                      <div
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.2em',
                          color: C.faint,
                          textTransform: 'uppercase',
                          paddingTop: 4,
                          fontWeight: 500,
                        }}
                      >
                        {s.dose}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSupp(s.id)}
                    style={{
                      padding: '6px 10px',
                      background: 'transparent',
                      color: C.faint,
                      border: 'none',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      minHeight: 44,
                    }}
                  >
                    remove
                  </button>
                </div>
              );
            })}
          </div>

          {supps.length > 0 && allTakenToday && (
            <div
              style={{
                paddingTop: 20,
                fontFamily: "'Inter Tight', sans-serif",
                fontStyle: 'italic',
                fontSize: 14,
                color: C.water,
                fontWeight: 500,
              }}
            >
              all taken. keep it up.
            </div>
          )}
        </section>

        {/* noticed patterns */}
        <BodyNoticed />

        {/* footer */}
        <div
          style={{
            marginTop: 48,
            paddingTop: 28,
            borderTop: `1px solid ${C.hairline}`,
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.36em',
            color: C.faint,
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          ollie{' '}
          <span style={{ color: C.muted, margin: '0 10px' }}>·</span> body{' '}
          <span style={{ color: C.muted, margin: '0 10px' }}>·</span> mmxxvi
        </div>
      </div>
    </div>
  );
}
