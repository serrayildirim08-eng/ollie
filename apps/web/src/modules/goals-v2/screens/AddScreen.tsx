/**
 * goals-v2 · AddScreen — add a goal (goals-add.html)
 *
 * The add form, the v2 way: a calm lead line, one quiet underlined name
 * line (never a box), a soft wrap of six category pills (one tap, selected
 * amber — the same six the goals logic carries), a sage permission note,
 * and one full-width amber "add it" commit with a dry "noted." confirmation.
 *
 * TONE — goals + ADHD is a shame minefield, so the ask is small and
 * forgiving: a goal can be changed, parked or dropped any time, and the
 * deeper fields (why, the block you see coming, a target) are explicitly
 * deferred to the goal page. Nothing here is a promise carved in stone.
 *
 * Real data: the commit writes a real `goals.items` row through
 * `useGoalsActions.addGoal`, the SAME shape the live `GoalsModule.save`
 * writes — so the goal is immediately visible to the live module.
 */
import { useState } from 'react';
import type { GoalCategory } from '@ollie/logic/goals';
import {
  Screen,
  AmberButton,
  IconCheck,
  IconCap,
  IconCareer,
  IconHeart,
  IconCoins,
  IconPeople,
  IconBrush,
  v2,
} from '../../money-v2/v2';
import { useGoalsActions } from '../useGoalsActions';
import { CATEGORY_OPTIONS } from '../selectors';

export interface AddScreenProps {
  now: number;
  onBack: () => void;
}

function CategoryGlyph({ cat, on }: { cat: GoalCategory; on: boolean }) {
  const stroke = on ? '#fff' : v2.mute;
  switch (cat) {
    case 'learning':
      return <IconCap size={13} stroke={stroke} />;
    case 'career':
      return <IconCareer size={13} stroke={stroke} />;
    case 'health':
      return <IconHeart size={13} stroke={stroke} />;
    case 'finance':
      return <IconCoins size={13} stroke={stroke} />;
    case 'relationship':
      return <IconPeople size={13} stroke={stroke} />;
    case 'creative':
      return <IconBrush size={13} stroke={stroke} />;
    default:
      return null;
  }
}

export function AddScreen({ now, onBack }: AddScreenProps) {
  const actions = useGoalsActions(now);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<GoalCategory | null>(null);
  const [saved, setSaved] = useState(false);

  const canSave = name.trim().length > 0 && !saved;

  const commit = () => {
    if (!canSave) return;
    const id = actions.addGoal({ name: name.trim(), category });
    if (id) {
      setSaved(true);
      // the dry confirmation sits for a beat, then the screen dismisses
      window.setTimeout(() => onBack(), 900);
    }
  };

  return (
    <Screen label="add a goal" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.35,
        }}
      >
        <b style={{ fontWeight: 500 }}>name one thing</b> you&rsquo;d like to
        move toward
      </div>

      {/* the name field — one quiet underlined line */}
      <input
        type="text"
        value={name}
        placeholder="learn spanish"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 30,
          border: 'none',
          borderBottom: `1.5px solid ${v2.ink}`,
          background: 'transparent',
          padding: '0 0 11px',
          fontSize: 21,
          fontWeight: 500,
          color: v2.ink,
          letterSpacing: '-0.01em',
          fontFamily: v2.sans,
          outline: 'none',
        }}
      />
      <div
        style={{
          marginTop: 9,
          fontSize: 12.5,
          color: v2.mute,
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}
      >
        keep it short. it doesn&rsquo;t have to be the final wording.
      </div>

      {/* the category picker — six soft pills, one tap */}
      <div
        style={{
          marginTop: 34,
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        a category
      </div>
      <div style={{ marginTop: 13, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {CATEGORY_OPTIONS.map((c) => {
          const on = category === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(on ? null : c.value)}
              style={{
                boxSizing: 'border-box',
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? v2.accent : v2.card,
                borderRadius: 15,
                padding: '9px 15px',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13.5,
                fontWeight: on ? 600 : 500,
                color: on ? '#fff' : v2.ink,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span aria-hidden style={{ display: 'inline-flex' }}>
                <CategoryGlyph cat={c.value} on={on} />
              </span>
              {c.label}
            </button>
          );
        })}
      </div>

      {/* the soft permission note — a goal isn't a contract */}
      <div
        style={{
          marginTop: 30,
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
            color: v2.ink,
            fontWeight: 500,
            lineHeight: 1.55,
            letterSpacing: '-0.01em',
          }}
        >
          that&rsquo;s all ollie needs. a goal isn&rsquo;t a promise &mdash;
          you can <b style={{ fontWeight: 600 }}>change it, park it, or let it
          go</b> any time, no explaining.
        </span>
      </div>

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={!canSave}
        style={{ marginTop: 34, height: 52, opacity: canSave ? 1 : 0.45 }}
      >
        add it
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

      {/* a quiet later line — the deeper fields can come later */}
      <div
        style={{
          marginTop: 28,
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
            background: v2.line,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          on the goal itself you can add{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>why it matters</i>,{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>
            a block you see coming
          </i>
          , or{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>a target date</i>{' '}
          &mdash; only if and when you want to. none of it is required.
        </span>
      </div>
    </Screen>
  );
}
