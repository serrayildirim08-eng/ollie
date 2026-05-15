import React, { useState } from 'react';
import type { Observation, SpeciesProfile } from '@ollie/logic/pets';

// ─── props ────────────────────────────────────────────────────────────────────

interface PetObservationEntryProps {
  petId: string;
  speciesProfile: SpeciesProfile;
  /** Append a new observation to pets.observations. */
  onRecord: (observation: Observation) => void;
}

/**
 * PetObservationEntry — collapsible note panel inside a PetCard.
 *
 * Lets the keeper record what they saw today: a weight reading, a free-text
 * symptom / behaviour note, and any quick-pick tags from the species profile.
 *
 * The free-text note is the load-bearing field: the health-flags detector
 * scans observation `text` (lower-cased substring match) to surface flags,
 * so recording symptoms here is what eventually populates the health panel.
 *
 * Weight is folded into `text` ("weight 0.94 kg") so it travels with the
 * observation and is also kept as a `weight:<kg>` tag for future trend work.
 *
 * Design: paper / ink, DM Mono caps labels. No blame, no streaks, no
 * exclamation — a quiet logbook line, not a nag.
 */
export function PetObservationEntry({
  petId,
  speciesProfile,
  onRecord,
}: PetObservationEntryProps) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const observationTags = speciesProfile.observation_tags ?? [];

  // A weight reading on its own is a recordable observation, as is a note.
  const weightKg = Number.parseFloat(weight);
  const hasWeight = weight.trim() !== '' && Number.isFinite(weightKg) && weightKg > 0;
  const hasNote = note.trim() !== '';
  const canRecord = hasWeight || hasNote || tags.length > 0;

  function toggleTag(tag: string): void {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function reset(): void {
    setWeight('');
    setNote('');
    setTags([]);
  }

  function record(): void {
    if (!canRecord) return;

    // text is what the health-flags detector scans — keep the note verbatim
    // and prepend the weight reading so it travels with the observation.
    const parts: string[] = [];
    if (hasWeight) parts.push(`weight ${weightKg} kg`);
    if (hasNote) parts.push(note.trim());
    const text = parts.join(' — ');

    const allTags = [...tags];
    if (hasWeight) allTags.push(`weight:${weightKg}`);

    onRecord({
      pet_id: petId,
      text,
      tags: allTags,
      occurred_at: Date.now(),
    });

    reset();
    setOpen(false);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 4_000);
  }

  // ── shared styles ────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    marginBottom: 6,
    fontWeight: 500,
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--paper)',
    border: '1px solid var(--rule)',
    padding: '10px 12px',
    fontFamily: "'Spectral', serif",
    fontSize: 14,
    color: 'var(--ink)',
    borderRadius: 2,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={open ? { flexBasis: '100%' } : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'lowercase',
          color: 'var(--ink-soft)',
          cursor: 'pointer',
          padding: '10px 12px',
          minHeight: 44,
        }}
      >
        {open ? 'close' : 'record an observation'}
      </button>

      {justSaved && !open && (
        <span
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: 12,
            fontStyle: 'italic',
            color: 'var(--ink-faint)',
            marginLeft: 4,
          }}
        >
          noted.
        </span>
      )}

      {open && (
        <div
          style={{
            background: 'var(--bone)',
            border: '1px solid var(--rule)',
            padding: 16,
            marginTop: 12,
            borderRadius: 4,
            display: 'grid',
            gap: 14,
            boxSizing: 'border-box',
          }}
        >
          {/* Weight */}
          <div>
            <label htmlFor={`obs-weight-${petId}`} style={labelStyle}>
              weight — kg
            </label>
            <input
              id={`obs-weight-${petId}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={weight}
              placeholder="0.94"
              onChange={(e) => setWeight(e.target.value)}
              style={fieldStyle}
            />
          </div>

          {/* Symptom / behaviour note */}
          <div>
            <label htmlFor={`obs-note-${petId}`} style={labelStyle}>
              what you noticed
            </label>
            <textarea
              id={`obs-note-${petId}`}
              rows={3}
              value={note}
              placeholder="quieter than usual, ate well, a little hunched in the evening"
              onChange={(e) => setNote(e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          {/* Quick-pick tags */}
          {observationTags.length > 0 && (
            <div>
              <span style={labelStyle}>behaviour</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {observationTags.map((tag) => {
                  const active = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-pressed={active}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
                        color: active ? 'var(--ink)' : 'var(--ink-soft)',
                        padding: '8px 12px',
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        textTransform: 'lowercase',
                        borderRadius: 2,
                        minHeight: 36,
                        cursor: 'pointer',
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={record}
            disabled={!canRecord}
            style={{
              background: 'transparent',
              border: '1px solid var(--ink)',
              color: 'var(--ink)',
              padding: '12px 20px',
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'lowercase',
              borderRadius: 4,
              minHeight: 44,
              cursor: canRecord ? 'pointer' : 'default',
              opacity: canRecord ? 1 : 0.4,
            }}
          >
            add to the notebook
          </button>
        </div>
      )}
    </div>
  );
}
