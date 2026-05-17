/**
 * EpworthSurvey — the "go deeper" daytime-sleepiness instrument.
 *
 * Serra decision 2026-05-18: the second "go deeper" survey, alongside the
 * insomnia check. The Epworth Sleepiness Scale (ESS) measures DAYTIME
 * sleepiness — the one read Ollie can't derive from logged nights (those
 * describe the night; the ESS describes the waking day). The eight
 * situations and the 0–24 scoring live in @ollie/logic/sleep (epworth.ts);
 * this component is pure UI: present one situation at a time, collect a
 * 0–3 option index each, write the raw answer array to the store, and
 * read the orchestrator-scored result back.
 *
 * Wire:
 *   - On completion, writes the 8-element answer array to
 *     `sleep.epworth_answers`. The sleep orchestrator subscribes, runs
 *     scoreEpworth, and writes `sleep.epworth_result`.
 *   - This component reads `sleep.epworth_result` and shows a plain,
 *     non-judgmental result once it appears.
 *
 * Tone (sleep-module DNA): no scoring theatre, no streak, no exclamation,
 * one restrained sage/ochre ink. A result is information, not a verdict.
 *
 * Copy is English inline (matches InsomniaSurvey + SleepModule). ES
 * survey strings are a tracked follow-up.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  EPWORTH_QUESTIONS,
  EPWORTH_OPTIONS,
  EPWORTH_LENGTH,
} from '@ollie/logic/sleep';
import type {
  EpworthResult,
  EpworthSleepinessBand,
} from '@ollie/logic/sleep';
import { useStoreSlice } from '../../store';

// ─── palette (mirrors SleepModule C tokens) ──────────────────────────────────

const C = {
  bone:      '#F2EEE4',
  ink:       '#14130F',
  inkSoft:   '#4B4740',
  inkFaint:  '#7C7770',
  inkGhost:  '#C8C4BA',
  rule:      'rgba(20,19,15,0.10)',
  ruleSoft:  'rgba(20,19,15,0.06)',
  accent:    '#4F6E5B',     // sage
  warn:      '#B89556',     // ochre — the single restrained severity ink
} as const;

const COURIER = "'Courier New', Courier, monospace";

// ─── result copy (non-judgmental, observation-only) ──────────────────────────

interface BandMeta {
  /** Short plain label shown next to the score. Lowercase, no clinical jargon. */
  label: string;
  /** One quiet line. Information, never a verdict. */
  line: string;
  /** Restrained ink — ink for low, ochre for higher. Never red. */
  accent: string;
}

const BAND_META: Record<EpworthSleepinessBand, BandMeta> = {
  normal: {
    label: 'awake through the day',
    line: 'your daytime sleepiness sits in the usual range. nothing here points to a problem.',
    accent: C.accent,
  },
  mild: {
    label: 'a little daytime drag',
    line: "you're nodding off a bit more than average. worth noting — especially if nights have been short lately.",
    accent: C.ink,
  },
  moderate: {
    label: 'noticeable daytime sleepiness',
    line: "you're dozing off through the day more than is typical. if this holds, it's worth a conversation with a doctor.",
    accent: C.warn,
  },
  high: {
    label: 'heavy daytime sleepiness',
    line: "falling asleep through the day this easily is worth taking seriously. a doctor can help find what's behind it.",
    accent: C.warn,
  },
};

// ─── component ───────────────────────────────────────────────────────────────

export interface EpworthSurveyProps {
  /** Close the survey overlay. */
  onClose: () => void;
}

type Phase = 'intro' | 'question' | 'result';

export function EpworthSurvey({ onClose }: EpworthSurveyProps): React.ReactElement {
  // Raw answers the orchestrator scores. -1 = unanswered.
  const [, setStoredAnswers] = useStoreSlice<number[] | null>(
    'sleep',
    'epworth_answers',
    null,
  );
  // Orchestrator-scored result. Read-only here.
  const [result] = useStoreSlice<EpworthResult | null>(
    'sleep',
    'epworth_result',
    null,
  );

  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  // Local working copy — filled with -1 (unanswered) sentinels.
  const [answers, setAnswers] = useState<number[]>(
    () => new Array(EPWORTH_LENGTH).fill(-1),
  );

  const questions = EPWORTH_QUESTIONS;
  const current = questions[index];
  const isLast = index === questions.length - 1;

  const answeredCount = useMemo(
    () => answers.filter((a) => a >= 0).length,
    [answers],
  );

  // Choosing an option records the score and advances. On the last
  // question it commits the array to the store for the orchestrator.
  const choose = useCallback(
    (optionIndex: number) => {
      const next = answers.slice();
      next[index] = optionIndex;
      setAnswers(next);
      if (isLast) {
        // Defensive: only commit a fully-answered array. The flow gates
        // sequential answering, so this is always true here.
        if (next.every((a) => a >= 0 && a <= 3)) {
          setStoredAnswers(next);
        }
        setPhase('result');
      } else {
        setIndex((i) => i + 1);
      }
    },
    [answers, index, isLast, setStoredAnswers],
  );

  const goBack = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const band: BandMeta | null = result ? BAND_META[result.band] : null;

  return (
    <>
      {/* backdrop */}
      <div
        role="button"
        aria-label="close survey"
        tabIndex={0}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') onClose();
        }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,15,0.20)', zIndex: 100 }}
      />

      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="daytime sleepiness survey"
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          background: C.bone, border: `1px solid ${C.rule}`, padding: '36px 40px',
          width: 'min(560px, 92vw)', maxHeight: '86vh', overflowY: 'auto', zIndex: 110,
          boxShadow: '0 32px 80px rgba(20,20,15,0.10)',
          fontFamily: COURIER, color: C.ink, fontWeight: 700,
        }}
      >
        {/* ── intro ── */}
        {phase === 'intro' && (
          <>
            <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 10 }}>
              go deeper · daytime sleepiness
            </div>
            <div style={{ fontSize: 22, lineHeight: 1.35, color: C.ink, marginBottom: 14 }}>
              eight everyday situations.
            </div>
            <div style={{ fontSize: 14, color: C.inkSoft, fontWeight: 400, fontStyle: 'italic', lineHeight: 1.6, marginBottom: 28 }}>
              for each one — how likely are you to doze off? not just feel
              tired, actually fall asleep. this is a short, well-worn
              questionnaire, not a diagnosis. it takes about a minute.
            </div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                style={btnGhost}
              >
                not now
              </button>
              <button
                type="button"
                onClick={() => setPhase('question')}
                style={btnAccent}
              >
                begin
              </button>
            </div>
          </>
        )}

        {/* ── question ── */}
        {phase === 'question' && (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              marginBottom: 22,
            }}>
              <span style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft }}>
                question {index + 1} of {questions.length}
              </span>
              <span style={{ fontSize: 11, letterSpacing: '0.14em', color: C.inkGhost, fontWeight: 400 }}>
                {answeredCount}/{questions.length} answered
              </span>
            </div>

            {/* progress hairline */}
            <div
              aria-hidden="true"
              style={{ height: 2, background: C.ruleSoft, marginBottom: 24, position: 'relative' }}
            >
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${((index + 1) / questions.length) * 100}%`,
                background: C.accent, transition: 'width 240ms ease-out',
              }} />
            </div>

            <div style={{ fontSize: 13, letterSpacing: '0.06em', color: C.inkFaint, fontWeight: 400, marginBottom: 8 }}>
              how likely are you to doze off —
            </div>
            <div style={{ fontSize: 18, lineHeight: 1.4, color: C.ink, marginBottom: 22 }}>
              {current.prompt}
            </div>

            <div role="radiogroup" aria-label={current.prompt} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {EPWORTH_OPTIONS.map((opt, optIdx) => {
                const selected = answers[index] === optIdx;
                return (
                  <button
                    key={current.id + ':' + optIdx}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(optIdx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: 'none', border: 'none',
                      borderBottom: optIdx === EPWORTH_OPTIONS.length - 1 ? 'none' : `1px solid ${C.ruleSoft}`,
                      padding: '15px 4px', cursor: 'pointer', textAlign: 'left',
                      fontFamily: COURIER, width: '100%',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 18, height: 18, flexShrink: 0, borderRadius: '50%',
                        border: `1.5px solid ${selected ? C.accent : C.rule}`,
                        background: selected ? C.accent : 'transparent',
                      }}
                    />
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 26 }}>
              <button
                type="button"
                onClick={index === 0 ? onClose : goBack}
                style={btnGhost}
              >
                {index === 0 ? 'cancel' : 'back'}
              </button>
              <span style={{ fontSize: 11, fontStyle: 'italic', fontWeight: 400, color: C.inkFaint }}>
                pick one to continue
              </span>
            </div>
          </>
        )}

        {/* ── result ── */}
        {phase === 'result' && (
          <>
            <div style={{ fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase', color: C.inkSoft, marginBottom: 14 }}>
              what the answers say
            </div>

            {result && band ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 'clamp(48px, 8vw, 72px)', lineHeight: 0.9,
                    color: band.accent, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {result.score}
                  </span>
                  <span style={{ fontSize: 14, color: C.inkSoft, fontWeight: 400 }}>
                    of 24
                  </span>
                </div>
                <div style={{ fontSize: 18, color: band.accent, marginBottom: 14 }}>
                  {band.label}
                </div>
                <div style={{
                  fontSize: 14, color: C.inkSoft, fontWeight: 400, fontStyle: 'italic',
                  lineHeight: 1.6, paddingTop: 14, borderTop: `1px solid ${C.rule}`,
                }}>
                  {band.line}
                </div>
                <div style={{ fontSize: 12, color: C.inkFaint, fontWeight: 400, marginTop: 16, lineHeight: 1.55 }}>
                  a number is not a verdict. it is one snapshot of how things
                  have been lately — retake it whenever you want a fresh read.
                </div>
              </>
            ) : (
              // Result not yet written by the orchestrator — brief settle state.
              <div style={{ fontSize: 14, color: C.inkSoft, fontWeight: 400, fontStyle: 'italic', lineHeight: 1.6, padding: '20px 0' }}>
                answers recorded. ollie is reading them — this closes itself out
                in a moment.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
              <button type="button" onClick={onClose} style={btnAccent}>
                done
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── shared button styles ────────────────────────────────────────────────────

const btnGhost: React.CSSProperties = {
  background: 'none', border: 'none', padding: '4px 0', fontFamily: COURIER,
  cursor: 'pointer', fontSize: 13, letterSpacing: '0.08em', color: C.ink,
  fontWeight: 700, textTransform: 'lowercase', borderBottom: `1px solid ${C.rule}`,
};

const btnAccent: React.CSSProperties = {
  background: 'none', border: 'none', padding: '4px 0', fontFamily: COURIER,
  cursor: 'pointer', fontSize: 13, letterSpacing: '0.08em', color: C.accent,
  fontWeight: 700, textTransform: 'lowercase', borderBottom: `2px solid ${C.accent}`,
};
