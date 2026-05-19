/**
 * money-v2 · ShoppingCheckScreen — the BSAS survey (money-shopping-check.html)
 *
 * One thing: one survey question. Mirrors onboarding's shape — one glyph,
 * one sentence, the 0-4 Likert as a calm column of taps. Progress dots
 * top-left, a quiet skip top-right; the survey is never pushed.
 *
 * Real data: the 7 verbatim BSAS items come from the live
 * `BSAS_ITEMS` (Bergen Shopping Addiction Scale, cited). On completion
 * `scoreBSAS` produces the real result; the preview surfaces a calm
 * summary line rather than persisting to the scale history (the live
 * module owns `recordScaleResult` + the history slice — see report).
 */
import { useState } from 'react';
import { BSAS_ITEMS, scoreBSAS } from '@ollie/logic/finance';
import { IconBag, v2 } from '../v2';

export interface ShoppingCheckScreenProps {
  onBack: () => void;
}

const LIKERT = ['never', 'rarely', 'sometimes', 'often', 'very often'];

export function ShoppingCheckScreen({ onBack }: ShoppingCheckScreenProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);

  const item = BSAS_ITEMS[step];
  const result = answers.length === BSAS_ITEMS.length ? scoreBSAS(answers) : null;

  function choose(value: number) {
    const next = [...answers];
    next[step] = value;
    setAnswers(next);
    if (step < BSAS_ITEMS.length - 1) {
      setStep(step + 1);
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        boxSizing: 'border-box',
      }}
    >
      {/* swipe handle */}
      <div
        style={{ height: 24, display: 'flex', justifyContent: 'center', paddingTop: 12 }}
        aria-hidden
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
      </div>

      {/* progress dots */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          left: 24,
          display: 'flex',
          gap: 6,
        }}
        aria-label={`question ${step + 1} of ${BSAS_ITEMS.length}`}
      >
        {BSAS_ITEMS.map((it, i) => (
          <span
            key={it.id}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: i <= step ? v2.ink : v2.line,
              display: 'block',
            }}
          />
        ))}
      </div>

      {/* skip */}
      <button
        type="button"
        onClick={onBack}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          right: 24,
          background: 'transparent',
          border: 'none',
          fontSize: 14,
          color: v2.mute,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        skip
      </button>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 42px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          boxSizing: 'border-box',
        }}
      >
        {result ? (
          <div style={{ textAlign: 'center', maxWidth: 290 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: v2.tile,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}
            >
              <IconBag stroke={v2.sage} />
            </div>
            <div
              style={{
                fontSize: 20,
                color: v2.ink,
                fontWeight: 400,
                lineHeight: 1.42,
                letterSpacing: '-0.012em',
              }}
            >
              {result.category === 'at_risk_screen'
                ? 'a few of these landed. worth a quiet look — not a verdict.'
                : 'nothing here stands out. that’s good to have seen.'}
            </div>
            <div style={{ marginTop: 22, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
              score {result.score} of {result.max_score}
            </div>
            <button
              type="button"
              onClick={onBack}
              style={{
                marginTop: 28,
                background: 'transparent',
                border: `1px solid ${v2.line}`,
                borderRadius: 26,
                height: 50,
                padding: '0 28px',
                fontSize: 16,
                fontWeight: 600,
                color: v2.ink,
                cursor: 'pointer',
              }}
            >
              done
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: v2.tile,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 32,
              }}
            >
              <IconBag stroke={v2.sage} />
            </div>
            <div
              style={{
                fontSize: 12,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.05em',
                marginBottom: 14,
              }}
            >
              over the last year
            </div>
            <div
              style={{
                fontSize: 23,
                lineHeight: 1.42,
                color: v2.ink,
                textAlign: 'center',
                letterSpacing: '-0.012em',
                fontWeight: 400,
                marginBottom: 34,
                maxWidth: 290,
              }}
            >
              {item.text}
            </div>

            <div
              style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}
            >
              {LIKERT.map((label, value) => {
                const on = answers[step] === value;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => choose(value)}
                    aria-pressed={on}
                    style={{
                      boxSizing: 'border-box',
                      height: 52,
                      borderRadius: 16,
                      border: `1px solid ${on ? v2.accent : v2.line}`,
                      background: on ? '#FCF6EA' : v2.card,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 20px',
                      boxShadow: '0 6px 16px rgba(42,38,34,.04)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span
                      style={{ fontSize: 16, color: v2.ink, fontWeight: on ? 600 : 400 }}
                    >
                      {label}
                    </span>
                    <span
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: `1.8px solid ${on ? v2.accent : v2.line}`,
                        background: on ? v2.accent : 'transparent',
                        boxShadow: on ? 'inset 0 0 0 3px #fff' : undefined,
                        marginLeft: 'auto',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
