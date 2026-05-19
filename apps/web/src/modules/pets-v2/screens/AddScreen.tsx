/**
 * pets-v2 · AddScreen — add a pet to the notebook (pets-add.html)
 *
 * The add form, the v2 way: one quiet underlined name line (never a big
 * box), the 10-species picker as a calm wrap of amber-fill pills, a sage
 * cadence-preview line of what ollie will track for the picked species, an
 * optional underlined nickname line, an optional notes area, and one
 * full-width amber "add {name}" commit with a dry "noted." confirmation.
 *
 * Real data: the commit writes a real `pets.pets` row through
 * `usePetsActions.addPet`, the SAME shape the live `PetsModule.addPet`
 * writes — so the pet is immediately visible to the live module.
 */
import { useState } from 'react';
import { Screen, AmberButton, IconCheck, IconPaw, v2 } from '../../money-v2/v2';
import { usePetsActions } from '../usePetsActions';
import { speciesOptions, speciesCadencePreview } from '../selectors';

export interface AddScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function AddScreen({ now, onBack, onSafe }: AddScreenProps) {
  const actions = usePetsActions(now);
  const species = speciesOptions();

  const [name, setName] = useState('');
  const [speciesKey, setSpeciesKey] = useState<string>(
    species[0]?.key ?? 'guinea_pig',
  );
  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  const canSave = name.trim().length > 0 && !saved;

  const commit = () => {
    if (!canSave) return;
    const id = actions.addPet({
      name: name.trim(),
      species: speciesKey,
      nickname,
      notes,
    });
    if (id) {
      setSaved(true);
      // the dry confirmation sits for a beat, then the screen dismisses
      window.setTimeout(() => onBack(), 900);
    }
  };

  return (
    <Screen
      label="add a pet"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>who&rsquo;s joining the notebook</b>
      </div>

      {/* the name field — one quiet underlined line */}
      <input
        type="text"
        value={name}
        placeholder="a name"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 28,
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

      {/* species — the 10-species picker */}
      <SectionLabel>species</SectionLabel>
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {species.map((s) => {
          const on = speciesKey === s.key;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() => setSpeciesKey(s.key)}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? v2.accent : v2.card,
                borderRadius: 14,
                padding: '8px 12px',
                minHeight: 38,
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: on ? '#fff' : v2.ink,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <IconPaw size={14} stroke={on ? '#fff' : v2.ink} weight={1.6} />
              {s.display}
            </button>
          );
        })}
      </div>

      {/* the species cadence preview — a calm sage line */}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
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
        <span style={{ fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          ollie keeps the{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            {currentSpeciesName(species, speciesKey)} cadences
          </b>{' '}
          &mdash; {speciesCadencePreview(speciesKey)}. each species runs on its
          own.
        </span>
      </div>

      {/* nickname — optional */}
      <SectionLabel>
        nickname
        <OptHint>&mdash; optional</OptHint>
      </SectionLabel>
      <input
        type="text"
        value={nickname}
        placeholder="a nickname"
        onChange={(e) => setNickname(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 14,
          border: 'none',
          borderBottom: `1px solid ${v2.line}`,
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

      {/* notes — free text, optional */}
      <SectionLabel>
        notes
        <OptHint>&mdash; optional</OptHint>
      </SectionLabel>
      <textarea
        value={notes}
        rows={3}
        placeholder="anything worth remembering — a rescue, shy with hands, likes parsley."
        onChange={(e) => setNotes(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 14,
          border: 'none',
          borderBottom: `1px solid ${v2.line}`,
          background: 'transparent',
          padding: '0 0 13px',
          fontSize: 15,
          fontWeight: 400,
          color: v2.ink,
          letterSpacing: '-0.005em',
          lineHeight: 1.55,
          fontFamily: v2.sans,
          outline: 'none',
          resize: 'vertical',
        }}
      />

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={!canSave}
        style={{ marginTop: 36, height: 52, opacity: canSave ? 1 : 0.45 }}
      >
        add {name.trim() || 'this pet'}
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

// ─── small bits ──────────────────────────────────────────────────────────────

function currentSpeciesName(
  species: { key: string; display: string }[],
  key: string,
): string {
  return species.find((s) => s.key === key)?.display ?? key;
}

function SectionLabel({ children }: { children: import('react').ReactNode }) {
  return (
    <div
      style={{
        marginTop: 32,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function OptHint({ children }: { children: import('react').ReactNode }) {
  return (
    <span
      style={{
        color: v2.line,
        fontWeight: 500,
        textTransform: 'none',
        letterSpacing: '0.01em',
        marginLeft: 7,
      }}
    >
      {children}
    </span>
  );
}
