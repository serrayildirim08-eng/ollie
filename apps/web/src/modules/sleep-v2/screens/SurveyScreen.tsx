/**
 * sleep-v2 · SurveyScreen — go deeper (sleep-survey.html)
 *
 * The two "go deeper" check-ins. A calm three-phase flow:
 *   1. pick   — the two check-ins, each with its last score if taken
 *   2. ask    — one question per screen, a Likert column, tiny progress
 *               dots, a calm "skip" exit (the survey is never pushed)
 *   3. result — a screen-only scored number, a 4-segment severity band,
 *               a plain reading, a source tag, a screen-only disclaimer
 *
 * Real data: the questions + scoring are the SAME `@ollie/logic/sleep`
 * instruments the live `InsomniaSurvey` / `EpworthSurvey` use. A finished
 * survey is persisted (answers + scored result) through
 * `useSleepActions.submitInsomnia` / `submitEpworth` — visible to the
 * live module. CLINICAL TONE: calm, sourced, never alarmist; sage + ink,
 * never red.
 */
import { useMemo, useState } from 'react';
import {
  INSOMNIA_SURVEY_QUESTIONS,
  EPWORTH_QUESTIONS,
  EPWORTH_OPTIONS,
  type InsomniaSurveyResult,
  type EpworthResult,
} from '@ollie/logic/sleep';
import { Screen, IconMoon, IconInfo, v2 } from '../../money-v2/v2';
import { useSleepSlices } from '../useSleepSlices';
import { useSleepActions } from '../useSleepActions';
import {
  INSOMNIA_BANDS,
  insomniaBandIndex,
  insomniaBandReading,
} from '../selectors';

export interface SurveyScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

type Which = 'insomnia' | 'epworth';
type Phase = 'pick' | 'ask' | 'result';

interface SurveyDef {
  which: Which;
  title: string;
  intro: string;
  /** the prompts, in order */
  prompts: string[];
  /** the option labels per question (same list for every question) */
  optionsFor: (qIndex: number) => readonly string[];
  /** max possible score */
  max: number;
  source: string;
}

const INSOMNIA_DEF: SurveyDef = {
  which: 'insomnia',
  title: 'insomnia check',
  intro: 'a calm read, just for you',
  prompts: INSOMNIA_SURVEY_QUESTIONS.map((q) => q.prompt.toLowerCase()),
  optionsFor: (i) => INSOMNIA_SURVEY_QUESTIONS[i].options,
  max: 28,
  source: 'insomnia severity index',
};

const EPWORTH_DEF: SurveyDef = {
  which: 'epworth',
  title: 'daytime sleepiness',
  intro: 'how likely you are to doze, situation by situation',
  prompts: EPWORTH_QUESTIONS.map((q) => q.prompt.toLowerCase()),
  optionsFor: () => EPWORTH_OPTIONS,
  max: 24,
  source: 'epworth sleepiness scale',
};

const DEFS: Record<Which, SurveyDef> = {
  insomnia: INSOMNIA_DEF,
  epworth: EPWORTH_DEF,
};

export function SurveyScreen({ now, onBack, onSafe }: SurveyScreenProps) {
  const slices = useSleepSlices();
  const actions = useSleepActions(now);

  const [phase, setPhase] = useState<Phase>('pick');
  const [which, setWhich] = useState<Which>('insomnia');
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [insomniaScore, setInsomniaScore] = useState<InsomniaSurveyResult | null>(null);
  const [epworthScore, setEpworthScore] = useState<EpworthResult | null>(null);

  const def = DEFS[which];

  function startSurvey(w: Which) {
    setWhich(w);
    setQIndex(0);
    setAnswers([]);
    setPhase('ask');
  }

  function choose(optionIndex: number) {
    const next = answers.slice();
    next[qIndex] = optionIndex;
    setAnswers(next);
    if (qIndex < def.prompts.length - 1) {
      setQIndex((i) => i + 1);
      return;
    }
    // last question — score + persist through the real logic
    if (which === 'insomnia') {
      const r = actions.submitInsomnia(next);
      setInsomniaScore(r);
    } else {
      const r = actions.submitEpworth(next);
      setEpworthScore(r);
    }
    setPhase('result');
  }

  // ── PHASE: pick ──────────────────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <Screen
        label="go deeper"
        glyph={<IconMoon stroke={v2.accent} />}
        onBack={onBack}
        onSafe={onSafe}
        scroll
        contentStyle={{ paddingTop: 0 }}
      >
        <div
          style={{
            marginTop: 44,
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
          }}
        >
          <b style={{ fontWeight: 500 }}>two short check-ins</b>
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
          calm, one question per screen. the result stays here for you &mdash; it
          is never sent as a notification.
        </div>

        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column' }}>
          <CheckInRow
            title="insomnia check"
            sub={
              slices.insomniaResult
                ? `last score ${slices.insomniaResult.score}/28 · retake`
                : '7 questions · about 2 min'
            }
            onStart={() => startSurvey('insomnia')}
          />
          <CheckInRow
            last
            title="daytime sleepiness"
            sub={
              slices.epworthResult
                ? `last score ${slices.epworthResult.score}/24 · retake`
                : '8 questions · about 1 min'
            }
            onStart={() => startSurvey('epworth')}
          />
        </div>

        <Disclaimer />
      </Screen>
    );
  }

  // ── PHASE: ask ───────────────────────────────────────────────────────────
  if (phase === 'ask') {
    return (
      <AskScreen
        def={def}
        qIndex={qIndex}
        chosen={answers[qIndex]}
        onChoose={choose}
        onBack={onBack}
        onSkip={onBack}
      />
    );
  }

  // ── PHASE: result ────────────────────────────────────────────────────────
  return (
    <ResultScreen
      def={def}
      insomniaScore={insomniaScore}
      epworthScore={epworthScore}
      onBack={onBack}
      onSafe={onSafe}
      onRetake={() => startSurvey(which)}
    />
  );
}

// ─── pick row ────────────────────────────────────────────────────────────────

interface CheckInRowProps {
  title: string;
  sub: string;
  onStart: () => void;
  last?: boolean;
}

function CheckInRow({ title, sub, onStart, last }: CheckInRowProps) {
  return (
    <button
      type="button"
      onClick={onStart}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '18px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 15, color: v2.ink, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {title}
        </span>
        <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500 }}>{sub}</span>
      </span>
      <span style={{ fontSize: 12, color: v2.accent, fontWeight: 600, letterSpacing: '0.02em' }}>
        start &rsaquo;
      </span>
    </button>
  );
}

// ─── ask screen ──────────────────────────────────────────────────────────────

interface AskScreenProps {
  def: SurveyDef;
  qIndex: number;
  chosen: number | undefined;
  onChoose: (optionIndex: number) => void;
  onBack: () => void;
  onSkip: () => void;
}

function AskScreen({ def, qIndex, chosen, onChoose, onBack, onSkip }: AskScreenProps) {
  const total = def.prompts.length;
  const options = def.optionsFor(qIndex);

  return (
    <Screen label={def.title} onBack={onBack} centered contentStyle={{ paddingTop: 0 }}>
      {/* progress dots — top-left */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 22px)',
          left: 'calc(env(safe-area-inset-left, 0px) + 64px)',
          display: 'flex',
          gap: 6,
        }}
        aria-hidden
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: i <= qIndex ? v2.ink : v2.line,
            }}
          />
        ))}
      </div>
      {/* skip — top-right, calm exit */}
      <button
        type="button"
        onClick={onSkip}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 18px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 64px)',
          background: 'transparent',
          border: 'none',
          fontSize: 14,
          color: v2.mute,
          fontWeight: 500,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
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
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
        }}
      >
        {/* the survey glyph */}
        <span
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
          <IconMoon size={24} stroke={v2.sage} />
        </span>

        <div
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.05em',
            marginBottom: 14,
          }}
        >
          question {qIndex + 1} of {total}
        </div>
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.42,
            color: v2.ink,
            textAlign: 'center',
            letterSpacing: '-0.012em',
            fontWeight: 400,
            marginBottom: 32,
          }}
        >
          {def.prompts[qIndex]}
        </div>

        {/* the Likert as a calm column */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((label, i) => {
            const on = chosen === i;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => onChoose(i)}
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
                  style={{
                    fontSize: 16,
                    color: v2.ink,
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {label}
                </span>
                <span
                  aria-hidden
                  style={{
                    marginLeft: 'auto',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: `1.8px solid ${on ? v2.accent : v2.line}`,
                    background: on ? v2.accent : 'transparent',
                    boxShadow: on ? 'inset 0 0 0 3px #fff' : undefined,
                    flexShrink: 0,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

// ─── result screen ───────────────────────────────────────────────────────────

interface ResultScreenProps {
  def: SurveyDef;
  insomniaScore: InsomniaSurveyResult | null;
  epworthScore: EpworthResult | null;
  onBack: () => void;
  onSafe: () => void;
  onRetake: () => void;
}

/** the four Epworth bands, in order */
const EPWORTH_BANDS = ['normal', 'mild', 'moderate', 'high'] as const;

function epworthBandIndex(band: string): number {
  if (band === 'normal') return 0;
  if (band === 'mild') return 1;
  if (band === 'moderate') return 2;
  return 3;
}

function epworthReading(score: number, band: string): string {
  if (band === 'normal') {
    return `a score of ${score} sits in the normal range of daytime sleepiness — nothing here needs doing.`;
  }
  if (band === 'mild') {
    return `a score of ${score} sits in the mild range — a little more daytime sleepiness than usual. worth keeping an eye on.`;
  }
  if (band === 'moderate') {
    return `a score of ${score} sits in the moderate range — noticeable daytime sleepiness. worth raising with a clinician when you can.`;
  }
  return `a score of ${score} sits in the high range — significant daytime sleepiness. it is worth speaking to a clinician.`;
}

function ResultScreen({
  def,
  insomniaScore,
  epworthScore,
  onBack,
  onSafe,
  onRetake,
}: ResultScreenProps) {
  const isInsomnia = def.which === 'insomnia';
  const score = isInsomnia ? insomniaScore?.score : epworthScore?.score;
  const band = isInsomnia ? insomniaScore?.band : epworthScore?.band;

  const result = useMemo(() => {
    if (score == null || band == null) return null;
    if (isInsomnia) {
      return {
        bands: INSOMNIA_BANDS,
        activeIndex: insomniaBandIndex(band),
        reading: insomniaBandReading(score, band),
      };
    }
    return {
      bands: EPWORTH_BANDS,
      activeIndex: epworthBandIndex(band),
      reading: epworthReading(score, band),
    };
  }, [score, band, isInsomnia]);

  return (
    <Screen label="your result" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {result == null ? (
        <div
          style={{
            marginTop: 80,
            textAlign: 'center',
            fontSize: 15,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          that check-in didn’t finish. you can take it again whenever you like.
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop: 48,
              textAlign: 'center',
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            {def.title} &middot; {def.prompts.length} questions
          </div>
          <div
            style={{
              marginTop: 4,
              textAlign: 'center',
              fontSize: 15,
              color: v2.ink,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            a calm read, just for you
          </div>

          <div
            style={{
              marginTop: 22,
              textAlign: 'center',
              fontSize: 62,
              fontWeight: 300,
              color: v2.ink,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {score}
            <span style={{ fontSize: 24, color: v2.mute, fontWeight: 300 }}>
              {' '}
              / {def.max}
            </span>
          </div>

          {/* the 4-segment severity band — the user's band sage */}
          <div style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {result.bands.map((_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: i === result.activeIndex ? v2.sage : v2.line,
                  }}
                />
              ))}
            </div>
            <div style={{ marginTop: 9, display: 'flex', justifyContent: 'space-between' }}>
              {result.bands.map((b, i) => (
                <span
                  key={b}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: i === result.activeIndex ? v2.sage : v2.mute,
                  }}
                >
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* the band's plain reading */}
          <div
            style={{
              marginTop: 20,
              fontSize: 15,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.45,
            }}
          >
            {result.reading}
          </div>

          {/* the source tag */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: 18,
              border: `1px solid ${v2.line}`,
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              color: v2.sage,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              alignSelf: 'flex-start',
            }}
          >
            {def.source}
          </span>

          <Disclaimer />

          <button
            type="button"
            onClick={onRetake}
            style={{
              marginTop: 22,
              alignSelf: 'center',
              background: 'transparent',
              border: 'none',
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            retake whenever you like
          </button>
        </>
      )}
    </Screen>
  );
}

// ─── the shared screen-only disclaimer ───────────────────────────────────────

function Disclaimer() {
  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 20,
        borderTop: `1px solid ${v2.line}`,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1 }}>
        <IconInfo size={15} stroke={v2.mute} />
      </span>
      <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
        this is a screening scale, not a diagnosis. ollie keeps it here for you
        &mdash; it is never sent as a notification. if sleep is wearing on you,
        it&rsquo;s worth raising with a clinician.
      </span>
    </div>
  );
}
