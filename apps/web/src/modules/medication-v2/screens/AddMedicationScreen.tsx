/**
 * medication-v2 · AddMedicationScreen — add a medication (medication-add.html)
 *
 * One quiet underlined name field, an optional dose line, the four-tile
 * kind picker (vitamin / supplement / prescription / otc), and a
 * comma-separated HH:MM schedule field with a calm parsed-times preview.
 * Blank schedule = manual log only (the honest sage note). One amber
 * commit — "add it" — then a dry "noted." beat.
 *
 * Real data + logic: the schedule is parsed by the pure `parseSchedule`
 * from `selectors.ts`; the commit writes a real `MedicationItem` into
 * `medication.items` through `useMedicationActions`.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useMedicationActions } from '../useMedicationActions';
import { KIND_TILES, parseSchedule } from '../selectors';
import type { MedicationKind } from '@ollie/logic/medication';

export interface AddMedicationScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
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

export function AddMedicationScreen({
  now,
  onBack,
  onSafe,
}: AddMedicationScreenProps) {
  const actions = useMedicationActions(now);

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [kind, setKind] = useState<MedicationKind>('vitamin');
  const [schedule, setSchedule] = useState('');
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => parseSchedule(schedule), [schedule]);
  const canSave = name.trim().length > 0 && !saved;

  function submit() {
    if (!canSave) return;
    const item = actions.addMedication({
      name,
      dose: dose.trim() || undefined,
      kind,
      schedule: parsed.slots,
    });
    if (item) {
      setSaved(true);
      // a calm "noted." beat, then back to the face
      window.setTimeout(() => onBack(), 700);
    }
  }

  return (
    <Screen
      label="add a medication"
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
        <b style={{ fontWeight: 500 }}>what are you adding</b>
      </div>

      {/* THE NAME FIELD — one quiet underlined ink line */}
      <div
        style={{
          marginTop: 30,
          borderBottom: `1.5px solid ${v2.ink}`,
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
          placeholder="methylphenidate, vitamin d&hellip;"
          aria-label="medication name"
          style={{
            ...underlineInput,
            fontSize: 21,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        />
      </div>

      {/* dose — optional, a quieter underline */}
      <SectionLabel>
        dose
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
      </SectionLabel>
      <div
        style={{
          marginTop: 14,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 11,
        }}
      >
        <input
          value={dose}
          onChange={(e) => setDose(e.target.value)}
          placeholder="10mg, 1000 IU&hellip;"
          aria-label="dose"
          style={{
            ...underlineInput,
            fontSize: 17,
            color: v2.ink,
            fontWeight: 400,
            letterSpacing: '-0.01em',
          }}
        />
      </div>

      {/* kind — the four-tile picker */}
      <SectionLabel>kind</SectionLabel>
      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 9,
        }}
      >
        {KIND_TILES.map((tile) => {
          const on = kind === tile.value;
          return (
            <button
              key={tile.value}
              type="button"
              aria-pressed={on}
              onClick={() => setKind(tile.value)}
              style={{
                boxSizing: 'border-box',
                height: 58,
                borderRadius: 16,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? '#FCF6EA' : v2.card,
                boxShadow: '0 6px 16px rgba(42,38,34,.04)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer',
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
                {tile.value}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: v2.mute,
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                }}
              >
                {tile.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* schedule — comma-separated HH:MM, blank = manual */}
      <SectionLabel>
        schedule
        <span
          style={{
            color: v2.line,
            fontWeight: 500,
            textTransform: 'none',
            letterSpacing: '0.01em',
            marginLeft: 7,
          }}
        >
          &mdash; blank = log it manually
        </span>
      </SectionLabel>
      <div
        style={{
          marginTop: 14,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 11,
        }}
      >
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="08:00, 14:00"
          aria-label="schedule"
          inputMode="numeric"
          style={{
            ...underlineInput,
            fontSize: 17,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        />
      </div>

      {/* the parsed times — a quiet preview */}
      {parsed.labels.length > 0 ? (
        <div
          style={{
            marginTop: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {parsed.labels.map((label) => (
            <span
              key={label}
              style={{
                boxSizing: 'border-box',
                border: `1px solid ${v2.line}`,
                background: v2.card,
                borderRadius: 13,
                padding: '5px 11px',
                fontSize: 12,
                fontWeight: 600,
                color: v2.ink,
                letterSpacing: '0.01em',
              }}
            >
              {label}
            </span>
          ))}
          {parsed.hint && (
            <span
              style={{ fontSize: 12, color: v2.mute, fontWeight: 400 }}
            >
              &mdash; {parsed.hint}
            </span>
          )}
        </div>
      ) : (
        // the honest manual-only note — a calm sage line
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
            leave it blank and ollie won&rsquo;t remind you &mdash; you&rsquo;ll
            just{' '}
            <b style={{ color: v2.ink, fontWeight: 600 }}>
              log a dose when you take one
            </b>
            .
          </span>
        </div>
      )}

      <AmberButton
        block
        icon={<IconCheck size={22} weight={2.4} />}
        onClick={submit}
        disabled={!canSave}
        style={{ marginTop: 38, opacity: canSave ? 1 : 0.5 }}
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
    </Screen>
  );
}

// ─── a small section label ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 36,
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
