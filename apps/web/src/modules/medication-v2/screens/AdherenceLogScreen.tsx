/**
 * medication-v2 · AdherenceLogScreen — the adherence log (medication-log.html)
 *
 * Two calm sections. TODAY — a per-med view of today's doses: each med a
 * quiet block, its scheduled slots as slim pills (taken = sage + the time,
 * due = an open ink ring, ahead = a hairline ring); a manual-only med
 * carries a plain dash line. THE LAST 14 DAYS — one plain "logged X of Y"
 * line per med, factual, never a streak, never a grade. A sage framing
 * note states plainly this is a pattern, not a medical reading, and is
 * never pushed.
 *
 * Real data + logic: `adherenceLogVM` over the live `medication.*` slices —
 * today's slots from the pure `dueSlotsToday`, the fortnight line from the
 * SAME `adherenceReport` the orchestrator runs (preferring the stored
 * `medication.adherence` slice, falling back to a live compute).
 */
import { useMemo } from 'react';
import { Screen, v2 } from '../../money-v2/v2';
import { useMedicationSlices } from '../useMedicationSlices';
import {
  adherenceLogVM,
  type TodayMedVM,
  type TodaySlot,
  type ReportLine,
} from '../selectors';

export interface AdherenceLogScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function AdherenceLogScreen({
  now,
  onBack,
  onSafe,
}: AdherenceLogScreenProps) {
  const slices = useMedicationSlices();
  const vm = useMemo(() => adherenceLogVM(slices, now), [slices, now]);

  return (
    <Screen
      label="adherence log"
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
        <b style={{ fontWeight: 500 }}>what was taken</b>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
        }}
      >
        today &middot; the last fortnight
      </div>

      {!vm.hasMeds ? (
        <div
          style={{
            marginTop: 34,
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
              marginTop: 6,
            }}
          />
          <span
            style={{
              fontSize: 14,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            nothing logged yet &mdash; add a medication and the log will gather
            here.
          </span>
        </div>
      ) : (
        <>
          {/* TODAY */}
          <SectionLabel>today</SectionLabel>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
            {vm.today.map((med, i) => (
              <TodayBlock
                key={med.id}
                med={med}
                last={i === vm.today.length - 1}
              />
            ))}
          </div>

          {/* THE LAST 14 DAYS */}
          <SectionLabel style={{ marginTop: 34 }}>
            the last 14 days
          </SectionLabel>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
            {vm.report.map((line, i) => (
              <ReportRow
                key={line.id}
                line={line}
                last={i === vm.report.length - 1}
              />
            ))}
          </div>

          {/* the framing note — sage, calm, screen-only */}
          <div
            style={{
              marginTop: 22,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '15px 16px',
              background: '#F0F3F0',
              borderRadius: 16,
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
                color: '#5A6B5F',
                fontWeight: 400,
                lineHeight: 1.55,
              }}
            >
              this is a{' '}
              <b style={{ color: v2.ink, fontWeight: 600 }}>
                pattern, not a medical reading
              </b>
              . a missed log isn&rsquo;t a missed dose, and a missed dose
              isn&rsquo;t a failure. it stays on this screen &mdash; ollie
              never sends it to you.
            </span>
          </div>
        </>
      )}
    </Screen>
  );
}

// ─── one med's today block ───────────────────────────────────────────────────

function TodayBlock({ med, last }: { med: TodayMedVM; last: boolean }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '16px 2px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
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
        <span
          style={{
            fontSize: 15,
            color: v2.ink,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {med.name}
          {med.dose && (
            <span
              style={{ color: v2.mute, fontWeight: 500, fontSize: 12 }}
            >
              {' '}
              &middot; {med.dose}
            </span>
          )}
        </span>
      </div>

      {med.manual ? (
        <div
          style={{
            marginTop: 11,
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
          }}
        >
          manual log only &mdash;{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            {med.manualLoggedToday > 0
              ? `logged ${med.manualLoggedToday} time${
                  med.manualLoggedToday === 1 ? '' : 's'
                } today`
              : 'not logged today'}
          </b>
          .
        </div>
      ) : (
        <div
          style={{
            marginTop: 11,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {med.slots.map((slot, i) => (
            <SlotPill key={`${slot.label}-${i}`} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotPill({ slot }: { slot: TodaySlot }) {
  const taken = slot.state === 'taken';
  return (
    <span
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        border: `1px solid ${v2.line}`,
        background: taken ? '#F3F0E6' : v2.card,
        borderRadius: 13,
        padding: '6px 11px',
      }}
    >
      <span
        aria-hidden
        style={{
          boxSizing: 'border-box',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: taken ? v2.sage : 'transparent',
          border: taken ? 'none' : `1.6px solid ${v2.mute}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: v2.ink,
          fontWeight: 600,
          letterSpacing: '0.01em',
        }}
      >
        {slot.label}
      </span>
      <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500 }}>
        {taken && slot.takenAt
          ? `— ${slot.takenAt}`
          : slot.state === 'due'
            ? '— due'
            : '— ahead'}
      </span>
    </span>
  );
}

// ─── one med's fortnight report line ─────────────────────────────────────────

function ReportRow({ line, last }: { line: ReportLine; last: boolean }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '15px 2px',
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: line.dot,
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
      <span
        style={{
          fontSize: 14,
          color: v2.ink,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          flexShrink: 0,
        }}
      >
        {line.name}
      </span>
      <span
        style={{
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          flex: 1,
          textAlign: 'right',
        }}
      >
        {reportText(line)}
      </span>
    </div>
  );
}

/** the plain right-aligned report line — factual, never a grade */
function reportText(line: ReportLine): React.ReactNode {
  const k = (s: string) => (
    <span style={{ color: v2.mute, fontWeight: 500 }}>{s}</span>
  );
  if (line.manual) {
    return (
      <>
        {k('logged')}{' '}
        <b style={{ fontWeight: 600 }}>
          {line.manualCount} time{line.manualCount === 1 ? '' : 's'}
        </b>{' '}
        {k('· manual')}
      </>
    );
  }
  if (line.report) {
    return (
      <>
        {k('logged')}{' '}
        <b style={{ fontWeight: 600 }}>
          {line.report.logged} of {line.report.expected}
        </b>
      </>
    );
  }
  // a scheduled med too young for a 14-day window — honest, not blank
  return (
    <>
      {k('logged')}{' '}
      <b style={{ fontWeight: 600 }}>
        {line.manualCount} time{line.manualCount === 1 ? '' : 's'}
      </b>{' '}
      {k('· still gathering')}
    </>
  );
}

// ─── a small section label ───────────────────────────────────────────────────

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        marginTop: 34,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
