/**
 * body-v2 · SymptomLogScreen — start an episode (body-symptom-log.html)
 *
 * One quiet underlined symptom field, an optional 1–5 severity tap, the
 * three-tile kind picker (acute / chronic / mental), and ollie's calm
 * sage suggestion when the typed label matches a tracked condition.
 * One amber commit — "start the episode".
 *
 * Real data + logic: the chronic-condition match runs through the pure
 * `suggestEpisodeKind` from `@ollie/logic/body` over the live tracked
 * conditions; the commit opens a real episode in `body.episodes`.
 */
import { useMemo, useState } from 'react';
import { suggestEpisodeKind } from '@ollie/logic/body';
import type { EpisodeKind } from '@ollie/logic/body';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { useBodyActions } from '../useBodyActions';
import { KIND_OPTIONS } from '../selectors';

export interface SymptomLogScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function SymptomLogScreen({ now, onBack, onSafe }: SymptomLogScreenProps) {
  const slices = useBodySlices();
  const actions = useBodyActions(now);

  const [label, setLabel] = useState('');
  const [severity, setSeverity] = useState<number | null>(null);
  const [kindPick, setKindPick] = useState<EpisodeKind | null>(null);
  const [saved, setSaved] = useState(false);

  // ollie's suggestion — the pure logic match over the tracked conditions
  const suggested = useMemo<EpisodeKind>(() => {
    if (!label.trim()) return 'acute';
    return suggestEpisodeKind(label, slices.conditions, 'acute') as EpisodeKind;
  }, [label, slices.conditions]);

  // the effective kind: an explicit pick wins, else ollie's suggestion
  const effectiveKind: EpisodeKind = kindPick ?? suggested;
  const showSuggestion =
    kindPick == null && label.trim() !== '' && suggested === 'chronic';

  function submit() {
    if (!label.trim() || saved) return;
    const ep = actions.startEpisode(label, effectiveKind, severity);
    if (ep) {
      setSaved(true);
      // a calm "noted." beat, then back to the face
      window.setTimeout(() => onBack(), 700);
    }
  }

  return (
    <Screen
      label="log a symptom"
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
        <b style={{ fontWeight: 500 }}>what did the body do</b>
      </div>

      {/* the symptom field — one quiet underlined line */}
      <div
        style={{
          marginTop: 30,
          borderBottom: `1.5px solid ${v2.ink}`,
          paddingBottom: 11,
        }}
      >
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="migraine, ibs flare, a low stretch&hellip;"
          aria-label="what did the body do"
          style={{
            boxSizing: 'border-box',
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 21,
            fontWeight: 500,
            color: v2.ink,
            fontFamily: v2.sans,
            letterSpacing: '-0.01em',
            padding: 0,
          }}
        />
      </div>

      {/* severity — optional 1–5 tap */}
      <SectionLabel optional>severity</SectionLabel>
      <div
        style={{ marginTop: 15, display: 'flex', alignItems: 'center', gap: 12 }}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const on = severity === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              aria-label={`severity ${n}`}
              onClick={() => setSeverity(on ? null : n)}
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
      <div
        style={{
          marginTop: 11,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        <span>barely there</span>
        <span>can&rsquo;t ignore it</span>
      </div>

      {/* kind — acute / chronic / mental */}
      <SectionLabel>kind</SectionLabel>
      <div style={{ marginTop: 15, display: 'flex', gap: 9 }}>
        {KIND_OPTIONS.map((opt) => {
          const on = effectiveKind === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={on}
              onClick={() => setKindPick(opt.value)}
              style={{
                boxSizing: 'border-box',
                flex: 1,
                height: 62,
                borderRadius: 16,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? '#FCF6EA' : v2.card,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                cursor: 'pointer',
                boxShadow: on ? 'none' : '0 6px 16px rgba(42,38,34,.04)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: on ? 600 : 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {opt.value}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: v2.mute,
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                }}
              >
                {opt.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* ollie's quiet suggestion */}
      {showSuggestion && (
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
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
              marginTop: 5,
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            &ldquo;{label.trim()}&rdquo; matches a condition you track, so ollie
            set this to <b style={{ color: v2.ink, fontWeight: 600 }}>chronic</b>.
            change it if that&rsquo;s not right.
          </span>
        </div>
      )}

      <AmberButton
        icon={<IconCheck size={22} weight={2.4} stroke="#fff" />}
        onClick={submit}
        block
        disabled={!label.trim() || saved}
        style={{
          marginTop: 36,
          opacity: !label.trim() || saved ? 0.55 : 1,
        }}
      >
        start the episode
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
          noted.
        </div>
      )}
    </Screen>
  );
}

function SectionLabel({
  children,
  optional = false,
}: {
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 38,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
      {optional && (
        <span
          style={{
            color: v2.line,
            fontWeight: 500,
            textTransform: 'none',
            letterSpacing: '0.01em',
            marginLeft: 7,
          }}
        >
          &mdash; optional
        </span>
      )}
    </div>
  );
}
