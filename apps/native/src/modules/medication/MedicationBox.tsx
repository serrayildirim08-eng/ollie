/**
 * MedicationBox · /box/medication screen.
 *
 * Ported visually from the redesign/money-v2 web MedicationFace (apps/web/
 * src/modules/medication-v2/screens/MedicationFace.tsx) on 2026-05-28. The
 * web face is the live module hub (a take-circle hero, dose dots, a
 * notebook list of meds, drill rows). This native surface keeps the
 * editorial hero + notebook list but stays a review-and-cleanup screen —
 * the AI router still does all the writing.
 *
 * Visual structure:
 *   1. kicker + display title — section opener
 *   2. DoseHero — a large ink-outline circle showing today's most recent
 *      dose time (or "—" cold). DoseDots beneath show one sage dot per
 *      dose taken today, one amber-ring dot per missed dose. Empty state
 *      gets the cold-start dot-and-sentence invitation.
 *   3. your meds — notebook list of registered medications with last-dose
 *      timestamps, one per line in the editorial hairline grammar.
 *   4. missed doses — recent missed log (amber accent), with remove.
 *   5. side effects — recent side-effect notes, with remove.
 *
 * This is health data — tone is calm, no streaks, no scoring, no advice.
 *
 * Auto-refreshes on focus + every 6s so additions made from a dump while
 * the page is open show up. Polling stays in place — there is no
 * observable layer over SQLite yet.
 */

import { useCallback, useState } from 'react';
import { type CadenceEstimate } from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import {
  colors,
  fontSizes,
  fontWeights,
  letterSpacings,
} from '../../theme/tokens';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { PatternCards } from '../../patterns/PatternCards';
import { useModuleData } from '../../lib/useModuleData';
import { migrateMedication } from './migrate';
import {
  cadence as cadenceRepo,
  events as eventsRepo,
  medications as medsRepo,
} from './repo';
import {
  MEDICATION_KINDS,
  normaliseTime,
  type Medication,
  type MedicationEventWithName,
  type MedicationKind,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const RECENT_LIMIT = 8;

interface BoxState {
  meds: Medication[];
  lastDose: Record<string, number>;
  todayDoses: MedicationEventWithName[];
  todayMissed: MedicationEventWithName[];
  recentMissed: MedicationEventWithName[];
  recentSideEffects: MedicationEventWithName[];
  /** Cadence per med id — populated by fan-out alongside the main read. */
  doseCadence: Map<string, CadenceEstimate>;
}

const EMPTY_STATE: BoxState = {
  meds: [],
  lastDose: {},
  todayDoses: [],
  todayMissed: [],
  recentMissed: [],
  recentSideEffects: [],
  doseCadence: new Map(),
};

export function MedicationBox(): JSX.Element {
  const [state, setState] = useState<BoxState>(EMPTY_STATE);

  const refresh = useCallback(async () => {
    const startOfToday = startOfLocalDay(Date.now());
    const [meds, lastDose, todayDoses, todayMissed, recentMissed, recentSideEffects] =
      await Promise.all([
        medsRepo.list(),
        medsRepo.lastDoseMap(),
        eventsRepo.listByKindSince('dose', startOfToday),
        eventsRepo.listByKindSince('missed', startOfToday),
        eventsRepo.recentByKind('missed', RECENT_LIMIT),
        eventsRepo.recentByKind('side_effect', RECENT_LIMIT),
      ]);
    // Fan-out cadence reads — one per registered medication. Cheap: each
    // is a filtered range scan on (med_id, kind='dose').
    const cadencePairs = await Promise.all(
      meds.map(
        async (med) =>
          [med.id, await cadenceRepo.getDoseCadenceFor(med.id)] as const,
      ),
    );
    const doseCadence = new Map(cadencePairs);
    setState({
      meds,
      lastDose,
      todayDoses,
      todayMissed,
      recentMissed,
      recentSideEffects,
      doseCadence,
    });
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'medication',
    migrate: migrateMedication,
    refresh,
  });

  const handleRemoveMed = useCallback(
    async (id: string) => {
      await medsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const handleSaveProfile = useCallback(
    async (id: string, profile: { kind: MedicationKind; schedule: string[] }) => {
      await medsRepo.updateProfile(id, profile);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveEvent = useCallback(
    async (id: string) => {
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const isCold =
    state.meds.length === 0 &&
    state.todayDoses.length === 0 &&
    state.todayMissed.length === 0 &&
    state.recentMissed.length === 0 &&
    state.recentSideEffects.length === 0;

  // Most recent dose today drives the hero clock; if none yet, show "—".
  const latestToday = state.todayDoses[0] ?? null;
  const heroLabel = latestToday ? 'last dose today' : 'next dose';
  const heroTime = latestToday ? formatClock(latestToday.loggedAt) : '—';
  const heroName = latestToday ? latestToday.medName : 'nothing logged today';

  return (
    <Stack gap={48}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Medication</Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={48}>
          <DoseHero
            kicker={heroLabel}
            time={heroTime}
            name={heroName}
            dosesTaken={state.todayDoses.length}
            dosesMissed={state.todayMissed.length}
            cold={isCold}
          />

          {/* Layer-2 noticings — fed by the SQLite→store bridge + medication watcher. */}
          <PatternCards module="medication" />

          <NotebookList
            meds={state.meds}
            lastDose={state.lastDose}
            onRemove={(id) => void handleRemoveMed(id)}
            onSaveProfile={(id, p) => void handleSaveProfile(id, p)}
          />

          <ListSection
            label="missed doses"
            empty="none recent"
            items={state.recentMissed}
            accent={colors.amber}
            renderItem={(ev) => (
              <EventRow
                key={ev.id}
                title={ev.medName}
                detail={null}
                whenMs={ev.loggedAt}
                accentDot={colors.amber}
                onRemove={() => void handleRemoveEvent(ev.id)}
              />
            )}
          />

          <ListSection
            label="side effects"
            empty="none recent"
            items={state.recentSideEffects}
            renderItem={(ev) => (
              <EventRow
                key={ev.id}
                title={ev.medName}
                detail={ev.note}
                whenMs={ev.loggedAt}
                onRemove={() => void handleRemoveEvent(ev.id)}
              />
            )}
          />

          {isCold && (
            <Text
              scale="caption"
              color={colors.inkFaint}
              style={{ textAlign: 'center', lineHeight: 1.55 }}
            >
              no streaks, no scoring — just what you take, and when, kept for
              you and your doctor.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────
//
// Editorial centerpiece, ported from medication-v2's TakeCircle + DoseDots.
// Centered column: a small kicker line, the dose-time (oversized serif),
// the medication name in a calm sub-line, the ink-outline ring, then a
// row of dose dots (sage = taken, amber-ring = missed). Cold = "—" inside
// the ring + dashed placeholder dots + the sage invitation.
//
// This is a review surface — no tappable "take" affordance. The amber
// glow of the live web variant is intentionally dropped (writes belong
// to the brain-dump router on native). The amber ACCENT is preserved on
// the missed-dose dots so the visual language still says "amber = missed
// surface, sage = taken".

function DoseHero({
  kicker,
  time,
  name,
  dosesTaken,
  dosesMissed,
  cold,
}: {
  kicker: string;
  time: string;
  name: string;
  dosesTaken: number;
  dosesMissed: number;
  cold: boolean;
}): JSX.Element {
  return (
    <Stack gap={20} align="center">
      <div
        style={{
          fontSize: fontSizes.caption,
          color: colors.inkFaint,
          fontWeight: fontWeights.medium,
          letterSpacing: letterSpacings.capsTight,
          ...SMCP_STYLE,
        }}
      >
        {kicker}
      </div>

      <div
        style={{
          fontFamily: 'var(--ollie-font-serif)',
          fontSize: 34,
          fontWeight: fontWeights.light,
          color: colors.ink,
          letterSpacing: letterSpacings.display,
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {name}
      </div>

      <DoseRing time={time} cold={cold} />

      <DoseDots taken={dosesTaken} missed={dosesMissed} cold={cold} />

      {dosesTaken + dosesMissed > 0 && (
        <div
          style={{
            fontSize: fontSizes.small,
            color: colors.ink,
            fontWeight: fontWeights.medium,
            letterSpacing: '-0.01em',
          }}
        >
          <span style={{ color: colors.inkFaint }}>today —</span>{' '}
          {dosesTaken} {dosesTaken === 1 ? 'dose' : 'doses'} taken
          {dosesMissed > 0 && (
            <>
              <span style={{ color: colors.inkFaint }}>, </span>
              <span style={{ color: colors.amber }}>{dosesMissed} missed</span>
            </>
          )}
        </div>
      )}

      {cold && (
        <Row gap={9} align="start" style={{ marginTop: 4, maxWidth: 320 }}>
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: colors.sageDeep,
              flexShrink: 0,
              marginTop: 6,
            }}
          />
          <Text
            scale="body"
            style={{
              lineHeight: 1.45,
              letterSpacing: '-0.01em',
            }}
          >
            this is where your meds, vitamins and supplements live. dump
            &lsquo;20mg adderall at 9am&rsquo; and ollie keeps the log — no schedule
            needed, no streaks to chase.
          </Text>
        </Row>
      )}
    </Stack>
  );
}

/** The big ink-outline ring with the dose time inside. Decorative, not a button. */
function DoseRing({ time, cold }: { time: string; cold: boolean }): JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        boxSizing: 'border-box',
        width: 164,
        height: 164,
        borderRadius: '50%',
        border: `2px solid ${colors.hairline}`,
        background: colors.paper,
        boxShadow: '0 14px 34px rgba(20, 20, 15, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ollie-font-serif)',
          fontSize: cold ? 56 : 34,
          fontWeight: cold ? 200 : 300,
          color: cold ? colors.inkFaint : colors.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {time}
      </span>
    </div>
  );
}

/** Per-dose dots: sage = taken, amber outline = missed, dashed = cold. */
function DoseDots({
  taken,
  missed,
  cold,
}: {
  taken: number;
  missed: number;
  cold: boolean;
}): JSX.Element {
  const DOT = 13;
  const baseStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    width: DOT,
    height: DOT,
    borderRadius: '50%',
  };

  if (cold || (taken === 0 && missed === 0)) {
    return (
      <div
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 13,
        }}
      >
        {[0, 1].map((i) => (
          <span
            key={i}
            style={{
              ...baseStyle,
              background: 'transparent',
              border: `1.5px dashed ${colors.hairline}`,
            }}
          />
        ))}
      </div>
    );
  }

  // Cap rendered dots so the row never overflows on heavy days.
  const MAX_DOTS = 14;
  const dots: Array<'done' | 'missed'> = [
    ...Array<'done'>(taken).fill('done'),
    ...Array<'missed'>(missed).fill('missed'),
  ].slice(0, MAX_DOTS);
  const overflow = taken + missed - dots.length;

  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 240,
      }}
    >
      {dots.map((state, i) => {
        if (state === 'done') {
          return (
            <span
              key={i}
              style={{ ...baseStyle, background: colors.sageDeep }}
            />
          );
        }
        return (
          <span
            key={i}
            style={{
              ...baseStyle,
              border: `2.2px solid ${colors.amber}`,
              boxShadow: '0 4px 12px rgba(201, 146, 62, 0.24)',
            }}
          />
        );
      })}
      {overflow > 0 && (
        <span
          style={{
            fontSize: fontSizes.caption,
            color: colors.inkFaint,
            fontWeight: fontWeights.medium,
            letterSpacing: '0.02em',
            marginLeft: 2,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ─── notebook list — your meds ───────────────────────────────────────────

function NotebookList({
  meds,
  lastDose,
  onRemove,
  onSaveProfile,
}: {
  meds: Medication[];
  lastDose: Record<string, number>;
  onRemove: (id: string) => void;
  onSaveProfile: (
    id: string,
    profile: { kind: MedicationKind; schedule: string[] },
  ) => void;
}): JSX.Element {
  return (
    <Stack gap={4}>
      <SectionLabel>your meds</SectionLabel>

      {meds.length === 0 ? (
        // cold — one quiet placeholder line in the notebook grammar
        <div
          style={{
            borderTop: `1px solid ${colors.hairline}`,
            borderBottom: `1px solid ${colors.hairline}`,
            padding: '18px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <span
            aria-hidden
            style={{
              boxSizing: 'border-box',
              width: 9,
              height: 9,
              borderRadius: '50%',
              border: `1.5px dashed ${colors.hairline}`,
              flexShrink: 0,
            }}
          />
          <Text scale="body" color={colors.inkFaint}>
            no medications yet — your list will gather here
          </Text>
        </div>
      ) : (
        <div>
          {meds.map((med, i) => (
            <MedListRow
              key={med.id}
              med={med}
              lastDoseAt={lastDose[med.id] ?? null}
              first={i === 0}
              onRemove={() => onRemove(med.id)}
              onSaveProfile={(p) => onSaveProfile(med.id, p)}
            />
          ))}
        </div>
      )}
    </Stack>
  );
}

function MedListRow({
  med,
  lastDoseAt,
  first,
  onRemove,
  onSaveProfile,
}: {
  med: Medication;
  lastDoseAt: number | null;
  first: boolean;
  onRemove: () => void;
  onSaveProfile: (profile: { kind: MedicationKind; schedule: string[] }) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);

  // A calm one-line summary of the structured profile: kind, then the
  // schedule slots (or "no schedule" when manual-log-only).
  const scheduleSummary =
    med.schedule.length > 0
      ? med.schedule.map(formatSlot).join(' · ')
      : 'no schedule';

  return (
    <div
      style={{
        borderTop: `1px solid ${colors.hairline}`,
        borderBottom: first ? 'none' : 'none',
        padding: '16px 2px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: colors.sageDeep,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: fontSizes.small,
              color: colors.ink,
              fontWeight: fontWeights.medium,
              letterSpacing: '-0.01em',
            }}
          >
            {med.name}
            <span
              style={{
                color: colors.inkFaint,
                fontWeight: fontWeights.regular,
                marginLeft: 8,
                ...SMCP_STYLE,
              }}
            >
              {med.kind}
            </span>
          </div>
          <div
            style={{
              fontSize: fontSizes.caption,
              color: colors.inkFaint,
              fontWeight: fontWeights.medium,
              letterSpacing: '0.01em',
            }}
          >
            {scheduleSummary}
            <span style={{ margin: '0 6px' }}>·</span>
            {lastDoseAt != null
              ? `last dose ${formatRelative(lastDoseAt)}`
              : 'no doses logged'}
          </div>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          aria-label={editing ? 'close editor' : 'edit schedule'}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            color: colors.inkFaint,
            cursor: 'pointer',
            fontVariantCaps: 'all-small-caps',
            letterSpacing: '0.08em',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {editing ? 'done' : 'edit'}
        </button>
        <RemoveButton onClick={onRemove} />
      </div>

      {editing && (
        <MedProfileEditor
          med={med}
          onSave={(profile) => {
            onSaveProfile(profile);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

// ─── inline profile editor — kind + schedule ───────────────────────────────
//
// Expanded under a med row. Lets the user classify the med (kind chips) and
// build a daily schedule of HH:MM slots. Calm editorial grammar — sage chips
// for the active kind, hairline pills for slots, no red, no validation shame
// (an unparseable time simply doesn't add). Saving persists via the repo;
// once a schedule has a slot the watcher's "remaining doses" path lights up.

function MedProfileEditor({
  med,
  onSave,
}: {
  med: Medication;
  onSave: (profile: { kind: MedicationKind; schedule: string[] }) => void;
}): JSX.Element {
  const [kind, setKind] = useState<MedicationKind>(med.kind);
  const [slots, setSlots] = useState<string[]>(med.schedule);
  const [draft, setDraft] = useState('');

  const addSlot = useCallback(() => {
    const t = normaliseTime(draft);
    if (!t) return; // not a valid HH:MM — quietly ignore, no shame
    setSlots((prev) => (prev.includes(t) ? prev : [...prev, t].sort()));
    setDraft('');
  }, [draft]);

  const removeSlot = useCallback((t: string) => {
    setSlots((prev) => prev.filter((s) => s !== t));
  }, []);

  return (
    <Stack gap={16} style={{ paddingLeft: 21 }}>
      {/* kind chips */}
      <Stack gap={8}>
        <SectionLabel>kind</SectionLabel>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {MEDICATION_KINDS.map((k) => {
            const active = k === kind;
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                style={{
                  ...SMCP_STYLE,
                  border: `1px solid ${active ? colors.sageDeep : colors.hairline}`,
                  background: active ? colors.sageDeep : 'transparent',
                  color: active ? colors.paper : colors.ink,
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: fontWeights.medium,
                  cursor: 'pointer',
                }}
              >
                {k}
              </button>
            );
          })}
        </Row>
      </Stack>

      {/* schedule slots */}
      <Stack gap={8}>
        <SectionLabel>daily schedule</SectionLabel>
        {slots.length === 0 ? (
          <Text scale="caption" color={colors.inkFaint}>
            no times yet — add one below, or leave empty to log by hand
          </Text>
        ) : (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {slots.map((t) => (
              <span
                key={t}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: `1px solid ${colors.hairline}`,
                  borderRadius: 999,
                  padding: '5px 6px 5px 12px',
                  fontSize: fontSizes.caption,
                  color: colors.ink,
                  fontWeight: fontWeights.medium,
                }}
              >
                {formatSlot(t)}
                <button
                  onClick={() => removeSlot(t)}
                  aria-label={`remove ${t}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 4px',
                    color: colors.inkFaint,
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </Row>
        )}

        <Row gap={8} align="center">
          <input
            type="time"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSlot();
            }}
            aria-label="add a time"
            style={{
              border: `1px solid ${colors.hairline}`,
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: fontSizes.small,
              color: colors.ink,
              background: colors.paper,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={addSlot}
            style={{
              ...SMCP_STYLE,
              border: `1px solid ${colors.hairline}`,
              background: 'transparent',
              color: colors.ink,
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: fontWeights.medium,
              cursor: 'pointer',
            }}
          >
            add time
          </button>
        </Row>
      </Stack>

      <Row gap={12} align="center">
        <button
          onClick={() => onSave({ kind, schedule: slots })}
          style={{
            ...SMCP_STYLE,
            border: 'none',
            background: colors.ink,
            color: colors.paper,
            borderRadius: 8,
            padding: '9px 18px',
            fontSize: 12,
            fontWeight: fontWeights.medium,
            cursor: 'pointer',
            letterSpacing: '0.08em',
          }}
        >
          save
        </button>
      </Row>
    </Stack>
  );
}

/** "09:00" → "9:00am" — the same calm clock grammar as the rest of the box. */
function formatSlot(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const hh = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hh}:${m[2]}${ampm}`;
}

// ─── recent-events sections ──────────────────────────────────────────────

function ListSection<T>({
  label,
  empty,
  items,
  accent,
  renderItem,
}: {
  label: string;
  empty: string;
  items: T[];
  accent?: string;
  renderItem: (item: T) => JSX.Element;
}): JSX.Element {
  return (
    <Stack gap={4}>
      <SectionLabel accent={accent}>{label}</SectionLabel>
      {items.length === 0 ? (
        <div
          style={{
            borderTop: `1px solid ${colors.hairline}`,
            borderBottom: `1px solid ${colors.hairline}`,
            padding: '14px 2px',
          }}
        >
          <Text scale="body" color={colors.inkFaint}>
            {empty}
          </Text>
        </div>
      ) : (
        <div>{items.map(renderItem)}</div>
      )}
    </Stack>
  );
}

function EventRow({
  title,
  detail,
  whenMs,
  accentDot,
  onRemove,
}: {
  title: string;
  detail: string | null;
  whenMs: number;
  accentDot?: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        borderTop: `1px solid ${colors.hairline}`,
        padding: '14px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          boxSizing: 'border-box',
          width: 9,
          height: 9,
          borderRadius: '50%',
          border: accentDot ? `2px solid ${accentDot}` : 'none',
          background: accentDot ? 'transparent' : colors.inkFaint,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: fontSizes.small,
            color: colors.ink,
            fontWeight: fontWeights.medium,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
          {detail && (
            <span
              style={{
                color: colors.inkFaint,
                fontWeight: fontWeights.regular,
                marginLeft: 8,
              }}
            >
              · {detail}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: fontSizes.caption,
            color: colors.inkFaint,
            fontWeight: fontWeights.medium,
            letterSpacing: '0.01em',
          }}
        >
          {formatRelative(whenMs)}
        </div>
      </div>
      <RemoveButton onClick={onRemove} />
    </div>
  );
}

function SectionLabel({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
      }}
    >
      {accent && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: accent,
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          fontSize: 11,
          color: colors.inkFaint,
          fontWeight: fontWeights.bold,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </span>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label="remove"
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        color: colors.inkFaint,
        cursor: 'pointer',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      remove
    </button>
  );
}

// ─── format helpers ───────────────────────────────────────────────────────

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  const mm = m.toString().padStart(2, '0');
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hh}:${mm}${ampm}`;
}

/**
 * Thin alias over the shared `formatRelativeTime` formatter so the two
 * existing call-sites (notebook row "last dose …" caption + recent-event
 * row caption) continue to read cleanly. Same grammar as every other
 * Box's when-caption.
 */
function formatRelative(ms: number): string {
  return formatRelativeTime(ms);
}
