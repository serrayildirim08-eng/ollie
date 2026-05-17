import React, { useMemo, useState, useEffect } from 'react';
import {
  SPECIES_PROFILES,
  SPECIES_LIST,
  pickPreface,
  computeCareGaps,
} from '@ollie/logic/pets';
import type { Pet, CareLogEntry, Observation, CareGap, Milestone } from '@ollie/logic/pets';
import { mkId } from '../../lib/mkId';
import { useStoreSlice } from '../../store';
import { PetCard } from './PetCard';
import { PetsNoticed } from './PetsNoticed';

// ─── Stored types (orchestrator-augmented shapes) ────────────────────────────

export interface StoredHealthFlag {
  id: string;
  pet_id: string;
  flag: string;
  run_length: number;
  last_signal_at: number;
  source_url: string;
  status: 'pending' | 'reviewed' | 'dismissed';
  detected_at: number;
  reviewed_at?: number;
}

interface StoredPet extends Omit<Pet, 'nickname'> {
  cohabits_with?: string[];
  nickname?: string | null;
  notes?: string | null;
  archived?: boolean;
  archived_at?: number | null;
  created_at?: number;
}

interface StoredCareLogEntry extends CareLogEntry {
  id?: string;
  source?: string;
  raw_text?: string | null;
  confidence?: number;
}

interface PetsSettings {
  guilt_voice?: string;
  weekly_letter?: string;
  multi_caregiver?: boolean;
}

interface AwayState {
  active: boolean;
  returning_at: number | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PetsModule() {
  // ── Store slices — all hooks at the top ──────────────────────────────────
  const [pets, setPets] = useStoreSlice<StoredPet[]>('pets', 'pets', []);
  const [careLog, setCareLog] = useStoreSlice<StoredCareLogEntry[]>('pets', 'care_log', []);
  const [observations, setObservations] = useStoreSlice<Observation[]>(
    'pets',
    'observations',
    [],
  );
  const [careGaps, setCareGaps] = useStoreSlice<CareGap[]>('pets', 'care_gaps', []);
  const [healthFlags, setHealthFlags] = useStoreSlice<StoredHealthFlag[]>(
    'pets',
    'health_flags',
    [],
  );
  const [settings] = useStoreSlice<PetsSettings>('pets', 'settings', {
    guilt_voice: 'on',
    weekly_letter: 'off',
    multi_caregiver: false,
  });
  const [dailyForecast] = useStoreSlice<Record<string, string>>('pets', 'daily_forecast', {});
  const [milestones] = useStoreSlice<Milestone[]>('pets', 'milestones', []);
  const [awayState, setAwayState] = useStoreSlice<AwayState>('pets', 'away', {
    active: false,
    returning_at: null,
  });
  const [vocabShown] = useStoreSlice<Record<string, string[]>>('pets', 'vocab_shown', {});

  // ── Local UI state ───────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSpecies, setNewSpecies] = useState('guinea_pig');
  const [newNickname, setNewNickname] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Live clock — ticks every minute
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Derived values — memoised ────────────────────────────────────────────
  const activePets = useMemo(() => pets.filter((p) => !p.archived), [pets]);

  const today = useMemo(() => new Date(now), [now]);
  const dateLabel = today
    .toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    .toLowerCase();

  // Recompute care gaps on every tick; prefer store value if fresh.
  const computedGaps = useMemo(
    () => computeCareGaps(activePets as Pet[], careLog as CareLogEntry[], SPECIES_PROFILES, now),
    [activePets, careLog, now],
  );

  const resolvedGaps: CareGap[] = useMemo(
    () => (careGaps.length > 0 ? careGaps : computedGaps),
    [careGaps, computedGaps],
  );

  const state = useMemo(
    () => ({
      care_log: careLog as CareLogEntry[],
      observations,
      care_gaps: resolvedGaps,
      health_flags: healthFlags,
      settings,
    }),
    [careLog, observations, resolvedGaps, healthFlags, settings],
  );

  const preface = useMemo(() => pickPreface(now), [now]);

  const pendingFlags = useMemo(
    () => healthFlags.filter((f) => f.status === 'pending'),
    [healthFlags],
  );
  const oldPendingFlags = useMemo(
    () => pendingFlags.filter((f) => now - f.detected_at >= 7 * 86_400_000),
    [pendingFlags, now],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  function logManual(petId: string, task: string) {
    const id = mkId('id');
    const entry: StoredCareLogEntry = {
      id,
      pet_id: petId,
      task,
      occurred_at: Date.now(),
      source: 'manual',
      raw_text: null,
      confidence: 1,
    };
    // Toggle-undo: if same pet+task logged <60s ago, remove that entry instead.
    const recent = [...careLog]
      .reverse()
      .find(
        (e) =>
          e.pet_id === petId &&
          e.task === task &&
          Date.now() - e.occurred_at < 60_000 &&
          e.source === 'manual',
      );
    const next: StoredCareLogEntry[] = recent
      ? careLog.filter((e) => e.id !== recent.id)
      : [...careLog, entry];
    setCareLog(next);
    // Refresh care gaps immediately.
    const freshGaps = computeCareGaps(
      activePets as Pet[],
      next as CareLogEntry[],
      SPECIES_PROFILES,
      Date.now(),
    );
    setCareGaps(freshGaps);
  }

  function recordObservation(observation: Observation) {
    // Append to pets.observations. The pets orchestrator subscribes to this
    // key and recomputes pets.health_flags — symptom text entered here is
    // what feeds the health-flag detector.
    setObservations([...observations, observation]);
  }

  function archivePet(petId: string) {
    const next = pets.map((p) =>
      p.id === petId ? { ...p, archived: true, archived_at: Date.now() } : p,
    );
    setPets(next);
  }

  function reviewFlag(flagId: string) {
    setHealthFlags(
      healthFlags.map((f) =>
        f.id === flagId ? { ...f, status: 'reviewed', reviewed_at: Date.now() } : f,
      ),
    );
  }

  function dismissFlag(flagId: string) {
    setHealthFlags(
      healthFlags.map((f) =>
        f.id === flagId ? { ...f, status: 'dismissed', reviewed_at: Date.now() } : f,
      ),
    );
  }

  function addPet() {
    if (!newName.trim()) return;
    const id = mkId('id');
    const pet: StoredPet = {
      id,
      name: newName.trim(),
      species: newSpecies,
      nickname: newNickname.trim() || null,
      notes: newNotes.trim() || null,
      cohabits_with: [],
      archived: false,
      archived_at: null,
      created_at: Date.now(),
    };
    setPets([...pets, pet]);
    setAddOpen(false);
    setNewName('');
    setNewNickname('');
    setNewNotes('');
    setNewSpecies('guinea_pig');
  }

  function toggleAway() {
    if (awayState.active) {
      setAwayState({ active: false, returning_at: null });
    } else {
      setAwayState({ active: true, returning_at: Date.now() + 3 * 86_400_000 });
    }
  }

  function formatAwayUntil(ts: number | null): string {
    if (!ts) return '';
    return new Date(ts)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      .toLowerCase();
  }

  // ── Section label style ───────────────────────────────────────────────────
  const sectionLabel: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    margin: '0 0 10px 0',
    fontWeight: 500,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: '#F2EEE4',
        color: '#14130F',
        width: '100%',
        minHeight: '100vh',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '56px 32px 120px',
          boxSizing: 'border-box',
        }}
      >
        {/* Preface */}
        <p
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: 14,
            fontStyle: 'italic',
            lineHeight: 1.5,
            color: '#4B4740',
            margin: '0 0 24px 0',
          }}
        >
          {preface}
        </p>

        {/* Header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingBottom: 20,
            borderBottom: '1px solid rgba(20,19,15,0.18)',
            marginBottom: 40,
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 36,
                fontWeight: 500,
                color: '#14130F',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              keeper's notebook
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7C7770',
                margin: 0,
                paddingBottom: 4,
              }}
            >
              {activePets.length} {activePets.length === 1 ? 'resident' : 'residents'} · {dateLabel}
            </p>
            <button
              type="button"
              onClick={toggleAway}
              style={{
                background: 'transparent',
                border: '1px solid #14130F',
                color: '#14130F',
                padding: '12px 20px',
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'lowercase',
                borderRadius: 4,
                minHeight: 44,
                minWidth: 88,
                cursor: 'pointer',
              }}
            >
              {awayState.active ? 'end away' : 'away mode'}
            </button>
          </div>
        </header>

        {/* Away banner */}
        {awayState.active && (
          <div
            style={{
              background: '#E8E2D2',
              border: '1px solid rgba(20,19,15,0.18)',
              borderLeft: '3px solid #14130F',
              padding: '14px 18px',
              marginBottom: 28,
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'lowercase',
              color: '#14130F',
              lineHeight: 1.6,
            }}
          >
            away until {formatAwayUntil(awayState.returning_at)}. care reminders paused.
          </div>
        )}

        {/* Pet grid — or empty state */}
        {activePets.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 20px',
              color: '#4B4740',
              fontFamily: "'Spectral', serif",
              fontSize: 15,
              fontStyle: 'italic',
              lineHeight: 1.6,
            }}
          >
            no residents yet. add a pet below to begin the notebook.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))',
              gap: 24,
            }}
          >
            {activePets.map((pet) => {
              const profile = SPECIES_PROFILES[pet.species];
              if (!profile) return null;
              return (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  state={state}
                  speciesProfile={profile}
                  now={now}
                  onLogManual={logManual}
                  onArchive={archivePet}
                  onReviewFlag={reviewFlag}
                  onRecordObservation={recordObservation}
                  dailyForecast={dailyForecast}
                  milestones={milestones}
                  vocabShown={vocabShown}
                  away={awayState}
                />
              );
            })}
          </div>
        )}

        {/* Old pending flags review drawer */}
        {oldPendingFlags.length > 0 && (
          <section
            style={{
              marginTop: 72,
              paddingTop: 32,
              borderTop: '1px solid rgba(20,19,15,0.18)',
            }}
          >
            <p style={sectionLabel}>
              {oldPendingFlags.length} unreviewed flag
              {oldPendingFlags.length > 1 ? 's' : ''} — older than 7 days
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {oldPendingFlags.map((f) => {
                const pet = pets.find((p) => p.id === f.pet_id);
                return (
                  <li
                    key={f.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 16,
                      padding: '16px 0',
                      fontFamily: "'Spectral', serif",
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: '#14130F',
                      borderBottom: '1px solid rgba(20,19,15,0.18)',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 500 }}>
                        {pet ? pet.name.toLowerCase() : 'unknown'}
                      </span>{' '}
                      — {f.flag.replace(/_/g, ' ')}, observed {f.run_length} days
                      {f.source_url && (
                        <>
                          {' '}
                          <a
                            href={f.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              fontSize: 9,
                              letterSpacing: '0.12em',
                              color: '#7C7770',
                              textDecoration: 'underline',
                              textUnderlineOffset: 3,
                              marginLeft: 8,
                            }}
                          >
                            source
                          </a>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => reviewFlag(f.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.14em',
                          textTransform: 'lowercase',
                          color: '#4B4740',
                          cursor: 'pointer',
                          padding: '10px 12px',
                          minHeight: 44,
                        }}
                      >
                        mark reviewed
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissFlag(f.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.14em',
                          textTransform: 'lowercase',
                          color: '#4B4740',
                          cursor: 'pointer',
                          padding: '10px 12px',
                          minHeight: 44,
                        }}
                      >
                        dismiss
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Add pet button */}
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 420,
            margin: '48px auto 0',
            boxSizing: 'border-box',
            background: 'transparent',
            border: `1px ${addOpen ? 'solid' : 'dashed'} #7C7770`,
            color: '#14130F',
            padding: 18,
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'lowercase',
            borderRadius: 4,
            minHeight: 48,
            cursor: 'pointer',
          }}
        >
          {addOpen ? 'close' : '+ add a pet'}
        </button>

        {/* Add pet panel */}
        {addOpen && (
          <div
            style={{
              background: '#E8E2D2',
              border: '1px solid rgba(20,19,15,0.18)',
              padding: 24,
              marginTop: 20,
              maxWidth: 480,
              margin: '20px auto 0',
              borderRadius: 4,
              display: 'grid',
              gap: 14,
              boxSizing: 'border-box',
            }}
          >
            {/* Name */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#7C7770',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                name
              </label>
              <input
                type="text"
                value={newName}
                placeholder="tontin"
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  width: '100%',
                  background: '#F2EEE4',
                  border: '1px solid rgba(20,19,15,0.18)',
                  padding: '10px 12px',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  color: '#14130F',
                  borderRadius: 2,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Species */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#7C7770',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                species
              </label>
              <select
                value={newSpecies}
                onChange={(e) => setNewSpecies(e.target.value)}
                style={{
                  width: '100%',
                  background: '#F2EEE4',
                  border: '1px solid rgba(20,19,15,0.18)',
                  padding: '10px 12px',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  color: '#14130F',
                  borderRadius: 2,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {SPECIES_LIST.map((key) => {
                  const p = SPECIES_PROFILES[key];
                  return (
                    <option key={key} value={key}>
                      {p.display_name}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Nickname */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#7C7770',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                nickname
              </label>
              <input
                type="text"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                style={{
                  width: '100%',
                  background: '#F2EEE4',
                  border: '1px solid rgba(20,19,15,0.18)',
                  padding: '10px 12px',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  color: '#14130F',
                  borderRadius: 2,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Notes */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#7C7770',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                notes
              </label>
              <textarea
                rows={2}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                style={{
                  width: '100%',
                  background: '#F2EEE4',
                  border: '1px solid rgba(20,19,15,0.18)',
                  padding: '10px 12px',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  color: '#14130F',
                  borderRadius: 2,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="button"
              onClick={addPet}
              style={{
                background: 'transparent',
                border: '1px solid #14130F',
                color: '#14130F',
                padding: '12px 20px',
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'lowercase',
                borderRadius: 4,
                minHeight: 44,
                cursor: 'pointer',
              }}
            >
              add to notebook
            </button>
          </div>
        )}

        {/* Behavioural patterns */}
        <PetsNoticed />
      </div>
    </div>
  );
}
