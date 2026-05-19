/**
 * goals-v2 · ReviewScreen — a soft check-in (goals-review.html)
 *
 * The soft goal review — the most carefully un-graded screen in the
 * cluster: ONE reflective prompt, a free line, NO score, NO percentage,
 * NO "you're behind". It asks how the goal FEELS, not how it's DOING.
 *
 * TONE — goals + ADHD is a shame minefield, so the only structured input
 * is two gentle tags ("still want it" / "carrying it from before"); both
 * are honest, both are fine, neither is a right answer. When the last 2+
 * check-ins were all "carrying it from before", the closing note gently
 * surfaces — quietly, on this screen — whether it's time to let the goal
 * rest. It never scolds.
 *
 * Real data: the goal name comes from `reviewVM` over the live `goals.*`
 * slices; the commit writes a real `goals.reviews` row through
 * `useGoalsActions.addReview`, the SAME shape `GoalsModule.tagReview`
 * writes — so the check-in is visible to the live module's detectors.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useGoalsSlices } from '../useGoalsSlices';
import { useGoalsActions } from '../useGoalsActions';
import { reviewVM, REVIEW_TAGS, type ReviewTag } from '../selectors';

export interface ReviewScreenProps {
  now: number;
  goalId: string | null;
  onBack: () => void;
}

export function ReviewScreen({ now, goalId, onBack }: ReviewScreenProps) {
  const slices = useGoalsSlices();
  const actions = useGoalsActions(now);
  const vm = useMemo(() => reviewVM(slices, goalId), [slices, goalId]);

  const [note, setNote] = useState('');
  const [tag, setTag] = useState<ReviewTag>('want');
  const [saved, setSaved] = useState(false);

  if (!vm.exists) {
    return (
      <Screen label="a check-in" onBack={onBack} centered>
        <div
          style={{
            fontSize: 16,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          there&rsquo;s no goal to check in on.
          <br />
          swipe down to go back.
        </div>
      </Screen>
    );
  }

  const commit = () => {
    if (saved) return;
    actions.addReview(vm.goalId, tag, note);
    setSaved(true);
    window.setTimeout(() => onBack(), 1000);
  };

  return (
    <Screen label="a check-in" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* which goal — one calm line, never a report header */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: v2.accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          a minute with <b style={{ color: v2.ink, fontWeight: 600 }}>{vm.name}</b>
        </span>
      </div>

      {/* THE ONE PROMPT — a single reflective question */}
      <div
        style={{
          marginTop: 30,
          fontSize: 25,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.022em',
          lineHeight: 1.42,
        }}
      >
        <b style={{ fontWeight: 500 }}>when you picture this goal,</b> does it
        still feel like yours?
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 13.5,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.55,
        }}
      >
        no score here, nothing to get right &mdash; just a moment to notice how
        it sits with you right now.
      </div>

      {/* the free line — the user's own words */}
      <div style={{ marginTop: 32 }}>
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 13,
          }}
        >
          say it however it comes
        </div>
        <input
          type="text"
          value={note}
          placeholder="a word, a sentence — whatever's true"
          onChange={(e) => setNote(e.target.value)}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            border: 'none',
            borderBottom: `1.5px solid ${v2.ink}`,
            background: 'transparent',
            padding: '0 0 11px',
            fontSize: 17,
            fontWeight: 500,
            color: v2.ink,
            letterSpacing: '-0.01em',
            fontFamily: v2.sans,
            outline: 'none',
          }}
        />
      </div>

      {/* the two soft tags — both honest, neither wrong */}
      <div style={{ marginTop: 30, display: 'flex', gap: 11 }}>
        {REVIEW_TAGS.map((t) => {
          const on = tag === t.value;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={on}
              onClick={() => setTag(t.value)}
              style={{
                boxSizing: 'border-box',
                flex: 1,
                border: `1px solid ${on ? v2.sage : v2.line}`,
                background: on ? '#EEF2EF' : v2.card,
                borderRadius: 16,
                padding: '15px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                cursor: 'pointer',
                textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: on ? v2.sage : v2.ink,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                }}
              >
                {t.title}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: v2.mute,
                  fontWeight: 400,
                  lineHeight: 1.4,
                }}
              >
                {t.sub}
              </span>
            </button>
          );
        })}
      </div>

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={saved}
        style={{ marginTop: 34, height: 52, opacity: saved ? 0.45 : 1 }}
      >
        that&rsquo;s my check-in
      </AmberButton>
      {saved && (
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          noted. nothing else needed.
        </div>
      )}

      {/* the closing note — never scored; the goal can change shape */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v2.sage,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 12.5,
            color: v2.ink,
            fontWeight: 500,
            lineHeight: 1.55,
            letterSpacing: '-0.01em',
          }}
        >
          {vm.driftSignal ? (
            <>
              the last few check-ins here have all been &ldquo;carrying it from
              before&rdquo;. <b style={{ fontWeight: 600 }}>that&rsquo;s a soft
              signal &mdash; not a verdict</b> &mdash; it might be time to let
              this goal rest. only you decide.
            </>
          ) : (
            <>
              a check-in is never graded. if &ldquo;carrying it from
              before&rdquo; keeps coming up, ollie will gently ask &mdash;
              quietly, on this screen &mdash; whether it&rsquo;s time to let the
              goal rest.
            </>
          )}
        </span>
      </div>
    </Screen>
  );
}
