import React, { useState } from 'react';
import {
  TASK_DISPLAY,
  generateGuiltTripCopy,
  todayForecast,
  pickVocabTerm,
  isAdoptversary,
} from '@ollie/logic/pets';
import type {
  Pet,
  CareLogEntry,
  Observation,
  CareGap,
  PetHealthFlag,
  SpeciesProfile,
  Milestone,
} from '@ollie/logic/pets';
import { SourcesLink } from '../../components/SourcesLink';
import { PetPortrait } from './PetPortrait';
import { PetCareStrip } from './PetCareStrip';
import { PetObservationEntry } from './PetObservationEntry';

// ─── local helpers ────────────────────────────────────────────────────────────

/** Map null → undefined on nullable fields so the pure logic functions are happy. */
function toPet(p: PetCardProps['pet']): Pet {
  return {
    ...p,
    nickname: p.nickname ?? undefined,
  };
}

function fmtRelative(ts: number, now: number): string {
  if (!ts) return 'never';
  const days = Math.floor((now - ts) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── props ────────────────────────────────────────────────────────────────────

export interface PetCardState {
  care_log: CareLogEntry[];
  observations: Observation[];
  care_gaps: CareGap[];
  health_flags: Array<PetHealthFlag & { id: string; pet_id: string; status: string; detected_at: number; source_url: string }>;
  settings: { guilt_voice?: string };
}

interface PetCardProps {
  pet: Omit<Pet, 'nickname'> & {
    cohabits_with?: string[];
    nickname?: string | null;
    notes?: string | null;
    archived?: boolean;
  };
  state: PetCardState;
  speciesProfile: SpeciesProfile;
  now: number;
  onLogManual: (petId: string, task: string) => void;
  onArchive: (petId: string) => void;
  onReviewFlag: (flagId: string) => void;
  onRecordObservation: (observation: Observation) => void;
  dailyForecast?: Record<string, string>;
  milestones?: Milestone[];
  vocabShown?: Record<string, string[]>;
  away: { active: boolean; returning_at: number | null };
}

// Severity colours stay within the notebook palette: ember for firm/concerned,
// ink-soft for nudge/soft.
const SEVERITY_COLOR: Record<string, string> = {
  nudge: 'var(--ink-soft)',
  soft: 'var(--ink)',
  firm: 'var(--umber)',
  concerned: 'var(--umber)',
};

export function PetCard({
  pet,
  state,
  speciesProfile,
  now,
  onLogManual,
  onArchive,
  onReviewFlag,
  onRecordObservation,
  dailyForecast,
  milestones = [],
  vocabShown = {},
  away,
}: PetCardProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [recentClick, setRecentClick] = useState<Record<string, number>>({});

  const taskKeys = Object.keys(speciesProfile.care_tasks || {});

  const petLog = state.care_log.filter((e) => e.pet_id === pet.id);
  const petObs = state.observations
    .filter((o) => o.pet_id === pet.id)
    .sort((a, b) => (b.occurred_at ?? 0) - (a.occurred_at ?? 0))
    .slice(0, 3);
  const petGaps = (state.care_gaps || []).filter((g) => g.pet_id === pet.id);
  const petFlags = (state.health_flags || []).filter(
    (f) => f.pet_id === pet.id && f.status !== 'dismissed',
  );

  const rankOf = (sev: string) =>
    ({ nudge: 1, soft: 2, firm: 3, concerned: 4 }[sev] ?? 0);
  const dueRows = petGaps
    .filter((g) => g.severity !== 'ok')
    .sort((a, b) => rankOf(b.severity) - rankOf(a.severity));

  const paired =
    pet.cohabits_with && pet.cohabits_with.length > 0 ? 'bonded pair' : 'solo';

  const petAsBase = toPet(pet);

  const forecastLine =
    (dailyForecast || {})[pet.id] ??
    todayForecast(petAsBase, petGaps, speciesProfile);

  const vocab = pickVocabTerm(petAsBase, vocabShown, speciesProfile, now);
  const yearsAnniversary = isAdoptversary(petAsBase, now);
  const petMilestones = milestones
    .filter((m) => m.pet_id === pet.id)
    .sort((a, b) => b.first_seen_at - a.first_seen_at)
    .slice(0, 3);

  const awayActive = !!(away && away.active);

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

  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 4,
        padding: 28,
        filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.03))',
        boxSizing: 'border-box',
      }}
    >
      {/* Today forecast */}
      {forecastLine && (
        <p
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--umber)',
            margin: '0 0 20px 0',
            fontWeight: 500,
          }}
        >
          {forecastLine}
        </p>
      )}

      {/* Card head: portrait + name block */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '88px 1fr',
          gap: 20,
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <PetPortrait species={pet.species} />
        <div>
          <p
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--ink)',
              margin: '0 0 6px 0',
              letterSpacing: '-0.005em',
            }}
          >
            {pet.name}
          </p>
          <p
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              margin: 0,
            }}
          >
            {speciesProfile.display_name.toUpperCase()} · {paired}
          </p>
          {yearsAnniversary !== null && pet.adopted_at && (
            <p
              style={{
                fontFamily: "'Spectral', serif",
                fontSize: 12,
                fontStyle: 'italic',
                color: 'var(--ink-soft)',
                margin: '6px 0 0 0',
              }}
            >
              {yearsAnniversary === 1 ? 'one year together' : `${yearsAnniversary} years together`}{' '}
              —{' '}
              {new Date(pet.adopted_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              }).toLowerCase()}
            </p>
          )}
        </div>
      </div>

      <hr
        style={{
          border: 'none',
          borderTop: '1px solid var(--rule)',
          margin: '0 0 20px 0',
        }}
      />

      {/* Care history strip */}
      <p style={sectionLabel}>care — last 30 days</p>
      <PetCareStrip petId={pet.id} careLog={petLog} tasks={taskKeys} now={now} />

      {/* Due now */}
      <p style={sectionLabel}>due now</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
        {dueRows.length === 0 ? (
          <li
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 14,
              alignItems: 'baseline',
              padding: '10px 0',
              borderBottom: '1px solid var(--rule)',
              fontFamily: "'Spectral', serif",
              fontSize: 14,
              color: 'var(--ink)',
            }}
          >
            <span style={{ color: 'var(--ink-faint)', fontFamily: "'DM Mono', monospace", fontSize: 11 }}>·</span>
            <span style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>all current.</span>
          </li>
        ) : (
          dueRows.map((g) => {
            const taskProfile = speciesProfile.care_tasks[g.task] || {};
            const display = TASK_DISPLAY[g.task] || g.task.replace(/_/g, ' ');
            const daysInt = g.days_since === null ? '—' : Math.floor(g.days_since);
            const copy = generateGuiltTripCopy(g, petAsBase, speciesProfile);
            const hasCopy =
              state.settings.guilt_voice !== 'off' && copy.text && !awayActive;
            const isConcerned = g.severity === 'concerned' || g.severity === 'firm';

            return (
              <li
                key={`${pet.id}-${g.task}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  gap: 14,
                  alignItems: 'baseline',
                  padding: '10px 0',
                  paddingLeft: isConcerned ? 8 : 0,
                  borderBottom: '1px solid var(--rule)',
                  background: isConcerned ? 'rgba(138,75,44,0.06)' : 'transparent',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  color: 'var(--ink)',
                }}
              >
                <span
                  style={{
                    color: 'var(--ink-faint)',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                  }}
                >
                  ·
                </span>
                <span>{display}</span>
                <span
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 13,
                    color: 'var(--ink-soft)',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}
                >
                  {daysInt === '—' ? 'never' : `${daysInt}d ago`}
                  {' · cadence '}
                  {'cadence_days' in taskProfile ? (taskProfile as { cadence_days: number }).cadence_days : ''}d
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'lowercase',
                    color: SEVERITY_COLOR[g.severity] ?? 'var(--ink-soft)',
                    fontWeight: isConcerned ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  • {g.severity}
                </span>
                {hasCopy && copy.text && (
                  <span
                    style={{
                      gridColumn: '1 / -1',
                      fontFamily: "'Spectral', serif",
                      fontSize: 12,
                      fontStyle: 'italic',
                      color: 'var(--ink-soft)',
                      margin: '4px 0 6px 18px',
                    }}
                  >
                    {copy.text}
                  </span>
                )}
              </li>
            );
          })
        )}
      </ul>

      {/* Observations */}
      {petObs.length > 0 && (
        <>
          <p style={sectionLabel}>recent observations</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
            {petObs.map((o) => (
              <li
                key={o.pet_id + (o.occurred_at ?? '')}
                style={{
                  padding: '8px 0',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  fontStyle: 'italic',
                  lineHeight: 1.55,
                  color: 'var(--ink)',
                }}
              >
                "{o.text}"
                <span
                  style={{
                    fontFamily: "'Spectral', serif",
                    fontSize: 12,
                    color: 'var(--ink-faint)',
                    fontStyle: 'normal',
                    marginLeft: 8,
                  }}
                >
                  — {fmtRelative(o.occurred_at ?? 0, now)}
                </span>
                {o.tags && o.tags.length > 0 && (
                  <span style={{ display: 'inline-flex', gap: 6, marginLeft: 10 }}>
                    {o.tags
                      .filter((tag) => !tag.startsWith('pending_intent:'))
                      .map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 9,
                            letterSpacing: '0.1em',
                            textTransform: 'lowercase',
                            color: '#4F6E5B',
                            border: '1px solid #4F6E5B',
                            padding: '3px 6px',
                            borderRadius: 2,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Bonding */}
      <p style={sectionLabel}>bonding</p>
      <p
        style={{
          fontFamily: "'Spectral', serif",
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--ink)',
          margin: '0 0 24px 0',
        }}
      >
        {speciesProfile.bonding?.build_rate === 'slow' &&
          `slow-build species. ${speciesProfile.bonding.forget_window_days} days of quiet resets the ladder. ${speciesProfile.bonding.min_daily_minutes} min/day is the floor.`}
        {speciesProfile.bonding?.build_rate === 'fast' &&
          `fast-bonding species. ${speciesProfile.bonding.min_daily_minutes} min/day keeps the connection fresh.`}
        {speciesProfile.bonding?.build_rate === 'variable' &&
          `bonding varies cat-to-cat. ${speciesProfile.bonding.min_daily_minutes} min/day of quiet presence is a safe floor.`}
      </p>

      {/* Health flags */}
      <p style={sectionLabel}>health</p>
      {petFlags.length === 0 ? (
        <p
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: 14,
            fontStyle: 'italic',
            color: 'var(--ink-faint)',
            margin: '0 0 24px 0',
          }}
        >
          nothing flagged.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
          {petFlags.map((f) => {
            const flagConfig = (speciesProfile.health_flags || {})[f.flag] || {};
            return (
              <li
                key={f.id}
                style={{
                  padding: '8px 0',
                  fontFamily: "'Spectral', serif",
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink)',
                }}
              >
                {f.flag.replace(/_/g, ' ')} — observed across {f.run_length} days.{' '}
                {'welfare_note' in flagConfig && flagConfig.welfare_note
                  ? (flagConfig as { welfare_note: string }).welfare_note
                  : 'consider a vet visit.'}
                {f.source_url && (
                  <>
                    {' '}
                    <SourcesLink sources={[f.source_url]} label="source" />
                  </>
                )}
                {f.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => onReviewFlag(f.id)}
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
                      marginLeft: 8,
                      minHeight: 44,
                    }}
                  >
                    mark as reviewed
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Milestones */}
      {petMilestones.length > 0 && (
        <>
          <p style={sectionLabel}>milestones</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
            {petMilestones.map((m) => (
              <li
                key={`${m.pet_id}:${m.tag}`}
                style={{
                  padding: '4px 0',
                  fontFamily: "'Spectral', serif",
                  fontSize: 13,
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                  color: 'var(--ink-soft)',
                }}
              >
                first recorded {m.tag} —{' '}
                {new Date(m.first_seen_at)
                  .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  .toLowerCase()}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Vocab term */}
      {vocab && (
        <p
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: 12,
            fontStyle: 'italic',
            lineHeight: 1.55,
            color: 'var(--ink-faint)',
            padding: '14px 0 0 0',
            borderTop: '1px solid var(--rule)',
            margin: '20px 0 16px 0',
          }}
        >
          <span style={{ fontStyle: 'normal', fontWeight: 500 }}>{vocab.term}:</span>{' '}
          {vocab.gloss}
        </p>
      )}

      {/* Card actions */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingTop: 16,
          borderTop: '1px solid var(--rule)',
        }}
      >
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
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
          {manualOpen ? 'close' : 'log care manually'}
        </button>
        <span style={{ color: 'var(--ink-faint)', alignSelf: 'center' }}>·</span>
        <PetObservationEntry
          petId={pet.id}
          speciesProfile={speciesProfile}
          onRecord={onRecordObservation}
        />
        <span style={{ color: 'var(--ink-faint)', alignSelf: 'center' }}>·</span>
        <button
          type="button"
          onClick={() => {
            // eslint-disable-next-line no-alert
            if (confirm(`archive ${pet.name}? they stay in the log, you just stop being reminded.`)) {
              onArchive(pet.id);
            }
          }}
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
          archive
        </button>
      </div>

      {/* Manual log panel */}
      {manualOpen && (
        <div
          style={{
            background: 'var(--bone)',
            border: '1px solid var(--rule)',
            padding: 16,
            marginTop: 12,
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {taskKeys.map((task) => {
              const display = TASK_DISPLAY[task] || task.replace(/_/g, ' ');
              const isRecent = !!recentClick[task];
              return (
                <button
                  key={task}
                  type="button"
                  onClick={() => {
                    onLogManual(pet.id, task);
                    setRecentClick((prev) => ({ ...prev, [task]: Date.now() }));
                    setTimeout(
                      () =>
                        setRecentClick((prev) => {
                          const { [task]: _removed, ...rest } = prev;
                          return rest;
                        }),
                      60_000,
                    );
                  }}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${isRecent ? 'var(--ink)' : 'var(--rule)'}`,
                    color: 'var(--ink)',
                    padding: '10px 14px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'lowercase',
                    borderRadius: 2,
                    minHeight: 44,
                    cursor: 'pointer',
                  }}
                >
                  {display}{isRecent ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
