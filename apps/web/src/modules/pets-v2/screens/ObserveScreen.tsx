/**
 * pets-v2 · ObserveScreen — record an observation (pets-observe.html)
 *
 * The observe form, the v2 way: a 2-up pet picker, an optional underlined
 * weight line with a "last · {x} kg" reference, the free-text "what you
 * saw" note area — the corpus the health-flag engine reads — a wrap of
 * species-adaptive behaviour quick-tags, a sage cue explaining where the
 * note goes, and one full-width amber "save it" commit.
 *
 * Real data: the commit writes a real `pets.observations` row through
 * `usePetsActions.recordObservation` — the SAME key the pets orchestrator
 * subscribes to to recompute `pets.health_flags`.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, Chip, v2 } from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { usePetsActions } from '../usePetsActions';
import { activePets, observationTags, lastWeight } from '../selectors';
import { PetTilePicker } from '../components/PetTilePicker';

export interface ObserveScreenProps {
  now: number;
  prefillPetId: string | null;
  onBack: () => void;
}

export function ObserveScreen({ now, prefillPetId, onBack }: ObserveScreenProps) {
  const slices = usePetsSlices();
  const actions = usePetsActions(now);
  const pets = useMemo(() => activePets(slices), [slices]);

  const initialPet =
    (prefillPetId && pets.some((p) => p.id === prefillPetId)
      ? prefillPetId
      : pets[0]?.id) ?? null;
  const [petId, setPetId] = useState<string | null>(initialPet);

  const selectedPet = pets.find((p) => p.id === petId) ?? null;
  const tags = useMemo(
    () => (selectedPet ? observationTags(selectedPet.species) : []),
    [selectedPet],
  );

  const [weightKg, setWeightKg] = useState('');
  const [text, setText] = useState('');
  const [chosenTags, setChosenTags] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  if (pets.length === 0) {
    return (
      <Screen label="observe" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
        <div
          style={{
            marginTop: 80,
            textAlign: 'center',
            fontSize: 15,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          no pets in the notebook yet &mdash; add one first.
        </div>
      </Screen>
    );
  }

  const lastG = petId ? lastWeight(slices, petId) : null;
  const parsedKg = Number.parseFloat(weightKg);
  const hasWeight = Number.isFinite(parsedKg) && parsedKg > 0;

  const toggleTag = (t: string) => {
    setSaved(false);
    setChosenTags((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  };

  const canSave =
    petId !== null &&
    !saved &&
    (text.trim().length > 0 || chosenTags.length > 0 || hasWeight);

  const commit = () => {
    if (!canSave || !petId) return;
    const id = actions.recordObservation({
      petId,
      text: text.trim(),
      tags: chosenTags,
      weightGrams: hasWeight ? Math.round(parsedKg * 1000) : undefined,
    });
    if (id) setSaved(true);
  };

  return (
    <Screen label="observe" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>what you noticed</b>
      </div>

      {/* which pet */}
      <SectionLabel>for</SectionLabel>
      <PetTilePicker
        pets={pets}
        selectedId={petId}
        onSelect={(id) => {
          setPetId(id);
          setSaved(false);
        }}
        showSpecies={false}
      />

      {/* weight — optional */}
      <SectionLabel>
        weight
        <OptHint>&mdash; optional</OptHint>
      </SectionLabel>
      <div
        style={{
          boxSizing: 'border-box',
          marginTop: 14,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 11,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <input
          type="text"
          inputMode="decimal"
          value={weightKg}
          placeholder="—"
          aria-label="weight in kilograms"
          onChange={(e) => {
            setWeightKg(e.target.value);
            setSaved(false);
          }}
          style={{
            boxSizing: 'border-box',
            width: 90,
            border: 'none',
            background: 'transparent',
            padding: 0,
            fontSize: 24,
            fontWeight: 500,
            color: v2.ink,
            letterSpacing: '-0.02em',
            fontFamily: v2.sans,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 15, color: v2.mute, fontWeight: 500 }}>kg</span>
        {lastG !== null && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              color: v2.mute,
              fontWeight: 500,
            }}
          >
            last &middot; {(lastG / 1000).toFixed(2)} kg
          </span>
        )}
      </div>

      {/* the free-text "what you saw" — feeds the health-flag engine */}
      <SectionLabel>what you saw</SectionLabel>
      <textarea
        value={text}
        rows={3}
        placeholder="how they seemed today — eating, mood, anything that stood out."
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
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

      {/* species behaviour quick-tags */}
      {tags.length > 0 && (
        <>
          <SectionLabel>
            behaviour
            <OptHint>&mdash; tap any that fit</OptHint>
          </SectionLabel>
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tags.map((t) => (
              <Chip
                key={t}
                on={chosenTags.includes(t)}
                onToggle={() => toggleTag(t)}
              >
                {t}
              </Chip>
            ))}
          </div>
        </>
      )}

      {/* the quiet note about where the text goes */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
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
          ollie reads this note quietly over time &mdash;{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            if the same thing shows up across a few days
          </b>
          , it&rsquo;ll sit in health for you to look at. one quiet day is just
          a day.
        </span>
      </div>

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={!canSave}
        style={{ marginTop: 30, height: 52, opacity: canSave ? 1 : 0.45 }}
      >
        save it
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

function SectionLabel({ children }: { children: import('react').ReactNode }) {
  return (
    <div
      style={{
        marginTop: 30,
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
