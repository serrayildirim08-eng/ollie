/**
 * habits-v2 · AddHabitScreen — add a habit (habits-add.html)
 *
 * One calm lead, then three quiet underlined fields — never a box:
 *   - the habit's name (the user's own words)
 *   - its CUE — required. the underline carries a sage tick once filled,
 *     and a one-line conviction note states why it can't be skipped (a
 *     habit without a cue is wishful thinking).
 *   - the cue-time — three single-select pills (morning / anytime /
 *     evening), so the day orders itself.
 * One full-width amber commit — "add it" — then a dry "noted." beat, and a
 * closing reassurance that no streak starts.
 *
 * Real data + logic: the commit writes a real `StoredHabit` into
 * `shared.habits_v2` through `useHabitsActions` — visible to the live
 * `HabitsModule`. The cue requirement is enforced both here and in the
 * action (`addHabit` returns null without one).
 */
import { useState } from 'react';
import { Screen, AmberButton, IconCheck, IconSun, IconClock, IconMoon, v2 } from '../../money-v2/v2';
import { useHabitsActions } from '../useHabitsActions';
import { CUE_TIME_TILES, type CueTime } from '../selectors';

export interface AddHabitScreenProps {
  now: number;
  onBack: () => void;
}

const underlineInput = {
  boxSizing: 'border-box' as const,
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  fontFamily: v2.sans,
};

/** the glyph for each cue-time tile */
function tileGlyph(value: CueTime, on: boolean) {
  const stroke = on ? v2.accent : v2.mute;
  if (value === 'morning') return <IconSun size={16} stroke={stroke} />;
  if (value === 'evening') return <IconMoon size={16} stroke={stroke} />;
  return <IconClock size={16} weight={1.9} stroke={stroke} />;
}

export function AddHabitScreen({ now, onBack }: AddHabitScreenProps) {
  const actions = useHabitsActions(now);

  const [name, setName] = useState('');
  const [cue, setCue] = useState('');
  const [cueTime, setCueTime] = useState<CueTime>('anytime');
  const [saved, setSaved] = useState(false);

  const cueSet = cue.trim().length > 0;
  const canSave = name.trim().length > 0 && cueSet && !saved;

  function submit() {
    if (!canSave) return;
    const created = actions.addHabit({ name, cue, cueTime });
    if (created) {
      setSaved(true);
      // a calm "noted." beat, then back to the face
      window.setTimeout(() => onBack(), 700);
    }
  }

  return (
    <Screen label="add a habit" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}
      >
        <b style={{ fontWeight: 500 }}>one small thing</b>
        <br />
        you&rsquo;d like to do most days
      </div>

      {/* NAME — the user's own words */}
      <FieldLabel>the habit</FieldLabel>
      <div
        style={{
          marginTop: 11,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 11,
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="drink water, move, read&hellip;"
          aria-label="habit name"
          style={{
            ...underlineInput,
            fontSize: 19,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.012em',
          }}
        />
      </div>

      {/* CUE — required. the underline ticks sage once filled. */}
      <FieldLabel>
        its cue
        <span
          style={{
            color: v2.accent,
            fontWeight: 600,
            textTransform: 'none',
            letterSpacing: '0.01em',
            marginLeft: 7,
          }}
        >
          &mdash; required
        </span>
      </FieldLabel>
      <div
        style={{
          marginTop: 11,
          borderBottom: `1px solid ${cueSet ? v2.sage : v2.line}`,
          paddingBottom: 11,
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        <input
          value={cue}
          onChange={(e) => setCue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="after coffee, before bed&hellip;"
          aria-label="habit cue"
          style={{
            ...underlineInput,
            flex: 1,
            fontSize: 19,
            color: v2.ink,
            fontWeight: cueSet ? 500 : 400,
            letterSpacing: '-0.012em',
          }}
        />
        {cueSet && (
          <span aria-label="cue set" style={{ flexShrink: 0, display: 'inline-flex' }}>
            <IconCheck size={17} weight={2.4} stroke={v2.sage} title="cue set" />
          </span>
        )}
      </div>
      {/* the conviction line — sage dot + one calm sentence, never scolding */}
      <div
        style={{
          marginTop: 13,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
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
          a habit without a cue is wishful thinking.{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            the cue is what actually fires it
          </b>{' '}
          &mdash; something that already happens.
        </span>
      </div>

      {/* CUE-TIME — when the cue tends to land */}
      <FieldLabel>when does that cue land</FieldLabel>
      <div style={{ marginTop: 13, display: 'flex', gap: 9 }}>
        {CUE_TIME_TILES.map((tile) => {
          const on = cueTime === tile.value;
          return (
            <button
              key={tile.value}
              type="button"
              aria-pressed={on}
              onClick={() => setCueTime(tile.value)}
              style={{
                boxSizing: 'border-box',
                flex: 1,
                height: 44,
                borderRadius: 14,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? '#FCF6EA' : v2.card,
                boxShadow: '0 5px 14px rgba(42,38,34,.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {tileGlyph(tile.value, on)}
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: on ? 600 : 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {tile.label}
              </span>
            </button>
          );
        })}
      </div>

      <AmberButton
        block
        icon={<IconCheck size={22} weight={2.4} />}
        onClick={submit}
        disabled={!canSave}
        style={{ marginTop: 40, opacity: canSave ? 1 : 0.5 }}
      >
        add it
      </AmberButton>

      {saved ? (
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
      ) : (
        <div
          style={{
            marginTop: 18,
            textAlign: 'center',
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          no streaks start. just a small thing,
          <br />
          here when its cue comes round.
        </div>
      )}
    </Screen>
  );
}

// ─── a small field label ─────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 34,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}
