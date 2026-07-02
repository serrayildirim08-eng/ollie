/**
 * MedicationBox · /box/medication screen.
 *
 * Two tabs (rooms redesign · Health room, 2026-06-24):
 *   - TODAY   — the schedule. Scheduled doses grouped morning / evening, a
 *               soft tick = taken, an "N of M taken" count. As-needed meds are
 *               NOT pre-listed (they're logged via dump); a calm one-liner
 *               points there instead.
 *   - CABINET — the stock inventory, grouped BY PURPOSE in collapsible
 *               accordions (olive dot + count + amber low-dot), each row an
 *               olive pill + name + dose + a "running low / have" affordance.
 *               A per-screen dump-bar hint sits at the bottom.
 *
 * The AI router still does all the writing — taps here are review affordances
 * (tick a scheduled dose, flip a low flag). This is health data: calm tone, no
 * streaks, no scoring, no advice.
 *
 * Auto-refreshes on focus + every 6s (no observable layer over SQLite yet).
 */

import { useCallback, useMemo, useState } from 'react';
import { type CadenceEstimate } from '@ollie/cadence';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors, fontSizes, fontWeights, shadows } from '../../theme/tokens';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { PatternCards } from '../../patterns/PatternCards';
import { useModuleData } from '../../lib/useModuleData';
import { migrateMedication } from './migrate';
import {
  cabinet as cabinetRepo,
  cadence as cadenceRepo,
  events as eventsRepo,
  medications as medsRepo,
} from './repo';
import { isLow, daysOfSupply } from './lowStock';
import { doseStateForIndex, type DoseState } from './doseState';
import { PURPOSE_ORDER, type MedPurpose } from './purposeMap';
import {
  normaliseName,
  type CabinetItem,
  type Medication,
  type MedicationEventWithName,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const RECENT_LIMIT = 8;

type Tab = 'today' | 'cabinet';

interface BoxState {
  meds: Medication[];
  cabinet: CabinetItem[];
  lastDose: Record<string, number>;
  todayDoses: MedicationEventWithName[];
  todayMissed: MedicationEventWithName[];
  todayLater: MedicationEventWithName[];
  todaySkipped: MedicationEventWithName[];
  recentMissed: MedicationEventWithName[];
  recentSideEffects: MedicationEventWithName[];
  /** Cadence per med id — populated by fan-out alongside the main read. */
  doseCadence: Map<string, CadenceEstimate>;
}

const EMPTY_STATE: BoxState = {
  meds: [],
  cabinet: [],
  lastDose: {},
  todayDoses: [],
  todayMissed: [],
  todayLater: [],
  todaySkipped: [],
  recentMissed: [],
  recentSideEffects: [],
  doseCadence: new Map(),
};

export function MedicationBox(): JSX.Element {
  const [state, setState] = useState<BoxState>(EMPTY_STATE);
  const [tab, setTab] = useState<Tab>('today');

  const refresh = useCallback(async () => {
    const startOfToday = startOfLocalDay(Date.now());
    const [
      meds,
      cabinet,
      lastDose,
      todayDoses,
      todayMissed,
      todayLater,
      todaySkipped,
      recentMissed,
      recentSideEffects,
    ] = await Promise.all([
      medsRepo.list(),
      cabinetRepo.list(),
      medsRepo.lastDoseMap(),
      eventsRepo.listByKindSince('dose', startOfToday),
      eventsRepo.listByKindSince('missed', startOfToday),
      eventsRepo.listByKindSince('later', startOfToday),
      eventsRepo.listByKindSince('skipped', startOfToday),
      eventsRepo.recentByKind('missed', RECENT_LIMIT),
      eventsRepo.recentByKind('side_effect', RECENT_LIMIT),
    ]);
    const cadencePairs = await Promise.all(
      meds.map(
        async (med) =>
          [med.id, await cadenceRepo.getDoseCadenceFor(med.id)] as const,
      ),
    );
    const doseCadence = new Map(cadencePairs);
    setState({
      meds,
      cabinet,
      lastDose,
      todayDoses,
      todayMissed,
      todayLater,
      todaySkipped,
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

  // Tick a scheduled dose — logs a dose event (which the today tab reads back
  // as "taken") + counts the cabinet down for that med.
  const handleTake = useCallback(
    async (medName: string, alreadyTaken: boolean) => {
      // Idempotent: re-tapping an already-taken dose must NOT log another dose
      // event or decrement the cabinet again (would double-count + over-deplete).
      if (alreadyTaken) return;
      await eventsRepo.logDose({ medName });
      await cabinetRepo.decrementOnTaken(medName);
      await refresh();
    },
    [refresh],
  );

  // "later" / "skip today" — set a due dose aside. Neither decrements the
  // cabinet (nothing was taken); both are today-scoped events the today tab
  // reads back to mark the slot. Calm, no shame.
  const handleLater = useCallback(
    async (medName: string) => {
      await eventsRepo.logLater({ medName });
      await refresh();
    },
    [refresh],
  );

  const handleSkip = useCallback(
    async (medName: string) => {
      await eventsRepo.logSkipped({ medName });
      await refresh();
    },
    [refresh],
  );

  const handleSetLow = useCallback(
    async (id: string, low: boolean) => {
      await cabinetRepo.setLow(id, low);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveCabinet = useCallback(
    async (id: string) => {
      await cabinetRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
        </Text>
        <Text
          scale="title"
          color={colors.ink}
          style={{
            fontFamily: 'var(--ollie-font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          medication
        </Text>
      </Stack>

      <TabSwitch tab={tab} onChange={setTab} />

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : tab === 'today' ? (
        <TodayTab
          meds={state.meds}
          todayDoses={state.todayDoses}
          todayMissed={state.todayMissed}
          todayLater={state.todayLater}
          todaySkipped={state.todaySkipped}
          recentMissed={state.recentMissed}
          recentSideEffects={state.recentSideEffects}
          onTake={(name, alreadyTaken) => void handleTake(name, alreadyTaken)}
          onLater={(name) => void handleLater(name)}
          onSkip={(name) => void handleSkip(name)}
        />
      ) : (
        <CabinetTab
          items={state.cabinet}
          meds={state.meds}
          onSetLow={(id, low) => void handleSetLow(id, low)}
          onRemove={(id) => void handleRemoveCabinet(id)}
        />
      )}
    </Stack>
  );
}

// ─── tab switch ─────────────────────────────────────────────────────────────

function TabSwitch({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }): JSX.Element {
  return (
    <Row
      gap={0}
      align="center"
      style={{
        background: colors.cream,
        borderRadius: 999,
        boxShadow: shadows.inset,
        padding: 4,
        alignSelf: 'flex-start',
      }}
    >
      {(['today', 'cabinet'] as const).map((t) => {
        const active = t === tab;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            aria-pressed={active}
            style={{
              ...SMCP_STYLE,
              border: 'none',
              background: active ? colors.sageDeep : 'transparent',
              color: active ? colors.paper : colors.inkFaint,
              borderRadius: 999,
              padding: '7px 20px',
              fontSize: 12,
              fontWeight: fontWeights.medium,
              cursor: 'pointer',
              boxShadow: active ? shadows.raisedSm : 'none',
            }}
          >
            {t}
          </button>
        );
      })}
    </Row>
  );
}

// ─── TODAY tab — the schedule ────────────────────────────────────────────────
//
// Scheduled doses only, grouped morning (<12:00) / evening (≥12:00). A dose is
// "taken" when there's a dose event for that med today; the tick reflects it.
// As-needed meds (no schedule) are NOT pre-listed — a calm one-liner instead.

interface ScheduledDose {
  medId: string;
  medName: string;
  slot: string; // "HH:MM"
  state: DoseState;
}

function TodayTab({
  meds,
  todayDoses,
  todayMissed,
  todayLater,
  todaySkipped,
  recentMissed,
  recentSideEffects,
  onTake,
  onLater,
  onSkip,
}: {
  meds: Medication[];
  todayDoses: MedicationEventWithName[];
  todayMissed: MedicationEventWithName[];
  todayLater: MedicationEventWithName[];
  todaySkipped: MedicationEventWithName[];
  recentMissed: MedicationEventWithName[];
  recentSideEffects: MedicationEventWithName[];
  onTake: (medName: string, alreadyTaken: boolean) => void;
  onLater: (medName: string) => void;
  onSkip: (medName: string) => void;
}): JSX.Element {
  // Per-med counts of what happened today. Slots are assigned states in a
  // stable order (taken → skipped → later → due), so counts map onto concrete
  // rows without tracking a specific slot per event.
  const countByName = useCallback(
    (events: MedicationEventWithName[]) => {
      const m = new Map<string, number>();
      for (const ev of events) {
        const k = normaliseName(ev.medName);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    },
    [],
  );
  const takenCountByName = useMemo(() => countByName(todayDoses), [countByName, todayDoses]);
  const laterCountByName = useMemo(() => countByName(todayLater), [countByName, todayLater]);
  const skippedCountByName = useMemo(() => countByName(todaySkipped), [countByName, todaySkipped]);

  const { morning, evening } = useMemo(() => {
    const m: ScheduledDose[] = [];
    const e: ScheduledDose[] = [];
    for (const med of meds) {
      const slots = [...med.schedule].sort((a, b) => a.localeCompare(b));
      const key = normaliseName(med.name);
      const counts = {
        taken: takenCountByName.get(key) ?? 0,
        skipped: skippedCountByName.get(key) ?? 0,
        later: laterCountByName.get(key) ?? 0,
      };
      slots.forEach((slot, i) => {
        const dose: ScheduledDose = {
          medId: med.id,
          medName: med.name,
          slot,
          state: doseStateForIndex(i, counts),
        };
        if (hourOf(slot) < 12) m.push(dose);
        else e.push(dose);
      });
    }
    const bySlot = (a: ScheduledDose, b: ScheduledDose) => a.slot.localeCompare(b.slot);
    return { morning: m.sort(bySlot), evening: e.sort(bySlot) };
  }, [meds, takenCountByName, skippedCountByName, laterCountByName]);

  const total = morning.length + evening.length;
  const takenCount = [...morning, ...evening].filter((d) => d.state === 'taken').length;
  const asNeededCount = meds.filter((m) => m.schedule.length === 0).length;

  return (
    <Stack gap={32}>
      {/* the "N of M taken" count line */}
      {total > 0 ? (
        <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
          <strong style={{ color: colors.ink, fontWeight: 600 }}>
            {takenCount} of {total}
          </strong>{' '}
          taken today
          {todayMissed.length > 0 && (
            <span style={{ color: colors.amber, fontWeight: 600 }}>
              {' · '}
              {todayMissed.length} missed
            </span>
          )}
        </Text>
      ) : null}

      {total === 0 ? (
        <ColdSchedule asNeededCount={asNeededCount} />
      ) : (
        <Stack gap={20}>
          {morning.length > 0 && (
            <DoseGroup label="morning" doses={morning} onTake={onTake} onLater={onLater} onSkip={onSkip} />
          )}
          {evening.length > 0 && (
            <DoseGroup label="evening" doses={evening} onTake={onTake} onLater={onLater} onSkip={onSkip} />
          )}
        </Stack>
      )}

      {/* As-needed: a calm one-liner, never a pre-list. */}
      {asNeededCount > 0 && total > 0 && (
        <Text scale="caption" color={colors.inkFaint} style={{ lineHeight: 1.5 }}>
          plus {asNeededCount} as-needed{' '}
          {asNeededCount === 1 ? 'med' : 'meds'} — just dump &ldquo;took
          ibuprofen&rdquo; when you do.
        </Text>
      )}

      {/* Layer-2 noticings — fed by the SQLite→store bridge + medication watcher. */}
      <PatternCards module="medication" />

      {recentMissed.length > 0 && (
        <Text scale="caption" color={colors.inkFaint} style={{ lineHeight: 1.5, marginBottom: -8 }}>
          missed — no shame, just noted.
        </Text>
      )}
      <ListSection
        label="missed doses"
        empty="none recent"
        items={recentMissed}
        accent={colors.amber}
        renderItem={(ev) => (
          <EventRow
            key={ev.id}
            title={ev.medName}
            detail={null}
            whenMs={ev.loggedAt}
            accentDot={colors.amber}
          />
        )}
      />

      <ListSection
        label="side effects"
        empty="none recent"
        items={recentSideEffects}
        renderItem={(ev) => (
          <EventRow key={ev.id} title={ev.medName} detail={ev.note} whenMs={ev.loggedAt} />
        )}
      />
    </Stack>
  );
}

function DoseGroup({
  label,
  doses,
  onTake,
  onLater,
  onSkip,
}: {
  label: string;
  doses: ScheduledDose[];
  onTake: (medName: string, alreadyTaken: boolean) => void;
  onLater: (medName: string) => void;
  onSkip: (medName: string) => void;
}): JSX.Element {
  const dueCount = doses.filter((d) => d.state === 'due').length;
  return (
    <Stack gap={10}>
      <Row gap={8} align="center">
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: '50%', background: colors.sageDeep, flexShrink: 0 }}
        />
        <Text
          scale="caption"
          color={colors.inkSoft}
          style={{ ...SMCP_STYLE, fontWeight: 600 }}
        >
          {label}
        </Text>
        {dueCount > 0 && (
          <Text scale="caption" color={colors.inkFaint}>
            {dueCount} due
          </Text>
        )}
      </Row>
      <Stack gap={10}>
        {doses.map((d) => (
          <DoseRow
            key={`${d.medId}-${d.slot}`}
            dose={d}
            onTake={() => onTake(d.medName, d.state === 'taken')}
            onLater={() => onLater(d.medName)}
            onSkip={() => onSkip(d.medName)}
          />
        ))}
      </Stack>
    </Stack>
  );
}

/** Small SMCP text action shared by the "later" / "skip" affordances. */
function DoseAction({
  label,
  onClick,
  color,
}: {
  label: string;
  onClick: () => void;
  color: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...SMCP_STYLE,
        border: 'none',
        background: 'transparent',
        color,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        padding: '2px 2px',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

function DoseRow({
  dose,
  onTake,
  onLater,
  onSkip,
}: {
  dose: ScheduledDose;
  onTake: () => void;
  onLater: () => void;
  onSkip: () => void;
}): JSX.Element {
  const { state } = dose;
  const taken = state === 'taken';
  // A skipped dose has no tick — it wasn't and won't be taken today. Taken,
  // later and due all keep the tick (a "later" dose can still be taken now).
  const showTick = state !== 'skipped';
  const dim = state === 'skipped' || state === 'later';

  return (
    <Box
      bg="cream"
      radius="card"
      shadow="raised"
      style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}
    >
      {showTick ? (
        <TickCircle done={taken} onClick={onTake} label={`mark ${dose.medName} taken`} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            flexShrink: 0,
            background: colors.cream,
            boxShadow:
              'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: fontSizes.small,
            color: taken || dim ? colors.inkFaint : colors.ink,
            fontWeight: fontWeights.medium,
            letterSpacing: '-0.01em',
            textDecoration: taken ? 'line-through' : 'none',
          }}
        >
          {dose.medName}
        </span>
      </div>

      {state === 'due' ? (
        <Row gap={12} align="center" style={{ flexShrink: 0 }}>
          <DoseAction label="later" onClick={onLater} color={colors.inkFaint} />
          <DoseAction label="skip" onClick={onSkip} color={colors.inkFaint} />
        </Row>
      ) : state === 'skipped' ? (
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          skipped
        </Text>
      ) : state === 'later' ? (
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          later
        </Text>
      ) : (
        <Text scale="caption" color={colors.inkFaint}>
          {formatSlot(dose.slot)}
        </Text>
      )}
    </Box>
  );
}

function ColdSchedule({ asNeededCount }: { asNeededCount: number }): JSX.Element {
  return (
    <Stack gap={9} align="start" style={{ maxWidth: 360 }}>
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        nothing scheduled
      </Text>
      <Row gap={9} align="start">
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
        <Text scale="body" style={{ lineHeight: 1.5 }}>
          {asNeededCount > 0
            ? `you keep ${asNeededCount} as-needed ${asNeededCount === 1 ? 'med' : 'meds'} — set a time on one in the cabinet to see it here, or just dump “took my magnesium”.`
            : 'dump “started magnesium 400mg at night for sleep” and it lands here on a schedule.'}
        </Text>
      </Row>
    </Stack>
  );
}

// ─── CABINET tab — stock by purpose ──────────────────────────────────────────

function CabinetTab({
  items,
  meds,
  onSetLow,
  onRemove,
}: {
  items: CabinetItem[];
  meds: Medication[];
  onSetLow: (id: string, low: boolean) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  // doses-per-day per normalised med name, from the schedule registry — feeds
  // the auto count-down read for the low check + the "~N days left" sub-line.
  const perDayByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const med of meds) m.set(normaliseName(med.name), med.schedule.length);
    return m;
  }, [meds]);

  const grouped = useMemo(() => {
    const byPurpose = new Map<MedPurpose, CabinetItem[]>();
    for (const it of items) {
      const bucket = byPurpose.get(it.purpose);
      if (bucket) bucket.push(it);
      else byPurpose.set(it.purpose, [it]);
    }
    return byPurpose;
  }, [items]);

  const lowCount = useMemo(
    () =>
      items.filter((it) =>
        isLow({
          lowFlag: it.lowFlag,
          qty: it.qty,
          dosesPerDay: perDayByName.get(it.name) ?? 0,
        }),
      ).length,
    [items, perDayByName],
  );

  if (items.length === 0) {
    return (
      <Stack gap={20}>
        <ColdCabinet />
        <DumpBarHint />
      </Stack>
    );
  }

  return (
    <Stack gap={20}>
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        <strong style={{ color: colors.ink, fontWeight: 600 }}>{items.length}</strong>
        {items.length === 1 ? ' thing' : ' things'}
        {lowCount > 0 && (
          <span style={{ color: colors.amber, fontWeight: 600 }}>
            {' · '}
            {lowCount} running low
          </span>
        )}
      </Text>

      <Stack gap={12}>
        {PURPOSE_ORDER.map(({ key, label }) => {
          const bucket = grouped.get(key);
          if (!bucket || bucket.length === 0) return null;
          const hasLow = bucket.some((it) =>
            isLow({ lowFlag: it.lowFlag, qty: it.qty, dosesPerDay: perDayByName.get(it.name) ?? 0 }),
          );
          return (
            <PurposeAccordion key={key} label={label} count={bucket.length} hasLow={hasLow}>
              <Stack gap={10}>
                {bucket.map((it) => (
                  <CabinetRow
                    key={it.id}
                    item={it}
                    dosesPerDay={perDayByName.get(it.name) ?? 0}
                    onSetLow={(low) => onSetLow(it.id, low)}
                    onRemove={() => onRemove(it.id)}
                  />
                ))}
              </Stack>
            </PurposeAccordion>
          );
        })}
      </Stack>

      <DumpBarHint />
    </Stack>
  );
}

function PurposeAccordion({
  label,
  count,
  hasLow,
  children,
}: {
  label: string;
  count: number;
  hasLow: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <Stack gap={open ? 12 : 0}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          padding: '6px 2px',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <Row gap={9} align="center">
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: colors.sageDeep, flexShrink: 0 }}
          />
          <Text
            scale="caption"
            color={colors.inkSoft}
            style={{ ...SMCP_STYLE, fontWeight: 600 }}
          >
            {label}
          </Text>
          <Text scale="caption" color={colors.inkFaint}>
            {count}
          </Text>
          {hasLow && (
            <span
              aria-label="running low"
              style={{ width: 6, height: 6, borderRadius: '50%', background: colors.amber, flexShrink: 0 }}
            />
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 10 10"
              aria-hidden
              style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 200ms cubic-bezier(0.18, 0, 0.22, 1)',
              }}
            >
              <path
                d="M3 1.5 L6.5 5 L3 8.5"
                fill="none"
                stroke={colors.inkFaint}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Row>
      </button>
      {open && children}
    </Stack>
  );
}

function CabinetRow({
  item,
  dosesPerDay,
  onSetLow,
  onRemove,
}: {
  item: CabinetItem;
  dosesPerDay: number;
  onSetLow: (low: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const low = isLow({ lowFlag: item.lowFlag, qty: item.qty, dosesPerDay });
  const days = daysOfSupply({ lowFlag: item.lowFlag, qty: item.qty, dosesPerDay });

  // Sub-line: dose label + (if computable) "~N days left".
  const meta = [
    item.doseLabel,
    item.qty != null ? `${item.qty} left` : null,
    days != null ? `~${days}d` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box
      bg="cream"
      radius="card"
      shadow="raised"
      style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: colors.sageDeep,
          boxShadow:
            'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: fontSizes.small,
            color: colors.ink,
            fontWeight: fontWeights.medium,
            letterSpacing: '-0.01em',
          }}
        >
          {item.name}
        </span>
        {meta && (
          <span style={{ fontSize: fontSizes.caption, color: colors.inkFaint }}>{meta}</span>
        )}
      </div>

      {/* low / have toggle — the manual override */}
      <button
        type="button"
        onClick={() => onSetLow(!item.lowFlag)}
        aria-pressed={item.lowFlag}
        aria-label={item.lowFlag ? 'mark have' : 'mark running low'}
        style={{
          ...SMCP_STYLE,
          border: 'none',
          background: 'transparent',
          color: low ? colors.amber : colors.inkFaint,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
          padding: '4px 4px',
        }}
      >
        {low ? 'running low' : 'have'}
      </button>
      <RemoveButton onClick={onRemove} />
    </Box>
  );
}

function ColdCabinet(): JSX.Element {
  return (
    <Stack gap={9} align="start" style={{ maxWidth: 360 }}>
      <Text scale="caption" color={colors.inkFaint} style={{ letterSpacing: '0.02em' }}>
        cabinet is empty
      </Text>
      <Row gap={9} align="start">
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
        <Text scale="body" style={{ lineHeight: 1.5 }}>
          your meds, vitamins and supplements gather here, grouped by what
          they&rsquo;re for. dump &ldquo;started magnesium 400mg at night for
          sleep&rdquo; to stock the first one.
        </Text>
      </Row>
    </Stack>
  );
}

/** A quiet placeholder where the dump bar will sit — adding is via the dump. */
function DumpBarHint(): JSX.Element {
  return (
    <Box bg="cream" radius="card" shadow="raised" style={{ padding: '14px 18px', opacity: 0.7 }}>
      <Text scale="caption" color={colors.inkFaint}>
        dump to update — &ldquo;running low on vitamin d&rdquo;, &ldquo;took my
        magnesium&rdquo;, &ldquo;started omega-3 for mood&rdquo;
      </Text>
    </Box>
  );
}

// ─── primitives ───────────────────────────────────────────────────────────

/** Soft round tick — empty = pressed cream well; checked = filled sage disc. */
function TickCircle({
  done,
  onClick,
  label,
}: {
  done: boolean;
  onClick: () => void;
  label?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? (done ? 'mark undone' : 'mark done')}
      aria-pressed={done}
      style={{
        boxSizing: 'border-box',
        width: 26,
        height: 26,
        borderRadius: '50%',
        border: 'none',
        flexShrink: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: done ? colors.sageDeep : colors.cream,
        boxShadow: done
          ? shadows.raisedSm
          : 'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
      }}
    >
      {done && (
        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 5.2 L4.2 7.2 L8 3"
            fill="none"
            stroke={colors.paper}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

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
        <Box bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
          <Text scale="body" color={colors.inkFaint}>
            {empty}
          </Text>
        </Box>
      ) : (
        <Stack gap={12}>{items.map(renderItem)}</Stack>
      )}
    </Stack>
  );
}

function EventRow({
  title,
  detail,
  whenMs,
  accentDot,
}: {
  title: string;
  detail: string | null;
  whenMs: number;
  accentDot?: string;
}): JSX.Element {
  return (
    <Box
      bg="cream"
      radius="card"
      shadow="raised"
      style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}
    >
      <span
        aria-hidden
        style={{
          boxSizing: 'border-box',
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: accentDot ? `2px solid ${accentDot}` : 'none',
          background: colors.cream,
          boxShadow:
            'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
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
            <span style={{ color: colors.inkFaint, fontWeight: fontWeights.regular, marginLeft: 8 }}>
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
          {formatRelativeTime(whenMs)}
        </div>
      </div>
    </Box>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      {accent && (
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }}
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

/** Hour-of-day for an "HH:MM" slot (0..23); used to bucket morning vs evening. */
function hourOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) : 0;
}

/** "09:00" → "9:00am" — the calm clock grammar shared across the box. */
function formatSlot(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const hh = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hh}:${m[2]}${ampm}`;
}
