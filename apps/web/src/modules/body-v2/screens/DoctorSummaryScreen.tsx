/**
 * body-v2 · DoctorSummaryScreen — the brief (body-doctor-summary.html)
 *
 * A calm typed-document card: a tldr paragraph, the severity arc, the
 * meds-taken k/v lines, and the 7-day context — facts and dates, nothing
 * interpreted, NO diagnosis language. Two calm actions: amber "copy"
 * (the act) and a ghost ".md file" download. A closing note restates that
 * ollie records, it does not diagnose.
 *
 * Real data + logic: `doctorSummaryVM` over the live open / most-recent
 * episode. The brief markdown is the SAME `generateDoctorSummary` output
 * the live `ActiveEpisodeCard` produces — copy / download hand over the
 * exact same document.
 *
 * The 7-day cross-module context is wired from the live `sleep.records`
 * slice; cycle phases + dump history are honest stubs (the preview has no
 * clean read for them) — `generateDoctorSummary` simply omits a context
 * section it has no data for.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconInfo, v2 } from '../../money-v2/v2';
import { useStoreSlice } from '../../../store';
import type { DoctorSummaryHistory } from '@ollie/logic/body';
import { useBodySlices } from '../useBodySlices';
import { doctorSummaryVM } from '../selectors';
import { SeverityArc } from '../components/SeverityArc';

export interface DoctorSummaryScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

/** the sleep night shape the doctor summary's context section reads */
interface SleepNight {
  night_of?: unknown;
  tst_min?: unknown;
}

export function DoctorSummaryScreen({
  now,
  onBack,
  onSafe,
}: DoctorSummaryScreenProps) {
  const slices = useBodySlices();
  // the 7-day context — real sleep history, read straight from the live slice
  const [sleepRecords] = useStoreSlice<SleepNight[]>('sleep', 'records', []);

  const history = useMemo<DoctorSummaryHistory>(() => {
    const nights = (Array.isArray(sleepRecords) ? sleepRecords : [])
      .filter(
        (r) =>
          r &&
          typeof r.night_of === 'string' &&
          typeof r.tst_min === 'number',
      )
      .map((r) => ({
        night_of: r.night_of as string,
        tst_min: r.tst_min as number,
      }));
    return { sleepRecords: nights };
  }, [sleepRecords]);

  const vm = useMemo(
    () => doctorSummaryVM(slices, now, history),
    [slices, now, history],
  );

  const [copied, setCopied] = useState(false);

  if (!vm.exists) {
    return (
      <Screen
        label="doctor summary"
        onBack={onBack}
        onSafe={onSafe}
        centered
        contentStyle={{ paddingTop: 0 }}
      >
        <div
          style={{
            textAlign: 'center',
            fontSize: 16,
            color: v2.mute,
            fontWeight: 500,
            lineHeight: 1.5,
            padding: '0 20px',
          }}
        >
          the summary builds itself once an episode has been logged. start one
          from <b style={{ color: v2.ink, fontWeight: 600 }}>symptoms</b> and
          it will be waiting here.
        </div>
      </Screen>
    );
  }

  function copyBrief() {
    const nav = navigator as Navigator & {
      clipboard?: { writeText?: (t: string) => Promise<void> };
    };
    if (nav.clipboard?.writeText) {
      nav.clipboard.writeText(vm.markdown).catch(() => {
        /* clipboard blocked — silent, the document is still on screen */
      });
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadBrief() {
    try {
      const blob = new Blob([vm.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${vm.episodeLabel.replace(/\s+/g, '-')}-episode.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable in this runtime — silent */
    }
  }

  return (
    <Screen
      label="doctor summary"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the framing line */}
      <div style={{ marginTop: 44 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.3,
          }}
        >
          <b style={{ fontWeight: 500 }}>the {vm.episodeLabel} episode</b>,
          written out plainly
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          a record of what you logged &mdash; facts and dates, nothing
          interpreted. something to read out, or hand over, at an appointment.
        </div>
      </div>

      {/* THE BRIEF — a calm typed document */}
      <div
        style={{
          marginTop: 24,
          background: v2.card,
          border: `1px solid ${v2.line}`,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 6px 16px rgba(42,38,34,.05)',
          boxSizing: 'border-box',
        }}
      >
        <BriefSection label="tldr" first>
          <div
            style={{
              fontSize: 14,
              color: v2.ink,
              fontWeight: 400,
              lineHeight: 1.55,
              letterSpacing: '-0.005em',
            }}
          >
            {vm.tldr}
          </div>
        </BriefSection>

        {vm.severityArc.length > 0 && (
          <BriefSection label="severity, by check-in">
            <div style={{ marginTop: 4 }}>
              <SeverityArc
                points={vm.severityArc}
                variant="brief"
                dayLabels={vm.arcLabels}
              />
            </div>
          </BriefSection>
        )}

        {vm.meds.length > 0 && (
          <BriefSection label="medication taken">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vm.meds.map((m, i) => (
                <div
                  key={`${m.when}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: v2.mute, fontWeight: 500 }}>
                    {m.when}
                  </span>
                  <span
                    style={{
                      color: v2.ink,
                      fontWeight: 600,
                      textAlign: 'right',
                      maxWidth: '62%',
                    }}
                  >
                    {m.what}
                  </span>
                </div>
              ))}
            </div>
          </BriefSection>
        )}

        <BriefSection label="the 7 days around it">
          {history.sleepRecords && history.sleepRecords.length > 0 ? (
            <ContextRow>
              sleep is logged for {history.sleepRecords.length} of the days
              around onset &mdash; the figures are in the full .md.
            </ContextRow>
          ) : (
            <ContextRow>
              no sleep, cycle or dump data sits in this window yet &mdash; the
              context section fills in as those modules are used.
            </ContextRow>
          )}
        </BriefSection>
      </div>

      {/* copy / download */}
      <div style={{ marginTop: 22, display: 'flex', gap: 11 }}>
        <AmberButton
          onClick={copyBrief}
          block
          icon={
            <svg
              width={17}
              height={17}
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              stroke="#fff"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          }
          style={{ flex: 1, height: 50, borderRadius: 25, fontSize: 15 }}
        >
          {copied ? 'copied' : 'copy'}
        </AmberButton>
        <button
          type="button"
          onClick={downloadBrief}
          style={{
            boxSizing: 'border-box',
            flex: 1,
            height: 50,
            borderRadius: 25,
            background: v2.card,
            border: `1.5px solid ${v2.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg
            width={17}
            height={17}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            stroke={v2.ink}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: v2.ink, letterSpacing: '-0.01em' }}>
            .md file
          </span>
        </button>
      </div>

      {/* the closing note */}
      <div
        style={{
          marginTop: 20,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          ollie records what you logged &mdash; it does not diagnose or
          interpret. the reading of this is your doctor&rsquo;s.
        </span>
      </div>
    </Screen>
  );
}

function BriefSection({
  label,
  first = false,
  children,
}: {
  label: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: '18px 20px',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: v2.mute,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ContextRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: v2.mute,
          flexShrink: 0,
          marginTop: 8,
        }}
      />
      <span
        style={{
          fontSize: 13,
          color: v2.ink,
          fontWeight: 400,
          lineHeight: 1.6,
        }}
      >
        {children}
      </span>
    </div>
  );
}
