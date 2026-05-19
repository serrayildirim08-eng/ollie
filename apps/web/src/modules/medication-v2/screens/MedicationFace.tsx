/**
 * medication-v2 · MedicationFace — the medication submodule page (Level 2)
 *
 * Mirrors medication.html (meds on file → the NEXT DOSE is the hero: a big
 * take-circle, the day's dose dots, the notebook list of meds, an
 * adherence-log drill row) and medication-cold.html (no meds → the FACE is
 * still present, never blank: an empty ink-outline take-circle, an honest
 * invitation, the "add your first" amber button). One face, two states —
 * picked by `medicationFaceVM().hasMeds`.
 *
 * Real data: every line comes from `selectors.ts` over the live
 * `medication.*` slices via `useMedicationSlices`. The take-circle logs a
 * real dose through `useMedicationActions`.
 */
import { useMemo } from 'react';
import { Screen, NavRow, AmberButton, IconPlus, IconCheck, v2 } from '../../money-v2/v2';
import { useMedicationSlices } from '../useMedicationSlices';
import { useMedicationActions } from '../useMedicationActions';
import { medicationFaceVM, type MedRow } from '../selectors';
import { TakeCircle } from '../components/TakeCircle';
import { DoseDots } from '../components/DoseDots';
import type { MedicationRoute } from '../MedicationApp';

export interface MedicationFaceProps {
  now: number;
  navigate: (to: MedicationRoute) => void;
  onSafe: () => void;
}

export function MedicationFace({ now, navigate, onSafe }: MedicationFaceProps) {
  const slices = useMedicationSlices();
  const actions = useMedicationActions(now);
  const face = useMemo(() => medicationFaceVM(slices, now), [slices, now]);

  return (
    <Screen
      label="medication"
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* THE HERO — the next dose */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {face.hasNextDose ? (
            <>
              next &middot;{' '}
              <b style={{ color: v2.ink, fontWeight: 600 }}>{face.nextTime}</b>
            </>
          ) : (
            'next dose'
          )}
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: face.hasMeds ? 34 : 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
            textAlign: 'center',
          }}
        >
          {face.nextName}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {face.nextSub}
        </div>

        <div
          style={{
            marginTop: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <TakeCircle
            time={face.nextTime}
            cue={face.nextCue}
            live={face.hasNextDose}
            onTake={
              face.nextItemId
                ? () => actions.logDose(face.nextItemId as string)
                : undefined
            }
          />

          <div style={{ marginTop: 24 }}>
            <DoseDots dots={face.doseDots} cold={!face.hasMeds} />
          </div>

          {face.dosesScheduled > 0 && (
            <div
              style={{
                marginTop: 13,
                fontSize: 14,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{ color: v2.mute }}>today &mdash;</span>{' '}
              {face.dosesTaken} of {face.dosesScheduled} taken
            </div>
          )}
        </div>

        {/* the cold invitation — only when no med is on file */}
        {!face.hasMeds && (
          <>
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                maxWidth: 288,
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
                  marginTop: 6,
                }}
              />
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.45,
                  textAlign: 'left',
                }}
              >
                this is where your meds, vitamins and supplements live.{' '}
                <b style={{ fontWeight: 600 }}>
                  add one and ollie tracks the next dose
                </b>{' '}
                &mdash; or just logs what you took, no schedule needed.
              </span>
            </div>
            <AmberButton
              icon={<IconPlus size={18} />}
              onClick={() => navigate('add')}
              style={{ marginTop: 30, height: 50, borderRadius: 25 }}
            >
              add your first
            </AmberButton>
          </>
        )}
      </div>

      {/* THE NOTEBOOK LIST — your meds */}
      <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          your meds
        </div>

        {face.hasMeds ? (
          <>
            {face.meds.map((m) => (
              <MedListRow key={m.id} med={m} />
            ))}
            {/* add a medication — one quiet amber ghost line */}
            <button
              type="button"
              onClick={() => navigate('add')}
              style={{
                boxSizing: 'border-box',
                width: '100%',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: `1px solid ${v2.line}`,
                borderLeft: 'none',
                borderRight: 'none',
                background: 'transparent',
                padding: '16px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                cursor: 'pointer',
                textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <IconPlus size={16} stroke={v2.accent} />
              <span
                style={{
                  fontSize: 14,
                  color: v2.accent,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                }}
              >
                add a medication
              </span>
            </button>
          </>
        ) : (
          // cold — one quiet placeholder line in the notebook grammar
          <div
            style={{
              borderTop: `1px solid ${v2.line}`,
              borderBottom: `1px solid ${v2.line}`,
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
                border: `1.5px dashed ${v2.line}`,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 14,
                color: v2.mute,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              no medications yet &mdash; your list will gather here
            </span>
          </div>
        )}
      </div>

      {/* THE ADHERENCE DRILL ROW */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          last
          rowKey="adherence log"
          value={face.adherenceLine}
          dim={face.adherenceCold}
          onOpen={() => navigate('log')}
        />
      </div>

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{
          marginTop: 28,
          alignSelf: 'center',
          background: 'transparent',
          border: 'none',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        what medication sends &mdash; and what it never does
      </button>

      {!face.hasMeds && (
        <div
          style={{
            marginTop: 24,
            textAlign: 'center',
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          no streaks, no scoring &mdash; just what you take, and when, kept for
          you and your doctor.
        </div>
      )}
    </Screen>
  );
}

// ─── one med, in the notebook list ───────────────────────────────────────────

function MedListRow({ med }: { med: MedRow }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${v2.line}`,
        padding: '16px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: med.dot,
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
            fontSize: 15,
            color: v2.ink,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {med.name}{' '}
          <span
            style={{
              color: v2.mute,
              fontWeight: 500,
              fontSize: 12,
              letterSpacing: '0.02em',
            }}
          >
            &middot; {med.kind}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {med.meta}
        </div>
      </div>
      {med.doneToday && (
        <>
          {med.takenAt && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 12,
                color: v2.mute,
                fontWeight: 500,
              }}
            >
              {med.takenAt}
            </span>
          )}
          <span aria-label="taken today" style={{ flexShrink: 0, display: 'inline-flex' }}>
            <IconCheck size={15} weight={2.6} stroke={v2.sage} title="taken today" />
          </span>
        </>
      )}
    </div>
  );
}
