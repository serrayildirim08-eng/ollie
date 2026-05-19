/**
 * pets-v2 · ProfileScreen — one pet at rest (pets-profile.html)
 *
 * A notebook page on one pet: the soft paw-disc + name, species / social /
 * since line, an adoptversary line ONLY on the day, the tailored 30-day
 * care strip scaled up with its quiet caption, the last three observations
 * as hairline rows, the milestones as sage-dot lines, and a calm drill
 * footer (log care for this pet · record an observation).
 *
 * Real data: every line comes from `petProfileVM` over the live `pets.*`
 * slices. Renders a calm "this pet isn't here" state if the id is unknown.
 */
import { useMemo } from 'react';
import { Screen, v2, IconChevronRight } from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { petProfileVM } from '../selectors';
import { CareStrip } from '../components/CareStrip';

export interface ProfileScreenProps {
  now: number;
  petId: string | null;
  onBack: () => void;
  onLogCare: (petId: string) => void;
  onObserve: (petId: string) => void;
}

const DISC_FILL = '#F2EEDF';
const UMBER = '#A8703C';

export function ProfileScreen({
  now,
  petId,
  onBack,
  onLogCare,
  onObserve,
}: ProfileScreenProps) {
  const slices = usePetsSlices();
  const vm = useMemo(() => petProfileVM(slices, petId, now), [slices, petId, now]);

  if (!vm) {
    return (
      <Screen label="pets" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
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
          this pet isn&rsquo;t in the notebook anymore.
        </div>
      </Screen>
    );
  }

  return (
    <Screen label={vm.petName} onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the head — a soft paw-disc, the name, species + status */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 66,
            height: 66,
            borderRadius: '50%',
            background: DISC_FILL,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 27,
              fontWeight: 700,
              color: v2.ink,
              letterSpacing: '-0.02em',
            }}
          >
            {vm.petInitial}
          </span>
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
          }}
        >
          {vm.petName}
        </div>
        <div
          style={{
            marginTop: 7,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {vm.speciesDisplay}
          <Sep />
          {vm.socialLine}
          <Sep />
          {vm.sinceLine}
        </div>

        {/* the adoptversary line — present only on the day */}
        {vm.adoptversaryYears !== null && (
          <div
            style={{
              boxSizing: 'border-box',
              marginTop: 14,
              background: '#FBF1E7',
              border: '1px solid #E8D6BE',
              borderRadius: 14,
              padding: '11px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: UMBER,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, color: UMBER, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {vm.adoptversaryYears} year{vm.adoptversaryYears === 1 ? '' : 's'} with{' '}
              {vm.petName} today
            </span>
          </div>
        )}
      </div>

      {/* the 30-day care strip — the tailored visual, scaled up */}
      <SectionLabel>last 30 days of care</SectionLabel>
      <div style={{ marginTop: 14 }}>
        <CareStrip days={vm.strip} size="lg" />
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            letterSpacing: '-0.005em',
            lineHeight: 1.5,
          }}
        >
          care logged{' '}
          <b style={{ color: v2.ink, fontWeight: 600 }}>
            {vm.stripOnCount} of 30 days
          </b>{' '}
          &mdash; a soft dot is a day with care, a gap is just a gap.
        </div>
      </div>

      {/* recent observations — last 3 */}
      <SectionLabel>recent observations</SectionLabel>
      {vm.observations.length === 0 ? (
        <EmptyLine>nothing recorded yet &mdash; a quiet day is just a day.</EmptyLine>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
          {vm.observations.map((ob, i) => (
            <div
              key={i}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === vm.observations.length - 1 ? `1px solid ${v2.line}` : 'none',
                padding: '14px 0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: v2.ink,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.4,
                  }}
                >
                  {ob.text}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: v2.mute,
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  {ob.when}
                </span>
              </div>
              {ob.tags.length > 0 && (
                <div
                  style={{
                    marginTop: 7,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  {ob.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        color: v2.mute,
                        fontWeight: 600,
                        background: DISC_FILL,
                        borderRadius: 8,
                        padding: '3px 8px',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* milestones — the firsts */}
      {vm.milestones.length > 0 && (
        <>
          <SectionLabel>milestones</SectionLabel>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
            {vm.milestones.map((m, i) => (
              <div
                key={i}
                style={{
                  boxSizing: 'border-box',
                  borderTop: `1px solid ${v2.line}`,
                  borderBottom:
                    i === vm.milestones.length - 1 ? `1px solid ${v2.line}` : 'none',
                  padding: '13px 0',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 11,
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
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      color: v2.ink,
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {m.line}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 12,
                      color: v2.mute,
                      fontWeight: 400,
                    }}
                  >
                    {m.when}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* the calm drill footer */}
      <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column' }}>
        <DrillRow
          first
          label={`log care for ${vm.petName}`}
          onOpen={() => onLogCare(vm.petId)}
        />
        <DrillRow
          last
          label="record an observation"
          onOpen={() => onObserve(vm.petId)}
        />
      </div>
    </Screen>
  );
}

// ─── small bits ──────────────────────────────────────────────────────────────

function Sep() {
  return <span style={{ color: v2.line, margin: '0 7px' }}>·</span>;
}

function SectionLabel({ children }: { children: import('react').ReactNode }) {
  return (
    <div
      style={{
        marginTop: 34,
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

function EmptyLine({ children }: { children: import('react').ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        fontSize: 13,
        color: v2.mute,
        fontWeight: 400,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

interface DrillRowProps {
  label: string;
  onOpen: () => void;
  first?: boolean;
  last?: boolean;
}

function DrillRow({ label, onOpen, first = false, last = false }: DrillRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderTop: first ? `1px solid ${v2.line}` : `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '17px 2px',
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'inline-flex' }} aria-hidden>
        <IconChevronRight stroke={v2.mute} />
      </span>
    </button>
  );
}
