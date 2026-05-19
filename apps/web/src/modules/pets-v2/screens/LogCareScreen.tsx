/**
 * pets-v2 · LogCareScreen — log a care task (pets-log.html)
 *
 * The log form, the v2 way: a 2-up pet picker, a species-adaptive wrap of
 * quick-pick care-task pills (the set changes to fit the picked pet's
 * species), an optional underlined note line, one full-width amber "log it"
 * commit, and the quiet 60-second toggle-undo note.
 *
 * Real data: the commit writes a real `pets.care_log` row through
 * `usePetsActions.logCare` — the SAME shape + 60s toggle-undo +
 * care-gap recompute the live `PetsModule.logManual` performs.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, IconHay, v2 } from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { usePetsActions } from '../usePetsActions';
import { activePets, careTaskOptions, speciesLabel } from '../selectors';
import { PetTilePicker } from '../components/PetTilePicker';

export interface LogCareScreenProps {
  now: number;
  prefillPetId: string | null;
  prefillTask: string | null;
  onBack: () => void;
}

export function LogCareScreen({
  now,
  prefillPetId,
  prefillTask,
  onBack,
}: LogCareScreenProps) {
  const slices = usePetsSlices();
  const actions = usePetsActions(now);
  const pets = useMemo(() => activePets(slices), [slices]);

  const initialPet =
    (prefillPetId && pets.some((p) => p.id === prefillPetId)
      ? prefillPetId
      : pets[0]?.id) ?? null;
  const [petId, setPetId] = useState<string | null>(initialPet);

  const selectedPet = pets.find((p) => p.id === petId) ?? null;
  const tasks = useMemo(
    () => (selectedPet ? careTaskOptions(selectedPet.species) : []),
    [selectedPet],
  );

  const initialTask =
    prefillTask && tasks.some((t) => t.key === prefillTask)
      ? prefillTask
      : tasks[0]?.key ?? null;
  const [taskKey, setTaskKey] = useState<string | null>(initialTask);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<'logged' | 'undone' | null>(null);

  // keep the task selection valid when the pet (and so the task set) changes
  const taskValid = taskKey !== null && tasks.some((t) => t.key === taskKey);
  const effectiveTask = taskValid ? taskKey : tasks[0]?.key ?? null;

  if (pets.length === 0) {
    return (
      <Screen label="log care" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
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

  const commit = () => {
    if (!petId || !effectiveTask) return;
    const r = actions.logCare(petId, effectiveTask);
    if (r) setResult(r);
  };

  return (
    <Screen label="log care" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>what did you do</b>
      </div>

      {/* which pet */}
      <SectionLabel>for</SectionLabel>
      <PetTilePicker
        pets={pets}
        selectedId={petId}
        onSelect={(id) => {
          setPetId(id);
          setResult(null);
        }}
        showSpecies
      />

      {/* the species-adaptive care task pills */}
      <SectionLabel>the care task</SectionLabel>
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {tasks.map((t) => {
          const on = effectiveTask === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTaskKey(t.key);
                setResult(null);
              }}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? v2.accent : v2.card,
                borderRadius: 15,
                padding: '11px 14px',
                minHeight: 42,
                fontSize: 14,
                fontWeight: on ? 600 : 500,
                color: on ? '#fff' : v2.ink,
                letterSpacing: '-0.01em',
                boxShadow: on ? 'none' : '0 6px 16px rgba(42,38,34,.04)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <IconHay size={16} stroke={on ? '#fff' : v2.ink} weight={1.7} />
              {t.display}
            </button>
          );
        })}
      </div>

      {/* the species-adaptive cue line */}
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
          these are the{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            {selectedPet ? speciesLabel(selectedPet.species) : 'species'} tasks
          </b>{' '}
          ollie tracks for {selectedPet?.name ?? 'this pet'}. pick another pet
          and the set changes to fit its species.
        </span>
      </div>

      {/* an optional quiet note */}
      <input
        type="text"
        value={note}
        placeholder="a note — optional"
        onChange={(e) => setNote(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 24,
          border: 'none',
          borderBottom: `1px solid ${v2.line}`,
          background: 'transparent',
          padding: '0 0 11px',
          fontSize: 15,
          fontWeight: 500,
          color: v2.ink,
          letterSpacing: '-0.01em',
          fontFamily: v2.sans,
          outline: 'none',
        }}
      />

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={!effectiveTask}
        style={{ marginTop: 34, height: 52, opacity: effectiveTask ? 1 : 0.45 }}
      >
        log it
      </AmberButton>
      {result && (
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
          {result === 'logged' ? 'noted.' : 'undone.'}
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          textAlign: 'center',
          fontSize: 11,
          color: v2.mute,
          fontWeight: 400,
        }}
      >
        tap the same task again within a minute to undo it.
      </div>
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
